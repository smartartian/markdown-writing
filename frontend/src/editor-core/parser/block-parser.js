import { createBlockId } from '../model/id.js';
import { MarkdownDocument } from '../model/document.js';
import { BLOCK_TYPES, createBlock } from '../model/types.js';
import { parseInline } from './inline-parser.js';

function splitLines(source) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\n') continue;
    const end = index + 1;
    const raw = source.slice(start, end);
    lines.push({
      start,
      end,
      text: raw.replace(/\r?\n$/, ''),
      raw,
    });
    start = end;
  }
  if (start < source.length || source.length === 0) {
    const raw = source.slice(start);
    lines.push({
      start,
      end: source.length,
      text: raw,
      raw,
    });
  }
  return lines;
}

function isBlank(line) {
  return !line || !line.text.trim();
}

function isFence(line) {
  return /^ {0,3}(`{3,}|~{3,})/.test(line.text);
}

function isFenceClose(line, marker) {
  const char = marker[0];
  const length = marker.length;
  return new RegExp(`^ {0,3}${char}{${length},}\\s*$`).test(line.text);
}

function isHeading(line) {
  return /^ {0,3}#{1,6}\s+/.test(line.text);
}

function isQuote(line) {
  return /^ {0,3}>\s?/.test(line.text);
}

function isDivider(line) {
  return /^ {0,3}((-{3,})|(\*{3,})|(_{3,}))\s*$/.test(line.text);
}

function isList(line) {
  return /^ {0,3}([-*+]|\d+[.)])\s+/.test(line.text);
}

function isIndentedContinuation(line) {
  return /^( {2,}|\t)/.test(line.text);
}

function isTableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line.text);
}

function isHtmlStart(line) {
  return /^ {0,3}<[A-Za-z!/]/.test(line.text);
}

function isBlockStarter(line) {
  return isHeading(line) ||
    isQuote(line) ||
    isDivider(line) ||
    isList(line) ||
    isFence(line) ||
    isHtmlStart(line);
}

function consumeBlank(lines, index) {
  let cursor = index;
  while (cursor < lines.length && isBlank(lines[cursor])) cursor++;
  return cursor;
}

function consumeFence(lines, index) {
  const markerMatch = lines[index].text.match(/^ {0,3}(`{3,}|~{3,})/);
  const marker = markerMatch[1];
  let cursor = index + 1;
  while (cursor < lines.length && !isFenceClose(lines[cursor], marker)) cursor++;
  return cursor < lines.length ? cursor + 1 : lines.length;
}

function consumeQuote(lines, index) {
  let cursor = index;
  while (cursor < lines.length) {
    if (isQuote(lines[cursor])) {
      cursor++;
      continue;
    }
    if (isBlank(lines[cursor]) && isQuote(lines[cursor + 1])) {
      cursor++;
      continue;
    }
    break;
  }
  return cursor;
}

function consumeList(lines, index) {
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (isList(line) || isIndentedContinuation(line)) {
      cursor++;
      continue;
    }
    if (isBlank(line)) {
      const next = consumeBlank(lines, cursor);
      if (next < lines.length && (isList(lines[next]) || isIndentedContinuation(lines[next]))) {
        cursor = next;
        continue;
      }
    }
    break;
  }
  return cursor;
}

function consumeTable(lines, index) {
  let cursor = index;
  while (cursor < lines.length && !isBlank(lines[cursor]) && lines[cursor].text.includes('|')) {
    cursor++;
  }
  return cursor;
}

function consumeHtml(lines, index) {
  let cursor = index + 1;
  while (cursor < lines.length && !isBlank(lines[cursor])) cursor++;
  return cursor;
}

function consumeParagraph(lines, index) {
  let cursor = index;
  while (cursor < lines.length && !isBlank(lines[cursor]) && (cursor === index || !isBlockStarter(lines[cursor]))) {
    cursor++;
  }
  return cursor;
}

function blockTypeFor(lines, index) {
  const line = lines[index];
  if (isFence(line)) return BLOCK_TYPES.CODE;
  if (isHeading(line)) return BLOCK_TYPES.HEADING;
  if (isQuote(line)) return BLOCK_TYPES.QUOTE;
  if (isDivider(line)) return BLOCK_TYPES.DIVIDER;
  if (isList(line)) return BLOCK_TYPES.LIST;
  if (
    line.text.includes('|') &&
    index + 1 < lines.length &&
    isTableSeparator(lines[index + 1])
  ) {
    return BLOCK_TYPES.TABLE;
  }
  if (isHtmlStart(line)) return BLOCK_TYPES.RAW;
  return BLOCK_TYPES.PARAGRAPH;
}

function consumeBlock(lines, index) {
  switch (blockTypeFor(lines, index)) {
    case BLOCK_TYPES.CODE: return consumeFence(lines, index);
    case BLOCK_TYPES.HEADING:
    case BLOCK_TYPES.DIVIDER:
      return index + 1;
    case BLOCK_TYPES.QUOTE: return consumeQuote(lines, index);
    case BLOCK_TYPES.LIST: return consumeList(lines, index);
    case BLOCK_TYPES.TABLE: return consumeTable(lines, index);
    case BLOCK_TYPES.RAW: return consumeHtml(lines, index);
    default: return consumeParagraph(lines, index);
  }
}

function headingLevel(raw) {
  return raw.match(/^ {0,3}(#{1,6})\s+/)?.[1].length || 1;
}

function parseChildren(type, content) {
  if (type === BLOCK_TYPES.CODE || type === BLOCK_TYPES.RAW) return [];
  if (type === BLOCK_TYPES.HEADING) {
    return parseInline(content.replace(/^ {0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, ''));
  }
  if (type === BLOCK_TYPES.PARAGRAPH) return parseInline(content);
  return [];
}

export function parseMarkdown(source, options = {}) {
  const markdown = String(source ?? '');
  if (!markdown) return MarkdownDocument.empty(options);

  const lines = splitLines(markdown);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    if (isBlank(lines[index])) {
      const endIndex = consumeBlank(lines, index);
      const raw = markdown.slice(lines[index].start, lines[endIndex - 1].end);
      blocks.push(createBlock({
        id: createBlockId('blank'),
        type: BLOCK_TYPES.RAW,
        raw,
        attrs: { separator: true },
      }));
      index = endIndex;
      continue;
    }

    const startIndex = index;
    const endIndex = consumeBlock(lines, index);
    const raw = markdown.slice(lines[startIndex].start, lines[endIndex - 1].end);
    const type = blockTypeFor(lines, startIndex);
    const attrs = {};
    if (type === BLOCK_TYPES.HEADING) attrs.level = headingLevel(raw);
    if (type === BLOCK_TYPES.LIST) attrs.ordered = /^ {0,3}\d+[.)]\s+/.test(lines[startIndex].text);
    blocks.push(createBlock({
      id: createBlockId(type),
      type,
      raw,
      attrs,
      children: parseChildren(type, raw),
    }));
    index = endIndex;
  }

  return MarkdownDocument.fromBlocks(blocks, options);
}

export { splitLines };
