export const BLOCK_TYPES = Object.freeze({
  RAW: 'raw',
  PARAGRAPH: 'paragraph',
  HEADING: 'heading',
  QUOTE: 'quote',
  LIST: 'list',
  TABLE: 'table',
  CODE: 'code',
  DIVIDER: 'divider',
});

export const INLINE_TYPES = Object.freeze({
  TEXT: 'text',
  STRONG: 'strong',
  EMPHASIS: 'emphasis',
  CODE: 'code',
  LINK: 'link',
  IMAGE: 'image',
  STRIKE: 'strike',
  MARK: 'mark',
  RAW: 'raw',
});

export function createBlock({
  id,
  type = BLOCK_TYPES.RAW,
  raw = '',
  attrs = {},
  children = [],
  revision = 1,
} = {}) {
  if (!id) {
    throw new Error('createBlock requires a stable id');
  }
  return Object.freeze({
    id,
    type,
    raw,
    attrs: Object.freeze({ ...attrs }),
    children: Object.freeze([...children]),
    revision,
  });
}

export function createTextNode(text) {
  return createInlineNode(INLINE_TYPES.TEXT, { text });
}

export function createInlineNode(type, props = {}) {
  return Object.freeze({
    type,
    ...props,
    children: props.children ? Object.freeze([...props.children]) : undefined,
  });
}

// GFM 表格的分隔行（`| --- | :---: |`）。解析层（parser/block-parser.js）判定表格用的是
// 「表头行 + 分隔行」两行，这里必须用同一条规则，否则两层的块类型会不一致：
//   - 只看第一行 `|...|`：多行表格会被漏判成段落（粘贴表格后模型类型不变，可视区就不会重渲染）；
//   - 加上 `$` 又只认单行：`| a | b |` 这种普通文本会被误判成表格。
const TABLE_SEPARATOR_LINE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/;

export function isTableSeparatorLine(text) {
  return TABLE_SEPARATOR_LINE.test(String(text ?? ''));
}

export function isTableStartLine(text) {
  return String(text ?? '').includes('|');
}

export function inferBlockType(raw) {
  const text = (raw || '').trimStart();
  if (/^#{1,6}\s/.test(text)) return BLOCK_TYPES.HEADING;
  if (/^>\s?/.test(text)) return BLOCK_TYPES.QUOTE;
  if (/^```/.test(text)) return BLOCK_TYPES.CODE;
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return BLOCK_TYPES.DIVIDER;
  if (/^([-*+]|\d+\.)\s/.test(text)) return BLOCK_TYPES.LIST;
  const lines = text.split('\n');
  if (isTableStartLine(lines[0]) && lines.length > 1 && isTableSeparatorLine(lines[1])) {
    return BLOCK_TYPES.TABLE;
  }
  return BLOCK_TYPES.PARAGRAPH;
}
