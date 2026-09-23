let converterPromise = null;

async function getConverter() {
  if (!converterPromise) {
    converterPromise = Promise.all([
      import('turndown'),
      import('turndown-plugin-gfm'),
    ]).then(([turndownModule, gfmModule]) => {
      const TurndownService = turndownModule.default;
      const converter = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
      });
      converter.use(gfmModule.gfm);
      converter.addRule('highlight', {
        filter: 'mark',
        replacement: content => `==${content}==`,
      });
      return converter;
    });
  }
  return converterPromise;
}

export async function htmlToMarkdown(html) {
  const converter = await getConverter();
  return converter
    .turndown(String(html || ''))
    .replace(/^([ \t]*(?:[-*+]|\d+\.)) {2,3}(?=\S)/gm, '$1 ')
    .replace(/\u200B/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export function getEditableTextOffset(root, node, offset) {
  if (!root || !node) return 0;
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch (error) {
    return 0;
  }
  return range.toString().replace(/\u200B/g, '').length;
}

export async function renderedHtmlToMarkdown(html, textContent) {
  const source = String(html || '');
  const hasRichMarkup = /<(?:strong|em|code|a|img|mark|del|ul|ol|li|blockquote|pre|table)\b/i.test(source);
  const isPlainParagraph = /^\s*<p(?:\s[^>]*)?>[\s\S]*<\/p>\s*$/i.test(source);
  if (isPlainParagraph && !hasRichMarkup) {
    return String(textContent || '').replace(/\u200B/g, '').trimEnd();
  }
  return htmlToMarkdown(source);
}
