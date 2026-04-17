import { useState, useMemo, memo } from 'react';

/**
 * Power BI-style Slicer widget.
 * Modes: list (checkboxes), dropdown, buttons, range (for numbers/dates)
 */
export default memo(function FilterWidget({ data, config, onFilterChange }) {
  const [selected, setSelected] = useState(config?.selectedValues || []);
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const values = data?.values || [];
  const label = data?.label || config?.title || 'Filter';
  const multiSelect = config?.multiSelect ?? true;
  const slicerStyle = config?.slicerStyle || 'list'; // 'list' | 'dropdown' | 'buttons' | 'range'
  const showSearch = config?.showSearch ?? true;
  const showSelectAll = config?.showSelectAll ?? true;
  const orientation = config?.orientation || 'vertical'; // 'vertical' | 'horizontal'
  const fontSize = config?.slicerFontSize || 12;
  const fontColor = config?.slicerFontColor || '#0f172a';
  const selectedColor = config?.slicerSelectedColor || '#3b82f6';
  const selectedBg = config?.slicerSelectedBg || '#eff6ff';

  const filteredValues = useMemo(() => {
    if (!search) return values;
    return values.filter((v) => String(v).toLowerCase().includes(search.toLowerCase()));
  }, [values, search]);

  // selected = [] means no filter (all data shown, nothing checked)
  // selected = ["Paris"] means filter on Paris only (Paris checked)
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

  const handleSelectAll = () => {
    // Check all = filter on all values (same as no filter)
    setSelected([]);
    onFilterChange?.([]);
  };

  const handleClearAll = () => {
    setSelected([]);
    onFilterChange?.([]);
  };

  const isChecked = (val) => selected.includes(val);
  const selectedCount = selected.length;

  if (values.length === 0) {
    return <div style={emptyStyle}>Select a dimension to create a slicer</div>;
  }

  // ─── DROPDOWN MODE ───
  if (slicerStyle === 'dropdown') {
    const displayText = selected.length === 0 ? 'All'
      : selected.length === 1 ? String(selected[0])
      : `${selected.length} selected`;

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8 }}>
        <div
          onClick={() => setDropdownOpen(!dropdownOpen)}
          style={{
            padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6,
            cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize, color: fontColor, backgroundColor: '#fff',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText}</span>
          <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{dropdownOpen ? '▲' : '▼'}</span>
        </div>
        {dropdownOpen && (
          <div style={{
            border: '1px solid #e2e8f0', borderRadius: 6, marginTop: 4, overflow: 'auto',
            flex: 1, backgroundColor: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
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
            {filteredValues.map((val, i) => (
              <label key={i} style={{ ...listRowStyle, fontSize, color: isChecked(val) ? fontColor : '#94a3b8' }}>
                <input type={multiSelect ? 'checkbox' : 'radio'} checked={isChecked(val)}
                  onChange={() => handleToggle(val)} style={{ marginRight: 6, accentColor: selectedColor }} />
                {String(val)}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── BUTTONS MODE ───
  if (slicerStyle === 'buttons') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8 }}>
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
          {filteredValues.map((val, i) => {
            const active = isChecked(val);
            return (
              <button key={i} onClick={() => handleToggle(val)}
                style={{
                  padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize,
                  border: `1px solid ${active ? selectedColor : '#e2e8f0'}`,
                  backgroundColor: active ? selectedBg : '#fff',
                  color: active ? selectedColor : fontColor,
                  fontWeight: active ? 600 : 400,
                  whiteSpace: 'nowrap', flexShrink: 0,
                  transition: 'all 0.1s',
                }}
              >
                {String(val)}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          <span>{rangeMin}</span>
          <span>{rangeMax}</span>
        </div>
        <input type="range" min={min} max={max} value={rangeMin}
          onChange={(e) => {
            const v = Number(e.target.value);
            const next = [v, rangeMax];
            setSelected(next);
            onFilterChange?.(next);
          }}
          style={{ width: '100%', marginBottom: 4 }} />
        <input type="range" min={min} max={max} value={rangeMax}
          onChange={(e) => {
            const v = Number(e.target.value);
            const next = [rangeMin, v];
            setSelected(next);
            onFilterChange?.(next);
          }}
          style={{ width: '100%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
          <input type="number" min={min} max={max} value={rangeMin}
            onChange={(e) => {
              const v = Number(e.target.value);
              const next = [v, rangeMax];
              setSelected(next);
              onFilterChange?.(next);
            }}
            style={{ ...numInputStyle, flex: 1 }} />
          <span style={{ color: '#94a3b8', fontSize: 12, alignSelf: 'center' }}>—</span>
          <input type="number" min={min} max={max} value={rangeMax}
            onChange={(e) => {
              const v = Number(e.target.value);
              const next = [rangeMin, v];
              setSelected(next);
              onFilterChange?.(next);
            }}
            style={{ ...numInputStyle, flex: 1 }} />
        </div>
      </div>
    );
  }

  // ─── LIST MODE (default, Power BI-style) ───
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8 }}>
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
                if (selected.length > 0) { handleClearAll(); } // Uncheck all = clear filter
                else { setSelected([...values]); onFilterChange?.([...values]); } // Check all = filter on all
              }}
              style={{ marginRight: 6, accentColor: selectedColor }} />
            {selected.length === 0 ? 'Select all' : 'Clear all'}
          </label>
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
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
        {filteredValues.map((val, i) => {
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
                {String(val)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};

const searchInputStyle = {
  width: '100%', padding: '5px 8px', border: '1px solid #e2e8f0',
  borderRadius: 4, fontSize: 12, outline: 'none', marginBottom: 6,
  boxSizing: 'border-box',
};

const linkBtn = {
  background: 'none', border: 'none', color: '#3b82f6',
  fontSize: 11, cursor: 'pointer', padding: 0,
};

const listRowStyle = {
  display: 'flex', alignItems: 'center', padding: '2px 0',
  cursor: 'pointer', userSelect: 'none',
};

const numInputStyle = {
  padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4,
  fontSize: 12, outline: 'none', textAlign: 'center', boxSizing: 'border-box',
};
