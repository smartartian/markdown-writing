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
      // turndown 默认把 del/strike/s 转成单个 ~，而 GFM 删除线是 ~~（本 app 的 toggleStrike 也用 ~~）。
      // 不修的话，粘贴带删除线的富文本会写出 ~文本~ 这种非法标记，重新打开后变成字面量。
      converter.addRule('strikethrough', {
        filter: ['del', 'strike', 's'],
        replacement: content => `~~${content}~~`,
      });
      return converter;
    });
  }
  return converterPromise;
}

// 手打的任务列表标记：可视区里的 `[ ]` 是普通文本，turndown 会把方括号转义成 `\[ \]`。
// Markdown 里 `- [ ] a` 就是任务列表（渲染层也这么认），所以行首这一处要还原成标记，
// 否则「手打待办」永远只是普通列表，源码模式里还会看到一串反斜杠。
// 粘贴纯文本任务列表时，turndown 会把列表项内容里的 `- ` 也转义成 `\- `，行首于是变成
// `- \- \[ \] one`：多出一层「转义过的列表符号」。所以列表符号（含转义写法）要吃到两层。
const ESCAPED_TASK_MARKER = /^((?:[ \t]*>)*[ \t]*\\?(?:[-*+]|\d+[.)])[ \t]+)(?:\\?(?:[-*+]|\d+[.)])[ \t]+)?\\\[([ xX])\\\][ \t]+/gm;

// 任务列表项：勾选框渲染成 <input type=checkbox>（marked 会在它后面留一个空格），
// turndown 的 gfm 规则又会补一个 "[ ] "，于是行首变成 `- [ ]  abc`。这里收成单个空格，
// 让「渲染 → 反推」与模型里的 `- [ ] abc` 完全一致，否则每次输入都会把块改脏。
// 行首可以是引用前缀（`> `）或缩进，嵌套列表也要收空格。
const TASK_LIST_SPACING = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])\s+\[[ xX]\])[ \t]+/gm;

// turndown 会把「只有空白」的节点当空白块整体丢掉，于是空的引用/列表项/标题/代码块反推后
// 什么都不剩：在可视区刚敲下 `>`，块重渲染成 <blockquote></blockquote> 再同步回模型时字符就没了。
// 这类容器先塞一个零宽空格占位（渲染层本来就用 ​ 表示空块），反推结束后统一去掉。
// 浏览器序列化 innerHTML 时会把 NBSP 写成 &nbsp; 实体，所以空白判定要连实体一起认。
const BLANK_INNER = '(?:\\s|&nbsp;|&#160;|&#xa0;)';
const EMPTY_BLOCK_CONTAINERS = [
  new RegExp(`(<li\\b[^>]*>)(${BLANK_INNER}*)(</li>)`, 'gi'),
  new RegExp(`(<blockquote\\b[^>]*>)(${BLANK_INNER}*)(</blockquote>)`, 'gi'),
  new RegExp(`(<h[1-6]\\b[^>]*>)(${BLANK_INNER}*)(</h[1-6]>)`, 'gi'),
  new RegExp(`(<pre\\b[^>]*>\\s*<code\\b[^>]*>)(${BLANK_INNER}*)(</code>\\s*</pre>)`, 'gi'),
];

function keepEmptyBlockContainers(html) {
  let output = String(html || '');
  for (const pattern of EMPTY_BLOCK_CONTAINERS) {
    output = output.replace(pattern, (match, open, inner, close) => `${open}\u200B${close}`);
  }
  return output;
}

export async function htmlToMarkdown(html) {
  const converter = await getConverter();
  return converter
    .turndown(keepEmptyBlockContainers(html))
    .replace(TASK_LIST_SPACING, '$1 ')
    .replace(/^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+\.)) {2,3}(?=\S)/gm, '$1 ')
    // 手打标记要在列表符号空格归一化之后处理，那时行首才是单空格。
    .replace(ESCAPED_TASK_MARKER, (match, prefix, state) => `${prefix.replace(/\\/g, '')}[${state.toLowerCase() === 'x' ? 'x' : ' '}] `)
    .replace(/\u200B/g, '')
    .replace(/\n(?:[ \t]*\n)+/g, '\n\n')
    .trimEnd();
}

// 渲染结果里块级标记之间的换行/缩进只是排版用（浏览器不渲染这些空白），
// 但 Range.toString() 会把它们算进文本：`<ul>\n<li>a</li>\n</ul>` 比可见文本多一个字符，
// 于是列表/引用块里的光标偏移整体错位，打字会插到行首。这里把这类节点统一判为「不是文本」，
// 保证「DOM 偏移 ↔ 模型偏移」在两种方向上都用同一把尺子。
const LAYOUT_CONTAINER_TAGS = new Set([
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'DIV',
]);

export function isLayoutWhitespaceNode(node) {
  if (!node || node.nodeType !== 3) return false;
  if (!/^[ \t\r\n]+$/.test(node.textContent || '')) return false;
  return LAYOUT_CONTAINER_TAGS.has(node.parentElement?.tagName || '');
}

const ZERO_WIDTH = /\u200B/g;

function layoutWhitespaceLength(range) {
  if (typeof range.cloneContents !== 'function') return 0;
  const walker = document.createTreeWalker(range.cloneContents(), NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isLayoutWhitespaceNode(node)) total += node.textContent.length;
  }
  return total;
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
  const text = range.toString().replace(ZERO_WIDTH, '');
  return Math.max(0, text.length - layoutWhitespaceLength(range));
}

// 与 getEditableTextOffset 同一把尺子的总长度（拆块、夹紧偏移都要用它，不能用 textContent.length）。
export function getRenderedTextLength(root) {
  if (!root) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isLayoutWhitespaceNode(node)) continue;
    total += (node.textContent || '').replace(ZERO_WIDTH, '').length;
  }
  return total;
}

// 可视区 DOM 里「值得保留的标记」判定，HTML→Markdown 与粘贴分流都用它。
// 必须包含 execCommand('bold'|'italic'|'strikeThrough') 生成的 b/i/strike：
// 漏掉它们会让含加粗的块被判为「纯段落」而走 innerText 快路径，标记被静默丢弃。
const RICH_MARKUP_PATTERN = /<(?:strong|em|b|i|u|s|strike|sub|sup|code|a|img|mark|del|ul|ol|li|blockquote|pre|table)\b/i;

export function hasRichMarkup(html) {
  return RICH_MARKUP_PATTERN.test(String(html || ''));
}

export async function renderedHtmlToMarkdown(html, textContent) {
  const source = String(html || '');
  const isPlainParagraph = /^\s*<p(?:\s[^>]*)?>[\s\S]*<\/p>\s*$/i.test(source);
  if (isPlainParagraph && !hasRichMarkup(source)) {
    return String(textContent || '').replace(/\u200B/g, '').trimEnd();
  }
  return htmlToMarkdown(source);
}
