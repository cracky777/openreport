// A custom measure that builds its value as TEXT in SQL must read the same way
// in every visual — the author's format, unchanged.
//
// A string has no height on a bar and no order in a sort, so the visuals used
// to fall back to 0 and print that. But such an expression is aggregated: the
// number is inside it. The server now emits that first aggregate alongside,
// under a reserved alias, and the visuals position, sort and total with it
// while printing what the author wrote.
//
// It has to run in a browser and it cannot read the screen: ECharts paints to
// a canvas, so a label or a tooltip has no text in the DOM — the chart instance
// is asked what its formatters print.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
const TEXT = '164j 08:02:17';
const NUMBER = 14198537;
// Everything the raw count could look like once printed.
const RAW = [String(NUMBER), NUMBER.toLocaleString('en-US'), NUMBER.toLocaleString('fr-FR')];

test('every visual prints the author string, none prints the number behind it', async ({ page }) => {
  const { textReportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      rows: [
        { [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: TEXT, [`__orsort__${F.MEASURE_LABEL}`]: NUMBER },
        { [F.DIM_LABEL]: 'Belgique', [F.MEASURE_LABEL]: '82j 04:01:09', [`__orsort__${F.MEASURE_LABEL}`]: Math.round(NUMBER / 2) },
      ],
      rowCount: 2,
    }),
  }));
  await page.setViewportSize({ width: 1400, height: 2200 });
  await page.goto(`/view/${textReportId}`);
  await expect.poll(() => page.locator('body').innerText()).toContain(TEXT);

  const printed = await page.evaluate((num) => {
    const out = [];
    document.querySelectorAll('.widget-content').forEach((el) => {
      const t = el.innerText.replace(/\s+/g, ' ').trim();
      if (t) out.push({ where: 'DOM', text: t });
    });
    const base = { value: num, name: 'France', seriesName: 'Sales', dataIndex: 0, data: num, percent: 50, marker: '', axisValue: 'France' };
    const walk = (node, path, depth) => {
      if (!node || depth > 6 || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
      for (const [k, v] of Object.entries(node)) {
        // Axis ticks are excluded on purpose: a tick is a number ECharts picks
        // on a continuous scale, not one of the measure's values, and the
        // author's format only exists as SQL applied to a value.
        if (typeof v === 'function' && /formatter/i.test(k) && !/axisLabel/.test(path)) {
          let res;
          for (const a of [base, [base]]) { try { res = v(a); break; } catch { /* the other shape */ } }
          if (res != null) out.push({ where: `${path}.${k}`, text: String(res) });
        } else if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1);
      }
    };
    document.querySelectorAll('div[_echarts_instance_]').forEach((el, i) => {
      const inst = window.__orEcharts && window.__orEcharts(el);
      if (inst) walk(inst.getOption(), 'chart' + i, 0);
    });
    return out;
  }, NUMBER);

  expect(printed.length).toBeGreaterThan(12);

  const leaking = printed.filter((p) => RAW.some((r) => p.text.includes(r)));
  expect(leaking, `the number behind the text was printed by: ${leaking.map((l) => l.where).join(', ')}`).toEqual([]);

  expect(printed.filter((p) => p.text.includes(TEXT)).length).toBeGreaterThan(8);
});
