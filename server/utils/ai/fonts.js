// The font families the assistant may set, with their category for the
// prompt: the ones the client bundles (client/src/utils/googleFonts.js
// GOOGLE_FONTS, kept equal by tests/aiDesignKeys.test.js). A family outside it
// is never loaded and silently falls back. `null` = the system font.
const FONTS = {
  sans: ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Nunito', 'Nunito Sans', 'Raleway', 'Ubuntu', 'Work Sans', 'DM Sans', 'Manrope', 'Karla', 'Mulish', 'Rubik', 'Quicksand', 'Barlow', 'Oxygen'],
  serif: ['Merriweather', 'Playfair Display', 'Lora', 'PT Serif', 'Crimson Text', 'Cormorant Garamond', 'EB Garamond', 'Libre Baskerville', 'Source Serif 4'],
  slab: ['Roboto Slab', 'Bitter', 'Arvo', 'Zilla Slab'],
  mono: ['JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Source Code Pro', 'Roboto Mono', 'Space Mono'],
  display: ['Bebas Neue', 'Oswald', 'Anton', 'Archivo Black', 'Righteous'],
  handwriting: ['Caveat', 'Pacifico', 'Dancing Script', 'Shadows Into Light'],
};
const FONT_FAMILIES = new Set(Object.values(FONTS).flat());

module.exports = { FONTS, FONT_FAMILIES };
