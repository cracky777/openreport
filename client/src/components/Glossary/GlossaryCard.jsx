import { useEffect, useState } from 'react';

// The business glossary of a model, edited by hand (server utils/glossary.js):
// which domains of the catalogue it serves, and for each dimension and
// measure its role in them, the words users call it by, a description. The
// assistant reads all of it with the schema; its own proposals land here too.
const MAX_DOMAINS = 4;
const cardStyle = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)' };
const cardTitle = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 };
const hint = { fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.45 };
const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 };
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px 3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'var(--accent-primary-soft)', color: 'var(--accent-primary-text)' };
const chipX = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 13, lineHeight: 1, padding: '0 3px' };
const select = { padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 12.5, outline: 'none', background: 'var(--bg-panel)', color: 'var(--text-secondary)', maxWidth: '100%' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 };
const td = { padding: '6px 10px', borderBottom: '1px solid #f1f5f9', color: 'var(--text-secondary)', verticalAlign: 'top' };
const input = { padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', background: 'var(--bg-panel)' };
const kindBadge = { padding: '1px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 700, marginRight: 6, background: 'var(--bg-active)', color: 'var(--accent-primary)' };
const empty = { color: 'var(--text-disabled)', fontSize: 13 };
// Which roles a field of each kind may carry (mirrors the server's FIELD_OF_KIND).
const ROLE_KINDS_FOR = { dimension: ['date', 'dimension', 'key'], measure: ['measure'] };

// Comma-separated words, committed when the field loses focus: typing a comma
// must not re-split the text under the cursor.
function SynonymsInput({ value, onChange }) {
  const joined = (value || []).join(', ');
  const [text, setText] = useState(joined);
  useEffect(() => { setText(joined); }, [joined]);
  const commit = () => onChange([...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 10));
  return <input style={input} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} placeholder="CA, chiffre d'affaires…" title="Words the users of this model call this field by, separated by commas" />;
}

export default function GlossaryCard({ domains, setDomains, catalogue, dimensions, setDimensions, measures, setMeasures }) {
  const byId = Object.fromEntries(catalogue.map((d) => [d.id, d]));
  const chosen = domains.map((id) => byId[id]).filter(Boolean);
  // Roles offered: those of the declared domains, or of every domain until one is declared.
  const offered = chosen.length ? chosen : catalogue;
  const addDomain = (id) => { if (id && !domains.includes(id) && domains.length < MAX_DOMAINS) setDomains([...domains, id]); };
  const setMeta = (kind, name, patch) => {
    const update = (prev) => prev.map((f) => {
      if (f.name !== name) return f;
      const next = { ...f, ...patch };
      for (const k of ['role', 'synonyms', 'description']) if (next[k] === '' || next[k] === undefined || (Array.isArray(next[k]) && !next[k].length)) delete next[k];
      return next;
    });
    if (kind === 'dimension') setDimensions(update); else setMeasures(update);
  };
  const fields = [
    ...dimensions.map((d) => ({ kind: 'dimension', field: d })),
    ...measures.map((m) => ({ kind: 'measure', field: m })),
  ];
  const roleLabel = (id) => {
    for (const d of catalogue) { const r = d.roles.find((x) => x.id === id); if (r) return `${d.label}: ${r.label}`; }
    return id;
  };

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Business glossary</h3>
      <p style={hint}>What this model is about and what each field means. The assistant reads it with the schema, so a question in business words finds the right field. Anyone who uses the model can add to it from the assistant; here it is edited by hand.</p>
      <div style={row}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Domains</span>
        {chosen.map((d) => (
          <span key={d.id} style={chip}>{d.label}<button type="button" style={chipX} onClick={() => setDomains(domains.filter((x) => x !== d.id))} title={`Remove ${d.label}`} aria-label={`Remove ${d.label}`}>×</button></span>
        ))}
        {domains.length < MAX_DOMAINS && catalogue.length > 0 && (
          <select style={select} value="" onChange={(e) => addDomain(e.target.value)} title="A function (what a team steers) and/or a sector (the company's trade)">
            <option value="">{chosen.length ? '+ Add a domain' : 'Pick a domain…'}</option>
            <optgroup label="Functions">{catalogue.filter((d) => d.kind === 'function' && !domains.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</optgroup>
            <optgroup label="Sectors">{catalogue.filter((d) => d.kind === 'sector' && !domains.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</optgroup>
          </select>
        )}
      </div>
      {fields.length === 0 ? (
        <p style={empty}>Flag dimensions and measures first: the glossary describes them.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Field</th>
              <th style={th}>Business role</th>
              <th style={th}>Synonyms</th>
              <th style={th}>Description</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(({ kind, field }) => {
              const kinds = ROLE_KINDS_FOR[kind];
              // A role from a domain not declared here (or no longer in the
              // catalogue) stays visible and removable rather than silently lost.
              const inOffered = !!field.role && offered.some((d) => d.roles.some((r) => r.id === field.role));
              return (
                <tr key={`${kind}:${field.name}`}>
                  <td style={td}><span style={kindBadge}>{kind === 'dimension' ? 'D' : 'M'}</span>{field.label || field.name}</td>
                  <td style={td}>
                    <select style={{ ...select, width: '100%' }} value={field.role || ''} onChange={(e) => setMeta(kind, field.name, { role: e.target.value })} title="What this field means in the business, from the catalogue">
                      <option value="">—</option>
                      {field.role && !inOffered && <option value={field.role}>{roleLabel(field.role)}</option>}
                      {offered.map((d) => {
                        const roles = d.roles.filter((r) => kinds.includes(r.kind));
                        return roles.length ? <optgroup key={d.id} label={d.label}>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</optgroup> : null;
                      })}
                    </select>
                  </td>
                  <td style={td}><SynonymsInput value={field.synonyms} onChange={(synonyms) => setMeta(kind, field.name, { synonyms })} /></td>
                  <td style={td}><input style={input} value={field.description || ''} maxLength={200} onChange={(e) => setMeta(kind, field.name, { description: e.target.value })} placeholder="What it holds" title="What this field holds, for the assistant and for your colleagues" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
