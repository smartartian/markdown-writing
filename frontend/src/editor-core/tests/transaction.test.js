import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarkdownDocument,
  TransactionConflictError,
  applyTransaction,
  createBlock,
  createTransaction,
  revertTransaction,
} from '../index.js';

test('transaction: applies steps and keeps original immutable', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'A' }),
    createBlock({ id: 'b', raw: 'B' }),
  ]);
  const transaction = createTransaction(document)
    .replace('a', 'A2')
    .insert(1, createBlock({ id: 'x', raw: 'X' }))
    .remove('b')
    .setSelection({
      anchor: { blockId: 'x', path: [], offset: 1 },
      head: { blockId: 'x', path: [], offset: 1 },
    });

  const applied = applyTransaction(document, transaction);
  assert.equal(document.toMarkdown(), 'AB');
  assert.equal(applied.document.toMarkdown(), 'A2X');
  assert.equal(applied.document.version, document.version + 1);
  assert.deepEqual(applied.selectionAfter, transaction.selectionAfter);
});

test('transaction: split and revert preserve exact Markdown', () => {
  const source = '# Title\n\nBody';
  const document = MarkdownDocument.fromMarkdown(source, { blockId: 'root' });
  const transaction = createTransaction(document)
    .split('root', 8, { rightId: 'right' });
  const applied = applyTransaction(document, transaction);

  assert.equal(applied.document.toMarkdown(), source);
  assert.equal(applied.document.blocks.length, 2);

  const reverted = revertTransaction(applied.document, applied);
  assert.equal(reverted.document.blocks.length, 1);
  assert.equal(reverted.document.toMarkdown(), source);
  assert.equal(reverted.document.blocks[0].id, 'root');
});

test('transaction: detects stale base revision', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'A' }),
  ]);
  const first = applyTransaction(document, createTransaction(document).replace('a', 'B'));
  const stale = createTransaction(document).replace('a', 'C');

  assert.throws(
    () => applyTransaction(first.document, stale),
    error => error instanceof TransactionConflictError,
  );
});

test('transaction: move is reversible', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'A' }),
    createBlock({ id: 'b', raw: 'B' }),
    createBlock({ id: 'c', raw: 'C' }),
  ]);
  const applied = applyTransaction(
    document,
    createTransaction(document).move('c', 'a'),
  );
  assert.equal(applied.document.toMarkdown(), 'CAB');

  const reverted = revertTransaction(applied.document, applied);
  assert.equal(reverted.document.toMarkdown(), 'ABC');
});

test('transaction: empty transaction does not change revision', () => {
  const document = MarkdownDocument.fromMarkdown('text');
  const applied = applyTransaction(document, createTransaction(document));
  assert.equal(applied.document, document);
  assert.equal(applied.document.version, document.version);
});
