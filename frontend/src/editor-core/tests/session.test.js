import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarkdownDocument,
  collapsedSelection,
  createBlock,
  createEditorSession,
  createPosition,
  createSelection,
} from '../index.js';

function createDocument() {
  return MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'alpha' }),
    createBlock({ id: 'b', raw: 'beta' }),
  ]);
}

test('session: ordinary input transactions update model and changed blocks', () => {
  const session = createEditorSession(createDocument(), collapsedSelection('a', 5));
  const result = session.apply(
    session.createTransaction({ source: 'input' }).replace('a', 'alpha!'),
    { coalesceKey: 'input:a', now: 1000 },
  );

  assert.equal(result.document.toMarkdown(), 'alpha!beta');
  assert.deepEqual(result.changedBlockIds, ['a']);
  assert.equal(session.canUndo(), true);
});

test('session: coalesced input becomes one undo step', () => {
  const session = createEditorSession(createDocument(), collapsedSelection('a', 5));
  session.apply(
    session.createTransaction({ source: 'input' }).replace('a', 'alpha1'),
    { coalesceKey: 'input:a', now: 1000 },
  );
  session.apply(
    session.createTransaction({ source: 'input' }).replace('a', 'alpha12'),
    { coalesceKey: 'input:a', now: 1200 },
  );
  assert.equal(session.document.toMarkdown(), 'alpha12beta');
  session.undo();
  assert.equal(session.document.toMarkdown(), 'alphabeta');
  assert.equal(session.canUndo(), false);
});

test('session: undo and redo restore document and selection', () => {
  const initialSelection = collapsedSelection('a', 5);
  const session = createEditorSession(createDocument(), initialSelection);
  session.apply(
    session.createTransaction().replace('a', 'alpha!'),
    { coalesceKey: 'input:a', now: 1000 },
  );
  const undone = session.undo();
  assert.equal(undone.document.toMarkdown(), 'alphabeta');
  assert.deepEqual(undone.selection, initialSelection);

  const redone = session.redo();
  assert.equal(redone.document.toMarkdown(), 'alpha!beta');
  assert.equal(session.canRedo(), false);
});

test('session: structural split generates changed IDs for both blocks', () => {
  const session = createEditorSession(
    MarkdownDocument.fromMarkdown('abcdef', { blockId: 'root' }),
    collapsedSelection('root', 3),
  );
  const result = session.apply(
    session.createTransaction().split('root', 3, { rightId: 'right' }),
  );
  assert.deepEqual(new Set(result.changedBlockIds), new Set(['root', 'right']));
  assert.equal(result.document.toMarkdown(), 'abcdef');
  assert.deepEqual(result.selection, createSelection(
    createPosition('root', 3),
    createPosition('root', 3),
  ));
});

test('session: setSelection rewrites the latest history entry so redo restores the caret', () => {
  const session = createEditorSession(createDocument(), collapsedSelection('a', 0));
  session.apply(
    session.createTransaction().replace('a', 'alpha!'),
    { coalesceKey: 'input:a', now: 1000 },
  );
  // 输入路径自己知道光标落点（DOM 真值），比 mapSelectionThroughTransaction 的平移更准。
  const caret = collapsedSelection('a', 6);
  session.setSelection(caret);

  assert.deepEqual(session.undo().selection, collapsedSelection('a', 0));

  const redone = session.redo();
  assert.deepEqual(redone.selection, caret);
  assert.deepEqual(session.selection, caret);
});

test('session: setSelection without history keeps only the current selection', () => {
  const session = createEditorSession(createDocument(), collapsedSelection('a', 0));
  const caret = collapsedSelection('b', 4);
  assert.deepEqual(session.setSelection(caret), caret);
  assert.deepEqual(session.selection, caret);
  assert.equal(session.canUndo(), false);
});

test('session: coalesced input keeps the last declared caret', () => {
  const session = createEditorSession(createDocument(), collapsedSelection('a', 5));
  session.apply(
    session.createTransaction().replace('a', 'alpha1'),
    { coalesceKey: 'input:a', now: 1000 },
  );
  session.apply(
    session.createTransaction().replace('a', 'alpha12'),
    { coalesceKey: 'input:a', now: 1100 },
  );
  const caret = collapsedSelection('a', 7);
  session.setSelection(caret);

  session.undo();
  assert.equal(session.document.toMarkdown(), 'alphabeta');
  assert.deepEqual(session.redo().selection, caret);
});

test('session: persisted version tracks save coordination', () => {
  const session = createEditorSession(createDocument(), collapsedSelection('a', 5));
  assert.equal(session.isDirty(), false);
  session.apply(
    session.createTransaction().replace('a', 'alpha!'),
    { coalesceKey: 'input:a', now: 1000 },
  );
  assert.equal(session.isDirty(), true);
  assert.equal(session.persistedVersion, 0);
  session.markPersisted();
  assert.equal(session.isDirty(), false);
  assert.equal(session.persistedVersion, session.document.version);
  assert.equal(session.persistedTransactionId, session.lastTransactionId);
});
