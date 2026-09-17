import { MissingBlockError } from '../model/document.js';
import { createBlockId } from '../model/id.js';
import { createBlock } from '../model/types.js';

export class TransactionConflictError extends Error {
  constructor(expected, actual) {
    super(`document revision conflict: expected ${expected}, got ${actual}`);
    this.name = 'TransactionConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class Transaction {
  constructor({ baseRevision = 0, meta = {} } = {}) {
    this.baseRevision = baseRevision;
    this.meta = Object.freeze({ ...meta });
    this.steps = [];
    this.selectionAfter = null;
  }

  replace(blockId, raw, attrs = null) {
    this.steps.push({ type: 'replace', blockId, raw, attrs });
    return this;
  }

  insert(index, block) {
    this.steps.push({
      type: 'insert',
      index,
      block: block?.id ? block : createBlock({
        id: createBlockId('block'),
        raw: String(block ?? ''),
      }),
    });
    return this;
  }

  remove(blockId) {
    this.steps.push({ type: 'remove', blockId });
    return this;
  }

  move(blockId, beforeId = null) {
    this.steps.push({ type: 'move', blockId, beforeId });
    return this;
  }

  split(blockId, offset, ids = {}) {
    this.steps.push({ type: 'split', blockId, offset, ids });
    return this;
  }

  setSelection(selection) {
    this.selectionAfter = selection;
    return this;
  }

  isEmpty() {
    return this.steps.length === 0;
  }
}

function applyStep(document, step) {
  switch (step.type) {
    case 'replace': {
      const previous = document.requireBlock(step.blockId);
      return {
        document: document.replaceBlock(step.blockId, {
          raw: step.raw,
          ...(step.attrs ? { attrs: step.attrs } : {}),
        }),
        inverse: {
          type: 'replace',
          blockId: previous.id,
          raw: previous.raw,
          attrs: previous.attrs,
        },
      };
    }
    case 'insert': {
      const block = createBlock({
        ...step.block,
        id: step.block.id || createBlockId('block'),
      });
      return {
        document: document.insertBlock(step.index, block),
        inverse: { type: 'remove', blockId: block.id },
      };
    }
    case 'remove': {
      const index = document.getBlockIndex(step.blockId);
      if (index === -1) throw new MissingBlockError(step.blockId);
      const block = document.blocks[index];
      return {
        document: document.removeBlock(step.blockId),
        inverse: { type: 'insert', index, block },
      };
    }
    case 'move': {
      const previousIndex = document.getBlockIndex(step.blockId);
      if (previousIndex === -1) throw new MissingBlockError(step.blockId);
      const previousBeforeId = document.blocks[previousIndex + 1]?.id ?? null;
      return {
        document: document.moveBlock(step.blockId, step.beforeId),
        inverse: { type: 'move', blockId: step.blockId, beforeId: previousBeforeId === step.blockId ? null : previousBeforeId },
      };
    }
    case 'split': {
      const previous = document.requireBlock(step.blockId);
      const nextDocument = document.splitBlock(step.blockId, step.offset, step.ids);
      const rightId = nextDocument.blocks[nextDocument.getBlockIndex(step.blockId) + 1]?.id;
      return {
        document: nextDocument,
        inverse: [
          { type: 'replace', blockId: previous.id, raw: previous.raw, attrs: previous.attrs },
          ...(rightId ? [{ type: 'remove', blockId: rightId }] : []),
        ],
      };
    }
    default:
      throw new Error(`unsupported transaction step: ${step.type}`);
  }
}

export class AppliedTransaction {
  constructor({ document, inverse, original, beforeDocument }) {
    this.document = document;
    this.inverse = Object.freeze(inverse);
    this.original = Object.freeze(original);
    this.beforeDocument = beforeDocument;
    this.baseRevision = original.baseRevision;
    this.selectionAfter = original.selectionAfter;
    this.meta = original.meta;
  }
}

export function createTransaction(document, options = {}) {
  return new Transaction({
    ...options,
    baseRevision: options.baseRevision ?? document.version,
  });
}

export function applyTransaction(document, transaction) {
  if (document.version !== transaction.baseRevision) {
    throw new TransactionConflictError(transaction.baseRevision, document.version);
  }

  let nextDocument = document;
  const inverse = [];
  for (const step of transaction.steps) {
    const result = applyStep(nextDocument, step);
    nextDocument = result.document;
    if (Array.isArray(result.inverse)) inverse.push(...result.inverse);
    else inverse.push(result.inverse);
  }

  const finalDocument = nextDocument === document
    ? document
    : nextDocument.withVersion(document.version + 1);

  return new AppliedTransaction({
    document: finalDocument,
    inverse,
    original: transaction,
    beforeDocument: document,
  });
}

export function revertTransaction(document, applied) {
  if (document.version !== applied.document.version) {
    throw new TransactionConflictError(applied.document.version, document.version);
  }
  const inverseTransaction = new Transaction({
    baseRevision: document.version,
    meta: { ...applied.meta, reverted: true },
  });
  inverseTransaction.steps.push(...applied.inverse);
  return applyTransaction(document, inverseTransaction);
}

export function canApplyTransaction(document, transaction) {
  return document.version === transaction.baseRevision;
}
