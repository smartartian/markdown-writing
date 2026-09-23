import test from 'node:test';
import assert from 'node:assert/strict';

import { planPaste } from '../paste.js';

const base = {
  clipboardText: 'A\n\nB',
  clipboardHtml: '',
  renderedHtml: '<p><br></p>',
  blockType: 'paragraph',
  offsets: { start: 0, end: 0 },
  raw: '',
};

test('paste: plain multi-line text is written verbatim instead of being inflated', () => {
  // 回归：浏览器把每个换行拆成 <p>，反推 Markdown 时空行会从 2 个变成 5 个。必须原样落入模型。
  const plan = planPaste(base);
  assert.ok(plan, 'should take the plain-text path');
  assert.equal(plan.nextRaw, 'A\n\nB');
  assert.equal(plan.caret, 4);
});

test('paste: clipboard markup wins over plain text', () => {
  // 剪贴板里有值得保留的标记时，交给浏览器插入 + HTML→Markdown 反推
  assert.equal(planPaste({ ...base, clipboardHtml: '<p>a<strong>b</strong></p>' }), null);
  assert.equal(planPaste({ ...base, clipboardHtml: '<ul><li>x</li></ul>' }), null);
});

test('paste: non-paragraph blocks are left to the browser path', () => {
  // 标题/列表/引用/表格的 DOM 文本与 raw 前缀不同，不能按文本偏移拼接
  for (const blockType of ['heading', 'list', 'quote', 'table', 'code', 'raw']) {
    assert.equal(planPaste({ ...base, blockType }), null, `${blockType} should fall back`);
  }
});

test('paste: splices at the caret and replaces the selected range', () => {
  const middle = planPaste({ ...base, raw: 'HELLO', offsets: { start: 2, end: 2 }, clipboardText: 'X' });
  assert.equal(middle.nextRaw, 'HEXLLO');
  assert.equal(middle.caret, 3);

  const replaced = planPaste({ ...base, raw: 'HELLO', offsets: { start: 1, end: 4 }, clipboardText: 'yz' });
  assert.equal(replaced.nextRaw, 'HyzO');
  assert.equal(replaced.caret, 3);
});

test('paste: falls back when there is nothing to write', () => {
  assert.equal(planPaste({ ...base, clipboardText: '' }), null);
  assert.equal(planPaste({ ...base, offsets: null }), null);
  assert.equal(planPaste({ ...base, raw: 'same', offsets: { start: 0, end: 4 }, clipboardText: 'same' }), null);
});

test('paste: rejects offsets outside the block', () => {
  assert.equal(planPaste({ ...base, raw: 'AB', offsets: { start: 3, end: 3 } }), null);
  assert.equal(planPaste({ ...base, raw: 'AB', offsets: { start: 2, end: 1 } }), null);
  assert.equal(planPaste({ ...base, raw: 'AB', offsets: { start: -1, end: 0 } }), null);
});

test('paste: a rendered block that already has markup keeps the HTML path', () => {
  assert.equal(planPaste({ ...base, renderedHtml: '<p>a<strong>b</strong></p>' }), null);
});
