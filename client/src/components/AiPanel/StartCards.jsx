import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbDatabase, TbUpload, TbSchema, TbLayoutDashboard, TbSparkles, TbCheck } from 'react-icons/tb';
import api from '../../utils/api';
import { toast } from '../Toast/toast';
import { handOver } from '../../utils/assistantHandoff';
import { useGraph } from '../../hooks/graphContext';
import { useTheme } from '../../hooks/useTheme';
import { FILE_IMPORT_ACCEPT } from '../../utils/sourceFiles';
import Modal from '../Modal/Modal';
import DatasourceForm, { createModelAndNavigate } from '../DatasourceForm/DatasourceForm';
import FileImportDialog from '../FileImportDialog/FileImportDialog';
import { cardStyle, rowStyle, iconStyle, titleStyle, subStyle, selectStyle, actionsStyle, quietBtn, applyBtn, doneStyle } from './actionCardStyles';

// The first steps, handed over by the Assistant panel as cards: connect a
// database, import a file, build a data model, start a report. The assistant
// only proposes; each card goes through the ordinary routes and forms, with
// the user's own rights. Connection details are typed in the usual form and
// the file goes from the browser to the upload route: neither reaches the AI.
//
// Once data is in, the card offers the next step — a data model prepared by
// the model assistant — carrying on what the user said they wanted
// (`proposal.request`): it then waits for the model ("Continue to your report").

const MODEL_REQUEST = 'Pick the tables that matter and build the model: joins, dimensions and measures.';

function useBuildModel(request) {
  const navigate = useNavigate();
  const { currentWsKey } = useGraph();
  return (datasource) => createModelAndNavigate(navigate, datasource, {
    request: request || MODEL_REQUEST,
    ...(request ? { reportRequest: request } : {}),
    workspaceId: currentWsKey,
  });
}

function Shell({ icon: Icon, title, summary, children }) {
  return (
    <div style={cardStyle}>
      <div style={rowStyle}>
        <Icon size={18} style={iconStyle} />
        <div style={{ minWidth: 0 }}>
          <div style={titleStyle}>{title}</div>
          {summary ? <div style={subStyle}>{summary}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

// The data is in: its name, and the model to build on it.
function DataIn({ datasource, request }) {
  const build = useBuildModel(request);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <span style={doneStyle}><TbCheck size={14} /> {datasource.name} is ready</span>
      <div style={actionsStyle}>
        <button style={applyBtn(!busy)} disabled={busy} onClick={async () => { setBusy(true); if (!(await build(datasource))) setBusy(false); }}>
          <TbSparkles size={14} /> {busy ? 'Opening…' : 'Build a data model with the assistant'}
        </button>
      </div>
    </>
  );
}

function ConnectDatabaseCard({ proposal, finish }) {
  const { currentWsKey, refresh } = useGraph();
  const [open, setOpen] = useState(false);
  const [datasource, setDatasource] = useState(null);
  return (
    <Shell icon={TbDatabase} title="Connect a database" summary={proposal.summary}>
      {datasource ? <DataIn datasource={datasource} request={proposal.request} /> : (
        <div style={actionsStyle}>
          <button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button>
          <button style={applyBtn(true)} onClick={() => setOpen(true)}><TbDatabase size={14} /> Connect a database</button>
        </div>
      )}
      {open && (
        <Modal onClose={() => setOpen(false)} width={560}>
          <DatasourceForm
            workspaceId={currentWsKey}
            onSaved={({ datasource: saved }) => { setOpen(false); setDatasource(saved); refresh(); finish('applied'); }}
            onCancel={() => setOpen(false)}
          />
        </Modal>
      )}
    </Shell>
  );
}

function ImportFileCard({ proposal, finish }) {
  const { currentWsKey, refresh } = useGraph();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [datasource, setDatasource] = useState(null);
  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };
  return (
    <Shell icon={TbUpload} title="Import a file" summary={proposal.summary}>
      {datasource ? <DataIn datasource={datasource} request={proposal.request} /> : (
        <>
          <button type="button" style={dropStyle(over)} onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
            <TbUpload size={18} />
            <span>Drop your file here, or click to choose it</span>
            <span style={subStyle}>CSV, Excel, Parquet, JSON</span>
          </button>
          <input ref={inputRef} type="file" accept={FILE_IMPORT_ACCEPT} style={hiddenStyle} aria-label="File to import"
            onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} />
          <div style={actionsStyle}><button style={quietBtn} onClick={() => finish('dismissed')}>Dismiss</button></div>
        </>
      )}
      {file && (
        <FileImportDialog
          file={file} mode="create" workspaceId={currentWsKey}
          onDone={(data) => { setFile(null); setDatasource(data.datasource); refresh(); finish('applied'); }}
          onFailed={refresh} onCancel={() => setFile(null)}
        />
      )}
    </Shell>
  );
}

function BuildModelCard({ proposal, finish }) {
  const { scopedDatasources } = useGraph();
  // A source a model here reads without sharing it is a locked stand-in.
  const sources = scopedDatasources.filter((d) => !d.notShared);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const build = useBuildModel(proposal.request);
  const chosen = sources.find((d) => d.id === picked) || sources[sources.length - 1];
  const go = async () => {
    setBusy(true);
    if (await build(chosen)) finish('applied');
    else setBusy(false);
  };
  return (
    <Shell icon={TbSchema} title="Build a data model" summary={proposal.summary}>
      {!sources.length ? <div style={subStyle}>No data source here yet: import a file or connect a database first.</div> : (
        <>
          {sources.length > 1 && (
            <select style={selectStyle} value={chosen.id} onChange={(e) => setPicked(e.target.value)} aria-label="Data source">
              {sources.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div style={actionsStyle}>
            <button style={quietBtn} onClick={() => finish('dismissed')} disabled={busy}>Dismiss</button>
            <button style={applyBtn(!busy)} onClick={go} disabled={busy}>
              <TbSparkles size={14} /> {busy ? 'Opening…' : `Build it on ${sources.length > 1 ? 'this source' : chosen.name}`}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function CreateReportCard({ proposal, finish }) {
  const navigate = useNavigate();
  const { selectedWs } = useGraph();
  const { resolved, themes } = useTheme();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post('/reports', {
        // Blank until its first save: listed nowhere, dropped if left unsaved.
        draft: true,
        title: 'Untitled Report', autoTitle: true, modelId: proposal.modelId,
        ...(selectedWs ? { workspaceId: selectedWs } : {}),
        settings: { theme: themes[resolved] ? { key: resolved, ...themes[resolved] } : null },
      });
      const reportId = res.data.report.id;
      handOver('report', reportId, proposal.request);
      finish('applied');
      navigate(`/edit/${reportId}?assistant=1`);
    } catch (err) {
      setBusy(false);
      toast(err.response?.data?.error || 'Failed to create report');
    }
  };
  return (
    <Shell icon={TbLayoutDashboard} title="Build this report" summary={proposal.summary}>
      <div style={quoteStyle}>{proposal.request}</div>
      <div style={actionsStyle}>
        <button style={quietBtn} onClick={() => finish('dismissed')} disabled={busy}>Dismiss</button>
        <button style={applyBtn(!busy)} onClick={create} disabled={busy}>
          <TbSparkles size={14} /> {busy ? 'Creating…' : 'Build this report'}
        </button>
      </div>
    </Shell>
  );
}

const CARDS = { connect_database: ConnectDatabaseCard, import_file: ImportFileCard, build_model: BuildModelCard, create_report: CreateReportCard };

export default function StartCard({ proposal, onOutcome }) {
  const [state, setState] = useState('open');
  const finish = (next) => { setState(next); onOutcome?.(next); };
  if (state === 'dismissed') return <div style={subStyle}>Dismissed</div>;
  const Card = CARDS[proposal.action];
  return <Card proposal={proposal} finish={finish} />;
}

const dropStyle = (over) => ({
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '16px 12px', width: '100%',
  fontSize: 12.5, fontFamily: 'inherit', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 10,
  border: `1.5px dashed ${over ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
  background: over ? 'var(--accent-primary-soft)' : 'var(--bg-panel)',
});
const hiddenStyle = { display: 'none' };
const quoteStyle = {
  fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-secondary)', padding: '6px 10px',
  borderLeft: '3px solid var(--accent-primary)', background: 'var(--bg-panel)', borderRadius: 4,
};
