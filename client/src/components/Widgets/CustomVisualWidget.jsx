import { useEffect, useMemo, useRef, useState, memo } from 'react';

// Built-in template for the sandbox iframe. The bundle is injected as a regular
// <script> tag, so the visual.js file just needs to call OpenReportRegisterVisual({...}).
//
// `sandbox="allow-scripts"` (no allow-same-origin) puts the iframe in a unique
// opaque origin: it can run JS but cannot read parent cookies, localStorage,
// the parent DOM, or make same-origin fetches. Communication is postMessage-only.
function buildSrcDoc(bundle) {
  // Defang any literal `</script>` inside the bundle so it doesn't break the
  // outer <script> tag we're injecting it into.
  const safe = String(bundle || '').replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body, #root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #0f172a; background: transparent; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var visual = null;
  var root = document.getElementById('root');
  var post = function (msg) {
    msg.source = 'or-cv';
    parent.postMessage(msg, '*');
  };
  var callbacks = {
    onCrossFilter: function (dim, value) { post({ type: 'crossFilter', dim: dim, value: value }); }
  };

  window.OpenReportRegisterVisual = function (impl) {
    if (!impl || typeof impl.render !== 'function') {
      post({ type: 'error', message: 'Visual must export an object with a render() method' });
      return;
    }
    visual = impl;
    post({ type: 'registered' });
  };

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.source !== 'or-cv-host') return;
    try {
      if (m.type === 'init') {
        if (!visual) { post({ type: 'error', message: 'Visual did not call OpenReportRegisterVisual()' }); return; }
        visual.render(root, { data: m.data, config: m.config, width: m.width, height: m.height, callbacks: callbacks });
        post({ type: 'ready' });
      } else if (m.type === 'update') {
        if (visual && typeof visual.update === 'function') {
          visual.update({ data: m.data, config: m.config, width: m.width, height: m.height });
        }
      } else if (m.type === 'destroy') {
        if (visual && typeof visual.destroy === 'function') visual.destroy();
      }
    } catch (err) {
      post({ type: 'error', message: String((err && err.message) || err) });
    }
  });

  // Capture uncaught errors inside the visual so they surface in the host UI
  window.addEventListener('error', function (e) {
    post({ type: 'error', message: String(e.message || 'Visual runtime error') });
  });

  post({ type: 'loaded' });
})();
</script>
<script>
${safe}
</script>
</body>
</html>`;
}

export default memo(function CustomVisualWidget({ data, config, chartWidth, chartHeight, onDataClick }) {
  const iframeRef = useRef(null);
  const stateRef = useRef({ initSent: false });
  const [error, setError] = useState(null);

  const bundleUrl = config?.bundleUrl;
  const visualId = config?.visualId;

  // Fetch the bundle and seed the iframe srcdoc whenever the visual identity changes
  useEffect(() => {
    if (!bundleUrl) return;
    let cancelled = false;
    setError(null);
    stateRef.current = { initSent: false };

    fetch(bundleUrl, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load visual bundle (' + r.status + ')');
        return r.text();
      })
      .then((bundle) => {
        if (cancelled) return;
        const iframe = iframeRef.current;
        if (!iframe) return;
        iframe.srcdoc = buildSrcDoc(bundle);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message || err));
      });

    return () => { cancelled = true; };
  }, [bundleUrl, visualId]);

  // Listen for messages coming back from the sandbox
  useEffect(() => {
    const handle = (e) => {
      const m = e.data;
      if (!m || m.source !== 'or-cv') return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (m.type === 'loaded') {
        // Sandbox bridge is up — push the initial render payload
        iframeRef.current?.contentWindow?.postMessage({
          source: 'or-cv-host', type: 'init',
          data, config, width: chartWidth, height: chartHeight,
        }, '*');
        stateRef.current.initSent = true;
      } else if (m.type === 'crossFilter' && onDataClick) {
        onDataClick(m.dim, m.value);
      } else if (m.type === 'error') {
        setError(m.message);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
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

  if (!visualId || !bundleUrl) {
    return <div style={emptyStyle}>Pick a custom visual</div>;
  }
  if (error) {
    return <div style={errorStyle}>Custom visual error: {error}</div>;
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      style={{ width: '100%', height: '100%', border: 'none', background: 'transparent' }}
      title={config?.visualName || 'Custom visual'}
    />
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};
const errorStyle = {
  ...emptyStyle, color: 'var(--state-danger)', fontSize: 11,
};
