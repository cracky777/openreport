import { useState, useEffect } from 'react';
import { buildMeasureSql } from '../utils/measureSql';

// State + sync logic for the DataPanel measure-creation wizard. Previously
// 10 individual useState calls + one useEffect inlined in DataPanel.jsx —
// pulled into a hook so the component's top-level hook count drops without
// changing the consumer-side surface (the returned bag keeps the original
// names, so existing JSX call sites work after a single destructure).
//
// The auto-sync `useEffect` regenerates `calcExpr` (the SQL editor's
// canonical value) from the structured inputs on every change — so the
// user always sees the actual SQL the server will run, including the
// CASE WHEN wrap when a filter rule is active, even in Custom-SQL mode
// (where `calcBareExpr` is the user's typed source and `calcExpr` is the
// post-wrap rendering).
export function useCalcWizard() {
  const [showCalcForm, setShowCalcForm] = useState(false);
  const [calcLabel, setCalcLabel] = useState('');
  const [calcAggregation, setCalcAggregation] = useState('sum');
  const [calcField, setCalcField] = useState(''); // "table::column"
  const [calcExpr, setCalcExpr] = useState('');
  const [calcFilterEnabled, setCalcFilterEnabled] = useState(false);
  const [calcRules, setCalcRules] = useState([]);
  const [calcOverride, setCalcOverride] = useState(false);
  const [calcSaving, setCalcSaving] = useState(false);
  // Bare expression for create form's Custom-SQL mode — what the user
  // actually typed, before any CASE WHEN wrap from the filter toggle.
  const [calcBareExpr, setCalcBareExpr] = useState('');

  useEffect(() => {
    if (!showCalcForm) return;
    const [table, column] = (calcAggregation === 'count')
      ? ['', '*']
      : (calcAggregation === 'custom' ? ['', ''] : (calcField || '').split('::'));
    const sql = buildMeasureSql({
      aggregation: calcAggregation,
      table: table || '',
      column: column || '',
      filterRules: calcFilterEnabled ? calcRules : null,
      overrideFilters: calcOverride,
      expression: calcBareExpr,
    });
    setCalcExpr(sql);
  }, [showCalcForm, calcAggregation, calcField, calcFilterEnabled, calcRules, calcOverride, calcBareExpr]);

  return {
    showCalcForm, setShowCalcForm,
    calcLabel, setCalcLabel,
    calcAggregation, setCalcAggregation,
    calcField, setCalcField,
    calcExpr, setCalcExpr,
    calcFilterEnabled, setCalcFilterEnabled,
    calcRules, setCalcRules,
    calcOverride, setCalcOverride,
    calcSaving, setCalcSaving,
    calcBareExpr, setCalcBareExpr,
  };
}
