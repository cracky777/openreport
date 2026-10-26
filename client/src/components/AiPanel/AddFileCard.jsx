import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbFilePlus, TbCheck, TbCloudUpload, TbArrowRight, TbSparkles } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import ImportFileList from '../FileImportDialog/ImportFileList';
import { useFileOptions, missingSheets, acceptFiles } from '../../utils/importFiles';
import { uploadEach } from '../../utils/multiFileImport';
import { autoFlagColumns } from '../../utils/autoFlagColumns';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, actionsStyle, quietBtn, applyBtn, doneStyle } from './actionCardStyles';

// The data the user asks for is not in the model (a budget, targets, another
// table): instead of sending them to the model editor, the card takes the
// file here. Dropped, it is imported as a source of the workspace, linked to
// the model (a model on files may read several), its tables read, and the
// joins with the model's tables found from the column names (server:
// utils/relationships.js) — shown for the user to confirm, untick or refuse.
// Confirmed, the model is saved with the new tables (columns flagged as the
// model editor does), the joins kept and the table roles found; the
// assistant is then told, and goes on with the request. The file goes from
// the browser to the upload route, never to the AI provider.
//
// No join found from the names: in the studio the tables are saved all the
// same and the model assistant is asked, in the same conversation, to find how they
// join — reshaping the file first when its layout needs it (`onAskModel`).

const dropStyle = (over) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '18px 12px', borderRadius: 10,
  border: `2px dashed ${over ? 'var(--accent-primary)' : 'var(--border-strong)'}`, color: over ? 'var(--accent-primary)' : 'var(--text-muted)',
  fontSize: 12.5, background: over ? 'var(--accent-primary-soft)' : 'transparent', transition: 'border-color 0.15s',
});
const joinRow = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, lineHeight: 1.4 };
const joinText = { display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, flexWrap: 'wrap' };
const codeStyle = { fontFamily: 'monospace', fontSize: 12, padding: '1px 5px', borderRadius: 4, background: 'var(--bg-subtle)' };
const noteStyle = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 };
const errorStyle = { fontSize: 12, color: 'var(--state-danger)', lineHeight: 1.4 };

// A table of a linked file is "alias__table" to the model: shown by its own name.
const shortName = (t) => String(t).split('__').pop();
// Where the schema canvas draws a table that was never placed: the grid of
// the model editor, three to a row, after those already there.
const placed = (i) => ({ x: 40 + (i % 3) * 260, y: 40 + Math.floor(i / 3) * 300 });

// `initialFiles`: files the user dropped on the conversation, no card asked for (AiPanel).
export default function AddFileCard({ proposal, initialFiles = [], onOutcome, onAnswer, onModelChanged, onAskModel }) {
  const navigate = useNavigate();
  const fileOptions = useFileOptions();
  const [files, setFiles] = useState(initialFiles);
  const [status, setStatus] = useState({});
  const [over, setOver] = useState(false);
  const [state, setState] = useState('open'); // open | importing | review | applying | applied | dismissed
  const [error, setError] = useState('');
  // After the import: the model as read, the tables added, what was found.
  const [found, setFound] = useState(null); // { model, added, joins, roles, skipped, columns, sourceNames }
  const [kept, setKept] = useState([]);

  const finish = (next) => { setState(next); onOutcome?.(next); };
  const draggingFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const drop = (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (state === 'open') { setFiles((prev) => acceptFiles(prev, e.dataTransfer.files)); setError(''); }
  };

  // Import, link, read, detect: then the joins wait for the user.
  const importFiles = async () => {
    setState('importing');
    setError('');
    try {
      const model = (await api.get(`/models/${proposal.modelId}`)).data.model;
      const results = await uploadEach(files, {
        workspaceId: model.workspace_id,
        optionsFor: fileOptions.optionsFor,
        freeName: true,
        onStatus: (i, s, err) => setStatus((prev) => ({ ...prev, [i]: { state: s, error: err } })),
      });
      const ok = results.filter((r) => r.data);
      if (!ok.length) throw new Error(results.find((r) => r.error)?.error || 'The file could not be imported.');
      const added = [];
      const sourceNames = [];
      for (const r of ok) {
        const ds = r.data.datasource;
        const link = (await api.post(`/models/${model.id}/datasources`, { datasourceId: ds.id })).data.datasource;
        sourceNames.push(link.name);
        added.push(...(ds.tables || [{ tableName: ds.tableName }]).map((t) => `${link.alias}__${t.tableName}`));
      }
      const existing = model.selected_tables || [];
      const tables = [...existing, ...added.filter((t) => !existing.includes(t))];
      const columns = {};
      for (const t of tables) {
        columns[t] = (await api.get(`/models/${model.id}/tables/${encodeURIComponent(t)}/columns`)).data.columns || [];
      }
      const roles = Object.fromEntries(Object.entries(model.table_positions || {}).filter(([, p]) => p && p.tableType).map(([t, p]) => [t, p.tableType]));
      const names = Object.fromEntries(tables.map((t) => [t, columns[t].map((c) => c.column_name)]));
      let detected = { joins: [], roles: {}, skipped: [] };
      try {
        detected = (await api.post(`/datasources/${model.datasource_id}/relationships`, { tables, columns: names, joins: model.joins || [], roles, byName: true })).data;
      } catch { /* keys unreadable: the user joins by hand in the model editor */ }
      const joins = (detected.joins || []).map(({ reason: _r, ...j }) => j);
      setFound({ model, added, tables, columns, joins, roles: detected.roles || {}, skipped: detected.skipped || [], sourceNames });
      setKept(joins.map((_, i) => i));
      setState('review');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setState('open');
    }
  };

  // The model saved with the new tables, flagged as the editor flags them,
  // and the joins the user kept. `askAssistant`: the model assistant takes
  // over in the conversation instead of the report's assistant going on.
  const confirm = async ({ askAssistant = false } = {}) => {
    setState('applying');
    try {
      const { model, added, tables, columns, joins, roles } = found;
      const dimensions = [...(model.dimensions || [])];
      const measures = [...(model.measures || [])];
      for (const t of added) {
        const auto = autoFlagColumns(t, columns[t]);
        dimensions.push(...auto.dimensions);
        measures.push(...auto.measures);
      }
      const keptJoins = joins.filter((_, i) => kept.includes(i));
      const positions = { ...(model.table_positions || {}) };
      let n = Object.keys(positions).length;
      for (const t of tables) {
        if (!positions[t]) positions[t] = placed(n++);
        if (roles[t] && !positions[t].tableType) positions[t] = { ...positions[t], tableType: roles[t] };
      }
      await api.put(`/models/${model.id}`, { selected_tables: tables, dimensions, measures, joins: [...(model.joins || []), ...keptJoins], table_positions: positions });
      finish('applied');
      onModelChanged?.();
      if (askAssistant) {
        onAskModel(`I added ${found.sourceNames.join(', ')} to the data model (${added.map(shortName).join(', ')}), but no join with the other tables was found from the column names. Find how ${added.join(', ')} can join the model's tables — reshape the file first if its layout needs it — and propose the joins.`, proposal.request);
        return;
      }
      const joined = keptJoins.length
        ? `joined ${keptJoins.map((j) => `${shortName(j.from_table)}.${j.from_column} → ${shortName(j.to_table)}.${j.to_column}`).join(', ')}`
        : 'with no join to the other tables';
      onAnswer?.(`I added ${found.sourceNames.join(', ')} to the data model (${added.map(shortName).join(', ')}, ${joined}). ${proposal.dropped ? 'It is in the model now.' : `Go on with my request${proposal.request ? `: ${proposal.request}` : ''}.`}`);
    } catch (err) {
      toast(err.response?.data?.error || 'The model could not be saved');
      setState('review');
    }
  };

  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  const busy = state === 'importing' || state === 'applying';
  const noSheet = missingSheets(files, fileOptions.optionsFor);

  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <TbFilePlus size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>Add data to the model</div>
          <div style={subStyle}>{proposal.summary || 'Drop the file that holds it: it joins the model here.'}</div>
        </div>
      </div>

      {(state === 'open' || state === 'importing') && (
        <>
          {!files.length ? (
            <div style={dropStyle(over)} aria-label="Drop the file here"
              onDragOver={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={drop}>
              <TbCloudUpload size={16} /> Drop the file here
            </div>
          ) : (
            <div onDragOver={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); e.stopPropagation(); }} onDrop={drop}>
              <ImportFileList files={files} options={fileOptions} status={status} busy={busy}
                onRemove={busy ? null : (i) => { setFiles((prev) => prev.filter((_, k) => k !== i)); setStatus({}); setError(''); }} />
            </div>
          )}
          {error ? <div style={errorStyle}>{error}</div> : null}
          <div style={actionsStyle}>
            <button style={quietBtn} onClick={() => finish('dismissed')} disabled={busy}>Dismiss</button>
            <button style={applyBtn(files.length > 0 && !noSheet && !busy)} onClick={importFiles} disabled={!files.length || noSheet || busy}>
              <TbFilePlus size={14} /> {state === 'importing' ? 'Importing…' : 'Add to the model'}
            </button>
          </div>
        </>
      )}

      {(state === 'review' || state === 'applying') && found && (
        <>
          <div style={noteStyle}>{found.added.map(shortName).join(', ')} added. {found.joins.length ? 'How it joins the model — untick what is wrong:' : onAskModel ? 'No join found from the column names: the assistant can look for one, or it can be joined by hand in the model editor.' : 'No join found from the column names: it can be joined by hand in the model editor.'}</div>
          {found.joins.map((j, i) => (
            <label key={i} style={joinRow}>
              <input type="checkbox" checked={kept.includes(i)} disabled={busy}
                onChange={(e) => setKept((prev) => (e.target.checked ? [...prev, i] : prev.filter((k) => k !== i)))} />
              <span style={joinText}>
                <span style={codeStyle}>{shortName(j.from_table)}.{j.from_column}</span>
                <TbArrowRight size={12} />
                <span style={codeStyle}>{shortName(j.to_table)}.{j.to_column}</span>
              </span>
            </label>
          ))}
          {found.skipped.length ? <div style={noteStyle}>Left out: {found.skipped.map((s) => `${shortName(s.from_table)} → ${shortName(s.to_table)} (${s.why})`).join('; ')}</div> : null}
          <div style={actionsStyle}>
            <button style={quietBtn} onClick={() => navigate(`/models/${proposal.modelId}`)} disabled={busy}>Open the model editor</button>
            {!found.joins.length && onAskModel ? (<>
              <button style={quietBtn} onClick={() => confirm()} disabled={busy}>Add without a join</button>
              <button style={applyBtn(!busy)} onClick={() => confirm({ askAssistant: true })} disabled={busy}>
                <TbSparkles size={14} /> {state === 'applying' ? 'Saving…' : 'Ask the assistant to join it'}
              </button>
            </>) : (
              <button style={applyBtn(!busy)} onClick={() => confirm()} disabled={busy}>
                <TbCheck size={14} /> {state === 'applying' ? 'Saving…' : found.joins.length ? `Confirm${kept.length ? ` (${kept.length})` : ' without a join'}` : 'Add without a join'}
              </button>
            )}
          </div>
        </>
      )}

      {state === 'applied' && found && (
        <span style={doneStyle}><TbCheck size={14} /> {found.added.map(shortName).join(', ')} in the model</span>
      )}
    </div>
  );
}
