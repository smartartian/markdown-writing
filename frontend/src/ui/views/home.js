import { brandHeroHtml } from '../brand.js';

export function createHomeView({
  getRoot,
  state,
  escapeHtml,
  qs,
  renderIcons,
  listRecentFiles,
  openDocumentFile,
  readDocumentWithMeta,
  addRecentFile,
  listDocuments,
  selectDocumentDir,
  openWorkspace,
  renderEditor,
  startFileWatcher,
  t = key => key,
}) {
  async function openPath(path) {
    const meta = await readDocumentWithMeta(path);
    const content = meta.content;
    const name = path.split('/').pop().replace(/\\/g, '/').split('/').pop();
    const dir = path.substring(0, path.lastIndexOf('/')) || '/';

    state.docDir = dir;
    state.currentDoc = { name, path, size: content.length, modTime: '' };
    state.currentContent = content;
    state.currentRevision = meta.revision || 0;
    state.currentHash = meta.contentHash || '';
    startFileWatcher(path);
    state.view = 'editor';

    try {
      await addRecentFile(path, name);
    } catch {}

    try {
      state.docs = (await listDocuments(dir) || []).filter(doc => doc.name.endsWith('.md') || doc.isDir);
    } catch {
      state.docs = [];
    }
    renderEditor();
  }

  async function render() {
    state.view = 'home';

    let recentFiles = [];
    try {
      recentFiles = await listRecentFiles(15) || [];
    } catch {}

    const recentHtml = recentFiles.length > 0
      ? recentFiles.map(file => `
        <button class="home-recent-item" data-path="${escapeHtml(file.path)}">
          <svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          <span class="home-recent-name">${escapeHtml(file.name)}</span>
          <span class="home-recent-path">${escapeHtml(file.path)}</span>
        </button>
      `).join('')
      : `<span class="home-recent-empty">${t('main.noRecent')}</span>`;

    getRoot().innerHTML = `
      <div class="home-shell app-shell-page">
        <div class="window-drag-bar"></div>
        <section class="app-panel home-launch-panel">
          <div class="app-panel-body home-launch-body">
            <div class="welcome-panel">
              <div class="welcome-panel-inner">
                ${brandHeroHtml()}
                <div class="welcome-panel-actions" id="home-actions-panel">
                  <button class="welcome-panel-btn" id="home-action-new-doc">
                    <svg data-lucide="file-plus" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                    <span>${t('main.newDoc')}</span>
                  </button>
                  <button class="welcome-panel-btn" id="home-action-open-file">
                    <svg data-lucide="file-up" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                    <span>${t('main.openFile')}</span>
                  </button>
                  <button class="welcome-panel-btn" id="home-action-open-folder">
                    <svg data-lucide="folder-open" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                    <span>${t('main.openFolder')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside class="app-panel home-sidebar home-recent-panel">
          <header class="app-panel-header">
            <div>
              <span class="app-panel-kicker">RECENT</span>
              <h2>${t('main.recent')}</h2>
              <p>${t('main.openFileHint')}</p>
            </div>
          </header>
          <div class="app-panel-body home-sidebar-inner">
            <div class="home-recent">
              <div class="home-recent-list" id="home-recent-list">${recentHtml}</div>
            </div>
          </div>
        </aside>
      </div>
    `;

    renderIcons();

    qs('#home-action-new-doc')?.addEventListener('click', () => {
      const title = prompt('文档标题', '无题');
      if (!title || !title.trim()) return;
      state.currentDoc = { id: null, name: title.trim() + '.md' };
      state.currentContent = `# ${title.trim()}\n\n`;
      state.currentRevision = 0;
      state.currentHash = '';
      state.isDirty = true;
      state.view = 'editor';
      renderEditor();
    });

    qs('#home-action-open-file')?.addEventListener('click', async () => {
      try {
        const path = await openDocumentFile();
        if (path) await openPath(path);
      } catch (error) {
        if (error?.message !== 'canceled') console.error(error);
      }
    });

    qs('#home-action-open-folder')?.addEventListener('click', async () => {
      try {
        const dir = await selectDocumentDir();
        if (dir) {
          state.docDir = dir;
          await openWorkspace();
        }
      } catch (error) {
        if (error?.message !== 'canceled') console.error(error);
      }
    });

    qs('#home-recent-list')?.addEventListener('click', async event => {
      const item = event.target.closest('.home-recent-item');
      if (!item) return;
      try {
        await openPath(item.dataset.path);
      } catch (error) {
        console.error('打开最近文件失败:', error);
      }
    });
  }

  return {
    render,
  };
}
