export function createSafetyModule({
  state,
  storage,
  escapeHtml,
  lucideIcons,
  getCurrentMd,
  onReloadDocument,
  onKeepLocalVersion,
  onSaveCopy,
  onContentRestored,
  onWorkspaceChanged,
  getWatcherInterval = () => 3000,
}) {
  let watcherTimer = null;
  let modalElement = null;

  function closeModal() {
    modalElement?.remove();
    modalElement = null;
  }

  function createModal({ title, description, body, actions }) {
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
    modalElement.querySelector('.safety-modal-close')?.addEventListener('click', closeModal);
    modalElement.addEventListener('click', event => {
      if (event.target === modalElement) closeModal();
    });
    lucideIcons();
  }

  function stopFileWatcher() {
    if (watcherTimer) clearTimeout(watcherTimer);
    watcherTimer = null;
  }

  function startFileWatcher(path) {
    stopFileWatcher();
    if (!path) return;
    const check = async () => {
      if (!state.currentDoc?.path || state.currentDoc.path !== path) return;
      if (Date.now() < state.ignoreWatcherUntil) return;
      try {
        const meta = await storage.readDocumentWithMeta(path);
        if (!meta) {
          showExternalChangeDialog({ path, missing: true });
          return;
        }
        if (meta.revision !== state.currentRevision || meta.contentHash !== state.currentHash) {
          showExternalChangeDialog(meta);
        }
      } catch (error) {
        showExternalChangeDialog({ path, missing: true, error });
      }
    };
    const loop = async () => {
      await check();
      if (state.currentDoc?.path === path) {
        watcherTimer = setTimeout(loop, Math.max(500, Number(getWatcherInterval()) || 3000));
      }
    };
    watcherTimer = setTimeout(loop, Math.max(500, Number(getWatcherInterval()) || 3000));
  }

  function showExternalChangeDialog(meta) {
    if (modalElement?.dataset.kind === 'external-change') return;
    const description = meta.missing
      ? '当前文件已被移动或删除。可以重新载入、把当前内容另存，或继续保留本地草稿。'
      : '文件在应用外发生了变化。选择如何处理本地版本与磁盘版本。';
    createModal({
      title: '文件已被外部修改',
      description,
      body: `<p class="safety-note">${escapeHtml(state.currentDoc?.path || meta.path || '')}</p>`,
      actions: [
        {
          label: '重新载入磁盘版本',
          run: async () => {
            if (meta.missing) return;
            await onReloadDocument(meta);
          },
        },
        {
          label: '另存本地副本',
          run: async () => onSaveCopy(),
        },
        {
          label: '保留本地并覆盖',
          primary: true,
          run: async () => {
            if (!meta.missing) await onKeepLocalVersion(meta);
            else await onSaveCopy();
          },
        },
      ],
    });
    modalElement.dataset.kind = 'external-change';
  }

  async function persistRecoverySnapshot() {
    if (!state.currentDoc || !state.isDirty) return;
    const payload = JSON.stringify({
      currentDoc: state.currentDoc,
      content: getCurrentMd(),
      revision: state.currentRevision,
      contentHash: state.currentHash,
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

  async function openHistory() {
    const doc = state.currentDoc;
    if (!doc) return;
    let versions = [];
    if (doc.path) {
      versions = await storage.listFileVersions(doc.path, 50);
    }
    const body = versions.length
      ? `<div class="version-list">${versions.map(version => `
          <article class="version-item">
            <div>
              <strong>版本 ${version.revision}</strong>
              <span>${escapeHtml(version.createdAt || '')}</span>
              <p>${escapeHtml((version.content || '').slice(0, 180))}</p>
            </div>
            <button class="btn-secondary restore-version" data-version-id="${version.id}" type="button">恢复</button>
          </article>
        `).join('')}</div>`
      : '<p class="safety-empty">还没有可恢复的历史版本。</p>';
    createModal({
      title: '版本历史',
      description: `保留最近 50 个自动保存快照 · ${doc.name}`,
      body,
      actions: [],
    });
    modalElement.querySelectorAll('.restore-version').forEach(button => {
      button.addEventListener('click', async () => {
        const versionID = Number(button.dataset.versionId);
        const version = versions.find(item => item.id === versionID);
        if (!version) return;
        button.disabled = true;
        try {
          let revision;
          let contentHash = state.currentHash;
          if (doc.path) {
            revision = await storage.restoreFileVersion(doc.path, versionID, state.currentRevision, state.currentHash);
            const meta = await storage.readDocumentWithMeta(doc.path);
            contentHash = meta?.contentHash || contentHash;
          } else {
            throw new Error('当前文档尚未保存到本地文件');
          }
          await onContentRestored({
            currentDoc: doc,
            content: version.content,
            revision,
            contentHash,
          });
          closeModal();
        } catch (error) {
          alert(`恢复失败：${error.message || error}`);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function openRecycleBin() {
    const items = await storage.listRecycleBin(100);
    const body = items.length
      ? `<div class="version-list">${items.map(item => `
          <article class="version-item">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.deletedAt || '')}</span>
              <p>${escapeHtml(item.originalPath)}</p>
            </div>
            <div class="recycle-actions">
              <button class="btn-secondary recycle-restore" data-id="${item.id}" type="button">恢复</button>
              <button class="btn-secondary recycle-purge" data-id="${item.id}" type="button">永久删除</button>
            </div>
          </article>
        `).join('')}</div>`
      : '<p class="safety-empty">回收站为空。</p>';
    createModal({
      title: '回收站',
      description: '删除的文档会先进入回收站，确认后再永久清理。',
      body,
      actions: [],
    });
    modalElement.querySelectorAll('.recycle-restore').forEach(button => {
      button.addEventListener('click', async () => {
        await storage.restoreRecycleItem(Number(button.dataset.id));
        closeModal();
        await onWorkspaceChanged();
      });
    });
    modalElement.querySelectorAll('.recycle-purge').forEach(button => {
      button.addEventListener('click', async () => {
        if (!confirm('永久删除后无法恢复，确定继续吗？')) return;
        await storage.purgeRecycleItem(Number(button.dataset.id));
        closeModal();
        await onWorkspaceChanged();
      });
    });
  }

  async function openRecycleBinPanel(container, { onClose = null } = {}) {
    if (!container) return;

    const render = async () => {
      const items = await storage.listRecycleBin(100);
      const body = items.length
        ? `<div class="version-list recycle-panel-list">${items.map(item => `
            <article class="version-item">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.deletedAt || '')}</span>
                <p>${escapeHtml(item.originalPath)}</p>
              </div>
              <div class="recycle-actions">
                <button class="btn-secondary recycle-panel-restore" data-id="${item.id}" type="button">恢复</button>
                <button class="btn-secondary recycle-panel-purge" data-id="${item.id}" type="button">永久删除</button>
              </div>
            </article>
          `).join('')}</div>`
        : `
          <div class="embedded-empty-state">
            <i data-lucide="trash-2"></i>
            <strong>回收站为空</strong>
            <span>删除的文档会先进入这里。</span>
          </div>
        `;

      container.innerHTML = `
        <div class="embedded-view recycle-view" id="recycle-view">
          <header class="embedded-view-header">
            <div>
              <span class="app-panel-kicker">RECYCLE BIN</span>
              <h1>回收站</h1>
              <p>删除的文档会先保留在这里，确认后再永久清理。</p>
            </div>
            <button class="embedded-view-close" type="button" data-recycle-close aria-label="关闭回收站">
              <i data-lucide="x"></i>
            </button>
          </header>
          <div class="embedded-view-body">${body}</div>
        </div>
      `;
      lucideIcons();

      container.querySelector('[data-recycle-close]')?.addEventListener('click', () => onClose?.());
      container.querySelectorAll('.recycle-panel-restore').forEach(button => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await storage.restoreRecycleItem(Number(button.dataset.id));
            await onWorkspaceChanged();
            return;
          } finally {
            button.disabled = false;
          }
        });
      });
      container.querySelectorAll('.recycle-panel-purge').forEach(button => {
        button.addEventListener('click', async () => {
          if (!confirm('永久删除后无法恢复，确定继续吗？')) return;
          button.disabled = true;
          try {
            await storage.purgeRecycleItem(Number(button.dataset.id));
            await render();
          } finally {
            button.disabled = false;
          }
        });
      });
    };

    await render();
  }

  return {
    startFileWatcher,
    stopFileWatcher,
    persistRecoverySnapshot,
    clearRecoverySnapshot,
    offerCrashRecovery,
    openHistory,
    openRecycleBin,
    openRecycleBinPanel,
    showExternalChangeDialog,
  };
}
