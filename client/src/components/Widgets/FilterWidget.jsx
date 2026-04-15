import { useState, useMemo } from 'react';

export default function FilterWidget({ data, config, onFilterChange }) {
  const [selected, setSelected] = useState(config?.selectedValues || []);
  const [search, setSearch] = useState('');

  const values = data?.values || [];
  const label = data?.label || config?.title || 'Filter';
  const multiSelect = config?.multiSelect ?? true;

  const filteredValues = useMemo(() => {
    if (!search) return values;
    return values.filter((v) => String(v).toLowerCase().includes(search.toLowerCase()));
  }, [values, search]);

  const handleToggle = (val) => {
    let next;
    if (multiSelect) {
      next = selected.includes(val)
        ? selected.filter((v) => v !== val)
        : [...selected, val];
    } else {
      next = selected.includes(val) ? [] : [val];
    }
    setSelected(next);
    onFilterChange?.(next);
  };

  const handleSelectAll = () => {
    setSelected([]);
    onFilterChange?.([]);
  };

  if (values.length === 0) {
    return <div style={emptyStyle}>Select a dimension to create a filter</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 8 }}>
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search..."
        style={searchStyle}
      />

      {/* Select all / Clear */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <button onClick={handleSelectAll} style={linkBtn}>
          {selected.length === 0 ? 'All selected' : 'Select all'}
        </button>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>
          {selected.length > 0 ? `${selected.length} selected` : `${values.length} values`}
        </span>
      </div>

      {/* Values list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filteredValues.map((val, i) => {
          const strVal = String(val);
          const isChecked = selected.length === 0 || selected.includes(val);
          return (
            <label key={i} style={rowStyle}>
              <input
                type={multiSelect ? 'checkbox' : 'radio'}
                checked={isChecked}
                onChange={() => handleToggle(val)}
                style={{ marginRight: 6 }}
              />
              <span style={{
                fontSize: 12,
                color: isChecked ? '#0f172a' : '#94a3b8',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {strVal}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 16,
};

const searchStyle = {
  width: '100%', padding: '4px 8px', border: '1px solid #e2e8f0',
  borderRadius: 4, fontSize: 12, outline: 'none', marginBottom: 6,
  boxSizing: 'border-box',
};

const linkBtn = {
  background: 'none', border: 'none', color: '#3b82f6',
  fontSize: 11, cursor: 'pointer', padding: 0,
};

const rowStyle = {
  display: 'flex', alignItems: 'center', padding: '2px 0',
  cursor: 'pointer',
};
