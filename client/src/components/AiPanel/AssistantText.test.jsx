import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantText from './AssistantText';

describe('the assistant words', () => {
  it('read **bold** and `code`, and nothing else as markup', () => {
    const html = renderToStaticMarkup(<AssistantText text={'1. Click **Export** then `PDF`.\n<img src=x onerror=alert(1)> **'} />);
    expect(html).toContain('<strong>Export</strong>');
    expect(html).toContain('>PDF</code>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; **');
    expect(html).not.toContain('<img');
  });
});
