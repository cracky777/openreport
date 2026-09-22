// Built-in template for the sandbox iframe. The bundle is injected as a regular
// <script> tag, so the visual.js file just needs to call OpenReportRegisterVisual({...}).
//
// `sandbox="allow-scripts"` (no allow-same-origin) puts the iframe in a unique
// opaque origin: it can run JS but cannot read parent cookies, localStorage,
// the parent DOM, or make same-origin fetches. Communication is postMessage-only.

// What the sandbox attribute does NOT stop is the visual calling out: an
// uploaded visual may legitimately pull a library from a CDN. Code written by
// the assistant gets no such latitude — it may have been steered by text in the
// data it was shown, and it receives the report's rows — so its document is
// served with every outbound channel a CSP can close, closed.
//
// A meta CSP cannot stop the frame from navigating itself away
// (`location.href = …`); the widget watches for that and blanks the frame.
export const NO_NETWORK_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'; base-uri 'none'";

export function buildSrcDoc(bundle, { restrictNetwork = false } = {}) {
  // Defang any literal `</script>` inside the bundle so it doesn't break the
  // outer <script> tag we're injecting it into.
  const safe = String(bundle || '').replace(/<\/script/gi, '<\\/script');
  // First child of <head>: a policy only binds what is parsed after it.
  const csp = restrictNetwork ? `<meta http-equiv="Content-Security-Policy" content="${NO_NETWORK_CSP}">\n` : '';
  return `<!DOCTYPE html>
<html>
<head>
${csp}<meta charset="utf-8">
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
        // Same shape as render's ctx, callbacks included: a visual that
        // rebuilds its DOM on update (the template does) wires its click
        // handlers from this ctx, and without callbacks cross-filtering
        // silently stopped after the first data update.
        if (visual && typeof visual.update === 'function') {
          visual.update({ data: m.data, config: m.config, width: m.width, height: m.height, callbacks: callbacks });
        }
      } else if (m.type === 'click') {
        // A click the host caught on its shield, replayed on whatever the
        // visual drew at that spot.
        var hit = document.elementFromPoint(m.x, m.y);
        if (hit) hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: m.x, clientY: m.y }));
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
