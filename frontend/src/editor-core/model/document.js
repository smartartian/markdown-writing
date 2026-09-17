import { createBlockId } from './id.js';
import { createBlock, inferBlockType } from './types.js';

function normalizeBlock(block) {
  if (!block || typeof block !== 'object') {
    throw new TypeError('block must be an object');
  }
  return createBlock({
    ...block,
    id: block.id || createBlockId(),
  });
}

function assertOffset(offset, length) {
  if (!Number.isInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError(`offset ${offset} is outside block range 0..${length}`);
  }
}

export class DuplicateBlockIdError extends Error {
  constructor(id) {
    super(`duplicate block id: ${id}`);
    this.name = 'DuplicateBlockIdError';
  }
}

export class MissingBlockError extends Error {
  constructor(id) {
    super(`block not found: ${id}`);
    this.name = 'MissingBlockError';
  }
}

export class MarkdownDocument {
  constructor(blocks = [], { version = 0 } = {}) {
    const ids = new Set();
    const normalized = blocks.map(block => {
      const next = normalizeBlock(block);
      if (ids.has(next.id)) throw new DuplicateBlockIdError(next.id);
      ids.add(next.id);
      return next;
    });
    this.blocks = Object.freeze(normalized);
    this.version = version;
  }

  static empty(options = {}) {
    return new MarkdownDocument([], options);
  }

  static fromMarkdown(markdown, options = {}) {
    const source = String(markdown ?? '');
    if (!source) return MarkdownDocument.empty(options);
    return new MarkdownDocument([
      createBlock({
        id: options.blockId || createBlockId('raw'),
        type: inferBlockType(source),
        raw: source,
      }),
    ], options);
  }

  static fromBlocks(blocks, options = {}) {
    return new MarkdownDocument(blocks, options);
  }

  getBlockIndex(id) {
    return this.blocks.findIndex(block => block.id === id);
  }

  getBlock(id) {
    const index = this.getBlockIndex(id);
    return index === -1 ? null : this.blocks[index];
  }

  requireBlock(id) {
    const block = this.getBlock(id);
    if (!block) throw new MissingBlockError(id);
    return block;
  }

  withVersion(version = this.version + 1) {
    return new MarkdownDocument(this.blocks, { version });
  }

  withBlocks(blocks, { version = this.version + 1 } = {}) {
    return new MarkdownDocument(blocks, { version });
  }

  replaceBlock(id, patch) {
    const index = this.getBlockIndex(id);
    if (index === -1) throw new MissingBlockError(id);
    const current = this.blocks[index];
    const nextRaw = patch.raw ?? current.raw;
    const next = createBlock({
      ...current,
      ...patch,
      id,
      raw: nextRaw,
      type: patch.type || inferBlockType(nextRaw),
      revision: current.revision + 1,
    });
    const blocks = [...this.blocks];
    blocks[index] = next;
    return this.withBlocks(blocks);
  }

  insertBlock(index, block) {
    if (!Number.isInteger(index) || index < 0 || index > this.blocks.length) {
      throw new RangeError(`insert index ${index} is outside 0..${this.blocks.length}`);
    }
    const next = normalizeBlock(block);
    if (this.getBlock(next.id)) throw new DuplicateBlockIdError(next.id);
    const blocks = [...this.blocks];
    blocks.splice(index, 0, next);
    return this.withBlocks(blocks);
  }

  removeBlock(id) {
    const index = this.getBlockIndex(id);
    if (index === -1) throw new MissingBlockError(id);
    const blocks = [...this.blocks];
    blocks.splice(index, 1);
    return this.withBlocks(blocks);
  }

  moveBlock(id, beforeId = null) {
    const fromIndex = this.getBlockIndex(id);
    if (fromIndex === -1) throw new MissingBlockError(id);
    if (beforeId === id) return this;

    const blocks = [...this.blocks];
    const [block] = blocks.splice(fromIndex, 1);
    let targetIndex = beforeId == null
      ? blocks.length
      : blocks.findIndex(item => item.id === beforeId);
    if (targetIndex === -1) throw new MissingBlockError(beforeId);
    blocks.splice(targetIndex, 0, block);
    if (blocks.every((item, index) => item.id === this.blocks[index]?.id)) return this;
    return this.withBlocks(blocks);
  }

  splitBlock(id, offset, {
    leftId = id,
    rightId = createBlockId('block'),
  } = {}) {
    const index = this.getBlockIndex(id);
    if (index === -1) throw new MissingBlockError(id);
    const block = this.blocks[index];
    assertOffset(offset, block.raw.length);

    const leftRaw = block.raw.slice(0, offset);
    const rightRaw = block.raw.slice(offset);
    const left = createBlock({
      ...block,
      id: leftId,
      raw: leftRaw,
      type: inferBlockType(leftRaw),
      revision: block.revision + 1,
    });
    const right = createBlock({
      ...block,
      id: rightId,
      raw: rightRaw,
      type: inferBlockType(rightRaw),
      revision: 1,
    });

    const blocks = [...this.blocks];
    blocks.splice(index, 1, left, right);
    return this.withBlocks(blocks);
  }

  toMarkdown() {
    return this.blocks.map(block => block.raw).join('');
  }
}
