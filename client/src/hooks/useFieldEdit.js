import { useState, useEffect } from 'react';
import { buildMeasureSql } from '../utils/measureSql';

// State + sync logic for the DataPanel field-edit panel (a measure or a
// dimension currently being edited inline). Pulled out of DataPanel.jsx
// so the panel's top-level hook count stays under the readability bar.
//
// The auto-sync `useEffect` mirrors the wizard's: regenerate
// `editForm.expression` from the structured form fields on every change.
// Uses `editForm.bareExpression` as the canonical un-wrapped source for
// custom-mode measures so the CASE WHEN wrap can be toggled without
// destroying the user's original input.
export function useFieldEdit() {
  const [editingField, setEditingField] = useState(null); // measure name being edited
  const [editForm, setEditForm] = useState({});
  const [editingDim, setEditingDim] = useState(null); // dimension name being edited
  const [dimEditForm, setDimEditForm] = useState({});

  useEffect(() => {
    if (!editingField) return;
    const [table, column] = (editForm.aggregation === 'count')
      ? ['', '*']
      : (editForm.aggregation === 'custom' ? ['', ''] : (editForm.field || '').split('::'));
    const sql = buildMeasureSql({
      aggregation: editForm.aggregation,
      table: table || '',
      column: column || '',
      filterRules: editForm.filterEnabled ? editForm.filterRules : null,
      overrideFilters: editForm.overrideFilters,
      expression: editForm.bareExpression || '',
    });
    if (sql !== editForm.expression) {
      setEditForm((prev) => ({ ...prev, expression: sql }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingField, editForm.aggregation, editForm.field, editForm.filterEnabled, editForm.filterRules, editForm.overrideFilters, editForm.bareExpression]);

  return {
    editingField, setEditingField,
    editForm, setEditForm,
    editingDim, setEditingDim,
    dimEditForm, setDimEditForm,
  };
}
