import { describe, expect, test } from 'vitest';
import { guideBlocks } from './guideBlocks';

describe('the user guide read into blocks', () => {
  test('bullets, nested bullets, numbered steps and lines', () => {
    const body = [
      '- Who: admins.',
      '- Or let the assistant start it:',
      '  - With a model: press Enter.',
      '  - With nothing yet: import a file.',
      '1. Type a Title.',
      '2. Pick the data.',
      'Help topics end here.',
    ].join('\n');
    expect(guideBlocks(body)).toEqual([
      { kind: 'ul', items: [
        { text: 'Who: admins.', children: [] },
        { text: 'Or let the assistant start it:', children: ['With a model: press Enter.', 'With nothing yet: import a file.'] },
      ] },
      { kind: 'ol', items: ['Type a Title.', 'Pick the data.'] },
      { kind: 'p', text: 'Help topics end here.' },
    ]);
  });
});
