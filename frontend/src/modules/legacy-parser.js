export function parseMarkdownBlocksLegacy(marked, md) {
  const source = md || '';
  let tokens = [];
  try {
    tokens = marked.lexer(source, { breaks: true, gfm: true });
  } catch (error) {
    console.warn('Markdown lexer failed:', error);
    return [{ type: 'paragraph', raw: source }];
  }

  const blocks = [];
  for (const token of tokens) {
    if (token.type === 'space') continue;
    let type = token.type;
    if (token.type === 'list') type = token.ordered ? 'olist' : 'ulist';
    if (token.type === 'heading') type = 'heading';
    blocks.push({
      type,
      raw: token.raw || '',
      level: token.depth,
      ordered: token.ordered,
    });
  }

  return blocks.length > 0 ? blocks : [{ type: 'paragraph', raw: '' }];
}
