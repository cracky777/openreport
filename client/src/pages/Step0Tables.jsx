// Step 0 of the model wizard: pick which datasource tables to include.
// Extracted verbatim from pages/ModelEditor.jsx (LOT 6.3). Purely
// presentational — every value and handler comes in via props. `cardStyle`
// is duplicated here (it's shared with the other wizard steps, which keep the
// canonical copy in ModelEditor); the rest of the styles are step-0 only.
const _hs18 = { flex: 1, overflow: 'auto', padding: 24 };
const _hs19 = { maxWidth: 700, margin: '0 auto' };
const _hs20 = { fontSize: 16, fontWeight: 600, marginBottom: 4 };
const _hs21 = { fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 };
const _hs22 = { maxHeight: 400, overflow: 'auto' };
const _hs23 = { padding: 20, textAlign: 'center', color: 'var(--text-disabled)' };
const _hs24 = { padding: 12, background: 'var(--state-danger-soft)', color: 'var(--state-danger)', borderRadius: 6, fontSize: 13, marginBottom: 8 };
const _hs25 = { padding: 20, textAlign: 'center', color: 'var(--text-disabled)' };
const _hs26 = { width: 18, height: 18, cursor: 'pointer' };
const _hs27 = { fontSize: 14, color: 'var(--text-primary)' };
const _hs28 = { marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const _hs29 = { fontSize: 13, color: 'var(--text-muted)' };
const cardStyle = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)' };
const searchInput = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)',
  borderRadius: 6, fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box',
};
const tableCheckRow = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
  borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
};
const sourcesBox = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  padding: '8px 10px', marginBottom: 12, borderRadius: 6,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', fontSize: 13,
};
const sourcesLabel = { color: 'var(--text-muted)', marginRight: 2 };
const sourceChip = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', color: 'var(--text-primary)',
};
const chipRemove = { border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 13, lineHeight: 1 };
const linkBtn = {
  color: 'var(--accent-primary)', background: 'transparent', border: 'none',
  cursor: 'pointer', fontSize: 13, padding: '2px 4px',
};
const linkSelect = {
  fontSize: 13, padding: '2px 6px', borderRadius: 6, maxWidth: 200,
  border: '1px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)',
};
const groupHeading = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: 0.4, padding: '10px 8px 4px',
};
const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

// `tableInfo`: where each table comes from ({ name, table, sourceName }) — a
// model reading several files lists its tables under each source.
// `sources`: the model's own source, the files it links and the ones it could,
// with the actions on them; null when the model cannot combine files (a
// database connection, or no right to edit it).
export default function Step0Tables({
  tableSearch, setTableSearch, tablesLoading, tablesError,
  filteredTables, selectedTables, toggleTable, enterStep1, tableInfo = [], sources,
}) {
  const info = new Map(tableInfo.map((t) => [t.name, t]));
  const groups = [];
  for (const name of filteredTables) {
    const sourceName = info.get(name)?.sourceName || '';
    let group = groups.find((g) => g.sourceName === sourceName);
    if (!group) { group = { sourceName, tables: [] }; groups.push(group); }
    group.tables.push(name);
  }
  const grouped = groups.length > 1 || (sources?.linked.length ?? 0) > 0;
  return (
    <div style={_hs18}>
      <div style={_hs19}>
        <div style={cardStyle}>
          <h2 style={_hs20}>Select Tables</h2>
          <p style={_hs21}>
            Choose the tables you want to include in this model.
          </p>
          <input
            type="text" placeholder="Search tables..."
            value={tableSearch} onChange={(e) => setTableSearch(e.target.value)}
            style={searchInput}
          />
          {/* A model on an imported file reads other files too: each one a data
              source of its own, its tables listed below under its name. */}
          {sources && (
            <div style={sourcesBox}>
              <span style={sourcesLabel}>Sources:</span>
              <span style={sourceChip}>{sources.own?.name}</span>
              {sources.linked.map((l) => (
                <span key={l.id} style={sourceChip}>
                  {l.name}
                  <button onClick={() => sources.onUnlink(l)} style={chipRemove} title={`Remove ${l.name} from the model`} aria-label={`Remove ${l.name} from the model`}>×</button>
                </span>
              ))}
              <button className="btn-hover" onClick={sources.onImportFile} style={linkBtn}>+ Import a file</button>
              {sources.linkable.length > 0 && (
                <select
                  aria-label="Add a data source"
                  value=""
                  onChange={(e) => { if (e.target.value) sources.onLink(e.target.value); }}
                  style={linkSelect}
                >
                  <option value="">Add a data source…</option>
                  {sources.linkable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </div>
          )}
          <div style={_hs22}>
            {tablesLoading && (
              <div style={_hs23}>Loading tables from database...</div>
            )}
            {tablesError && (
              <div style={_hs24}>
                {tablesError}
              </div>
            )}
            {!tablesLoading && !tablesError && filteredTables.length === 0 && (
              <div style={_hs25}>
                {tableSearch ? 'No tables match your search' : 'No tables found in this database'}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.sourceName}>
                {grouped && <div style={groupHeading}>{g.sourceName}</div>}
                {g.tables.map((table) => (
                  <label key={table} style={tableCheckRow}>
                    <input
                      type="checkbox"
                      checked={selectedTables.includes(table)}
                      onChange={() => toggleTable(table)}
                      style={_hs26}
                    />
                    <span style={_hs27}>{info.get(table)?.table || table}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div style={_hs28}>
            <span style={_hs29}>{selectedTables.length} table(s) selected</span>
            <button
              className="btn-hover btn-hover-primary"
              onClick={enterStep1}
              disabled={selectedTables.length === 0}
              style={{ ...primaryBtn, opacity: selectedTables.length === 0 ? 0.5 : 1 }}
            >
              Next: Schema & Joins →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
