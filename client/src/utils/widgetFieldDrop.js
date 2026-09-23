import { baseMeasureName, nextAggVariant, dimensionAsMeasure } from './aggVariant';
import { runsFromData, runsToText, normalizeRuns } from './textRuns';
import { tagFor } from './textMeasures';

// Where a field lands when it is dropped straight onto a visual.
//
// The config panel asks the user to aim: one well per role, and the field has
// to reach the right one. Dropped on the visual itself there is no aim to
// take, so the slot is deduced — a dimension goes where that visual groups by,
// a measure where it counts. The rules below are the panel's own, read off its
// wells (components/PropertyPanel), so both routes fill the same binding.
//
// `dropTargets` lists every well of the visual that takes the field, the
// deduced one first; the canvas shows them while the field is in the air so
// the user can aim at another. `planFieldDrop` returns the deduced target, or
// the one named by `zone`. null means the visual has no home for that kind of
// field (or, with several equally likely wells, no guess is made).

const effType = (model, d) => {
  // A calculated dimension has no column to override; its declared type stands.
  const ov = d.table && d.column && model?.column_types && model.column_types[`${d.table}.${d.column}`];
  return !ov ? d.type : (typeof ov === 'string' ? ov : ov.type);
};

const dimOf = (model, name) => (model?.dimensions || []).find((x) => x.name === name);
const isDateDim = (model, name) => {
  const d = dimOf(model, name);
  return !!d && effType(model, d) === 'date';
};

// A measure already in the zone is not a duplicate but a second reading of the
// same column — sum next to average. It takes a name of its own, exactly as a
// second drop in the panel's well does.
const measureEntry = (fieldName, existing, binding, model) => {
  if (!existing.includes(fieldName)) return fieldName;
  const base = baseMeasureName(fieldName);
  const modelAgg = (model?.measures || []).find((m) => m.name === base)?.aggregation;
  return nextAggVariant(base, existing, binding?.measureAggOverrides?.[base] || modelAgg);
};

// A dimension put where a measure goes is read as a measure of its column
// (Max by default), as the panel's wells do — see utils/aggVariant.
const asMeasureEntry = (fieldName, isDim, existing, binding, model) => {
  if (!isDim) return measureEntry(fieldName, existing, binding, model);
  const d = dimOf(model, fieldName);
  return dimensionAsMeasure(fieldName, existing, d ? effType(model, d) : '');
};

// First slot still free among single-field wells; null when they are all taken.
const firstFree = (binding, keys) => keys.find((k) => !binding[k]) || null;

// Every well of the visual that takes the field, deduced one first.
// `defaultIndex` -1 means none is more likely than the others.
function targetsFor({ widget, fieldName, fieldType, model }) {
  const none = { targets: [], defaultIndex: -1 };
  if (!widget || !fieldName || (fieldType !== 'dimension' && fieldType !== 'measure')) return none;
  const type = widget.type;
  const binding = widget.dataBinding || {};
  const dims = binding.selectedDimensions || [];
  const meas = binding.selectedMeasures || [];
  const isDim = fieldType === 'dimension';

  // A dimension names a thing; two copies of it would be the same column
  // twice, with nothing to tell them apart. Refused, like in the panel.
  const dimZone = (zone, key = 'selectedDimensions', list = dims) => (
    list.includes(fieldName) ? null : { zone, binding: { [key]: [...list, fieldName] } }
  );
  const measZone = (zone, key = 'selectedMeasures', list = meas) => ({
    zone,
    binding: { [key]: [...list, asMeasureEntry(fieldName, isDim, list, binding, model)] },
  });
  // A well that holds one field swaps its contents rather than growing.
  const single = (zone, key, value) => ({ zone, binding: { [key]: value } });
  const singleMeasure = (zone) => single(zone, 'selectedMeasures', [asMeasureEntry(fieldName, isDim, [], binding, model)]);
  // The deduced well refusing the field (a dimension already there) is not
  // a reason to guess another: the user picks among the rest.
  const list = (targets, defaultIndex = 0) => {
    const wanted = targets[defaultIndex] || null;
    const kept = targets.filter(Boolean);
    return { targets: kept, defaultIndex: wanted ? kept.indexOf(wanted) : -1 };
  };

  switch (type) {
    case 'bar':
    case 'line':
      return isDim
        ? list([dimZone('Axis'), dimZone('Legend', 'groupBy', binding.groupBy || []), measZone('Values')])
        : list([measZone('Values')]);

    case 'combo': {
      // Two measure wells here; bars are the one a visual starts with.
      const bars = measZone('Bar values', 'comboBarMeasures', binding.comboBarMeasures || []);
      const lines = measZone('Line values', 'comboLineMeasures', binding.comboLineMeasures || []);
      return isDim
        ? list([dimZone('Axis'), dimZone('Legend', 'groupBy', binding.groupBy || []), bars, lines])
        : list([bars, lines]);
    }

    case 'pie':
    case 'treemap':
      return isDim ? list([dimZone('Category'), singleMeasure('Value')]) : list([singleMeasure('Value')]);

    case 'table': {
      // One well for both kinds: the field becomes a column, and the order the
      // columns are drawn in has to learn about it too.
      const order = binding.columnOrder || [...dims, ...meas];
      if (isDim) {
        if (dims.includes(fieldName)) return none;
        return list([{ zone: 'Columns', binding: { selectedDimensions: [...dims, fieldName], columnOrder: [...order, fieldName] } }]);
      }
      const entry = measureEntry(fieldName, meas, binding, model);
      return list([{ zone: 'Columns', binding: { selectedMeasures: [...meas, entry], columnOrder: [...order, entry] } }]);
    }

    case 'pivotTable':
      return isDim
        ? list([dimZone('Rows'), dimZone('Columns', 'columnDimensions', binding.columnDimensions || []), measZone('Values')])
        : list([measZone('Values')]);

    case 'scorecard': {
      const value = singleMeasure('Value');
      if (!isDim || !isDateDim(model, fieldName)) return list([value]);
      // A date is what a scorecard compares periods on; the value stays a
      // choice away. A comparison nobody asked to see is a comparison that
      // looks broken: the first date dim turns the percentage on, as the
      // panel does.
      const compare = {
        ...single('Compare with', 'compareDateDim', fieldName),
        config: binding.compareDateDim
          ? undefined
          : { ...(widget.config || {}), showN1Percent: widget.config?.showN1Percent ?? true },
      };
      return list([compare, value]);
    }

    case 'gauge': {
      if (isDim) return list([singleMeasure('Value')]);
      const wells = [
        single('Value', 'selectedMeasures', [fieldName]),
        single('Max', 'gaugeMaxMeasure', fieldName),
        single('Threshold', 'gaugeThresholdMeasure', fieldName),
      ];
      if (meas.length === 0) return list(wells, 0);
      const key = firstFree(binding, ['gaugeMaxMeasure', 'gaugeThresholdMeasure']);
      // Value, max and threshold all set: which one was meant is anyone's
      // guess, so the user picks or the panel decides.
      return list(wells, key === 'gaugeMaxMeasure' ? 1 : key === 'gaugeThresholdMeasure' ? 2 : -1);
    }

    case 'scatter': {
      if (isDim) return list([single('Details', 'selectedDimensions', [fieldName])]);
      const scatter = binding.scatterMeasures || {};
      const role = firstFree(scatter, ['x', 'y', 'size']);
      const wells = ['x', 'y', 'size'].map((r) => ({
        zone: r === 'size' ? 'Size' : `${r.toUpperCase()} Axis`,
        binding: { scatterMeasures: { ...scatter, [r]: fieldName } },
      }));
      return list(wells, role ? ['x', 'y', 'size'].indexOf(role) : -1);
    }

    case 'filter': {
      // A slicer picks values of one column; a measure has none to pick from.
      if (!isDim) return none;
      const plan = single('Filter field', 'selectedDimensions', [fieldName]);
      if (dims[0] === fieldName) return list([plan]);
      // The values ticked in the slicer belong to the column that was there
      // before; kept, they would filter on something no longer displayed.
      const config = { ...(widget.config || {}) };
      delete config.selectedValues;
      return list([{ ...plan, config }]);
    }

    case 'customVisual':
      return isDim ? list([dimZone('Dimensions'), measZone('Measures')]) : list([measZone('Measures')]);

    case 'text': {
      // The field joins the text's Measures well (a dimension as a reading of
      // its column, as elsewhere) and its "#tag" is written at the end of the
      // text, where the value will print — the author moves it from there.
      const entry = asMeasureEntry(fieldName, isDim, meas, binding, model);
      const runs = runsFromData(widget.data);
      const tag = '#' + tagFor(entry, model);
      const sep = runs.length > 0 && !/\s$/.test(runsToText(runs)) ? ' ' : '';
      const nextRuns = normalizeRuns([...runs, { text: sep + tag }]);
      return list([{
        zone: 'Measures',
        binding: { selectedMeasures: [...meas, entry] },
        data: { runs: nextRuns, text: runsToText(nextRuns) },
      }]);
    }

    default:
      // shape, image — nothing here reads the model.
      return none;
  }
}

export function dropTargets(args) {
  return targetsFor(args).targets;
}

export function planFieldDrop({ widget, fieldName, fieldType, model, zone }) {
  const { targets, defaultIndex } = targetsFor({ widget, fieldName, fieldType, model });
  if (zone) return targets.find((t) => t.zone === zone) || null;
  return defaultIndex >= 0 ? targets[defaultIndex] : null;
}
