import { useState } from 'react';
import api from '../../utils/api';

const DB_TYPES = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'azure_postgres', label: 'Azure PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
  { value: 'azure_sql', label: 'Azure SQL Database', defaultPort: 1433 },
  { value: 'bigquery', label: 'Google BigQuery', defaultPort: 0, noHost: true },
  { value: 'duckdb', label: 'DuckDB', defaultPort: 0, noHost: true },
];

const blankForm = {
  name: '',
  dbType: 'postgres',
  host: 'localhost',
  port: 5432,
  dbName: '',
  dbUser: '',
  dbPassword: '',
  extraConfig: {},
};

/**
 * Reusable datasource create/edit form. Used inline on the Datasources page
 * and as a modal popup from the Dashboard "+ New Report → Database" flow.
 *
 * Props:
 *   - editingId: when set, PUT /datasources/:id instead of POST
 *   - initialValues: prefill the form (used for edit)
 *   - onSaved({ datasource, isNew }): called after a successful save
 *   - onCancel(): called when the user clicks Cancel
 */
export default function DatasourceForm({ editingId = null, initialValues = null, onSaved, onCancel }) {
  const [form, setForm] = useState(initialValues || blankForm);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const updateForm = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'dbType') {
        const dbType = DB_TYPES.find((t) => t.value === value);
        next.port = dbType?.defaultPort || 5432;
      }
      return next;
    });
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/datasources/test', form);
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ success: false, message: err.response?.data?.error || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.dbName) return;
    setSaving(true);
    try {
      if (editingId) {
        const res = await api.put(`/datasources/${editingId}`, form);
        onSaved?.({ datasource: res.data?.datasource || { id: editingId, ...form }, isNew: false });
      } else {
        const res = await api.post('/datasources', form);
        onSaved?.({ datasource: res.data?.datasource, isNew: true });
      }
    } catch (err) {
      console.error(err);
      setTestResult({ success: false, message: err.response?.data?.error || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const dbTypeMeta = DB_TYPES.find((t) => t.value === form.dbType);

  return (
    <div>
      <Field label="Name">
        <input style={inputStyle} value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="My database" />
      </Field>

      <Field label="Type">
        <select style={inputStyle} value={form.dbType} onChange={(e) => updateForm('dbType', e.target.value)}>
          {DB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>

      {/* Standard DB fields */}
      {!dbTypeMeta?.noHost && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Host" style={{ flex: 1 }}>
              <input style={inputStyle} value={form.host} onChange={(e) => updateForm('host', e.target.value)} />
            </Field>
            <Field label="Port" style={{ width: 100 }}>
              <input style={inputStyle} type="number" value={form.port} onChange={(e) => updateForm('port', parseInt(e.target.value))} />
            </Field>
          </div>
          <Field label="Database name">
            <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="User" style={{ flex: 1 }}>
              <input style={inputStyle} value={form.dbUser} onChange={(e) => updateForm('dbUser', e.target.value)} />
            </Field>
            <Field label="Password" style={{ flex: 1 }}>
              <input style={inputStyle} type="password" value={form.dbPassword}
                onChange={(e) => updateForm('dbPassword', e.target.value)}
                placeholder={editingId ? 'Leave blank to keep existing' : ''} />
            </Field>
          </div>
        </>
      )}

      {/* BigQuery fields */}
      {form.dbType === 'bigquery' && (
        <>
          <Field label="Project ID">
            <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} placeholder="my-gcp-project" />
          </Field>
          <Field label="Dataset">
            <input style={inputStyle} value={form.extraConfig?.dataset || ''} onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, dataset: e.target.value })} placeholder="my_dataset" />
          </Field>
          <Field label="Service Account Key (JSON)">
            <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'monospace', fontSize: 11 }}
              value={form.extraConfig?.credentials || ''}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, credentials: e.target.value })}
              placeholder='{"type":"service_account","project_id":"..."}' />
          </Field>
        </>
      )}

      {/* DuckDB fields */}
      {form.dbType === 'duckdb' && (
        <Field label="Database file path">
          <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} placeholder="/path/to/data.duckdb or :memory:" />
        </Field>
      )}

      {testResult && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12,
          background: testResult.success ? '#f0fdf4' : 'var(--state-danger-soft)',
          color: testResult.success ? '#16a34a' : '#dc2626',
          border: `1px solid ${testResult.success ? '#bbf7d0' : '#fca5a5'}`,
        }}>
          {testResult.success ? 'Connection successful!' : `Failed: ${testResult.message}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button onClick={handleTest} disabled={testing} style={{ ...secondaryBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}>
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <button onClick={handleSave} disabled={saving} style={primaryBtn}>
          {saving ? 'Saving...' : (editingId ? 'Update' : 'Save')}
        </button>
      </div>
    </div>
  );
}

/**
 * Helper used by callers of DatasourceForm to chain "create datasource → create
 * model → navigate to model editor (table selection)". Exposed so both the
 * Datasources page and the Dashboard new-report modal share the same flow.
 */
export async function createModelAndNavigate(navigate, datasource) {
  if (!datasource?.id) return false;
  try {
    const res = await api.post('/models', { name: datasource.name || 'New Model', datasourceId: datasource.id, description: '' });
    const modelId = res.data?.model?.id;
    if (modelId) {
      navigate(`/models/${modelId}`);
      return true;
    }
  } catch (err) {
    console.error('Auto-model creation failed:', err);
  }
  return false;
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
};

const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)',
  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
