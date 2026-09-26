// analyzePbit(buffer) → an import plan: the datasource to connect, the model
// as YAML (what POST /api/models/import takes), the report bundle (what
// POST /api/reports/import takes), the images the report embeds, and every
// warning gathered on the way. Pure: nothing is written anywhere.
const path = require('path');
const { openPbit } = require('./readPbit');
const { readTabularModel } = require('./tabularModel');
const { readReport } = require('./reportLayout');
const { buildModel } = require('./buildModel');
const { buildReport } = require('./buildReport');
const { modelToYaml } = require('../modelYaml');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function analyzePbit(buffer, opts = {}) {
  const pbit = openPbit(buffer);
  const baseName = opts.fileName ? path.basename(opts.fileName).replace(/\.pbit$/i, '') : 'Power BI import';
  const tabular = readTabularModel(pbit.schema);
  const report = readReport(pbit);
  const model = buildModel(tabular, { name: baseName, description: `Imported from ${opts.fileName || 'a Power BI template'}` });
  const customVisuals = pbit.customVisuals();
  const built = buildReport(report, model, { title: baseName, customVisuals, culture: tabular.culture });

  const resources = {};
  for (const name of built.resources) {
    const buf = pbit.read(`Report/StaticResources/RegisteredResources/${name}`);
    if (!buf) continue;
    const mime = MIME[path.extname(name).toLowerCase()];
    if (!mime) continue;
    resources[name] = { mime, base64: buf.toString('base64'), size: buf.length };
  }

  const fields = model.fields();
  return {
    source: {
      fileName: opts.fileName || null,
      reportFormat: report.format,
      reportVersion: report.version,
      compatibilityLevel: tabular.compatibilityLevel,
      culture: tabular.culture,
    },
    datasource: model.datasource,
    model: {
      name: fields.name, fields, yaml: modelToYaml(fields, null),
      draftMeasures: model.drafts.map((d) => ({ ...d, uses: built.draftUses.get(d.measureName) || 0 })),
    },
    report: { title: baseName, bundle: built.bundle, customVisuals: built.customVisuals },
    resources,
    warnings: [...model.warnings, ...built.warnings],
    stats: { ...model.stats(), ...built.stats },
  };
}

module.exports = { analyzePbit };
