import api from './api';
import themes from '../themes/themes.json';

// Books of accounts the import recognised: a French FEC, a SAF-T audit file or
// a German DATEV export, a Swedish SIE file, a Dutch XAF, a general ledger
// exported to CSV or Excel and read with the chart the user chose.
export const isBooks = (accounting) => ['fec', 'saft', 'datev', 'sie', 'xaf', 'jpk', 'ledger'].includes(accounting?.kind);
// Books with a Finance package: a SAF-T from a country whose chart of accounts
// the server does not read is a ledger only.
export const hasFinancePack = (accounting) => isBooks(accounting) && (accounting.kind === 'fec' || !!accounting.chart);
// The company the books belong to (SIREN, organisation number): the same
// company's fiscal years go into one source.
export const booksCompany = (accounting) => accounting?.companyId || accounting?.siren || null;

const COUNTRY_ADJECTIVES = { NO: 'Norwegian', DK: 'Danish', PT: 'Portuguese', PL: 'Polish', LT: 'Lithuanian', RO: 'Romanian', LU: 'Luxembourg', AT: 'Austrian', BG: 'Bulgarian' };
// "French accounting file (FEC)", "Norwegian accounting file (SAF-T)".
export const booksName = (accounting) => {
  if (accounting?.kind === 'saft' && accounting.country === 'LU') return 'Luxembourg accounting file (FAIA)';
  if (accounting?.kind === 'saft') return `${COUNTRY_ADJECTIVES[accounting.country] || 'Audit'} accounting file (SAF-T)`;
  if (accounting?.kind === 'datev') return 'German accounting file (DATEV)';
  if (accounting?.kind === 'sie') return 'Swedish accounting file (SIE)';
  if (accounting?.kind === 'xaf') return 'Dutch accounting file (XAF)';
  if (accounting?.kind === 'jpk') return 'Polish accounting file (JPK_KR_PD)';
  if (accounting?.kind === 'ledger') return 'General ledger';
  return 'French accounting file (FEC)';
};

// The charts a general ledger can be read with — the server's LEDGER_CHARTS
// (server/utils/accounting/charts.js), which refuses any other.
export const LEDGER_CHARTS = [
  ['pcg', 'France — Plan Comptable Général'], ['pcmn', 'Belgium — PCMN'], ['pcn', 'Luxembourg — PCN'],
  ['skr03', 'Germany — SKR03'], ['skr04', 'Germany — SKR04'], ['bas', 'Sweden — BAS'], ['ns4102', 'Norway — NS 4102'], ['dk', 'Denmark — standard chart'], ['at', 'Austria — EKR'],
  ['snc', 'Portugal — SNC'], ['ro', 'Romania'], ['generic', 'Another chart — map the accounts yourself'],
];

// Apply the accounting pack of a source imported from books: the server builds
// the plan, the browser walks the usual create routes with the user's rights —
// the same path as a .pbit import. Resolves with the new report's id.
export async function applyFecPack(datasourceId, workspaceId) {
  const { data } = await api.get(`/upload/${datasourceId}/fec-pack`);
  const { plan } = data;
  // The Finance package wears Open Report's dark theme; its visuals' colours
  // are chosen for it (server/utils/accounting/fecPack.js).
  const bundle = { ...plan.report.bundle, report: { ...plan.report.bundle.report, settings: { ...plan.report.bundle.report.settings, theme: { key: 'dark', ...themes.dark } } } };
  const model = await api.post('/models/import', { yaml: plan.model.yaml, datasourceId, ...(workspaceId ? { workspaceId } : {}) });
  const report = await api.post('/reports/import', { bundle, modelId: model.data.model.id, workspaceId: workspaceId || undefined });
  const reportId = report.data.report.id;
  // /reports/import suffixes the title; the pack's own reads better. A title
  // already taken keeps the suffix rather than failing the whole pack.
  try { await api.put(`/reports/${reportId}`, { title: plan.report.title }); } catch { /* keeps "(imported)" */ }
  return reportId;
}

// Add the books just imported (`fromId`) to another source of the same
// company as more fiscal years. The new source is then a duplicate and goes.
export async function addFecYearsTo(targetId, fromId) {
  const { data } = await api.post(`/upload/${targetId}/fec-years`, { from: fromId });
  try { await api.delete(`/datasources/${fromId}`); } catch { /* left in the list: the user may delete it */ }
  return data;
}
