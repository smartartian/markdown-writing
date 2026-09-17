import {
  applyTransaction,
  createTransaction,
} from '../transaction/transaction.js';
import { mapSelectionThroughTransaction } from '../selection/model.js';

function blockSignature(block) {
  return JSON.stringify({
    id: block.id,
    type: block.type,
    raw: block.raw,
    attrs: block.attrs,
  });
}

function changedBlockIds(beforeDocument, afterDocument) {
  const before = new Map(beforeDocument.blocks.map(block => [block.id, blockSignature(block)]));
  const after = new Map(afterDocument.blocks.map(block => [block.id, blockSignature(block)]));
  const changed = new Set();
  for (const [id, signature] of before) {
    if (after.get(id) !== signature) changed.add(id);
  }
  for (const [id, signature] of after) {
    if (before.get(id) !== signature) changed.add(id);
  }
  return [...changed];
}

export class EditorSession {
  constructor(document, selection = null, {
    coalesceWindowMs = 750,
    maxHistory = 200,
  } = {}) {
    this.document = document;
    this.selection = selection;
    this.coalesceWindowMs = coalesceWindowMs;
    this.maxHistory = maxHistory;
    this.undoStack = [];
    this.redoStack = [];
    this.lastTransactionId = 0;
    this.persistedTransactionId = 0;
    this.persistedVersion = document.version;
  }

  createTransaction(meta = {}) {
    return createTransaction(this.document, {
      meta,
    });
  }

  apply(transaction, {
    coalesceKey = null,
    now = Date.now(),
  } = {}) {
    const beforeDocument = this.document;
    const beforeSelection = this.selection;
    const applied = applyTransaction(beforeDocument, transaction);
    const transactionID = this.lastTransactionId + 1;
    this.lastTransactionId = transactionID;
    applied.transactionID = transactionID;
    const afterSelection = beforeSelection
      ? mapSelectionThroughTransaction(beforeSelection, applied)
      : this.selection;
    const changed = changedBlockIds(beforeDocument, applied.document);
    const entry = {
      beforeDocument,
      beforeSelection,
      afterDocument: applied.document,
      afterSelection,
      coalesceKey,
      timestamp: now,
      transactionID,
      afterVersion: applied.document.version,
    };

    const previous = this.undoStack[this.undoStack.length - 1];
    if (
      coalesceKey &&
      previous?.coalesceKey === coalesceKey &&
      now - previous.timestamp <= this.coalesceWindowMs
    ) {
      previous.afterDocument = applied.document;
      previous.afterSelection = afterSelection;
      previous.timestamp = now;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    }

    this.redoStack.length = 0;
    this.document = applied.document;
    this.selection = afterSelection;
    return {
      applied,
      changedBlockIds: changed,
      selection: afterSelection,
      document: this.document,
      transactionID,
    };
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    this.document = entry.beforeDocument;
    this.selection = entry.beforeSelection;
    return {
      document: this.document,
      selection: this.selection,
      changedBlockIds: changedBlockIds(entry.afterDocument, entry.beforeDocument),
    };
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    this.document = entry.afterDocument;
    this.selection = entry.afterSelection;
    return {
      document: this.document,
      selection: this.selection,
      changedBlockIds: changedBlockIds(entry.beforeDocument, entry.afterDocument),
    };
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  replaceDocument(document, selection = this.selection) {
    this.document = document;
    this.selection = selection;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.persistedVersion = document.version;
    this.persistedTransactionId = this.lastTransactionId;
  }

  markPersisted() {
    this.persistedVersion = this.document.version;
    this.persistedTransactionId = this.lastTransactionId;
  }

  isDirty() {
    return this.document.version !== this.persistedVersion;
  }
}

export function createEditorSession(document, selection, options) {
  return new EditorSession(document, selection, options);
}
