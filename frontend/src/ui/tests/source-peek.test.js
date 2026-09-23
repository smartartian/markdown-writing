import test from 'node:test';
import assert from 'node:assert/strict';
import { canPeekBlock, createSourcePeek, hasSourcePeekChange } from '../source-peek.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this.attributes = new Map();
    this.listeners = new Map();
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }

  click() {
    this.dispatch('click');
  }

  focus() {}

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
}

function installFakeDom() {
  const body = new FakeElement('body');
  global.document = {
    body,
    createElement: tagName => new FakeElement(tagName),
  };
  global.requestAnimationFrame = callback => callback();
  return body;
}

function findClass(root, className) {
  if (root.className.split(' ').includes(className)) return root;
  for (const child of root.children) {
    const found = findClass(child, className);
    if (found) return found;
  }
  return null;
}

test('canPeekBlock excludes code and raw blocks', () => {
  assert.equal(canPeekBlock('paragraph'), true);
  assert.equal(canPeekBlock('table'), true);
  assert.equal(canPeekBlock('divider'), true);
  assert.equal(canPeekBlock('code'), false);
  assert.equal(canPeekBlock('raw'), false);
});

test('unchanged source does not call onApply', () => {
  const body = installFakeDom();
  let applyCalls = 0;
  const peek = createSourcePeek({ onApply: () => { applyCalls += 1; } });
  peek.open('block-1', { raw: '| a |', type: 'table' });
  findClass(body.children[0], 'source-peek-apply').click();
  assert.equal(applyCalls, 0);
  assert.equal(peek.isOpen(), false);
  delete global.document;
  delete global.requestAnimationFrame;
});

test('changed source applies the block id and raw exactly once', () => {
  const body = installFakeDom();
  const applied = [];
  const peek = createSourcePeek({ onApply: (blockId, raw) => applied.push([blockId, raw]) });
  peek.open('block-2', { raw: '# old', type: 'heading' });
  const editor = findClass(body.children[0], 'source-peek-editor');
  editor.value = '# new';
  findClass(body.children[0], 'source-peek-apply').click();
  assert.deepEqual(applied, [['block-2', '# new']]);
  assert.equal(hasSourcePeekChange('# old', '# new'), true);
  assert.equal(peek.isOpen(), false);
  delete global.document;
  delete global.requestAnimationFrame;
});
