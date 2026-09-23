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
  parseMarkdown,
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

test('commands: inline format with no selection falls back to placeholder text', () => {
  const session = createSession('hello', collapsedSelection('a', 5));
  const commands = createBuiltinCommands();
  commands.execute('toggleStrong', { session });
  assert.equal(session.document.toMarkdown(), 'hello**文本**');
  // 光标停在占位文本之后、闭合标记之前：接着输入的内容仍落在标记里
  assert.equal(session.selection.anchor.offset, 9);
  assert.equal(session.selection.head.offset, 9);
});

test('commands: inline format keeps the caret inside the closing marker', () => {
  const session = createSession('hello', createSelection(
    createPosition('a', 0),
    createPosition('a', 5),
  ));
  const commands = createBuiltinCommands();
  commands.execute('toggleHighlight', { session });
  assert.equal(session.document.toMarkdown(), '==hello==');
  assert.equal(session.selection.anchor.offset, 7);
});

test('commands: applied format is restorable through undo/redo', () => {
  const session = createSession('hello', createSelection(
    createPosition('a', 0),
    createPosition('a', 5),
  ));
  const commands = createBuiltinCommands();
  commands.execute('toggleStrike', { session });
  assert.equal(session.document.toMarkdown(), '~~hello~~');
  assert.equal(session.undo().document.toMarkdown(), 'hello');
  const redone = session.redo();
  assert.equal(redone.document.toMarkdown(), '~~hello~~');
  assert.deepEqual(redone.selection, session.selection);
});

function sessionFromMarkdown(markdown, selectionIndex = 0) {
  const session = createEditorSession(parseMarkdown(markdown), null);
  const visible = session.document.blocks.filter(block => !block.attrs?.separator);
  const target = visible[selectionIndex];
  if (target) session.selection = collapsedSelection(target.id, 0);
  return session;
}

test('commands: move block up and down swaps visible blocks', () => {
  // 回归：块之间的空行是独立的 separator 块，以前按数组下标取邻居，Alt+Up 只会把块挪到
  // separator 另一侧 —— 可视顺序完全没变，用户看到的是「快捷键没反应」。
  const commands = createBuiltinCommands();

  const up = sessionFromMarkdown('one\n\n\ntwo', 1);
  commands.execute('moveBlockUp', { session: up });
  assert.equal(up.document.toMarkdown(), 'two\n\none\n');

  const down = sessionFromMarkdown('one\n\n\ntwo', 0);
  commands.execute('moveBlockDown', { session: down });
  assert.equal(down.document.toMarkdown(), 'two\n\none\n');

  const middle = sessionFromMarkdown('a\n\n\nb\n\n\nc', 1);
  commands.execute('moveBlockUp', { session: middle });
  assert.equal(middle.document.toMarkdown(), 'b\n\n\na\n\n\nc');
});

test('commands: move block keeps blank-line runs between the swapped blocks', () => {
  const commands = createBuiltinCommands();
  const session = sessionFromMarkdown('a\n\n\n\n\nb', 1);
  commands.execute('moveBlockUp', { session });
  assert.equal(session.document.toMarkdown(), 'b\n\n\n\na\n');
});

test('commands: move block does nothing at the document edges', () => {
  const commands = createBuiltinCommands();
  const session = sessionFromMarkdown('a\n\n\nb', 0);
  assert.equal(commands.execute('moveBlockUp', { session }), null);
  assert.equal(session.document.toMarkdown(), 'a\n\n\nb');

  const last = sessionFromMarkdown('a\n\n\nb', 1);
  assert.equal(commands.execute('moveBlockDown', { session: last }), null);
  assert.equal(last.document.toMarkdown(), 'a\n\n\nb');
});

test('commands: toggle task checkbox state on the caret line', () => {
  const commands = createBuiltinCommands();
  const session = createSession('- [ ] todo', collapsedSelection('a', 4));

  assert.ok(commands.execute('toggleTaskChecked', { session }));
  assert.equal(session.document.toMarkdown(), '- [x] todo');

  commands.execute('toggleTaskChecked', { session });
  assert.equal(session.document.toMarkdown(), '- [ ] todo');
});

test('commands: toggle task checkbox only touches the line under the caret', () => {
  const commands = createBuiltinCommands();
  const raw = '- [ ] one\n- [x] two';
  const session = createSession(raw, collapsedSelection('a', 6));

  commands.execute('toggleTaskChecked', { session });
  assert.equal(session.document.toMarkdown(), '- [x] one\n- [x] two');

  // 引用里的任务项同样支持
  const quoted = createSession('> - [ ] quoted', collapsedSelection('a', 6));
  commands.execute('toggleTaskChecked', { session: quoted });
  assert.equal(quoted.document.toMarkdown(), '> - [x] quoted');
});

test('commands: toggle task checkbox ignores lines without a checkbox', () => {
  const commands = createBuiltinCommands();
  const session = createSession('普通段落', collapsedSelection('a', 2));
  assert.equal(commands.execute('toggleTaskChecked', { session }), null);
  assert.equal(session.document.toMarkdown(), '普通段落');
});
