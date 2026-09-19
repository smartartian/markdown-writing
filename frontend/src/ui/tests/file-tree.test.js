import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileTreeModule } from '../../modules/file-tree.js';

test('file tree renders create, rename and delete actions', () => {
  const module = createFileTreeModule({
    state: {
      currentDoc: { path: '/docs/readme.md' },
      docTree: [],
      expandedDirs: new Set(),
    },
    storage: {},
    escapeHtml: value => String(value ?? ''),
    fileNameWithoutExt: name => name.replace(/\.md$/i, ''),
    lucideIcons: () => {},
    openEditor: async () => {},
    saveCurrentDoc: async () => {},
    onCurrentDocumentDeleted: async () => {},
    t: key => key,
  });

  const html = module.buildFileTreeHtml([
    { name: 'notes', path: '/docs/notes', isDir: true, children: [] },
    { name: 'readme.md', path: '/docs/readme.md', isDir: false, size: 128 },
  ], 0);

  assert.match(html, /data-tree-action="new"[\s\S]*?data-dir-path="\/docs\/notes"/);
  assert.match(html, /data-tree-action="rename"[\s\S]*?data-path="\/docs\/readme\.md"/);
  assert.match(html, /data-tree-action="delete"[\s\S]*?data-path="\/docs\/readme\.md"/);
});
