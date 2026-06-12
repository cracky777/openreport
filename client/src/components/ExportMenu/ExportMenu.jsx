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
import { createPortal } from 'react-dom';
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
  pages,             // optional: array of pages for multi-page PDF export
  currentPageIdx,    // optional: idx of the currently-displayed page (preserved across the capture loop)
  onSwitchPage,      // optional: (idx) => void — navigates the editor to page idx
}) {
  const [open, setOpen] = useState(false);
  // Multi-page PDF progress overlay. While running, the body-portalled
  // backdrop covers the editor canvas so the user doesn't see the page
  // transitions; we only show "Exporting page X of N". `exporting` is
  // truthy while the loop is active.
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const wrapRef = useRef(null);

  // The multi-page export loop calls `onSwitchPage(i)` then yields to React
  // for a render+paint. Editor's switchPage is a `useCallback` keyed on its
  // own `currentPageIdx`, so each render gives us a NEW reference — and the
  // old one short-circuits its own `if (idx === currentPageIdx) return` on
  // a stale closure. Holding the latest reference in a ref guarantees the
  // next iteration calls the rebuilt callback, which reads the freshly-
  // committed currentPageIdx and actually performs the switch.
  const onSwitchPageRef = useRef(onSwitchPage);
  onSwitchPageRef.current = onSwitchPage;
  const currentPageIdxRef = useRef(currentPageIdx);
  currentPageIdxRef.current = currentPageIdx;
  // Latest widgets map for the page currently displayed — used by the
  // chart-readiness wait inside the multi-page loop.
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Two-frame yield: schedule a task that fires after the browser has painted
  // the latest React commit. Single rAF would still run BEFORE the paint that
  // contains the just-rendered DOM; the second rAF lands AFTER. Used between
  // page switches so html2canvas snapshots the new page, not a stale layout.
  const waitForRepaint = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // html2canvas's biggest known limitation is `object-fit` on <img> — it
  // stretches the image to fill 100%×100% of its parent, ignoring `contain`
  // / `cover`. The widget renders images as `<img style="object-fit:fit">`,
  // so the PNG export comes out squashed.
  //
  // Prior approach was to swap <img> for a <div> with `background-image` +
  // `background-size` (which html2canvas DOES respect aspect-ratio-wise),
  // but html2canvas rasterises a backgrounded element at the element's
  // box size — so the image was effectively re-sampled DOWN to that box,
  // and then jsPDF scaled the canvas back up to the PDF page, producing
  // a clearly pixelated result.
  //
  // Fix: keep <img> (html2canvas natively rasterises images at their full
  // source resolution * the configured scale), but wrap it in a clipping
  // wrapper and resize the img to its ACTUAL displayed dimensions —
  // computed from `objectFit` against the natural width/height. After the
  // wrap, the <img> is `object-fit:fill` over its own size, so html2canvas
  // doesn't have to honour object-fit at all and the resulting bitmap is
  // sampled from the source image, not a tiny box. We read measurements
  // off the LIVE <img> (it's loaded, has naturalWidth, has a layout)
  // because the cloned tree at `onclone` time may have neither.
  const fixImageObjectFit = (clonedRoot, liveRoot) => {
    if (!liveRoot) return;
    const liveImgs = liveRoot.querySelectorAll('img');
    const clonedImgs = clonedRoot.querySelectorAll('img');
    clonedImgs.forEach((clonedImg, i) => {
      const liveImg = liveImgs[i];
      if (!liveImg) return;
      const cs = liveImg.ownerDocument.defaultView?.getComputedStyle(liveImg) || {};
      const fit = cs.objectFit || 'fill';
      if (fit === 'fill') return;
      const containerW = liveImg.offsetWidth;
      const containerH = liveImg.offsetHeight;
      const naturalW = liveImg.naturalWidth;
      const naturalH = liveImg.naturalHeight;
      if (!naturalW || !naturalH || !containerW || !containerH) return;
      const naturalRatio = naturalW / naturalH;
      const containerRatio = containerW / containerH;
      let rW; let rH;
      if (fit === 'contain') {
        if (naturalRatio > containerRatio) { rW = containerW; rH = containerW / naturalRatio; }
        else { rH = containerH; rW = containerH * naturalRatio; }
      } else if (fit === 'cover') {
        if (naturalRatio > containerRatio) { rH = containerH; rW = containerH * naturalRatio; }
        else { rW = containerW; rH = containerW / naturalRatio; }
      } else {
        // 'none' / 'scale-down' — leave as-is rather than risk a wrong fix.
        return;
      }
      const doc = clonedImg.ownerDocument;
      const wrapper = doc.createElement('div');
      // Mirror the original box so layout stays identical, but clip
      // anything that overflows (cover can push beyond the container).
      wrapper.style.cssText = clonedImg.getAttribute('style') || '';
      wrapper.style.position = wrapper.style.position || 'relative';
      wrapper.style.overflow = 'hidden';
      wrapper.style.display = 'block';
      // Centre the resized <img> inside the wrapper. fill+explicit-size
      // means html2canvas just renders the source at (rW × rH * scale).
      clonedImg.style.position = 'absolute';
      clonedImg.style.width = `${rW}px`;
      clonedImg.style.height = `${rH}px`;
      clonedImg.style.left = `${(containerW - rW) / 2}px`;
      clonedImg.style.top = `${(containerH - rH) / 2}px`;
      clonedImg.style.objectFit = 'fill';
      clonedImg.style.maxWidth = 'none';
      clonedImg.style.maxHeight = 'none';
      const parent = clonedImg.parentNode;
      if (!parent) return;
      parent.replaceChild(wrapper, clonedImg);
      wrapper.appendChild(clonedImg);
    });
  };

  // Wait until no widget on the current page is `_loading`. Chart widgets
  // re-fetch when their page becomes active (the editor's main fetch effect
  // fires on page switch), so a snapshot taken immediately after the page
  // transition catches blank canvases. We poll the widgets map (held in a
  // ref so we read the freshest version on every tick) until none of them
  // are loading, plus a short post-settle delay so echarts has time to
  // paint into its canvas. A timeout caps the wait so a stuck widget never
  // hangs the export.
  const waitForWidgetsReady = async (timeoutMs = 20000) => {
    // Editor's main fetch effect debounces 150ms after a page switch, so
    // checking `_loading` immediately can read false (nothing loading
    // yet — the fetches haven't even started). A 300ms primer covers that
    // debounce window so the poll below sees the real `_loading=true`.
    await new Promise((r) => setTimeout(r, 300));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ws = widgetsRef.current || {};
      const stillLoading = Object.values(ws).some((w) => w && w._loading);
      if (!stillLoading) {
        // echarts defaults to a ~1000ms enter animation; capturing earlier
        // gets a partially-painted chart (the user reported "a slice
        // missing"). 1500ms covers the typical animation budget plus a
        // small safety margin for the final paint commit.
        await new Promise((r) => setTimeout(r, 1500));
        return;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  };

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
      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, backgroundColor: null,
        width: pw, height: ph,
        onclone: (clonedDoc, clonedRoot) => {
          // `clonedRoot` is the deep clone of `el`; safe to mutate.
          // We pass the live `el` too so we can read computed styles +
          // naturalWidth/Height that the clone doesn't expose yet.
          try { fixImageObjectFit(clonedRoot, el); } catch { /* best-effort */ }
        },
      });
      return { canvas, pw, ph };
    } finally {
      el.style.transform = origTransform;
      if (onAfterCapture) onAfterCapture();
    }
  };

  const exportPDF = async () => {
    setOpen(false);
    // Multi-page when the parent passed `pages` + `onSwitchPage`. We loop
    // through every page, switch the editor to it, wait for React to commit
    // AND the browser to paint, snapshot, append. Single-page path is the
    // fall-through for callers that didn't wire navigation in (e.g. the
    // Viewer's compact toolbar, or any report with one page) — same as
    // before, no behaviour change there.
    const hasMultiPage = Array.isArray(pages) && pages.length > 1
      && typeof onSwitchPage === 'function' && typeof currentPageIdx === 'number';
    if (!hasMultiPage) {
      const cap = await captureCanvas();
      if (!cap) return;
      const imgData = cap.canvas.toDataURL('image/png');
      const orientation = cap.pw > cap.ph ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation, unit: 'px', format: [cap.pw, cap.ph] });
      pdf.addImage(imgData, 'PNG', 0, 0, cap.pw, cap.ph);
      pdf.save(`${report?.title || 'report'}.pdf`);
      return;
    }
    const originalIdx = currentPageIdxRef.current;
    let pdf = null;
    setExporting(true);
    setExportProgress({ current: 0, total: pages.length });
    try {
      for (let i = 0; i < pages.length; i++) {
        setExportProgress({ current: i + 1, total: pages.length });
        if (i !== currentPageIdxRef.current) {
          onSwitchPageRef.current(i);
          // Two paints: one to flush the React re-render, one for the new
          // layout. Without both, the snapshot can capture the previous page.
          await waitForRepaint();
          await waitForRepaint();
        }
        // Page-switch kicks the main fetch effect; without waiting here the
        // capture lands a blank canvas for any chart whose query is still
        // in flight. Polls widget _loading flags + a short settle window.
        await waitForWidgetsReady();
        const cap = await captureCanvas();
        if (!cap) continue;
        const imgData = cap.canvas.toDataURL('image/png');
        const orientation = cap.pw > cap.ph ? 'landscape' : 'portrait';
        if (!pdf) {
          pdf = new jsPDF({ orientation, unit: 'px', format: [cap.pw, cap.ph] });
        } else {
          pdf.addPage([cap.pw, cap.ph], orientation);
        }
        pdf.addImage(imgData, 'PNG', 0, 0, cap.pw, cap.ph);
      }
      if (pdf) pdf.save(`${report?.title || 'report'}.pdf`);
    } finally {
      // Restore the page the user was on before the export started — switching
      // mid-loop is invisible to them only if we land back where they started.
      if (typeof originalIdx === 'number' && originalIdx !== currentPageIdxRef.current) {
        onSwitchPageRef.current(originalIdx);
      }
      setExporting(false);
      setExportProgress({ current: 0, total: 0 });
    }
  };

  const exportPNG = async () => {
    setOpen(false);
    const cap = await captureCanvas();
    if (!cap) return;
    cap.canvas.toBlob((blob) => {
      if (blob) saveAs(blob, `${report?.title || 'report'}.png`);
    });
  };

  // Materialise one Excel sheet per widget that has tabular-like data.
  // Pulled out of the iteration loop so the multi-page Excel path can
  // reuse it without duplicating the shape-matching branches.
  const appendWidgetSheet = (wb, w, sheetCount, pagePrefix) => {
    if (!w?.data) return 0;
    let sheetData = [];
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
      return 0;
    }
    // Excel sheet-name cap is 31 chars; add a `<page> · ` prefix when we
    // have multiple pages so a user with 'Sales' on both pages 1 and 2
    // doesn't collide on a single 'Sales' sheet.
    const baseName = w.config?.title || w.type || `Widget ${sheetCount + 1}`;
    const finalName = (pagePrefix ? `${pagePrefix} · ${baseName}` : baseName).substring(0, 31);
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, finalName);
    return 1;
  };

  const exportExcel = async () => {
    setOpen(false);
    const wb = XLSX.utils.book_new();
    let sheetCount = 0;
    const hasMultiPage = Array.isArray(pages) && pages.length > 1
      && typeof onSwitchPage === 'function' && typeof currentPageIdx === 'number';
    if (!hasMultiPage) {
      Object.values(widgets || {}).forEach((w) => {
        sheetCount += appendWidgetSheet(wb, w, sheetCount, null);
      });
    } else {
      // Same loop shape as the PDF export: switch, settle, drain in-flight
      // queries before reading the widgets map for that page. Without the
      // wait, pages the user never visited would land with `data: undefined`
      // and contribute zero sheets.
      const originalIdx = currentPageIdxRef.current;
      setExporting(true);
      setExportProgress({ current: 0, total: pages.length });
      try {
        for (let i = 0; i < pages.length; i++) {
          setExportProgress({ current: i + 1, total: pages.length });
          if (i !== currentPageIdxRef.current) {
            onSwitchPageRef.current(i);
            await waitForRepaint();
            await waitForRepaint();
          }
          await waitForWidgetsReady();
          const pageName = pages[i]?.name || `Page ${i + 1}`;
          const wsMap = widgetsRef.current || {};
          Object.values(wsMap).forEach((w) => {
            sheetCount += appendWidgetSheet(wb, w, sheetCount, pageName);
          });
        }
      } finally {
        if (typeof originalIdx === 'number' && originalIdx !== currentPageIdxRef.current) {
          onSwitchPageRef.current(originalIdx);
        }
        setExporting(false);
        setExportProgress({ current: 0, total: 0 });
      }
    }
    if (sheetCount > 0) {
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      saveAs(new Blob([buf]), `${report?.title || 'report'}.xlsx`);
    }
  };

  // Strip per-widget data snapshots — they bypass RLS and aren't portable
  // across accounts. The importer re-queries widgets against their own
  // model. EXCEPT for text widgets, where `widget.data.text` IS the
  // user-authored body (text widgets have no data binding, so there's
  // nothing to re-query on import). Stripping it would land every text
  // block on the imported report reset to "Double-click to edit".
  // Server-side `cleanWidgets` in /reports/import mirrors this so a
  // bundle exported elsewhere still preserves the text on import.
  const stripWidgetData = (map) => {
    if (!map || typeof map !== 'object') return map;
    const out = {};
    for (const [id, w] of Object.entries(map)) {
      if (w && typeof w === 'object') {
        const { data: _d, ...rest } = w;
        if (w.type === 'text' && _d && typeof _d.text === 'string') {
          out[id] = { ...rest, data: { text: _d.text } };
        } else {
          out[id] = rest;
        }
      } else {
        out[id] = w;
      }
    }
    return out;
  };

  // Inline any locally-uploaded image (URL starts with `/uploads/images/`)
  // as a base64 data: URL so the JSON bundle is portable. Without this,
  // exporting an OSS report with an uploaded image and re-importing it
  // (cloud, another OSS instance, etc.) would silently break the image —
  // the URL would point to a path that doesn't exist on the new host.
  // External URLs (https://…) and data: URLs are left untouched.
  const embedLocalImages = async (widgets) => {
    if (!widgets || typeof widgets !== 'object') return widgets;
    const out = {};
    for (const [id, w] of Object.entries(widgets)) {
      const url = w?.config?.url;
      if (w?.type === 'image' && typeof url === 'string' && url.startsWith('/uploads/images/')) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
          });
          out[id] = { ...w, config: { ...w.config, url: dataUrl } };
        } catch (e) {
          // Image not reachable: leave the original URL. Importing into
          // a different host will show the empty-state placeholder.
          console.warn(`Failed to embed image ${url}: ${e.message}`);
          out[id] = w;
        }
      } else {
        out[id] = w;
      }
    }
    return out;
  };

  const exportRawJSON = async () => {
    setOpen(false);
    if (!report) return;
    const cleanedPages = Array.isArray(report.pages)
      ? await Promise.all(report.pages.map(async (p) => ({
          ...p,
          widgets: await embedLocalImages(stripWidgetData(p.widgets)),
        })))
      : null;
    const bundle = {
      format: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      report: {
        title: report.title,
        model_id: report.model_id || null,
        model_name: report.model_name || null,
        layout: report.layout || [],
        widgets: await embedLocalImages(stripWidgetData(report.widgets || {})),
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
      {/* Multi-page PDF export overlay. Portalled to <body> so it sits
          ABOVE the report canvas — the user sees a static "Exporting…"
          panel instead of the rapid page transitions the loop triggers
          underneath. Since the overlay isn't inside `canvasRef.current`,
          html2canvas never sees it in the captured DOM. */}
      {exporting && createPortal(
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.78)',
          backdropFilter: 'blur(4px)',
          zIndex: 100000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-panel)', padding: '20px 28px', borderRadius: 10,
            boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
            minWidth: 280, textAlign: 'center',
            color: 'var(--text-primary)',
          }}>
            <div style={{
              width: 28, height: 28, margin: '0 auto 12px',
              border: '3px solid var(--border-default)',
              borderTopColor: 'var(--accent-primary)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              Exporting PDF…
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Page {exportProgress.current} of {exportProgress.total}
            </div>
          </div>
        </div>,
        document.body
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
