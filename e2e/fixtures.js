// Names and ids the seed writes and the specs read back. Kept in one place so a
// spec never has to guess what the fixture looks like.
const path = require('path');

module.exports = {
  AUTH_STATE: path.join(__dirname, '.tmp', 'auth.json'),
  IDS_FILE: path.join(__dirname, '.tmp', 'ids.json'),
  USER: { email: 'e2e@open-report.local', password: 'e2e-password-1234' },
  // Labels, not names: the query response is keyed on the label, and so are the
  // widgets that read it.
  DIM_LABEL: 'Country',
  MEASURE_LABEL: 'Sales',
  DIM: 'sales.country',
  // Bound to no widget on purpose: the touch-drag spec needs a field it can
  // actually drop somewhere.
  SPARE_DIM: 'sales.city',
  SPARE_DIM_LABEL: 'City',
  MEASURE: 'sales.amt_sum',
  // The title report B already occupies. Renaming A onto it is what makes the
  // server answer 409.
  TAKEN_TITLE: 'Titre deja pris',
};
