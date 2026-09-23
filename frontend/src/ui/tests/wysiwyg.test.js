import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRenderedTextLength,
  hasRichMarkup,
  htmlToMarkdown,
  isLayoutWhitespaceNode,
  renderedHtmlToMarkdown,
} from "../wysiwyg.js";
import { createMarkdownRenderer } from "../../markdown/renderer.js";

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

test('wysiwyg keeps execCommand-generated inline markup', async () => {
  // 回归：execCommand('bold'|'italic'|'strikeThrough') 产生的是 b/i/strike，
  // 它们必须被判为富文本，否则会走 innerText 快路径而把标记静默丢弃。
  assert.equal(await renderedHtmlToMarkdown('<p>abc<b>def</b></p>', 'abcdef'), 'abc**def**');
  assert.equal(await renderedHtmlToMarkdown('<p><i>x</i></p>', 'x'), '*x*');
  assert.equal(await renderedHtmlToMarkdown('<p><strike>y</strike></p>', 'y'), '~~y~~');
});

test('wysiwyg writes GFM strikethrough for del and strike', async () => {
  assert.equal(await htmlToMarkdown('<p><del>x</del></p>'), '~~x~~');
  assert.equal(await htmlToMarkdown('<p><strike>x</strike></p>'), '~~x~~');
  assert.equal(await htmlToMarkdown('<p><s>x</s></p>'), '~~x~~');
});

test('wysiwyg collapses blank runs that carry whitespace', async () => {
  // 回归：turndown 给空段落留了两个空格，旧规则 /\n{3,}/ 匹配不到，空行会被放大。
  assert.equal(await htmlToMarkdown('<p>A</p><p><br></p><p>B</p>'), 'A\n\nB');
  assert.equal(await htmlToMarkdown('<p>A</p><p>B</p>'), 'A\n\nB');
});

test('wysiwyg hasRichMarkup only reports markup worth preserving', () => {
  assert.equal(hasRichMarkup('<p>a<b>b</b></p>'), true);
  assert.equal(hasRichMarkup('<strong>x</strong>'), true);
  assert.equal(hasRichMarkup('<ul><li>x</li></ul>'), true);
  assert.equal(hasRichMarkup('<p>a<br>b</p>'), false);
  assert.equal(hasRichMarkup(''), false);
  assert.equal(hasRichMarkup('<div>a</div>'), false);
});

test('wysiwyg round-trips GFM task lists without rewriting the model', async () => {
  // 回归：勾选框被 sanitizer 剥掉时反推会得到 `- abc`（`[ ]` 丢失），
  // 于是每次输入都会把任务列表块改脏。这里要求「渲染 → 反推」逐字还原。
  const renderer = createMarkdownRenderer({ sanitize: html => html });
  for (const source of ['- [ ] 待办', '- [x] 已完成', '1. [ ] 有序待办']) {
    assert.equal(await htmlToMarkdown(renderer.render(source)), source);
  }
});

test('wysiwyg collapses the extra space the checkbox leaves behind', async () => {
  assert.equal(
    await htmlToMarkdown('<ul><li><input disabled="" type="checkbox"> abc</li></ul>'),
    '- [ ] abc',
  );
  assert.equal(
    await htmlToMarkdown('<ul><li><input checked="" disabled="" type="checkbox"> abc</li></ul>'),
    '- [x] abc',
  );
});

function textNode(text, parentTag) {
  return { nodeType: 3, textContent: text, parentElement: { tagName: parentTag } };
}

function installFakeTextWalker(nodes) {
  globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = {
    createTreeWalker: () => {
      let index = 0;
      return { nextNode: () => (index < nodes.length ? nodes[index++] : null) };
    },
  };
}

test('wysiwyg treats block-container padding whitespace as non-text', () => {
  // 回归：`<ul>\n<li>a</li>\n</ul>` 的 Range.toString() 比可见文本多一个字符，
  // 光标偏移会整体错位（列表里打字插到行首），这些节点必须被排除在外。
  assert.equal(isLayoutWhitespaceNode(textNode('\n', 'UL')), true);
  assert.equal(isLayoutWhitespaceNode(textNode('\n  ', 'BLOCKQUOTE')), true);
  assert.equal(isLayoutWhitespaceNode(textNode(' ', 'LI')), true);
  assert.equal(isLayoutWhitespaceNode(textNode('a b', 'UL')), false);
  // 段落里的空格是可见文本，不能当成排版空白。
  assert.equal(isLayoutWhitespaceNode(textNode(' ', 'P')), false);
  assert.equal(isLayoutWhitespaceNode(textNode('\n', 'P')), false);
  assert.equal(isLayoutWhitespaceNode({ nodeType: 1, textContent: '', parentElement: { tagName: 'UL' } }), false);
});

test('wysiwyg renders text length without layout whitespace', () => {
  installFakeTextWalker([
    textNode('\n', 'UL'),
    textNode('a', 'LI'),
    textNode('\n', 'UL'),
  ]);
  assert.equal(getRenderedTextLength({}), 1);
});

test('wysiwyg keeps empty block containers instead of dropping them', async () => {
  // 回归：turndown 把「只有空白」的节点当空白块丢掉，于是刚敲下的 `>`、空的列表项
  // 在块重渲染后同步回模型时整块消失。NBSP 那几例是浏览器 innerHTML 的序列化形式。
  assert.equal(await htmlToMarkdown('<blockquote></blockquote>'), '>');
  assert.equal(await htmlToMarkdown('<blockquote>\n</blockquote>'), '>');
  assert.equal(await htmlToMarkdown('<blockquote>&nbsp;</blockquote>'), '>');
  assert.equal(await htmlToMarkdown('<h1></h1>'), '#');
  assert.equal(await htmlToMarkdown('<h2>&nbsp;</h2>'), '##');
  assert.equal(await htmlToMarkdown('<ul>\n<li></li>\n</ul>'), '-');
  assert.equal(await htmlToMarkdown('<ul>\n<li>&nbsp;</li>\n</ul>'), '-');
  assert.equal(await htmlToMarkdown('<pre><code>&nbsp;</code></pre>'), '```\n\n```');
});

test('wysiwyg normalizes list spacing after quote prefixes too', async () => {
  assert.equal(await htmlToMarkdown('<blockquote>\n<ul>\n<li><input disabled="" type="checkbox"> a</li>\n</ul>\n</blockquote>'), '> - [ ] a');
  assert.equal(await htmlToMarkdown('<blockquote>\n<ul>\n<li>a</li>\n</ul>\n</blockquote>'), '> - a');
});

test('wysiwyg restores hand-typed task markers escaped by turndown', async () => {
  // 可视区里手打的任务列表，方括号是普通文本，turndown 会转义成 `\[ \]`；
  // 但 `- [ ] a` 在 Markdown 里就是任务列表，必须还原（否则手打待办永远只是普通列表）。
  assert.equal(await htmlToMarkdown('<ul>\n<li>[ ] abc</li>\n</ul>'), '- [ ] abc');
  assert.equal(await htmlToMarkdown('<ul>\n<li>[x] abc</li>\n</ul>'), '- [x] abc');
  assert.equal(await htmlToMarkdown('<blockquote>\n<ul>\n<li>[ ] a</li>\n</ul>\n</blockquote>'), '> - [ ] a');
  // 不在行首、或方括号后没有空格的，属于普通文本，保持转义。
  assert.equal(await htmlToMarkdown('<ul>\n<li>a [ ] b</li>\n</ul>'), '- a \\[ \\] b');
  assert.equal(await htmlToMarkdown('<ul>\n<li>[x]abcd</li>\n</ul>'), '- \\[x\\]abcd');
});

test('wysiwyg restores pasted task lists whose bullet turndown escaped too', async () => {
  // 把纯文本任务列表粘贴进列表块：浏览器把每行插成列表项，turndown 再对列表项内容整体转义，
  // 行首于是变成 `- \- \[ \] one`（真列表符号 + 转义后的字面列表符号 + 转义方括号）。
  assert.equal(
    await htmlToMarkdown('<ul>\n<li>- [ ] one</li>\n<li>- [x] two</li>\n</ul>'),
    '- [ ] one\n- [x] two',
  );
  assert.equal(await htmlToMarkdown('<ol>\n<li>- [ ] ordered</li>\n</ol>'), '1. [ ] ordered');
  assert.equal(
    await htmlToMarkdown('<blockquote>\n<ul>\n<li>- [x] quoted</li>\n</ul>\n</blockquote>'),
    '> - [x] quoted',
  );
});
