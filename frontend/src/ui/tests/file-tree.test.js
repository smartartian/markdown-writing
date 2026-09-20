import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileTreeModule } from '../../modules/file-tree.js';

test('file tree keeps directory creation and moves file actions to the context menu', () => {
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
  assert.doesNotMatch(html, /data-tree-action="rename"/);
  assert.doesNotMatch(html, /data-tree-action="delete"/);
});

test('file tree marks parent directories containing the active document', () => {
  const module = createFileTreeModule({
    state: {
      currentDoc: { path: '/workspace/projects/current.md' },
      expandedDirs: new Set(['/workspace', '/workspace/projects']),
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
    {
      name: 'workspace',
      path: '/workspace',
      isDir: true,
      children: [
        {
          name: 'projects',
          path: '/workspace/projects',
          isDir: true,
          children: [
            { name: 'current.md', path: '/workspace/projects/current.md', isDir: false },
          ],
        },
      ],
    },
  ], 0);

  assert.match(html, /file-tree-dir-node expanded contains-active[\s\S]*?data-dir-path="\/workspace"/);
  assert.match(html, /file-item-file active[\s\S]*?data-path="\/workspace\/projects\/current\.md"/);
});
