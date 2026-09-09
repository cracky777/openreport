// One duration measure has to read the same way in every visual.
//
// Formatting a duration in SQL returns a string, and a string has no position
// on an axis, no order in a sort and no total — it only ever worked on a
// scorecard and in a table cell. So the measure returns SECONDS and carries the
// author's display pattern (`format.duration`): the value stays a number, and
// each visual renders it in that shape.
//
// This sweeps EVERY visual that can show a measure and every place one of them
// prints a value. Two of those places were still printing raw seconds when this
// was written — a combo tooltip and a scatter tooltip, both calling formatNumber
// without the measure's format — and the gauge printed its bounds unformatted.
//
// It has to run in a browser, and it cannot read the screen: ECharts paints to
// a canvas, so a tick or a tooltip has no text in the DOM. The chart instance is
// asked what its formatters print instead.
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const F = require('../fixtures');

const ids = () => JSON.parse(fs.readFileSync(F.IDS_FILE, 'utf8'));
// 164 days, 8 hours, 2 minutes, 17 seconds — sent as a plain number.
const SECONDS = 164 * 86400 + 8 * 3600 + 2 * 60 + 17;
const EXPECTED = '164j 08:02:17';
// Every way the raw count could leak into a label.
const RAW = [String(SECONDS), SECONDS.toLocaleString('en-US'), SECONDS.toLocaleString('fr-FR')];

test('every visual prints the duration pattern, and none prints raw seconds', async ({ page }) => {
  const { durationReportId } = ids();
  await page.route('**/api/models/*/query', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      rows: [
        { [F.DIM_LABEL]: 'France', [F.MEASURE_LABEL]: SECONDS },
        { [F.DIM_LABEL]: 'Belgique', [F.MEASURE_LABEL]: Math.round(SECONDS / 2) },
      ],
      rowCount: 2,
    }),
  }));
  await page.setViewportSize({ width: 1400, height: 2200 });
  await page.goto(`/view/${durationReportId}`);
  await page.locator('.widget-content').first().waitFor();
  await expect.poll(() => page.locator('body').innerText()).toContain(EXPECTED);

  const printed = await page.evaluate((sec) => {
    const out = [];
    document.querySelectorAll('.widget-content').forEach((el) => {
      const t = el.innerText.replace(/\s+/g, ' ').trim();
      if (t) out.push({ where: 'DOM', text: t });
    });
    // Params shaped the way each formatter is actually called: an axis label
    // gets the value, a scatter point gets [x, y], everything else a params
    // object.
    const base = { value: sec, name: 'France', seriesName: 'Sales', dataIndex: 0, data: sec, percent: 50, marker: '', axisValue: 'France' };
    const walk = (node, path, depth) => {
      if (!node || depth > 6 || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'function' && /formatter/i.test(k)) {
          const scatter = /scatter/.test(path);
          const arg = /axisLabel/.test(path) ? sec
            : (scatter ? { ...base, value: [sec, sec], data: { _label: 'France', _size: sec } } : base);
          let res;
          for (const a of [arg, [arg]]) {
            try { res = v(a); break; } catch { /* the other calling shape */ }
          }
          if (res != null) out.push({ where: path + '.' + k, text: String(res) });
        } else if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1);
      }
    };
    document.querySelectorAll('div[_echarts_instance_]').forEach((el) => {
      const inst = window.__orEcharts && window.__orEcharts(el);
      if (!inst) return;
      const type = el.closest('[data-widget-type]')?.getAttribute('data-widget-type') || 'chart';
      walk(inst.getOption(), type, 0);
    });
    return out;
  }, SECONDS);

  // Enough places to prove the sweep actually reached the visuals.
  expect(printed.length).toBeGreaterThan(15);

  const leaking = printed.filter((p) => RAW.some((r) => p.text.includes(r)));
  expect(leaking, `raw seconds printed by: ${leaking.map((l) => l.where).join(', ')}`).toEqual([]);

  // And the pattern is genuinely there, not merely absent of raw numbers.
  expect(printed.filter((p) => p.text.includes(EXPECTED)).length).toBeGreaterThan(8);
});
