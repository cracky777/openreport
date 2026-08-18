// Tokenizer for the SQL expression editor's syntax highlighting. Pure and
// lossless: concatenating the returned token texts always rebuilds the input
// exactly, which the editor relies on to keep its highlight layer aligned
// with the textarea's caret.

const KEYWORDS = new Set([
  'case', 'when', 'then', 'else', 'end', 'and', 'or', 'not', 'in', 'is',
  'null', 'like', 'ilike', 'between', 'distinct', 'as', 'from', 'where',
  'select', 'group', 'by', 'order', 'having', 'cast', 'interval', 'true',
  'false', 'exists', 'over', 'partition', 'filter',
]);

const FUNCTIONS = new Set([
  'sum', 'avg', 'count', 'min', 'max', 'nullif', 'coalesce', 'round', 'abs',
  'floor', 'ceil', 'ceiling', 'concat', 'upper', 'lower', 'substr',
  'substring', 'trim', 'length', 'replace', 'date_trunc', 'extract', 'now',
  'current_date', 'current_timestamp', 'greatest', 'least', 'power', 'sqrt',
  'exp', 'ln', 'log', 'mod', 'sign', 'if', 'ifnull', 'isnull',
]);

// Order matters: comments and strings first so their content is never
// re-tokenized, then ${calc} refs, quoted identifiers, numbers, words.
const TOKEN_RE = /(--[^\n]*)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\$\{[^}]*\}?)|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_][a-zA-Z0-9_]*)|(\s+)|([\s\S])/g;

export function tokenizeSql(input) {
  const tokens = [];
  if (!input) return tokens;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(input)) !== null) {
    const [text, comment, str, ident, calc, num, word, ws] = m;
    let type;
    if (comment) type = 'comment';
    else if (str) type = 'string';
    else if (ident) type = 'identifier';
    else if (calc) type = 'calc';
    else if (num) type = 'number';
    else if (word) {
      const lower = word.toLowerCase();
      type = KEYWORDS.has(lower) ? 'keyword' : FUNCTIONS.has(lower) ? 'function' : 'word';
    } else if (ws) type = 'ws';
    else type = 'op';
    tokens.push({ type, text });
  }
  return tokens;
}
