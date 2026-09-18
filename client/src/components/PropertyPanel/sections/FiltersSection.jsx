// Section 2 — Filters. Everything that removes rows from the visual: the
// rule cards, and the Top N + Others fold for the visuals that offer it.
// Tinted, so the one section that changes what the numbers say stands out
// from the ones that change how they look.
import { Section, SubSection, Field } from '../controls';
import DropZone from '../../DropZone/DropZone';
import FilterRulesEditor, { buildDefaultFilterRule } from '../../FilterRulesEditor/FilterRulesEditor';
import { parseIntOrNull } from '../../../utils/input';

export default function FiltersSection({ ctx }) {
  const { widget, widgetId, model, binding, updateBinding, updateConfig, onRefreshWidget, fieldInfos, measureInfos, handleAggChange, inputStyle, sections, styles } = ctx;
  const type = widget.type;
  const cfg = widget.config || {};
  const wf = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
  // Editing a rule takes the same path as the widget's Refresh button — same
  // scope, server result cache bypassed the same way — so the visual never
  // keeps values from the rule before.
  const setWF = (next) => {
    updateBinding({ widgetFilters: next });
    onRefreshWidget?.(widgetId);
  };
  const addFilter = (fieldName, isMeasure) => setWF([...wf, buildDefaultFilterRule(model, fieldName, isMeasure)]);
  const canTopN = type === 'bar' || type === 'pie' || type === 'treemap';
  // A slicer's rules narrow the values it offers. Its list is a DISTINCT
  // query with no measure, so a measure rule would have nothing to compare.
  const isSlicer = type === 'filter';

  return (
    <Section id="filters" title="Filters" tone="accent" sectionState={sections}>
      <DropZone
        label={isSlicer ? 'Restrict values' : 'Add filter'}
        accepts={isSlicer ? ['dimension'] : ['dimension', 'measure']}
        measureInfos={measureInfos}
        fields={[]}
        zoneName="widgetFilter"
        onDrop={(name, fieldType) => addFilter(name, fieldType === 'measure')}
        fieldInfos={fieldInfos}
      />
      <FilterRulesEditor
        model={model}
        modelId={model?.id}
        rules={wf}
        onChange={setWF}
        measureInfos={measureInfos}
        onAggChange={handleAggChange}
        styles={{ inputStyle, cardStyle: styles.ruleCardStyle, labelStyle: styles.ruleLabelStyle }}
      />
      {canTopN && (
        <SubSection label="Top N">
          {/* Folds the long tail into one "Others" bucket so a high-cardinality
              chart stays readable; N appears once the fold is on. */}
          <Field label="Show Top N + Others">
            <input type="checkbox" checked={cfg.topNEnabled === true}
              onChange={(e) => updateConfig('topNEnabled', e.target.checked)}
              title="Group items beyond Top N into a single Others bucket" />
          </Field>
          {cfg.topNEnabled === true && (
            <Field label="N">
              <input type="number" min={1} max={1000} value={cfg.topN ?? ''} placeholder="20"
                onChange={(e) => updateConfig('topN', Math.max(1, parseIntOrNull(e.target.value)))}
                style={{ ...inputStyle, width: 70, marginBottom: 0 }} />
            </Field>
          )}
        </SubSection>
      )}
    </Section>
  );
}
