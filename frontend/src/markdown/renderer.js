import { Marked, Renderer } from 'marked';
import { sanitizeMarkdownHtml } from './sanitizer.js';

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeImageWidth(value) {
  const match = /^(\d{1,3})%$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const percent = Number(match[1]);
  return percent >= 1 && percent <= 100 ? `${percent}%` : '';
}

const imageWidthExtension = {
  name: 'imageWidth',
  level: 'inline',
  start(source) {
    const index = source.indexOf('![');
    return index === -1 ? undefined : index;
  },
  tokenizer(source) {
    const match = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)\s*\{\s*width\s*=\s*["']?(\d{1,3})%["']?\s*\}/.exec(source);
    if (!match) return undefined;
    const width = normalizeImageWidth(`${match[4]}%`);
    if (!width) return undefined;
    return {
      type: 'imageWidth',
      raw: match[0],
      href: match[2],
      title: match[3] || '',
      text: match[1],
      width,
    };
  },
  renderer(token) {
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
    return `<img src="${escapeAttribute(token.href)}" alt="${escapeAttribute(token.text)}"${title} data-md-width="${token.width}">`;
  },
};

const highlightExtension = {
  name: 'highlight',
  level: 'inline',
  start(source) {
    return source.indexOf('==');
  },
  tokenizer(source) {
    const match = /^==([^=\n]+)==/.exec(source);
    if (!match) return undefined;
    return {
      type: 'highlight',
      raw: match[0],
      text: match[1],
      tokens: this.lexer.inlineTokens(match[1]),
    };
  },
  renderer(token) {
    return `<mark class="md-highlight">${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

function createMarkdownRendererInstance() {
  const renderer = new Renderer();

  renderer.table = function renderTable({ header, rows }) {
    const headerHtml = header.map(cell => this.tablecell(cell)).join('');
    const bodyHtml = rows
      .map(row => this.tablerow({ text: row.map(cell => this.tablecell(cell)).join('') }))
      .join('');

    return `<div class="md-table-wrap">
<table class="md-table">
<thead>
${headerHtml}</thead>
${bodyHtml ? `<tbody>
${bodyHtml}</tbody>
` : ''}</table>
</div>
`;
  };

  // GFM 任务列表勾选框：marked 默认产出 <input disabled type="checkbox">，
  // 这里只补一个类名供样式定位（反推回 Markdown 由 turndown 的 gfm 规则负责）。
  renderer.checkbox = function renderCheckbox({ checked }) {
    return `<input ${checked ? 'checked="" ' : ''}disabled="" type="checkbox" class="md-task"> `;
  };

  renderer.tablecell = function renderTableCell({ tokens, header, align }) {
    const tag = header ? 'th' : 'td';
    const scope = header ? ' scope="col"' : '';
    const alignment = align ? ` align="${align}"` : '';
    return `<${tag}${scope}${alignment}>${this.parser.parseInline(tokens)}</${tag}>
`;
  };

  return renderer;
}

export function createMarkdownRenderer({
  sanitize = sanitizeMarkdownHtml,
  options = {},
} = {}) {
  const renderer = createMarkdownRendererInstance();
  const marked = new Marked({
    breaks: true,
    gfm: true,
    ...options,
    renderer,
    extensions: [imageWidthExtension, highlightExtension, ...(options.extensions || [])],
  });

  function render(markdown, renderOptions = {}) {
    const html = marked.parse(String(markdown ?? ''), renderOptions);
    return sanitize(html);
  }

  return {
    marked,
    render,
  };
}
