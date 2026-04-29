# Custom Visual Template — Open Report

Starter template for building a custom visual. Edit, rezip, upload.

## Files

| File          | Required | Purpose                                                     |
|---------------|----------|-------------------------------------------------------------|
| manifest.json | yes      | Metadata, data schema, configurable options                 |
| visual.js     | yes      | Render logic. Must call `OpenReportRegisterVisual({...})`.  |
| icon.svg      | no       | Toolbar icon (also accepts `icon.png` or `icon.jpg`)        |
| README.md     | no       | Ignored by the loader. Document your visual here.           |

Zip the files at the **root** of the archive (no enclosing folder):

```bash
zip my-visual.zip manifest.json visual.js icon.svg
```

## manifest.json

```jsonc
{
  "id":      "my-visual",       // [a-z0-9-] slug, 1-64 chars, must be unique per workspace
  "name":    "My Visual",       // shown in the toolbar dropdown
  "version": "1.0.0",
  "author":  "you",
  "description": "...",

  // Tells Open Report which fields the property panel should accept.
  // Each role is a slot — currently the runtime concatenates all dimensions
  // into one zone and all measures into another. min/max/label are advisory
  // (used in labels and validation — no hard enforcement yet).
  "dataSchema": {
    "dimensions": [
      { "role": "category", "min": 1, "max": 1, "label": "Category" }
    ],
    "measures": [
      { "role": "value", "min": 1, "max": 3, "label": "Values" }
    ]
  },

  // Auto-generates the right-hand options panel. Each entry becomes a Field.
  "configSchema": [
    // boolean → checkbox
    { "key": "showLabels", "type": "boolean", "label": "Show labels", "default": true },

    // number → numeric input. min/max/step optional.
    { "key": "barWidth",   "type": "number",  "label": "Bar width",  "min": 1, "max": 100, "default": 20 },

    // color → color picker (hex)
    { "key": "barColor",   "type": "color",   "label": "Bar color",  "default": "#7c3aed" },

    // string → text input
    { "key": "title",      "type": "string",  "label": "Title",      "default": "" },

    // select → dropdown. options[] required.
    { "key": "shape",      "type": "select",  "label": "Shape",
      "options": [
        { "value": "circle",  "label": "Circle" },
        { "value": "square",  "label": "Square" }
      ],
      "default": "circle"
    }
  ]
}
```

## visual.js

The host loads `visual.js` inside an iframe and exposes a single global:
`OpenReportRegisterVisual(impl)`. Call it at module load time with an object
implementing `render(container, ctx)`, optionally `update(ctx)` and
`destroy()`.

```js
OpenReportRegisterVisual({
  render(container, { data, config, width, height, callbacks }) { /* mount */ },
  update({ data, config, width, height })                       { /* re-render */ },
  destroy()                                                     { /* cleanup */ },
});
```

Heavy inline documentation is in `visual.js` — read it once.

## Data shape

```js
ctx.data = {
  rows: [
    { Category: "A", Sales: 120 },
    { Category: "B", Sales: 80 },
  ],
  fields: {
    dimensions: [{ name: "Category", role: "category", sourceName: "Country" }],
    measures:   [{ name: "Sales",    role: "value",    sourceName: "sales_eur", format: { type: "currency" } }],
  },
};
```

Read row values with the field's `name` (display label). When emitting
cross-filter events, pass the field's `sourceName` (internal model id):

```js
callbacks.onCrossFilter(dimField.sourceName, row[dimField.name]);
```

## Sandbox restrictions

The iframe runs with `sandbox="allow-scripts"` (no `allow-same-origin`):

- No access to the parent DOM, cookies, sessions, or localStorage.
- No ESM `import` / Node `require` — inline what you need into `visual.js`.
- Network calls to public origins work (CDN imports, REST APIs).

## Reloading after edits

Re-uploading a `.zip` whose `manifest.id` already exists in the workspace
**replaces** the previous bundle. Existing widgets keep working with the new
code (next time they re-render).

## Removing

The trash icon next to a visual in the toolbar dropdown removes it from the
workspace. Widgets pointing at the deleted visual will surface an error.
