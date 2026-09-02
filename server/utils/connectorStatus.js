/**
 * Quels connecteurs sont utilisables, et lesquels ne sont qu'écrits.
 *
 * Un connecteur peut être complet — dialecte, introspection, tests unitaires —
 * sans avoir jamais parlé au moteur qu'il vise. Ce qu'il émet est alors une
 * hypothèse, pas un fait : le SQL est plausible et les tests le figent, mais
 * rien ne dit que le moteur l'accepte. Livrer ça comme le reste, c'est laisser
 * quelqu'un brancher sa production sur une supposition.
 *
 * Ceux-là restent donc visibles — un utilisateur doit savoir qu'ils arrivent —
 * mais inutilisables tant qu'ils n'ont pas tourné contre un vrai moteur. Le
 * verrou est ici, côté serveur : griser une option dans un <select> ne ferme
 * pas /api/datasources.
 *
 * Pour en essayer un, lever le garde-fou explicitement :
 *   OPENREPORT_PREVIEW_CONNECTORS=all
 *   OPENREPORT_PREVIEW_CONNECTORS=snowflake,redshift
 *
 * Sortir un connecteur d'ici est une décision, pas une formalité : elle dit
 * qu'on l'a vu marcher, pas qu'on le croit correct.
 */

// Écrits et testés unitairement, jamais exécutés contre le moteur visé.
const PREVIEW = new Set(['redshift', 'mssql', 'snowflake', 'clickhouse', 'databricks', 'oracle']);

function enabledPreviews() {
  const raw = String(process.env.OPENREPORT_PREVIEW_CONNECTORS || '').trim();
  if (!raw) return new Set();
  if (raw.toLowerCase() === 'all') return new Set(PREVIEW);
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

function isPreview(dbType) {
  return PREVIEW.has(String(dbType || '').toLowerCase());
}

// Un type inconnu n'est pas « en préversion » : il est refusé plus loin par
// buildConnector, avec un message qui nomme le type.
function isAvailable(dbType) {
  const t = String(dbType || '').toLowerCase();
  return !PREVIEW.has(t) || enabledPreviews().has(t);
}

// Le message que voit l'utilisateur. Il doit dire l'état ET la sortie, sinon
// il ressemble à une panne.
function unavailableMessage(dbType) {
  return `The ${dbType} connector is a preview: it is written and unit-tested, but has never run against a real ${dbType} engine. `
    + 'Enable it deliberately with OPENREPORT_PREVIEW_CONNECTORS before pointing production data at it.';
}

module.exports = { PREVIEW, isPreview, isAvailable, unavailableMessage };
