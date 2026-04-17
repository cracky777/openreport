import { memo, useRef, useState, useEffect, useCallback } from 'react';

/**
 * HTML legend rendered outside of ECharts canvas.
 * Uses arrow buttons for navigation instead of scrollbars.
 */
export default memo(function ChartLegend({ items, position, onToggle, hiddenSeries }) {
  if (!items || items.length === 0) return null;

  const isVertical = position === 'left' || position === 'right';
  const listRef = useRef(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (isVertical) {
      setCanScrollBack(el.scrollTop > 0);
      setCanScrollForward(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    } else {
      setCanScrollBack(el.scrollLeft > 0);
      setCanScrollForward(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }
  }, [isVertical]);

  useEffect(() => {
    checkOverflow();
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkOverflow);
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkOverflow); ro.disconnect(); };
  }, [checkOverflow, items]);

  const scroll = (direction) => {
    const el = listRef.current;
    if (!el) return;
    const amount = isVertical ? 60 : 120;
    if (isVertical) {
      el.scrollBy({ top: direction * amount, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: direction * amount, behavior: 'smooth' });
    }
  };

  const showArrows = canScrollBack || canScrollForward;

  return (
    <div style={{
      display: 'flex',
      flexDirection: isVertical ? 'column' : 'row',
      flexShrink: 0,
      alignItems: 'center',
      ...(isVertical ? { width: 120, minWidth: 120, maxWidth: 120 } : { maxHeight: 50 }),
    }}>
      {/* Back arrow */}
      {showArrows && (
        <button
          onClick={() => scroll(-1)}
          disabled={!canScrollBack}
          style={{
            ...arrowBtn,
            opacity: canScrollBack ? 1 : 0.2,
            transform: isVertical ? 'rotate(0deg)' : 'rotate(0deg)',
          }}
        >
          {isVertical ? '▲' : '◀'}
        </button>
      )}

      {/* Items list — hidden overflow, no scrollbar */}
      <div
        ref={listRef}
        style={{
          display: 'flex',
          flexDirection: isVertical ? 'column' : 'row',
          flexWrap: 'nowrap',
          gap: isVertical ? 2 : 8,
          padding: isVertical ? '2px 6px' : '2px 4px',
          overflow: 'hidden',
          flex: 1,
          minWidth: 0, minHeight: 0,
          alignItems: isVertical ? 'flex-start' : 'center',
          justifyContent: isVertical ? 'flex-start' : 'flex-start',
        }}
      >
        {items.map((item) => {
          const hidden = hiddenSeries?.has(item.name);
          return (
            <div
              key={item.name}
              onClick={() => onToggle?.(item.name)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                cursor: 'pointer', userSelect: 'none',
                opacity: hidden ? 0.35 : 1,
                flexShrink: 0,
              }}
            >
              <span style={{
                width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                background: hidden ? '#ccc' : item.color,
              }} />
              <span title={item.name} style={{
                fontSize: 11, color: '#475569', lineHeight: 1.2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: isVertical ? 86 : 120,
              }}>{item.name}</span>
            </div>
          );
        })}
      </div>

      {/* Forward arrow */}
      {showArrows && (
        <button
          onClick={() => scroll(1)}
          disabled={!canScrollForward}
          style={{
            ...arrowBtn,
            opacity: canScrollForward ? 1 : 0.2,
          }}
        >
          {isVertical ? '▼' : '▶'}
        </button>
      )}
    </div>
  );
});

const arrowBtn = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 10, color: '#94a3b8', padding: '2px 4px',
  lineHeight: 1, flexShrink: 0,
};
