// =============================================================================
// Open Report — Custom Visual Template
// =============================================================================
//
// This file is the entry point of a custom visual. Open Report loads it inside
// a sandboxed iframe (sandbox="allow-scripts", opaque origin) and expects you
// to register a render implementation by calling:
//
//     OpenReportRegisterVisual({ render, update, destroy });
//
// The runtime will then call your `render` once with the initial data, and
// `update` whenever data, config, or size changes.
//
// You CANNOT access cookies, sessions, localStorage, or the parent DOM —
// the iframe is isolated. Communication with the host is exclusively through
// the `callbacks` object you receive in `render`.
//
// =============================================================================
// Contract
// =============================================================================
//
// render(container, ctx)
//   container : HTMLElement   // root <div> you mount your visual into
//   ctx.data  : {
//     rows: Array<Record<string, any>>,
//     fields: {
//       dimensions: Array<{ name, role, sourceName }>,
//       measures:   Array<{ name, role, sourceName, format }>,
//     }
//   }
//   ctx.config : Record<string, any>   // values for keys declared in manifest.configSchema
//   ctx.width  : number                // current widget width in px
//   ctx.height : number                // current widget height in px
//   ctx.callbacks : {
//     onCrossFilter(dimensionSourceName, value)   // bubble a click → cross-filter the report
//   }
//
// update(ctx)        — same ctx shape minus container; called when data/config/size change
// destroy()          — cleanup (timers, listeners, etc.); container is auto-cleared
//
// =============================================================================
// Reading the data
// =============================================================================
//
// Each row is an object whose keys are the *display labels* of the bound
// fields (the "name" property in fields.dimensions / fields.measures). Use
// those names to read values:
//
//   const dim  = ctx.data.fields.dimensions[0];
//   const meas = ctx.data.fields.measures[0];
//   ctx.data.rows.forEach((r) => {
//     console.log(r[dim.name], r[meas.name]);
//   });
//
// To cross-filter (when the user clicks on something), use the dimension's
// internal sourceName, NOT its display name:
//
//   ctx.callbacks.onCrossFilter(dim.sourceName, r[dim.name]);
//
// =============================================================================
// Restrictions
// =============================================================================
//
// - The bundle is wrapped in an inline <script>. No `import` / `require`.
//   Inline any libraries you need into this file, or fetch them from a CDN
//   inside render(). The sandbox allows network calls to public origins.
//
// - The iframe has no parent-DOM access. Don't try `window.parent.document`.
//
// - localStorage / sessionStorage are sandbox-scoped — they survive only as
//   long as the iframe lives.
//
// =============================================================================

(function () {
  // Module-level state survives across update() calls. Use it to cache DOM
  // nodes you build in render() so update() can patch them in place.
  let state = null;

  function paint(container, ctx) {
    const { data, config, callbacks } = ctx;

    // Pull the bound fields. fields.dimensions[0] is the first dimension
    // dropped on the panel; the manifest's dataSchema can require multiple.
    const rows = (data && data.rows) || [];
    const fields = (data && data.fields) || { dimensions: [], measures: [] };
    const dimField = fields.dimensions[0];
    const measField = fields.measures[0];

    // Always reset the container at the top of paint(); update() reuses the
    // same root <div> across re-renders.
    container.innerHTML = '';
    container.style.padding = '8px';
    container.style.boxSizing = 'border-box';
    container.style.overflow = 'auto';

    // Empty state — encourage the report editor to bind fields.
    if (!dimField || !measField || rows.length === 0) {
      container.innerHTML = '<div style="color:#94a3b8;font-size:12px;text-align:center;padding:24px">'
        + 'Drop a dimension and a measure in the property panel</div>';
      return;
    }

    // Read user-configurable options. The keys come from manifest.configSchema.
    // Always provide a fallback in case the user hasn't tweaked the value yet.
    const baseColor = (config && config.tileColor) || '#7c3aed';
    const showValues = config ? config.showValues !== false : true;
    const labelSize = (config && config.labelSize) || 12;

    // Compute scale once — useful when colour/opacity should reflect magnitude.
    const values = rows.map((r) => Number(r[measField.name]) || 0);
    const max = Math.max.apply(null, values) || 1;

    // Build the visual. Plain DOM here, but you can also use canvas/SVG/d3.
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(80px, 1fr))';
    grid.style.gap = '8px';

    rows.forEach((r) => {
      const v = Number(r[measField.name]) || 0;
      const ratio = v / max;
      const tile = document.createElement('div');
      tile.style.background = baseColor;
      tile.style.opacity = String(0.25 + ratio * 0.75);
      tile.style.borderRadius = '6px';
      tile.style.padding = '10px';
      tile.style.color = '#fff';
      tile.style.fontSize = labelSize + 'px';
      tile.style.cursor = 'pointer';
      tile.style.minHeight = '50px';
      tile.style.display = 'flex';
      tile.style.flexDirection = 'column';
      tile.style.justifyContent = 'space-between';
      tile.style.transition = 'transform 0.1s ease';

      const name = String(r[dimField.name] != null ? r[dimField.name] : '');
      tile.innerHTML = '<div style="font-weight:600">' + escapeHtml(name) + '</div>'
        + (showValues ? '<div style="opacity:0.85">' + escapeHtml(String(v)) + '</div>' : '');

      tile.addEventListener('mouseenter', function () { tile.style.transform = 'scale(1.04)'; });
      tile.addEventListener('mouseleave', function () { tile.style.transform = 'scale(1)'; });

      // Cross-filter on click. IMPORTANT: pass dimField.sourceName (internal
      // model name), not dimField.name (display label). The host uses the
      // sourceName to apply the filter on the right model dimension.
      tile.addEventListener('click', function () {
        if (callbacks && typeof callbacks.onCrossFilter === 'function') {
          callbacks.onCrossFilter(dimField.sourceName || dimField.name, name);
        }
      });

      grid.appendChild(tile);
    });

    container.appendChild(grid);
  }

  // Always escape user-supplied data before injecting it as innerHTML.
  // Display labels and dimension values come from the user's database — treat
  // them as untrusted text.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Register your visual with the host. The host won't render anything until
  // this function is called, so do it at module load time.
  OpenReportRegisterVisual({
    render: function (container, ctx) {
      state = { container: container };
      paint(container, ctx);
    },
    update: function (ctx) {
      // ctx has data/config/width/height; container is the same as in render().
      if (state && state.container) paint(state.container, ctx);
    },
    destroy: function () {
      // Cancel timers, remove listeners, free large objects. The container
      // itself will be cleared by the host.
      if (state && state.container) state.container.innerHTML = '';
      state = null;
    },
  });
})();
