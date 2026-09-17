const browserFiles = new Map();
const browserRecycle = [];
let browserFileInput = null;
let browserRootDir = '';

function hashContent(content) {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createBrowserFile(name, path, content, modTime = '') {
  return {
    name,
    path,
    content,
    contentHash: hashContent(content),
    revision: 1,
    versions: [{ id: Date.now(), revision: 1, content, contentHash: hashContent(content), createdAt: new Date().toISOString() }],
    modTime: modTime || new Date().toISOString().replace('T', ' ').slice(0, 19),
    size: content.length,
  };
}

function selectDocumentDir() {
  return new Promise((resolve) => {
    if (!browserFileInput) {
      browserFileInput = document.createElement('input');
      browserFileInput.type = 'file';
      browserFileInput.webkitdirectory = true;
      browserFileInput.multiple = true;
      browserFileInput.accept = '.md,.markdown';
      browserFileInput.style.display = 'none';
      document.body.appendChild(browserFileInput);

      browserFileInput.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }

        browserFiles.clear();
        const firstRelativePath = files[0].webkitRelativePath;
        browserRootDir = firstRelativePath.split('/')[0];

        for (const file of files) {
          const path = '/' + file.webkitRelativePath;
          const content = await file.text();
          browserFiles.set(path, createBrowserFile(
            file.name,
            path,
            content,
            new Date(file.lastModified).toISOString().replace('T', ' ').slice(0, 19),
          ));
        }
        resolve('/' + browserRootDir);
      });
    }
    browserFileInput.value = '';
    browserFileInput.click();
  });
}

function listDocuments(dirPath) {
  const docs = [];
  const dirs = new Set();
  for (const [path, file] of browserFiles) {
    if (!path.startsWith(dirPath)) continue;
    const rel = path.slice(dirPath.length + 1);
    if (rel.includes('/')) {
      dirs.add(rel.split('/')[0]);
    } else if (file.name.endsWith('.md')) {
      docs.push({ name: file.name, path, size: file.size, modTime: file.modTime, isDir: false });
    }
  }
  for (const dir of dirs) {
    docs.push({ name: dir, path: dirPath + '/' + dir, size: 0, modTime: '', isDir: true });
  }
  return docs;
}

function listDocumentTree(dirPath) {
  const tree = [];
  for (const [path] of browserFiles) {
    if (!path.startsWith(dirPath)) continue;
    const rel = path.slice(dirPath.length + 1);
    const parts = rel.split('/');
    let current = tree;
    let currentPath = dirPath;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += '/' + part;
      const isLast = i === parts.length - 1;
      if (!isLast || !part.endsWith('.md')) {
        let existing = current.find(node => node.name === part && node.isDir);
        if (!existing) {
          existing = { name: part, path: currentPath, isDir: true, children: [] };
          current.push(existing);
        }
        current = existing.children;
      } else {
        current.push({ name: part, path: currentPath, isDir: false });
      }
    }
  }
  return tree;
}

function readDocument(path) {
  const file = browserFiles.get(path);
  return file ? file.content : '';
}

function readDocumentWithMeta(path) {
  const file = browserFiles.get(path);
  if (!file) return null;
  return {
    path,
    content: file.content,
    revision: file.revision,
    contentHash: file.contentHash,
    changed: false,
  };
}

function writeDocument(path, content) {
  if (browserFiles.has(path)) {
    const file = browserFiles.get(path);
    file.content = content;
    file.size = content.length;
    file.modTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  try {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = path.split('/').pop() || 'untitled.md';
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    // Browser mode cannot reliably write back to the selected folder.
  }
}

function writeDocumentVersioned(path, content, expectedRevision, expectedHash) {
  let file = browserFiles.get(path);
  if (!file) {
    file = createBrowserFile(path.split('/').pop() || 'untitled.md', path, '');
    browserFiles.set(path, file);
  }
  if (expectedRevision > 0 && (file.revision !== expectedRevision || file.contentHash !== expectedHash)) {
    throw new Error('revision conflict');
  }
  const nextHash = hashContent(content);
  if (nextHash !== file.contentHash) {
    file.revision += 1;
    file.contentHash = nextHash;
    file.versions.unshift({
      id: Date.now(),
      revision: file.revision,
      content,
      contentHash: nextHash,
      createdAt: new Date().toISOString(),
    });
    file.versions = file.versions.slice(0, 50);
  }
  file.content = content;
  file.size = content.length;
  file.modTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return file.revision;
}

function listFileVersions(path) {
  return browserFiles.get(path)?.versions || [];
}

function restoreFileVersion(path, versionID, expectedRevision, expectedHash) {
  const version = listFileVersions(path).find(item => item.id === versionID);
  if (!version) throw new Error('version not found');
  return writeDocumentVersioned(path, version.content, expectedRevision, expectedHash);
}

function createDocument(dirPath, name) {
  const fullName = name.endsWith('.md') ? name : name + '.md';
  const path = dirPath + '/' + fullName;
  if (browserFiles.has(path)) return null;
  const content = `# ${name}\n\n`;
  browserFiles.set(path, createBrowserFile(fullName, path, content));
  return { name: fullName, path, size: content.length, modTime: browserFiles.get(path).modTime };
}

function deleteDocument(path) {
  const file = browserFiles.get(path);
  if (!file) return;
  browserRecycle.unshift({
    id: Date.now(),
    originalPath: path,
    storedPath: `browser-recycle:${path}`,
    name: file.name,
    deletedAt: new Date().toISOString(),
    content: file.content,
  });
  browserFiles.delete(path);
}

function renameDocument(path, newName) {
  const file = browserFiles.get(path);
  if (!file) return;
  const dir = path.substring(0, path.lastIndexOf('/'));
  const fullName = newName.endsWith('.md') ? newName : newName + '.md';
  const newPath = dir + '/' + fullName;
  file.name = fullName;
  file.path = newPath;
  browserFiles.delete(path);
  browserFiles.set(newPath, file);
}

function openDocumentFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt';
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) {
        resolve('');
        return;
      }
      const content = await file.text();
      const path = '/' + file.name;
      browserFiles.set(path, createBrowserFile(
        file.name,
        path,
        content,
        new Date(file.lastModified).toISOString().replace('T', ' ').slice(0, 19),
      ));
      resolve(path);
    };
    input.click();
  });
}

function saveDocumentAs(content) {
  const name = '未命名.md';
  const path = '/' + name;
  browserFiles.set(path, createBrowserFile(name, path, content));
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return { name, path, size: content.length, modTime: browserFiles.get(path).modTime };
}

const BROWSER_DB_KEY = 'md_editor_db_docs';
const BROWSER_DB_VERSIONS_KEY = 'md_editor_db_versions';

function listDbDocuments() {
  try {
    const raw = localStorage.getItem(BROWSER_DB_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function saveDbDocuments(docs) {
  localStorage.setItem(BROWSER_DB_KEY, JSON.stringify(docs));
}

function createDbDocument(name, content) {
  const docs = listDbDocuments();
  const id = Date.now();
  docs.push({
    id,
    name,
    content,
    revision: 1,
    size: content.length,
    modTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });
  saveDbDocuments(docs);
  saveDbVersions({
    ...readDbVersions(),
    [id]: [{ id: Date.now(), revision: 1, name, content, createdAt: new Date().toISOString() }],
  });
  return id;
}

function readDbDocument(id) {
  return listDbDocuments().find(doc => doc.id === id) || null;
}

function updateDbDocument(id, name, content, expectedRevision) {
  const docs = listDbDocuments();
  const index = docs.findIndex(doc => doc.id === id);
  if (index === -1) return 0;
  if (expectedRevision > 0 && docs[index].revision !== expectedRevision) {
    throw new Error('revision conflict');
  }
  if (docs[index].content === content) return docs[index].revision;
  docs[index].revision = (docs[index].revision || 1) + 1;
  docs[index].name = name;
  docs[index].content = content;
  docs[index].size = content.length;
  docs[index].modTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  saveDbDocuments(docs);
  const versions = readDbVersions();
  versions[id] = [
    { id: Date.now(), revision: docs[index].revision, name, content, createdAt: new Date().toISOString() },
    ...(versions[id] || []),
  ].slice(0, 50);
  saveDbVersions(versions);
  return docs[index].revision;
}

function deleteDbDocument(id) {
  const docs = listDbDocuments();
  const doc = docs.find(item => item.id === id);
  if (doc) {
    doc.deletedAt = new Date().toISOString();
    saveDbDocuments(docs);
  }
}

function listDbDocumentSummaries() {
  return listDbDocuments().filter(doc => !doc.deletedAt).map(doc => ({
    id: doc.id,
    name: doc.name,
    size: doc.size,
    modTime: doc.modTime,
    revision: doc.revision || 1,
  }));
}

function readDbVersions() {
  try {
    return JSON.parse(localStorage.getItem(BROWSER_DB_VERSIONS_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function saveDbVersions(versions) {
  localStorage.setItem(BROWSER_DB_VERSIONS_KEY, JSON.stringify(versions));
}

function listDbDocumentVersions(id) {
  return (readDbVersions()[id] || []).map(version => ({
    id: version.id,
    documentId: id,
    revision: version.revision,
    name: version.name,
    content: version.content,
    size: version.content.length,
    createdAt: version.createdAt,
  }));
}

function restoreDbDocumentVersion(id, versionID, expectedRevision) {
  const version = listDbDocumentVersions(id).find(item => item.id === versionID);
  if (!version) throw new Error('version not found');
  return updateDbDocument(id, version.name, version.content, expectedRevision);
}

function restoreRecycleItem(id) {
  if (id < 0) {
    const docs = listDbDocuments();
    const doc = docs.find(item => item.id === -id);
    if (doc) {
      delete doc.deletedAt;
      saveDbDocuments(docs);
    }
    return;
  }
  const index = browserRecycle.findIndex(item => item.id === id);
  if (index === -1) return;
  const [item] = browserRecycle.splice(index, 1);
  const file = createBrowserFile(item.name, item.originalPath, item.content);
  browserFiles.set(item.originalPath, file);
}

function purgeRecycleItem(id) {
  if (id < 0) {
    saveDbDocuments(listDbDocuments().filter(item => item.id !== -id));
    return;
  }
  const index = browserRecycle.findIndex(item => item.id === id);
  if (index >= 0) browserRecycle.splice(index, 1);
}

function listRecycleBin() {
  const deletedDocs = listDbDocuments()
    .filter(doc => doc.deletedAt)
    .map(doc => ({
      id: -doc.id,
      originalPath: `db:${doc.id}`,
      storedPath: `db:${doc.id}`,
      name: doc.name,
      deletedAt: doc.deletedAt,
    }));
  return [
    ...deletedDocs,
    ...browserRecycle.map(({ content, ...item }) => item),
  ];
}

export const browserAdapter = {
  name: 'browser',
  selectDocumentDir,
  listDocuments,
  listDocumentTree,
  readDocument,
  readDocumentWithMeta,
  writeDocument,
  writeDocumentVersioned,
  listFileVersions,
  restoreFileVersion,
  createDocument,
  deleteDocument,
  listRecycleBin,
  restoreRecycleItem,
  purgeRecycleItem,
  renameDocument,
  openDocumentFile,
  saveDocumentAs,
  addRecentFile: async () => {},
  listRecentFiles: async () => [],
  getAppState: async () => null,
  getAppVersion: async () => '0.0.1',
  createDbDocument,
  readDbDocument,
  updateDbDocument,
  deleteDbDocument,
  listDbDocuments: listDbDocumentSummaries,
  listDbDocumentVersions,
  restoreDbDocumentVersion,
  saveAppSetting: async () => {},
  loadAppSettings: async () => ({}),
  saveRecoveryState: async payload => localStorage.setItem('md_editor_recovery', payload),
  loadRecoveryState: async () => localStorage.getItem('md_editor_recovery') || '',
  clearRecoveryState: async () => localStorage.removeItem('md_editor_recovery'),
  setPendingChanges: async () => {},
  confirmClose: async () => {},
};
