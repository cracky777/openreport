import { useMemo, useState } from 'react';
import { TbArrowsSplit2, TbExternalLink } from 'react-icons/tb';
import { lineageLayout } from '../../utils/lineageLayout';

// Where a field comes from, drawn under the assistant's answer: the path the
// server walked in OpenMetadata (utils/openMetadata/explain.js), never one the
// assistant wrote. Each table is colored by its data layer — bronze, silver,
// gold, read on the catalog or the admin's rules — and a click shows its card
// beside the diagram (below it in a narrow panel): what it holds, the columns
// the path uses, how it is made.

const LAYERS = {
  bronze: { label: 'Bronze', ink: 'var(--layer-bronze)', soft: 'var(--layer-bronze-soft)' },
  silver: { label: 'Silver', ink: 'var(--layer-silver)', soft: 'var(--layer-silver-soft)' },
  gold: { label: 'Gold', ink: 'var(--layer-gold)', soft: 'var(--layer-gold-soft)' },
};
const NONE = { label: 'No layer', ink: 'var(--text-muted)', soft: 'var(--bg-subtle)', dashed: true };
const FIELD = { ink: 'var(--accent-primary)', soft: 'var(--accent-primary-soft)' };

const lookOf = (n) => (n.kind === 'field' ? FIELD : LAYERS[n.layer] || NONE);
// About 6.6 px a character at the sizes drawn: enough to keep text in its box.
const fit = (s, px) => {
  const max = Math.floor(px / 6.6);
  const v = String(s || '');
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

export default function LineageCard({ lineage }) {
  const layout = useMemo(() => lineageLayout(lineage), [lineage]);
  const field = layout.nodes.find((n) => n.kind === 'field');
  const firstUp = layout.edges.find((e) => field && e.to === field.id);
  const [selectedId, setSelectedId] = useState(firstUp ? firstUp.from : field && field.id);
  if (!field || layout.nodes.length < 2) return null;
  const selected = layout.nodes.find((n) => n.id === selectedId) || field;
  const entities = layout.nodes.filter((n) => n.kind !== 'field');
  const legend = [
    ...Object.entries(LAYERS).filter(([k]) => entities.some((n) => n.layer === k)).map(([, v]) => v),
    ...(entities.some((n) => !LAYERS[n.layer]) ? [NONE] : []),
  ];
  const nameOf = (id) => (layout.nodes.find((n) => n.id === id) || {}).name || id;
  const madeBy = layout.edges.filter((e) => e.to === selected.id);

  return (
    <div style={cardStyle} data-lineage-card>
      <div style={headStyle}>
        <span style={titleStyle}><TbArrowsSplit2 size={14} /> Where “{field.name}” comes from</span>
        <span style={legendStyle}>
          {legend.map((l) => <span key={l.label} style={chipStyle(l)}><i style={dotStyle(l)} />{l.label}</span>)}
        </span>
      </div>
      <div style={bodyStyle}>
        <div style={{ ...canvasStyle, flexBasis: layout.width }}>
          <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`Lineage of ${field.name}`} style={svgStyle}>
            <defs>
              <marker id="lineage-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="var(--border-strong)" />
              </marker>
            </defs>
            {layout.edges.map((e) => (
              <path key={`${e.from}>${e.to}`} d={e.path} fill="none" stroke="var(--border-strong)" strokeWidth={1.5}
                strokeDasharray={e.columnLevel ? undefined : '5 4'} markerEnd="url(#lineage-arrow)" />
            ))}
            {layout.edges.filter((e) => e.pipeline).map((e) => {
              const text = fit(e.pipeline, 170);
              const w = text.length * 6 + 14;
              return (
                <g key={`p:${e.from}>${e.to}`}>
                  <rect x={e.mid.x - w / 2} y={e.mid.y - 9} width={w} height={18} rx={9} fill="var(--bg-panel)" stroke="var(--border-strong)" />
                  <text x={e.mid.x} y={e.mid.y + 3.5} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">{text}</text>
                  <title>{e.pipeline}</title>
                </g>
              );
            })}
            {layout.nodes.map((n) => {
              const look = lookOf(n);
              const on = n.id === selected.id;
              const layer = n.kind === 'field' ? null : (LAYERS[n.layer] || NONE);
              return (
                <g key={n.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${n.name}${layer ? `, ${layer.label}` : ''}`}
                  style={nodeStyle} onClick={() => setSelectedId(n.id)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSelectedId(n.id); } }}>
                  <title>{n.kind === 'field' ? n.name : n.id}</title>
                  {on && <rect x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6} rx={10} fill="none" stroke="var(--accent-primary)" strokeWidth={2} />}
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={8} fill={look.soft} stroke={look.ink} strokeDasharray={look.dashed ? '4 3' : undefined} />
                  {n.kind !== 'field' && !look.dashed && <rect x={n.x} y={n.y} width={5} height={n.h} rx={2} fill={look.ink} />}
                  <text x={n.x + 14} y={n.y + 23} fontSize={12.5} fontWeight={600} fill="var(--text-primary)">{fit(n.name, n.w - (layer && !layer.dashed ? 70 : 24))}</text>
                  <text x={n.x + 14} y={n.y + 41} fontSize={11} fill="var(--text-muted)">{fit(n.kind === 'field' ? n.container : n.container || n.type, n.w - 24)}</text>
                  {layer && !layer.dashed && <text x={n.x + n.w - 8} y={n.y + 17} fontSize={9.5} fontWeight={700} letterSpacing="0.06em" textAnchor="end" fill={look.ink}>{layer.label.toUpperCase()}</text>}
                </g>
              );
            })}
          </svg>
        </div>
        <aside style={detailStyle} aria-live="polite">
          <div style={detailHeadStyle}>
            {selected.kind === 'field'
              ? <span style={chipStyle(FIELD)}><i style={dotStyle(FIELD)} />This field</span>
              : <span style={chipStyle(LAYERS[selected.layer] || NONE)}><i style={dotStyle(LAYERS[selected.layer] || NONE)} />{(LAYERS[selected.layer] || NONE).label}</span>}
            {selected.tier ? <span style={tierStyle}>{selected.tier}</span> : null}
          </div>
          <div>
            <div style={detailNameStyle}>{selected.name}</div>
            <div style={detailFqnStyle}>{selected.kind === 'field' ? selected.container : selected.id}</div>
          </div>
          {selected.about ? <p style={aboutStyle}>{selected.about}</p> : null}
          {selected.columns && selected.columns.length > 0 && (
            <div>
              <div style={labelStyle}>Columns used</div>
              {selected.columns.map((c) => (
                <div key={c.name} style={columnStyle}><code style={codeStyle}>{c.name}</code>{c.description ? ` ${c.description}` : ''}</div>
              ))}
            </div>
          )}
          {madeBy.map((e) => (
            <div key={`${e.from}>${e.to}`}>
              <div style={labelStyle}>From {nameOf(e.from)}{e.pipeline ? ` · ${e.pipeline}` : ''}</div>
              {e.rules.map((r) => <div key={r} style={ruleStyle}>{r}</div>)}
              {e.about ? <p style={aboutStyle}>{e.about}</p> : null}
              {!e.columnLevel && <p style={gapStyle}>Only known between tables: no column lineage in the catalog.</p>}
              {e.sql ? (
                <details>
                  <summary style={summaryStyle}>SQL</summary>
                  <pre style={sqlStyle}>{e.sql}</pre>
                </details>
              ) : null}
            </div>
          ))}
          {selected.url ? <a href={selected.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>Open in OpenMetadata <TbExternalLink size={12} /></a> : null}
        </aside>
      </div>
      <div style={footStyle}>
        <span>── column lineage</span>
        <span>- - - known between tables only</span>
      </div>
    </div>
  );
}

const cardStyle = { border: '1px solid var(--border-default)', borderRadius: 10, background: 'var(--bg-panel)', overflow: 'hidden', marginTop: 8 };
const headStyle = { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border-default)' };
const titleStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' };
const legendStyle = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const chipStyle = (l) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, padding: '1px 8px', borderRadius: 999, color: l.ink, background: l.soft, border: `1px ${l.dashed ? 'dashed' : 'solid'} ${l.ink}` });
const dotStyle = (l) => ({ width: 7, height: 7, borderRadius: '50%', background: l.ink, display: 'inline-block' });
const bodyStyle = { display: 'flex', flexWrap: 'wrap' };
const canvasStyle = { flexGrow: 0, flexShrink: 0, maxWidth: '100%', overflowX: 'auto' };
const svgStyle = { display: 'block' };
const nodeStyle = { cursor: 'pointer', outline: 'none' };
// A line on its left beside the diagram, on its top once wrapped below it.
const detailStyle = { flex: '1 1 220px', minWidth: 0, boxShadow: '-1px 0 0 var(--border-default), 0 -1px 0 var(--border-default)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5, color: 'var(--text-primary)' };
const detailHeadStyle = { display: 'flex', alignItems: 'center', gap: 6 };
const tierStyle = { fontSize: 11, color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 999, padding: '1px 7px' };
const detailNameStyle = { fontWeight: 600, fontSize: 13.5, wordBreak: 'break-word' };
const detailFqnStyle = { fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' };
const aboutStyle = { margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' };
const labelStyle = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 };
const columnStyle = { lineHeight: 1.5, color: 'var(--text-secondary)' };
const codeStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.92em', padding: '0 3px', borderRadius: 4, background: 'var(--bg-subtle)', color: 'var(--text-primary)' };
const ruleStyle = { padding: '4px 8px', borderRadius: 6, background: 'var(--bg-subtle)', marginBottom: 4, lineHeight: 1.45 };
const gapStyle = { margin: 0, color: 'var(--state-warning)', fontSize: 11.5 };
const summaryStyle = { cursor: 'pointer', fontSize: 11.5, color: 'var(--text-secondary)' };
const sqlStyle = { margin: '6px 0 0', padding: 8, borderRadius: 6, background: 'var(--bg-subtle)', fontSize: 11, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto' };
const linkStyle = { display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-primary-text)', fontSize: 12, textDecoration: 'none' };
const footStyle = { display: 'flex', flexWrap: 'wrap', gap: '2px 16px', padding: '6px 12px', borderTop: '1px solid var(--border-default)', fontSize: 11, color: 'var(--text-muted)' };
