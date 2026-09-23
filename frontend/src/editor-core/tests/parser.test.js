import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_TYPES,
  INLINE_TYPES,
  inferBlockType,
  parseInline,
  parseMarkdown,
  serializeDocument,
  serializeInline,
} from '../index.js';

const fixtures = [
  '# Heading\n\nParagraph text.\n',
  '- parent\n    - child\n        - grandchild\n',
  '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
  '```js\nconst value = 1;\n```\n',
  '> quote\n>\n> second paragraph\n',
  '<img src="x" onerror="test">\n',
  'line one\r\nline two\r\n',
];

test('parser/serializer: golden fixtures round-trip exactly', () => {
  for (const fixture of fixtures) {
    const document = parseMarkdown(fixture);
    assert.equal(serializeDocument(document), fixture, `fixture failed: ${JSON.stringify(fixture)}`);
    assert.equal(document.blocks.map(block => block.raw).join(''), fixture);
  }
});

test('parser: recognizes top-level block types', () => {
  assert.equal(parseMarkdown('# Heading').blocks[0].type, BLOCK_TYPES.HEADING);
  assert.equal(parseMarkdown('text').blocks[0].type, BLOCK_TYPES.PARAGRAPH);
  assert.equal(parseMarkdown('> quote').blocks[0].type, BLOCK_TYPES.QUOTE);
  assert.equal(parseMarkdown('- item').blocks[0].type, BLOCK_TYPES.LIST);
  assert.equal(parseMarkdown('```\ncode\n```').blocks[0].type, BLOCK_TYPES.CODE);
  assert.equal(parseMarkdown('---').blocks[0].type, BLOCK_TYPES.DIVIDER);
  assert.equal(parseMarkdown('| A |\n| --- |\n| 1 |').blocks[0].type, BLOCK_TYPES.TABLE);
});

test('parser: model type inference agrees with the parser on tables', () => {
  // 表格要「表头行 + 分隔行」两行才算数。模型层（inferBlockType）漏判多行表格时，
  // 粘贴表格后 replaceBlock 会把类型留在 paragraph，可视区就不会重渲染，页面停在外来 HTML 上。
  const table = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(inferBlockType(table), BLOCK_TYPES.TABLE);
  assert.equal(parseMarkdown(table).blocks[0].type, BLOCK_TYPES.TABLE);

  // 单行竖线文本不是表格（没有分隔行），模型层也不能误判成 table。
  assert.equal(inferBlockType('| A | B |'), BLOCK_TYPES.PARAGRAPH);
  assert.equal(parseMarkdown('| A | B |').blocks[0].type, BLOCK_TYPES.PARAGRAPH);

  // 分隔行的对齐写法
  assert.equal(inferBlockType('| A | B |\n|:---:|---:|'), BLOCK_TYPES.TABLE);
  assert.equal(parseMarkdown('| A | B |\n|:---:|---:|').blocks[0].type, BLOCK_TYPES.TABLE);
});

test('parser: nested lists stay in one list block', () => {
  const document = parseMarkdown('- parent\n    - child\n        - grandchild\n');
  assert.equal(document.blocks.length, 1);
  assert.equal(document.blocks[0].type, BLOCK_TYPES.LIST);
  assert.equal(document.blocks[0].raw, '- parent\n    - child\n        - grandchild\n');
});

test('parser: heading children contain inline nodes', () => {
  const heading = parseMarkdown('# **bold** title').blocks[0];
  assert.equal(heading.children[0].type, INLINE_TYPES.STRONG);
  assert.equal(heading.children[0].children[0].text, 'bold');
});

test('inline parser: handles common inline Markdown', () => {
  const nodes = parseInline('**strong** *emphasis* `code` [link](https://example.com)');
  assert.deepEqual(nodes.map(node => node.type), [
    INLINE_TYPES.STRONG,
    INLINE_TYPES.TEXT,
    INLINE_TYPES.EMPHASIS,
    INLINE_TYPES.TEXT,
    INLINE_TYPES.CODE,
    INLINE_TYPES.TEXT,
    INLINE_TYPES.LINK,
  ]);
});

test('inline parser: uses the ==highlight== marker shared with the renderer', () => {
  const nodes = parseInline('a ==marked== b');
  assert.deepEqual(nodes.map(node => node.type), [
    INLINE_TYPES.TEXT,
    INLINE_TYPES.MARK,
    INLINE_TYPES.TEXT,
  ]);
  assert.equal(nodes[1].children[0].text, 'marked');
  // ::old:: 不再是标记，按普通文本处理
  assert.deepEqual(parseInline('::old::').map(node => node.type), [INLINE_TYPES.TEXT]);
});

test('inline serializer: writes GFM-style ==highlight==', () => {
  const [node] = parseInline('==marked==');
  assert.equal(serializeInline([node]), '==marked==');
});
