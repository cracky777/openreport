import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import { useAiChat } from './useAiChat';
import { applyModelProposal } from '../utils/modelProposal';
import { autoFlagColumns } from '../utils/autoFlagColumns';
import { getColumnType, readOverride } from '../utils/modelEditorHelpers';

// The model assistant beside a report, in the studio's one conversation:
// identify the relationships, join the tables, flag the columns, measures,
// fact and dimension tables, the glossary, reshape a file — the same
// assistant, route and cards as the model editor's (ModelAssistant.jsx), on
// the SAVED model: the studio holds no model draft, so a card applied is a
// model saved, and the report's assistant sees the new fields on its next
// turn. Jonathan wants his time in the chat, not in the editors.

const CONTINUE = 'The tables are in the model now. Go on with my request: joins, table roles and fields.';
// After a file was reshaped: the assistant proposes the joins, the user validates them.
const SHAPED = (tables) => `The file is reshaped: ${tables.join(', ')} are in the model now. Go on with my request: join the new tables to the others (a calendar to the date of every fact), set the table roles and flag the fields.`;

// Where the schema canvas draws a table never placed: the model editor's grid.
const placed = (i) => ({ x: 40 + (i % 3) * 260, y: 40 + Math.floor(i / 3) * 300 });
const rolesOf = (positions) => Object.fromEntries(Object.entries(positions || {}).filter(([, p]) => p && p.tableType).map(([t, p]) => [t, p.tableType]));

// The saved model, the tables its sources offer, and the columns of the tables it uses.
async function readModel(modelId) {
  const model = (await api.get(`/models/${modelId}`)).data.model;
  const all = ((await api.get(`/models/${modelId}/tables`)).data.tables || []).map((t) => t.name);
  const columns = {};
  for (const t of model.selected_tables || []) {
    columns[t] = (await api.get(`/models/${modelId}/tables/${encodeURIComponent(t)}/columns`)).data.columns || [];
  }
  return { model, all, columns };
}

// What the model assistant is shown (server: modelAssistant.cleanDraft): the
// editor's draft, here the model as saved.
const draftOf = ({ model, all, columns }) => ({
  tables: Object.fromEntries((model.selected_tables || []).filter((t) => columns[t]).map((t) => [t, columns[t].map((c) => ({ column: c.column_name, type: String(c.data_type || '') }))])),
  available: all.filter((t) => !(model.selected_tables || []).includes(t)),
  joins: model.joins || [],
  roles: rolesOf(model.table_positions),
  dimensions: (model.dimensions || []).filter((d) => d.table && d.column).map((d) => ({ table: d.table, column: d.column, role: d.role })),
  measures: (model.measures || []).filter((m) => m.table && m.column).map((m) => ({ table: m.table, column: m.column, aggregation: m.aggregation, role: m.role })),
  domains: model.domains || [],
});

/**
 * @param {string|null} modelId          the report's data model; null = no model assistant here
 * @param {function} [onModelChanged]    a card was applied: the model is saved, the screen reads it again
 * @returns {{ messages, loading, applying, send, cancel, reset, setOutcome, mark, apply, applyShape }}
 *          `send(text)` reads the model first when it was not read yet — and ALWAYS reads it again
 *          when `fresh` is asked: a request handed over may follow a card that just changed the model
 */
export function useModelAssistant({ modelId, onModelChanged }) {
  // The model as read: in a ref for the body of the next turn (set as soon
  // as it is read, not on the next render), in state for the screen.
  const latestRef = useRef(null);
  const [, setState] = useState(null);
  const [applying, setApplying] = useState(''); // what the screen says while a card is applied
  // A message to send once the previous turn is over: the assistant asked
  // to go on after a card added or reshaped tables.
  const [pending, setPending] = useState(null);

  const load = useCallback(async () => {
    const cur = await readModel(modelId);
    latestRef.current = cur;
    setState(cur);
    return cur;
  }, [modelId]);

  // `shapes`: a card may reshape a file (the route below); `report`: a report
  // sits beside the model, its assistant can take a request.
  const getExtraBody = useCallback(() => ({ draft: latestRef.current ? draftOf(latestRef.current) : {}, shapes: true, report: true }), []);
  const chat = useAiChat(`/ai/models/${modelId}/model-chat`, getExtraBody);
  const { send: chatSend, loading } = chat;

  const send = useCallback(async (text, { fresh = false } = {}) => {
    if (!modelId) return false;
    if (fresh || !latestRef.current) {
      try { await load(); } catch { toast('The data model could not be read'); return false; }
    }
    return chatSend(text);
  }, [modelId, load, chatSend]);

  useEffect(() => {
    if (!pending || loading) return;
    setPending(null);
    chatSend(pending);
  }, [pending, loading, chatSend]);

  // The model as the server holds it NOW, not as this hook read it: the
  // report assistant writes measures on the same model between two cards,
  // and a card saved on a stale copy erased them (seen with Karim).
  const fresh = async () => {
    try { return await load(); } catch { return latestRef.current; /* unreadable now: the copy in hand */ }
  };

  // Applied as the model editor applies it (utils/modelProposal.js), then
  // saved: tables a card adds come in as the editor loads them — columns read,
  // flagged, joined by the column names.
  const apply = async (proposal) => {
    setApplying('Saving the data model…');
    const cur = await fresh();
    if (!cur) { setApplying(''); return false; }
    try {
      const { model, all, columns } = cur;
      const dataTypeOf = (t, c) => (columns[t] || []).find((x) => x.column_name === c)?.data_type;
      const typeOf = (t, c) => readOverride(model.column_types?.[`${t}.${c}`])?.type || getColumnType(dataTypeOf(t, c));
      const next = applyModelProposal({ joins: model.joins, dimensions: model.dimensions, measures: model.measures, tablePositions: model.table_positions, domains: model.domains }, proposal, { typeOf, dataTypeOf });
      const added = (proposal.addTables || []).filter((t) => all.includes(t) && !(model.selected_tables || []).includes(t));
      const tables = [...(model.selected_tables || []), ...added];
      const loaded = { ...columns };
      for (const t of added) {
        loaded[t] = (await api.get(`/models/${modelId}/tables/${encodeURIComponent(t)}/columns`)).data.columns || [];
        const auto = autoFlagColumns(t, loaded[t]);
        if (!next.dimensions.some((d) => d.table === t)) next.dimensions.push(...auto.dimensions);
        if (!next.measures.some((m) => m.table === t)) next.measures.push(...auto.measures);
      }
      let n = Object.keys(next.tablePositions).length;
      for (const t of tables) if (!next.tablePositions[t]) next.tablePositions[t] = placed(n++);
      if (added.length) {
        try {
          const names = Object.fromEntries(tables.map((t) => [t, (loaded[t] || []).map((c) => c.column_name)]));
          const found = (await api.post(`/datasources/${model.datasource_id}/relationships`, { tables, columns: names, joins: next.joins, roles: rolesOf(next.tablePositions), byName: true })).data;
          next.joins = [...next.joins, ...(found.joins || []).map(({ reason: _r, ...j }) => j)];
          for (const [t, role] of Object.entries(found.roles || {})) if (!next.tablePositions[t]?.tableType) next.tablePositions[t] = { ...next.tablePositions[t], tableType: role };
        } catch { /* keys unreadable: the assistant proposes the joins on its next turn */ }
      }
      await api.put(`/models/${modelId}`, { selected_tables: tables, joins: next.joins, dimensions: next.dimensions, measures: next.measures, table_positions: next.tablePositions, domains: next.domains });
      await load();
      onModelChanged?.();
      if (added.length) setPending(CONTINUE);
      return true;
    } catch (err) {
      toast(err.response?.data?.error || 'The data model could not be saved');
      return false;
    } finally {
      setApplying('');
    }
  };

  // The file rewritten by its own route, with the user's rights, then the
  // model saved on the tables it holds now: the reshaped table's fields are
  // flagged anew; the joins are for the assistant to propose next, and the
  // user to validate.
  const applyShape = async (proposal) => {
    setApplying('Reshaping the file and saving the model…');
    const cur = await fresh();
    if (!cur) { setApplying(''); return false; }
    try {
      const { model } = cur;
      await api.post(`/upload/${proposal.sourceId}/shape`, { table: proposal.shape.table, shape: proposal.shape });
      const gone = new Set([proposal.table, ...proposal.outputs]);
      const tables = [...(model.selected_tables || []).filter((t) => !gone.has(t)), ...proposal.outputs];
      const dimensions = (model.dimensions || []).filter((d) => !gone.has(d.table));
      const measures = (model.measures || []).filter((m) => !gone.has(m.table));
      const joins = (model.joins || []).filter((j) => !gone.has(j.from_table) && !gone.has(j.to_table));
      const positions = Object.fromEntries(Object.entries(model.table_positions || {}).filter(([t]) => !gone.has(t)));
      let n = Object.keys(positions).length;
      for (const t of proposal.outputs) {
        const cols = (await api.get(`/models/${modelId}/tables/${encodeURIComponent(t)}/columns`)).data.columns || [];
        const auto = autoFlagColumns(t, cols);
        dimensions.push(...auto.dimensions);
        measures.push(...auto.measures);
        positions[t] = placed(n++);
      }
      await api.put(`/models/${modelId}`, { selected_tables: tables, joins, dimensions, measures, table_positions: positions });
      await load();
      onModelChanged?.();
      // Named as the model names them (alias__table): a short name cost the assistant a repair round.
      setPending(SHAPED(proposal.outputs));
      return true;
    } catch (err) {
      toast(err.response?.data?.error || 'The file could not be reshaped');
      return false;
    } finally {
      setApplying('');
    }
  };

  return { ...chat, send, applying, apply, applyShape };
}
