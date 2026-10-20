// The colors of an image the user added to the conversation (a logo), read
// here, in the browser: the assistant only ever gets the image's name, so it
// could not dress the report in the brand's colors (asked by Jonathan, with
// a card to validate). No image goes to the AI provider for this.

const SIZE = 64;
const MAX_COLORS = 3;
// A hue under that share of the colored pixels is an edge or an anti-alias.
const MIN_SHARE = 0.04;
// Two buckets closer than this (RGB distance) are one color of the logo.
const SAME = 48;

const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

// Background, text and outlines are white, black or grey: not the brand.
function colored(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (min > 235 || max < 20) return false;
  return (max - min) / max >= 0.2;
}

/**
 * The dominant colors of RGBA pixels, most present first.
 * @param {Uint8ClampedArray|number[]} pixels  RGBA, as a canvas gives them
 * @returns {string[]}  up to three #RRGGBB
 */
export function paletteOf(pixels) {
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 128 || !colored(r, g, b)) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const s = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    s.n += 1; s.r += r; s.g += g; s.b += b;
    buckets.set(key, s);
    total += 1;
  }
  const colors = [];
  for (const s of [...buckets.values()].sort((x, y) => y.n - x.n)) {
    const c = { n: s.n, r: s.r / s.n, g: s.g / s.n, b: s.b / s.n };
    const near = colors.find((k) => Math.hypot(k.r - c.r, k.g - c.g, k.b - c.b) < SAME);
    if (near) near.n += c.n; else colors.push(c);
  }
  return colors
    .filter((c) => c.n / total >= MIN_SHARE)
    .sort((x, y) => y.n - x.n)
    .slice(0, MAX_COLORS)
    .map((c) => hex(c.r, c.g, c.b));
}

/**
 * @param {File|Blob} file  an image
 * @returns {Promise<string[]>}  its dominant colors, [] when it cannot be read
 */
export async function imageColors(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, SIZE / Math.max(img.naturalWidth || SIZE, img.naturalHeight || SIZE));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || SIZE) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || SIZE) * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return paletteOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return []; /* unreadable image: the logo is placed, its colors are simply not offered */
  } finally {
    URL.revokeObjectURL(url);
  }
}
