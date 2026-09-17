import { performance } from 'node:perf_hooks';
import { parseMarkdown } from '../src/editor-core/parser/block-parser.js';
import { serializeDocument } from '../src/editor-core/serializer/markdown-serializer.js';

const block = '# Heading\n\nParagraph with **bold** and [link](https://example.com).\n\n```js\nconst value = 1;\n```\n\n';
const source = block.repeat(1000);

global.gc?.();
const before = process.memoryUsage().heapUsed;
const start = performance.now();

const document = parseMarkdown(source);
const parsedAt = performance.now();
const output = serializeDocument(document);
const serializedAt = performance.now();

global.gc?.();
const after = process.memoryUsage().heapUsed;

console.log(JSON.stringify({
  characters: source.length,
  blocks: document.blocks.length,
  parseMs: Number((parsedAt - start).toFixed(2)),
  serializeMs: Number((serializedAt - parsedAt).toFixed(2)),
  exact: output === source,
  heapDeltaMB: Number(((after - before) / 1024 / 1024).toFixed(2)),
}, null, 2));
