import { useState, useMemo, memo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import MiniCalendar from './MiniCalendar';
import { fontStack, loadGoogleFont } from '../../utils/googleFonts';

/**
 * Power BI-style Slicer widget.
 * Modes: list, dropdown, buttons, range, dateRange, dateBetween, dateRelative
 */
const RENDER_BATCH = 200;

export default memo(function FilterWidget({ data, config, onFilterChange, activeSelection, onSearchValues }) {
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
  // Windowing — render at most renderLimit rows. "Show more" bumps it; we
  // reset it whenever the dim or search changes so we don't keep an inflated
  // window from a previous filter state.
  const [renderLimit, setRenderLimit] = useState(RENDER_BATCH);
  // dateCalendar 'between' mode: ISO of the FIRST click while waiting
  // for the second one. null = no anchor yet (next click sets it).
  // Resets after the range is applied OR when the dim / mode changes.
  const [betweenAnchor, setBetweenAnchor] = useState(null);

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
      setBetweenAnchor(null);
      relAppliedRef.current = false;
      setRenderLimit(RENDER_BATCH);
    }
  }, [data?._dimName, config?.selectedValues, activeSelection]);

  // dateCalendar mode change → drop the in-progress between anchor so
  // a user who flips from 'between' to 'multi' mid-range doesn't keep
  // a phantom anchor that hijacks the next click.
  useEffect(() => { setBetweenAnchor(null); }, [config?.dateCalendarMode]);

  // Searching narrows the visible set — reset windowing so "Show more" reflects
  // the new filtered universe.
  useEffect(() => { setRenderLimit(RENDER_BATCH); }, [search]);

  // Debounced server-side search. Tells the parent (Editor/Viewer) to fire a
  // /query with a `contains` filter so values beyond the cap-1000 initial
  // fetch surface in the slicer. The client-side filter below (filteredValues
  // memo) keeps working in parallel for snappy local feedback during the
  // debounce window.
  //
  // `onSearchValues` is captured through a ref so the effect deps only
  // track `search`. ReportCanvas re-creates this callback on every render
  // (inline arrow); without the ref we'd re-schedule the timeout on every
  // parent re-render and the cleared-search no-op would cycle 300ms after
  // every parent update — a render loop that hammered React's scheduler.
  const onSearchValuesRef = useRef(onSearchValues);
  onSearchValuesRef.current = onSearchValues;
  const searchDebounceRef = useRef(null);
  // Skip the initial mount: an empty `search` triggers handleSlicerSearch's
  // clear path, which is a no-op the first time but still allocates a new
  // React tree node. Wait for the user to actually type something.
  const searchHasChangedRef = useRef(false);
  useEffect(() => {
    if (!searchHasChangedRef.current) { searchHasChangedRef.current = true; return; }
    if (!onSearchValuesRef.current) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      onSearchValuesRef.current?.(search);
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [search]);

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

  // When the user types in the search box, the parent fires a server-side
  // /query with a `contains` filter and stuffs the result into
  // `data._searchedValues`. Until that lands (or when the search is empty)
  // we fall back to the cap-1000 initial list at `data.values`.
  const values = (search && Array.isArray(data?._searchedValues))
    ? data._searchedValues
    : (data?.values || []);
  const isDate = data?._isDate || false;
  const multiSelect = config?.multiSelect ?? true;
  const slicerStyle = config?.slicerStyle || (isDate ? 'dateRange' : 'list');
  const showSearch = config?.showSearch ?? true;
  const showSelectAll = config?.showSelectAll ?? true;
  const orientation = config?.orientation || 'vertical';
  const fontSize = config?.slicerFontSize || 12;
  const fontColor = config?.slicerFontColor || 'var(--text-primary)';
  const selectedColor = config?.slicerSelectedColor || '#7c3aed';
  const selectedBg = config?.slicerSelectedBg || 'var(--bg-active)';
  if (config?.slicerFontFamily) loadGoogleFont(config.slicerFontFamily);
  // Cascade the picked font to every label / input / button inside the
  // slicer via the outer wrapper. CSS inheritance handles the rest.
  const slicerFontStyle = config?.slicerFontFamily
    ? { fontFamily: fontStack(config.slicerFontFamily) }
    : null;

  const filteredValues = useMemo(() => {
    if (!search) return values;
    const q = search.toLowerCase();
    return values.filter((v) => String(v).toLowerCase().includes(q));
  }, [values, search]);

  // Dropdown mode: snapshot of `selected` at the moment the dropdown
  // OPENED. Used by sortedValues below so the row a user just ticked
  // doesn't jump to the top mid-interaction — selections stay in place
  // until they close + reopen the dropdown, at which point the new
  // snapshot puts the freshly selected rows at the top. Other slicer
  // modes (list, buttons, range) keep the live-sort behaviour: the rows
  // are always visible, so the bubble-to-top on click is harmless.
  const [frozenSelected, setFrozenSelected] = useState(selected);
  useEffect(() => {
    // Capture on open; skip on close so the snapshot survives outside
    // the open window without churn — only the next open overwrites it.
    if (dropdownOpen) setFrozenSelected(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownOpen]);
  const selectedForOrder = (dropdownOpen && slicerStyle === 'dropdown')
    ? frozenSelected
    : selected;

  // Sort: dates chronologically, then selected values bubble to the top
  const sortedValues = useMemo(() => {
    const base = isDate
      ? [...filteredValues].sort((a, b) => new Date(a) - new Date(b))
      : filteredValues;
    if (!selectedForOrder || selectedForOrder.length === 0) return base;
    const selectedSet = new Set(selectedForOrder.map(String));
    const sel = [];
    const rest = [];
    for (const v of base) {
      if (selectedSet.has(String(v))) sel.push(v);
      else rest.push(v);
    }
    return [...sel, ...rest];
  }, [filteredValues, isDate, selectedForOrder]);

  // Cap rendered rows so high-cardinality dimensions don't lock up the page.
  // Selected values are sorted to the top by sortedValues, so they survive the
  // slice. The "Show more" button extends the window in RENDER_BATCH-sized
  // increments; full list is still searchable.
  const visibleValues = sortedValues.length > renderLimit
    ? sortedValues.slice(0, renderLimit)
    : sortedValues;
  const hiddenCount = sortedValues.length - visibleValues.length;
  const showMore = () => setRenderLimit((n) => n + RENDER_BATCH);
  const showMoreBtnStyle = {
    width: '100%', padding: '4px 8px', fontSize: 11,
    background: 'transparent', border: 'none',
    borderTop: '1px solid var(--border-default)',
    color: 'var(--accent-primary)', cursor: 'pointer',
    textAlign: 'center',
  };

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
    const startDate = dateFrom;
    const endDate = dateTo;

    const applyRange = (start, end) => {
      setDateFrom(start || '');
      setDateTo(end || '');
      // Wait for BOTH endpoints before propagating to other widgets — a
      // partial range (only From or only To) would otherwise cross-filter
      // the rest of the report on the half-bound side every time the user
      // picks one date, well before they've finished defining the range.
      // Clear the cross-filter while the range is incomplete so consumers
      // see the full dataset until the user commits both dates.
      if (!start || !end) { setSelected([]); onFilterChange?.([]); return; }
      const filtered = values.filter((v) => {
        const d = new Date(v);
        if (isNaN(d)) return false;
        if (d < new Date(start)) return false;
        if (d > new Date(end + 'T23:59:59')) return false;
        return true;
      });
      setSelected(filtered);
      onFilterChange?.(filtered);
    };

    const dateLayout = config?.dateLayout || 'vertical'; // 'vertical' | 'horizontal'
    const isHoriz = dateLayout === 'horizontal';

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 10, gap: 8, ...slicerFontStyle }}>
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
              // Only enforce From ≤ To. Previously the calendar was ALSO
              // capped by the slicer's data min/max — but if the user picks
              // a From beyond the data's max (or the data only spans a
              // narrow window), the To calendar's max < min and every cell
              // ends up disabled / un-clickable. The user has no way out.
              // Drop the data-range cap; an out-of-range pick just filters
              // to an empty result, which is the correct semantic.
              min={calendarTarget === 'to' && startDate ? startDate : undefined}
              max={calendarTarget === 'from' && endDate ? endDate : undefined}
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
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, justifyContent: 'center', ...slicerFontStyle }}>
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

  // ─── DATE CALENDAR MODE (inline calendar, bootstrap-datepicker style) ───
  if (slicerStyle === 'dateCalendar') {
    // Three selection modes:
    //   - 'single'  : one date at a time; re-click deselects.
    //   - 'multi'   : toggle dates in/out individually (Bootstrap multidate).
    //   - 'between' : two clicks define a range; every available date
    //                 between (inclusive) lands in the selection.
    // Legacy config falls back to multi/single via the old multiSelect
    // boolean so existing reports keep their behaviour.
    const calMode = config?.dateCalendarMode || (multiSelect ? 'multi' : 'single');

    // Chronological span of AVAILABLE dates — drives the calendar's
    // disabled state. Built from raw `values` (NOT `sortedValues`,
    // which floats the currently-selected dates to the top → after the
    // first click `sortedValues[0]` would BE that selected date, so
    // minIso would snap to it and grey out every earlier day). Time
    // component is dropped via toLocalInputDate so the iso aligns
    // with MiniCalendar's local-day cell ids.
    const sortedAvail = (values || [])
      .map((v) => new Date(v))
      .filter((d) => !isNaN(d))
      .sort((a, b) => a - b);
    const minIso = sortedAvail.length ? toLocalInputDate(sortedAvail[0]) : '';
    const maxIso = sortedAvail.length ? toLocalInputDate(sortedAvail[sortedAvail.length - 1]) : '';
    // O(1) lookup: does the day clicked correspond to a date present
    // in the underlying data set? The MiniCalendar still emits
    // onChange for any non-disabled cell; this guards against
    // click-noops on sparse calendars.
    const availableSet = new Set(
      (values || []).map((v) => toLocalInputDate(new Date(v))).filter(Boolean)
    );
    // Selected isos passed to MiniCalendar for highlight.
    const selectedIsos = (selected || [])
      .map((v) => toLocalInputDate(new Date(v)))
      .filter(Boolean);
    // Between mode endpoints — used both to draw the range fill in
    // MiniCalendar and to render the "X dates selected (Y → Z)" hint.
    const sortedSelectedIsos = [...selectedIsos].sort((a, b) => new Date(a) - new Date(b));
    const rangeStart = calMode === 'between' && sortedSelectedIsos.length
      ? sortedSelectedIsos[0] : undefined;
    const rangeEnd = calMode === 'between' && sortedSelectedIsos.length
      ? sortedSelectedIsos[sortedSelectedIsos.length - 1] : undefined;

    const handleCalendarClick = (iso) => {
      // Match the click back to the original value in `values` (which
      // may be a full timestamp string, not just YYYY-MM-DD). One iso
      // can correspond to multiple values if the source has rows at
      // different times the same day; include them all so the parent
      // filter receives the right WHERE-IN list.
      const matches = (values || []).filter((v) => toLocalInputDate(new Date(v)) === iso);
      if (matches.length === 0) return;
      let next;
      if (calMode === 'between') {
        if (!betweenAnchor) {
          // First click of a new range — store the anchor, highlight
          // just that one date, wait for the second click.
          setBetweenAnchor(iso);
          setSelected(matches);
          onFilterChange?.(matches);
          return;
        }
        // Second click — pick every available date between anchor
        // and click (inclusive, order-insensitive).
        const [startIso, endIso] = iso < betweenAnchor
          ? [iso, betweenAnchor]
          : [betweenAnchor, iso];
        next = (values || []).filter((v) => {
          const localIso = toLocalInputDate(new Date(v));
          return localIso >= startIso && localIso <= endIso;
        });
        setBetweenAnchor(null);
      } else if (calMode === 'multi') {
        const setSel = new Set(selected.map(String));
        const allSelected = matches.every((m) => setSel.has(String(m)));
        if (allSelected) {
          matches.forEach((m) => setSel.delete(String(m)));
        } else {
          matches.forEach((m) => setSel.add(String(m)));
        }
        next = [...setSel];
      } else {
        // Single — click the same date again deselects.
        const same = selected.length === matches.length
          && matches.every((m) => selected.includes(m));
        next = same ? [] : matches;
      }
      setSelected(next);
      onFilterChange?.(next);
    };

    const clearAll = () => {
      setSelected([]);
      setBetweenAnchor(null);
      onFilterChange?.([]);
    };

    // Footer message — between mode signals which step the user is on
    // so a calendar with one date highlighted doesn't look like a
    // stuck single-select. After the second click, fall back to the
    // generic "N dates selected" so the user sees the range size.
    let footerText = '';
    if (calMode === 'between' && betweenAnchor) {
      footerText = 'Pick the end date';
    } else if (selectedCount > 0) {
      footerText = `${selectedCount} ${selectedCount === 1 ? 'date' : 'dates'} selected`;
    }

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8, gap: 6, ...slicerFontStyle, overflow: 'auto' }}>
        <MiniCalendar
          min={minIso}
          max={maxIso}
          selectedDates={calMode !== 'single' ? selectedIsos : undefined}
          value={calMode === 'single' && selectedIsos.length ? selectedIsos[0] : undefined}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onChange={(iso) => {
            // Days without underlying data: greyed out via min/max,
            // but a click between sparse days could still emit. Guard.
            if (!availableSet.has(iso)) return;
            handleCalendarClick(iso);
          }}
        />
        {footerText && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>{footerText}</span>
            {(selectedCount > 0 || betweenAnchor) && (
              <button onClick={clearAll} style={linkBtn}>Clear</button>
            )}
          </div>
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
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 4, ...slicerFontStyle }}>
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
            {visibleValues.map((val, i) => (
              <label key={i} style={{ ...listRowStyle, fontSize, color: isChecked(val) ? fontColor : 'var(--text-disabled)', padding: '4px 10px' }}>
                <input type={multiSelect ? 'checkbox' : 'radio'} checked={isChecked(val)}
                  onChange={() => handleToggle(val)} style={{ marginRight: 6, accentColor: selectedColor }} />
                {isDate ? formatDate(val) : String(val)}
              </label>
            ))}
            {hiddenCount > 0 && (
              <button type="button" onClick={showMore} style={showMoreBtnStyle}>
                Show {Math.min(RENDER_BATCH, hiddenCount)} more ({hiddenCount} remaining)
              </button>
            )}
          </div>,
          document.body
        )}
      </div>
    );
  }

  // ─── BUTTONS MODE ───
  if (slicerStyle === 'buttons') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 4, ...slicerFontStyle }}>
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
          {visibleValues.map((val, i) => {
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
          {hiddenCount > 0 && (
            <button type="button" onClick={showMore} style={{ ...showMoreBtnStyle, borderTop: 'none', marginTop: 4 }}>
              Show {Math.min(RENDER_BATCH, hiddenCount)} more ({hiddenCount} remaining)
            </button>
          )}
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
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, justifyContent: 'center', ...slicerFontStyle }}>
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 4, ...slicerFontStyle }}>
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
        {visibleValues.map((val, i) => {
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
        {hiddenCount > 0 && (
          <button type="button" onClick={showMore} style={showMoreBtnStyle}>
            Show {Math.min(RENDER_BATCH, hiddenCount)} more ({hiddenCount} remaining)
          </button>
        )}
      </div>
    </div>
  );
});

// Build a YYYY-MM-DD iso from LOCAL year/month/day instead of
// UTC — matches the iso that MiniCalendar emits on a day click (which
// is built from `viewDate.getFullYear() / getMonth() / getDate()`, i.e.
// local). Using UTC here would shift the iso by a day in any timezone
// where the source timestamp's UTC date differs from its local date
// (e.g. a `…T23:00:00Z` value is Jan 15 UTC but Jan 16 local in CET);
// the calendar would show the cell on Jan 16 but availableSet would
// only know Jan 15 → click no-op + min/max snapped to the wrong day.
function toLocalInputDate(d) {
  if (!d || isNaN(d)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
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
