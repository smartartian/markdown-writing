import { createPosition, createSelection } from './model.js';

function escapeSelector(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function getBlockElement(root, blockId) {
  return root.querySelector(`[data-block-id="${escapeSelector(blockId)}"]`);
}

function isTextContainer(node) {
  return node?.nodeType === Node.ELEMENT_NODE &&
    (node.classList?.contains('block-source') || node.classList?.contains('block-rendered'));
}

function resolveContainer(blockElement, preferSource = false) {
  if (!blockElement) return null;
  const source = blockElement.querySelector('.block-source');
  const rendered = blockElement.querySelector('.block-rendered');
  if (preferSource && source) return source;
  return source?.contentEditable === 'true' ? source : rendered || source;
}

function textPosition(container, offset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  let remaining = offset;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return { node: container, offset: container.childNodes.length };
}

function offsetWithin(container, node, offset) {
  if (node === container && node.nodeType === Node.ELEMENT_NODE) {
    let total = 0;
    for (let index = 0; index < offset; index++) {
      total += node.childNodes[index]?.textContent?.length || 0;
    }
    return total;
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current;
  let total = 0;
  while ((current = walker.nextNode())) {
    if (current === node) return total + offset;
    total += current.textContent?.length || 0;
  }
  return total;
}

export function modelPositionToDom(root, position, resolveOffset = null) {
  const blockElement = getBlockElement(root, position.blockId);
  const container = resolveContainer(blockElement, true);
  if (!container) return null;
  const offset = resolveOffset ? resolveOffset(position) : position.offset;
  const location = textPosition(container, offset);
  const range = document.createRange();
  range.setStart(location.node, location.offset);
  range.collapse(true);
  return range;
}

export function modelSelectionToDom(root, selection, resolveOffset = null) {
  const anchor = modelPositionToDom(root, selection.anchor, resolveOffset);
  const head = modelPositionToDom(root, selection.head, resolveOffset);
  if (!anchor || !head) return null;
  const range = document.createRange();
  range.setStart(anchor.startContainer, anchor.startOffset);
  range.setEnd(head.startContainer, head.startOffset);
  return range;
}

export function domPositionToModel(root, node, offset) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const blockElement = element?.closest?.('[data-block-id]');
  if (!blockElement) return null;
  const container = element.closest('.block-source, .block-rendered') || resolveContainer(blockElement);
  if (!container) return null;
  return createPosition(
    blockElement.dataset.blockId,
    offsetWithin(container, node, offset),
    [],
  );
}

export function domSelectionToModel(root) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const anchor = domPositionToModel(root, range.startContainer, range.startOffset);
  const head = domPositionToModel(root, range.endContainer, range.endOffset);
  if (!anchor || !head) return null;
  return createSelection(anchor, head);
}

export function applyModelSelection(root, selection, options = {}) {
  const range = modelSelectionToDom(root, selection, options.resolveOffset);
  if (!range) return false;
  const domSelection = window.getSelection();
  if (!domSelection) return false;
  domSelection.removeAllRanges();
  domSelection.addRange(range);
  return true;
}

export { getBlockElement, resolveContainer };
