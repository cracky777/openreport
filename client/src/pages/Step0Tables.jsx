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
const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

export default function Step0Tables({
  tableSearch, setTableSearch, tablesLoading, tablesError,
  filteredTables, selectedTables, toggleTable, enterStep1,
}) {
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
            {filteredTables.map((table) => (
              <label key={table} style={tableCheckRow}>
                <input
                  type="checkbox"
                  checked={selectedTables.includes(table)}
                  onChange={() => toggleTable(table)}
                  style={_hs26}
                />
                <span style={_hs27}>{table}</span>
              </label>
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
