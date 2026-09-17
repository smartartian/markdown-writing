import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompositionController,
} from '../index.js';

test('composition: commits Chinese input only after compositionend', () => {
  const commits = [];
  const controller = createCompositionController({
    onCommit: result => commits.push(result),
  });

  controller.start({ blockId: 'block-a', raw: '你好' });
  controller.update('世界');
  assert.equal(commits.length, 0);
  assert.equal(controller.isActive(), true);

  const result = controller.end({ raw: '你好世界' });
  assert.equal(controller.isActive(), false);
  assert.equal(commits.length, 1);
  assert.equal(result.changed, true);
  assert.equal(result.applied.document.toMarkdown(), '你好世界');
});

test('composition: supports Japanese, Korean, emoji and combining characters', () => {
  const fixtures = [
    ['こんにちは', 'こんにちは世界'],
    ['안녕', '안녕하세요'],
    ['hello ', 'hello 👩‍💻'],
    ['e', 'e\u0301'],
  ];

  for (const [beforeRaw, afterRaw] of fixtures) {
    const controller = createCompositionController();
    controller.start({ blockId: 'block-a', raw: beforeRaw });
    controller.update(afterRaw);
    const result = controller.end({ raw: afterRaw });
    assert.equal(result.applied.document.toMarkdown(), afterRaw);
  }
});

test('composition: cancel does not create a transaction', () => {
  let commits = 0;
  const controller = createCompositionController({
    onCommit: () => { commits += 1; },
  });
  controller.start({ blockId: 'block-a', raw: 'text' });
  controller.update('临时候选');
  const result = controller.cancel();
  assert.equal(result.cancelled, true);
  assert.equal(commits, 0);
  assert.equal(controller.isActive(), false);
});

test('composition: unchanged compositionend does not create a transaction', () => {
  let commits = 0;
  const controller = createCompositionController({
    onCommit: () => { commits += 1; },
  });
  controller.start({ blockId: 'block-a', raw: 'unchanged' });
  const result = controller.end({ raw: 'unchanged' });
  assert.equal(result.changed, false);
  assert.equal(result.transaction, null);
  assert.equal(commits, 0);
});
