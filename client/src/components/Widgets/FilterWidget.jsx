import { useState, useMemo, memo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import MiniCalendar from './MiniCalendar';

/**
 * Power BI-style Slicer widget.
 * Modes: list, dropdown, buttons, range, dateRange, dateBetween, dateRelative
 */
export default memo(function FilterWidget({ data, config, onFilterChange, activeSelection }) {
  const [selected, setSelected] = useState(activeSelection || config?.selectedValues || []);

  // Sync selection when activeSelection changes (e.g. page switch)
  useEffect(() => {
    if (activeSelection !== undefined) {
      setSelected(activeSelection || []);
    }
  }, [activeSelection]);
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [relValue, setRelValue] = useState(config?.relativeValue || 7);
  const [relUnit, setRelUnit] = useState(config?.relativeUnit || 'days');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [calendarTarget, setCalendarTarget] = useState(null); // null | 'from' | 'to'
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const dropdownRef = useRef(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 200 });
  const relAppliedRef = useRef(false);

  // Reset transient UI state when the bound dimension changes (selected is synced via activeSelection effect)
  const prevDimRef = useRef(data?._dimName);
  useEffect(() => {
    if (prevDimRef.current !== data?._dimName) {
      prevDimRef.current = data?._dimName;
      // If no slicer-wide selection exists for this dim, clear local selected too
      if (activeSelection === undefined || activeSelection === null) {
        setSelected(config?.selectedValues || []);
      }
      setSearch('');
      setDateFrom('');
      setDateTo('');
      relAppliedRef.current = false;
    }
  }, [data?._dimName, config?.selectedValues, activeSelection]);

  // Update popup position when target changes
  useEffect(() => {
    const el = calendarTarget === 'from' ? fromRef.current : calendarTarget === 'to' ? toRef.current : null;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPopupPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [calendarTarget]);

  // Close dropdown on outside click
  const dropdownPopupRef = useRef(null);
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      if (dropdownPopupRef.current && dropdownPopupRef.current.contains(e.target)) return;
      setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const values = data?.values || [];
  const isDate = data?._isDate || false;
  const label = data?.label || config?.title || 'Filter';
  const multiSelect = config?.multiSelect ?? true;
  const slicerStyle = config?.slicerStyle || (isDate ? 'dateRange' : 'list');
  const showSearch = config?.showSearch ?? true;
  const showSelectAll = config?.showSelectAll ?? true;
  const orientation = config?.orientation || 'vertical';
  const fontSize = config?.slicerFontSize || 12;
  const fontColor = config?.slicerFontColor || 'var(--text-primary)';
  const selectedColor = config?.slicerSelectedColor || '#7c3aed';
  const selectedBg = config?.slicerSelectedBg || 'var(--bg-active)';

  const filteredValues = useMemo(() => {
    if (!search) return values;
    return values.filter((v) => String(v).toLowerCase().includes(search.toLowerCase()));
  }, [values, search]);

  // Sort: dates chronologically, then selected values bubble to the top
  const sortedValues = useMemo(() => {
    const base = isDate
      ? [...filteredValues].sort((a, b) => new Date(a) - new Date(b))
      : filteredValues;
    if (!selected || selected.length === 0) return base;
    const selectedSet = new Set(selected.map(String));
    const sel = [];
    const rest = [];
    for (const v of base) {
      if (selectedSet.has(String(v))) sel.push(v);
      else rest.push(v);
    }
    return [...sel, ...rest];
  }, [filteredValues, isDate, selected]);

  const handleToggle = (val) => {
    let next;
    if (multiSelect) {
      next = selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val];
    } else {
      next = selected.includes(val) ? [] : [val];
    }
    setSelected(next);
    onFilterChange?.(next);
  };

  const handleSelectAll = () => { setSelected([]); onFilterChange?.([]); };
  const handleClearAll = () => { setSelected([]); onFilterChange?.([]); };

  const isChecked = (val) => selected.includes(val);
  const selectedCount = selected.length;

  const formatDate = (val) => {
    if (!isDate) return String(val);
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (values.length === 0) {
    return <div style={emptyStyle}>Select a dimension to create a slicer</div>;
  }

  // ─── DATE RANGE MODE (Between) ───
  if (slicerStyle === 'dateRange' || slicerStyle === 'dateBetween') {
    const dateValues = sortedValues.map((v) => new Date(v)).filter((d) => !isNaN(d));
    const minDate = dateValues.length > 0 ? dateValues[0] : new Date();
    const maxDate = dateValues.length > 0 ? dateValues[dateValues.length - 1] : new Date();

    const startDate = dateFrom;
    const endDate = dateTo;

    const applyRange = (start, end) => {
      setDateFrom(start || '');
      setDateTo(end || '');
      if (!start && !end) { setSelected([]); onFilterChange?.([]); return; }
      const filtered = values.filter((v) => {
        const d = new Date(v);
        if (isNaN(d)) return false;
        if (start && d < new Date(start)) return false;
        if (end && d > new Date(end + 'T23:59:59')) return false;
        return true;
      });
      setSelected(filtered);
      onFilterChange?.(filtered);
    };

    const dateLayout = config?.dateLayout || 'vertical'; // 'vertical' | 'horizontal'
    const isHoriz = dateLayout === 'horizontal';

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 10, gap: 8 }}>
        {/* Date inputs */}
        <div style={{ display: 'flex', flexDirection: isHoriz ? 'row' : 'column', gap: 6, flexShrink: 0, alignItems: isHoriz ? 'flex-end' : 'stretch' }}>
          <div style={{ flex: isHoriz ? 1 : undefined }}>
            <label style={{ fontSize: 10, color: 'var(--text-disabled)', display: 'block', marginBottom: 2 }}>From</label>
            <input ref={fromRef} type="text" value={startDate ? formatDate(startDate) : ''}
              readOnly placeholder="Select date"
              onClick={() => setCalendarTarget(calendarTarget === 'from' ? null : 'from')}
              style={{ ...dateInputStyle, cursor: 'pointer', backgroundColor: calendarTarget === 'from' ? 'var(--bg-active)' : 'var(--bg-panel)' }} />
          </div>
          {isHoriz && <span style={{ fontSize: 12, color: 'var(--text-disabled)', paddingBottom: 6 }}>→</span>}
          <div style={{ flex: isHoriz ? 1 : undefined }}>
            <label style={{ fontSize: 10, color: 'var(--text-disabled)', display: 'block', marginBottom: 2 }}>To</label>
            <input ref={toRef} type="text" value={endDate ? formatDate(endDate) : ''}
              readOnly placeholder="Select date"
              onClick={() => setCalendarTarget(calendarTarget === 'to' ? null : 'to')}
              style={{ ...dateInputStyle, cursor: 'pointer', backgroundColor: calendarTarget === 'to' ? 'var(--bg-active)' : 'var(--bg-panel)' }} />
          </div>
        </div>
        {/* Calendar popup — rendered in body via portal */}
        {calendarTarget && createPortal(
          <div style={{
            position: 'fixed', zIndex: 9999,
            top: popupPos.top, left: popupPos.left,
            border: '1px solid var(--border-default)', borderRadius: 8, padding: 8,
            backgroundColor: 'var(--bg-panel)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            minWidth: 230,
          }}>
            <MiniCalendar
              value={calendarTarget === 'from' ? startDate : endDate}
              min={calendarTarget === 'to' && startDate ? startDate : toInputDate(minDate)}
              max={calendarTarget === 'from' && endDate ? endDate : toInputDate(maxDate)}
              rangeStart={startDate} rangeEnd={endDate}
              onChange={(v) => {
                if (calendarTarget === 'from') {
                  applyRange(v, endDate);
                  setCalendarTarget('to');
                } else {
                  applyRange(startDate, v);
                  setCalendarTarget(null);
                }
              }}
            />
          </div>,
          document.body
        )}
        {(selectedCount > 0 || dateFrom || dateTo) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6, flexShrink: 0 }}>
            <button onClick={() => { setDateFrom(''); setDateTo(''); setSelected([]); onFilterChange?.([]); }}
              style={linkBtn}>Clear</button>
          </div>
        )}
      </div>
    );
  }

  // ─── DATE RELATIVE MODE ───
  if (slicerStyle === 'dateRelative') {
    const computeCutoff = (val, unit) => {
      // Use start of today (midnight) for clean date comparison
      const now = new Date();
      const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (unit === 'days') cutoff.setDate(cutoff.getDate() - val);
      else if (unit === 'weeks') cutoff.setDate(cutoff.getDate() - val * 7);
      else if (unit === 'months') cutoff.setMonth(cutoff.getMonth() - val);
      else if (unit === 'years') cutoff.setFullYear(cutoff.getFullYear() - val);
      return cutoff;
    };

    const applyRelative = (val, unit) => {
      const cutoff = computeCutoff(val, unit);
      const filtered = values.filter((v) => {
        const d = new Date(v);
        if (isNaN(d)) return false;
        // Compare date-only (strip time component)
        const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return dDate >= cutoff;
      });
      setSelected(filtered);
      onFilterChange?.(filtered);
    };

    // Auto-apply filter on first render in this mode
    if (!relAppliedRef.current && values.length > 0) {
      relAppliedRef.current = true;
      // Defer to avoid updating state during render
      setTimeout(() => applyRelative(relValue, relUnit), 0);
    }

    const cutoff = computeCutoff(relValue, relUnit);
    const cutoffStr = cutoff.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, justifyContent: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>Relative Date</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Last</span>
          <input type="number" min={0} max={365} value={relValue}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') { setRelValue(''); return; }
              const v = parseInt(raw, 10);
              if (isNaN(v) || v < 0) return;
              setRelValue(v); applyRelative(v, relUnit);
            }}
            onBlur={() => { if (relValue === '' || relValue === null) { setRelValue(0); applyRelative(0, relUnit); } }}
            style={{ ...dateInputStyle, width: 50, textAlign: 'center' }} />
          <select value={relUnit}
            onChange={(e) => { setRelUnit(e.target.value); applyRelative(relValue, e.target.value); }}
            style={{ ...dateInputStyle, width: 90 }}>
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 }}>
          {selectedCount > 0
            ? `${selectedCount} date(s) from ${cutoffStr}`
            : `No dates found after ${cutoffStr}`}
        </div>
        {selectedCount > 0 && (
          <button onClick={() => { setSelected([]); onFilterChange?.([]); relAppliedRef.current = false; }}
            style={{ ...linkBtn, alignSelf: 'flex-start', marginTop: 4 }}>Clear filter</button>
        )}
      </div>
    );
  }

  // ─── DROPDOWN MODE ───
  if (slicerStyle === 'dropdown') {
    const displayText = selected.length === 0 ? 'All'
      : selected.length === 1 ? (isDate ? formatDate(selected[0]) : String(selected[0]))
      : `${selected.length} selected`;

    const openDropdown = () => {
      if (dropdownRef.current) {
        const rect = dropdownRef.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
      }
      setDropdownOpen(!dropdownOpen);
    };

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 4 }}>
        <div ref={dropdownRef} onClick={openDropdown}
          style={{
            padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 6,
            cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize, color: fontColor, backgroundColor: 'var(--bg-panel)',
          }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText}</span>
          <span style={{ fontSize: 10, color: 'var(--text-disabled)', flexShrink: 0 }}>{dropdownOpen ? '▲' : '▼'}</span>
        </div>
        {dropdownOpen && createPortal(
          <div ref={dropdownPopupRef} onClick={(e) => e.stopPropagation()} style={{
            position: 'fixed', zIndex: 9999,
            top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width,
            border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'auto',
            maxHeight: 300, backgroundColor: 'var(--bg-panel)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}>
            {showSearch && (
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..." style={{ ...searchInputStyle, margin: 6, width: 'calc(100% - 12px)' }} />
            )}
            {showSelectAll && multiSelect && (
              <div style={{ padding: '2px 10px', borderBottom: '1px solid #f1f5f9' }}>
                <button onClick={handleSelectAll} style={linkBtn}>Select all</button>
              </div>
            )}
            {sortedValues.map((val, i) => (
              <label key={i} style={{ ...listRowStyle, fontSize, color: isChecked(val) ? fontColor : 'var(--text-disabled)', padding: '4px 10px' }}>
                <input type={multiSelect ? 'checkbox' : 'radio'} checked={isChecked(val)}
                  onChange={() => handleToggle(val)} style={{ marginRight: 6, accentColor: selectedColor }} />
                {isDate ? formatDate(val) : String(val)}
              </label>
            ))}
          </div>,
          document.body
        )}
      </div>
    );
  }

  // ─── BUTTONS MODE ───
  if (slicerStyle === 'buttons') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 4 }}>
        {showSelectAll && (
          <button onClick={handleSelectAll} style={{ ...linkBtn, marginBottom: 6, alignSelf: 'flex-start' }}>
            {selected.length === 0 ? 'All selected' : 'Select all'}
          </button>
        )}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, overflow: 'auto', flex: 1,
          flexDirection: orientation === 'horizontal' ? 'row' : 'column',
          alignContent: 'flex-start',
        }}>
          {sortedValues.map((val, i) => {
            const active = isChecked(val);
            return (
              <button key={i} onClick={() => handleToggle(val)}
                style={{
                  padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize,
                  border: `1px solid ${active ? selectedColor : 'var(--border-default)'}`,
                  backgroundColor: active ? selectedBg : 'var(--bg-panel)',
                  color: active ? selectedColor : fontColor,
                  fontWeight: active ? 600 : 400,
                  whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.1s',
                }}>
                {isDate ? formatDate(val) : String(val)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── RANGE MODE (numeric slider) ───
  if (slicerStyle === 'range') {
    const nums = values.map(Number).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    const min = nums[0] || 0;
    const max = nums[nums.length - 1] || 100;
    const rangeMin = selected[0] ?? min;
    const rangeMax = selected[1] ?? max;

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, justifyContent: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          <span>{rangeMin}</span><span>{rangeMax}</span>
        </div>
        <input type="range" min={min} max={max} value={rangeMin}
          onChange={(e) => { const v = Number(e.target.value); setSelected([v, rangeMax]); onFilterChange?.([v, rangeMax]); }}
          style={{ width: '100%', marginBottom: 4 }} />
        <input type="range" min={min} max={max} value={rangeMax}
          onChange={(e) => { const v = Number(e.target.value); setSelected([rangeMin, v]); onFilterChange?.([rangeMin, v]); }}
          style={{ width: '100%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
          <input type="number" min={min} max={max} value={rangeMin}
            onChange={(e) => { const v = Number(e.target.value); setSelected([v, rangeMax]); onFilterChange?.([v, rangeMax]); }}
            style={{ ...numInputStyle, flex: 1 }} />
          <span style={{ color: 'var(--text-disabled)', fontSize: 12, alignSelf: 'center' }}>—</span>
          <input type="number" min={min} max={max} value={rangeMax}
            onChange={(e) => { const v = Number(e.target.value); setSelected([rangeMin, v]); onFilterChange?.([rangeMin, v]); }}
            style={{ ...numInputStyle, flex: 1 }} />
        </div>
      </div>
    );
  }

  // ─── LIST MODE (default) ───
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 4 }}>
      {showSearch && (
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..." style={searchInputStyle} />
      )}
      {showSelectAll && multiSelect && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <label style={{ ...listRowStyle, fontWeight: 500, fontSize }}>
            <input type="checkbox"
              checked={selected.length > 0}
              ref={(el) => { if (el) el.indeterminate = selected.length > 0 && selected.length < values.length; }}
              onChange={() => {
                if (selected.length > 0) { handleClearAll(); }
                else { setSelected([...values]); onFilterChange?.([...values]); }
              }}
              style={{ marginRight: 6, accentColor: selectedColor }} />
            {selected.length === 0 ? 'Select all' : 'Clear all'}
          </label>
          <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>
            {selectedCount > 0 ? `${selectedCount} selected` : 'No filter'}
          </span>
        </div>
      )}
      <div style={{
        flex: 1, overflow: 'auto',
        display: orientation === 'horizontal' ? 'flex' : 'block',
        flexWrap: orientation === 'horizontal' ? 'wrap' : undefined,
        gap: orientation === 'horizontal' ? 4 : undefined,
      }}>
        {sortedValues.map((val, i) => {
          const checked = isChecked(val);
          return (
            <label key={i} style={{
              ...listRowStyle, fontSize,
              color: checked ? selectedColor : fontColor,
              backgroundColor: checked ? selectedBg : 'transparent',
              borderRadius: 3, padding: '3px 4px',
            }}>
              <input type={multiSelect ? 'checkbox' : 'radio'} checked={checked}
                onChange={() => handleToggle(val)}
                style={{ marginRight: 6, accentColor: selectedColor }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isDate ? formatDate(val) : String(val)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
});

function toInputDate(d) {
  if (!d || isNaN(d)) return '';
  return d.toISOString().split('T')[0];
}

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};

const searchInputStyle = {
  width: '100%', padding: '5px 8px', border: '1px solid var(--border-default)',
  borderRadius: 4, fontSize: 12, outline: 'none', marginBottom: 6, boxSizing: 'border-box',
};

const linkBtn = {
  background: 'transparent', border: 'none', color: 'var(--accent-primary)',
  fontSize: 11, cursor: 'pointer', padding: 0,
};

const listRowStyle = {
  display: 'flex', alignItems: 'center', padding: '2px 0',
  cursor: 'pointer', userSelect: 'none',
};

const numInputStyle = {
  padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4,
  fontSize: 12, outline: 'none', textAlign: 'center', boxSizing: 'border-box',
};

const dateInputStyle = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', color: 'var(--text-secondary)',
};

const calendarStyle = {
  width: '100%', padding: '4px', border: '1px solid var(--border-default)', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', color: 'var(--text-secondary)',
  minHeight: 40,
};
