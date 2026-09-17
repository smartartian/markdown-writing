import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPES,
  MarkdownDocument,
  createBlock,
} from '../index.js';

const goldenFixtures = [
  '',
  'plain text',
  '# Heading\n\nParagraph text.',
  '- parent\n    - child\n        - grandchild\n',
  '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
  '```js\nconst value = 1;\n```\n',
  '> quote\n>\n> second paragraph\n',
  '<img src="x" onerror="test">\n',
  '# 中文标题\n\n中文正文，保留原始换行与标点。\n',
  'line one\r\nline two\r\n',
];

test('golden: Markdown原文往返保持完全一致', () => {
  for (const fixture of goldenFixtures) {
    const document = MarkdownDocument.fromMarkdown(fixture);
    assert.equal(document.toMarkdown(), fixture, `fixture failed: ${JSON.stringify(fixture)}`);
  }
});

test('document: block IDs are stable and duplicate IDs are rejected', () => {
  const block = createBlock({
    id: 'block-a',
    type: BLOCK_TYPES.PARAGRAPH,
    raw: 'first',
  });
  const document = MarkdownDocument.fromBlocks([block]);
  assert.equal(document.getBlock('block-a').raw, 'first');
  assert.throws(() => {
    document.insertBlock(1, createBlock({
      id: 'block-a',
      type: BLOCK_TYPES.PARAGRAPH,
      raw: 'duplicate',
    }));
  }, /duplicate block id/);
});

test('document: split concatenates back to original Markdown', () => {
  const original = '# Title\n\nBody text\n';
  const document = MarkdownDocument.fromMarkdown(original, { blockId: 'root' });
  const split = document.splitBlock('root', 8, { rightId: 'right' });
  assert.equal(split.blocks.length, 2);
  assert.equal(split.toMarkdown(), original);
  assert.equal(split.blocks[0].raw + split.blocks[1].raw, original);
});

test('document: replace, insert, remove and move are copy-on-write', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'A' }),
    createBlock({ id: 'b', raw: 'B' }),
    createBlock({ id: 'c', raw: 'C' }),
  ]);
  const replaced = document.replaceBlock('a', { raw: 'A2' });
  const inserted = replaced.insertBlock(1, createBlock({ id: 'x', raw: 'X' }));
  const removed = inserted.removeBlock('b');
  const moved = removed.moveBlock('c', 'a');

  assert.equal(document.toMarkdown(), 'ABC');
  assert.equal(replaced.toMarkdown(), 'A2BC');
  assert.equal(inserted.toMarkdown(), 'A2XBC');
  assert.equal(removed.toMarkdown(), 'A2XC');
  assert.equal(moved.toMarkdown(), 'CA2X');
});

test('golden: generated source strings remain lossless', () => {
  let state = 123456789;
  for (let i = 0; i < 100; i++) {
    let source = '';
    const length = 5 + (state % 120);
    for (let j = 0; j < length; j++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const code = 32 + (state % 95);
      source += String.fromCharCode(code);
    }
    const document = MarkdownDocument.fromMarkdown(source);
    assert.equal(document.toMarkdown(), source);
  }
});
