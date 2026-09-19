import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownRenderer } from '../../markdown/renderer.js';

const renderer = createMarkdownRenderer({ sanitize: html => html });

test('markdown renderer wraps tables and preserves alignment', () => {
  const html = renderer.render(
    '| Name | State | Note |\n'
    + '| :--- | :---: | ---: |\n'
    + '| Alice | Done | Ready |',
  );

  assert.match(html, /class="md-table-wrap"/);
  assert.match(html, /class="md-table"/);
  assert.match(html, /<th scope="col" align="left">Name<\/th>/);
  assert.match(html, /<th scope="col" align="center">State<\/th>/);
  assert.match(html, /<th scope="col" align="right">Note<\/th>/);
  assert.match(html, /<td align="left">Alice<\/td>/);
  assert.match(html, /<tbody>/);
});

test('markdown renderer keeps gfm task lists and strikethrough', () => {
  const html = renderer.render('- [x] done\n- [ ] todo\n\n~~removed~~\n\n==highlighted==');

  assert.match(html, /type="checkbox"/);
  assert.match(html, /<del>removed<\/del>/);
  assert.match(html, /<mark class="md-highlight">highlighted<\/mark>/);
});

test('markdown renderer supports percentage image widths', () => {
  const html = renderer.render('![Preview](./assets/preview.png){width=45%}');

  assert.match(html, /<img src="\.\/assets\/preview\.png" alt="Preview"/);
  assert.match(html, /data-md-width="45%"/);
});
