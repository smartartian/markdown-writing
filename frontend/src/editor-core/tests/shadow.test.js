import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMarkdownCore } from '../index.js';

const fixtures = [
  '# Heading\n\nParagraph text.',
  '- parent\n    - child\n',
  '| A | B |\n| --- | --- |\n| 1 | 2 |',
  '```js\nconst value = 1;\n```',
  '> quote',
  '<img src="x" onerror="test">',
  'line one\r\nline two\r\n',
];

test('shadow mode: new core preserves every golden source', () => {
  for (const fixture of fixtures) {
    const report = compareMarkdownCore(fixture);
    assert.equal(report.coreOutput, fixture);
    assert.equal(
      report.differences.includes('new-core-roundtrip-mismatch'),
      false,
      JSON.stringify(report, null, 2),
    );
  }
});

test('shadow mode: reports structural differences without throwing', () => {
  const report = compareMarkdownCore('- parent\n    - child\n\nparagraph');
  assert.equal(typeof report.equivalent, 'boolean');
  assert.ok(Array.isArray(report.differences));
  assert.equal(report.coreOutput, '- parent\n    - child\n\nparagraph');
});
