import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import api from '../utils/api';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { TbDownload, TbFileTypePdf, TbPhoto, TbTableExport, TbMaximize, TbMinimize, TbPrinter } from 'react-icons/tb';

export default function Viewer() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [widgets, setWidgets] = useState({});
  const [reportFilters, setReportFilters] = useState({});
  const [crossHighlight, setCrossHighlight] = useState(null);
  const crossHighlightRef = useRef(null);
  crossHighlightRef.current = crossHighlight;
  const crossFilterSourceRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const canvasRef = useRef(null);

  // Load report + model
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        setReport(r);
        setWidgets(r.widgets || {});

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
    setReportFilters((prev) => {
      const next = { ...prev };
      if (!selectedValues || selectedValues.length === 0) {
        delete next[dimensionName];
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
      setReportFilters((p) => { const n = { ...p }; delete n[dimensionName]; return n; });
    } else {
      crossFilterSourceRef.current = sourceWidgetId;
      setCrossHighlight({ widgetId: sourceWidgetId, value });
      setReportFilters((p) => ({ ...p, [dimensionName]: [value] }));
    }
  }, []);

  // Refetch when filters change
  const prevFiltersJson = useRef('{}');
  useEffect(() => {
    const json = JSON.stringify(reportFilters || {});
    if (json === prevFiltersJson.current) return;
    prevFiltersJson.current = json;
    if (!model) return;

    const sourceId = crossFilterSourceRef.current;
    crossFilterSourceRef.current = null;

    Object.entries(widgets).forEach(([wId, w]) => {
      if (!w || w.type === 'filter' || w.type === 'text') return;
      if (wId === sourceId) return;
      const binding = w.dataBinding || {};
      const dims = binding.selectedDimensions || [];
      const meass = binding.selectedMeasures || [];
      const grpBy = binding.groupBy || [];
      const colDimsB = binding.columnDimensions || [];
      if (dims.length === 0 && meass.length === 0) return;

      const allDims = [...dims, ...grpBy.filter((g) => !dims.includes(g)), ...colDimsB.filter((g) => !dims.includes(g) && !grpBy.includes(g))];

      api.post(`/models/${model.id}/query`, {
        dimensionNames: allDims, measureNames: meass,
        limit: w.config?.dataLimit || 1000, filters: reportFilters,
      }).then((res) => {
        const rows = res.data?.rows;
        if (!rows || rows.length === 0) return;
        let newData = {};
        const keys = Object.keys(rows[0]);
        if (w.type === 'pivotTable') {
          const rowDimNames = dims.filter((d) => !colDimsB.includes(d));
          newData = { rawRows: rows,
            _rowDims: rowDimNames.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
            _colDims: colDimsB.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
            _measures: meass.map((m) => { const def = (model.measures || []).find((x) => x.name === m); return def?.label || def?.name || m; }),
          };
        } else if (w.type === 'table') {
          newData = { columns: keys, rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')) };
        } else if (w.type === 'pie') {
          newData = { items: rows.map((r) => ({ name: String(r[keys[0]]), value: Number(r[keys[keys.length - 1]]) || 0 })) };
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
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], data: newData } }));
      }).catch(() => {});
    });
  }, [reportFilters]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null });
    const imgData = canvas.toDataURL('image/png');
    const pw = report.settings?.pageWidth || 1140;
    const ph = report.settings?.pageHeight || 800;
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
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null });
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
      {/* Viewer toolbar */}
      <header style={toolbarStyle} className="no-print">
        <h1 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>
          {report.title}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Export dropdown */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setExportMenuOpen(!exportMenuOpen)} style={toolBtn} title="Export">
              <TbDownload size={18} />
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
          <button onClick={toggleFullscreen} style={toolBtn} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <TbMinimize size={18} /> : <TbMaximize size={18} />}
          </button>
        </div>
      </header>

      {/* Report canvas */}
      <div ref={canvasRef} style={{ flex: 1, minHeight: 0 }}>
        <ReportCanvas
          layout={report.layout}
          widgets={widgets}
          readOnly
          settings={report.settings}
          onSlicerFilter={handleSlicerFilter}
          onCrossFilter={handleCrossFilter}
          crossHighlight={crossHighlight}
        />
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
