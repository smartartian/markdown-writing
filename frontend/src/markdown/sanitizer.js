import DOMPurify from 'dompurify';

// 注意 FORBID_TAGS 里没有 'input'：GFM 任务列表的勾选框就是 <input type=checkbox disabled>，
// 一旦剥掉，可视区既看不到勾选框，HTML→Markdown 反推时也会把 `- [ ] abc` 退化成 `- abc`（模型被改脏）。
// 表单控件的封禁意图改由 afterSanitizeElements 钩子里的白名单实现（见 hardenSanitizedInput）。
export const MARKDOWN_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'textarea', 'select', 'button'],
  FORBID_ATTR: ['srcdoc', 'style'],
  ALLOW_DATA_ATTR: true,
};

const hookedPurifiers = new WeakSet();

export function normalizeMarkdownImageWidth(value) {
  const match = /^(\d{1,3})%$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const percent = Number(match[1]);
  return percent >= 1 && percent <= 100 ? `${percent}%` : '';
}

// Markdown 里唯一允许保留的表单控件是任务列表勾选框。白名单之外一律移除；
// 放行的勾选框也要摘掉表单相关属性并强制 disabled，保证渲染结果只是只读勾选框。
export function hardenSanitizedInput(node) {
  if (!node || node.tagName !== 'INPUT') return true;
  if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
    node.remove();
    return false;
  }
  for (const attr of ['name', 'value', 'form', 'formaction', 'autofocus', 'tabindex']) {
    node.removeAttribute(attr);
  }
  node.setAttribute('disabled', '');
  return true;
}

function installHooks(purify) {
  if (hookedPurifiers.has(purify)) return;
  purify.addHook('afterSanitizeElements', (node) => {
    hardenSanitizedInput(node);
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer');
      if (node.getAttribute('target') === '_blank') {
        node.setAttribute('target', '_blank');
      }
    }
    if (node.tagName === 'IMG') {
      const width = normalizeMarkdownImageWidth(node.getAttribute('data-md-width'));
      if (width) {
        node.setAttribute('style', `width:${width};max-width:100%;`);
      }
      node.removeAttribute('data-md-width');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
  hookedPurifiers.add(purify);
}

export function sanitizeMarkdownHtml(html, purify = DOMPurify) {
  installHooks(purify);
  return purify.sanitize(html || '', MARKDOWN_SANITIZE_CONFIG);
}
