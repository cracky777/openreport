import { useEffect, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { TbDots, TbPhoto, TbFileTypeCsv, TbTableExport } from 'react-icons/tb';
import WidgetPreview from '../AiPanel/WidgetPreview';
import { sheetOf, toCsv, fileNameOf } from '../../utils/visualExport';
import { toast } from '../Toast/toast';

// One visual of a Let's Talk answer with its export menu: three dots at the top
// right, shown while the visual is hovered, as Power BI does (Jonathan: no
// button beside "Add to report"). Each visual exports itself — an answer with
// four visuals gives four menus, never one file of four shapes.

const wrapStyle = { position: 'relative' };
const dotsBtn = (shown) => ({
  position: 'absolute', top: 6, right: 6, zIndex: 2,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 22, padding: 0,
  border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  boxShadow: '0 1px 2px rgba(15,23,42,0.10)',
  opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', transition: 'opacity 0.12s',
});
const menuStyle = {
  position: 'absolute', top: 32, right: 6, zIndex: 3, minWidth: 170, padding: '4px 0',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
};
const itemStyle = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px',
  border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5,
  color: 'var(--text-secondary)', textAlign: 'left',
};
const hoverOn = (e) => { e.currentTarget.style.background = 'var(--bg-hover)'; };
const hoverOff = (e) => { e.currentTarget.style.background = 'transparent'; };

export default function ExportableVisual({ widget, model, settings, height, asTable }) {
  const wrapRef = useRef(null);
  const [data, setData] = useState(null);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const name = fileNameOf(widget.config?.title);
  const sheet = sheetOf(data, widget.config?.xAxisTitle);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const exportPng = async () => {
    setOpen(false);
    const box = wrapRef.current?.querySelector('[aria-label="Visual preview"]');
    if (!box) return;
    try {
      // The card's own background, never transparent: a dark theme's white
      // text on a transparent PNG disappears in every image viewer.
      const canvas = await html2canvas(box, { scale: 2, backgroundColor: getComputedStyle(box).backgroundColor, logging: false });
      canvas.toBlob((blob) => { if (blob) saveAs(blob, `${name}.png`); });
    } catch {
      toast('The image could not be made');
    }
  };
  const exportCsv = () => {
    setOpen(false);
    saveAs(new Blob([toCsv(sheet)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
  };
  const exportExcel = () => {
    setOpen(false);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), name.slice(0, 31));
    saveAs(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]), `${name}.xlsx`);
  };

  return (
    <div ref={wrapRef} style={wrapStyle} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <WidgetPreview widget={widget} asTable={asTable} model={model} settings={settings} height={height} onData={setData} />
      <button style={dotsBtn(hovered || open)} onClick={() => setOpen((o) => !o)} title="More options" aria-label="More options" aria-expanded={open}>
        <TbDots size={15} />
      </button>
      {open && (
        <div style={menuStyle} role="menu">
          <button role="menuitem" style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={exportPng}><TbPhoto size={15} /> Export PNG</button>
          {sheet && (
            <>
              <button role="menuitem" style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={exportCsv}><TbFileTypeCsv size={15} /> Export CSV</button>
              <button role="menuitem" style={itemStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff} onClick={exportExcel}><TbTableExport size={15} /> Export Excel</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
