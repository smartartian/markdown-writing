import { INLINE_TYPES } from '../model/types.js';

function escapeText(text) {
  return String(text ?? '');
}

export function serializeInline(nodes = []) {
  return nodes.map(node => {
    switch (node.type) {
      case INLINE_TYPES.TEXT:
        return escapeText(node.text);
      case INLINE_TYPES.STRONG:
        return `**${serializeInline(node.children)}**`;
      case INLINE_TYPES.EMPHASIS:
        return `*${serializeInline(node.children)}*`;
      case INLINE_TYPES.CODE:
        return `\`${node.text}\``;
      case INLINE_TYPES.LINK:
        return `[${serializeInline(node.children)}](${node.url}${node.title ? ` "${node.title}"` : ''})`;
      case INLINE_TYPES.IMAGE:
        return `![${node.alt || ''}](${node.url}${node.title ? ` "${node.title}"` : ''})`;
      case INLINE_TYPES.STRIKE:
        return `~~${serializeInline(node.children)}~~`;
      case INLINE_TYPES.MARK:
        return `==${serializeInline(node.children)}==`;
      case 'math':
        return `$${node.text}$`;
      case 'footnote':
        return `[^${node.label}]`;
      default:
        return node.raw || node.text || '';
    }
  }).join('');
}

export function serializeBlock(block) {
  return block.raw;
}

export function serializeDocument(document) {
  return document.blocks.map(serializeBlock).join('');
}
