let blockSequence = 0;

export function createBlockId(prefix = 'block') {
  blockSequence += 1;
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${blockSequence}-${random}`;
}

export function resetBlockIdSequence() {
  blockSequence = 0;
}
