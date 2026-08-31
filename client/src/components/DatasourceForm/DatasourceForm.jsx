import { useEffect, useState } from 'react';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import ConnectorIcon from '../AppShell/ConnectorIcon';

const _hs0 = { display: 'flex', gap: 12 };
const _hs1 = { flex: 1 };
const _hs2 = { width: 100 };
const _hs3 = { display: 'flex', gap: 12 };
const _hs4 = { flex: 1 };
const _hs5 = { flex: 1 };
const _hs6 = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' };
const _hs7 = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const _hs8 = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };

const DB_TYPES = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'azure_postgres', label: 'Azure PostgreSQL', defaultPort: 5432 },
  { value: 'redshift', label: 'Redshift', defaultPort: 5439 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
  { value: 'clickhouse', label: 'ClickHouse', defaultPort: 8123 },
  { value: 'databricks', label: 'Databricks', defaultPort: 443 },
  { value: 'azure_sql', label: 'Azure SQL', defaultPort: 1433 },
  { value: 'mssql', label: 'SQL Server', defaultPort: 1433 },
  { value: 'snowflake', label: 'Snowflake', defaultPort: 0, noHost: true },
  { value: 'bigquery', label: 'BigQuery', defaultPort: 0, noHost: true },
  { value: 'duckdb', label: 'DuckDB', defaultPort: 0, noHost: true },
];

// Moteurs dont le certificat peut légitimement ne pas être vérifiable.
// BigQuery et DuckDB n'ont pas de socket TLS à nous : l'un passe par le SDK
// Google, l'autre est un fichier local.
const SELF_SIGNED_OPT_OUT = new Set(['postgres', 'azure_postgres', 'redshift', 'mysql', 'mssql', 'azure_sql']);

// Connecteurs écrits mais jamais exécutés contre le moteur qu'ils visent. Le
// serveur fait foi (utils/connectorStatus) ; cette copie ne sert qu'à verrouiller
// avant que sa réponse arrive.
const PREVIEW_DEFAULT = ['redshift', 'mssql', 'snowflake', 'clickhouse', 'databricks'];
const PREVIEW_HINT = 'Preview connector — written and unit-tested, but never run against a real engine. '
  + 'An operator can enable it with OPENREPORT_PREVIEW_CONNECTORS.';

// Le libellé le plus long — « Azure PostgreSQL » — tient à cette largeur avec
// son logo ; en dessous, un badge « Preview » le faisait couper.
const typeGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(182px, 1fr))', gap: 8 };
const typeCardStyle = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 6,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)',
  color: 'var(--text-primary)',
  cursor: 'pointer', font: 'inherit', fontSize: 13, textAlign: 'left', width: '100%',
};
const typeCardSelected = { borderColor: 'var(--accent-primary)', boxShadow: '0 0 0 1px var(--accent-primary)' };
// Pas d'opacité globale : elle délaverait aussi le fond de la carte, et sur le
// thème sombre le libellé tomberait sous le seuil de lisibilité. Chaque couleur
// est nommée, donc chaque thème garde son contraste.
const typeCardLocked = {
  cursor: 'not-allowed', background: 'var(--bg-subtle)',
  borderColor: 'var(--border-subtle)', color: 'var(--text-disabled)',
};
const typeCardLabel = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const previewBadge = {
  fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600,
  padding: '1px 5px', borderRadius: 3, background: 'var(--bg-hover)', color: 'var(--text-muted)',
};
const previewNote = { marginTop: 6, fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' };

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
  // Quels connecteurs ce déploiement refuse. La liste vient du serveur, pas
  // d'une constante du client : un opérateur peut lever le garde-fou avec
  // OPENREPORT_PREVIEW_CONNECTORS, et l'écran doit alors le refléter. Tant que
  // la réponse n'est pas là, on verrouille — le contraire proposerait un
  // connecteur que l'enregistrement rejetterait ensuite.
  const [unavailable, setUnavailable] = useState(() => new Set(PREVIEW_DEFAULT));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/datasources/connectors')
      .then((res) => { if (alive) setUnavailable(new Set(res.data?.unavailable || [])); })
      .catch(() => { /* on garde le verrouillage par défaut */ });
    return () => { alive = false; };
  }, []);

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
        {/* Une grille plutôt qu'un <select> : un <option> ne sait pas porter
            d'icône, et c'est le logo qu'on reconnaît avant le libellé. Elle
            porte aussi l'état « préversion », qu'une liste déroulante ne
            pourrait qu'écrire entre parenthèses. */}
        <div style={typeGridStyle} role="radiogroup" aria-label="Database type">
          {DB_TYPES.map((t) => {
            const locked = unavailable.has(t.value);
            const selected = form.dbType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                title={locked ? PREVIEW_HINT : t.label}
                onClick={() => !locked && updateForm('dbType', t.value)}
                style={{
                  ...typeCardStyle,
                  ...(selected ? typeCardSelected : null),
                  ...(locked ? typeCardLocked : null),
                }}
              >
                <ConnectorIcon dbType={t.value} size={18} muted={locked} />
                <span style={typeCardLabel}>{t.label}</span>
                {locked && <span style={previewBadge}>Preview</span>}
              </button>
            );
          })}
        </div>
        {[...unavailable].includes(form.dbType) && (
          <div style={previewNote}>{PREVIEW_HINT}</div>
        )}
      </Field>

      {/* Standard DB fields */}
      {!dbTypeMeta?.noHost && (
        <>
          <div style={_hs0}>
            <Field label="Host" style={_hs1}>
              <input style={inputStyle} value={form.host} onChange={(e) => updateForm('host', e.target.value)} />
            </Field>
            <Field label="Port" style={_hs2}>
              <input style={inputStyle} type="number" value={form.port} onChange={(e) => updateForm('port', parseInt(e.target.value))} />
            </Field>
          </div>
          <Field label="Database name">
            <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} />
          </Field>
          <div style={_hs3}>
            <Field label="User" style={_hs4}>
              <input style={inputStyle} value={form.dbUser} onChange={(e) => updateForm('dbUser', e.target.value)} />
            </Field>
            <Field label="Password" style={_hs5}>
              <input style={inputStyle} type="password" value={form.dbPassword}
                onChange={(e) => updateForm('dbPassword', e.target.value)}
                placeholder={editingId ? 'Leave blank to keep existing' : ''} />
            </Field>
          </div>
        </>
      )}

      {/* TLS verification is on by default; let a server with a self-signed or
          internal-CA cert opt out. Redshift needs it for older clusters, whose
          certificate chains to the Redshift CA bundle rather than to a root
          Node already trusts; an on-prem SQL Server needs it because its
          default certificate is self-signed. The connection stays encrypted
          either way — only the certificate check is waived. */}
      {SELF_SIGNED_OPT_OUT.has(form.dbType) && (
        <Field label="SSL">
          <label style={_hs6}>
            <input type="checkbox"
              checked={!!form.extraConfig?.allowSelfSignedCert}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, allowSelfSignedCert: e.target.checked })} />
            Allow self-signed certificate (skip TLS verification)
          </label>
        </Field>
      )}

      {/* BigQuery fields */}
      {form.dbType === 'bigquery' && (
        <>
          <Field label="Project ID">
            <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} placeholder="my-gcp-project" />
          </Field>
          <Field label="Dataset">
            {/* A dataset in another project is written `project.dataset` — the
                Project ID above still pays for the queries. That is how a
                public dataset is read (bigquery-public-data.thelook_ecommerce). */}
            <input style={inputStyle} value={form.extraConfig?.dataset || ''} onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, dataset: e.target.value })} placeholder="my_dataset — or other-project.their_dataset" />
          </Field>
          <Field label="Location (optional)">
            <input style={inputStyle} value={form.extraConfig?.location || ''}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, location: e.target.value })}
              placeholder="Auto-detected — set only to force a region (EU, US, europe-west1…)" />
          </Field>
          <Field label="Service Account Key (JSON)">
            <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'monospace', fontSize: 11 }}
              value={form.extraConfig?.credentials || ''}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, credentials: e.target.value })}
              placeholder={editingId
                ? 'Leave blank to keep the existing key'
                : '{"type":"service_account","project_id":"..."}'} />
          </Field>
        </>
      )}

      {/* Snowflake fields — no host/port: the account identifier already carries
          the region and cloud, and the warehouse is the compute, separate from
          the database that holds the data. */}
      {form.dbType === 'snowflake' && (
        <>
          <Field label="Account identifier">
            <input style={inputStyle} value={form.extraConfig?.account || ''}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, account: e.target.value })}
              placeholder="myorg-myaccount — the part before .snowflakecomputing.com" />
          </Field>
          <Field label="Warehouse">
            {/* Without a warehouse Snowflake has no compute to run on and
                refuses every query, with an error that names neither. */}
            <input style={inputStyle} value={form.extraConfig?.warehouse || ''}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, warehouse: e.target.value })}
              placeholder="COMPUTE_WH" />
          </Field>
          <Field label="Database">
            <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} placeholder="SNOWFLAKE_SAMPLE_DATA" />
          </Field>
          <div style={_hs3}>
            <Field label="Schema (optional)" style={_hs4}>
              <input style={inputStyle} value={form.extraConfig?.schema || ''}
                onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, schema: e.target.value })} placeholder="PUBLIC" />
            </Field>
            <Field label="Role (optional)" style={_hs5}>
              <input style={inputStyle} value={form.extraConfig?.role || ''}
                onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, role: e.target.value })} placeholder="ACCOUNTADMIN" />
            </Field>
          </div>
          <div style={_hs3}>
            <Field label="User" style={_hs4}>
              <input style={inputStyle} value={form.dbUser} onChange={(e) => updateForm('dbUser', e.target.value)} />
            </Field>
            <Field label="Password" style={_hs5}>
              <input style={inputStyle} type="password" value={form.dbPassword}
                onChange={(e) => updateForm('dbPassword', e.target.value)}
                placeholder={editingId ? 'Leave blank to keep existing' : ''} />
            </Field>
          </div>
        </>
      )}

      {/* Databricks fields — the workspace hostname goes in Host above; what
          picks one SQL warehouse out of the workspace is the HTTP path. */}
      {form.dbType === 'databricks' && (
        <>
          <Field label="HTTP path">
            <input style={inputStyle} value={form.extraConfig?.httpPath || ''}
              onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, httpPath: e.target.value })}
              placeholder="/sql/1.0/warehouses/abc123 — from the warehouse's Connection details" />
          </Field>
          <div style={_hs3}>
            <Field label="Catalog (optional)" style={_hs4}>
              <input style={inputStyle} value={form.extraConfig?.catalog || ''}
                onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, catalog: e.target.value })}
                placeholder="main — Unity Catalog names in three levels" />
            </Field>
            <Field label="Schema (optional)" style={_hs5}>
              <input style={inputStyle} value={form.extraConfig?.schema || ''}
                onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, schema: e.target.value })} placeholder="default" />
            </Field>
          </div>
        </>
      )}

      {/* ClickHouse serves HTTP on 8123 and HTTPS on 8443 — two ports for one
          server, so the checkbox moves the default port with it. */}
      {form.dbType === 'clickhouse' && (
        <Field label="TLS">
          <label style={_hs6}>
            <input type="checkbox"
              checked={!!form.extraConfig?.secure}
              onChange={(e) => {
                const secure = e.target.checked;
                updateForm('extraConfig', { ...form.extraConfig, secure });
                updateForm('port', secure ? 8443 : 8123);
              }} />
            Connect over HTTPS (port 8443)
          </label>
        </Field>
      )}

      {/* SQL Server on-prem: a named instance has no fixed port — the SQL Browser
          service resolves it from the name, so the port field is ignored then. */}
      {form.dbType === 'mssql' && (
        <Field label="Named instance (optional)">
          <input style={inputStyle} value={form.extraConfig?.instanceName || ''}
            onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, instanceName: e.target.value })}
            placeholder="SQLEXPRESS — leave blank for a default instance on the port above" />
        </Field>
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

      <div style={_hs7}>
        <button className="btn-hover" onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button className="btn-hover btn-hover-accent" onClick={handleTest} disabled={testing} style={{ ...secondaryBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}>
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        <button className="btn-hover btn-hover-primary" onClick={handleSave} disabled={saving} style={primaryBtn}>
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
export async function createModelAndNavigate(navigate, datasource, options = {}) {
  if (!datasource?.id) return false;
  try {
    const res = await api.post('/models', { name: datasource.name || 'New Model', datasourceId: datasource.id, description: '' });
    const modelId = res.data?.model?.id;
    if (modelId) {
      // `then=newReport` tells the model editor to bounce back to the
      // dashboard's new-report wizard once the user saves the model.
      // `title` carries the report title the user already typed so it
      // survives the round trip.
      const params = new URLSearchParams();
      if (options.then) params.set('then', options.then);
      if (options.title) params.set('title', options.title);
      const qs = params.toString();
      navigate(`/models/${modelId}${qs ? '?' + qs : ''}`);
      return true;
    }
  } catch (err) {
    console.error('Auto-model creation failed:', err);
    // A duplicate model name (409) lands here — tell the user why the flow
    // stopped instead of silently returning to the previous screen.
    toast(err?.response?.data?.error || 'Failed to create model');
  }
  return false;
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={_hs8}>{label}</label>
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
