import { useEffect, useRef, useState } from 'react';
import {
  TbX, TbCheck, TbAlertTriangle, TbLoader2, TbAdjustmentsHorizontal, TbChevronDown, TbChevronUp,
} from 'react-icons/tb';
import ImportOptions, { DEFAULT_IMPORT_OPTIONS } from '../ImportOptions/ImportOptions';
import { fileKey, typeOf, optionsKind } from '../../utils/importFiles';
import { readSheetNames } from '../../utils/readSheetNames';
import { formatBytes } from '../../utils/formatHuman';

const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 };
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-panel-alt)', border: '1px solid var(--border-default)', color: 'var(--text-primary)',
};
const typeIcon = { width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const nameBox = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' };
const nameStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 };
const metaStyle = { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const changedStyle = { color: 'var(--accent-primary)', fontWeight: 500 };
const rowErrorStyle = { fontSize: 12, color: 'var(--state-danger)', padding: '2px 10px 0 50px' };
const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex', borderRadius: 6 };
const optionsBtn = (open) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  border: `1px solid ${open ? 'var(--accent-primary)' : 'var(--border-default)'}`,
  background: open ? 'var(--accent-primary-soft)' : 'var(--bg-panel)', color: open ? 'var(--accent-primary)' : 'var(--text-secondary)',
});
const optionsBox = { margin: '-2px 0 2px', padding: '2px 12px 10px', borderRadius: '0 0 8px 8px', border: '1px solid var(--border-default)', borderTop: 'none', background: 'var(--bg-panel-alt)' };

const STATUS_ICON = {
  importing: <TbLoader2 size={16} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--accent-primary)' }} />,
  done: <TbCheck size={16} style={{ color: 'var(--state-success)' }} />,
  error: <TbAlertTriangle size={16} style={{ color: 'var(--state-danger)' }} />,
};

// What the user changed on a file, in a few words.
const SEP = { comma: ',', semicolon: ';', tab: 'tab', pipe: '|' };
function summary(kind, o) {
  const parts = [];
  if (kind === 'csv') {
    if (o.delimiter && o.delimiter !== 'auto') parts.push(`separator ${SEP[o.delimiter]}`);
    if (o.decimalSeparator && o.decimalSeparator !== 'auto') parts.push(`decimal ${o.decimalSeparator === 'comma' ? ',' : '.'}`);
    if (o.dateFormat && o.dateFormat !== 'auto') parts.push({ dmy_slash: 'DD/MM/YYYY', mdy_slash: 'MM/DD/YYYY', iso: 'YYYY-MM-DD' }[o.dateFormat]);
    if (o.encoding && o.encoding !== 'auto') parts.push(o.encoding === 'utf8' ? 'UTF-8' : 'Latin-1');
  }
  if (kind === 'excel' && o._sheetNames?.length && (o.sheets?.length || 0) !== o._sheetNames.length) {
    parts.push(`${o.sheets?.length || 0} of ${o._sheetNames.length} sheets`);
  }
  if (o.hasHeader === false) parts.push('no header row');
  if (o.ledger) parts.push('read as a general ledger');
  return parts.join(' · ');
}

function FileRow({ file, status, kind, options, open, onToggle, onRemove, onChange }) {
  const { Icon, color, label } = typeOf(file.name);
  const changed = kind === 'csv' || kind === 'excel' ? summary(kind, options) : '';
  return (
    <li>
      <div style={open ? { ...rowStyle, borderRadius: '8px 8px 0 0' } : rowStyle}>
        <span style={{ ...typeIcon, color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}><Icon size={18} /></span>
        <span style={nameBox}>
          <span style={nameStyle} title={file.name}>{file.name}</span>
          <span style={metaStyle}>
            {label}{file.size ? ` · ${formatBytes(file.size)}` : ''}
            {changed && <> · <span style={changedStyle}>{changed}</span></>}
          </span>
        </span>
        {STATUS_ICON[status?.state] || null}
        {onToggle && (
          <button type="button" className="btn-hover" style={optionsBtn(open)} onClick={onToggle} aria-expanded={open}
            title={`Import options of ${file.name}`}>
            <TbAdjustmentsHorizontal size={14} /> Options {open ? <TbChevronUp size={13} /> : <TbChevronDown size={13} />}
          </button>
        )}
        {onRemove && (
          <button type="button" className="btn-hover" style={iconBtn} onClick={onRemove} aria-label={`Remove ${file.name}`} title="Remove">
            <TbX size={15} />
          </button>
        )}
      </div>
      {open && (
        <div style={optionsBox}>
          <ImportOptions value={options} onChange={onChange} kind={kind} sheetNames={options._sheetNames || []} file={file} />
        </div>
      )}
      {status?.error && <div style={rowErrorStyle}>{status.error}</div>}
    </li>
  );
}

// The files of an import, each with its own options (a CSV's separator, a
// workbook's sheets) behind its Options button. A lone file shows its options
// open: there is nothing else to choose between. `status[i]`: the upload
// state of each file; `onRemove(i)` when a file may leave the list.
export default function ImportFileList({ files, options, status = {}, onRemove, busy }) {
  const [open, setOpen] = useState(() => new Set());
  const single = files.length === 1;
  const reading = useRef(new Set());
  const { setFor } = options;

  // Each workbook's sheets, read once when it is listed: all ticked by default.
  useEffect(() => {
    for (const f of files) {
      const key = fileKey(f);
      if (optionsKind(f) !== 'excel' || reading.current.has(key)) continue;
      reading.current.add(key);
      readSheetNames(f).then((names) => setFor(key, (o) => ({ ...o, sheets: names, _sheetNames: names })));
    }
  }, [files, setFor]);

  return (
    <ul style={listStyle}>
      {files.map((f, i) => {
        const key = fileKey(f);
        const kind = optionsKind(f);
        const hasOptions = kind === 'csv' || kind === 'excel';
        const isOpen = hasOptions && !busy && (single || open.has(key));
        return (
          <FileRow key={key} file={f} status={status[i]} kind={kind} options={options.optionsFor(f)}
            open={isOpen}
            onToggle={hasOptions && !single && !busy ? () => setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; }) : null}
            onRemove={onRemove && !busy && files.length > 1 ? () => onRemove(i) : null}
            onChange={(o) => options.setFor(key, o)} />
        );
      })}
    </ul>
  );
}

// A row for a source already imported (the combine step): no options.
export function SourceRow({ name }) {
  return <FileRow file={{ name, size: 0 }} status={{ state: 'done' }} kind="other" options={DEFAULT_IMPORT_OPTIONS} open={false} />;
}
