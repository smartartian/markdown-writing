export function canPeekBlock(type) {
  return type !== 'code' && type !== 'raw';
}

export function hasSourcePeekChange(originalRaw, nextRaw) {
  return String(originalRaw ?? '') !== String(nextRaw ?? '');
}

export function createSourcePeek({ onApply, onOpenChange, labels = {} }) {
  let root = null;
  let textarea = null;
  let blockId = null;
  let originalRaw = '';
  let composing = false;

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    textarea = null;
    blockId = null;
    originalRaw = '';
    composing = false;
    onOpenChange?.(false);
  }

  function apply() {
    if (!textarea || !blockId) return;
    if (composing || textarea.getAttribute('aria-composing') === 'true') return;
    const nextRaw = textarea.value;
    if (hasSourcePeekChange(originalRaw, nextRaw)) onApply?.(blockId, nextRaw);
    close();
  }

  function open(nextBlockId, { raw = '', type = 'paragraph' } = {}) {
    close();
    blockId = nextBlockId;
    originalRaw = String(raw ?? '');

    root = document.createElement('div');
    root.className = 'source-peek-backdrop';
    root.setAttribute('role', 'presentation');

    const panel = document.createElement('section');
    panel.className = 'source-peek';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', labels.title || '块源码精修');

    const header = document.createElement('header');
    header.className = 'source-peek-header';
    const title = document.createElement('strong');
    title.className = 'source-peek-title';
    title.textContent = labels.title || '块源码精修';
    const typeLabel = document.createElement('span');
    typeLabel.className = 'source-peek-type';
    typeLabel.textContent = type;
    header.append(title, typeLabel);

    const actions = document.createElement('div');
    actions.className = 'source-peek-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn-secondary source-peek-cancel';
    cancelButton.textContent = labels.cancel || '取消';
    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'btn-primary source-peek-apply';
    applyButton.textContent = labels.apply || '应用';
    actions.append(cancelButton, applyButton);
    header.append(actions);

    textarea = document.createElement('textarea');
    textarea.className = 'source-peek-editor';
    textarea.value = originalRaw;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', labels.editorLabel || '当前块 Markdown 源码');
    textarea.addEventListener('compositionstart', () => {
      composing = true;
      textarea.setAttribute('aria-composing', 'true');
    });
    textarea.addEventListener('compositionend', () => {
      composing = false;
      textarea.setAttribute('aria-composing', 'false');
    });
    textarea.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (composing || event.isComposing) return;
        event.preventDefault();
        apply();
      }
    });

    const footer = document.createElement('div');
    footer.className = 'source-peek-footer';
    footer.textContent = labels.hint || 'Cmd/Ctrl+Enter 应用 · Esc 取消';

    panel.append(header, textarea, footer);
    root.append(panel);
    root.addEventListener('click', event => {
      if (event.target === root) close();
    });
    cancelButton.addEventListener('click', close);
    applyButton.addEventListener('click', apply);
    document.body.append(root);
    requestAnimationFrame(() => textarea?.focus());
    onOpenChange?.(true);
  }

  return {
    open,
    close,
    isOpen: () => Boolean(root),
    destroy: close,
  };
}
