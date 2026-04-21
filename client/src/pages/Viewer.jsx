import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import api from '../utils/api';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { TbDownload, TbFileTypePdf, TbPhoto, TbTableExport, TbMaximize, TbMinimize, TbPrinter, TbRefresh } from 'react-icons/tb';

export default function Viewer() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [widgets, setWidgets] = useState({});
  const [reportFilters, setReportFilters] = useState({});
  // Tracks only slicer-driven selections (not cross-filters) — drives FilterWidget visual state
  const [slicerSelections, setSlicerSelections] = useState({});
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [crossHighlight, setCrossHighlight] = useState(null);
  const crossHighlightRef = useRef(null);
  crossHighlightRef.current = crossHighlight;
  const crossFilterSourceRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const canvasRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const pageStateRef = useRef({}); // { [pageIdx]: { widgets, reportFilters, crossHighlight } }

  // Load report + model
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        setReport(r);

        // Load pages
        const reportPages = r.pages || r.settings?.pages;
        let firstPageWidgets = {};
        if (reportPages && reportPages.length > 0) {
          setPages(reportPages);
          firstPageWidgets = reportPages[0].widgets || {};
          setWidgets(firstPageWidgets);
        } else {
          setPages([{ id: 'page-1', name: 'Page 1', layout: r.layout, widgets: r.widgets }]);
          firstPageWidgets = r.widgets || {};
          setWidgets(firstPageWidgets);
        }

        // Restore slicer selections from saved filter widgets' config.selectedValues
        const initialSlicerSel = {};
        for (const w of Object.values(firstPageWidgets)) {
          if (w?.type !== 'filter') continue;
          const dim = w.dataBinding?.selectedDimensions?.[0];
          const vals = w.config?.selectedValues;
          if (dim && Array.isArray(vals) && vals.length > 0) initialSlicerSel[dim] = vals;
        }
        if (Object.keys(initialSlicerSel).length > 0) {
          setSlicerSelections(initialSlicerSel);
          setReportFilters(initialSlicerSel);
        }

        if (r.model_id) {
          try {
            const modelRes = await api.get(`/models/${r.model_id}`);
            setModel(modelRes.data.model);
          } catch { /* model might not be accessible */ }
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Report not found');
      }
    };
    load();
  }, [id]);

  // Slicer filter
  const handleSlicerFilter = useCallback((widgetId, dimensionName, selectedValues) => {
    setSlicerSelections((prev) => {
      const next = { ...prev };
      if (!selectedValues || selectedValues.length === 0) {
        delete next[dimensionName];
      } else {
        next[dimensionName] = selectedValues;
      }
      return next;
    });
    setReportFilters((prev) => {
      const next = { ...prev };
      if (!selectedValues || selectedValues.length === 0) {
        const ch = crossHighlightRef.current;
        if (ch && ch.dim === dimensionName) {
          next[dimensionName] = [ch.value];
        } else {
          delete next[dimensionName];
        }
      } else {
        next[dimensionName] = selectedValues;
      }
      return next;
    });
  }, []);

  // Cross-filter click
  const handleCrossFilter = useCallback((sourceWidgetId, dimensionName, value) => {
    const prev = crossHighlightRef.current;
    const isSame = prev && prev.widgetId === sourceWidgetId && prev.value === value;
    if (isSame) {
      crossFilterSourceRef.current = null;
      setCrossHighlight(null);
      setReportFilters((p) => {
        const n = { ...p };
        if (slicerSelections[dimensionName]) {
          n[dimensionName] = slicerSelections[dimensionName];
        } else {
          delete n[dimensionName];
        }
        return n;
      });
    } else {
      crossFilterSourceRef.current = sourceWidgetId;
      setCrossHighlight({ widgetId: sourceWidgetId, dim: dimensionName, value });
      setReportFilters((p) => {
        const n = { ...p };
        if (prev && prev.dim && prev.dim !== dimensionName) {
          if (slicerSelections[prev.dim]) {
            n[prev.dim] = slicerSelections[prev.dim];
          } else {
            delete n[prev.dim];
          }
        }
        n[dimensionName] = [value];
        return n;
      });
    }
  }, [slicerSelections]);

  // Refetch when filters change (NOT on page restore — saved state is already correct)
  const prevFiltersJson = useRef('{}');
  const skipNextRefetch = useRef(false);
  const prevRefreshCounter = useRef(0);
  useEffect(() => {
    if (skipNextRefetch.current) {
      skipNextRefetch.current = false;
      prevFiltersJson.current = JSON.stringify(reportFilters || {});
      prevRefreshCounter.current = refreshCounter;
      return;
    }
    const json = JSON.stringify(reportFilters || {});
    const sourceId = crossFilterSourceRef.current;
    const refreshRequested = refreshCounter !== prevRefreshCounter.current;
    prevRefreshCounter.current = refreshCounter;
    // Skip only if NOTHING changed: filters identical AND no fresh cross-filter click AND no refresh request
    if (json === prevFiltersJson.current && sourceId === null && !refreshRequested) return;
    prevFiltersJson.current = json;
    if (!model) { setRefreshing(false); return; }

    crossFilterSourceRef.current = null;

    // Use current page widgets (not stale state from previous render)
    const currentWidgets = pages[currentPageIdx]?.widgets || widgets;

    // Collect widgets to fetch, then mark them all as loading in one batch
    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w || w.type === 'filter' || w.type === 'text') return false;
      if (!refreshRequested && wId === sourceId) return false;
      const b = w.dataBinding || {};
      const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
        : w.type === 'combo' ? ((b.comboBarMeasures?.length > 0) || (b.comboLineMeasures?.length > 0))
        : (b.selectedMeasures?.length > 0);
      return (b.selectedDimensions?.length > 0 || hasMeas);
    });
    if (toFetch.length > 0) {
      setWidgets((prev) => {
        const next = { ...prev };
        toFetch.forEach(([wId]) => { if (next[wId]) next[wId] = { ...next[wId], _loading: true }; });
        return next;
      });
    }

    toFetch.forEach(([wId, w]) => {
      const binding = w.dataBinding || {};
      const dims = binding.selectedDimensions || [];
      const sm = binding.scatterMeasures || {};
      const cbm = binding.comboBarMeasures || [];
      const clm = binding.comboLineMeasures || [];
      const meass = w.type === 'scatter'
        ? [sm.x, sm.y, sm.size].filter(Boolean)
        : w.type === 'combo'
          ? [...new Set([...cbm, ...clm])]
          : w.type === 'gauge'
            ? [...new Set([...(binding.selectedMeasures || []), binding.gaugeThresholdMeasure, binding.gaugeMaxMeasure].filter(Boolean))]
            : (binding.selectedMeasures || []);
      const grpBy = binding.groupBy || [];
      const colDimsB = binding.columnDimensions || [];

      const allDims = [...dims, ...grpBy.filter((g) => !dims.includes(g)), ...colDimsB.filter((g) => !dims.includes(g) && !grpBy.includes(g))];

      api.post(`/models/${model.id}/query`, {
        dimensionNames: allDims, measureNames: meass,
        limit: w.config?.dataLimit || 1000, filters: reportFilters,
      }).then((res) => {
        const rows = res.data?.rows;
        if (!rows || rows.length === 0) {
          // Empty result — clear widget data so it reflects the filter instead of keeping stale data
          setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data: { _rowCount: 0 } } }));
          return;
        }
        let newData = {};
        const keys = Object.keys(rows[0]);
        if (w.type === 'pivotTable') {
          const rowDimNames = [...dims];
          newData = { rawRows: rows,
            _rowDims: rowDimNames.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
            _colDims: colDimsB.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
            _measures: meass.map((m) => { const def = (model.measures || []).find((x) => x.name === m); return def?.label || def?.name || m; }),
          };
        } else if (w.type === 'scatter') {
          const sm = binding.scatterMeasures || {};
          if (sm.x && sm.y) {
            const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
            const fk = (label) => keys.find((k) => k === label) || null;
            const dk = dims.length > 0 ? fk(gl(dims[0], model.dimensions || [])) : null;
            const gk = grpBy.length > 0 ? fk(gl(grpBy[0], model.dimensions || [])) : null;
            const xk = fk(gl(sm.x, model.measures || []));
            const yk = fk(gl(sm.y, model.measures || []));
            const sk = sm.size ? fk(gl(sm.size, model.measures || [])) : null;
            if (xk && yk) {
              const bp = (r) => ({ x: Number(r[xk]) || 0, y: Number(r[yk]) || 0, size: sk ? Number(r[sk]) || 0 : undefined, label: dk ? String(r[dk] ?? '') : undefined });
              if (gk) {
                const groups = {};
                rows.forEach((r) => { const g = String(r[gk] ?? ''); if (!groups[g]) groups[g] = []; groups[g].push(bp(r)); });
                newData = { points: rows.map(bp), seriesGroups: Object.entries(groups).map(([name, pts]) => ({ name, points: pts })) };
              } else {
                newData = { points: rows.map(bp) };
              }
              newData._xLabel = gl(sm.x, model.measures || []);
              newData._yLabel = gl(sm.y, model.measures || []);
              newData._hasSize = !!sk;
              if (sk) newData._sizeLabel = gl(sm.size, model.measures || []);
            }
          }
        } else if (w.type === 'combo') {
          const cbm = binding.comboBarMeasures || [];
          const clm = binding.comboLineMeasures || [];
          const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
          const fk = (label) => keys.find((k) => k === label) || null;
          const axisKey = dims.length > 0 ? fk(gl(dims[0], model.dimensions || [])) || keys[0] : keys[0];
          const grpLabel = grpBy.length > 0 ? gl(grpBy[0], model.dimensions || []) : null;
          const grpKey = grpLabel ? fk(grpLabel) : null;
          const labels = [...new Set(rows.map((r) => String(r[axisKey] ?? '')))];
          let barSeries = [];
          if (grpKey) {
            const ug = [...new Set(rows.map((r) => String(r[grpKey] ?? '')))].sort();
            cbm.forEach((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return;
              ug.forEach((gv) => { barSeries.push({ name: cbm.length === 1 ? gv : `${gv} - ${ml}`, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l && String(r[grpKey] ?? '') === gv); return row ? Number(row[mk]) || 0 : 0; }) }); });
            });
          } else {
            cbm.forEach((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return; barSeries.push({ name: ml, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l); return row ? Number(row[mk]) || 0 : 0; }) }); });
          }
          const lineSeries = clm.map((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return null;
            return { name: ml, values: labels.map((l) => rows.filter((r) => String(r[axisKey] ?? '') === l).reduce((s, r) => s + (Number(r[mk]) || 0), 0)) };
          }).filter(Boolean);
          newData = { labels, barSeries, lineSeries };
        } else if (w.type === 'table') {
          newData = { columns: keys, rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')) };
        } else if (w.type === 'pie') {
          newData = { items: rows.map((r) => ({ name: String(r[keys[0]]), value: Number(r[keys[keys.length - 1]]) || 0 })) };
        } else if (w.type === 'scorecard' || w.type === 'gauge') {
          const firstRow = rows[0];
          if (firstRow) {
            const valueMeasName = w.dataBinding?.selectedMeasures?.[0];
            const valueMeasDef = (model.measures || []).find((m) => m.name === valueMeasName);
            const valueKey = valueMeasDef?.label || valueMeasDef?.name || valueMeasName;
            const measureVal = valueKey && firstRow[valueKey] !== undefined ? firstRow[valueKey] : Object.values(firstRow)[0];
            newData = {
              value: typeof measureVal === 'number' ? measureVal.toLocaleString() : String(measureVal),
              label: valueMeasDef?.label || valueMeasName || '',
            };
            if (w.type === 'gauge') {
              const extractMeas = (measName) => {
                if (!measName) return undefined;
                const def = (model.measures || []).find((m) => m.name === measName);
                const key = def?.label || def?.name || measName;
                const raw = firstRow[key];
                if (typeof raw === 'number') return raw;
                if (raw != null) {
                  const parsed = parseFloat(String(raw));
                  if (!isNaN(parsed)) return parsed;
                }
                return undefined;
              };
              const th = extractMeas(w.dataBinding?.gaugeThresholdMeasure);
              if (th !== undefined) newData.threshold = th;
              const mx = extractMeas(w.dataBinding?.gaugeMaxMeasure);
              if (mx !== undefined) newData.maxValue = mx;
            }
          }
        } else if (grpBy.length > 0 && keys.length >= 3) {
          const [axisKey, groupKey] = keys; const valueKey = keys[keys.length - 1];
          const ul = [...new Set(rows.map((r) => String(r[axisKey])))];
          const ug = [...new Set(rows.map((r) => String(r[groupKey])))];
          newData = { labels: ul, series: ug.map((gv) => ({ name: gv, values: ul.map((l) => { const row = rows.find((r) => String(r[axisKey]) === l && String(r[groupKey]) === gv); return row ? Number(row[valueKey]) || 0 : 0; }) })) };
        } else {
          newData = { labels: rows.map((r) => String(r[keys[0]])), values: rows.map((r) => Number(r[keys[keys.length - 1]]) || 0) };
        }
        const mf = {};
        meass.forEach((mn) => { const md = (model.measures || []).find((x) => x.name === mn); if (md?.format) mf[md.label || md.name] = md.format; });
        newData._measureFormats = mf;
        if (dims.length > 0) newData._dimName = dims[0];
        newData._rowCount = rows.length;
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data: newData } }));
      }).catch(() => {
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false } }));
      });
    });
  }, [reportFilters, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset refreshing after re-render (simple approach — fetch is async, but UI feedback is fine)
  useEffect(() => {
    if (refreshing) {
      const t = setTimeout(() => setRefreshing(false), 800);
      return () => clearTimeout(t);
    }
  }, [refreshing, refreshCounter]);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshCounter((n) => n + 1);
  }, [refreshing]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Export PDF
  const exportPDF = async () => {
    setExportMenuOpen(false);
    const el = canvasRef.current;
    if (!el) return;
    // Temporarily remove scale transform for accurate capture
    const origTransform = el.style.transform;
    el.style.transform = 'none';
    const pw = report.settings?.pageWidth || 1140;
    const ph = report.settings?.pageHeight || 800;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null, width: pw, height: ph });
    el.style.transform = origTransform;
    const imgData = canvas.toDataURL('image/png');
    const orientation = pw > ph ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [pw, ph] });
    pdf.addImage(imgData, 'PNG', 0, 0, pw, ph);
    pdf.save(`${report.title || 'report'}.pdf`);
  };

  // Export PNG
  const exportPNG = async () => {
    setExportMenuOpen(false);
    const el = canvasRef.current;
    if (!el) return;
    const origTransform = el.style.transform;
    el.style.transform = 'none';
    const pw = report.settings?.pageWidth || 1140;
    const ph = report.settings?.pageHeight || 800;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null, width: pw, height: ph });
    el.style.transform = origTransform;
    canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${report.title || 'report'}.png`);
    });
  };

  // Export CSV — all widget data
  const exportCSV = () => {
    setExportMenuOpen(false);
    const wb = XLSX.utils.book_new();
    let sheetCount = 0;

    Object.entries(widgets).forEach(([wId, w]) => {
      if (!w.data) return;
      let sheetData = [];
      const name = w.config?.title || w.type || `Widget ${sheetCount + 1}`;

      if (w.data.columns && w.data.rows) {
        // Table
        sheetData = [w.data.columns, ...w.data.rows];
      } else if (w.data.labels && w.data.values) {
        // Bar/Line
        sheetData = [['Label', 'Value'], ...w.data.labels.map((l, i) => [l, w.data.values[i]])];
      } else if (w.data.labels && w.data.series) {
        // Multi-series
        const headers = ['Label', ...w.data.series.map((s) => s.name)];
        sheetData = [headers, ...w.data.labels.map((l, i) => [l, ...w.data.series.map((s) => s.values[i])])];
      } else if (w.data.items) {
        // Pie
        sheetData = [['Name', 'Value'], ...w.data.items.map((it) => [it.name, it.value])];
      } else if (w.data.rawRows) {
        // Pivot raw data
        const keys = Object.keys(w.data.rawRows[0] || {});
        sheetData = [keys, ...w.data.rawRows.map((r) => keys.map((k) => r[k]))];
      } else {
        return;
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31));
      sheetCount++;
    });

    if (sheetCount > 0) {
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      saveAs(new Blob([buf]), `${report.title || 'report'}.xlsx`);
    }
  };

  // Print
  const handlePrint = () => {
    setExportMenuOpen(false);
    window.print();
  };

  if (error) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  }
  if (!report) {
    return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f5f9' }}>
      {/* Viewer toolbar — compact */}
      <header className="no-print" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0',
        flexShrink: 0,
      }}>
        <img src="/favicon.svg" alt="Open Report" style={{ height: 22 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{report.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={handleRefresh} disabled={refreshing} style={{ ...toolBtnSmall, opacity: refreshing ? 0.5 : 1, cursor: refreshing ? 'not-allowed' : 'pointer' }} title="Refresh all widgets">
            <TbRefresh size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : undefined }} />
          </button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setExportMenuOpen(!exportMenuOpen)} style={toolBtnSmall} title="Export">
              <TbDownload size={14} />
            </button>
            {exportMenuOpen && (
              <div style={dropdownStyle}>
                <button onClick={exportPDF} style={dropdownItem}><TbFileTypePdf size={16} style={{ marginRight: 6 }} />Export PDF</button>
                <button onClick={exportPNG} style={dropdownItem}><TbPhoto size={16} style={{ marginRight: 6 }} />Export PNG</button>
                <button onClick={exportCSV} style={dropdownItem}><TbTableExport size={16} style={{ marginRight: 6 }} />Export Excel</button>
                <button onClick={handlePrint} style={dropdownItem}><TbPrinter size={16} style={{ marginRight: 6 }} />Print</button>
              </div>
            )}
          </div>
          <button onClick={toggleFullscreen} style={toolBtnSmall} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <TbMinimize size={14} /> : <TbMaximize size={14} />}
          </button>
        </div>
      </header>

      {/* Report area with sidebar navigation */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Page sidebar (only if multi-page) */}
        {pages.length > 1 && (
          <nav className="no-print" style={{
            width: 160, flexShrink: 0, backgroundColor: '#fff', borderRight: '1px solid #e2e8f0',
            overflowY: 'auto', padding: '8px 0',
          }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', padding: '4px 12px 8px', letterSpacing: '0.05em' }}>Pages</div>
            {pages.map((page, idx) => (
              <button key={page.id}
                onClick={() => {
                  pageStateRef.current[currentPageIdx] = { widgets, reportFilters, slicerSelections, crossHighlight };
                  const saved = pageStateRef.current[idx];
                  setCurrentPageIdx(idx);
                  if (saved) {
                    skipNextRefetch.current = true;
                    setWidgets(saved.widgets);
                    setReportFilters(saved.reportFilters);
                    setSlicerSelections(saved.slicerSelections || {});
                    setCrossHighlight(saved.crossHighlight);
                  } else {
                    skipNextRefetch.current = true;
                    setWidgets(page.widgets || {});
                    setReportFilters({});
                    setSlicerSelections({});
                    setCrossHighlight(null);
                  }
                }}
                style={{
                  display: 'block', width: '100%', padding: '8px 12px', border: 'none',
                  textAlign: 'left', cursor: 'pointer', fontSize: 12,
                  backgroundColor: idx === currentPageIdx ? '#f5f3ff' : 'transparent',
                  color: idx === currentPageIdx ? '#7c3aed' : '#475569',
                  fontWeight: idx === currentPageIdx ? 600 : 400,
                  borderLeft: idx === currentPageIdx ? '3px solid #7c3aed' : '3px solid transparent',
                }}
              >{page.name}</button>
            ))}
          </nav>
        )}

        {/* Report canvas */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <ReportCanvas
            layout={pages[currentPageIdx]?.layout || report.layout}
            widgets={widgets}
            readOnly
            settings={report.settings}
            reportFilters={slicerSelections}
            onSlicerFilter={handleSlicerFilter}
            onCrossFilter={handleCrossFilter}
            crossHighlight={crossHighlight}
            reportRef={canvasRef}
          />
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
        }
      `}</style>
    </div>
  );
}

const toolbarStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 20px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0',
  flexShrink: 0,
};

const toolBtn = {
  padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
  background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
  color: '#475569',
};

const toolBtnSmall = {
  padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4,
  background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
  color: '#64748b', fontSize: 12,
};

const dropdownStyle = {
  position: 'absolute', top: '100%', right: 0, marginTop: 4,
  backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20, minWidth: 160,
  overflow: 'hidden',
};

const dropdownItem = {
  display: 'flex', alignItems: 'center', width: '100%', padding: '8px 14px',
  border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
  color: '#334155', textAlign: 'left',
};
