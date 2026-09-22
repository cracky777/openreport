// The user guide the assistant answers "how do I…?" from (help.md, next to
// this file). Read on demand through the `read_help` tool, by section: the
// whole guide in every prompt would be paid for on every question, and most
// questions are about data, not about the tool.
//
// The model is told to answer from these sections only: an assistant that
// improvises a menu that does not exist is worse than one that says it does
// not know.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'help.md');
const MAX_ANSWER_CHARS = 12000;
const MAX_TOPICS = 4;
// "## schedules — Scheduling a report" (an em dash, or a plain hyphen)
const HEADING = /^##\s+([a-z0-9][a-z0-9-]{0,40})\s+[—-]\s+(.+?)\s*$/;

function parseHelp(text) {
  const sections = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      current = { id: m[1], title: m[2], lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map(({ id, title, lines }) => ({ id, title, body: lines.join('\n').trim() }));
}

let loaded = null;
function sections() {
  if (!loaded) {
    try { loaded = parseHelp(fs.readFileSync(FILE, 'utf8')); } catch { loaded = []; /* no guide shipped: no help tool */ }
  }
  return loaded;
}

/** @returns {{id: string, title: string}[]} */
function helpTopics() {
  return sections().map(({ id, title }) => ({ id, title }));
}

/** The sections asked for, by id: `{ help }`, or `{ error }` naming the valid ids. */
function readHelp(ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((v) => typeof v === 'string').slice(0, MAX_TOPICS));
  const found = sections().filter((s) => wanted.has(s.id));
  if (!found.length) return { error: `Unknown help topic. One of: ${sections().map((s) => s.id).join(', ')}` };
  return { help: found.map((s) => s.body).join('\n\n').slice(0, MAX_ANSWER_CHARS) };
}

module.exports = { helpTopics, readHelp, parseHelp, MAX_TOPICS };
