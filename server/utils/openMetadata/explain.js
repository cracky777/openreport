// "Where does this number come from?": one field of an Open Report model,
// followed upstream in OpenMetadata — the column of its data model, then, edge
// by edge, the columns it is computed from, each with its rule (the `function`
// of the column lineage, or the column's description), the DAG that runs the
// edge and its SQL, down to the sources. Walked here, not by the assistant:
// it gets the path, and says what is missing rather than guess it.
//
// The FQNs follow the connector (DK-openmetadata, openreport.py): a model is
// the data model `<service>.model.<model id>`, a report's own fields
// `<service>.model.report-<report id>`, each field a column of the same name,
// quoted (`"_date.year"`) since names hold dots.
//
// Beside the answer for the assistant, `graph` is the same path for the user's
// eyes (AiPanel/LineageCard): the entities it went through, each with its
// layer, and the edges it followed — never more than the path of the field.

const { restGet } = require('./client');
const { layerOf, tierOf } = require('./layers');

const DEPTH = 3; // OpenMetadata refuses more per call
const MAX_DEPTH = 6;
const MAX_SQL = 1500;
const MAX_TEXT = 600;
const MAX_STEPS = 40;
const MAX_ANSWER = 24 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;

const quotePart = (s) => (/[."]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
const modelFqn = (service, modelId, reportId) => `${quotePart(service)}.model.${quotePart(reportId ? `report-${reportId}` : modelId)}`;
const columnFqn = (dataModel, field) => `${dataModel}."${String(field).replace(/"/g, '""')}"`;
const enc = encodeURIComponent;
const cut = (s, n) => {
  const v = typeof s === 'string' ? s.trim() : '';
  return v.length > n ? `${v.slice(0, n)}…` : v;
};

// Where the catalog's own page of an entity is, to cite it.
const linkOf = (om, type, fqn) => `${om.url}/${type}/${enc(fqn)}`;

const idOf = (e) => (e && typeof e === 'object' ? e.id : e);

// One lineage read, nodes and upstream edges by id.
async function lineageFrom(om, type, fqn, deps) {
  const graph = await restGet(om, `/lineage/${enc(type)}/name/${enc(fqn)}?upstreamDepth=${DEPTH}&downstreamDepth=0`, deps);
  if (!graph) return { nodes: [], edges: [], root: null };
  const nodes = [graph.entity, ...(Array.isArray(graph.nodes) ? graph.nodes : [])].filter((n) => n && n.id);
  const edges = (Array.isArray(graph.upstreamEdges) ? graph.upstreamEdges : [])
    .map((e) => ({ from: idOf(e.fromEntity), to: idOf(e.toEntity), details: e.lineageDetails || {} }))
    .filter((e) => e.from && e.to);
  return { nodes, edges, root: graph.entity || null };
}

/**
 * The whole upstream graph, read 3 levels at a time from the nodes left at
 * the edge of the previous read, 6 levels at most.
 */
async function upstreamGraph(om, rootType, rootFqn, deps) {
  const nodes = new Map();
  const edges = new Map();
  const add = (g) => {
    g.nodes.forEach((n) => nodes.set(n.id, n));
    g.edges.forEach((e) => edges.set(`${e.from}>${e.to}`, e));
  };
  const first = await lineageFrom(om, rootType, rootFqn, deps);
  if (!first.root) return null;
  add(first);
  const depthOf = (rootId) => {
    const depth = new Map([[rootId, 0]]);
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges.values()) {
        if (e.to === id && !depth.has(e.from)) { depth.set(e.from, depth.get(id) + 1); queue.push(e.from); }
      }
    }
    return depth;
  };
  const depth = depthOf(first.root.id);
  const frontier = [...depth.entries()].filter(([, d]) => d === DEPTH).map(([id]) => nodes.get(id)).filter((n) => n && n.type && n.fullyQualifiedName);
  for (const n of frontier.slice(0, 10)) {
    try { add(await lineageFrom(om, n.type, n.fullyQualifiedName, deps)); } catch { /* the deeper read is a bonus: what was read stands */ }
  }
  return { rootId: first.root.id, root: first.root, nodes, edges: [...edges.values()] };
}

// The entity a column belongs to: the node whose FQN is the longest prefix.
function entityOfColumn(nodes, col) {
  let best = null;
  for (const n of nodes.values()) {
    const f = n.fullyQualifiedName;
    if (f && col.startsWith(`${f}.`) && (!best || f.length > best.fullyQualifiedName.length)) best = n;
  }
  return best;
}

// An entity on the path, read once: its column descriptions, and the tags and
// certification its layer is read from.
async function readEntity(om, node, deps) {
  const none = { columns: new Map(), entity: null };
  if (!node || !node.fullyQualifiedName) return none;
  const path = node.type === 'container'
    ? `/containers/name/${enc(node.fullyQualifiedName)}?fields=dataModel,tags,certification`
    : node.type === 'table' ? `/tables/name/${enc(node.fullyQualifiedName)}?fields=columns,tags,certification` : null;
  if (!path) return none;
  const entity = await restGet(om, path, deps).catch(() => null);
  const list = entity ? (node.type === 'container' ? (entity.dataModel && entity.dataModel.columns) : entity.columns) : null;
  const columns = new Map();
  const walk = (cols) => (Array.isArray(cols) ? cols : []).forEach((c) => {
    if (c && c.fullyQualifiedName) columns.set(c.fullyQualifiedName, c);
    if (c && c.children) walk(c.children);
  });
  walk(list);
  return { columns, entity };
}

// The catalog writes Markdown and HTML entities; the card shows plain text.
const plain = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\*\*|__|`/g, '')
  .trim();

const pipelineOf = (details) => {
  const p = details.pipeline;
  if (!p) return null;
  return { name: p.displayName || p.name || null, fqn: p.fullyQualifiedName || null, type: p.type || 'pipeline' };
};

/**
 * @param {{ url, token, service }} om
 * @param {{ modelId: string, reportId?: string, field: { name, label?, description?, synonyms? } }} target
 */
async function explainField(om, { modelId, reportId = null, field }, deps = {}) {
  const dataModel = modelFqn(om.service, modelId, reportId);
  const model = await restGet(om, `/dashboard/datamodels/name/${enc(dataModel)}?fields=columns`, deps);
  if (!model) {
    return { error: `OpenMetadata has no data model ${dataModel}: the Open Report connector has not run on it yet.`, links: [] };
  }
  const wanted = columnFqn(model.fullyQualifiedName || dataModel, field.name);
  const column = (Array.isArray(model.columns) ? model.columns : []).find((c) => c && (c.fullyQualifiedName === wanted || c.name === field.name)) || null;
  const answer = {
    field: {
      name: field.name,
      label: field.label || field.name,
      ...(field.description ? { glossary: field.description } : {}),
      ...(field.synonyms && field.synonyms.length ? { synonyms: field.synonyms } : {}),
      // The connector writes the expression, filters, sources and compiled SQL here.
      definition: column ? cut(column.description, 3 * MAX_SQL) : null,
    },
    steps: [],
    sources: [],
    gaps: [],
    links: [{ title: model.displayName || model.name || dataModel, url: linkOf(om, 'dashboardDataModel', model.fullyQualifiedName || dataModel) }],
  };
  if (!column) answer.gaps.push(`The field is not a column of ${dataModel} in OpenMetadata: the connector has not run since it was added.`);

  const graph = await upstreamGraph(om, 'dashboardDataModel', model.fullyQualifiedName || dataModel, deps);
  if (!graph || !graph.edges.length) {
    answer.gaps.push('OpenMetadata knows nothing upstream of this data model (no lineage).');
    return finish(answer);
  }
  const { nodes, edges } = graph;
  const linked = new Set();
  const cite = (node) => {
    if (!node || !node.fullyQualifiedName || linked.has(node.id)) return;
    linked.add(node.id);
    answer.links.push({ title: node.displayName || node.name || node.fullyQualifiedName, url: linkOf(om, node.type, node.fullyQualifiedName) });
  };
  const described = new Map(); // entity id → { columns, entity }
  const describe = async (node) => {
    if (!described.has(node.id)) described.set(node.id, await readEntity(om, node, deps));
    return described.get(node.id);
  };

  // Breadth first from the field's column; where an edge has no column
  // lineage, the walk goes on at the level of entities and says so.
  const onPath = new Map(); // fqn → lineage node, for the graph
  let columns = column ? [column.fullyQualifiedName || wanted] : [];
  let entities = new Set([graph.rootId]);
  const seenEdges = new Set();
  for (let level = 1; level <= MAX_DEPTH && entities.size && answer.steps.length < MAX_STEPS; level++) {
    const nextColumns = new Set();
    const nextEntities = new Set();
    for (const e of edges.filter((x) => entities.has(x.to))) {
      const key = `${e.from}>${e.to}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const from = nodes.get(e.from);
      if (!from) continue;
      const lineage = Array.isArray(e.details.columnsLineage) ? e.details.columnsLineage : [];
      const own = lineage.filter((l) => l && columns.includes(l.toColumn));
      const target = nodes.get(e.to);
      if (lineage.length && !own.length && columns.some((c) => entityOfColumn(nodes, c) === target)) continue; // an edge feeding other columns
      const step = {
        level,
        entity: from.fullyQualifiedName,
        into: target ? target.fullyQualifiedName : null,
        type: from.type,
        ...(from.description ? { about: cut(from.description, MAX_TEXT) } : {}),
        ...(pipelineOf(e.details) ? { pipeline: pipelineOf(e.details) } : {}),
        ...(e.details.description ? { edge: cut(e.details.description, MAX_TEXT) } : {}),
        ...(e.details.sqlQuery ? { sql: cut(e.details.sqlQuery, MAX_SQL) } : {}),
      };
      const { columns: cols } = await describe(from);
      if (own.length) {
        step.columns = own.map((l) => ({
          to: l.toColumn,
          from: (l.fromColumns || []).filter((c) => typeof c === 'string'),
          rule: cut(l.function, MAX_TEXT) || null,
        }));
        step.columns.forEach((c) => c.from.forEach((f) => {
          nextColumns.add(f);
          const meta = cols.get(f);
          if (meta && meta.description) c.descriptions = { ...(c.descriptions || {}), [f]: cut(meta.description, MAX_TEXT) };
          else answer.gaps.push(`Column ${f} has no description.`);
        }));
      } else {
        step.columns = null;
        answer.gaps.push(`The edge ${from.fullyQualifiedName} → ${target ? target.fullyQualifiedName : '?'} has no column lineage: followed at the level of tables.`);
      }
      if (step.pipeline && step.pipeline.fqn) answer.links.push({ title: step.pipeline.name || step.pipeline.fqn, url: linkOf(om, 'pipeline', step.pipeline.fqn) });
      cite(from);
      answer.steps.push(step);
      onPath.set(from.fullyQualifiedName, from);
      nextEntities.add(from.id);
    }
    columns = [...nextColumns];
    entities = nextEntities;
  }
  // Sources: what has nothing upstream, among what the path reached.
  const reached = new Set(answer.steps.map((s) => s.entity));
  for (const n of nodes.values()) {
    if (!reached.has(n.fullyQualifiedName)) continue;
    if (!edges.some((e) => e.to === n.id)) answer.sources.push({ entity: n.fullyQualifiedName, type: n.type, ...(n.description ? { about: cut(n.description, MAX_TEXT) } : {}), url: linkOf(om, n.type, n.fullyQualifiedName) });
  }
  if (answer.steps.length) answer.graph = graphOf(om, answer, model.fullyQualifiedName || dataModel, model, onPath, (n) => (described.get(n.id) || {}).entity || null);
  return finish(answer);
}

/**
 * The path drawn for the user: the field on the right, every entity a step
 * went through with the columns of it the path used and its layer; each edge
 * with its job, its rules and its SQL. Built before `finish` trims the steps
 * for the prompt: the card shows the whole path.
 */
function graphOf(om, answer, modelFqnOf, model, onPath, entityOf) {
  const fieldId = `field:${answer.field.name}`;
  const nodes = new Map([[fieldId, {
    id: fieldId,
    kind: 'field',
    name: answer.field.label,
    type: 'field',
    container: model.displayName || model.name || modelFqnOf,
    ...(answer.field.glossary ? { about: cut(plain(answer.field.glossary), MAX_TEXT) } : {}),
    url: linkOf(om, 'dashboardDataModel', modelFqnOf),
  }]]);
  const rules = Array.isArray(om.layers) ? om.layers : [];
  const used = new Map(); // fqn → Map(column → its description)
  for (const step of answer.steps) {
    for (const c of step.columns || []) {
      for (const f of c.from) {
        if (!f.startsWith(`${step.entity}.`)) continue;
        if (!used.has(step.entity)) used.set(step.entity, new Map());
        used.get(step.entity).set(f.slice(step.entity.length + 1), (c.descriptions && c.descriptions[f]) || null);
      }
    }
  }
  for (const step of answer.steps) {
    if (nodes.has(step.entity)) continue;
    const n = onPath.get(step.entity) || {};
    const entity = entityOf(n);
    const parts = step.entity.split('.');
    nodes.set(step.entity, {
      id: step.entity,
      kind: 'entity',
      name: n.displayName || n.name || parts[parts.length - 1],
      type: step.type,
      container: parts.slice(0, -1).join('.'),
      layer: layerOf(step.entity, entity, rules),
      tier: tierOf(entity),
      ...(step.about ? { about: cut(plain(step.about), MAX_TEXT) } : {}),
      columns: [...(used.get(step.entity) || new Map())].map(([name, description]) => ({ name, ...(description ? { description: plain(description) } : {}) })),
      url: linkOf(om, step.type, step.entity),
    });
  }
  const idOf = (fqn) => (fqn === modelFqnOf ? fieldId : fqn);
  const graphEdges = answer.steps.filter((s) => s.into && nodes.has(idOf(s.into))).map((s) => ({
    from: s.entity,
    to: idOf(s.into),
    columnLevel: !!s.columns,
    ...(s.pipeline ? { pipeline: s.pipeline.name || s.pipeline.fqn } : {}),
    rules: [...new Set((s.columns || []).map((c) => c.rule).filter(Boolean))],
    ...(s.edge ? { about: plain(s.edge) } : {}),
    ...(s.sql ? { sql: s.sql } : {}),
  }));
  return { nodes: [...nodes.values()], edges: graphEdges };
}

// Bounded for the prompt: the deepest steps go first when it is too long.
// The graph is not counted: it goes to the user's screen, never to the prompt.
function finish(answer) {
  answer.gaps = [...new Set(answer.gaps)].slice(0, 30);
  const seen = new Set();
  answer.links = answer.links.filter((l) => !seen.has(l.url) && seen.add(l.url));
  while (JSON.stringify({ ...answer, graph: undefined }).length > MAX_ANSWER && answer.steps.length > 1) {
    answer.steps.pop();
    answer.truncated = true;
  }
  return answer;
}

// (catalog, model, field) → answer, a few minutes: one question asked twice
// in a conversation does not walk the catalog twice.
const cache = new Map();
async function explainFieldCached(om, target, deps = {}) {
  const key = JSON.stringify([om.url, om.service, om.layers || [], target.modelId, target.reportId || null, target.field.name]);
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_TTL_MS) return hit.answer;
  const answer = await explainField(om, target, deps);
  cache.set(key, { at: Date.now(), answer });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return answer;
}

module.exports = { explainField, explainFieldCached, modelFqn, columnFqn, _cache: cache };
