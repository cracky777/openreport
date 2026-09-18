import { describe, test, expect } from 'vitest';
import {
  normalizeRuns, runsFromData, runsToText, applyRunStyle, styleInRange, runStyle,
  renderRuns, runsFromDom, cleanRunStyle, CLEAR_RUN_STYLE,
} from './textRuns';

// A minimal DOM: enough of Node/Element for renderRuns and runsFromDom, so
// the round trip is covered without a browser.
function makeDoc() {
  const text = (value) => ({ nodeType: 3, nodeValue: value });
  const element = (tagName) => {
    const el = {
      nodeType: 1, tagName, childNodes: [], style: {}, attrs: {},
      get firstChild() { return el.childNodes[0] || null; },
      appendChild(c) { el.childNodes.push(c); return c; },
      removeChild(c) { el.childNodes.splice(el.childNodes.indexOf(c), 1); },
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
      set textContent(v) { el.childNodes = v === '' ? [] : [text(v)]; },
    };
    el.ownerDocument = doc;
    return el;
  };
  const doc = { createElement: element, createTextNode: text };
  return { doc, element, text };
}

describe('normalizeRuns', () => {
  test('drops empty runs and unknown keys, merges equal neighbours', () => {
    expect(normalizeRuns([
      { text: 'a', bold: true, weird: 1 }, { text: '' }, { text: 'b', bold: true }, { text: 'c' },
    ])).toEqual([{ text: 'ab', bold: true }, { text: 'c' }]);
  });

  test('rejects unsafe or out-of-catalogue values', () => {
    expect(cleanRunStyle({ color: 'url(javascript:alert(1))', fontSize: 9999, fontFamily: 'Comic Sans', bold: 'yes' })).toEqual({});
    expect(cleanRunStyle({ color: '#ABC', fontSize: '14', fontFamily: 'Inter', italic: true })).toEqual({ color: '#ABC', fontSize: 14, fontFamily: 'Inter', italic: true });
  });
});

describe('runsFromData', () => {
  test('plain text becomes one run; empty text no run', () => {
    expect(runsFromData({ text: 'hello' })).toEqual([{ text: 'hello' }]);
    expect(runsFromData({ text: '' })).toEqual([]);
    expect(runsFromData(undefined)).toEqual([]);
  });

  test('runs that no longer spell the text are ignored', () => {
    const runs = [{ text: 'hel', bold: true }, { text: 'lo' }];
    expect(runsFromData({ text: 'hello', runs })).toEqual(runs);
    expect(runsFromData({ text: 'changed', runs })).toEqual([{ text: 'changed' }]);
  });
});

describe('applyRunStyle', () => {
  const runs = [{ text: 'hello world' }];

  test('splits a run around the styled stretch', () => {
    expect(applyRunStyle(runs, 6, 11, { bold: true })).toEqual([{ text: 'hello ' }, { text: 'world', bold: true }]);
    expect(applyRunStyle(runs, 2, 4, { color: '#f00' })).toEqual([{ text: 'he' }, { text: 'll', color: '#f00' }, { text: 'o world' }]);
  });

  test('null removes a key and neighbours merge back', () => {
    const bolded = applyRunStyle(runs, 0, 11, { bold: true });
    expect(applyRunStyle(bolded, 0, 11, { bold: null })).toEqual(runs);
    expect(runsToText(applyRunStyle(bolded, 3, 5, CLEAR_RUN_STYLE))).toBe('hello world');
  });

  test('keeps other styles on the stretch', () => {
    const red = applyRunStyle(runs, 0, 5, { color: '#f00' });
    expect(applyRunStyle(red, 0, 2, { bold: true })).toEqual([
      { text: 'he', color: '#f00', bold: true }, { text: 'llo', color: '#f00' }, { text: ' world' },
    ]);
  });
});

describe('styleInRange', () => {
  const runs = [{ text: 'ab', bold: true, color: '#f00' }, { text: 'cd', bold: true }];

  test('reports what every run in the selection shares', () => {
    expect(styleInRange(runs, 0, 4)).toEqual({ bold: true });
    expect(styleInRange(runs, 0, 2)).toEqual({ bold: true, color: '#f00' });
  });

  test('a caret reads the run it would extend', () => {
    expect(styleInRange(runs, 2, 2)).toEqual({ bold: true, color: '#f00' });
    expect(styleInRange(runs, 3, 3)).toEqual({ bold: true });
    expect(styleInRange(runs, 0, 0)).toEqual({ bold: true, color: '#f00' });
    expect(styleInRange([], 0, 0)).toEqual({});
  });
});

describe('runStyle', () => {
  test('maps run keys to CSS with px sizes and a font stack', () => {
    expect(runStyle({ text: 'x', bold: true, underline: true, fontSize: 14, fontFamily: 'Inter', color: '#123' }))
      .toEqual({ fontWeight: 700, textDecoration: 'underline', fontSize: '14px', fontFamily: '"Inter", sans-serif', color: '#123' });
  });
});

describe('renderRuns / runsFromDom', () => {
  test('round-trips runs through spans', () => {
    const { doc, element } = makeDoc();
    const root = element('DIV');
    root.ownerDocument = doc;
    const runs = [{ text: 'a\nb', bold: true }, { text: 'c', color: '#0f0' }];
    renderRuns(root, runs);
    expect(root.childNodes.map((s) => s.getAttribute('data-run'))).toEqual(['{"bold":true}', '{"color":"#0f0"}']);
    expect(runsFromDom(root)).toEqual(runs);
  });

  test('text the browser inserted is plain; <br> and blocks are newlines', () => {
    const { element, text } = makeDoc();
    const root = element('DIV');
    const span = element('SPAN');
    span.setAttribute('data-run', '{"italic":true}');
    span.appendChild(text('it'));
    root.appendChild(span);
    root.appendChild(text('plain'));
    root.appendChild(element('BR'));
    const block = element('DIV');
    block.appendChild(text('next'));
    root.appendChild(block);
    expect(runsFromDom(root)).toEqual([{ text: 'it', italic: true }, { text: 'plain\n\nnext' }]);
  });

  test('a tampered attribute cannot smuggle styles', () => {
    const { element, text } = makeDoc();
    const root = element('DIV');
    const span = element('SPAN');
    span.setAttribute('data-run', '{"color":"expression(1)","fontSize":12,"x":1}');
    span.appendChild(text('t'));
    root.appendChild(span);
    expect(runsFromDom(root)).toEqual([{ text: 't', fontSize: 12 }]);
  });
});
