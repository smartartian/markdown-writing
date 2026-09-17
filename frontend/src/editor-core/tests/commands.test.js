import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MarkdownDocument,
  collapsedSelection,
  createBlock,
  createBuiltinCommands,
  createEditorSession,
  createPosition,
  createSelection,
} from '../index.js';

function createSession(raw = 'hello world', selection = null) {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw }),
  ]);
  return createEditorSession(document, selection || collapsedSelection('a', raw.length));
}

test('commands: wrap selected text in strong Markdown', () => {
  const session = createSession('hello', createSelection(
    createPosition('a', 0),
    createPosition('a', 5),
  ));
  const commands = createBuiltinCommands();
  commands.execute('toggleStrong', { session });
  assert.equal(session.document.toMarkdown(), '**hello**');
});

test('commands: toggle heading on current line', () => {
  const session = createSession('title');
  const commands = createBuiltinCommands();
  commands.execute('toggleHeading', { session });
  assert.equal(session.document.toMarkdown(), '## title');
});

test('commands: insert table after current block', () => {
  const session = createSession('text');
  const commands = createBuiltinCommands();
  commands.execute('insertTable', { session });
  assert.match(session.document.toMarkdown(), /\n\n\| 列 1 \| 列 2 \|/);
});

test('commands: duplicate, move and delete blocks', () => {
  const document = MarkdownDocument.fromBlocks([
    createBlock({ id: 'a', raw: 'A' }),
    createBlock({ id: 'b', raw: 'B' }),
  ]);
  const session = createEditorSession(document, collapsedSelection('a', 1));
  const commands = createBuiltinCommands();
  commands.execute('duplicateBlock', { session });
  assert.match(session.document.toMarkdown(), /A[\s\S]*A/);
  session.selection = collapsedSelection(session.document.blocks[1].id, 1);
  commands.execute('moveBlockUp', { session });
  assert.equal(session.document.blocks[0].raw, session.document.blocks[1].raw);
});
