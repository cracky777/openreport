// A name the assistant gives a field or a measure — a column header, a series
// in a legend — is the name alone. It wrote its thoughts beside it in
// parentheses ("Chiffre d'affaires (chambres, hors extras)", "Délai (jours)")
// and legends became unreadable (Jonathan): the asides go, the unit is the
// format's, the explanation the answer's. Only a name made of nothing else
// keeps them.
function plainName(name) {
  const s = typeof name === 'string' ? name : '';
  const plain = s.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s{2,}/g, ' ').trim();
  return plain || s.trim();
}

module.exports = { plainName };
