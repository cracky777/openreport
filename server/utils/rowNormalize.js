// Shape of the rows /query hands to the client, whatever the driver did.
//
// Drivers disagree on JS types: node-postgres delivers NUMERIC and BIGINT
// aggregates as strings, mysql2 does the same for DECIMAL, DuckDB (and the
// rollup cache, which is DuckDB) delivers numbers. The widgets format numbers
// and leave strings alone, so the same measure changed appearance depending
// on which path served it. Measures are therefore coerced to numbers here,
// dimensions never (a code such as "00123" must keep its zeros).

// Keys drivers ever put on an interval object.
const INTERVAL_KEYS = ['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'milliseconds', 'micros', 'fractionalSeconds'];

// A string that is exactly a number as a database prints one: no leading
// zeros (except "0" itself), optional sign, fraction and exponent. Anything
// looser ("007", " 12", "1,5") is data, not a number, and stays a string.
const NUMERIC_STRING = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/;

// Interval flatten — driver-specific shapes:
//   - pg                    : { years, months, days, hours, minutes, seconds, milliseconds }
//   - duckdb-async          : { months, days, micros }
//   - @google-cloud/bigquery: { years, months, days, hours, minutes, seconds, fractionalSeconds }
// For non-zero intervals at least one of those keys is present. INTERVAL '0'
// can arrive from pg as an empty `{}` with none of them, which used to render
// as `[object Object]`; an empty plain object therefore reads as zero seconds.
// Years / months are approximate (no fixed length) but consistent with
// EXTRACT(EPOCH …)'s output for PG/DuckDB.
function intervalSeconds(v) {
  return (Number(v.years) || 0) * 31557600
    + (Number(v.months) || 0) * 2629800
    + (Number(v.days) || 0) * 86400
    + (Number(v.hours) || 0) * 3600
    + (Number(v.minutes) || 0) * 60
    + (Number(v.seconds) || 0)
    + (Number(v.milliseconds) || 0) / 1000
    + (Number(v.micros) || 0) / 1_000_000
    + (Number(v.fractionalSeconds) || 0);
}

// Floating-point sums carry noise (10.10 three times gives 30.299999999999997
// as a DOUBLE, where the database's exact NUMERIC gives 30.30), and the noise
// shows up as a tail of decimals in every widget that formats "auto". Twelve
// significant digits keep every digit a report can show and drop the tail;
// integers are exact in a double and pass through untouched, so a count
// above 1e12 keeps its last digits.
function tidyNumber(v) {
  if (typeof v !== 'number' || Number.isInteger(v) || !Number.isFinite(v)) return v;
  return Number(v.toPrecision(12));
}

// `dimensionKeys`: response keys that are dimensions (left untouched apart
// from Date → ISO date). `coerceNumbers`: off for the rollup builder, whose
// rows are typed by the builder itself and must stay exactly as fetched.
function normalizeRows(rawRows, { dimensionKeys = new Set(), coerceNumbers = true } = {}) {
  return rawRows.map((r) => {
    const obj = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date) { obj[k] = v.toISOString().split('T')[0]; continue; }
      const measure = coerceNumbers && !dimensionKeys.has(k);
      if (typeof v === 'number') { obj[k] = measure ? tidyNumber(v) : v; continue; }
      if (typeof v === 'string') {
        obj[k] = measure && NUMERIC_STRING.test(v) ? tidyNumber(Number(v)) : v;
        continue;
      }
      if (v == null || typeof v !== 'object' || Array.isArray(v)) { obj[k] = v; continue; }
      const keys = Object.keys(v);
      const isInterval = keys.length === 0 || keys.some((kk) => INTERVAL_KEYS.includes(kk));
      obj[k] = isInterval ? intervalSeconds(v) : v;
    }
    return obj;
  });
}

module.exports = { normalizeRows, tidyNumber };
