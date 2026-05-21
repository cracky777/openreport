import { useState, memo } from 'react';

const DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTHS_SHORT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

// Three-level navigation: day grid (default) → click the "Month YYYY"
// header to zoom out to a 12-cell month grid → click the year on top
// of THAT to zoom out one more level to a 12-cell decade-of-years
// grid. Same pattern as bootstrap-datepicker / Material date picker.
// Picking a cell at the higher level zooms back in: a year click goes
// to month, a month click goes to days. min/max remain in YYYY-MM-DD
// form throughout and gate the disabled state at every level.
export default memo(function MiniCalendar({ value, onChange, min, max, rangeStart, rangeEnd, selectedDates }) {
  const selected = value ? new Date(value) : null;
  // Multi-select: caller passes an array of ISO date strings; we
  // build a Set lookup so highlighting + toggle stay O(1). When
  // present, every matching cell renders as selected — `value` is
  // ignored except as the initial month-view anchor below.
  const selectedSet = selectedDates && selectedDates.length > 0
    ? new Set(selectedDates.map(String))
    : null;
  const [viewDate, setViewDate] = useState(() => {
    const anchor = selected
      || (selectedDates && selectedDates[0] ? new Date(selectedDates[0]) : null)
      || (min ? new Date(min) : new Date());
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });
  // Current zoom level. State is internal — the picked-value contract
  // with the parent stays YYYY-MM-DD-only, the higher levels just
  // navigate viewDate.
  const [view, setView] = useState('day'); // 'day' | 'month' | 'year'

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Bounds parsed once so the per-cell disabled checks at each level
  // stay simple comparisons. min/max are ISO `YYYY-MM-DD` strings.
  const minY = min ? Number(min.slice(0, 4)) : -Infinity;
  const maxY = max ? Number(max.slice(0, 4)) : Infinity;
  const minM = min ? Number(min.slice(5, 7)) - 1 : 0;
  const maxM = max ? Number(max.slice(5, 7)) - 1 : 11;

  // ─── Day view: render the existing month grid ─────────────────────
  const renderDayGrid = () => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7;
    const daysInMonth = lastDay.getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const dayIso = (day) =>
      `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const isSelected = (day) => {
      if (!day) return false;
      if (selectedSet) return selectedSet.has(dayIso(day));
      if (!selected) return false;
      return selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day;
    };
    const isInRange = (day) => {
      if (!day || !rangeStart || !rangeEnd) return false;
      const d = new Date(year, month, day);
      const rs = new Date(rangeStart);
      const re = new Date(rangeEnd);
      return d > rs && d < re;
    };
    const isRangeEdge = (day) => {
      if (!day) return false;
      const iso = dayIso(day);
      return iso === rangeStart || iso === rangeEnd;
    };
    const isDisabled = (day) => {
      if (!day) return true;
      const iso = dayIso(day);
      if (min && iso < min) return true;
      if (max && iso > max) return true;
      return false;
    };

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {DAYS.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-disabled)', fontWeight: 600, padding: 2 }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const sel = isSelected(day) || isRangeEdge(day);
          const inRange = isInRange(day);
          const disabled = isDisabled(day);
          return (
            <div key={i}
              onClick={day && !disabled ? (e) => { e.stopPropagation(); e.preventDefault(); onChange?.(dayIso(day)); } : undefined}
              style={{
                textAlign: 'center', padding: '3px 0', borderRadius: sel ? 4 : 0,
                cursor: day && !disabled ? 'pointer' : 'default',
                backgroundColor: sel ? '#7c3aed' : inRange ? '#ede9fe' : 'transparent',
                color: sel ? '#fff' : disabled ? '#d1d5db' : inRange ? '#6d28d9' : '#334155',
                fontWeight: sel ? 600 : 400, fontSize: 11,
              }}
            >
              {day || ''}
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Month view: 4×3 grid of months for the current year ──────────
  const renderMonthGrid = () => {
    const isMonthDisabled = (m) => {
      // Disable when EVERY day of (year, m) falls outside [min, max].
      if (year < minY || year > maxY) return true;
      if (year === minY && m < minM) return true;
      if (year === maxY && m > maxM) return true;
      return false;
    };
    const isMonthSelected = (m) => {
      if (selectedSet) {
        const prefix = `${year}-${String(m + 1).padStart(2, '0')}-`;
        for (const iso of selectedSet) if (iso.startsWith(prefix)) return true;
        return false;
      }
      if (!selected) return false;
      return selected.getFullYear() === year && selected.getMonth() === m;
    };
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '4px 0' }}>
        {MONTHS_SHORT.map((label, m) => {
          const disabled = isMonthDisabled(m);
          const sel = isMonthSelected(m);
          return (
            <div key={m}
              onClick={disabled ? undefined : (e) => {
                e.stopPropagation(); e.preventDefault();
                setViewDate(new Date(year, m, 1));
                setView('day');
              }}
              style={{
                textAlign: 'center', padding: '8px 0', borderRadius: 4,
                cursor: disabled ? 'default' : 'pointer',
                backgroundColor: sel ? '#7c3aed' : 'transparent',
                color: sel ? '#fff' : disabled ? '#d1d5db' : '#334155',
                fontWeight: sel ? 600 : 400, fontSize: 11,
                transition: 'background-color 0.1s',
              }}
              onMouseEnter={(e) => { if (!disabled && !sel) e.currentTarget.style.backgroundColor = '#ede9fe'; }}
              onMouseLeave={(e) => { if (!disabled && !sel) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {label}
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Year view: 4×3 grid covering a decade (anchored on the current
  // viewYear). Padded out to show a couple of years from the previous /
  // next decade so navigation flows naturally, like bootstrap-datepicker.
  const decadeStart = year - (year % 10);
  const renderYearGrid = () => {
    const isYearDisabled = (y) => y < minY || y > maxY;
    const isYearSelected = (y) => {
      if (selectedSet) {
        const prefix = `${y}-`;
        for (const iso of selectedSet) if (iso.startsWith(prefix)) return true;
        return false;
      }
      if (!selected) return false;
      return selected.getFullYear() === y;
    };
    // Show 12 cells: one year from the previous decade, the full
    // decade, one from the next. Matches the convention.
    const years = [];
    for (let y = decadeStart - 1; y <= decadeStart + 10; y++) years.push(y);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '4px 0' }}>
        {years.map((y) => {
          const disabled = isYearDisabled(y);
          const sel = isYearSelected(y);
          const isOffDecade = y < decadeStart || y > decadeStart + 9;
          return (
            <div key={y}
              onClick={disabled ? undefined : (e) => {
                e.stopPropagation(); e.preventDefault();
                setViewDate(new Date(y, month, 1));
                setView('month');
              }}
              style={{
                textAlign: 'center', padding: '8px 0', borderRadius: 4,
                cursor: disabled ? 'default' : 'pointer',
                backgroundColor: sel ? '#7c3aed' : 'transparent',
                color: sel ? '#fff' : disabled || isOffDecade ? '#d1d5db' : '#334155',
                fontWeight: sel ? 600 : 400, fontSize: 11,
                transition: 'background-color 0.1s',
              }}
              onMouseEnter={(e) => { if (!disabled && !sel) e.currentTarget.style.backgroundColor = '#ede9fe'; }}
              onMouseLeave={(e) => { if (!disabled && !sel) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {y}
            </div>
          );
        })}
      </div>
    );
  };

  // ─── Header: label + nav arrows; label click zooms OUT one level ─
  // (day → month → year). Arrows step by month / year / decade
  // depending on the active view.
  const onPrev = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (view === 'day') setViewDate(new Date(year, month - 1, 1));
    else if (view === 'month') setViewDate(new Date(year - 1, month, 1));
    else setViewDate(new Date(year - 10, month, 1));
  };
  const onNext = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (view === 'day') setViewDate(new Date(year, month + 1, 1));
    else if (view === 'month') setViewDate(new Date(year + 1, month, 1));
    else setViewDate(new Date(year + 10, month, 1));
  };
  const headerLabel = view === 'day'
    ? `${MONTHS[month]} ${year}`
    : view === 'month'
      ? `${year}`
      : `${decadeStart} – ${decadeStart + 9}`;
  const onHeaderClick = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (view === 'day') setView('month');
    else if (view === 'month') setView('year');
    // 'year' is the top level — no further zoom-out.
  };

  return (
    <div style={{ fontSize: 11, userSelect: 'none' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '0 2px' }}>
        <button type="button" onClick={onPrev} style={navBtn}>◀</button>
        <button
          type="button"
          onClick={onHeaderClick}
          style={{
            background: 'transparent', border: 'none',
            fontWeight: 600, fontSize: 11, color: 'var(--text-secondary)',
            cursor: view === 'year' ? 'default' : 'pointer',
            padding: '2px 6px', borderRadius: 4,
          }}
          onMouseEnter={(e) => { if (view !== 'year') e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          {headerLabel}
        </button>
        <button type="button" onClick={onNext} style={navBtn}>▶</button>
      </div>
      {view === 'day' && renderDayGrid()}
      {view === 'month' && renderMonthGrid()}
      {view === 'year' && renderYearGrid()}
    </div>
  );
});

const navBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 10,
  color: 'var(--text-muted)', padding: '4px 8px', borderRadius: 4, lineHeight: 1,
};
