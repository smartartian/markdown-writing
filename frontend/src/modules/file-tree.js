export function createFileTreeModule({
  state,
  storage,
  escapeHtml,
  fileNameWithoutExt,
  lucideIcons,
  openEditor,
  saveCurrentDoc,
  onCurrentDocumentDeleted,
  t = key => key,
}) {
  let dialogElement = null;
  let resolveDialog = null;

  function closeDialog(result = null) {
    dialogElement?.remove();
    dialogElement = null;
    const resolve = resolveDialog;
    resolveDialog = null;
    resolve?.(result);
  }

  function openTextDialog({
    title,
    description,
    value = '',
    placeholder = '',
    confirmLabel,
    danger = false,
    withInput = true,
  }) {
    closeDialog();
    return new Promise(resolve => {
      resolveDialog = resolve;
      dialogElement = document.createElement('div');
      dialogElement.className = 'safety-modal-backdrop file-tree-dialog-backdrop';
      dialogElement.innerHTML = `
        <section class="safety-modal file-tree-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <header class="safety-modal-header">
            <div>
              <h2>${escapeHtml(title)}</h2>
              <p>${escapeHtml(description)}</p>
            </div>
            <button class="safety-modal-close" type="button" data-dialog-cancel aria-label="${t('fileTree.cancel')}">
              <i data-lucide="x"></i>
            </button>
          </header>
          <div class="safety-modal-body">
            ${withInput ? `
              <label class="file-tree-dialog-field">
                <span>${escapeHtml(t('fileTree.fileName'))}</span>
                <input class="file-tree-dialog-input" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />
              </label>
            ` : ''}
          </div>
          <footer class="safety-modal-actions">
            <button class="btn-secondary" type="button" data-dialog-cancel>${t('fileTree.cancel')}</button>
            <button class="${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-dialog-confirm>${escapeHtml(confirmLabel)}</button>
          </footer>
        </section>
      `;
      document.body.appendChild(dialogElement);
      lucideIcons();

      const input = dialogElement.querySelector('.file-tree-dialog-input');
      const confirmButton = dialogElement.querySelector('[data-dialog-confirm]');
      const submit = () => {
        const nextValue = input?.value.trim() || '';
        if (!withInput) {
          closeDialog({ confirmed: true });
          return;
        }
        if (!nextValue) {
          input.focus();
          return;
        }
        closeDialog({ confirmed: true, value: nextValue });
      };
      const updateDisabled = () => {
        confirmButton.disabled = withInput && !input?.value.trim();
      };

      dialogElement.querySelectorAll('[data-dialog-cancel]').forEach(button => {
        button.addEventListener('click', () => closeDialog({ confirmed: false }));
      });
      confirmButton.addEventListener('click', submit);
      input?.addEventListener('input', updateDisabled);
      input?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDialog({ confirmed: false });
        }
      });
      dialogElement.addEventListener('click', event => {
        if (event.target === dialogElement) closeDialog({ confirmed: false });
      });
      updateDisabled();
      input?.focus();
      input?.select();
    });
  }

  function fileActionButton({ action, attribute, value, icon, label }) {
    return `
      <button
        class="file-tree-action"
        type="button"
        data-tree-action="${action}"
        ${attribute}="${escapeHtml(value)}"
        title="${escapeHtml(label)}"
        aria-label="${escapeHtml(label)}"
      >
        <svg data-lucide="${icon}" width="13" height="13" stroke="currentColor" fill="none" stroke-width="1.6"></svg>
      </button>
    `;
  }

  function findDocByPath(nodes, path) {
    if (!nodes || !path) return null;
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.isDir && node.children) {
        const found = findDocByPath(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  async function lazyLoadDirChildren(dirPath) {
    async function findAndLoad(nodes) {
      for (const node of nodes) {
        if (node.path === dirPath && node.isDir) {
          if (!node.children || node.children.length === 0) {
            try {
              node.children = await storage.listDocumentTree(dirPath) || [];
            } catch (error) {
              node.children = [];
            }
          }
          return true;
        }
        if (node.children && node.children.length > 0) {
          const found = await findAndLoad(node.children);
          if (found) return true;
        }
      }
      return false;
    }
    await findAndLoad(state.docTree);
  }

  function countMarkdownFiles(node) {
    if (!node?.isDir) return node?.name?.endsWith('.md') ? 1 : 0;
    return (node.children || []).reduce((total, child) => total + countMarkdownFiles(child), 0);
  }

  function formatFileSize(size) {
    const bytes = Number(size) || 0;
    if (bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function buildFileTreeHtml(nodes, depth) {
    if (!nodes || nodes.length === 0) {
      if (depth === 0) {
        return `
          <div class="sidebar-empty">
            <button class="btn-primary" id="btn-open-folder">${t('main.openFolder')}</button>
          </div>
        `;
      }
      return '';
    }

    let html = '';
    for (const node of nodes) {
      if (node.isDir) {
        const expanded = state.expandedDirs.has(node.path);
        const chevron = expanded ? 'chevron-down' : 'chevron-right';
        const folderIcon = expanded ? 'folder-open' : 'folder';
        const childCount = countMarkdownFiles(node);
        html += `
          <div class="file-tree-node file-tree-dir-node ${expanded ? 'expanded' : ''}">
            <div class="file-tree-row">
              <button class="file-item file-item-dir" type="button" data-dir-path="${escapeHtml(node.path)}">
                <svg class="file-tree-chevron" data-lucide="${chevron}" width="12" height="12" stroke="currentColor" fill="none" stroke-width="1.7"></svg>
                <svg class="file-tree-icon" data-lucide="${folderIcon}" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.55"></svg>
                <span class="file-item-name">${escapeHtml(node.name)}</span>
                ${childCount ? `<span class="file-item-count">${childCount}</span>` : ''}
              </button>
              <div class="file-tree-actions">
                ${fileActionButton({
                  action: 'new',
                  attribute: 'data-dir-path',
                  value: node.path,
                  icon: 'file-plus',
                  label: t('fileTree.newFile'),
                })}
              </div>
            </div>
            ${expanded ? `<div class="file-tree-children">${buildFileTreeHtml(node.children || [], depth + 1)}</div>` : ''}
          </div>
        `;
      } else if (node.name.endsWith('.md')) {
        const isActive = state.currentDoc && (
          node.path === state.currentDoc.path ||
          (node._dbId != null && Number(node._dbId) === Number(state.currentDoc.id))
        );
        const size = formatFileSize(node.size);
        html += `
          <div class="file-tree-node file-tree-file-node">
            <div class="file-tree-row">
              <button class="file-item file-item-file ${isActive ? 'active' : ''}" type="button" data-path="${escapeHtml(node.path)}">
                <span class="file-tree-chevron-placeholder"></span>
                <svg class="file-tree-icon" data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                <span class="file-item-name">${escapeHtml(fileNameWithoutExt(node.name))}</span>
                ${size ? `<span class="file-item-size">${escapeHtml(size)}</span>` : ''}
              </button>
              <div class="file-tree-actions">
                ${fileActionButton({
                  action: 'rename',
                  attribute: 'data-path',
                  value: node.path,
                  icon: 'pencil',
                  label: t('fileTree.renameFile'),
                })}
                ${fileActionButton({
                  action: 'delete',
                  attribute: 'data-path',
                  value: node.path,
                  icon: 'trash-2',
                  label: t('fileTree.deleteFile'),
                })}
              </div>
            </div>
          </div>
        `;
      }
    }
    return html;
  }

  function renderFileTreeNav() {
    const nav = document.querySelector('#file-tree-nav');
    if (!nav) return;
    nav.innerHTML = buildFileTreeHtml(state.docTree, 0);
    lucideIcons();
  }

  async function refreshFileTree() {
    if (state.docDir) {
      try {
        state.docTree = await storage.listDocumentTree(state.docDir) || [];
      } catch (error) {
        state.docTree = [];
      }
      try {
        const docs = await storage.listDocuments(state.docDir) || [];
        state.docs = docs.filter(doc => doc.name.endsWith('.md') || doc.isDir);
      } catch (error) {
        state.docs = [];
      }
    }
    renderFileTreeNav();
  }

  async function createFile(dirPath = state.docDir) {
    if (!state.docDir) {
      await openFolder();
      if (!state.docDir) return;
    }
    await saveCurrentDoc();
    const targetDir = dirPath || state.docDir;
    const result = await openTextDialog({
      title: t('fileTree.newFile'),
      description: t('fileTree.newFileDesc'),
      placeholder: t('fileTree.newFilePlaceholder'),
      confirmLabel: t('fileTree.create'),
    });
    if (!result?.confirmed) return;
    try {
      const title = fileNameWithoutExt(result.value.trim()).trim();
      const document = await storage.createDocument(targetDir, title);
      if (!document) throw new Error(t('fileTree.alreadyExists'));
      if (targetDir !== state.docDir) state.expandedDirs.add(targetDir);
      await refreshFileTree();
      await openEditor(document);
    } catch (error) {
      alert(t('fileTree.createFailed', { message: error?.message || error }));
    }
  }

  async function renameFile(path) {
    const node = findDocByPath(state.docTree, path);
    if (!node) return;
    await saveCurrentDoc();
    const result = await openTextDialog({
      title: t('fileTree.renameFile'),
      description: t('fileTree.renameFileDesc'),
      value: fileNameWithoutExt(node.name),
      confirmLabel: t('fileTree.rename'),
    });
    if (!result?.confirmed) return;
    try {
      const renamed = await storage.renameDocument(path, result.value.trim());
      await refreshFileTree();
      if (state.currentDoc?.path === path || Number(state.currentDoc?.id) === Number(node._dbId)) {
        await openEditor(renamed);
      }
    } catch (error) {
      alert(t('fileTree.renameFailed', { message: error?.message || error }));
    }
  }

  async function deleteFile(path) {
    const node = findDocByPath(state.docTree, path);
    if (!node) return;
    const result = await openTextDialog({
      title: t('fileTree.deleteFile'),
      description: t('fileTree.deleteFileDesc', { name: node.name }),
      value: '',
      confirmLabel: t('fileTree.delete'),
      danger: true,
      withInput: false,
    });
    if (!result?.confirmed) return;
    try {
      const wasCurrent = state.currentDoc?.path === path;
      await storage.deleteDocument(path);
      if (wasCurrent && typeof onCurrentDocumentDeleted === 'function') {
        await onCurrentDocumentDeleted(path);
      } else {
        await refreshFileTree();
      }
    } catch (error) {
      alert(t('fileTree.deleteFailed', { message: error?.message || error }));
    }
  }

  async function handleTreeAction(actionElement) {
    const action = actionElement.dataset.treeAction;
    if (action === 'new') {
      await createFile(actionElement.dataset.dirPath);
      return;
    }
    const path = actionElement.dataset.path;
    if (action === 'rename') {
      await renameFile(path);
      return;
    }
    if (action === 'delete') {
      await deleteFile(path);
    }
  }

  async function openFolder() {
    await saveCurrentDoc();
    try {
      const dir = await storage.selectDocumentDir();
      if (!dir) return;
      state.docDir = dir;
      state.expandedDirs.clear();
      try {
        state.docTree = await storage.listDocumentTree(dir) || [];
      } catch (error) {
        state.docTree = [];
      }
      try {
        const docs = await storage.listDocuments(dir) || [];
        state.docs = docs.filter(doc => doc.name.endsWith('.md') || doc.isDir);
      } catch (error) {
        state.docs = [];
      }
      renderFileTreeNav();
    } catch (error) {
      if (error && error.message !== 'canceled') console.error(error);
    }
  }

  async function handleFileTreeClick(event) {
    if (event.target.closest('#btn-open-folder')) {
      event.preventDefault();
      await openFolder();
      return;
    }

    const actionElement = event.target.closest('[data-tree-action]');
    if (actionElement) {
      event.preventDefault();
      event.stopPropagation();
      await handleTreeAction(actionElement);
      return;
    }

    const element = event.target.closest('.file-item');
    if (!element) return;
    const dirPath = element.dataset.dirPath;
    if (dirPath) {
      if (state.expandedDirs.has(dirPath)) {
        state.expandedDirs.delete(dirPath);
      } else {
        state.expandedDirs.add(dirPath);
        await lazyLoadDirChildren(dirPath);
      }
      renderFileTreeNav();
      return;
    }

    const path = element.dataset.path;
    const doc = findDocByPath(state.docTree, path);
    if (doc && doc.path !== state.currentDoc?.path) {
      await saveCurrentDoc();
      void openEditor(doc);
    }
  }

  function hookFileTreeEvents() {
    const nav = document.querySelector('#file-tree-nav');
    if (!nav || nav.dataset.fileTreeBound === 'true') return;
    nav.dataset.fileTreeBound = 'true';
    nav.addEventListener('click', handleFileTreeClick);

    const newFileButton = document.querySelector('#sidebar-new-file-btn');
    if (newFileButton && newFileButton.dataset.fileTreeBound !== 'true') {
      newFileButton.dataset.fileTreeBound = 'true';
      newFileButton.addEventListener('click', () => {
        void createFile(state.docDir);
      });
    }
  }

  return {
    findDocByPath,
    lazyLoadDirChildren,
    buildFileTreeHtml,
    renderFileTreeNav,
    hookFileTreeEvents,
  };
}
