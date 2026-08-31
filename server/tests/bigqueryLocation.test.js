// BigQuery region handling.
//
// The connector used to default the job location to 'US'. BigQuery refuses a
// job whose region does not match the dataset's and answers "Not found:
// Dataset <project>:<name>" — which reads as a missing dataset rather than a
// misplaced query, so the cause was invisible. Every dataset outside the US was
// unreachable, and the connection test still passed: `SELECT 1` names no
// dataset and runs anywhere.
const calls = [];

const datasetRefs = [];

jest.mock('@google-cloud/bigquery', () => ({
  BigQuery: class {
    query(opts) { calls.push(opts); return Promise.resolve([[]]); }
    createQueryJob(opts) {
      calls.push(opts);
      return Promise.resolve([{ getQueryResults: () => Promise.resolve([[]]), cancel: () => Promise.resolve() }]);
    }
    dataset(id, opts) {
      datasetRefs.push({ id, ...opts });
      return { getTables: () => Promise.resolve([[]]), table: () => ({ getMetadata: () => Promise.resolve([{}]) }) };
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

// The dataset a bare table name belongs to.
//
// Every other backend resolves `data_2` against a current database or schema.
// BigQuery has no such notion at connection level and refuses the query —
// `Table "data_2" must be qualified with a dataset` — while the table names the
// models hold come from the introspection bare, exactly like that.
describe('BigQuery default dataset', () => {
  beforeEach(() => { calls.length = 0; });

  test('a query carries the connection dataset', async () => {
    await connect({}).query('SELECT 1 FROM data_2');
    expect(calls[0].defaultDataset).toEqual({ datasetId: 'ga4', projectId: 'proj' });
  });

  test('the cancellable path carries it too — that is the one visuals use', async () => {
    await connect({}).queryCancellable('SELECT 1 FROM data_2').promise;
    expect(calls[0].defaultDataset).toEqual({ datasetId: 'ga4', projectId: 'proj' });
  });

  test('an explicit projectId wins over the db_name fallback', async () => {
    await connect({ projectId: 'other-proj' }).query('SELECT 1 FROM data_2');
    expect(calls[0].defaultDataset.projectId).toBe('other-proj');
  });

  test('the connection test names no dataset, so it still runs anywhere', async () => {
    await connect({}).testConnection();
    expect(calls[0]).not.toHaveProperty('defaultDataset');
  });
});

// Reading someone else's dataset — a Google public one, say.
//
// The project that owns the data is not the one that pays for the job, and a
// single project field cannot say both: pointed at `bigquery-public-data`, the
// connector would try to create the job there, where nobody may.
describe('BigQuery cross-project dataset', () => {
  beforeEach(() => { calls.length = 0; datasetRefs.length = 0; });

  test('a `project.dataset` splits the two, jobs staying in the paying project', async () => {
    await connect({ dataset: 'bigquery-public-data.thelook_ecommerce' }).query('SELECT 1 FROM orders');
    expect(calls[0].defaultDataset).toEqual({
      datasetId: 'thelook_ecommerce', projectId: 'bigquery-public-data',
    });
  });

  test('the table listing looks in the data project, not the paying one', async () => {
    await connect({ dataset: 'bigquery-public-data.thelook_ecommerce' }).getTables();
    expect(datasetRefs[0]).toEqual({ id: 'thelook_ecommerce', projectId: 'bigquery-public-data' });
  });

  test('a plain dataset still means "in my own project"', async () => {
    await connect({}).getTables();
    expect(datasetRefs[0]).toEqual({ id: 'ga4', projectId: 'proj' });
  });
});
