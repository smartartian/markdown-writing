import { marked } from 'marked';
import { parseMarkdownBlocksLegacy } from '../../modules/legacy-parser.js';
import { parseMarkdown } from '../../editor-core/parser/block-parser.js';
import { serializeDocument } from '../../editor-core/serializer/markdown-serializer.js';

let shadowTimer = null;
let lastComparedSource = null;
let lastReport = null;

if (typeof window !== 'undefined' && import.meta.env?.DEV !== false) {
  window.__markdownShadowCompare = compareMarkdownCore;
  window.__markdownShadowEnabled = true;
  document.documentElement.dataset.markdownShadowEnabled = 'true';
}

function legacySignature(blocks) {
  return blocks.map(block => ({
    type: block.type,
    raw: (block.raw || '').replace(/\s+$/, ''),
  }));
}

function coreType(block) {
  if (block.type === 'divider') return 'hr';
  if (block.type === 'list') return block.attrs?.ordered ? 'olist' : 'ulist';
  if (block.type === 'quote') return 'blockquote';
  if (block.type === 'raw' && /^\s*<[A-Za-z!/]/.test(block.raw || '')) return 'html';
  return block.type;
}

function coreSignature(document) {
  return document.blocks
    .filter(block => !block.attrs?.separator)
    .map(block => ({
      type: coreType(block),
      raw: (block.raw || '').replace(/\s+$/, ''),
    }));
}

export function compareMarkdownCore(markdown) {
  const source = String(markdown ?? '');
  const legacyBlocks = parseMarkdownBlocksLegacy(marked, source);
  const coreDocument = parseMarkdown(source);
  const legacyOutput = legacyBlocks.map(block => block.raw || '').join('\n\n');
  const coreOutput = serializeDocument(coreDocument);
  const legacy = legacySignature(legacyBlocks);
  const core = coreSignature(coreDocument);
  const differences = [];
  const improvements = [];

  if (legacyOutput !== source && coreOutput === source) {
    improvements.push('new-core-preserves-more-source');
  }
  if (coreOutput !== source) {
    differences.push('new-core-roundtrip-mismatch');
  }
  if (legacy.length !== core.length) {
    differences.push('block-count');
  }
  const max = Math.max(legacy.length, core.length);
  for (let index = 0; index < max; index++) {
    const left = legacy[index];
    const right = core[index];
    if (!left || !right || left.type !== right.type || left.raw !== right.raw) {
      differences.push(`block-${index}`);
    }
  }

  return {
    source,
    legacyOutput,
    coreOutput,
    legacy,
    core,
    differences,
    improvements,
    equivalent: differences.length === 0,
  };
}

export function scheduleShadowComparison(markdown, { onReport } = {}) {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV === false) return;
  clearTimeout(shadowTimer);
  shadowTimer = setTimeout(() => {
    const source = String(markdown ?? '');
    if (source === lastComparedSource) return;
    lastComparedSource = source;
    lastReport = compareMarkdownCore(source);
    if (typeof window !== 'undefined') {
      window.__markdownShadowReport = lastReport;
    }
    document.documentElement.dataset.markdownShadowEquivalent = String(lastReport.equivalent);
    document.documentElement.dataset.markdownShadowDifferences = lastReport.differences.join(',');
    if (!lastReport.equivalent) {
      console.groupCollapsed('[editor shadow] Markdown core differences');
      console.log(lastReport);
      console.groupEnd();
    }
    onReport?.(lastReport);
  }, 400);
}

export function getLastShadowReport() {
  return lastReport;
}
