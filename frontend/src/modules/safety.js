export function createSafetyModule({
  state,
  storage,
  escapeHtml,
  lucideIcons,
  getCurrentMd,
  onContentRestored,
}) {
  let modalElement = null;

  function closeModal() {
    modalElement?.remove();
    modalElement = null;
  }

  function createModal({ title, description, body, actions, onDismiss = null }) {
    closeModal();
    modalElement = document.createElement('div');
    modalElement.className = 'safety-modal-backdrop';
    modalElement.innerHTML = `
      <section class="safety-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="safety-modal-header">
          <div>
            <h2>${escapeHtml(title)}</h2>
            <p>${escapeHtml(description)}</p>
          </div>
          <button class="safety-modal-close" type="button" aria-label="关闭">
            <i data-lucide="x"></i>
          </button>
        </header>
        <div class="safety-modal-body">${body}</div>
        <footer class="safety-modal-actions"></footer>
      </section>
    `;
    document.body.appendChild(modalElement);
    const footer = modalElement.querySelector('.safety-modal-actions');
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.primary ? 'btn-primary' : 'btn-secondary';
      button.textContent = action.label;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await action.run();
          closeModal();
        } finally {
          button.disabled = false;
        }
      });
      footer.appendChild(button);
    }
    // 关闭按钮 / 点遮罩 = 放弃本次选择，需要通知调用方（例如"关闭时保存"提示按取消处理）。
    const dismiss = () => {
      closeModal();
      onDismiss?.();
    };
    modalElement.querySelector('.safety-modal-close')?.addEventListener('click', dismiss);
    modalElement.addEventListener('click', event => {
      if (event.target === modalElement) dismiss();
    });
    lucideIcons();
  }

  async function persistRecoverySnapshot() {
    if (!state.currentDoc || !state.isDirty) return;
    const payload = JSON.stringify({
      currentDoc: state.currentDoc,
      content: getCurrentMd(),
      persistedContent: state.persistedContent,
      modelVersion: state.editorSession?.document?.version || 0,
      transactionID: state.editorSession?.lastTransactionId || 0,
      savedAt: new Date().toISOString(),
    });
    try {
      await storage.saveRecoveryState(payload);
    } catch (error) {
      // Recovery persistence should not interrupt typing.
    }
  }

  async function clearRecoverySnapshot() {
    try {
      await storage.clearRecoveryState();
    } catch (error) {
      // Ignore recovery cleanup failures.
    }
  }

  async function offerCrashRecovery() {
    let raw = '';
    try {
      raw = await storage.loadRecoveryState();
    } catch (error) {
      return false;
    }
    if (!raw) return false;
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (error) {
      await clearRecoverySnapshot();
      return false;
    }

    return new Promise(resolve => {
      createModal({
        title: '检测到未保存的写作内容',
        description: '应用上次退出时可能存在未正常保存的内容。',
        body: `
          <dl class="safety-snapshot">
            <div><dt>文档</dt><dd>${escapeHtml(snapshot.currentDoc?.name || '未命名.md')}</dd></div>
            <div><dt>保存时间</dt><dd>${escapeHtml(snapshot.savedAt || '未知')}</dd></div>
          </dl>
        `,
        actions: [
          {
            label: '丢弃恢复内容',
            run: async () => {
              await clearRecoverySnapshot();
              resolve(false);
            },
          },
          {
            label: '恢复未保存内容',
            primary: true,
            run: async () => {
              await onContentRestored(snapshot);
              await clearRecoverySnapshot();
              resolve(true);
            },
          },
        ],
      });
    });
  }

  // 关闭应用时还有未保存的修改：让用户选择保存还是放弃（没有修改时不会走到这里）。
  function confirmUnsavedChanges(name = '') {
    const fileName = name || '未命名.md';
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      createModal({
        title: '有未保存的修改',
        description: `「${fileName}」在关闭前还有未保存的修改。`,
        body: '<p>选择「保存」会把改动写入文件；选择「放弃修改」将丢弃这次的改动。</p>',
        actions: [
          { label: '取消', run: async () => finish('cancel') },
          { label: '放弃修改', run: async () => finish('discard') },
          { label: '保存', primary: true, run: async () => finish('save') },
        ],
        onDismiss: () => finish('cancel'),
      });
    });
  }

  return {
    persistRecoverySnapshot,
    clearRecoverySnapshot,
    confirmUnsavedChanges,
    offerCrashRecovery,
  };
}
