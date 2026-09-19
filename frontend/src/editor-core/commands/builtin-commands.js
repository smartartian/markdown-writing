import { createBlockId } from '../model/id.js';
import { createPosition, createSelection } from '../selection/model.js';
import { inlinePositionToTextOffset } from '../selection/inline-path.js';
import { createCommandRegistry } from './command-registry.js';

function globalOffset(position) {
  return position.path?.length
    ? inlinePositionToTextOffset(position.blockChildren || [], position.path, position.offset)
    : position.offset;
}

function selectionRange(session) {
  const selection = session.selection;
  if (!selection || selection.anchor.blockId !== selection.head.blockId) return null;
  const block = session.document.getBlock(selection.anchor.blockId);
  if (!block) return null;
  const anchor = globalOffset({ ...selection.anchor, blockChildren: block.children });
  const head = globalOffset({ ...selection.head, blockChildren: block.children });
  return {
    block,
    start: Math.min(anchor, head),
    end: Math.max(anchor, head),
  };
}

function applyReplace(session, blockId, raw, caret, meta = {}) {
  const transaction = session.createTransaction(meta).replace(blockId, raw);
  const result = session.apply(transaction, {
    coalesceKey: meta.coalesceKey || null,
  });
  session.selection = createSelection(
    createPosition(blockId, caret),
    createPosition(blockId, caret),
  );
  return result;
}

export function createBuiltinCommands() {
  const registry = createCommandRegistry();

  const wrapSelection = marker => ({ session }) => {
    const range = selectionRange(session);
    if (!range) return null;
    const selected = range.block.raw.slice(range.start, range.end);
    const replacement = marker + (selected || '文本') + marker;
    const raw = range.block.raw.slice(0, range.start) + replacement + range.block.raw.slice(range.end);
    return applyReplace(session, range.block.id, raw, range.start + replacement.length, {
      source: 'command',
      coalesceKey: null,
    });
  };

  registry.register('toggleStrong', wrapSelection('**'));
  registry.register('toggleEmphasis', wrapSelection('*'));
  registry.register('toggleInlineCode', wrapSelection('`'));
  registry.register('toggleStrike', wrapSelection('~~'));
  registry.register('toggleHighlight', wrapSelection('=='));

  registry.register('insertLink', ({ session }) => {
    const range = selectionRange(session);
    if (!range) return null;
    const selected = range.block.raw.slice(range.start, range.end);
    const label = selected || '链接文本';
    const replacement = `[${label}](url)`;
    const raw = range.block.raw.slice(0, range.start) + replacement + range.block.raw.slice(range.end);
    const urlOffset = range.start + 1 + label.length + 2;
    return applyReplace(session, range.block.id, raw, urlOffset, { source: 'command' });
  });

  registry.register('toggleHeading', ({ session }) => {
    const range = selectionRange(session);
    if (!range) return null;
    const lineStart = range.block.raw.lastIndexOf('\n', range.start - 1) + 1;
    const lineEnd = range.block.raw.indexOf('\n', lineStart);
    const end = lineEnd === -1 ? range.block.raw.length : lineEnd;
    const line = range.block.raw.slice(lineStart, end);
    const nextLine = /^#{1,6}\s/.test(line)
      ? line.replace(/^#{1,6}\s/, '## ')
      : '## ' + line;
    const raw = range.block.raw.slice(0, lineStart) + nextLine + range.block.raw.slice(end);
    return applyReplace(session, range.block.id, raw, lineStart + nextLine.length, {
      source: 'command',
    });
  });

  registry.register('setHeading', ({ session, level = 1 }) => {
    const range = selectionRange(session);
    if (!range) return null;
    const normalizedLevel = Math.max(0, Math.min(6, Number(level) || 0));
    const content = range.block.raw.replace(/^#{1,6}\s+/, '');
    const raw = normalizedLevel > 0
      ? `${'#'.repeat(normalizedLevel)} ${content}`
      : content;
    return applyReplace(session, range.block.id, raw, raw.length, { source: 'command' });
  });

  registry.register('toggleCodeBlock', ({ session }) => {
    const range = selectionRange(session);
    if (!range) return null;
    const raw = /^```[\s\S]*```\s*$/.test(range.block.raw.trim())
      ? range.block.raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '')
      : `\`\`\`\n${range.block.raw}\n\`\`\``;
    return applyReplace(session, range.block.id, raw, raw.length, { source: 'command' });
  });

  registry.register('toggleQuote', ({ session }) => toggleLinePrefix(session, /^>\s?/, '> '));
  registry.register('toggleUnorderedList', ({ session }) => toggleLinePrefix(session, /^(?:[-*+]|\d+[.)])\s+/, '- '));
  registry.register('toggleOrderedList', ({ session }) => toggleLinePrefix(session, /^(?:[-*+]|\d+[.)])\s+/, '1. '));
  registry.register('toggleTaskList', ({ session }) => toggleLinePrefix(session, /^[-*+]\s+\[[ xX]\]\s+/, '- [ ] '));

  registry.register('insertMdx', ({ session }) => {
    const selection = session.selection;
    const block = selection ? session.document.getBlock(selection.anchor.blockId) : null;
    if (!block) return null;
    const snippet = '<Component />';
    const raw = block.raw ? `${block.raw}\n\n${snippet}` : snippet;
    return applyReplace(session, block.id, raw, raw.length, { source: 'command' });
  });

  registry.register('insertTable', ({ session }) => {
    const selection = session.selection;
    const block = selection ? session.document.getBlock(selection.anchor.blockId) : null;
    const table = '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |';
    if (!block) return null;
    const raw = block.raw ? `${block.raw}\n\n${table}` : table;
    return applyReplace(session, block.id, raw, raw.length, { source: 'command' });
  });

  registry.register('duplicateBlock', ({ session }) => {
    const selection = session.selection;
    if (!selection) return null;
    const block = session.document.getBlock(selection.anchor.blockId);
    if (!block) return null;
    const index = session.document.getBlockIndex(block.id);
    const transaction = session.createTransaction({ source: 'command' }).insert(index + 1, {
      id: createBlockId('copy'),
      type: block.type,
      raw: block.raw,
      attrs: block.attrs,
      children: block.children,
    });
    return session.apply(transaction);
  });

  registry.register('deleteBlock', ({ session }) => {
    const selection = session.selection;
    if (!selection || session.document.blocks.length <= 1) return null;
    const transaction = session.createTransaction({ source: 'command' }).remove(selection.anchor.blockId);
    return session.apply(transaction);
  });

  registry.register('moveBlockUp', ({ session }) => moveBlock(session, -1));
  registry.register('moveBlockDown', ({ session }) => moveBlock(session, 1));

  registry.register('indentList', ({ session, size = 4 }) => indentBlock(session, true, size));
  registry.register('outdentList', ({ session, size = 4 }) => indentBlock(session, false, size));

  return registry;
}

function toggleLinePrefix(session, pattern, prefix) {
  const range = selectionRange(session);
  if (!range) return null;
  const raw = pattern.test(range.block.raw)
    ? range.block.raw.replace(pattern, '')
    : prefix + range.block.raw;
  return applyReplace(session, range.block.id, raw, raw.length, { source: 'command' });
}

function moveBlock(session, direction) {
  const selection = session.selection;
  if (!selection) return null;
  const block = session.document.getBlock(selection.anchor.blockId);
  if (!block) return null;
  const index = session.document.getBlockIndex(block.id);
  const target = session.document.blocks[index + direction];
  if (!target) return null;
  const transaction = session.createTransaction({ source: 'command' }).move(
    block.id,
    direction < 0 ? target.id : target.id === block.id ? null : session.document.blocks[index + direction + 1]?.id ?? null,
  );
  return session.apply(transaction);
}

function indentBlock(session, indent, size = 4) {
  const selection = session.selection;
  if (!selection) return null;
  const block = session.document.getBlock(selection.anchor.blockId);
  if (!block || !/^(\s*)([-*+]|\d+[.)])\s/.test(block.raw)) return null;
  const indentSize = Math.max(1, Number(size) || 4);
  const raw = indent
    ? block.raw.split('\n').map(line => line ? `${' '.repeat(indentSize)}${line}` : line).join('\n')
    : block.raw.split('\n').map(line => line.replace(new RegExp(`^ {1,${indentSize}}`), '')).join('\n');
  return applyReplace(session, block.id, raw, raw.length, { source: 'command' });
}
