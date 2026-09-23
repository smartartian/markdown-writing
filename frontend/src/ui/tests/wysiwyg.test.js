import test from 'node:test';
import assert from 'node:assert/strict';

import { htmlToMarkdown, renderedHtmlToMarkdown } from "../wysiwyg.js";

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

test("wysiwyg keeps plain pasted text unchanged and preserves line breaks", async () => {
  const source = 'Paste _text_ and *markers*\nSecond line';
  const markdown = await renderedHtmlToMarkdown(
    '<p>Paste _text_ and *markers*<br>Second line<br></p>',
    source,
  );
  assert.equal(markdown, source);
});

test('wysiwyg still converts rich rendered markup to Markdown', async () => {
  const markdown = await renderedHtmlToMarkdown('<p><strong>Bold</strong> text</p>', 'Bold text');
  assert.equal(markdown, await htmlToMarkdown('<p><strong>Bold</strong> text</p>'));
});
