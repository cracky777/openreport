import { baseMeasureName, nextAggVariant } from './aggVariant';

// Where a field lands when it is dropped straight onto a visual.
//
// The config panel asks the user to aim: one well per role, and the field has
// to reach the right one. Dropped on the visual itself there is no aim to
// take, so the slot is deduced — a dimension goes where that visual groups by,
// a measure where it counts. The rules below are the panel's own, read off its
// wells (components/PropertyPanel), so both routes fill the same binding.
//
// Returns { zone, binding, config? } — `zone` being the well's label, which
// the canvas shows under the cursor so the user knows where it will go before
// letting go. null means this visual has no home for that kind of field, and
// the drop is refused rather than guessed.

const effType = (model, d) => {
  const ov = model?.column_types && model.column_types[`${d.table}.${d.column}`];
  return !ov ? d.type : (typeof ov === 'string' ? ov : ov.type);
};

const isDateDim = (model, name) => {
  const d = (model?.dimensions || []).find((x) => x.name === name);
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

// First slot still free among single-field wells; null when they are all taken.
const firstFree = (binding, keys) => keys.find((k) => !binding[k]) || null;

export function planFieldDrop({ widget, fieldName, fieldType, model }) {
  if (!widget || !fieldName || (fieldType !== 'dimension' && fieldType !== 'measure')) return null;
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
  const measZone = (zone) => ({
    zone,
    binding: { selectedMeasures: [...meas, measureEntry(fieldName, meas, binding, model)] },
  });
  // A well that holds one field swaps its contents rather than growing.
  const single = (zone, key, value) => ({ zone, binding: { [key]: value } });

  switch (type) {
    case 'bar':
    case 'line':
      return isDim ? dimZone('Axis') : measZone('Values');

    case 'combo':
      if (isDim) return dimZone('Axis');
      // Two measure wells here; bars are the one a visual starts with.
      return {
        zone: 'Bar values',
        binding: {
          comboBarMeasures: [
            ...(binding.comboBarMeasures || []),
            measureEntry(fieldName, binding.comboBarMeasures || [], binding, model),
          ],
        },
      };

    case 'pie':
    case 'treemap':
      return isDim ? dimZone('Category') : single('Value', 'selectedMeasures', [fieldName]);

    case 'table': {
      // One well for both kinds: the field becomes a column, and the order the
      // columns are drawn in has to learn about it too.
      const order = binding.columnOrder || [...dims, ...meas];
      if (isDim) {
        if (dims.includes(fieldName)) return null;
        return { zone: 'Columns', binding: { selectedDimensions: [...dims, fieldName], columnOrder: [...order, fieldName] } };
      }
      const entry = measureEntry(fieldName, meas, binding, model);
      return { zone: 'Columns', binding: { selectedMeasures: [...meas, entry], columnOrder: [...order, entry] } };
    }

    case 'pivotTable':
      return isDim ? dimZone('Rows') : measZone('Values');

    case 'scorecard':
      if (!isDim) return single('Value', 'selectedMeasures', [fieldName]);
      // The only dimension a scorecard reads is the one it compares periods
      // on, so a dimension that carries no date has nowhere to go.
      if (!isDateDim(model, fieldName)) return null;
      return {
        ...single('Compare with', 'compareDateDim', fieldName),
        // A comparison nobody asked to see is a comparison that looks broken:
        // the first date dim turns the percentage on, as the panel does.
        config: binding.compareDateDim
          ? undefined
          : { ...(widget.config || {}), showN1Percent: widget.config?.showN1Percent ?? true },
      };

    case 'gauge': {
      if (isDim) return null;
      if (meas.length === 0) return single('Value', 'selectedMeasures', [fieldName]);
      const key = firstFree(binding, ['gaugeMaxMeasure', 'gaugeThresholdMeasure']);
      // Value, max and threshold all set: which one was meant is anyone's
      // guess, so the panel decides.
      if (!key) return null;
      return single(key === 'gaugeMaxMeasure' ? 'Max' : 'Threshold', key, fieldName);
    }

    case 'scatter': {
      if (isDim) return single('Details', 'selectedDimensions', [fieldName]);
      const scatter = binding.scatterMeasures || {};
      const role = firstFree(scatter, ['x', 'y', 'size']);
      if (!role) return null;
      return {
        zone: role === 'size' ? 'Size' : `${role.toUpperCase()} Axis`,
        binding: { scatterMeasures: { ...scatter, [role]: fieldName } },
      };
    }

    case 'filter': {
      // A slicer picks values of one column; a measure has none to pick from.
      if (!isDim) return null;
      const plan = single('Filter field', 'selectedDimensions', [fieldName]);
      if (dims[0] === fieldName) return plan;
      // The values ticked in the slicer belong to the column that was there
      // before; kept, they would filter on something no longer displayed.
      const config = { ...(widget.config || {}) };
      delete config.selectedValues;
      return { ...plan, config };
    }

    case 'customVisual':
      return isDim ? dimZone('Dimensions') : measZone('Measures');

    default:
      // text, shape, image — nothing here reads the model.
      return null;
  }
}
