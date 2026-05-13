/**
 * Normalisation des règles de filtre global (settings.reportFilters) avant
 * de les concaténer dans les widgetFilters envoyés au serveur.
 *
 * Deux responsabilités :
 *
 *   1. Drop la règle si ce widget est explicitement exclu via le mode
 *      "edit interactions" de la barre des filtres globaux
 *      (`rule.exclusions.includes(widgetId)`).
 *
 *   2. Strip le champ `exclusions` lui-même. C'est un détail éditeur ; le
 *      laisser dans le payload polluerait le `stableShape` du preAggCache
 *      (l'ajout d'une exclusion sur un widget invaliderait alors la cache
 *      de TOUS les autres widgets du rapport).
 *
 * À utiliser partout où on assemble `widgetFilters = [...reportLevelFilters,
 * ...widgetOwnFilters]` pour une requête de visuel.
 */
export function prepareGlobalRulesForWidget(rules, widgetId) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (const r of rules) {
    if (!r) continue;
    if (Array.isArray(r.exclusions) && r.exclusions.includes(widgetId)) continue;
    const { exclusions, ...rest } = r;
    out.push(rest);
  }
  return out;
}
