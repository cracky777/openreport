import { useState, memo } from 'react';

const DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default memo(function MiniCalendar({ value, onChange, min, max, rangeStart, rangeEnd }) {
  const selected = value ? new Date(value) : null;
  const [viewDate, setViewDate] = useState(() => {
    const d = selected || (min ? new Date(min) : new Date());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isSelected = (day) => {
    if (!selected || !day) return false;
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
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return iso === rangeStart || iso === rangeEnd;
  };

  const isDisabled = (day) => {
    if (!day) return true;
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };

  return (
    <div style={{ fontSize: 11, userSelect: 'none' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '0 2px' }}>
        <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setViewDate(new Date(year, month - 1, 1)); }} style={navBtn}>◀</button>
        <span style={{ fontWeight: 600, fontSize: 11, color: '#334155' }}>{MONTHS[month]} {year}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setViewDate(new Date(year, month + 1, 1)); }} style={navBtn}>▶</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {DAYS.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 9, color: '#94a3b8', fontWeight: 600, padding: 2 }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const sel = isSelected(day) || isRangeEdge(day);
          const inRange = isInRange(day);
          const disabled = isDisabled(day);
          return (
            <div key={i}
              onClick={day && !disabled ? (e) => { e.stopPropagation(); e.preventDefault(); onChange?.(
                `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              ); } : undefined}
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
    </div>
  );
});

const navBtn = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
  color: '#64748b', padding: '4px 8px', borderRadius: 4, lineHeight: 1,
};
