import test from 'node:test';
import assert from 'node:assert/strict';

import { expandDocumentParents } from '../paths.js';

test('expands every parent directory for a nested document', () => {
  const expandedDirs = new Set();

  expandDocumentParents('/workspace/projects/notes/current.md', '/workspace', expandedDirs);

  assert.deepEqual([...expandedDirs], [
    '/workspace/projects/notes',
    '/workspace/projects',
  ]);
});

test('does not add the workspace root or unrelated paths', () => {
  const expandedDirs = new Set();

  expandDocumentParents('/workspace/current.md', '/workspace', expandedDirs);
  expandDocumentParents('/workspace-other/current.md', '/workspace', expandedDirs);

  assert.deepEqual([...expandedDirs], []);
});

test('supports Windows path separators', () => {
  const expandedDirs = new Set();

  expandDocumentParents('C:\\workspace\\notes\\current.md', 'C:\\workspace', expandedDirs);

  assert.deepEqual([...expandedDirs], ['C:\\workspace\\notes']);
});
