// A first look at code the assistant wrote, before anyone is offered it.
//
// NOT a security boundary: a regex over JavaScript is trivially dodged by
// someone trying. The threat here is a model that was steered by text in a
// cached row into writing a visual that ships the data somewhere — and that
// writes `fetch(` like everyone else. The real fences are the sandboxed iframe,
// the no-network CSP applied to AI-origin visuals, and the workspace admin
// reading the code before adding it to the library.
const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bEventSource\b/, 'EventSource'],
  [/\bsendBeacon\b/, 'sendBeacon'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\bimportScripts\b/, 'importScripts'],
  [/\blocation\b/, 'location'],
  [/\bwindow\s*\.\s*open\b/, 'window.open'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/<\s*script/i, '<script>'],
  [/<\s*i?frame/i, '<iframe>'],
  [/\.src\s*=/, 'setting .src'],
  // The W3C namespaces are identifiers, not addresses: createElementNS needs
  // 'http://www.w3.org/2000/svg' to draw anything at all.
  [/\bhttps?:\/\/(?!www\.w3\.org\/)/i, 'an http(s) URL'],
];

/** @returns {string[]} what the code uses that a generated visual may not */
function lintVisualCode(code) {
  const src = String(code || '');
  return FORBIDDEN.filter(([re]) => re.test(src)).map(([, label]) => label);
}

module.exports = { lintVisualCode };
