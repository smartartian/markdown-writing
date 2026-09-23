import { createInlineNode, createTextNode, INLINE_TYPES } from '../model/types.js';

const ESCAPE_CHARACTERS = '\\`*_[\\]()~:+!-#.>^$';

const rules = [
  {
    type: INLINE_TYPES.CODE,
    pattern: /`([^`\n]+)`/,
    create: match => createInlineNode(INLINE_TYPES.CODE, { text: match[1] }),
  },
  {
    type: INLINE_TYPES.IMAGE,
    pattern: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/,
    create: match => createInlineNode(INLINE_TYPES.IMAGE, {
      alt: match[1],
      url: match[2],
      title: match[3] || '',
    }),
  },
  {
    type: INLINE_TYPES.LINK,
    pattern: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/,
    create: match => createInlineNode(INLINE_TYPES.LINK, {
      url: match[2],
      title: match[3] || '',
      children: parseInline(match[1]),
    }),
  },
  {
    type: INLINE_TYPES.STRONG,
    pattern: /\*\*([^*\n]+)\*\*/,
    create: match => createInlineNode(INLINE_TYPES.STRONG, {
      children: parseInline(match[1]),
    }),
  },
  {
    type: INLINE_TYPES.EMPHASIS,
    pattern: /\*([^*\n]+)\*/,
    create: match => createInlineNode(INLINE_TYPES.EMPHASIS, {
      children: parseInline(match[1]),
    }),
  },
  {
    // 高亮统一用 ==x==（与 markdown/renderer.js 的 highlight 扩展、ui/wysiwyg.js 的 turndown 规则一致）
    type: INLINE_TYPES.MARK,
    pattern: /==([^=\n]+)==/,
    create: match => createInlineNode(INLINE_TYPES.MARK, {
      children: parseInline(match[1]),
    }),
  },
  {
    type: INLINE_TYPES.STRIKE,
    pattern: /~~([^~\n]+)~~/,
    create: match => createInlineNode(INLINE_TYPES.STRIKE, {
      children: parseInline(match[1]),
    }),
  },
  {
    type: 'math',
    pattern: /\$([^$\n]+)\$/,
    create: match => createInlineNode('math', { text: match[1] }),
  },
  {
    type: 'footnote',
    pattern: /\[\^([^\]]+)\]/,
    create: match => createInlineNode('footnote', { label: match[1] }),
  },
];

function findEarliestRule(text) {
  let best = null;
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match || match.index == null) continue;
    if (!best || match.index < best.index) {
      best = { rule, match, index: match.index };
    }
  }
  return best;
}

export function parseInline(text) {
  const source = String(text ?? '');
  if (!source) return [];

  const escape = source.match(new RegExp(`^\\\\([${ESCAPE_CHARACTERS.replace(/[\\\]^]/g, '\\$&')}])`));
  if (escape) {
    return [
      createTextNode(escape[1]),
      ...parseInline(source.slice(escape[0].length)),
    ];
  }

  const found = findEarliestRule(source);
  if (!found) return [createTextNode(source)];

  const before = source.slice(0, found.index);
  const after = source.slice(found.index + found.match[0].length);
  return [
    ...(before ? parseInline(before) : []),
    found.rule.create(found.match),
    ...(after ? parseInline(after) : []),
  ];
}
