import { MissingBlockError } from '../model/document.js';

export class SelectionInvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelectionInvariantError';
  }
}

function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  return path.map(value => {
    if (!Number.isInteger(value) || value < 0) {
      throw new SelectionInvariantError(`invalid selection path value: ${value}`);
    }
    return value;
  });
}

export function createPosition(blockId, offset = 0, path = []) {
  if (!blockId) throw new SelectionInvariantError('selection position requires blockId');
  if (!Number.isInteger(offset) || offset < 0) {
    throw new SelectionInvariantError(`selection offset must be a non-negative integer: ${offset}`);
  }
  return Object.freeze({
    blockId,
    path: Object.freeze(normalizePath(path)),
    offset,
  });
}

export function createSelection(anchor, head = anchor) {
  return Object.freeze({
    anchor,
    head,
  });
}

export function collapsedSelection(blockId, offset = 0, path = []) {
  const position = createPosition(blockId, offset, path);
  return createSelection(position, position);
}

export function isCollapsed(selection) {
  return selection.anchor.blockId === selection.head.blockId &&
    selection.anchor.offset === selection.head.offset &&
    JSON.stringify(selection.anchor.path) === JSON.stringify(selection.head.path);
}

export function clampPosition(document, position) {
  const block = document.getBlock(position.blockId);
  if (!block) throw new MissingBlockError(position.blockId);
  return createPosition(
    position.blockId,
    Math.min(position.offset, block.raw.length),
    position.path,
  );
}

export function normalizeSelection(document, selection) {
  return createSelection(
    clampPosition(document, selection.anchor),
    clampPosition(document, selection.head),
  );
}

export function comparePositions(document, left, right) {
  const leftIndex = document.getBlockIndex(left.blockId);
  const rightIndex = document.getBlockIndex(right.blockId);
  if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  const leftPath = JSON.stringify(left.path);
  const rightPath = JSON.stringify(right.path);
  if (leftPath !== rightPath) return leftPath < rightPath ? -1 : 1;
  return left.offset - right.offset;
}

export function selectionDirection(document, selection) {
  const comparison = comparePositions(document, selection.anchor, selection.head);
  if (comparison === 0) return 'none';
  return comparison < 0 ? 'forward' : 'backward';
}

export function assertSelectionInvariant(document, selection) {
  const normalized = normalizeSelection(document, selection);
  for (const position of [normalized.anchor, normalized.head]) {
    const block = document.requireBlock(position.blockId);
    if (position.offset < 0 || position.offset > block.raw.length) {
      throw new SelectionInvariantError(
        `selection offset ${position.offset} is outside block ${position.blockId} length ${block.raw.length}`,
      );
    }
  }
  return normalized;
}

function mapPositionThroughStep(position, step, beforeDocument, afterDocument) {
  switch (step.type) {
    case 'replace': {
      if (position.blockId !== step.blockId) return position;
      const block = afterDocument.getBlock(step.blockId);
      return createPosition(
        position.blockId,
        Math.min(position.offset, block?.raw.length || 0),
        position.path,
      );
    }
    case 'split': {
      if (position.blockId !== step.blockId || position.offset <= step.offset) return position;
      const leftIndex = afterDocument.getBlockIndex(step.blockId);
      const right = afterDocument.blocks[leftIndex + 1];
      if (!right) return position;
      return createPosition(right.id, position.offset - step.offset, position.path);
    }
    case 'remove': {
      if (position.blockId !== step.blockId) return position;
      const removedIndex = beforeDocument.getBlockIndex(step.blockId);
      const next = afterDocument.blocks[removedIndex] || afterDocument.blocks[removedIndex - 1];
      if (!next) return null;
      return createPosition(next.id, 0, position.path);
    }
    case 'insert':
    case 'move':
    default:
      return position;
  }
}

export function mapSelectionThroughTransaction(selection, applied) {
  if (!selection || !applied?.beforeDocument) return selection;
  let anchor = selection.anchor;
  let head = selection.head;
  for (const step of applied.original.steps) {
    anchor = mapPositionThroughStep(anchor, step, applied.beforeDocument, applied.document);
    head = mapPositionThroughStep(head, step, applied.beforeDocument, applied.document);
    if (!anchor || !head) {
      const fallback = applied.document.blocks[0];
      if (!fallback) return null;
      return collapsedSelection(fallback.id, 0);
    }
  }
  return normalizeSelection(applied.document, createSelection(anchor, head));
}
