import assert from 'node:assert/strict';
import test from 'node:test';

import { syncDirtyState } from '../../core/dirty-state.js';

test('dirty state clears after edited content is restored', () => {
  const state = {
    currentContent: '# Original',
    persistedContent: '# Original',
    isDirty: false,
  };

  state.currentContent = '# Original edited';
  assert.equal(syncDirtyState(state), true);

  state.currentContent = '# Original';
  assert.equal(syncDirtyState(state), false);
});

test('dirty state compares the current content with the last saved content', () => {
  const state = {
    currentContent: '# Draft',
    persistedContent: '# Saved',
    isDirty: false,
  };

  assert.equal(syncDirtyState(state), true);

  state.persistedContent = '# Draft';
  assert.equal(syncDirtyState(state), false);
});
