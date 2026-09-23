import { hasRichMarkup } from './wysiwyg.js';

/**
 * 决定一次粘贴应该「按纯文本直接写入模型」还是「交给浏览器插入后再由 HTML→Markdown 反推」。
 *
 * 背景：浏览器把纯文本里的每个换行都拆成独立 <p>，而反推阶段走 innerText 时块级元素
 * 会渲染成双换行，导致空行被放大（n 个换行 → 3n-1）；更糟的是富文本反推一旦失败，
 * 内容会只留在 DOM 而不进模型。因此只要剪贴板里没有值得保留的标记，就以纯文本为准。
 *
 * @returns {{nextRaw: string, caret: number} | null} null 表示走浏览器默认插入 + HTML 反推。
 */
export function planPaste({
  clipboardText = '',
  clipboardHtml = '',
  renderedHtml = '',
  blockType = '',
  offsets = null,
  raw = '',
} = {}) {
  if (!clipboardText) return null;
  if (hasRichMarkup(clipboardHtml)) return null;
  // 只有纯段落块的 DOM 文本才与 raw 一一对应，其它块型（标题/列表/引用/表格）前缀不同，不能按文本偏移拼接。
  if (blockType !== 'paragraph') return null;
  if (hasRichMarkup(renderedHtml)) return null;
  if (!offsets) return null;
  const { start = 0, end = start } = offsets;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > raw.length) {
    return null;
  }
  const nextRaw = raw.slice(0, start) + clipboardText + raw.slice(end);
  if (nextRaw === raw) return null;
  return { nextRaw, caret: start + clipboardText.length };
}
