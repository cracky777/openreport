// Sankey — flows between steps, drawn with nothing but SVG.
//
// Data contract (OpenReport custom visual): `data.rows` are objects keyed by
// field label, `data.fields.dimensions` the bound dimensions in well order —
// source, target, then an optional colour category — and
// `data.fields.measures[0]` the weight. One row is one flow.
//
// Layout: a node's column is the longest path that reaches it from a node
// nothing flows into (cycles are cut where they close), nodes stack in their
// column in order of first appearance, heights are proportional to the
// larger of what comes in and what goes out.
(function () {
  var SVG = 'http://www.w3.org/2000/svg';
  var PALETTE = ['#8800FF', '#00BCF2', '#72DCC1', '#84DC82', '#E044A7', '#744EC2', '#D9B300', '#D64550', '#197278', '#1AAB40'];

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG, name);
    for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function fmt(n) {
    if (!isFinite(n)) return '';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  // Rows → { nodes: [{ id, color, in, out }], links: [{ s, t, v }] }
  function buildGraph(data, config) {
    var fields = data.fields || {};
    var dims = fields.dimensions || [];
    var meas = fields.measures || [];
    var srcKey = dims[0] && dims[0].name;
    var tgtKey = dims[1] && dims[1].name;
    var colorKey = dims[2] && dims[2].name;
    var wKey = meas[0] && meas[0].name;
    if (!srcKey || !tgtKey) return null;
    var hidden = {};
    String(config.hiddenNodes || '').split(',').forEach(function (h) { h = h.trim(); if (h) hidden[h] = true; });
    var nodeIndex = {};
    var nodes = [];
    var linkIndex = {};
    var links = [];
    var categoryColor = {};
    var nextColor = 0;
    var colorOf = function (cat) {
      if (!(cat in categoryColor)) categoryColor[cat] = PALETTE[nextColor++ % PALETTE.length];
      return categoryColor[cat];
    };
    var node = function (id, cat) {
      if (!(id in nodeIndex)) {
        nodeIndex[id] = nodes.length;
        nodes.push({ id: id, cat: cat, in: 0, out: 0 });
      } else if (cat != null && nodes[nodeIndex[id]].cat == null) {
        nodes[nodeIndex[id]].cat = cat;
      }
      return nodes[nodeIndex[id]];
    };
    (data.rows || []).forEach(function (r) {
      var s = r[srcKey]; var t = r[tgtKey];
      if (s == null || t == null || s === '' || t === '') return;
      s = String(s); t = String(t);
      if (hidden[s] || hidden[t] || s === t) return;
      var v = wKey ? Number(r[wKey]) : 1;
      if (!isFinite(v) || v <= 0) return;
      var cat = colorKey ? r[colorKey] : null;
      var a = node(s, cat == null ? null : String(cat));
      node(t, null);
      var key = s + '\u0000' + t;
      if (!(key in linkIndex)) { linkIndex[key] = links.length; links.push({ s: s, t: t, v: 0 }); }
      links[linkIndex[key]].v += v;
      a.out += v;
      nodes[nodeIndex[t]].in += v;
    });
    nodes.forEach(function (n, i) {
      n.color = n.cat != null ? colorOf(n.cat) : null;
      n.order = i;
    });
    // A node with no category takes the colour of its column, assigned once
    // columns are known (below).
    return { nodes: nodes, links: links, index: nodeIndex, colorOf: colorOf, hasCategory: !!colorKey };
  }

  // Longest-path layering; a link that would close a cycle is ignored for
  // the layering only.
  function layer(graph) {
    var nodes = graph.nodes; var index = graph.index;
    var out = {}; nodes.forEach(function (n) { out[n.id] = []; });
    graph.links.forEach(function (l) { out[l.s].push(l.t); });
    var depth = {};
    var state = {};
    var visit = function (id) {
      if (state[id] === 2) return depth[id];
      if (state[id] === 1) return -1; // on the stack: a cycle, cut here
      state[id] = 1;
      var d = 0;
      var hasIn = false;
      graph.links.forEach(function (l) {
        if (l.t !== id) return;
        var ds = visit(l.s);
        if (ds < 0) return;
        hasIn = true;
        if (ds + 1 > d) d = ds + 1;
      });
      depth[id] = hasIn ? d : 0;
      state[id] = 2;
      return depth[id];
    };
    nodes.forEach(function (n) { visit(n.id); });
    var columns = 0;
    nodes.forEach(function (n) { n.col = depth[n.id] || 0; if (n.col + 1 > columns) columns = n.col + 1; });
    nodes.forEach(function (n) { if (!n.color) n.color = graph.hasCategory ? '#9ca3af' : PALETTE[n.col % PALETTE.length]; });
    return columns;
  }

  function draw(root, ctx) {
    root.innerHTML = '';
    var config = ctx.config || {};
    var W = Math.max(60, ctx.width || root.clientWidth || 600);
    var H = Math.max(40, ctx.height || root.clientHeight || 300);
    var graph = buildGraph(ctx.data || {}, config);
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, style: 'display:block' }, root);
    if (!graph || !graph.links.length) {
      var msg = el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 12, fill: config.labelColor || '#9ca3af' }, svg);
      msg.textContent = graph ? 'No flows' : 'Bind a source, a target and a weight';
      return;
    }
    var columns = layer(graph);
    var nodeW = Number(config.nodeWidth) || 14;
    var showLabels = config.showLabels !== false;
    var showValues = config.showValues !== false;
    var labelColor = config.labelColor || '#b3b3b3';
    var linkOpacity = Number(config.linkOpacity) || 0.45;
    var pad = { l: 8, r: 8, t: 8, b: 8 };
    var labelW = showLabels ? Math.min(140, Math.max(60, W * 0.12)) : 0;
    var innerW = W - pad.l - pad.r - labelW * (columns > 1 ? 2 : 1);
    var x0 = pad.l + labelW;
    var colGap = columns > 1 ? (innerW - nodeW) / (columns - 1) : 0;

    // Vertical scale: the tallest column decides.
    var byCol = [];
    for (var c = 0; c < columns; c++) byCol.push([]);
    graph.nodes.forEach(function (n) { n.size = Math.max(n.in, n.out); if (n.size > 0) byCol[n.col].push(n); });
    var gap = 6;
    var maxTotal = 0;
    byCol.forEach(function (list) {
      var total = 0; list.forEach(function (n) { total += n.size; });
      if (total > maxTotal) maxTotal = total;
    });
    var usable = H - pad.t - pad.b;
    var scale = function (list) {
      var total = 0; list.forEach(function (n) { total += n.size; });
      var free = usable - gap * Math.max(0, list.length - 1);
      return maxTotal > 0 ? free / maxTotal : 0;
    };
    var k = Infinity;
    byCol.forEach(function (list) { if (list.length) k = Math.min(k, scale(list)); });
    if (!isFinite(k)) k = 0;
    byCol.forEach(function (list, c) {
      var y = pad.t;
      list.forEach(function (n) {
        n.x = x0 + c * colGap;
        n.y = y;
        n.h = Math.max(1, n.size * k);
        y += n.h + gap;
        n.inY = n.y; n.outY = n.y;
      });
    });

    // Links, source-ordered then target-ordered so bands do not cross needlessly.
    var links = graph.links.slice().sort(function (a, b) {
      var na = graph.nodes[graph.index[a.s]]; var nb = graph.nodes[graph.index[b.s]];
      return (na.y - nb.y) || (graph.nodes[graph.index[a.t]].y - graph.nodes[graph.index[b.t]].y);
    });
    var linkLayer = el('g', {}, svg);
    links.forEach(function (l) {
      var s = graph.nodes[graph.index[l.s]]; var t = graph.nodes[graph.index[l.t]];
      var h = Math.max(0.5, l.v * k);
      var sy = s.outY; s.outY += h;
      var ty = t.inY; t.inY += h;
      var sx = s.x + nodeW; var tx = t.x;
      if (tx < sx) { tx = t.x + nodeW; }
      var mx = (sx + tx) / 2;
      var d = 'M' + sx + ',' + sy + ' C' + mx + ',' + sy + ' ' + mx + ',' + ty + ' ' + tx + ',' + ty
        + ' L' + tx + ',' + (ty + h) + ' C' + mx + ',' + (ty + h) + ' ' + mx + ',' + (sy + h) + ' ' + sx + ',' + (sy + h) + ' Z';
      var path = el('path', { d: d, fill: s.color, opacity: linkOpacity }, linkLayer);
      var title = el('title', {}, path);
      title.textContent = l.s + ' → ' + l.t + ': ' + fmt(l.v);
    });

    // Nodes and labels.
    var nodeLayer = el('g', {}, svg);
    graph.nodes.forEach(function (n) {
      if (!(n.size > 0)) return;
      var rect = el('rect', { x: n.x, y: n.y, width: nodeW, height: n.h, fill: n.color, rx: 2, style: 'cursor:pointer' }, nodeLayer);
      var title = el('title', {}, rect);
      title.textContent = n.id + ': ' + fmt(n.size);
      rect.addEventListener('click', function () {
        var dims = (ctx.data.fields || {}).dimensions || [];
        var which = n.col === 0 ? dims[0] : dims[1];
        if (which && ctx.callbacks && ctx.callbacks.onCrossFilter) ctx.callbacks.onCrossFilter(which.sourceName || which.name, n.id);
      });
      if (!showLabels && !showValues) return;
      if (n.h < 9) return;
      var leftSide = n.col === 0 && columns > 1;
      var tx = leftSide ? n.x - 4 : n.x + nodeW + 4;
      var text = el('text', {
        x: tx, y: n.y + n.h / 2, dy: '0.35em', 'text-anchor': leftSide ? 'end' : 'start',
        'font-size': 11, fill: labelColor, style: 'pointer-events:none',
      }, nodeLayer);
      var parts = [];
      if (showLabels) parts.push(n.id);
      if (showValues) parts.push(fmt(n.size));
      text.textContent = parts.join(' ');
    });
  }

  OpenReportRegisterVisual({
    render: function (root, ctx) { draw(root, ctx); },
    update: function (ctx) { draw(document.getElementById('root'), ctx); },
  });
})();
