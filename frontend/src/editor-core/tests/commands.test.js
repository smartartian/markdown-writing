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

test('commands: set heading levels and restore paragraph', () => {
  const session = createSession('title');
  const commands = createBuiltinCommands();
  commands.execute('setHeading', { session, level: 3 });
  assert.equal(session.document.toMarkdown(), '### title');
  session.selection = collapsedSelection(session.document.blocks[0].id, 8);
  commands.execute('setHeading', { session, level: 0 });
  assert.equal(session.document.toMarkdown(), 'title');
});

test('commands: apply highlight and link formatting', () => {
  const session = createSession('hello', createSelection(
    createPosition('a', 0),
    createPosition('a', 5),
  ));
  const commands = createBuiltinCommands();
  commands.execute('toggleHighlight', { session });
  assert.equal(session.document.toMarkdown(), '==hello==');

  session.selection = createSelection(createPosition('a', 2), createPosition('a', 7));
  commands.execute('insertLink', { session });
  assert.equal(session.document.toMarkdown(), '==[hello](url)==');
});

test('commands: toggle unordered list prefix', () => {
  const session = createSession('item');
  const commands = createBuiltinCommands();
  commands.execute('toggleUnorderedList', { session });
  assert.equal(session.document.toMarkdown(), '- item');
  session.selection = collapsedSelection(session.document.blocks[0].id, 6);
  commands.execute('toggleUnorderedList', { session });
  assert.equal(session.document.toMarkdown(), 'item');
});

test('commands: indent and outdent lists using configured size', () => {
  const session = createSession('- item');
  const commands = createBuiltinCommands();
  commands.execute('indentList', { session, size: 2 });
  assert.equal(session.document.toMarkdown(), '  - item');
  session.selection = collapsedSelection(session.document.blocks[0].id, 8);
  commands.execute('outdentList', { session, size: 2 });
  assert.equal(session.document.toMarkdown(), '- item');
});

test('commands: toggle quote and ordered list structures', () => {
  const session = createSession('quote');
  const commands = createBuiltinCommands();
  commands.execute('toggleQuote', { session });
  assert.equal(session.document.toMarkdown(), '> quote');
  session.selection = collapsedSelection(session.document.blocks[0].id, 7);
  commands.execute('toggleOrderedList', { session });
  assert.equal(session.document.toMarkdown(), '1. > quote');
});

test('commands: toggle task list and code block structures', () => {
  const session = createSession('todo');
  const commands = createBuiltinCommands();
  commands.execute('toggleTaskList', { session });
  assert.equal(session.document.toMarkdown(), '- [ ] todo');
  session.selection = collapsedSelection(session.document.blocks[0].id, 11);
  commands.execute('toggleCodeBlock', { session });
  assert.equal(session.document.toMarkdown(), '```\n- [ ] todo\n```');
});

test('commands: insert MDX component', () => {
  const session = createSession('text');
  const commands = createBuiltinCommands();
  commands.execute('insertMdx', { session });
  assert.match(session.document.toMarkdown(), /<Component \/>/);
});
