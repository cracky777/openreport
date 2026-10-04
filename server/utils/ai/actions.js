// Things the assistant can do FOR the user rather than explain — as proposals,
// like everything it produces. It has no tool that writes: the card it hands
// over is applied by the user's own click, through the ordinary API route and
// the user's own rights (a model steered by text sitting in the data must not
// be able to act on its own).
//
// The report and Ask assistants do not change the data model: that is the
// model assistant's job, in the model editor. Asked to, they hand over a card
// that opens it — only to who may change the model; the others are told who can.
//
// The model never writes a cron expression: it says how often, which day and
// at what time; the server builds the expression and checks it.
//
// The Assistant panel is where newcomers land, so it also opens the steps
// before any report: a card that opens the database connection form, one that
// takes a file (the file goes from the browser to the upload route, never to
// the AI provider; connection details are typed in the form, never in the
// chat), one that builds a data model on a source, one that starts a report
// from what the user described. Opening a form does nothing by itself: those
// two are offered to a "how do I…?" too.

const { validateCron } = require('../cacheSchedules');

const ACTIONS = ['schedule_cache_refresh', 'open_model_assistant', 'connect_database', 'import_file', 'build_model', 'create_report'];
// What each assistant may hand over.
const ACTIONS_FOR = {
  editor: ['schedule_cache_refresh', 'open_model_assistant'],
  ask: ['schedule_cache_refresh', 'open_model_assistant', 'create_report', 'connect_database', 'import_file'],
  help: ['connect_database', 'import_file', 'build_model'],
};
const OPENS_A_FORM = new Set(['connect_database', 'import_file']);
const FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const MAX_SUMMARY = 200;
const MAX_REQUEST = 500;

function scheduleOf(args) {
  const frequency = FREQUENCIES.includes(args.frequency) ? args.frequency : null;
  if (!frequency) return { error: `frequency must be one of ${FREQUENCIES.join(', ')}` };
  const time = typeof args.time === 'string' && TIME.test(args.time.trim()) ? args.time.trim() : '08:00';
  const [h, m] = time.split(':').map(Number);
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (frequency === 'hourly') return { cron: `${m} * * * *`, schedule: { frequency, time: `:${String(m).padStart(2, '0')}` } };
  if (frequency === 'daily') return { cron: `${m} ${h} * * *`, schedule: { frequency, time: hhmm } };
  if (frequency === 'weekly') {
    const day = WEEKDAYS.indexOf(args.weekday);
    if (day === -1) return { error: `a weekly schedule needs weekday: one of ${WEEKDAYS.join(', ')}` };
    return { cron: `${m} ${h} * * ${day}`, schedule: { frequency, weekday: args.weekday, time: hhmm } };
  }
  const monthDay = Math.floor(Number(args.monthDay));
  // Up to the 28th: a day every month has.
  if (!(monthDay >= 1 && monthDay <= 28)) return { error: 'a monthly schedule needs monthDay between 1 and 28' };
  return { cron: `${m} ${h} ${monthDay} * *`, schedule: { frequency, monthDay, time: hhmm } };
}

/**
 * @param {{canEditModel?: boolean, allowed?: string[]}} ctx whether the user may change the data model; the actions this assistant may hand over
 * @returns {{ action: object|null, errors: string[] }} `action` is what the card applies
 */
function validateActionProposal(args, { canEditModel = false, allowed = ACTIONS_FOR.editor } = {}) {
  const a = args && typeof args === 'object' ? args : {};
  if (!allowed.includes(a.action)) return { action: null, errors: [`action must be one of ${allowed.join(', ')}`] };
  // Asked "how do I schedule a report?", a real model scheduled one: the user
  // wanted to learn how. The model says which it read — being asked to do it,
  // or asked how — and only the first gets a card. A card that only opens a
  // form goes with the explanation either way: it does nothing by itself.
  if (a.userAsked !== 'do' && !OPENS_A_FORM.has(a.action)) {
    return { action: null, errors: ['the user asked HOW, not to do it: answer with the steps from read_help, then offer in one sentence to do it for them'] };
  }
  const summary = typeof a.summary === 'string' ? a.summary.slice(0, MAX_SUMMARY) : '';
  const request = typeof a.request === 'string' ? a.request.trim().slice(0, MAX_REQUEST) : '';
  if (OPENS_A_FORM.has(a.action)) return { action: { action: a.action, summary, request }, errors: [] };
  if (a.action === 'build_model' || a.action === 'create_report') {
    if (!request) return { action: null, errors: [`${a.action} needs request: what the user wants, in their words`] };
    return { action: { action: a.action, summary, request }, errors: [] };
  }
  if (a.action === 'open_model_assistant') {
    if (!canEditModel) return { action: null, errors: ['this user cannot change the data model: no card — say in one sentence that its owner or an admin can, with the model assistant of the model editor'] };
    return { action: { action: a.action, summary, request }, errors: [] };
  }
  const built = scheduleOf(a);
  if (built.error) return { action: null, errors: [built.error] };
  const cronError = validateCron(built.cron);
  if (cronError) return { action: null, errors: [cronError] };
  return {
    action: {
      action: a.action,
      cron: built.cron,
      schedule: built.schedule,
      summary,
    },
    errors: [],
  };
}

module.exports = { validateActionProposal, ACTIONS, ACTIONS_FOR, FREQUENCIES, WEEKDAYS };
