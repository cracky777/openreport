const { validateActionProposal, ACTIONS_FOR } = require('../utils/ai/actions');

// The model says how often, which day and at what time; the server builds the
// cron expression the schedule route expects. The model never writes one.
describe('what the assistant may do for the user: a cache refresh schedule', () => {
  const plan = (args) => validateActionProposal({ userAsked: 'do', action: 'schedule_cache_refresh', summary: 's', ...args });

  test.each([
    [{ frequency: 'daily', time: '08:30' }, '30 8 * * *', { frequency: 'daily', time: '08:30' }],
    [{ frequency: 'weekly', weekday: 'monday', time: '7:05' }, '5 7 * * 1', { frequency: 'weekly', weekday: 'monday', time: '07:05' }],
    [{ frequency: 'monthly', monthDay: 1, time: '06:00' }, '0 6 1 * *', { frequency: 'monthly', monthDay: 1, time: '06:00' }],
    [{ frequency: 'hourly', time: '00:15' }, '15 * * * *', { frequency: 'hourly', time: ':15' }],
    [{ frequency: 'daily' }, '0 8 * * *', { frequency: 'daily', time: '08:00' }],
  ])('%j → %s', (args, cron, schedule) => {
    const { action, errors } = plan(args);
    expect(errors).toEqual([]);
    expect(action).toEqual({ action: 'schedule_cache_refresh', cron, schedule, summary: 's' });
  });

  test.each([
    [{ action: 'delete_report', frequency: 'daily' }, /action must be one of schedule_cache_refresh/],
    [{ frequency: 'yearly' }, /frequency must be one of/],
    [{ frequency: 'weekly' }, /needs weekday/],
    [{ frequency: 'weekly', weekday: 'lundi' }, /needs weekday/],
    [{ frequency: 'monthly', monthDay: 31 }, /between 1 and 28/],
  ])('%j is refused', (args, message) => {
    const { action, errors } = validateActionProposal({ userAsked: 'do', action: 'schedule_cache_refresh', summary: 's', ...args });
    expect(action).toBeNull();
    expect(errors.join(' ')).toMatch(message);
  });

  // "How do I schedule a report?" is a question: it gets the steps, and an
  // offer to do it — not a card. The model says which it read.
  test.each([['how'], [undefined]])('asked %s: no card, the model is sent back to explaining', (userAsked) => {
    const { action, errors } = validateActionProposal({ userAsked, action: 'schedule_cache_refresh', frequency: 'daily', summary: 's' });
    expect(action).toBeNull();
    expect(errors.join(' ')).toMatch(/asked HOW.*read_help.*offer/);
  });

  test('a time that is not one falls back to 08:00 rather than to whatever the model wrote', () => {
    expect(plan({ frequency: 'daily', time: '25:99; rm -rf' }).action.cron).toBe('0 8 * * *');
  });
});

// The report and Ask assistants do not change the data model; asked to, they
// hand over a card that opens the model editor's assistant.
describe('pointing to the model assistant', () => {
  const open = (args, ctx) => validateActionProposal({ userAsked: 'do', action: 'open_model_assistant', summary: 's', request: 'Join orders to customers', ...args }, ctx);

  test('who may change the model gets the card, with their request', () => {
    expect(open({}, { canEditModel: true })).toEqual({ action: { action: 'open_model_assistant', summary: 's', request: 'Join orders to customers' }, errors: [] });
  });

  test('anyone else: no card, the model is told who can', () => {
    const { action, errors } = open({}, { canEditModel: false });
    expect(action).toBeNull();
    expect(errors.join(' ')).toMatch(/owner or an admin/);
    expect(open({}).action).toBeNull();
  });
});

// The first steps, from the Assistant panel: forms to open, a model or a report
// to start. Each assistant hands over only its own; a form may go with a "how?".
describe('bringing data in and starting a report, as cards', () => {
  test('a card that opens a form goes with a "how do I…?"; one that creates needs a request asked to be done', () => {
    const help = { allowed: ACTIONS_FOR.help };
    expect(validateActionProposal({ userAsked: 'how', action: 'connect_database', summary: 's' }, help).action)
      .toEqual({ action: 'connect_database', summary: 's', request: '' });
    expect(validateActionProposal({ userAsked: 'how', action: 'import_file', summary: 's', request: 'Sales by region' }, help).action)
      .toEqual({ action: 'import_file', summary: 's', request: 'Sales by region' });
    expect(validateActionProposal({ userAsked: 'how', action: 'build_model', summary: 's', request: 'Sales' }, help).action).toBeNull();
    expect(validateActionProposal({ userAsked: 'do', action: 'build_model', summary: 's' }, help).errors.join(' ')).toMatch(/needs request/);
    expect(validateActionProposal({ userAsked: 'do', action: 'build_model', summary: 's', request: 'Sales' }, help).action)
      .toEqual({ action: 'build_model', summary: 's', request: 'Sales' });
  });

  test('each assistant hands over its own actions only', () => {
    const report = { userAsked: 'do', action: 'create_report', summary: 's', request: 'Sales by region' };
    expect(validateActionProposal(report, { allowed: ACTIONS_FOR.ask }).action).toMatchObject({ action: 'create_report', request: 'Sales by region' });
    expect(validateActionProposal(report, { allowed: ACTIONS_FOR.help }).action).toBeNull();
    // The report editor keeps the two it had.
    expect(validateActionProposal(report).errors.join(' ')).toMatch(/action must be one of schedule_cache_refresh, open_model_assistant$/);
    expect(validateActionProposal({ userAsked: 'do', action: 'schedule_cache_refresh', frequency: 'daily', summary: 's' }, { allowed: ACTIONS_FOR.help }).action).toBeNull();
  });
});
