import { parseMarkdown } from '../parser/block-parser.js';
import { serializeDocument } from '../serializer/markdown-serializer.js';

self.onmessage = event => {
  const { id, markdown } = event.data || {};
  try {
    const document = parseMarkdown(markdown || '');
    const output = serializeDocument(document);
    self.postMessage({
      id,
      ok: true,
      output,
      exact: output === (markdown || ''),
      blocks: document.blocks.length,
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error.message || String(error),
    });
  }
};
