// BigQuery region handling.
//
// The connector used to default the job location to 'US'. BigQuery refuses a
// job whose region does not match the dataset's and answers "Not found:
// Dataset <project>:<name>" — which reads as a missing dataset rather than a
// misplaced query, so the cause was invisible. Every dataset outside the US was
// unreachable, and the connection test still passed: `SELECT 1` names no
// dataset and runs anywhere.
const calls = [];

jest.mock('@google-cloud/bigquery', () => ({
  BigQuery: class {
    // eslint-disable-next-line class-methods-use-this
    query(opts) { calls.push(opts); return Promise.resolve([[]]); }
    // eslint-disable-next-line class-methods-use-this
    createQueryJob(opts) {
      calls.push(opts);
      return Promise.resolve([{ getQueryResults: () => Promise.resolve([[]]), cancel: () => Promise.resolve() }]);
    }
  },
}), { virtual: true });

const { createConnection } = require('../utils/dbConnector');

const connect = (extra) => createConnection({
  db_type: 'bigquery', host: '', port: 0, db_name: 'proj', db_user: '',
  db_password: '', extra_config: { dataset: 'ga4', ...extra },
});

describe('BigQuery job location', () => {
  beforeEach(() => { calls.length = 0; });

  test('no location configured → none is sent, so BigQuery infers it', async () => {
    await connect({}).query('SELECT 1 FROM ga4.events');
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('location');
  });

  test('a configured location is honoured', async () => {
    await connect({ location: 'EU' }).query('SELECT 1 FROM ga4.events');
    expect(calls[0].location).toBe('EU');
  });
});
