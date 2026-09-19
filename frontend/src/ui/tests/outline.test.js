import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOutlineTree,
  headingsFromDocument,
  headingsFromMarkdown,
  renderOutlineTree,
} from '../outline.js';

test('outline reads headings from the editor document model', () => {
  const headings = headingsFromDocument({
    blocks: [
      { id: 'p1', type: 'paragraph', raw: 'text', attrs: {} },
      { id: 'h1', type: 'heading', raw: '# Title', attrs: { level: 1 } },
      { id: 'h2', type: 'heading', raw: '## Child', attrs: { level: 2 } },
    ],
  });

  assert.deepEqual(headings.map(item => [item.text, item.level, item.blockIndex]), [
    ['Title', 1, 1],
    ['Child', 2, 2],
  ]);
});

test('outline builds parent-child hierarchy', () => {
  const tree = buildOutlineTree([
    { id: 'h1', level: 1, text: 'A', blockIndex: 0 },
    { id: 'h2', level: 2, text: 'A1', blockIndex: 1 },
    { id: 'h3', level: 3, text: 'A11', blockIndex: 2 },
    { id: 'h4', level: 2, text: 'A2', blockIndex: 3 },
    { id: 'h5', level: 1, text: 'B', blockIndex: 4 },
  ]);

  assert.equal(tree.length, 2);
  assert.equal(tree[0].children.length, 2);
  assert.equal(tree[0].children[0].children[0].text, 'A11');
  assert.equal(tree[1].text, 'B');
});

test('outline markdown fallback ignores fenced code headings', () => {
  const headings = headingsFromMarkdown('# Title\n```\n# Not heading\n```\n## Child');
  assert.deepEqual(headings.map(item => item.text), ['Title', 'Child']);
});

test('outline renderer emits hierarchy and collapse state', () => {
  const tree = buildOutlineTree([
    { id: 'h1', level: 1, text: 'Parent', blockIndex: 0 },
    { id: 'h2', level: 2, text: 'Child', blockIndex: 1 },
  ]);
  const html = renderOutlineTree(tree, { collapsedKeys: new Set([tree[0].key]) });

  assert.match(html, /outline-children/);
  assert.match(html, /outline-node collapsed/);
  assert.match(html, /H2/);
});
