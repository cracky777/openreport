/**
 * Curated font catalogue surfaced by the FontPicker.
 *
 * Fonts are bundled via the `@fontsource/<family>` packages (one per family,
 * each containing the woff2 + a CSS file with @font-face declarations).
 * Picking a font triggers a Vite dynamic `import()` for that package's
 * 400 + 700 weights, which Vite splits into its own chunk — the woff2
 * lands in the page on demand and survives without any external CDN.
 *
 * Why Fontsource instead of `fonts.googleapis.com`:
 *   - No external network call (privacy / GDPR-clean).
 *   - Works offline / air-gapped.
 *   - We control the font version (no silent CDN updates).
 * Trade-off: each font lives in `node_modules` and contributes a chunk to
 * the build. With 48 curated fonts the project pays ~5-10 MB of disk in
 * deps; the user only downloads the chunks they actually pick.
 *
 * Adding a font:
 *   1. `npm i @fontsource/<lowercase-hyphen-name>` in client/
 *   2. Append to GOOGLE_FONTS with the right category
 *   3. Add an entry in `_importers` so the dynamic import is statically
 *      resolvable by Vite at build time
 */

export const GOOGLE_FONTS = [
  // System default — never imports anything; falls back to the OS UI font.
  { family: 'System default', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif', category: 'system' },

  // Sans-serif (the bulk — most dashboards stay here)
  { family: 'Inter', category: 'sans' },
  { family: 'Roboto', category: 'sans' },
  { family: 'Open Sans', category: 'sans' },
  { family: 'Lato', category: 'sans' },
  { family: 'Montserrat', category: 'sans' },
  { family: 'Poppins', category: 'sans' },
  { family: 'Source Sans 3', category: 'sans' },
  { family: 'Nunito', category: 'sans' },
  { family: 'Nunito Sans', category: 'sans' },
  { family: 'Raleway', category: 'sans' },
  { family: 'Ubuntu', category: 'sans' },
  { family: 'Work Sans', category: 'sans' },
  { family: 'DM Sans', category: 'sans' },
  { family: 'Manrope', category: 'sans' },
  { family: 'Karla', category: 'sans' },
  { family: 'Mulish', category: 'sans' },
  { family: 'Rubik', category: 'sans' },
  { family: 'Quicksand', category: 'sans' },
  { family: 'Barlow', category: 'sans' },
  { family: 'Oxygen', category: 'sans' },

  // Serif — for editorial / formal looks
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Crimson Text', category: 'serif' },
  { family: 'Cormorant Garamond', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'Source Serif 4', category: 'serif' },

  // Slab — distinctive headers
  { family: 'Roboto Slab', category: 'slab' },
  { family: 'Bitter', category: 'slab' },
  { family: 'Arvo', category: 'slab' },
  { family: 'Zilla Slab', category: 'slab' },

  // Monospace — KPI numbers, tabular data
  { family: 'JetBrains Mono', category: 'mono' },
  { family: 'Fira Code', category: 'mono' },
  { family: 'IBM Plex Mono', category: 'mono' },
  { family: 'Source Code Pro', category: 'mono' },
  { family: 'Roboto Mono', category: 'mono' },
  { family: 'Space Mono', category: 'mono' },

  // Display — big titles, marketing-style
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Oswald', category: 'display' },
  { family: 'Anton', category: 'display' },
  { family: 'Archivo Black', category: 'display' },
  { family: 'Righteous', category: 'display' },

  // Handwriting / script — sparing use
  { family: 'Caveat', category: 'handwriting' },
  { family: 'Pacifico', category: 'handwriting' },
  { family: 'Dancing Script', category: 'handwriting' },
  { family: 'Shadows Into Light', category: 'handwriting' },
];

const CATEGORY_LABELS = {
  system: 'System',
  sans: 'Sans-serif',
  serif: 'Serif',
  slab: 'Slab serif',
  mono: 'Monospace',
  display: 'Display',
  handwriting: 'Handwriting',
};

export function fontCategoryLabel(key) {
  return CATEGORY_LABELS[key] || key;
}

const _byFamily = new Map();
for (const f of GOOGLE_FONTS) _byFamily.set(f.family, f);

export function getFont(family) {
  return _byFamily.get(family) || null;
}

// CSS font-family stack for a given catalogue entry. Wraps multi-word
// families in quotes and tail-stitches a category-appropriate fallback so
// the chart still renders something sensible while Fontsource is fetching.
export function fontStack(family) {
  const f = _byFamily.get(family);
  if (!f) return family || 'inherit';
  if (f.stack) return f.stack;
  const fallback = f.category === 'serif' || f.category === 'slab'
    ? 'serif'
    : f.category === 'mono'
      ? 'monospace'
      : 'sans-serif';
  return `"${f.family}", ${fallback}`;
}

// Vite needs static literal paths in dynamic import() to perform code-
// splitting at build time. Each entry below resolves to one Vite chunk
// per family containing the @font-face CSS + the woff2 asset URLs. Keep
// this map in sync with GOOGLE_FONTS — adding a row to one without the
// other silently disables the corresponding face.
const _importers = {
  Inter: () => Promise.all([import('@fontsource/inter/400.css'), import('@fontsource/inter/700.css')]),
  Roboto: () => Promise.all([import('@fontsource/roboto/400.css'), import('@fontsource/roboto/700.css')]),
  'Open Sans': () => Promise.all([import('@fontsource/open-sans/400.css'), import('@fontsource/open-sans/700.css')]),
  Lato: () => Promise.all([import('@fontsource/lato/400.css'), import('@fontsource/lato/700.css')]),
  Montserrat: () => Promise.all([import('@fontsource/montserrat/400.css'), import('@fontsource/montserrat/700.css')]),
  Poppins: () => Promise.all([import('@fontsource/poppins/400.css'), import('@fontsource/poppins/700.css')]),
  'Source Sans 3': () => Promise.all([import('@fontsource/source-sans-3/400.css'), import('@fontsource/source-sans-3/700.css')]),
  Nunito: () => Promise.all([import('@fontsource/nunito/400.css'), import('@fontsource/nunito/700.css')]),
  'Nunito Sans': () => Promise.all([import('@fontsource/nunito-sans/400.css'), import('@fontsource/nunito-sans/700.css')]),
  Raleway: () => Promise.all([import('@fontsource/raleway/400.css'), import('@fontsource/raleway/700.css')]),
  Ubuntu: () => Promise.all([import('@fontsource/ubuntu/400.css'), import('@fontsource/ubuntu/700.css')]),
  'Work Sans': () => Promise.all([import('@fontsource/work-sans/400.css'), import('@fontsource/work-sans/700.css')]),
  'DM Sans': () => Promise.all([import('@fontsource/dm-sans/400.css'), import('@fontsource/dm-sans/700.css')]),
  Manrope: () => Promise.all([import('@fontsource/manrope/400.css'), import('@fontsource/manrope/700.css')]),
  Karla: () => Promise.all([import('@fontsource/karla/400.css'), import('@fontsource/karla/700.css')]),
  Mulish: () => Promise.all([import('@fontsource/mulish/400.css'), import('@fontsource/mulish/700.css')]),
  Rubik: () => Promise.all([import('@fontsource/rubik/400.css'), import('@fontsource/rubik/700.css')]),
  Quicksand: () => Promise.all([import('@fontsource/quicksand/400.css'), import('@fontsource/quicksand/700.css')]),
  Barlow: () => Promise.all([import('@fontsource/barlow/400.css'), import('@fontsource/barlow/700.css')]),
  Oxygen: () => Promise.all([import('@fontsource/oxygen/400.css'), import('@fontsource/oxygen/700.css')]),
  Merriweather: () => Promise.all([import('@fontsource/merriweather/400.css'), import('@fontsource/merriweather/700.css')]),
  'Playfair Display': () => Promise.all([import('@fontsource/playfair-display/400.css'), import('@fontsource/playfair-display/700.css')]),
  Lora: () => Promise.all([import('@fontsource/lora/400.css'), import('@fontsource/lora/700.css')]),
  'PT Serif': () => Promise.all([import('@fontsource/pt-serif/400.css'), import('@fontsource/pt-serif/700.css')]),
  'Crimson Text': () => Promise.all([import('@fontsource/crimson-text/400.css'), import('@fontsource/crimson-text/700.css')]),
  'Cormorant Garamond': () => Promise.all([import('@fontsource/cormorant-garamond/400.css'), import('@fontsource/cormorant-garamond/700.css')]),
  'EB Garamond': () => Promise.all([import('@fontsource/eb-garamond/400.css'), import('@fontsource/eb-garamond/700.css')]),
  'Libre Baskerville': () => Promise.all([import('@fontsource/libre-baskerville/400.css'), import('@fontsource/libre-baskerville/700.css')]),
  'Source Serif 4': () => Promise.all([import('@fontsource/source-serif-4/400.css'), import('@fontsource/source-serif-4/700.css')]),
  'Roboto Slab': () => Promise.all([import('@fontsource/roboto-slab/400.css'), import('@fontsource/roboto-slab/700.css')]),
  Bitter: () => Promise.all([import('@fontsource/bitter/400.css'), import('@fontsource/bitter/700.css')]),
  Arvo: () => Promise.all([import('@fontsource/arvo/400.css'), import('@fontsource/arvo/700.css')]),
  'Zilla Slab': () => Promise.all([import('@fontsource/zilla-slab/400.css'), import('@fontsource/zilla-slab/700.css')]),
  'JetBrains Mono': () => Promise.all([import('@fontsource/jetbrains-mono/400.css'), import('@fontsource/jetbrains-mono/700.css')]),
  'Fira Code': () => Promise.all([import('@fontsource/fira-code/400.css'), import('@fontsource/fira-code/700.css')]),
  'IBM Plex Mono': () => Promise.all([import('@fontsource/ibm-plex-mono/400.css'), import('@fontsource/ibm-plex-mono/700.css')]),
  'Source Code Pro': () => Promise.all([import('@fontsource/source-code-pro/400.css'), import('@fontsource/source-code-pro/700.css')]),
  'Roboto Mono': () => Promise.all([import('@fontsource/roboto-mono/400.css'), import('@fontsource/roboto-mono/700.css')]),
  'Space Mono': () => Promise.all([import('@fontsource/space-mono/400.css'), import('@fontsource/space-mono/700.css')]),
  'Bebas Neue': () => Promise.all([import('@fontsource/bebas-neue/400.css')]),
  Oswald: () => Promise.all([import('@fontsource/oswald/400.css'), import('@fontsource/oswald/700.css')]),
  Anton: () => Promise.all([import('@fontsource/anton/400.css')]),
  'Archivo Black': () => Promise.all([import('@fontsource/archivo-black/400.css')]),
  Righteous: () => Promise.all([import('@fontsource/righteous/400.css')]),
  Caveat: () => Promise.all([import('@fontsource/caveat/400.css'), import('@fontsource/caveat/700.css')]),
  Pacifico: () => Promise.all([import('@fontsource/pacifico/400.css')]),
  'Dancing Script': () => Promise.all([import('@fontsource/dancing-script/400.css'), import('@fontsource/dancing-script/700.css')]),
  'Shadows Into Light': () => Promise.all([import('@fontsource/shadows-into-light/400.css')]),
};

// Idempotent loader. Returns a Promise that resolves once the chunk is in
// the document — callers can await it (the FontPicker does, on hover/select)
// or fire-and-forget (most renderers do, since the browser swaps the face
// when the woff2 lands thanks to font-display: swap baked into Fontsource).
const _loaded = new Set(['System default']);
const _inflight = new Map();
export function loadGoogleFont(family) {
  if (!family || _loaded.has(family)) return Promise.resolve();
  if (_inflight.has(family)) return _inflight.get(family);
  const importer = _importers[family];
  if (!importer) { _loaded.add(family); return Promise.resolve(); }
  const p = importer().then(() => { _loaded.add(family); _inflight.delete(family); });
  _inflight.set(family, p);
  return p;
}

// Helper: load every curated font referenced by a config blob. The Editor
// calls this once per widget on mount so charts that already have a font
// stored don't paint with the fallback for the first frame.
export function preloadFontsFromConfig(config) {
  if (!config || typeof config !== 'object') return;
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string' && /Font$|FontFamily$/i.test(k)) loadGoogleFont(v);
  }
}

// Bulk-load every curated family. Used by the FontPicker the first time
// its dropdown opens so each row can preview in its own face. Issues 48
// concurrent dynamic imports — Vite splits each into its own chunk and
// HTTP/2 multiplexes them, so the burst is bounded.
let _bulkInjected = false;
export function loadAllCuratedFonts() {
  if (_bulkInjected) return;
  _bulkInjected = true;
  for (const f of GOOGLE_FONTS) {
    if (f.category !== 'system') loadGoogleFont(f.family);
  }
}
