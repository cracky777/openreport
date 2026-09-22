// Names and ids the seed writes and the specs read back. Kept in one place so a
// spec never has to guess what the fixture looks like.
const path = require('path');
const http = require('http');

// An OpenAI-compatible endpoint answering with whatever tool call `script`
// picks. `requests` keeps every body received, so a spec can read what the
// assistant was shown.
function startScriptedProvider(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const toolTurns = body.messages.filter((m) => m.role === 'tool').length;
      const call = script(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: toolTurns === 0 ? '' : 'Here is a bar chart.',
            tool_calls: [{ id: `c${toolTurns}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }],
          },
        }],
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}/v1` }));
  });
}

module.exports = {
  startScriptedProvider,
  AUTH_STATE: path.join(__dirname, '.tmp', 'auth.json'),
  IDS_FILE: path.join(__dirname, '.tmp', 'ids.json'),
  USER: { email: 'e2e@open-report.local', password: 'e2e-password-1234' },
  // Labels, not names: the query response is keyed on the label, and so are the
  // widgets that read it.
  DIM_LABEL: 'Country',
  MEASURE_LABEL: 'Sales',
  DIM: 'sales.country',
  // Bound to no widget on purpose: the touch-drag spec needs a field it can
  // actually drop somewhere.
  SPARE_DIM: 'sales.city',
  SPARE_DIM_LABEL: 'City',
  MEASURE: 'sales.amt_sum',
  // The title report B already occupies. Renaming A onto it is what makes the
  // server answer 409.
  TAKEN_TITLE: 'Titre deja pris',
};
