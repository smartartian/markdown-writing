import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKDOWN_SANITIZE_CONFIG,
  hardenSanitizedInput,
  sanitizeMarkdownHtml,
} from '../../markdown/sanitizer.js';

function fakeInput(attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  return {
    tagName: 'INPUT',
    attrs,
    removed: false,
    getAttribute: name => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, value) => attrs.set(name, String(value)),
    removeAttribute: name => attrs.delete(name),
    remove() { this.removed = true; },
  };
}

function fakePurify() {
  return {
    sanitize: html => String(html ?? ''),
    installedHooks: [],
    addHook(name) { this.installedHooks.push(name); },
  };
}

test('sanitizer keeps GFM task list checkboxes but strips other form controls', () => {
  // 回归：'input' 曾被整体放进 FORBID_TAGS，任务列表勾选框被剥掉后
  // 可视区看不到勾选框，HTML→Markdown 反推还会把 `- [ ] abc` 退化成 `- abc`。
  assert.equal(MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS.includes('input'), false);
  for (const tag of ['form', 'button', 'textarea', 'select', 'script']) {
    assert.equal(MARKDOWN_SANITIZE_CONFIG.FORBID_TAGS.includes(tag), true);
  }

  const checkbox = fakeInput({ type: 'checkbox', checked: '', disabled: '' });
  assert.equal(hardenSanitizedInput(checkbox), true);
  assert.equal(checkbox.removed, false);
  assert.equal(checkbox.attrs.get('disabled'), '');

  const textInput = fakeInput({ type: 'text' });
  assert.equal(hardenSanitizedInput(textInput), false);
  assert.equal(textInput.removed, true);
});

test('sanitizer hardens checkboxes instead of leaving submittable fields', () => {
  const checkbox = fakeInput({
    type: 'CheckBox',
    name: 'todo',
    value: '1',
    form: 'f',
    formaction: '/submit',
    autofocus: '',
    tabindex: '0',
  });

  assert.equal(hardenSanitizedInput(checkbox), true);
  for (const attr of ['name', 'value', 'form', 'formaction', 'autofocus', 'tabindex']) {
    assert.equal(checkbox.attrs.has(attr), false, `${attr} 应该被摘掉`);
  }
  assert.equal(checkbox.attrs.get('disabled'), '');
});

test('sanitizer leaves non-input nodes alone', () => {
  const span = { tagName: 'SPAN', remove() { throw new Error('不该被移除'); } };
  assert.equal(hardenSanitizedInput(span), true);
  assert.equal(hardenSanitizedInput(null), true);
});

test('sanitizer installs hooks once per purifier instance', () => {
  const first = fakePurify();
  sanitizeMarkdownHtml('<p>x</p>', first);
  sanitizeMarkdownHtml('<p>y</p>', first);
  assert.deepEqual(first.installedHooks, ['afterSanitizeElements', 'afterSanitizeAttributes']);

  const second = fakePurify();
  sanitizeMarkdownHtml('<p>z</p>', second);
  assert.deepEqual(second.installedHooks, ['afterSanitizeElements', 'afterSanitizeAttributes']);
});
