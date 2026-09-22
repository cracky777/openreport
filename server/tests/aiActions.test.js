const { validateActionProposal } = require('../utils/ai/actions');

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
