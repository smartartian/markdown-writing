import { parseMarkdownBlocksLegacy } from './legacy-parser.js';
import { MarkdownDocument } from '../editor-core/model/document.js';
import { parseMarkdown } from '../editor-core/parser/block-parser.js';
import { serializeDocument } from '../editor-core/serializer/markdown-serializer.js';
import { BLOCK_TYPES, createBlock } from '../editor-core/model/types.js';

function mapCoreBlock(block) {
  let type = block.type;
  if (type === 'list') type = block.attrs?.ordered ? 'olist' : 'ulist';
  if (type === 'divider') type = 'hr';
  return {
    type,
    raw: block.raw || '',
    level: block.attrs?.level,
    ordered: block.attrs?.ordered,
    blockId: block.id,
  };
}

function reconcileBlockIds(document, previousBlocks = []) {
  const previousById = new Map(previousBlocks.map(block => [block.blockId, block]));
  let visibleIndex = 0;
  const blocks = document.blocks.map((block, index) => {
    const isSeparator = block.attrs?.separator;
    const previous = isSeparator ? null : previousBlocks[visibleIndex++];
    const previousType = previous?.type;
    const currentType = block.type === 'list'
      ? (block.attrs?.ordered ? 'olist' : 'ulist')
      : block.type === 'divider'
        ? 'hr'
        : block.type;
    const reusable = previous && previousType === currentType
      ? previous.blockId
      : [...previousById.values()].find(candidate =>
          candidate.type === currentType &&
          candidate.raw === block.raw
        )?.blockId;
    return createBlock({
      ...block,
      id: reusable || block.id,
    });
  });
  return MarkdownDocument.fromBlocks(blocks, { version: document.version });
}

export function parseMarkdownBlocksWithCore(markdown, previousBlocks = []) {
  const source = String(markdown ?? '');
  const parsedDocument = parseMarkdown(source);
  let document = reconcileBlockIds(parsedDocument, previousBlocks);
  const serialized = serializeDocument(document);
  if (serialized !== source) {
    throw new Error('new editor core parser failed lossless round-trip');
  }
  let blocks = document.blocks
    .filter(block => !block.attrs?.separator)
    .map(mapCoreBlock);
  if (!source && blocks.length === 0) {
    const emptyBlock = {
      type: 'paragraph',
      raw: '',
      level: undefined,
      ordered: undefined,
      blockId: previousBlocks[0]?.blockId || 'empty',
    };
    blocks = [emptyBlock];
    document = MarkdownDocument.fromBlocks([
      createBlock({
        id: emptyBlock.blockId,
        type: BLOCK_TYPES.PARAGRAPH,
        raw: '',
      }),
    ], { version: document.version });
  }
  if (source && blocks.length === 0) {
    throw new Error('new editor core parser produced no blocks');
  }
  return { blocks, document, strategy: 'core' };
}

export function parseMarkdownBlocksWithFallback(marked, markdown, primaryParser = parseMarkdownBlocksWithCore) {
  const source = String(markdown ?? '');
  try {
    return primaryParser(source);
  } catch (error) {
    return {
      blocks: parseMarkdownBlocksLegacy(marked, source),
      strategy: 'legacy',
      error,
    };
  }
}

export function createEditorCore({
  marked,
  renderMarkdown,
  escapeHtml,
  getActiveBlockIndex,
  setActiveBlockIndex,
  blockParser = (source, previousBlocks) => parseMarkdownBlocksWithFallback(
    marked,
    source,
    value => parseMarkdownBlocksWithCore(value, previousBlocks),
  ),
}) {
  if (typeof renderMarkdown !== 'function') {
    throw new TypeError('createEditorCore requires renderMarkdown');
  }
  let lastParseResult = null;

  function parseMarkdownBlocks(md) {
    lastParseResult = blockParser(md, lastParseResult?.blocks || []);
    return lastParseResult.blocks;
  }

  function getBlockClassName(block, isActive) {
    const levelClass = block.type === 'heading' ? ` block-h${block.level || 1}` : '';
    return `block block-${block.type}${levelClass}${isActive ? ' active' : ''}`;
  }

  function renderBlockHtml(block) {
    if (!block.raw || !block.raw.trim()) {
      return block.type === 'paragraph' ? '<p><br></p>' : '';
    }
    if (block.type === 'hr') return '<hr>';
    return renderMarkdown(block.raw);
  }

  function buildBlockEditorHtml(md) {
    const blocks = parseMarkdownBlocks(md || '');
    let activeIndex = getActiveBlockIndex();
    if (activeIndex >= blocks.length) {
      activeIndex = blocks.length - 1;
      setActiveBlockIndex(activeIndex);
    }

    let html = '';
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const isActive = i === activeIndex;
      const rawEscaped = escapeHtml(block.raw || '');
      const rendered = renderBlockHtml(block);
      html += `
        <div class="${getBlockClassName(block, isActive)}" data-block-id="${escapeHtml(block.blockId || `block-${i}`)}" data-block-index="${i}" data-block-type="${escapeHtml(block.type)}">
          <div class="block-source" contenteditable="${isActive ? 'true' : 'false'}">${rawEscaped || '&#8203;'}</div>
          <div class="block-rendered">${rendered}</div>
        </div>
      `;
    }
    return html;
  }

  function collectBlocksMarkdown() {
    const blockElements = document.querySelectorAll('#block-editor .block');
    const rawBlocks = [];
    for (const element of blockElements) {
      const source = element.querySelector('.block-source');
      if (!source) continue;
      rawBlocks.push((source.textContent || '').replace(/\u200B/g, '').trim());
    }
    while (rawBlocks.length > 0 && rawBlocks[0] === '') rawBlocks.shift();
    while (rawBlocks.length > 0 && rawBlocks[rawBlocks.length - 1] === '') rawBlocks.pop();
    return rawBlocks.join('\n\n');
  }

  return {
    parseMarkdownBlocks,
    getLastParseResult: () => lastParseResult,
    resetParseResult: () => { lastParseResult = null; },
    getBlockClassName,
    renderBlockHtml,
    buildBlockEditorHtml,
    collectBlocksMarkdown,
  };
}
