/**
 * Reusable Export menu — used in the Viewer (preview / public link) and the
 * Editor (while editing). Five formats:
 *   - PDF  (canvas → image → jsPDF, sized from settings.pageWidth/pageHeight)
 *   - PNG  (canvas → blob)
 *   - Excel (per-widget sheets, picks data shape per widget type)
 *   - Print (window.print())
 *   - JSON raw — the report definition (layout/widgets/settings/pages/model_id),
 *     designed to round-trip through POST /api/reports/import on another account.
 *
 * The PDF/PNG paths capture the actual on-screen canvas via html2canvas. In
 * the Editor, the canvas is decorated with selection handles, drag zones,
 * etc. Caller is responsible for hiding those before triggering the export
 * (see `onBeforeCapture` / `onAfterCapture` props).
 */

import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { TbDownload, TbFileTypePdf, TbPhoto, TbTableExport, TbPrinter, TbBraces } from 'react-icons/tb';

const EXPORT_FORMAT_VERSION = 'open-report.report.v1';

export default function ExportMenu({
  report,            // full report object (title, layout, widgets, settings, pages, model_id, ...)
  widgets,           // live widgets map (with .data baked in for charts/tables)
  canvasRef,         // ref to the DOM node to rasterize for PDF/PNG
  onBeforeCapture,   // optional () => Promise|void — hide editor chrome before capture
  onAfterCapture,    // optional () => void — restore chrome
  buttonStyle,       // optional override for the trigger button
  variant,           // 'toolbar' uses the editor toolbar's utilityIconBtn look (transparent, 18px icon, hover lift). Default = compact bordered.
  align = 'right',   // 'right' | 'left' — dropdown alignment
  allowRawExport = false, // expose the JSON-bundle export. Editor sets true; Viewer / public links don't.
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const captureCanvas = async () => {
    const el = canvasRef?.current;
    if (!el) return null;
    if (onBeforeCapture) await onBeforeCapture();
    // The Editor scales the canvas to fit its viewport. Snapshot it at native
    // size by removing the transform during capture.
    const origTransform = el.style.transform;
    el.style.transform = 'none';
    const pw = report?.settings?.pageWidth || 1140;
    const ph = report?.settings?.pageHeight || 800;
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null, width: pw, height: ph });
      return { canvas, pw, ph };
    } finally {
      el.style.transform = origTransform;
      if (onAfterCapture) onAfterCapture();
    }
  };

  const exportPDF = async () => {
    setOpen(false);
    const cap = await captureCanvas();
    if (!cap) return;
    const imgData = cap.canvas.toDataURL('image/png');
    const orientation = cap.pw > cap.ph ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'px', format: [cap.pw, cap.ph] });
    pdf.addImage(imgData, 'PNG', 0, 0, cap.pw, cap.ph);
    pdf.save(`${report?.title || 'report'}.pdf`);
  };

  const exportPNG = async () => {
    setOpen(false);
    const cap = await captureCanvas();
    if (!cap) return;
    cap.canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${report?.title || 'report'}.png`);
    });
  };

  const exportExcel = () => {
    setOpen(false);
    const wb = XLSX.utils.book_new();
    let sheetCount = 0;
    Object.entries(widgets || {}).forEach(([, w]) => {
      if (!w?.data) return;
      let sheetData = [];
      const name = w.config?.title || w.type || `Widget ${sheetCount + 1}`;
      if (w.data.columns && w.data.rows) {
        sheetData = [w.data.columns, ...w.data.rows];
      } else if (w.data.labels && w.data.values) {
        sheetData = [['Label', 'Value'], ...w.data.labels.map((l, i) => [l, w.data.values[i]])];
      } else if (w.data.labels && w.data.series) {
        const headers = ['Label', ...w.data.series.map((s) => s.name)];
        sheetData = [headers, ...w.data.labels.map((l, i) => [l, ...w.data.series.map((s) => s.values[i])])];
      } else if (w.data.items) {
        sheetData = [['Name', 'Value'], ...w.data.items.map((it) => [it.name, it.value])];
      } else if (w.data.rawRows) {
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
      saveAs(new Blob([buf]), `${report?.title || 'report'}.xlsx`);
    }
  };

  // Strip per-widget data snapshots — they bypass RLS and aren't portable
  // across accounts. The importer re-queries widgets against their own model.
  const stripWidgetData = (map) => {
    if (!map || typeof map !== 'object') return map;
    const out = {};
    for (const [id, w] of Object.entries(map)) {
      if (w && typeof w === 'object') {
        const { data: _d, ...rest } = w;
        out[id] = rest;
      } else {
        out[id] = w;
      }
    }
    return out;
  };

  const exportRawJSON = () => {
    setOpen(false);
    if (!report) return;
    const cleanedPages = Array.isArray(report.pages)
      ? report.pages.map((p) => ({ ...p, widgets: stripWidgetData(p.widgets) }))
      : null;
    const bundle = {
      format: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      report: {
        title: report.title,
        model_id: report.model_id || null,
        model_name: report.model_name || null,
        layout: report.layout || [],
        widgets: stripWidgetData(report.widgets || {}),
        settings: report.settings || {},
        pages: cleanedPages,
      },
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const safeName = (report.title || 'report').replace(/[^\w.-]+/g, '-');
    saveAs(blob, `${safeName}.openreport.json`);
  };

  const handlePrint = () => {
    setOpen(false);
    window.print();
  };

  const isToolbarVariant = variant === 'toolbar';
  const triggerStyle = buttonStyle || (isToolbarVariant ? toolbarBtn : defaultBtn);
  const iconSize = isToolbarVariant ? 18 : 14;
  const iconColor = isToolbarVariant ? 'var(--text-secondary)' : undefined;

  // Toolbar variant matches the surrounding utilityIconBtn pattern: transparent
  // background, hover lifts with bg-panel + shadow + translateY(-1px).
  const onTriggerEnter = (e) => {
    if (!isToolbarVariant) return;
    e.currentTarget.style.background = 'var(--bg-panel)';
    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
    e.currentTarget.style.transform = 'translateY(-1px)';
  };
  const onTriggerLeave = (e) => {
    if (!isToolbarVariant) return;
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.boxShadow = 'none';
    e.currentTarget.style.transform = 'translateY(0)';
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle}
        onMouseEnter={onTriggerEnter}
        onMouseLeave={onTriggerLeave}
        title={isToolbarVariant ? undefined : 'Export'}
      >
        <TbDownload size={iconSize} color={iconColor} />
      </button>
      {open && (
        <div style={{ ...dropdownStyle, [align]: 0 }}>
          <button onClick={exportPDF}    style={dropdownItem} onMouseEnter={hoverItemEnter} onMouseLeave={hoverItemLeave}>
            <TbFileTypePdf size={16} style={iconM} />Export PDF
          </button>
          <button onClick={exportPNG}    style={dropdownItem} onMouseEnter={hoverItemEnter} onMouseLeave={hoverItemLeave}>
            <TbPhoto       size={16} style={iconM} />Export PNG
          </button>
          <button onClick={exportExcel}  style={dropdownItem} onMouseEnter={hoverItemEnter} onMouseLeave={hoverItemLeave}>
            <TbTableExport size={16} style={iconM} />Export Excel
          </button>
          <button onClick={handlePrint}  style={dropdownItem} onMouseEnter={hoverItemEnter} onMouseLeave={hoverItemLeave}>
            <TbPrinter     size={16} style={iconM} />Print
          </button>
          {allowRawExport && (
            <>
              <div style={separator} />
              <button onClick={exportRawJSON} style={dropdownItem} onMouseEnter={hoverItemEnter} onMouseLeave={hoverItemLeave}>
                <TbBraces size={16} style={iconM} />
                <span>
                  Export raw (JSON)
                  <span style={subLabel}>Re-importable into another account</span>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const defaultBtn = {
  padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', cursor: 'pointer', display: 'flex', alignItems: 'center',
  color: 'var(--text-muted)', fontSize: 12,
};

// Mirrors `utilityIconBtn` from Toolbar.jsx so the editor's Refresh / Settings / Export
// row reads as a single visual group.
const toolbarBtn = {
  padding: '6px 8px', border: 'none', borderRadius: 6,
  background: 'transparent', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
  lineHeight: 1,
};

const dropdownStyle = {
  position: 'absolute', top: '100%', marginTop: 4,
  backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20, minWidth: 220,
  overflow: 'hidden',
};

const dropdownItem = {
  display: 'flex', alignItems: 'center', width: '100%', padding: '8px 14px',
  border: 'none', background: 'var(--bg-panel)', cursor: 'pointer', fontSize: 13,
  color: 'var(--text-secondary)', textAlign: 'left',
  transition: 'background 0.12s',
};

// Same hover behaviour as the widget sub-menus in Toolbar.jsx — bg-panel ↔ bg-hover.
const hoverItemEnter = (e) => { e.currentTarget.style.background = 'var(--bg-hover)'; };
const hoverItemLeave = (e) => { e.currentTarget.style.background = 'var(--bg-panel)'; };

const iconM = { marginRight: 8, flexShrink: 0 };

const separator = {
  height: 1, background: 'var(--border-default)', margin: '4px 0',
};

const subLabel = {
  display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 1,
};
