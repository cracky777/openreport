// The report definition as a portable file (.openreport.json): layout, widgets,
// settings and pages, designed to round-trip through POST /api/reports/import
// on another account or instance. Downloaded from the Export menu and from a
// report card's menu.
import { saveAs } from 'file-saver';

const EXPORT_FORMAT_VERSION = 'open-report.report.v1';

// Strip per-widget data snapshots — they bypass RLS and aren't portable
// across accounts. The importer re-queries widgets against their own
// model. EXCEPT for text widgets, where `widget.data.text` IS the
// user-authored body (text widgets have no data binding, so there's
// nothing to re-query on import). Stripping it would land every text
// block on the imported report reset to "Double-click to edit".
// Server-side `cleanWidgets` in /reports/import mirrors this so a
// bundle exported elsewhere still preserves the text on import.
function stripWidgetData(map) {
  if (!map || typeof map !== 'object') return map;
  const out = {};
  for (const [id, w] of Object.entries(map)) {
    if (w && typeof w === 'object') {
      const { data: _d, ...rest } = w;
      if (w.type === 'text' && _d && typeof _d.text === 'string') {
        out[id] = { ...rest, data: Array.isArray(_d.runs) ? { text: _d.text, runs: _d.runs } : { text: _d.text } };
      } else {
        out[id] = rest;
      }
    } else {
      out[id] = w;
    }
  }
  return out;
}

// Inline any locally-uploaded image (URL starts with `/uploads/images/`)
// as a base64 data: URL so the JSON bundle is portable. Without this,
// exporting an OSS report with an uploaded image and re-importing it
// (cloud, another OSS instance, etc.) would silently break the image —
// the URL would point to a path that doesn't exist on the new host.
// External URLs (https://…) and data: URLs are left untouched.
async function embedLocalImages(widgets) {
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
}

// `report` is the shape GET /api/reports/:id answers (widgets, pages parsed).
export async function downloadReportBundle(report) {
  const [cleanedPages, cleanedWidgets] = await Promise.all([
    Array.isArray(report.pages)
      ? Promise.all(report.pages.map(async (p) => ({
          ...p,
          widgets: await embedLocalImages(stripWidgetData(p.widgets)),
        })))
      : Promise.resolve(null),
    embedLocalImages(stripWidgetData(report.widgets || {})),
  ]);
  const bundle = {
    format: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    report: {
      title: report.title,
      model_id: report.model_id || null,
      model_name: report.model_name || null,
      layout: report.layout || [],
      widgets: cleanedWidgets,
      settings: report.settings || {},
      pages: cleanedPages,
    },
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const safeName = (report.title || 'report').replace(/[^\w.-]+/g, '-');
  saveAs(blob, `${safeName}.openreport.json`);
}
