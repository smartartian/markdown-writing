export function createFileTreeModule({
  state,
  storage,
  escapeHtml,
  fileNameWithoutExt,
  lucideIcons,
  openEditor,
  saveCurrentDoc,
}) {
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

  function buildFileTreeHtml(nodes, depth) {
    if (!nodes || nodes.length === 0) {
      if (depth === 0) {
        return `
          <div class="sidebar-empty">
            <button class="btn-primary" id="btn-open-folder">打开文件夹</button>
          </div>
        `;
      }
      return '';
    }

    let html = '';
    for (const node of nodes) {
      const padding = 8 + depth * 14;
      if (node.isDir) {
        const expanded = state.expandedDirs.has(node.path);
        const chevron = expanded ? 'chevron-down' : 'chevron-right';
        const folderIcon = expanded ? 'folder-open' : 'folder';
        html += `
          <div class="file-item file-item-dir" data-dir-path="${escapeHtml(node.path)}" style="padding-left:${padding}px;">
            <svg data-lucide="${chevron}" width="12" height="12" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <svg data-lucide="${folderIcon}" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <span class="file-item-name">${escapeHtml(node.name)}</span>
          </div>
        `;
        if (expanded) {
          html += buildFileTreeHtml(node.children || [], depth + 1);
        }
      } else if (node.name.endsWith('.md')) {
        const isActive = state.currentDoc && (
          node.path === state.currentDoc.path ||
          (node._dbId != null && Number(node._dbId) === Number(state.currentDoc.id))
        );
        const wordCount = Math.max(1, Math.round((node.size || 0) / 3));
        html += `
          <div class="file-item ${isActive ? 'active' : ''}" data-path="${escapeHtml(node.path)}" style="padding-left:${padding + 14}px;">
            <svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <span class="file-item-name">${escapeHtml(fileNameWithoutExt(node.name))}</span>
            <span class="file-item-size">${wordCount}字</span>
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
    if (path && path.startsWith('db:')) {
      const dbId = parseInt(path.slice(3));
      await saveCurrentDoc();
      const doc = { id: dbId, name: element.querySelector('span')?.textContent + '.md' || '文档.md' };
      void openEditor(doc);
      return;
    }

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
  }

  return {
    findDocByPath,
    lazyLoadDirChildren,
    buildFileTreeHtml,
    renderFileTreeNav,
    hookFileTreeEvents,
  };
}
