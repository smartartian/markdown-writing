import test from 'node:test';
import assert from 'node:assert/strict';

import { htmlToMarkdown } from '../wysiwyg.js';

test('wysiwyg converts rendered block HTML back to Markdown', async () => {
  const markdown = await htmlToMarkdown('<h2>Title</h2><p><strong>Bold</strong> and <em>italic</em></p>');
  assert.equal(markdown, '## Title\n\n**Bold** and *italic*');
});

test('wysiwyg preserves highlight and GFM table output', async () => {
  const markdown = await htmlToMarkdown('<p><mark>Note</mark></p><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.match(markdown, /==Note==/);
  assert.match(markdown, /\| A \| B \|/);
});

test('wysiwyg writes compact unordered and ordered list markers', async () => {
  const unordered = await htmlToMarkdown('<ul><li>项目三</li></ul>');
  const ordered = await htmlToMarkdown('<ol><li>第一步</li></ol>');

  assert.equal(unordered, '- 项目三');
  assert.equal(ordered, '1. 第一步');
});
