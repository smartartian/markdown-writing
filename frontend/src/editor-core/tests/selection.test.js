import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarkdownDocument,
  applyTransaction,
  assertSelectionInvariant,
  collapsedSelection,
  comparePositions,
  createBlock,
  createPosition,
  createSelection,
  createTransaction,
  inlinePositionToTextOffset,
  isCollapsed,
  mapSelectionThroughTransaction,
  normalizeSelection,
  parseInline,
  selectionDirection,
  textOffsetToInlinePosition,
} from '../index.js';

test('selection: supports collapsed, forward and backward selections', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'alpha' }),
    createBlock({ id: 'b', raw: 'beta' }),
  ]);
  const collapsed = collapsedSelection('a', 2);
  assert.equal(isCollapsed(collapsed), true);
  assert.equal(selectionDirection(document, collapsed), 'none');

  const forward = createSelection(
    createPosition('a', 1),
    createPosition('b', 2),
  );
  const backward = createSelection(
    createPosition('b', 2),
    createPosition('a', 1),
  );
  assert.equal(selectionDirection(document, forward), 'forward');
  assert.equal(selectionDirection(document, backward), 'backward');
});

test('selection: compares positions across blocks and offsets', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'alpha' }),
    createBlock({ id: 'b', raw: 'beta' }),
  ]);
  assert.ok(comparePositions(document, createPosition('a', 4), createPosition('a', 2)) > 0);
  assert.ok(comparePositions(document, createPosition('a', 4), createPosition('b', 0)) < 0);
});

test('selection: normalizes and clamps offsets to block length', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'abc' }),
  ]);
  const normalized = normalizeSelection(document, createSelection(
    createPosition('a', 99),
    createPosition('a', 0),
  ));
  assert.equal(normalized.anchor.offset, 3);
  assert.equal(normalized.head.offset, 0);
  assert.throws(() => createPosition('a', -1), /non-negative integer/);
});

test('selection: transaction split maps head into the new right block', () => {
  const document = MarkdownDocument.fromMarkdown('abcdef', { blockId: 'root' });
  const selection = createSelection(
    createPosition('root', 2),
    createPosition('root', 5),
  );
  const applied = applyTransaction(
    document,
    createTransaction(document).split('root', 3, { rightId: 'right' }),
  );
  const mapped = mapSelectionThroughTransaction(selection, applied);

  assert.equal(mapped.anchor.blockId, 'root');
  assert.equal(mapped.anchor.offset, 2);
  assert.equal(mapped.head.blockId, 'right');
  assert.equal(mapped.head.offset, 2);
});

test('selection: transaction replace clamps selection to new block length', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'long text' }),
  ]);
  const applied = applyTransaction(
    document,
    createTransaction(document).replace('a', 'short'),
  );
  const mapped = mapSelectionThroughTransaction(
    collapsedSelection('a', 8),
    applied,
  );
  assert.equal(mapped.head.blockId, 'a');
  assert.equal(mapped.head.offset, 5);
});

test('selection: deletion maps selection to a neighboring block', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'A' }),
    createBlock({ id: 'b', raw: 'B' }),
    createBlock({ id: 'c', raw: 'C' }),
  ]);
  const applied = applyTransaction(
    document,
    createTransaction(document).remove('b'),
  );
  const mapped = mapSelectionThroughTransaction(
    collapsedSelection('b', 1),
    applied,
  );
  assert.equal(mapped.head.blockId, 'c');
  assert.equal(mapped.head.offset, 0);
});

test('selection: invariants reject missing block IDs and normalize valid selections', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'alpha' }),
  ]);
  assert.doesNotThrow(() => {
    assertSelectionInvariant(document, collapsedSelection('a', 3));
  });
  assert.throws(() => {
    assertSelectionInvariant(document, collapsedSelection('missing', 0));
  }, /block not found/);
});

test('selection: maps global text offsets to exact inline node paths', () => {
  const nodes = parseInline('ab**cd**ef');
  const position = textOffsetToInlinePosition(nodes, 3);
  assert.deepEqual(position, { path: [1, 0], offset: 1 });
  assert.equal(inlinePositionToTextOffset(nodes, position.path, position.offset), 3);
});

test('selection: inline paths support links and formatted children', () => {
  const nodes = parseInline('a [link](https://example.com) z');
  const position = textOffsetToInlinePosition(nodes, 3);
  assert.equal(position.path[0], 1);
  assert.equal(inlinePositionToTextOffset(nodes, position.path, position.offset), 3);
});
