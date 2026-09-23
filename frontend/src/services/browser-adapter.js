import { version as APP_VERSION } from '../../package.json';

const browserFiles = new Map();
const browserRecycle = [];
const browserFileHandles = new Map();
const browserDirectoryHandles = new Map();
const BROWSER_THEMES_KEY = 'md_editor_user_themes';
const BROWSER_PLUGINS_KEY = 'md_editor_user_plugins';
const BROWSER_SETTINGS_KEY = 'md_editor_app_settings';
let browserFileInput = null;
let browserRootDir = '';

const MARKDOWN_FILE_TYPES = [{
  description: 'Markdown 文件',
  accept: { 'text/markdown': ['.md', '.markdown', '.txt'] },
}];

function createBrowserFile(name, path, content, modTime = '') {
  return {
    name,
    path,
    content,
    modTime: modTime || new Date().toISOString().replace('T', ' ').slice(0, 19),
    size: content.length,
  };
}

function supportsOpenFilePicker() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

function supportsSaveFilePicker() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function isPickerCancellation(error) {
  return error?.name === 'AbortError' || error?.name === 'NotAllowedError';
}

function downloadBrowserFile(path, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split('/').pop() || 'untitled.md';
  anchor.click();
  URL.revokeObjectURL(url);
}

async function writeBrowserFile(path, content) {
  const handle = browserFileHandles.get(path);
  if (!handle) {
    downloadBrowserFile(path, content);
    return;
  }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readDirectoryHandle(handle, path) {
  browserDirectoryHandles.set(path, handle);
  for await (const [name, entry] of handle.entries()) {
    const entryPath = `${path}/${name}`;
    if (entry.kind === 'directory') {
      await readDirectoryHandle(entry, entryPath);
      continue;
    }
    if (!/\.(md|markdown)$/i.test(name)) continue;
    const file = await entry.getFile();
    const content = await file.text();
    browserFiles.set(entryPath, createBrowserFile(
      name,
      entryPath,
      content,
      new Date(file.lastModified).toISOString().replace('T', ' ').slice(0, 19),
    ));
    browserFileHandles.set(entryPath, entry);
  }
}

async function selectDocumentDir() {
  if (supportsDirectoryPicker()) {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      browserFiles.clear();
      browserFileHandles.clear();
      browserDirectoryHandles.clear();
      browserRootDir = handle.name;
      const rootPath = '/' + handle.name;
      await readDirectoryHandle(handle, rootPath);
      return rootPath;
    } catch (error) {
      if (isPickerCancellation(error)) return null;
      throw error;
    }
  }

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

async function writeDocument(path, content) {
  if (browserFiles.has(path)) {
    const file = browserFiles.get(path);
    file.content = content;
    file.size = content.length;
    file.modTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  }
  await writeBrowserFile(path, content);
}

function writeImageAsset(_documentPath, _imageDir, fileName, data) {
  const extension = String(fileName || '').split('.').pop().toLowerCase();
  const mimeTypes = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return Promise.resolve(`data:${mimeTypes[extension] || 'application/octet-stream'};base64,${data}`);
}

function readImageAsset(_documentPath, _imageDir, source) {
  return Promise.resolve(source);
}

async function createDocument(dirPath, name) {
  const fullName = name.endsWith('.md') ? name : name + '.md';
  const path = dirPath + '/' + fullName;
  if (browserFiles.has(path)) return null;
  const content = `# ${name}\n\n`;
  const directoryHandle = browserDirectoryHandles.get(dirPath);
  if (directoryHandle) {
    const fileHandle = await directoryHandle.getFileHandle(fullName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    browserFileHandles.set(path, fileHandle);
  }
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
  if (!file) return null;
  const dir = path.substring(0, path.lastIndexOf('/'));
  const fullName = newName.endsWith('.md') ? newName : newName + '.md';
  const newPath = dir + '/' + fullName;
  file.name = fullName;
  file.path = newPath;
  browserFiles.delete(path);
  browserFiles.set(newPath, file);
  return {
    name: fullName,
    path: newPath,
    size: file.size,
    modTime: file.modTime,
    isDir: false,
  };
}

async function openDocumentFile() {
  if (supportsOpenFilePicker()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: MARKDOWN_FILE_TYPES,
      });
      const file = await handle.getFile();
      const content = await file.text();
      const path = '/' + file.name;
      browserFiles.set(path, createBrowserFile(
        file.name,
        path,
        content,
        new Date(file.lastModified).toISOString().replace('T', ' ').slice(0, 19),
      ));
      browserFileHandles.set(path, handle);
      return path;
    } catch (error) {
      if (isPickerCancellation(error)) return '';
      throw error;
    }
  }

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

async function acceptBrowserDroppedDocument(file) {
  if (!file) throw new Error('dropped file is missing');
  const name = file.name || 'untitled.md';
  const path = '/' + name;
  const content = await file.text();
  const document = createBrowserFile(
    name,
    path,
    content,
    new Date(file.lastModified || Date.now()).toISOString().replace('T', ' ').slice(0, 19),
  );
  browserFiles.set(path, document);
  return {
    name: document.name,
    path: document.path,
    size: document.size,
    modTime: document.modTime,
  };
}

async function saveDocumentAs(content) {
  let name = '未命名.md';
  let handle = null;
  if (supportsSaveFilePicker()) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: MARKDOWN_FILE_TYPES,
      });
      name = handle.name || name;
    } catch (error) {
      if (isPickerCancellation(error)) throw new Error('canceled');
      throw error;
    }
  }
  const path = '/' + name;
  browserFiles.set(path, createBrowserFile(name, path, content));
  if (handle) {
    browserFileHandles.set(path, handle);
  }
  await writeBrowserFile(path, content);
  return { name, path, size: content.length, modTime: browserFiles.get(path).modTime };
}

function restoreRecycleItem(id) {
  const index = browserRecycle.findIndex(item => item.id === id);
  if (index === -1) return;
  const [item] = browserRecycle.splice(index, 1);
  const file = createBrowserFile(item.name, item.originalPath, item.content);
  browserFiles.set(item.originalPath, file);
}

function purgeRecycleItem(id) {
  const index = browserRecycle.findIndex(item => item.id === id);
  if (index >= 0) browserRecycle.splice(index, 1);
}

function listRecycleBin() {
  return browserRecycle.map(({ content, ...item }) => item);
}

function listUserThemes() {
  try {
    const raw = localStorage.getItem(BROWSER_THEMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveUserTheme(id, content) {
  const parsed = JSON.parse(content);
  const themes = listUserThemes();
  themes[id] = JSON.stringify(parsed);
  localStorage.setItem(BROWSER_THEMES_KEY, JSON.stringify(themes));
}

function deleteUserTheme(id) {
  const themes = listUserThemes();
  delete themes[id];
  localStorage.setItem(BROWSER_THEMES_KEY, JSON.stringify(themes));
}

function listUserPlugins() {
  try {
    const raw = localStorage.getItem(BROWSER_PLUGINS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveUserPlugin(id, content) {
  const parsed = JSON.parse(content);
  const plugins = listUserPlugins();
  plugins[id] = JSON.stringify(parsed);
  localStorage.setItem(BROWSER_PLUGINS_KEY, JSON.stringify(plugins));
}

function deleteUserPlugin(id) {
  const plugins = listUserPlugins();
  delete plugins[id];
  localStorage.setItem(BROWSER_PLUGINS_KEY, JSON.stringify(plugins));
}

function loadBrowserAppSettings() {
  try {
    const raw = localStorage.getItem(BROWSER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveBrowserAppSetting(key, value) {
  const settings = loadBrowserAppSettings();
  settings[key] = value;
  localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings));
}

export const browserAdapter = {
  name: 'browser',
  selectDocumentDir,
  listDocuments,
  listDocumentTree,
  readDocument,
  readImageAsset,
  writeDocument,
  writeImageAsset,
  createDocument,
  deleteDocument,
  listRecycleBin,
  restoreRecycleItem,
  purgeRecycleItem,
  renameDocument,
  revealDocument: async () => false,
  openDocumentFile,
  acceptDroppedDocument: async path => ({ name: path.split('/').pop(), path }),
  acceptBrowserDroppedDocument,
  saveDocumentAs,
  saveExportFile: async () => null,
  addRecentFile: async () => {},
  listRecentFiles: async () => [],
  getAppState: async () => null,
  getAppVersion: async () => APP_VERSION,
  saveAppSetting: async (key, value) => saveBrowserAppSetting(key, value),
  loadAppSettings: async () => loadBrowserAppSettings(),
  getThemesDirectory: async () => 'Browser localStorage: md_editor_user_themes',
  listUserThemes: async () => listUserThemes(),
  saveUserTheme: async (id, content) => saveUserTheme(id, content),
  deleteUserTheme: async id => deleteUserTheme(id),
  revealThemesDirectory: async () => {},
  getUserPluginsDirectory: async () => 'Browser localStorage: md_editor_user_plugins',
  listUserPlugins: async () => listUserPlugins(),
  saveUserPlugin: async (id, content) => saveUserPlugin(id, content),
  deleteUserPlugin: async id => deleteUserPlugin(id),
  revealUserPluginsDirectory: async () => {},
  saveRecoveryState: async payload => localStorage.setItem('md_editor_recovery', payload),
  loadRecoveryState: async () => localStorage.getItem('md_editor_recovery') || '',
  clearRecoveryState: async () => localStorage.removeItem('md_editor_recovery'),
  // 浏览器预览没有程序坞：不设置应用图标，缩进比例也交给 brand.js 的兜底值。
  setApplicationIcon: async () => false,
  setPendingChanges: async () => {},
  confirmClose: async () => {},
};
