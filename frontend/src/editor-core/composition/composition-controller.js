import { MarkdownDocument } from '../model/document.js';
import { createBlock } from '../model/types.js';
import {
  applyTransaction,
  createTransaction,
} from '../transaction/transaction.js';

export class CompositionController {
  constructor({ onCommit } = {}) {
    this.onCommit = onCommit;
    this.active = false;
    this.blockId = null;
    this.beforeRaw = '';
    this.data = '';
    this.startedAt = 0;
    this.sequence = 0;
  }

  start({ blockId, raw }) {
    if (!blockId) throw new Error('composition start requires blockId');
    this.active = true;
    this.blockId = blockId;
    this.beforeRaw = String(raw ?? '');
    this.data = '';
    this.startedAt = Date.now();
    this.sequence += 1;
  }

  update(data) {
    if (!this.active) return;
    this.data = String(data ?? '');
  }

  end({ raw }) {
    if (!this.active) return null;
    const blockId = this.blockId;
    const beforeRaw = this.beforeRaw;
    const afterRaw = String(raw ?? '');
    this.reset();

    if (afterRaw === beforeRaw) {
      return {
        blockId,
        beforeRaw,
        afterRaw,
        transaction: null,
        applied: null,
        changed: false,
      };
    }

    const document = MarkdownDocument.fromBlocks([
      createBlock({
        id: blockId,
        raw: beforeRaw,
      }),
    ]);
    const transaction = createTransaction(document, {
      meta: {
        source: 'composition',
        sequence: this.sequence,
      },
    }).replace(blockId, afterRaw);
    const applied = applyTransaction(document, transaction);
    const result = {
      blockId,
      beforeRaw,
      afterRaw,
      transaction,
      applied,
      changed: true,
    };
    this.onCommit?.(result);
    return result;
  }

  cancel() {
    if (!this.active) return null;
    const result = {
      blockId: this.blockId,
      beforeRaw: this.beforeRaw,
      data: this.data,
      cancelled: true,
    };
    this.reset();
    return result;
  }

  isActive() {
    return this.active;
  }

  reset() {
    this.active = false;
    this.blockId = null;
    this.beforeRaw = '';
    this.data = '';
    this.startedAt = 0;
  }
}

export function createCompositionController(options) {
  return new CompositionController(options);
}
