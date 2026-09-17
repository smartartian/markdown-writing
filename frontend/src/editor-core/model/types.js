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

export function inferBlockType(raw) {
  const text = (raw || '').trimStart();
  if (/^#{1,6}\s/.test(text)) return BLOCK_TYPES.HEADING;
  if (/^>\s?/.test(text)) return BLOCK_TYPES.QUOTE;
  if (/^```/.test(text)) return BLOCK_TYPES.CODE;
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return BLOCK_TYPES.DIVIDER;
  if (/^([-*+]|\d+\.)\s/.test(text)) return BLOCK_TYPES.LIST;
  if (/^\|.+\|\s*$/.test(text)) return BLOCK_TYPES.TABLE;
  return BLOCK_TYPES.PARAGRAPH;
}
