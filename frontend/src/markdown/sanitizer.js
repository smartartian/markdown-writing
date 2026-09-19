import DOMPurify from 'dompurify';

export const MARKDOWN_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
  FORBID_ATTR: ['srcdoc', 'style'],
  ALLOW_DATA_ATTR: true,
};

let hooksInstalled = false;

export function normalizeMarkdownImageWidth(value) {
  const match = /^(\d{1,3})%$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const percent = Number(match[1]);
  return percent >= 1 && percent <= 100 ? `${percent}%` : '';
}

function installHooks(purify) {
  if (hooksInstalled) return;
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
  hooksInstalled = true;
}

export function sanitizeMarkdownHtml(html, purify = DOMPurify) {
  installHooks(purify);
  return purify.sanitize(html || '', MARKDOWN_SANITIZE_CONFIG);
}
