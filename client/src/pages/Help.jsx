import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TbArrowLeft, TbBook, TbSearch } from 'react-icons/tb';
import api from '../utils/api';
import AssistantText from '../components/AiPanel/AssistantText';
import { useIsCompact } from '../hooks/useMediaQuery';
import { guideBlocks } from '../utils/guideBlocks';

// The user guide, for reading without the AI assistant: the same help.md the
// assistant answers from, section by section. Only the guide's own marks are
// read (bullets, nested bullets, numbered steps, **bold**, `code`) — into React
// elements, never as HTML.

function Blocks({ body }) {
  return guideBlocks(body).map((b, i) => {
    if (b.kind === 'p') return <AssistantText key={i} style={paraStyle} text={b.text} />;
    if (b.kind === 'ol') return <ol key={i} style={listStyle}>{b.items.map((t, j) => <li key={j} style={itemStyle}><AssistantText text={t} /></li>)}</ol>;
    return (
      <ul key={i} style={listStyle}>
        {b.items.map((it, j) => (
          <li key={j} style={itemStyle}>
            <AssistantText text={it.text} />
            {it.children.length > 0 && (
              <ul style={nestedStyle}>{it.children.map((c, k) => <li key={k} style={itemStyle}><AssistantText text={c} /></li>)}</ul>
            )}
          </li>
        ))}
      </ul>
    );
  });
}

export default function Help() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const compact = useIsCompact();
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.get('/help')
      .then((res) => setSections(res.data.sections || []))
      .catch((err) => setError(err.response?.data?.error || 'The guide could not be loaded'));
  }, []);

  // A link to one section (/help#sharing) lands on it once the guide is here.
  useEffect(() => {
    if (!sections || !hash) return;
    document.getElementById(`help-${hash.slice(1)}`)?.scrollIntoView();
  }, [sections, hash]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!sections || !q) return sections || [];
    return sections.filter((s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q));
  }, [sections, query]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <button className="btn-hover" onClick={() => navigate('/')} style={backBtn}>
          <TbArrowLeft size={16} /> Back
        </button>
        <div style={titleStyle}><TbBook size={18} /> User guide</div>
        <label style={searchStyle}>
          <TbSearch size={15} color="var(--text-muted)" />
          <input style={searchInput} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the guide" aria-label="Search the guide" />
        </label>
      </header>

      <div style={compact ? compactBodyStyle : bodyStyle}>
        {!compact && sections && (
          <nav style={navStyle} aria-label="Topics">
            {shown.map((s) => (
              <a key={s.id} href={`#${s.id}`} style={navLink}
                onClick={(e) => { e.preventDefault(); document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                {s.title}
              </a>
            ))}
          </nav>
        )}
        <main style={mainStyle}>
          {error && <p style={mutedStyle}>{error}</p>}
          {!sections && !error && <p style={mutedStyle}>Loading…</p>}
          {sections && !shown.length && <p style={mutedStyle}>Nothing in the guide matches “{query.trim()}”.</p>}
          {shown.map((s) => (
            <section key={s.id} id={`help-${s.id}`} style={sectionStyle}>
              <h2 style={sectionTitle}>{s.title}</h2>
              <Blocks body={s.body} />
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', backgroundColor: 'var(--bg-app)' };
const headerStyle = {
  position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 20px',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)',
};
const backBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  fontSize: 13, borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)',
};
const titleStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' };
const searchStyle = {
  display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', padding: '6px 10px', width: 'min(280px, 100%)', boxSizing: 'border-box',
  border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-app)',
};
const searchInput = { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-primary)' };
const bodyStyle = { display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 32, maxWidth: 1100, margin: '0 auto', padding: '28px 20px' };
const compactBodyStyle = { padding: '20px 16px' };
const navStyle = { position: 'sticky', top: 80, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' };
const navLink = { padding: '5px 8px', fontSize: 13, borderRadius: 6, color: 'var(--text-secondary)', textDecoration: 'none' };
const mainStyle = { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 };
const sectionStyle = {
  padding: '18px 22px', borderRadius: 10, border: '1px solid var(--border-default)', background: 'var(--bg-panel)', scrollMarginTop: 80,
};
const sectionTitle = { margin: '0 0 10px', fontSize: 16, fontWeight: 650, color: 'var(--text-primary)' };
const paraStyle = { margin: '0 0 8px', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)' };
const listStyle = { margin: '0 0 8px', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-primary)' };
const nestedStyle = { margin: '2px 0', paddingLeft: 18 };
const itemStyle = { margin: '2px 0' };
const mutedStyle = { fontSize: 13, color: 'var(--text-muted)' };
