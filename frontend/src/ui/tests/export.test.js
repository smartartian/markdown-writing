import test from 'node:test';
import assert from 'node:assert/strict';

import { createExportModule } from '../../modules/export.js';

test('native export saves text and Word content through the provided callback', async () => {
  const saved = [];
  const module = createExportModule({
    getCurrentMd: () => '# Title\n\nBody',
    getExportName: extension => `document.${extension}`,
    renderMarkdown: markdown => `<h1>${markdown}</h1>`,
    escapeHtml: value => String(value),
    saveExportFile: async (name, content, encoding) => {
      saved.push({ name, content, encoding });
      return `/exports/${name}`;
    },
  });

  const text = await module.handleExport('txt');
  const word = await module.handleExport('docx');

  assert.equal(text.path, '/exports/document.txt');
  assert.equal(word.path, '/exports/document.doc');
  assert.deepEqual(saved.map(item => item.name), [
    'document.txt',
    'document.doc',
  ]);
  assert.equal(saved.every(item => item.encoding === 'utf8'), true);
});
