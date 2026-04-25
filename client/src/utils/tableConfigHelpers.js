/**
 * Table config helpers — resolves per-column vs global settings.
 */

export function getColumnHeaderStyle(tc, colName) {
  const g = tc?.header || {};
  const c = tc?.columns?.[colName]?.header || {};
  return { ...g, ...c };
}

export function getColumnValueStyle(tc, colName) {
  const g = tc?.values || {};
  const c = tc?.columns?.[colName]?.values || {};
  return { ...g, ...c };
}

export function getColumnDisplayName(tc, colName) {
  return tc?.columns?.[colName]?.displayName || colName;
}

export function getColumnWidth(tc, colName) {
  return tc?.columns?.[colName]?.width || null;
}

export function getColumnTotalFn(tc, colName) {
  return tc?.columns?.[colName]?.totals?.fn || tc?.totals?.defaultFn || 'sum';
}

export function getGridConfig(tc) {
  const d = {
    horizontalLines: true, horizontalColor: 'var(--border-default)', horizontalWidth: 1,
    verticalLines: false, verticalColor: 'var(--border-default)', verticalWidth: 1,
    outerBorder: false, outerBorderColor: 'var(--border-default)', outerBorderWidth: 1,
    cellPadding: 8,
  };
  return { ...d, ...(tc?.grid || {}) };
}

export function getRowConfig(tc) {
  const d = {
    height: 'normal', striped: true,
    stripeColor1: 'var(--bg-panel)', stripeColor2: 'var(--bg-subtle)',
    hoverHighlight: true, hoverColor: 'var(--bg-active)',
  };
  return { ...d, ...(tc?.rows || {}) };
}

export function getTotalsConfig(tc) {
  const d = {
    enabled: false, defaultFn: 'sum', fontBold: true,
    bgColor: 'var(--bg-hover)', fontColor: 'var(--text-primary)',
    borderTopWidth: 2, borderTopColor: 'var(--border-strong)',
  };
  return { ...d, ...(tc?.totals || {}) };
}

export function getFreezeConfig(tc) {
  return { stickyHeader: true, freezeFirstColumn: false, ...(tc?.freeze || {}) };
}

export const ROW_HEIGHTS = { compact: 28, normal: 36, large: 48 };

/**
 * Deep-set a value in an object using a dot-separated path, immutably.
 */
export function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const result = { ...obj };
  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = { ...(current[keys[i]] || {}) };
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

/**
 * Compute totals for a column.
 */
export function computeTotal(rows, colIdx, fn) {
  const nums = rows.map((r) => parseFloat(r[colIdx])).filter((n) => !isNaN(n));
  if (nums.length === 0) return '';
  switch (fn) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'count': return nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return nums.reduce((a, b) => a + b, 0);
  }
}

/**
 * Conditional formatting: compute cell style.
 */
export function getConditionalStyle(rules, value, colValues) {
  if (!rules || rules.length === 0) return {};
  const num = parseFloat(value);
  const style = {};
  const extraElements = [];

  for (const rule of rules) {
    if (rule.type === 'colorScale' && !isNaN(num)) {
      const nums = colValues.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
      const min = rule.minValue != null ? rule.minValue : Math.min(...nums);
      const max = rule.maxValue != null ? rule.maxValue : Math.max(...nums);
      const pct = max > min ? Math.max(0, Math.min(1, (num - min) / (max - min))) : 0;
      style.backgroundColor = lerpColor(rule.minColor || '#dcfce7', rule.maxColor || '#dc2626', pct);
    }
    if (rule.type === 'dataBar' && !isNaN(num)) {
      const nums = colValues.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
      const max = Math.max(...nums, 1);
      const pct = Math.max(0, Math.min(100, (num / max) * 100));
      style.backgroundImage = `linear-gradient(to right, ${rule.dataBarColor || '#7c3aed'}20 ${pct}%, transparent ${pct}%)`;
    }
    if (rule.type === 'textColor' && !isNaN(num)) {
      const nums = colValues.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
      const min = rule.minValue != null ? rule.minValue : Math.min(...nums);
      const max = rule.maxValue != null ? rule.maxValue : Math.max(...nums);
      const pct = max > min ? Math.max(0, Math.min(1, (num - min) / (max - min))) : 0;
      style.color = lerpColor(rule.minColor || '#dc2626', rule.maxColor || '#16a34a', pct);
    }
    if (rule.type === 'icon' && !isNaN(num)) {
      const nums = colValues.map((v) => parseFloat(v)).filter((n) => !isNaN(n));
      const low = rule.lowValue != null ? rule.lowValue : Math.min(...nums);
      const high = rule.highValue != null ? rule.highValue : Math.max(...nums);
      const mid = rule.midValue != null ? rule.midValue : (low + high) / 2;
      const levels = [
        { icon: rule.lowIcon || '↓', color: rule.lowColor || '#dc2626' },
        { icon: rule.midIcon || '→', color: rule.midColor || '#f59e0b' },
        { icon: rule.highIcon || '↑', color: rule.highColor || '#16a34a' },
      ];
      const iconIdx = num <= low ? 0 : num <= mid ? 1 : 2;
      extraElements.push({ type: 'icon', icon: levels[iconIdx].icon, color: levels[iconIdx].color });
    }
  }
  return { style, extraElements };
}

function evalCondition(val, op, threshold) {
  switch (op) {
    case '>': return val > threshold;
    case '<': return val < threshold;
    case '>=': return val >= threshold;
    case '<=': return val <= threshold;
    case '=': return val === threshold;
    case '!=': return val !== threshold;
    default: return false;
  }
}

function lerpColor(c1, c2, t) {
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t), g = Math.round(g1 + (g2 - g1) * t), b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}
