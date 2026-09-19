import test from 'node:test';
import assert from 'node:assert/strict';
import { debounce, escapeHtml, qs } from '../dom.js';

test('qs delegates to the provided query context', () => {
  const expected = { id: 'target' };
  const context = {
    querySelector(selector) {
      assert.equal(selector, '#target');
      return expected;
    },
  };

  assert.equal(qs('#target', context), expected);
});

test('escapeHtml escapes user text through a detached element', () => {
  let text = '';
  global.document = {
    createElement() {
      return {
        set textContent(value) {
          text = value;
        },
        get innerHTML() {
          return text
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;');
        },
      };
    },
  };

  assert.equal(escapeHtml('<b>Markdown</b>'), '&lt;b&gt;Markdown&lt;/b&gt;');
  delete global.document;
});

test('debounce runs only the latest call', async () => {
  const calls = [];
  const debounced = debounce(value => calls.push(value), 10);

  debounced('first');
  debounced('second');
  await new Promise(resolve => setTimeout(resolve, 25));

  assert.deepEqual(calls, ['second']);
});
