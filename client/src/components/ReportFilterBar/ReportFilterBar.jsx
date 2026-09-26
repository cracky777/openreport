import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TbFilter, TbX, TbHandClick, TbSearch } from 'react-icons/tb';
import { AddIcon, ICON_SIZE } from '../actionIcons';
import FilterRulesEditor, { buildDefaultFilterRule } from '../FilterRulesEditor/FilterRulesEditor';

const _hs0 = { color: 'var(--text-disabled)', flexShrink: 0 };
const _hs1 = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, flexShrink: 0 };
const _hs2 = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 };
const _hs3 = { fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' };
const _hs4 = { flex: 1 };
const _hs5 = { fontSize: 11, color: 'var(--accent-primary)', fontWeight: 500 };

// The "+" picker: one list of every field, narrowed as the user types, so a
// model with hundreds of columns is a few keystrokes away instead of a scroll
// through a native dropdown.
function FieldPicker({ model, onPick }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const q = query.trim().toLowerCase();
  const matches = (f) => !q || String(f.label || f.name).toLowerCase().includes(q) || String(f.name).toLowerCase().includes(q);
  const dims = (model.dimensions || []).filter(matches);
  const meas = (model.measures || []).filter(matches);
  const first = dims.length ? { kind: 'd', f: dims[0] } : (meas.length ? { kind: 'm', f: meas[0] } : null);
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && first) { e.preventDefault(); onPick(first.f.name, first.kind === 'm'); }
  };
  const group = (label, list, kind) => list.length > 0 && (
    <div key={kind}>
      <div style={pickerGroupStyle}>{label}</div>
      {list.map((f) => (
        <button key={kind + f.name} type="button" onClick={() => onPick(f.name, kind === 'm')} style={pickerItemStyle} title={f.name}>
          {f.label || f.name}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <div style={pickerSearchStyle}>
        <TbSearch size={13} style={_hs0} />
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
          placeholder="Search a field…" aria-label="Search a field" style={pickerInputStyle} />
      </div>
      <div style={pickerListStyle}>
        {group('Dimensions', dims, 'd')}
        {group('Measures', meas, 'm')}
        {dims.length === 0 && meas.length === 0 && <div style={_hs3}>No field matches</div>}
      </div>
    </>
  );
}

const VALUELESS = new Set(['is_empty', 'is_not_empty']);
const OP_SYMBOL = {
  in: '=', not_in: '≠',
  contains: '⊃', not_contains: '⊅',
  starts_with: '↦', ends_with: '↤',
  is_empty: '∅', is_not_empty: '!∅',
  between: '↔',
  gt: '>', gte: '≥', lt: '<', lte: '≤',
  top_n: 'top', bottom_n: 'bottom',
};

// Resolve a rule's field to a chip-friendly label: dimension/measure label
// from the model when available, otherwise strip the schema/table prefix
// (e.g. "public.orders.customer_name" → "customer_name").
function resolveFieldLabel(rule, model) {
  if (!rule?.field) return '?';
  const list = rule.isMeasure ? (model?.measures || []) : (model?.dimensions || []);
  const def = list.find((x) => x.name === rule.field);
  if (def?.label) return def.label;
  const parts = String(rule.field).split('.');
  return parts[parts.length - 1];
}

// Compact human summary for a single rule — shown inside the chip.
function ruleSummary(rule, model) {
  if (!rule) return '';
  const field = resolveFieldLabel(rule, model);
  const op = rule.op || 'in';
  if (VALUELESS.has(op)) return `${field} ${op === 'is_empty' ? 'is empty' : 'is not empty'}`;
  if (op === 'in' || op === 'not_in') {
    const vals = Array.isArray(rule.values) ? rule.values : [];
    const head = vals.slice(0, 2).join(', ');
    const more = vals.length > 2 ? ` +${vals.length - 2}` : '';
    return `${field} ${OP_SYMBOL[op]} ${head || '…'}${more}`;
  }
  if (op === 'between') {
    const [a, b] = Array.isArray(rule.values) ? rule.values : [];
    return `${field}: ${a || '…'} → ${b || '…'}`;
  }
  if (op === 'top_n' || op === 'bottom_n') {
    return `${field}: ${OP_SYMBOL[op]} ${rule.value ?? '?'}`;
  }
  return `${field} ${OP_SYMBOL[op] || op} ${rule.value ?? ''}`;
}

/**
 * Report-level filter chip bar. Lives just below the toolbar.
 *
 * Visibility is fully parent-controlled (`visible`). Filters still apply
 * silently when the bar is hidden — the toolbar badge surfaces the count so
 * users know they're active. The toolbar's Filter submenu has a toggle that
 * mirrors this state.
 *
 *   - "+" button (or any chip) opens the popover with FilterRulesEditor
 *   - Chip × removes that rule
 *   - Bar × dismisses the bar (same effect as the toolbar toggle)
 *   - All changes commit immediately and call onRefresh
 */
export default function ReportFilterBar({ model, rules, onChange, onRefresh, visible, onVisibilityChange, onVisibleCountChange, onEditRuleInteractions, activeInteractionsRuleIdx = null }) {
  const persistedRules = Array.isArray(rules) ? rules : [];
  // Local draft — every edit (add/remove/operator/value) stays here until
  // the user explicitly clicks Save or Save & refresh. Otherwise every
  // keystroke / select would re-fire every widget's /query.
  const [draftRules, setDraftRules] = useState(persistedRules);
  const persistedKey = JSON.stringify(persistedRules);
  useEffect(() => {
    setDraftRules(Array.isArray(rules) ? rules : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey]);
  const wf = draftRules;
  const dirty = JSON.stringify(draftRules) !== persistedKey;
  // Live count of visible (= committable, non-__isNew) chips. Lifted to the
  // parent so the toolbar badge updates immediately on removal — not only
  // after Save. useLayoutEffect runs synchronously before paint so the
  // badge doesn't lag a frame behind the chip row.
  const visibleCount = draftRules.filter((r) => !r.__isNew).length;
  useLayoutEffect(() => {
    onVisibleCountChange?.(visibleCount);
  }, [visibleCount, onVisibleCountChange]);

  const triggerRef = useRef(null);
  const chipRefs = useRef({});
  const popRef = useRef(null);
  const barRef = useRef(null);
  // A field held over the bar: the bar says it will take it.
  const [dragOver, setDragOver] = useState(false);
  // popMode = null | { type: 'add' } | { type: 'edit', idx }
  // The popover is scoped to a single rule (edit) or to the field picker
  // (add). The "+ button" and chip clicks each set the appropriate mode so
  // the popover never shows the full rules list.
  const [popMode, setPopMode] = useState(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const popOpen = popMode !== null;

  const shouldRender = visible;

  const removeRule = (idx) => setDraftRules(wf.filter((_, i) => i !== idx));
  const openAdd = () => setPopMode({ type: 'add' });
  const openEdit = (idx) => setPopMode({ type: 'edit', idx });
  const closePop = () => setPopMode(null);
  // Strip the internal __isNew marker before committing — it's only used to
  // hide unsaved rules from the chip row.
  const cleanRules = (arr) => arr.map(({ __isNew, ...r }) => r);
  const commitSave = () => {
    const cleaned = cleanRules(draftRules);
    onChange(cleaned);
    setDraftRules(cleaned);
  };
  const commitSaveAndRefresh = () => {
    const cleaned = cleanRules(draftRules);
    onChange(cleaned);
    setDraftRules(cleaned);
    if (typeof onRefresh === 'function') onRefresh();
  };
  const discardDraft = () => { setDraftRules(persistedRules); closePop(); };
  // Picking a field in add-mode appends the rule (to the draft) and jumps to
  // edit it. The rule is flagged __isNew so it stays hidden from the chip row
  // until the user commits via Save / Save & refresh.
  const addRuleFor = (name, isMeasure) => {
    if (!name || !model) return;
    const newIdx = wf.length;
    const rule = buildDefaultFilterRule(model, name, isMeasure);
    rule.__isNew = true;
    setDraftRules([...wf, rule]);
    setPopMode({ type: 'edit', idx: newIdx });
  };

  // A field dragged from the Data panel and dropped on the bar starts a
  // rule on it, the same as picking it from the "+" list. Mouse drags come
  // through the DataTransfer, touch drags through the or:* events that
  // utils/touchDrag sends to every [data-touch-drop] element.
  const isFieldDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('application/field-name');
  const onDragOver = (e) => {
    if (!isFieldDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };
  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  };
  const onDrop = (e) => {
    if (!isFieldDrag(e)) return;
    e.preventDefault();
    setDragOver(false);
    addRuleFor(e.dataTransfer.getData('application/field-name'), e.dataTransfer.getData('application/field-type') === 'measure');
  };
  const addRuleRef = useRef(addRuleFor);
  addRuleRef.current = addRuleFor;
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const enter = () => setDragOver(true);
    const leave = () => setDragOver(false);
    const drop = (e) => { setDragOver(false); const d = e.detail || {}; addRuleRef.current(d.fieldName, d.fieldType === 'measure'); };
    el.addEventListener('or:dragenter', enter);
    el.addEventListener('or:dragleave', leave);
    el.addEventListener('or:drop', drop);
    return () => {
      el.removeEventListener('or:dragenter', enter);
      el.removeEventListener('or:dragleave', leave);
      el.removeEventListener('or:drop', drop);
    };
  }, [visible]);

  // Anchor: edit mode pins to the clicked chip — but new (unsaved) rules
  // don't render a chip, so we fall back to the + button for those.
  const anchorEl = popMode?.type === 'edit'
    ? (chipRefs.current[popMode.idx] || triggerRef.current)
    : triggerRef.current;
  const updateCoords = () => {
    const r = anchorEl?.getBoundingClientRect?.();
    if (!r) return;
    setCoords({ top: r.bottom + 4, left: r.left });
  };
  useLayoutEffect(() => {
    if (!popOpen) return;
    updateCoords();
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popOpen, popMode?.type, popMode?.idx]);

  useEffect(() => {
    if (!popOpen) return;
    const handle = (e) => {
      if (anchorEl?.contains?.(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      // Nested portals owned by children of this popover (DimensionMultiSelect's
      // dropdown, etc.) live under document.body too, so a vanilla contains()
      // check misses them. Treat them as "inside" via a marker attribute.
      if (e.target?.closest?.('[data-no-outside-close]')) return;
      closePop();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popOpen, anchorEl]);

  if (!shouldRender) return null;

  return (
    <div ref={barRef} data-touch-drop="" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={dragOver ? { ...barStyle, ...barDragOverStyle } : barStyle} data-testid="report-filter-bar">
      <TbFilter size={14} style={_hs0} />
      <span style={_hs1}>
        Report filters
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (popMode?.type === 'add' ? closePop() : openAdd())}
        style={addBtnStyle}
        title="Add a report filter"
      >
        <AddIcon size={ICON_SIZE.chip} />
      </button>
      <div style={chipsRowStyle}>
        {wf.map((r, i) => {
          if (r.__isNew) return null;
          const isInteractionsActive = activeInteractionsRuleIdx === i;
          return (
            <span
              key={i}
              ref={(el) => { if (el) chipRefs.current[i] = el; else delete chipRefs.current[i]; }}
              onClick={() => (popMode?.type === 'edit' && popMode.idx === i ? closePop() : openEdit(i))}
              style={isInteractionsActive ? { ...chipStyle, ...chipStyleActiveInter } : chipStyle}
              title="Click to edit"
            >
              <span style={_hs2}>
                {ruleSummary(r, model)}
              </span>
              {onEditRuleInteractions && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEditRuleInteractions(isInteractionsActive ? null : i); }}
                  style={isInteractionsActive ? { ...chipInterBtn, color: 'var(--accent-primary)' } : chipInterBtn}
                  title={isInteractionsActive
                    ? 'Stop editing widget interactions for this rule'
                    : 'Edit which widgets this rule applies to'}
                >
                  <TbHandClick size={11} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); removeRule(i); if (popMode?.type === 'edit' && popMode.idx === i) closePop(); }}
                style={chipDelBtn}
                title="Remove"
              >
                <TbX size={10} />
              </button>
            </span>
          );
        })}
        {dragOver ? (
          <span style={_hs5}>Drop the field here to filter the report on it</span>
        ) : visibleCount === 0 && (
          <span style={_hs3}>
            No filters — click + to add, or drop a field here
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => { closePop(); onVisibilityChange?.(false); }}
        style={dismissBtnStyle}
        title="Hide filter bar (filters stay active)"
      >
        <TbX size={12} />
      </button>

      {popOpen && createPortal(
        <div
          ref={popRef}
          style={{ ...popStyle, top: coords.top, left: coords.left }}
        >
          {popMode?.type === 'add' && model && (
            <>
              <div style={popHeaderStyle}>Add filter</div>
              <FieldPicker model={model} onPick={addRuleFor} />
            </>
          )}
          {popMode?.type === 'edit' && model && wf[popMode.idx] && (
            <>
              <div style={popHeaderStyle}>Edit filter</div>
              <FilterRulesEditor
                model={model}
                modelId={model.id}
                rules={[wf[popMode.idx]]}
                onChange={(next) => {
                  if (!Array.isArray(next) || next.length === 0) {
                    // Rule was removed from within the editor card.
                    setDraftRules(wf.filter((_, i) => i !== popMode.idx));
                    closePop();
                    return;
                  }
                  const merged = [...wf];
                  merged[popMode.idx] = next[0];
                  setDraftRules(merged);
                }}
              />
            </>
          )}
          {dirty && (
            <div style={popActionsStyle}>
              <button type="button" onClick={discardDraft} style={discardBtnStyle} title="Cancel unsaved changes">
                Cancel
              </button>
              <div style={_hs4} />
              <button type="button" onClick={commitSave} style={saveBtnStyle} title="Save without refetching visuals (changes apply on next refresh)">
                Save
              </button>
              <button type="button" onClick={commitSaveAndRefresh} style={savePrimaryBtnStyle} title="Save and refresh every widget">
                Save &amp; refresh
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

const barStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 12px',
  background: 'var(--bg-subtle)',
  borderBottom: '1px solid var(--border-default)',
  flexShrink: 0, minHeight: 28,
};

const chipsRowStyle = {
  display: 'flex', alignItems: 'center', gap: 4,
  flexWrap: 'wrap', flex: 1, minWidth: 0,
};

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 4px 2px 8px',
  borderRadius: 12, fontSize: 11,
  background: 'var(--accent-primary-soft)',
  color: 'var(--accent-primary-text)',
  border: '1px solid var(--accent-primary-border)',
  cursor: 'pointer',
  maxWidth: 260,
};

const chipDelBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--accent-primary)', lineHeight: 0,
  padding: 2, borderRadius: '50%',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const chipInterBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-disabled)', lineHeight: 0,
  padding: 2, borderRadius: '50%',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const chipStyleActiveInter = {
  outline: '2px solid var(--accent-primary)',
  outlineOffset: 1,
};

const addBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: 3,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 6, cursor: 'pointer',
  color: 'var(--text-secondary)',
  flexShrink: 0,
};

const dismissBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: 2,
  background: 'transparent', border: 'none',
  borderRadius: 4, cursor: 'pointer',
  color: 'var(--text-disabled)',
  flexShrink: 0,
};

const saveBtnStyle = {
  padding: '3px 10px', fontSize: 11, fontWeight: 500,
  background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)', borderRadius: 4,
  cursor: 'pointer', flexShrink: 0,
};

const savePrimaryBtnStyle = {
  padding: '3px 10px', fontSize: 11, fontWeight: 600,
  background: 'var(--accent-primary)', color: '#fff',
  border: '1px solid var(--accent-primary)', borderRadius: 4,
  cursor: 'pointer', flexShrink: 0,
};

const discardBtnStyle = {
  padding: '3px 10px', fontSize: 11, fontWeight: 500,
  background: 'transparent', color: 'var(--text-muted)',
  border: 'none', borderRadius: 4,
  cursor: 'pointer', flexShrink: 0,
};

const popStyle = {
  position: 'fixed', zIndex: 9999,
  width: 340, maxHeight: '70vh', overflowY: 'auto',
  padding: 10,
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
};

const popHeaderStyle = {
  fontSize: 12, fontWeight: 600,
  color: 'var(--text-primary)', marginBottom: 4,
};

const popActionsStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  marginTop: 10, paddingTop: 8,
  borderTop: '1px solid var(--border-default)',
};

const barDragOverStyle = {
  background: 'var(--accent-primary-soft)',
  boxShadow: 'inset 0 0 0 2px var(--accent-primary)',
};

const pickerSearchStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px 8px', marginBottom: 6,
  border: '1px solid var(--border-default)', borderRadius: 6,
  background: 'var(--bg-panel)',
};

const pickerInputStyle = {
  flex: 1, border: 'none', outline: 'none', fontSize: 12,
  background: 'transparent', color: 'var(--text-primary)', minWidth: 0,
};

const pickerListStyle = { maxHeight: 260, overflowY: 'auto' };

const pickerGroupStyle = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'var(--text-muted)', padding: '6px 4px 2px',
};

const pickerItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '5px 8px', fontSize: 12, borderRadius: 4,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-primary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
