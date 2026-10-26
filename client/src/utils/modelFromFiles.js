import api from './api';
import { layoutPositions } from './diagramLayout';
import { autoFlagColumns } from './autoFlagColumns';
import { DATE_PARTS } from './modelProposal';

// From an uploaded file to a report the assistant can build on, without the
// screens the journey walks through: the model, then the blank report. Shared
// by the Reports stage (a file picked in New Report) and the chat mode (files
// dropped into the conversation, components/AiPanel/StartConversation.jsx).

const NUMERIC = ['integer', 'bigint', 'numeric', 'decimal', 'real', 'double', 'float', 'int', 'smallint', 'double precision', 'interval'];
const DATES = ['date', 'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'datetime', 'time', 'smalldatetime', 'datetime2'];

// A date read by year and by month, as the model assistant adds them: a trend
// over ten months was drawn day by day, the only date the model had (seen
// with Karim) — the report assistant cannot add a date part itself.
const MODEL_DATE_PARTS = ['year', 'year_month'];
const datePartsOf = (table, column, label) => MODEL_DATE_PARTS.map((id) => DATE_PARTS[id]).map((p) => ({
  name: `${table}.${column}_${p.suffix}`, table, column, type: p.type, label: `${label} (${p.label})`, datePartOf: `${table}.${column}`, datePart: p.expr,
}));

// A file's tables as New Report has always flagged them: every column a
// dimension, the numeric ones a sum measure as well. With several sheets the
// labels carry the sheet, so homonym columns stay apart (and the server, which
// refuses fields of unrelated tables in one visual, is not fought by the UI).
function flagTables(tables) {
  const multi = tables.length > 1;
  const dimensions = [];
  const measures = [];
  const selected = [];
  for (const [table, columns] of tables) {
    selected.push(table);
    for (const c of columns) {
      const dt = (c.data_type || '').toLowerCase();
      const label = multi ? `${c.column_name} (${table})` : c.column_name;
      dimensions.push({ name: `${table}.${c.column_name}`, table, column: c.column_name, type: NUMERIC.includes(dt) ? 'number' : DATES.includes(dt) ? 'date' : 'string', label });
      if (DATES.includes(dt)) dimensions.push(...datePartsOf(table, c.column_name, label));
      if (NUMERIC.includes(dt)) measures.push({ name: `${table}.${c.column_name}_sum`, table, column: c.column_name, aggregation: 'sum', label });
    }
  }
  return { selected_tables: selected, dimensions, measures };
}

/**
 * The model of an uploaded file: found again when the upload reused an
 * existing source whose model is populated, made otherwise. A model left empty
 * by an earlier failure is flagged again in place — otherwise reuse skipped
 * the flagging and the user landed in an empty editor.
 * @param {object} uploadData  the `/upload` response
 * @param {{ workspaceId?: string, models?: object[] }} opts  the models already listed, to find the reused one
 * @returns {Promise<string>} the model's id
 */
export async function ensureModelForUpload(uploadData, { workspaceId, models = [] } = {}) {
  const ds = uploadData.datasource;
  let modelId;
  let needsAutoFlag = true;
  if (uploadData.reused) {
    const existing = models.find((m) => m.datasource_id === ds.id);
    if (existing) {
      modelId = existing.id;
      try {
        const m = (await api.get(`/models/${existing.id}`)).data.model;
        const hasTables = (m.selected_tables || []).length > 0;
        const hasFields = (m.dimensions || []).length > 0 || (m.measures || []).length > 0;
        if (hasTables && hasFields) needsAutoFlag = false;
      } catch { /* unreadable: flagged again, which is safe */ }
    }
  }
  if (!modelId) {
    const res = await api.post('/models', { name: ds.name, datasourceId: ds.id, ...(workspaceId ? { workspaceId } : {}) });
    modelId = res.data.model.id;
  }
  if (needsAutoFlag) {
    // A fresh upload carries every imported table (name + columns); older or
    // reused sources fall back to a single-table fetch.
    let tables = ds.tables;
    if (!tables || !tables.length) {
      const res = await api.get(`/datasources/${ds.id}/tables/${ds.tableName}/columns`);
      tables = [{ tableName: ds.tableName, columns: res.data.columns || [] }];
    }
    await api.put(`/models/${modelId}`, flagTables(tables.map((t) => [t.tableName, t.columns || []])));
  }
  return modelId;
}

// Where the schema canvas draws a table that was never placed: the grid the
// model editor uses for them, three to a row.

/**
 * A model just made on several files (multiFileImport.modelOnFiles), set up as
 * the model editor does on `?setup=files` but without the editor: every table
 * ticked, its columns flagged, the tables joined by their column names and
 * marked fact or dimension (server: utils/relationships.js).
 * @returns {Promise<{ tables: string[], joins: object[], roles: object, skipped: object[] }>} what was found, for the caller to say
 */
export async function setUpModelFromFiles(modelId, datasourceId) {
  const tables = ((await api.get(`/models/${modelId}/tables`)).data.tables || []).map((t) => t.name);
  const columns = {};
  const dimensions = [];
  const measures = [];
  for (const t of tables) {
    const cols = (await api.get(`/models/${modelId}/tables/${encodeURIComponent(t)}/columns`)).data.columns || [];
    columns[t] = cols;
    const auto = autoFlagColumns(t, cols);
    dimensions.push(...auto.dimensions);
    for (const d of auto.dimensions) if (d.type === 'date') dimensions.push(...datePartsOf(t, d.column, d.label));
    measures.push(...auto.measures);
  }
  let found = { joins: [], roles: {}, skipped: [] };
  try {
    const names = Object.fromEntries(tables.map((t) => [t, columns[t].map((c) => c.column_name)]));
    found = (await api.post(`/datasources/${datasourceId}/relationships`, { tables, columns: names, joins: [], roles: {}, byName: true })).data;
  } catch { /* keys unreadable: the assistant or the editor joins them */ }
  const joins = (found.joins || []).map(({ reason: _r, ...j }) => j);
  const roles = found.roles || {};
  // Laid out by its joins (utils/diagramLayout): facts in the middle, their dimensions around.
  const typed = Object.fromEntries(Object.entries(roles).map(([t, r]) => [t, { tableType: r }]));
  const table_positions = layoutPositions(typed, tables, joins, (t) => (columns[t] || []).length, { all: true });
  await api.put(`/models/${modelId}`, { selected_tables: tables, dimensions, measures, joins, table_positions });
  return { tables, joins, roles, skipped: found.skipped || [] };
}

/**
 * A blank report on a model — a draft until its first save, listed nowhere
 * and dropped if left unsaved — in the app's theme, as New Report makes it.
 * `ownsModel`: the model was made for it (files dropped), and goes with it.
 * @param {{ title?: string, autoTitle?: boolean, workspaceId?: string, theme?: object|null, ownsModel?: boolean }} opts
 * @returns {Promise<string>} the report's id
 */
export async function draftReportOn(modelId, { title, autoTitle = false, workspaceId, theme = null, ownsModel = false } = {}) {
  const res = await api.post('/reports', {
    draft: true,
    title: title || 'Untitled Report',
    ...(autoTitle ? { autoTitle: true } : {}),
    ...(ownsModel ? { ownsModel: true } : {}),
    modelId,
    ...(workspaceId ? { workspaceId } : {}),
    settings: { theme },
  });
  return res.data.report.id;
}
