// Flaws of a layout the app measures and names to the assistant (asked by
// Jonathan: the review said a filter "no longer had a card" while it stood,
// stretched, at a figure's height — it judged from a small picture).
const { layoutIssues } = require('../utils/ai/layoutIssues');

const box = (id, type, x, y, w, h, extra = {}) => ({ id, type, title: id.toUpperCase(), layout: { x, y, w, h }, ...extra });

test('a dropdown stretched to the figures\' height is named, with its height', () => {
  const issues = layoutIssues({ pageWidth: 1140, widgets: [
    box('w1', 'scorecard', 20, 20, 260, 180), box('w2', 'filter', 300, 20, 260, 180, { shape: { slicerStyle: 'dropdown' } }),
  ] });
  expect(issues.join(' ')).toMatch(/w2 \(filter "W2"\) is a dropdown 180 px tall/);
});

test('cards side by side with different heights or tops out of line; a row short of the right edge', () => {
  const issues = layoutIssues({ pageWidth: 1140, widgets: [
    box('w1', 'scorecard', 20, 20, 540, 180), box('w2', 'scorecard', 580, 20, 540, 140),
    box('w3', 'bar', 20, 220, 540, 300), box('w4', 'bar', 580, 240, 540, 300),
    box('w5', 'line', 20, 560, 800, 300),
  ] });
  expect(issues).toEqual([
    expect.stringMatching(/w1 .*w2 .*different heights \(180 \/ 140 px\)/),
    expect.stringMatching(/w3 .*w4 .*tops out of line \(220 \/ 240 px\)/),
    expect.stringMatching(/row of w5 .*ends 300 px before the right edge/),
  ]);
});

test('a tidy page, the dressing, a list filter and unplaced widgets say nothing', () => {
  expect(layoutIssues({ pageWidth: 1140, widgets: [
    box('w1', 'scorecard', 20, 20, 540, 180), box('w2', 'scorecard', 580, 20, 540, 180),
    box('w3', 'filter', 20, 220, 1100, 300, { shape: { slicerStyle: 'list' } }),
    box('w4', 'text', 20, 540, 200, 60), { id: 'w5', type: 'bar' },
  ] })).toEqual([]);
});

test('a slim dropdown beside taller figures, on their top line, is the design — not uneven heights', () => {
  // Flagged both ways, the review chased its own fix card after card.
  expect(layoutIssues({ pageWidth: 1140, widgets: [
    box('w1', 'scorecard', 20, 20, 260, 140), box('w2', 'scorecard', 300, 20, 260, 140),
    box('w3', 'filter', 580, 20, 540, 100, { shape: { slicerStyle: 'dropdown' } }),
  ] })).toEqual([]);
});

test('a band of filters or figures keeps its width: it is no short row', () => {
  // Told it "stopped short", the review stretched one dropdown, then one scorecard, across the page.
  expect(layoutIssues({ pageWidth: 1140, widgets: [
    box('w1', 'filter', 20, 20, 200, 80, { shape: { slicerStyle: 'dropdown' } }),
    box('w3', 'scorecard', 20, 600, 260, 140),
    box('w2', 'line', 20, 120, 1100, 300),
  ] })).toEqual([]);
});
