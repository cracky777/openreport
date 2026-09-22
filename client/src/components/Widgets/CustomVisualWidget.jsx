import { useEffect, useRef, useState, useMemo, memo } from 'react';
import { buildSrcDoc } from '../../utils/customVisualSandbox';

const _hs0 = { width: '100%', height: '100%', border: 'none', background: 'transparent' };
const READY_TIMEOUT_MS = 5000;
const WRAP_STYLE = { position: 'relative', width: '100%', height: '100%' };
// The iframe swallows every pointer event, so in the editor a shield sits
// over it: a mousedown on the shield bubbles up and moves the widget like a
// chart; a click that did not move is replayed inside the visual, so a tile
// still cross-filters. The shield stops short of the right and bottom
// edges, where the visual's own scrollbars live: those stay under the
// pointer, so they can be dragged. The viewer has no shield and talks to
// the iframe directly.
const SCROLLBAR_GUTTER = 17;
const SHIELD_STYLE = { position: 'absolute', top: 0, left: 0, right: SCROLLBAR_GUTTER, bottom: SCROLLBAR_GUTTER, cursor: 'default' };

const ORIGIN_HEADER = 'X-OpenReport-Visual-Origin';
// A widget that has not fetched yet holds `data: {}`. A visual reading
// `data.rows.length` on that throws on its very first render, and the error
// then sticks even once the rows arrive. The contract promises rows and
// fields, so the host keeps the promise from the first message on.
const EMPTY_DATA = { rows: [], fields: { dimensions: [], measures: [] } };

// `inlineBundle` runs code that is not in the library yet — the assistant's
// proposal, previewed before an admin decides to add it. It is always treated
// as AI-written: no network.
export default memo(function CustomVisualWidget({ data: rawData, config, chartWidth, chartHeight, onDataClick, editable, inlineBundle }) {
  const data = useMemo(() => ({ ...EMPTY_DATA, ...(rawData || {}) }), [rawData]);
  const iframeRef = useRef(null);
  // `watchNavigation` + `ownLoadPending`: see handleFrameLoad.
  const stateRef = useRef({ initSent: false, watchNavigation: !!inlineBundle, ownLoadPending: !!inlineBundle });
  const [error, setError] = useState(null);

  const bundleUrl = config?.bundleUrl;
  const visualId = config?.visualId;
  // Given as an attribute, so the frame's first document is ours: assigning
  // srcdoc after mount would put an about:blank load in front of it, and the
  // navigation watch below counts loads.
  const inlineDoc = useMemo(() => (inlineBundle ? buildSrcDoc(inlineBundle, { restrictNetwork: true }) : undefined), [inlineBundle]);

  // Fetch the bundle and seed the iframe srcdoc whenever the visual identity changes
  useEffect(() => {
    if (!bundleUrl || inlineBundle) return;
    let cancelled = false;
    let aiWritten = false;
    setError(null);
    stateRef.current = { initSent: false };

    fetch(bundleUrl, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load visual bundle (' + r.status + ')');
        // Read off the response that carries the code, not off the widget
        // config: a config travels with a report export and can say anything.
        aiWritten = r.headers.get(ORIGIN_HEADER) === 'ai';
        return r.text();
      })
      .then((bundle) => {
        if (cancelled) return;
        const iframe = iframeRef.current;
        if (!iframe) return;
        stateRef.current.watchNavigation = aiWritten;
        stateRef.current.ownLoadPending = true;
        iframe.srcdoc = buildSrcDoc(bundle, { restrictNetwork: aiWritten });
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message || err));
      });

    return () => { cancelled = true; };
  }, [bundleUrl, visualId, inlineBundle]);

  // The CSP on an AI-written visual closes fetch, images, forms and the rest,
  // but no policy a document carries can stop it from navigating itself away
  // with the data in the URL. The first load after we set the document is
  // ours; any later one means the frame went elsewhere. This is detection, not
  // prevention — the request has left by then — so the visual is taken down
  // and the author told, rather than left running.
  const handleFrameLoad = () => {
    const s = stateRef.current;
    if (!s.watchNavigation) return;
    if (s.ownLoadPending) {
      s.ownLoadPending = false;
      return;
    }
    clearTimeout(s.readyTimer);
    setError('This visual tried to navigate away and was stopped. Remove it from the library.');
  };

  // Listen for messages coming back from the sandbox
  useEffect(() => {
    const handle = (e) => {
      const m = e.data;
      if (!m || m.source !== 'or-cv') return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (m.type === 'loaded') {
        // Sandbox bridge is up — push the initial render payload.
        // Sandbox has no allow-same-origin → the iframe's origin is opaque,
        // and an opaque origin cannot be named as a postMessage target: the
        // browser rejects 'null' and the visual would never receive anything.
        // '*' is the only way to reach it; the frame's sandbox is fixed in
        // our own markup, so nothing else can be listening there.
        iframeRef.current?.contentWindow?.postMessage({
          source: 'or-cv-host', type: 'init',
          data, config, width: chartWidth, height: chartHeight,
        }, '*');
        stateRef.current.initSent = true;
        // A visual that never answers leaves a blank box with nothing to go
        // on; say so instead of letting the author guess.
        clearTimeout(stateRef.current.readyTimer);
        stateRef.current.readyTimer = setTimeout(() => {
          setError('The visual did not render within 5 seconds (no "ready" from the sandbox)');
        }, READY_TIMEOUT_MS);
      } else if (m.type === 'ready') {
        clearTimeout(stateRef.current.readyTimer);
      } else if (m.type === 'crossFilter' && onDataClick) {
        onDataClick(m.dim, m.value);
      } else if (m.type === 'error') {
        clearTimeout(stateRef.current.readyTimer);
        setError(m.message);
      }
    };
    window.addEventListener('message', handle);
    return () => {
      window.removeEventListener('message', handle);
      clearTimeout(stateRef.current.readyTimer);
    };
    // We intentionally exclude data/config/dimensions — handled by the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDataClick]);

  // Push updates after the iframe is initialised
  useEffect(() => {
    if (!stateRef.current.initSent) return;
    iframeRef.current?.contentWindow?.postMessage({
      source: 'or-cv-host', type: 'update',
      data, config, width: chartWidth, height: chartHeight,
    }, '*');
  }, [data, config, chartWidth, chartHeight]);

  if (!inlineBundle && (!visualId || !bundleUrl)) {
    return <div style={emptyStyle}>Pick a custom visual</div>;
  }
  if (error) {
    return <div style={errorStyle}>Custom visual error: {error}</div>;
  }

  // Iframe-local CSS pixels: the canvas is scaled to fit, so the on-screen
  // box is smaller than the iframe's own coordinate system.
  const forwardClick = (e) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const r = iframe.getBoundingClientRect();
    const scale = iframe.clientWidth ? r.width / iframe.clientWidth : 1;
    iframe.contentWindow?.postMessage({
      source: 'or-cv-host', type: 'click',
      x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale,
    }, '*');
  };

  return (
    <div style={WRAP_STYLE}>
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={inlineDoc}
        onLoad={handleFrameLoad}
        style={_hs0}
        title={config?.visualName || 'Custom visual'}
      />
      {editable && <div style={SHIELD_STYLE} onClick={forwardClick} />}
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};
const errorStyle = {
  ...emptyStyle, color: 'var(--state-danger)', fontSize: 11,
};
