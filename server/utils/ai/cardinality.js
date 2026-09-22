// How many values each dimension has, measured in the cache instead of guessed
// from its name. Where a dimension goes on a chart hangs on it: a legend of a
// dozen regions reads, one of 35 000 communes is confetti — and a dimension
// named `lib_seg2` says nothing about which one it is.
//
// Read like everything the assistant reads: through /query in `cacheOnly`, as
// the requesting user (RLS included), with the same fail-closed rule. A
// dimension the cache cannot list stays unknown, and unknown decides nothing.

const { buildBody, fireQuery, MAX_ROWS } = require('./cachedQuery');

const MAX_DIMENSIONS = 20;
const TTL_MS = 10 * 60 * 1000;
const MAX_MEMO = 200;
const memo = new Map();

/**
 * @param {object[]} coverage  cacheCoverage.getCoverage(): the dimensions the cache can list
 * @returns {Promise<Object<string, {n: number, more: boolean}>>}  by dimension name; `more` = at least n
 */
async function dimensionCardinality({ user, orgId, report, effective, coverage }, deps = {}) {
  const known = new Set(effective.dimensions.map((d) => d.name));
  const names = [...new Set(coverage.flatMap((g) => g.dimensions || []))].filter((n) => known.has(n)).slice(0, MAX_DIMENSIONS);
  if (!names.length) return {};

  // Per user (RLS narrows what they can count) and per build of the cache.
  const key = [user.id, report.model_id, report.id || '', coverage.map((g) => g.builtAt).join(',')].join('|');
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const fire = deps.fireQuery || fireQuery;
  const counted = await Promise.all(names.map(async (name) => {
    const built = buildBody({ report, effective, args: { dimensions: [name], measures: [], limit: MAX_ROWS } });
    if (built.error) return null;
    try {
      const json = await fire({ user, orgId, modelId: report.model_id, body: built.body });
      const cache = (json && json._cache) || {};
      if (!(cache.hit === true && cache.fromRollup)) return null;
      const n = Array.isArray(json.rows) ? json.rows.length : 0;
      return [name, { n, more: n >= MAX_ROWS }];
    } catch {
      return null; // unknown: the layout rules then leave this dimension alone
    }
  }));
  const value = Object.fromEntries(counted.filter(Boolean));

  if (memo.size >= MAX_MEMO) memo.delete(memo.keys().next().value);
  memo.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { dimensionCardinality };
