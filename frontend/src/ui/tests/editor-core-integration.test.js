import test from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import {
  createMarkdownSeparatorBlock,
  preserveBlockBoundaryNewlines,
  parseMarkdownBlocksWithCore,
  parseMarkdownBlocksWithFallback,
} from '../../modules/editor.js';
import { createEditorSession, parseMarkdown, serializeDocument } from '../../editor-core/index.js';

const fixtures = [
  '# Heading\n\nParagraph',
  '- parent\n    - child\n',
  '| A | B |\n| --- | --- |\n| 1 | 2 |',
  '```js\nconst value = 1;\n```',
  '<img src="x" onerror="test">',
];

test('render parser entry: new core is lossless for supported fixtures', () => {
  for (const fixture of fixtures) {
    const result = parseMarkdownBlocksWithCore(fixture);
    assert.equal(result.strategy, 'core');
    assert.equal(serializeDocument(result.document), fixture);
    assert.ok(result.blocks.length > 0);
  }
});

test('render parser entry: maps list and divider types to legacy renderer types', () => {
  assert.equal(parseMarkdownBlocksWithCore('- item').blocks[0].type, 'ulist');
  assert.equal(parseMarkdownBlocksWithCore('1. item').blocks[0].type, 'olist');
  assert.equal(parseMarkdownBlocksWithCore('---').blocks[0].type, 'hr');
});

test('render parser entry: falls back to legacy adapter on parser failure', () => {
  const result = parseMarkdownBlocksWithFallback(
    marked,
    '# Native\n\n- list',
    () => {
      throw new Error('forced parser failure');
    },
  );
  assert.equal(result.strategy, 'legacy');
  assert.ok(result.blocks.length > 0);
  assert.match(result.error.message, /forced parser failure/);
});

test('render parser entry: fallback preserves legacy behavior for empty input', () => {
  const result = parseMarkdownBlocksWithFallback(marked, '', () => {
    throw new Error('forced parser failure');
  });
  assert.equal(result.strategy, 'legacy');
  assert.equal(result.blocks[0].type, 'paragraph');
  assert.equal(result.blocks[0].raw, '');
});

test('render parser entry: empty core document exposes an editable paragraph block', () => {
  const result = parseMarkdownBlocksWithCore('');
  assert.equal(result.strategy, 'core');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, 'paragraph');
  assert.equal(result.document.blocks.length, 1);
  assert.equal(result.document.blocks[0].id, result.blocks[0].blockId);
});

test('render parser entry: reuses block IDs across repeated parses', () => {
  const first = parseMarkdownBlocksWithCore('# Heading\n\nParagraph');
  const second = parseMarkdownBlocksWithCore('# Heading\n\nParagraph', first.blocks);
  assert.deepEqual(
    second.blocks.map(block => block.blockId),
    first.blocks.map(block => block.blockId),
  );
});

test('render parser entry: keeps IDs when block text changes in place', () => {
  const first = parseMarkdownBlocksWithCore('# Heading\n\nParagraph');
  const second = parseMarkdownBlocksWithCore('# Heading\n\nParagraph changed', first.blocks);
  assert.equal(second.blocks[0].blockId, first.blocks[0].blockId);
  assert.equal(second.blocks[1].blockId, first.blocks[1].blockId);
});

test('render parser entry: edits preserve structural newlines around blocks', () => {
  const session = createEditorSession(parseMarkdown('# Heading\n\nParagraph\n'));
  const heading = session.document.blocks[0];
  const nextRaw = preserveBlockBoundaryNewlines(heading.raw, '# Changed heading');
  const transaction = session.createTransaction({ source: 'test' }).replace(heading.id, nextRaw);
  const result = session.apply(transaction);

  assert.equal(serializeDocument(result.document), '# Changed heading\n\nParagraph\n');
});

test('block split writes a Markdown separator between visible blocks', () => {
  const session = createEditorSession(parseMarkdown('# Heading'));
  const heading = session.document.blocks[0];
  const transaction = session.createTransaction()
    .split(heading.id, heading.raw.length);
  transaction.insert(1, createMarkdownSeparatorBlock());

  const split = session.apply(transaction);
  assert.equal(serializeDocument(split.document), '# Heading\n\n');

  const nextBlock = split.document.blocks.find(block => !block.attrs?.separator && block.id !== heading.id);
  const edited = session.apply(session.createTransaction().replace(nextBlock.id, 'Paragraph'));
  assert.equal(serializeDocument(edited.document), '# Heading\n\nParagraph');
});
