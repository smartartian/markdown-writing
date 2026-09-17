import './style.css';

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  createIcons,
  AlignLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Download,
  Eye,
  FileCode,
  FilePlus,
  FileText,
  FileType,
  FileUp,
  Folder,
  FolderOpen,
  History,
  Image,
  Library,
  List,
  PanelLeft,
  PenLine,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide';
import { WindowGetPosition, WindowSetPosition, EventsOn } from '../wailsjs/runtime/runtime';
import { state } from './core/state';
import {
  applyModelSelection,
  createPosition,
  createSelection,
  domSelectionToModel,
  inlinePositionToTextOffset,
  textOffsetToInlinePosition,
} from './editor-core/selection/index.js';
import { createCompositionController } from './editor-core/composition/index.js';
import { createBuiltinCommands } from './editor-core/commands/index.js';
import { createEditorSession } from './editor-core/session/index.js';
import { serializeDocument } from './editor-core/serializer/markdown-serializer.js';
import { createParserWorkerClient } from './editor-core/worker/index.js';
import { scheduleShadowComparison } from './editor-core/shadow/shadow-mode.js';
import { createEditorCore } from './modules/editor';
import { createExportModule } from './modules/export';
import { createFileTreeModule } from './modules/file-tree';
import { createSafetyModule } from './modules/safety';
import { createSettingsModule } from './modules/settings';
import { isBrowserMode, storage } from './services/document-store';

const LUCIDE_ICONS = {
  AlignLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Download,
  Eye,
  FileCode,
  FilePlus,
  FileText,
  FileType,
  FileUp,
  Folder,
  FolderOpen,
  History,
  Image,
  Library,
  List,
  PanelLeft,
  PenLine,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
};

const {
  selectDocumentDir: SelectDocumentDir,
  listDocuments: ListDocuments,
  listDocumentTree: ListDocumentTree,
  readDocument: ReadDocument,
  readDocumentWithMeta: ReadDocumentWithMeta,
  writeDocument: WriteDocument,
  writeDocumentVersioned: WriteDocumentVersioned,
  listFileVersions: ListFileVersions,
  restoreFileVersion: RestoreFileVersion,
  createDocument: CreateDocument,
  deleteDocument: DeleteDocument,
  listRecycleBin: ListRecycleBin,
  restoreRecycleItem: RestoreRecycleItem,
  purgeRecycleItem: PurgeRecycleItem,
  renameDocument: RenameDocument,
  openDocumentFile: OpenDocumentFile,
  saveDocumentAs: SaveDocumentAs,
  addRecentFile: AddRecentFile,
  listRecentFiles: ListRecentFiles,
  getAppState: GetAppState,
  getAppVersion: GetAppVersion,
  createDbDocument: DBCreateDocument,
  readDbDocument: DBReadDocument,
  updateDbDocument: DBUpdateDocument,
  deleteDbDocument: DBDeleteDocument,
  listDbDocuments: DBListDocuments,
  listDbDocumentVersions: DBListDocumentVersions,
  restoreDbDocumentVersion: DBRestoreDocumentVersion,
  saveAppSetting: SaveAppSetting,
  loadAppSettings: LoadAppSettings,
  saveRecoveryState: SaveRecoveryState,
  loadRecoveryState: LoadRecoveryState,
  clearRecoveryState: ClearRecoveryState,
  setPendingChanges: SetPendingChanges,
  confirmClose: ConfirmClose,
} = storage;

const APP_VERSION = '0.0.1';
const APP_REPO = 'smartartian/Markdown-writing';

// 检查 GitHub 最新版本
async function checkForUpdate() {
  try {
    const resp = await fetch(`https://api.github.com/repos/${APP_REPO}/releases/latest`);
    if (!resp.ok) return { error: '无法获取更新信息' };
    const data = await resp.json();
    const latest = data.tag_name.replace(/^v/, '');
    const current = APP_VERSION;
    const hasUpdate = compareVersions(latest, current) > 0;
    return { latest, current, hasUpdate, url: data.html_url, notes: data.body };
  } catch (e) {
    return { error: '网络请求失败' };
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ============================================================
// 状态持久化
// ============================================================
async function saveAppState() {
  try {
    const data = {
      lastView: state.view,
      isDBMode: state.isDBMode,
      docDir: state.docDir,
    };
    if (state.currentDoc) {
      if (state.currentDoc.id) data.lastDocId = state.currentDoc.id;
      if (state.currentDoc.path) data.lastDocPath = state.currentDoc.path;
      data.lastDocName = state.currentDoc.name;
    }
    try {
      await SaveAppSetting('lastState', JSON.stringify(data));
    } catch (e) {
      try { localStorage.setItem('md_editor_lastState', JSON.stringify(data)); } catch (e) {}
    }
  } catch (e) { /* ignore save errors in dev mode */ }
}

async function restoreAppState() {
  let raw = null;
  try {
    const settings = await LoadAppSettings();
    if (settings && settings.lastState) raw = settings.lastState;
  } catch (e) {}
  if (!raw) {
    try { raw = localStorage.getItem('md_editor_lastState'); } catch (e) {}
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return data;
  } catch (e) { return null; }
}

// ============================================================
// DOM 引用
// ============================================================
let $app;

function qs(sel, ctx = document) { return ctx.querySelector(sel); }

// ============================================================
// 工具
// ============================================================
function wordCount(text) {
  const clean = text.replace(/\s+/g, '');
  return clean.length;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split(' ');
  if (parts.length === 2) {
    const d = parts[0].split('-');
    const t = parts[1].split(':');
    return `${d[1]}月${d[2]}日`;
  }
  return dateStr;
}

function fileNameWithoutExt(name) {
  return name.replace(/\.md$/i, '');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const HTML_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
  FORBID_ATTR: ['srcdoc'],
  ALLOW_DATA_ATTR: true,
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noopener noreferrer');
    if (node.getAttribute('target') === '_blank') {
      node.setAttribute('target', '_blank');
    }
  }
  if (node.tagName === 'IMG') {
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
});

function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || '', HTML_SANITIZE_CONFIG);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ============================================================
// 窗口拖动（JS 实现，比 -webkit-app-region 更可靠）
// ============================================================
let dragState = null;

function startWindowDrag(e) {
  if (isBrowserMode()) return;
  const target = e.target;
  if (target.closest('button, input, textarea, select, [contenteditable], .btn-icon, .btn-primary, .sidebar-resizer, .modal-close')) return;

  dragState = {
    startScreenX: e.screenX,
    startScreenY: e.screenY,
  };
  document.addEventListener('mousemove', onWindowDrag);
  document.addEventListener('mouseup', stopWindowDrag);
  e.preventDefault();
}

let dragRaf = null;
let dragStartCursor = '';

function onWindowDrag(e) {
  if (!dragState) return;
  if (dragRaf) return; // 节流：每帧只执行一次
  dragRaf = requestAnimationFrame(() => {
    dragRaf = null;
    if (!dragState) return;
    const dx = e.screenX - dragState.startScreenX;
    const dy = e.screenY - dragState.startScreenY;
    // 反向推窗口位置：当前 screenX = winX + clientX（即鼠标在窗口内的偏移）
    // winX = screenX - offsetX, 这里 offsetX 是在窗口内的相对位置
    // 用 mousedown 时的差值来反算
    const newX = e.screenX - (dragState.startScreenX - dragState.startWinX);
    const newY = e.screenY - (dragState.startScreenY - dragState.startWinY);
    WindowSetPosition(
      dragState.startWinX + (e.screenX - dragState.startScreenX),
      dragState.startWinY + (e.screenY - dragState.startScreenY)
    );
  });
}

function stopWindowDrag() {
  dragState = null;
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; }
  document.body.style.cursor = dragStartCursor || '';
  document.body.style.userSelect = '';
  document.removeEventListener('mousemove', onWindowDrag);
  document.removeEventListener('mouseup', stopWindowDrag);
}

// 为整个文档添加拖动支持（仅顶部区域通过 mousedown 坐标判断）
async function initWindowDrag() {
  // 先获取一次窗口位置缓存
  try {
    const pos = await WindowGetPosition();
    window.__winPos = pos;
  } catch (e) { /* ignore */ }

  document.addEventListener('mousedown', (e) => {
    if (e.clientY > 44) return;
    // 用缓存的窗口位置 + 当前鼠标屏幕位置与 client 位置的差值来算出 winX/winY
    const pos = window.__winPos;
    if (!pos) return;
    const target = e.target;
    if (target.closest('button, input, textarea, select, [contenteditable], .btn-icon, .btn-primary, .sidebar-resizer, .modal-close')) return;
    dragState = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startWinX: pos.x,
      startWinY: pos.y,
    };
    dragStartCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onWindowDrag);
    document.addEventListener('mouseup', stopWindowDrag);
  });
}

// textarea 自适应高度（把滚动交给外层容器）
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// ============================================================
// 块级编辑器（Typora 风格）
// 光标停留在块上显示 Markdown 源码，移开显示渲染后的富文本
// ============================================================

let activeBlockIndex = 0;
const {
  parseMarkdownBlocks,
  getBlockClassName,
  renderBlockHtml,
  buildBlockEditorHtml,
  collectBlocksMarkdown,
  getLastParseResult,
  resetParseResult,
} = createEditorCore({
  marked,
  sanitizeHtml,
  escapeHtml,
  getActiveBlockIndex: () => activeBlockIndex,
  setActiveBlockIndex: index => { activeBlockIndex = index; },
});

const compositionController = createCompositionController({
  onCommit: result => {
    state.lastCompositionTransaction = result;
  },
});

const editorCommands = createBuiltinCommands();
const parserWorker = createParserWorkerClient();

// 重新渲染块编辑器（保留当前激活块的位置）
function refreshBlockEditor() {
  const container = qs('#block-editor');
  if (!container) return;
  const md = collectBlocksMarkdown();
  activeBlockIndex = Math.max(0, activeBlockIndex);
  container.innerHTML = buildBlockEditorHtml(md);
  hookBlockEvents();
  // 聚焦激活块
  const activeEl = container.querySelector('.block.active .block-source');
  if (activeEl && activeEl.contentEditable === 'true') {
    activeEl.focus();
    // 光标放到末尾
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(activeEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// 激活指定块
function activateBlock(index) {
  const container = qs('#block-editor');
  if (!container) return;
  const blocks = container.querySelectorAll('.block');
  if (index < 0) index = 0;
  if (index >= blocks.length) index = blocks.length - 1;

  // 先同步当前激活块的 Markdown
  const prevActive = container.querySelector('.block.active');
  if (prevActive) {
    prevActive.classList.remove('active');
    const prevSource = prevActive.querySelector('.block-source');
    if (prevSource) {
      prevSource.contentEditable = 'false';
      // 重新渲染上一块的 HTML
      const raw = (prevSource.textContent || '').replace(/\u200B/g, '').trim();
      prevActive.__raw = raw;
      const rendered = renderBlockHtml(parseSingleBlock(raw, prevActive));
      const renderedEl = prevActive.querySelector('.block-rendered');
      if (renderedEl) renderedEl.innerHTML = rendered;
    }
  }

  activeBlockIndex = index;
  const nextBlock = blocks[index];
  if (nextBlock) {
    nextBlock.classList.add('active');
    const source = nextBlock.querySelector('.block-source');
    if (source) {
      source.contentEditable = 'true';
      source.focus();
      // 光标放到末尾
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(source);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

function parseSingleBlock(raw, blockEl) {
  const parsed = parseMarkdownBlocks(raw || '')[0];
  return { ...parsed, raw: raw || '' };
}

// 创建新块（在指定索引后）
function insertBlockAfter(index, raw = '') {
  const container = qs('#block-editor');
  if (!container) return;
  const blockEls = container.querySelectorAll('.block');
  const newEl = document.createElement('div');
  newEl.className = 'block block-paragraph';
  newEl.dataset.blockType = 'paragraph';
  newEl.innerHTML = `
    <div class="block-source" contenteditable="false">${escapeHtml(raw) || '&#8203;'}</div>
    <div class="block-rendered"><p><br></p></div>
  `;

  if (index + 1 < blockEls.length) {
    container.insertBefore(newEl, blockEls[index + 1]);
  } else {
    container.appendChild(newEl);
  }

  // 更新所有 data-block-index
  container.querySelectorAll('.block').forEach((el, i) => {
    el.dataset.blockIndex = i;
  });

  hookBlockEvents();
  return index + 1;
}

// 删除块
function removeBlock(index) {
  const container = qs('#block-editor');
  if (!container) return;
  const blockEls = container.querySelectorAll('.block');
  if (blockEls.length <= 1) return; // 至少保留一个块
  if (index >= blockEls.length) index = blockEls.length - 1;
  blockEls[index].remove();

  // 更新索引
  container.querySelectorAll('.block').forEach((el, i) => {
    el.dataset.blockIndex = i;
  });

  hookBlockEvents();
  return Math.min(index, container.querySelectorAll('.block').length - 1);
}

// 块事件绑定
function hookBlockEvents() {
  const container = qs('#block-editor');
  if (!container) return;

  // 点击块 → 激活
  container.querySelectorAll('.block').forEach(el => {
    el.removeEventListener('click', onBlockClick);
    el.addEventListener('click', onBlockClick);

    const source = el.querySelector('.block-source');
    if (source) {
      source.removeEventListener('input', onBlockInput);
      source.addEventListener('input', onBlockInput);
      source.removeEventListener('beforeinput', onBlockBeforeInput);
      source.addEventListener('beforeinput', onBlockBeforeInput);
      source.removeEventListener('keydown', onBlockKeydown);
      source.addEventListener('keydown', onBlockKeydown);
      source.removeEventListener('compositionstart', onBlockCompositionStart);
      source.addEventListener('compositionstart', onBlockCompositionStart);
      source.removeEventListener('compositionupdate', onBlockCompositionUpdate);
      source.addEventListener('compositionupdate', onBlockCompositionUpdate);
      source.removeEventListener('compositionend', onBlockCompositionEnd);
      source.addEventListener('compositionend', onBlockCompositionEnd);
      source.removeEventListener('blur', onBlockCompositionCancel);
      source.addEventListener('blur', onBlockCompositionCancel);
      source.removeEventListener('dragover', onBlockDragOver);
      source.addEventListener('dragover', onBlockDragOver);
      source.removeEventListener('drop', onBlockDrop);
      source.addEventListener('drop', onBlockDrop);
    }
  });

  // 点击空白区域 → 激活最后一个块
  container.removeEventListener('click', onContainerClick);
  container.addEventListener('click', onContainerClick);
}

function onBlockClick(e) {
  const block = e.currentTarget;
  const idx = parseInt(block.dataset.blockIndex);
  if (!isNaN(idx) && idx !== activeBlockIndex) {
    captureBlockSelection();
    activateBlock(idx);
  }
}

function onBlockInput(e) {
  if (state.suppressNextInput) {
    state.suppressNextInput = false;
    return;
  }
  state.isDirty = true;
  updateTitleDirty();
  const source = e.target;
  const block = source.closest('.block');
  if (!block) return;

  if (compositionController.isActive()) {
    updateWordCount();
    return;
  }

  const raw = (source.textContent || '').replace(/\u200B/g, '');
  if (state.editorSession?.document) {
    const block = source.closest('.block');
    const blockId = block?.dataset.blockId;
    const modelBlock = state.editorSession.document.getBlock(blockId);
    if (blockId && modelBlock && modelBlock.raw !== raw) {
      state.editorSession.selection = state.selection;
      const transaction = state.editorSession
        .createTransaction({ source: 'input' })
        .replace(blockId, raw);
      const result = state.editorSession.apply(transaction, {
        coalesceKey: `input:${blockId}`,
      });
      state.currentContent = serializeDocument(result.document);
      const editor = qs('#block-editor');
      if (editor) {
        editor.dataset.editorRevision = String(result.document.version);
        editor.dataset.lastTransaction = 'input';
      }
    }
  }

  renderBlockFromSource(source, block);
  captureBlockSelection();
  if (state.editorSession) state.editorSession.selection = state.selection;
  updateWordCount();
  scheduleAutoSave();
}

function applyModelBlockUpdate(blockId, raw, caretOffset, {
  source = 'input',
  coalesceKey = null,
  selection = null,
} = {}) {
  if (!state.editorSession?.document) return null;
  const block = state.editorSession.document.getBlock(blockId);
  if (!block || block.raw === raw) return null;
  state.editorSession.selection = selection || state.selection;
  const transaction = state.editorSession
    .createTransaction({ source })
    .replace(blockId, raw);
  const result = state.editorSession.apply(transaction, { coalesceKey });
  state.currentContent = serializeDocument(result.document);
  const updatedBlock = result.document.getBlock(blockId);
  const inlinePosition = updatedBlock?.children?.length
    ? textOffsetToInlinePosition(updatedBlock.children, caretOffset)
    : { path: [], offset: caretOffset };
  state.selection = createSelection(
    createPosition(blockId, inlinePosition.offset, inlinePosition.path),
    createPosition(blockId, inlinePosition.offset, inlinePosition.path),
  );
  state.editorSession.selection = state.selection;
  const visibleBlocks = result.document.blocks.filter(item => !item.attrs?.separator);
  state.selectionIndex = visibleBlocks.findIndex(item => item.id === blockId);
  syncIncrementalBlocks(result.changedBlockIds);
  updateWordCount();
  scheduleAutoSave();
  const editor = qs('#block-editor');
  if (editor) {
    editor.dataset.editorRevision = String(result.document.version);
    editor.dataset.lastTransaction = source;
  }
  return result;
}

function deleteCodePointBackward(text, offset) {
  if (offset <= 0) return 0;
  const previous = text.charCodeAt(offset - 1);
  const beforePrevious = text.charCodeAt(offset - 2);
  if (previous >= 0xDC00 && previous <= 0xDFFF && beforePrevious >= 0xD800 && beforePrevious <= 0xDBFF) {
    return offset - 2;
  }
  return offset - 1;
}

function deleteCodePointForward(text, offset) {
  if (offset >= text.length) return text.length;
  const current = text.charCodeAt(offset);
  const next = text.charCodeAt(offset + 1);
  if (current >= 0xD800 && current <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
    return offset + 2;
  }
  return offset + 1;
}

function onBlockBeforeInput(e) {
  if (compositionController.isActive() || e.isComposing) return;
  const source = e.target;
  const block = source.closest('.block');
  if (!block || !state.editorSession?.document) return;
  const blockId = block.dataset.blockId;
  const modelBlock = state.editorSession.document.getBlock(blockId);
  if (!modelBlock) return;
  const root = qs('#block-editor');
  const selection = domSelectionToModel(root);
  if (!selection || selection.anchor.blockId !== blockId || selection.head.blockId !== blockId) return;
  const start = Math.min(selection.anchor.offset, selection.head.offset);
  const end = Math.max(selection.anchor.offset, selection.head.offset);
  const raw = modelBlock.raw;

  if (e.inputType === 'insertText') {
    e.preventDefault();
    const data = e.data || '';
    const nextRaw = raw.slice(0, start) + data + raw.slice(end);
    applyModelBlockUpdate(blockId, nextRaw, start + data.length, {
      source: 'input',
      coalesceKey: `input:${blockId}`,
      selection,
    });
    state.suppressNextInput = true;
    return;
  }

  if (e.inputType === 'insertParagraph') {
    e.preventDefault();
    if (modelBlock.type === 'code') {
      const nextRaw = raw.slice(0, start) + '\n' + raw.slice(end);
      applyModelBlockUpdate(blockId, nextRaw, start + 1, {
        source: 'input',
        coalesceKey: `input:${blockId}`,
        selection,
      });
      state.suppressNextInput = true;
      return;
    }
    const transaction = state.editorSession
      .createTransaction({ source: 'keyboard' })
      .split(blockId, start);
    const result = state.editorSession.apply(transaction);
    state.currentContent = serializeDocument(result.document);
    const documentIndex = result.document.getBlockIndex(blockId);
    const right = result.document.blocks[documentIndex + 1];
    if (right) {
      state.selection = createSelection(
        createPosition(right.id, 0),
        createPosition(right.id, 0),
      );
    }
    syncIncrementalBlocks(result.changedBlockIds);
    updateWordCount();
    scheduleAutoSave();
    state.suppressNextInput = true;
    return;
  }

  if (e.inputType === 'insertFromPaste') {
    const text = e.dataTransfer?.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    const nextRaw = raw.slice(0, start) + text + raw.slice(end);
    applyModelBlockUpdate(blockId, nextRaw, start + text.length, {
      source: 'paste',
      coalesceKey: null,
      selection,
    });
    state.suppressNextInput = true;
    return;
  }

  if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteWordBackward') {
    e.preventDefault();
    if (start !== end) {
      applyModelBlockUpdate(blockId, raw.slice(0, start) + raw.slice(end), start, {
        source: 'delete',
        selection,
      });
      state.suppressNextInput = true;
      return;
    }
    if (start === 0) {
      const visibleBlocks = state.editorSession.document.blocks.filter(item => !item.attrs?.separator);
      const index = visibleBlocks.findIndex(item => item.id === blockId);
      const previous = visibleBlocks[index - 1];
      if (!previous) return;
      const transaction = state.editorSession.createTransaction({ source: 'delete' });
      transaction.replace(previous.id, previous.raw + raw);
      transaction.remove(blockId);
      const result = state.editorSession.apply(transaction);
      state.currentContent = serializeDocument(result.document);
      state.selection = createSelection(
        createPosition(previous.id, previous.raw.length),
        createPosition(previous.id, previous.raw.length),
      );
      syncIncrementalBlocks(result.changedBlockIds);
      updateWordCount();
      scheduleAutoSave();
      state.suppressNextInput = true;
      return;
    }
    const deleteStart = deleteCodePointBackward(raw, start);
    applyModelBlockUpdate(blockId, raw.slice(0, deleteStart) + raw.slice(end), deleteStart, {
      source: 'delete',
      selection,
    });
    state.suppressNextInput = true;
    return;
  }

  if (e.inputType === 'deleteContentForward' || e.inputType === 'deleteWordForward') {
    e.preventDefault();
    if (start !== end) {
      applyModelBlockUpdate(blockId, raw.slice(0, start) + raw.slice(end), start, {
        source: 'delete',
        selection,
      });
      state.suppressNextInput = true;
      return;
    }
    const deleteEnd = deleteCodePointForward(raw, end);
    applyModelBlockUpdate(blockId, raw.slice(0, start) + raw.slice(deleteEnd), start, {
      source: 'delete',
      selection,
    });
    state.suppressNextInput = true;
  }
}

function renderBlockFromSource(source, block) {
  const raw = (source.textContent || '').replace(/\u200B/g, '');
  const blockType = parseSingleBlock(raw, block);
  block.className = getBlockClassName(blockType, true);
  block.dataset.blockType = blockType.type;
  const newHtml = blockType.raw
    ? sanitizeHtml(marked.parse(blockType.raw, { breaks: true, gfm: true }))
    : '<p><br></p>';
  const renderedEl = block.querySelector('.block-rendered');
  if (renderedEl) {
    renderedEl.innerHTML = newHtml || '<p><br></p>';
  }
}

function onBlockCompositionStart(e) {
  const source = e.target;
  const block = source.closest('.block');
  if (!block) return;
  state.isDirty = true;
  compositionController.start({
    blockId: block.dataset.blockId,
    raw: source.textContent || '',
  });
}

function onBlockCompositionUpdate(e) {
  compositionController.update(e.data || '');
  updateWordCount();
}

function onBlockCompositionEnd(e) {
  const source = e.target;
  const block = source.closest('.block');
  if (!block || !compositionController.isActive()) return;
  const result = compositionController.end({
    raw: source.textContent || '',
  });
  if (result?.changed && state.editorSession?.document) {
    const transaction = state.editorSession
      .createTransaction({ source: 'composition' })
      .replace(result.blockId, result.afterRaw);
    const sessionResult = state.editorSession.apply(transaction);
    state.currentContent = serializeDocument(sessionResult.document);
    state.suppressNextInput = true;
  }
  renderBlockFromSource(source, block);
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(source);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  captureBlockSelection();
  updateWordCount();
  scheduleAutoSave();
  if (result?.transaction) {
    block.dataset.compositionCommitted = 'true';
  }
}

function onBlockCompositionCancel() {
  if (!compositionController.isActive()) return;
  compositionController.cancel();
}

function onBlockDragOver(e) {
  if (e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('text/plain')) {
    e.preventDefault();
  }
}

async function onBlockDrop(e) {
  const source = e.target.closest?.('.block-source');
  const block = source?.closest?.('.block');
  if (!source || !block || !state.editorSession?.document) return;
  const modelBlock = state.editorSession.document.getBlock(block.dataset.blockId);
  if (!modelBlock) return;
  const files = [...(e.dataTransfer?.files || [])];
  const text = e.dataTransfer?.getData('text/plain') || '';
  if (!text && files.length === 0) return;
  e.preventDefault();
  const selection = domSelectionToModel(qs('#block-editor'));
  const offset = selection?.anchor.offset ?? modelBlock.raw.length;
  let inserted = text;
  if (!inserted && files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('image/')) {
      inserted = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(`![${file.name}](${reader.result})`);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });
    } else {
      inserted = await file.text();
    }
  }
  if (!inserted) return;
  const raw = modelBlock.raw.slice(0, offset) + inserted + modelBlock.raw.slice(offset);
  applyModelBlockUpdate(modelBlock.id, raw, offset + inserted.length, {
    source: 'drop',
    coalesceKey: null,
    selection,
  });
}

function onBlockKeydown(e) {
  const source = e.target;
  const block = source.closest('.block');
  if (!block) return;
  const idx = parseInt(block.dataset.blockIndex);
  const isCmd = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (isCmd && key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undoEditor();
    return;
  }
  if (isCmd && ((key === 'z' && e.shiftKey) || key === 'y')) {
    e.preventDefault();
    redoEditor();
    return;
  }

  if (isCmd && key === 'b') {
    e.preventDefault();
    executeEditorCommand('toggleStrong');
    return;
  }
  if (isCmd && key === 'i') {
    e.preventDefault();
    executeEditorCommand('toggleEmphasis');
    return;
  }
  if (isCmd && e.shiftKey && key === 'x') {
    e.preventDefault();
    executeEditorCommand('toggleStrike');
    return;
  }
  if (isCmd && e.altKey && key === '1') {
    e.preventDefault();
    executeEditorCommand('toggleHeading');
    return;
  }
  if (isCmd && e.altKey && key === 't') {
    e.preventDefault();
    executeEditorCommand('insertTable');
    return;
  }
  if (isCmd && e.shiftKey && key === 'd') {
    e.preventDefault();
    executeEditorCommand('duplicateBlock');
    return;
  }
  if (e.altKey && e.key === 'ArrowUp') {
    e.preventDefault();
    executeEditorCommand('moveBlockUp');
    return;
  }
  if (e.altKey && e.key === 'ArrowDown') {
    e.preventDefault();
    executeEditorCommand('moveBlockDown');
    return;
  }
  if (e.key === 'Tab' && state.editorSession?.document) {
    const modelBlock = state.editorSession.document.getBlock(block.dataset.blockId);
    if (modelBlock?.type === 'code') {
      e.preventDefault();
      const selection = domSelectionToModel(qs('#block-editor'));
      const offset = selection?.anchor.offset ?? (source.textContent || '').length;
      const spaces = e.shiftKey ? '' : '  ';
      const raw = modelBlock.raw.slice(0, offset) + spaces + modelBlock.raw.slice(offset);
      applyModelBlockUpdate(modelBlock.id, raw, offset + spaces.length, {
        source: 'input',
        coalesceKey: `input:${modelBlock.id}`,
      });
      return;
    }
  }

  // Enter → 在下方分割出新块
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (state.editorSession?.document) {
      const blockId = block.dataset.blockId;
      const raw = source.textContent || '';
      const selection = window.getSelection();
      const cursorPos = selection?.rangeCount
        ? selection.getRangeAt(0).endOffset
        : raw.length;
      const transaction = state.editorSession
        .createTransaction({ source: 'keyboard' })
        .split(blockId, cursorPos);
      const result = state.editorSession.apply(transaction);
      state.currentContent = serializeDocument(result.document);
      const documentIndex = result.document.getBlockIndex(blockId);
      const rightBlock = result.document.blocks[documentIndex + 1];
      if (rightBlock) {
        state.selection = createSelection(
          createPosition(rightBlock.id, 0),
          createPosition(rightBlock.id, 0),
        );
        const visibleIndex = result.document.blocks
          .filter(item => !item.attrs?.separator)
          .findIndex(item => item.id === rightBlock.id);
        state.selectionIndex = visibleIndex;
        activeBlockIndex = visibleIndex;
      }
      syncIncrementalBlocks(result.changedBlockIds);
      updateWordCount();
      scheduleAutoSave();
      return;
    }
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const cursorPos = range.endOffset;
    const text = source.textContent || '';
    const beforeCursor = text.substring(0, cursorPos);
    const afterCursor = text.substring(cursorPos);

    // 更新当前块内容
    source.textContent = beforeCursor;
    block.classList.remove('active');
    block.dataset.blockIndex = idx;
    source.contentEditable = 'false';

    // 渲染当前块的 HTML
    const raw = (beforeCursor || '').replace(/\u200B/g, '');
    if (!raw.trim()) {
      const renderedEl = block.querySelector('.block-rendered');
      if (renderedEl) renderedEl.innerHTML = '<p><br></p>';
    }

    // 插入新块
    const newIdx = insertBlockAfter(idx, afterCursor || '');
    if (newIdx !== undefined) {
      activeBlockIndex = newIdx;
      const container = qs('#block-editor');
      const newBlock = container.querySelectorAll('.block')[newIdx];
      if (newBlock) {
        newBlock.classList.add('active');
        const newSource = newBlock.querySelector('.block-source');
        if (newSource) {
          newSource.contentEditable = 'true';
          newSource.focus();
        }
      }
    }
    return;
  }

  // Backspace 在空块开头 → 合并到上一个块
  if (e.key === 'Backspace') {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.startOffset === 0 && range.collapsed) {
      const text = (source.textContent || '').replace(/\u200B/g, '');
      if (text === '' && idx > 0) {
        e.preventDefault();
        if (state.editorSession?.document) {
          const blockId = block.dataset.blockId;
          const transaction = state.editorSession
            .createTransaction({ source: 'keyboard' })
            .remove(blockId);
          const result = state.editorSession.apply(transaction);
          state.currentContent = serializeDocument(result.document);
          const visibleBlocks = result.document.blocks.filter(item => !item.attrs?.separator);
          const previous = visibleBlocks[Math.max(0, idx - 1)];
          if (previous) {
            state.selection = createSelection(
              createPosition(previous.id, previous.raw.length),
              createPosition(previous.id, previous.raw.length),
            );
            state.selectionIndex = Math.max(0, idx - 1);
            activeBlockIndex = state.selectionIndex;
          }
          syncIncrementalBlocks(result.changedBlockIds);
          updateWordCount();
          scheduleAutoSave();
          return;
        }
        // 删除当前块
        const container = qs('#block-editor');
        const blockEls = container.querySelectorAll('.block');
        const newIdx = idx - 1;
        blockEls[idx].remove();
        container.querySelectorAll('.block').forEach((el, i) => {
          el.dataset.blockIndex = i;
        });
        hookBlockEvents();
        activeBlockIndex = newIdx;
        // 激活上一个块并移到末尾
        const prevBlock = container.querySelectorAll('.block')[newIdx];
        if (prevBlock) {
          prevBlock.classList.add('active');
          const prevSource = prevBlock.querySelector('.block-source');
          if (prevSource) {
            prevSource.contentEditable = 'true';
            prevSource.focus();
            const sr = document.createRange();
            sr.selectNodeContents(prevSource);
            sr.collapse(false);
            sel.removeAllRanges();
            sel.addRange(sr);
          }
        }
        return;
      }
    }
  }

  // ArrowUp → 激活上一个块
  if (e.key === 'ArrowUp') {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.startOffset === 0 && range.collapsed && idx > 0) {
      e.preventDefault();
      activateBlock(idx - 1);
      return;
    }
  }

  // ArrowDown → 激活下一个块
  if (e.key === 'ArrowDown') {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const container = qs('#block-editor');
    const blockEls = container.querySelectorAll('.block');
    if (range.endOffset >= (source.textContent || '').length && range.collapsed && idx < blockEls.length - 1) {
      e.preventDefault();
      activateBlock(idx + 1);
      return;
    }
  }
}

function onContainerClick(e) {
  // 点击块编辑器空白区域 → 激活最后一个块
  if (e.target.id !== 'block-editor') return;
  const container = qs('#block-editor');
  const blocks = container.querySelectorAll('.block');
  if (blocks.length > 0) {
    activateBlock(blocks.length - 1);
  }
}

// ============================================================
// 首页（启动画面）
// ============================================================
async function renderHome() {
  state.view = 'home';

  // 加载最近文件
  let recentFiles = [];
  try { recentFiles = await ListRecentFiles(15) || []; } catch (e) {}

  const recentHtml = recentFiles.length > 0 ? recentFiles.map(f => `
    <button class="home-recent-item" data-path="${escapeHtml(f.path)}">
      <svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
      <span class="home-recent-name">${escapeHtml(f.name)}</span>
      <span class="home-recent-path">${escapeHtml(f.path)}</span>
    </button>
  `).join('') : `<span class="home-recent-empty">暂无最近文件</span>`;

  $app.innerHTML = `
    <div class="home-shell">
      <div class="window-drag-bar"></div>
      <!-- 左侧：文档库入口面板 -->
      <div class="home-file-panel">
        <div class="welcome-panel">
          <div class="welcome-panel-inner">
            <div class="welcome-panel-hero">
              <img src="/logo.png" alt="Markdown Writing" class="welcome-panel-logo" />
              <h1>Markdown Writing</h1>
              <p>轻量级 Markdown 写作工具</p>
            </div>
            <div class="welcome-panel-actions" id="home-actions-panel">
              <button class="welcome-panel-btn" id="home-action-library">
                <svg data-lucide="library" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                <span>文档库</span>
              </button>
              <button class="welcome-panel-btn" id="home-action-new-doc">
                <svg data-lucide="file-plus" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                <span>新建文档</span>
              </button>
              <button class="welcome-panel-btn" id="home-action-open-file">
                <svg data-lucide="file-up" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                <span>打开文件</span>
              </button>
              <button class="welcome-panel-btn" id="home-action-open-folder">
                <svg data-lucide="folder-open" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                <span>打开文件夹</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧面板 -->
      <div class="home-sidebar">
        <div class="home-sidebar-inner">
          <div class="home-hero">
            <img src="/logo.png" alt="Markdown Writing" class="home-logo" />
            <h1>Markdown Writing</h1>
            <p>轻量级 Markdown 写作工具</p>
          </div>

          <div class="home-recent">
            <div class="home-recent-header">
              <svg data-lucide="clock" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>最近打开</span>
            </div>
            <div class="home-recent-list" id="home-recent-list">${recentHtml}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  lucideIcons();

  // 文档库
  qs('#home-action-library')?.addEventListener('click', async () => {
    state.isDBMode = true;
    await initLibrary();
  });

  // 新建文档（内存创建，不写DB）
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

  // 打开文件
  qs('#home-action-open-file')?.addEventListener('click', async () => {
    state.isDBMode = false;
    try {
      const path = await OpenDocumentFile();
      if (!path) return;
      const meta = await ReadDocumentWithMeta(path);
      const content = meta.content;
      const name = path.split('/').pop().replace(/\\/g, '/').split('/').pop();
      const dir = path.substring(0, path.lastIndexOf('/')) || '/';
      state.docDir = dir;
      state.currentDoc = { name, path, size: content.length, modTime: '' };
      state.currentContent = content;
      state.currentRevision = meta.revision || 0;
      state.currentHash = meta.contentHash || '';
      safety.startFileWatcher(path);
      state.view = 'editor';
      try { AddRecentFile(path, name); } catch (e) {}
      try {
        state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
      } catch (e) { state.docs = []; }
      renderEditor();
    } catch (e) { if (e && e.message !== 'canceled') console.error(e); }
  });

  // 打开文件夹
  qs('#home-action-open-folder')?.addEventListener('click', async () => {
    state.isDBMode = false;
    try {
      const dir = await SelectDocumentDir();
      if (dir) { state.docDir = dir; await initLibrary(); }
    } catch (e) { if (e && e.message !== 'canceled') console.error(e); }
  });

  // 最近文件点击
  qs('#home-recent-list')?.addEventListener('click', async (e) => {
    const item = e.target.closest('.home-recent-item');
    if (!item) return;
    const path = item.dataset.path;
    state.isDBMode = false;
    try {
      const meta = await ReadDocumentWithMeta(path);
      const content = meta.content;
      const name = path.split('/').pop();
      const dir = path.substring(0, path.lastIndexOf('/')) || '/';
      state.docDir = dir;
      state.currentDoc = { name, path, size: content.length, modTime: '' };
      state.currentContent = content;
      state.currentRevision = meta.revision || 0;
      state.currentHash = meta.contentHash || '';
      safety.startFileWatcher(path);
      state.view = 'editor';
      try { AddRecentFile(path, name); } catch (e) {}
      try {
        state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
      } catch (e) { state.docs = []; }
      renderEditor();
    } catch (e) { console.error('打开最近文件失败:', e); }
  });
}

// ============================================================
// 欢迎页（选择目录）
// ============================================================
function renderWelcome() {
  $app.innerHTML = `
    <div class="welcome-overlay" id="welcome">
      <div class="welcome-dialog">
        <svg data-lucide="book-open" width="56" height="56" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
        <h1>欢迎使用 Markdown Writing</h1>
        <p>选择一个文件夹作为你的文档目录，所有文章将以 .md 文件保存在其中。</p>
        <button class="btn-primary" id="btn-select-dir" style="height:44px;padding:0 28px;font-size:15px;">
          <svg data-lucide="folder-open" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          选择文档目录
        </button>
      </div>
    </div>
  `;
  lucideIcons();
  qs('#btn-select-dir').addEventListener('click', selectDir);
}

async function selectDir() {
  try {
    const dir = await SelectDocumentDir();
    if (dir) {
      state.docDir = dir;
      await initLibrary();
    }
  } catch (e) {
    if (e && e.message !== 'canceled') console.error(e);
  }
}

// ============================================================
// 文档库视图
// ============================================================
async function initLibrary() {
  state.view = 'editor';
  state.isEditor = true;
  state.currentDoc = null;
  state.currentContent = '';
  state.currentRevision = 0;
  state.currentHash = '';
  state.selection = null;
  state.selectionIndex = null;
  compositionController.cancel();
  state.editorSession = null;
  resetParseResult();
  safety.stopFileWatcher();

  if (state.isDBMode) {
    state.docs = await DBListDocuments() || [];
    state.docTree = state.docs.map(d => ({
      name: d.name,
      path: 'db:' + d.id,
      size: d.size,
      modTime: d.modTime,
      isDir: false,
      _dbId: d.id,
    }));
  } else {
    const docs = await ListDocuments(state.docDir) || [];
    state.docs = docs.filter(d => d.name.endsWith('.md') || d.isDir);
    try {
      state.docTree = await ListDocumentTree(state.docDir) || [];
    } catch (e) {
      state.docTree = [];
    }
  }
  renderEditor();
  saveAppState();
}

// 为 .md 文档抓取一行摘要（去除 Markdown 标记）
async function fetchDocPreviews() {
  const mdDocs = state.docs.filter(d => d.name.endsWith('.md') && !d.preview).slice(0, 30);
  let changed = false;
  await Promise.all(mdDocs.map(async (doc) => {
    try {
      const raw = await ReadDocument(doc.path);
      if (!raw) return;
      const line = raw
        .split('\n')
        .map(s => s.trim())
        .find(s => s && !s.startsWith('#') && !s.startsWith('---')) || '';
      const clean = line
        .replace(/^[>*\-+\d\.\)\s]+/, '')
        .replace(/[*_`~]/g, '')
        .trim();
      if (clean) {
        doc.preview = clean.length > 60 ? clean.slice(0, 60) + '…' : clean;
        changed = true;
      }
    } catch (e) {
      /* 忽略读取错误 */
    }
  }));
  return changed;
}

function renderLibrary() {
  const mdDocs = state.docs;
  const isEmpty = mdDocs.length === 0;
  const isDB = state.isDBMode;

  let cardsHtml = '';
  if (!isEmpty) {
    cardsHtml = '<div class="doc-grid">';
    for (const doc of mdDocs) {
      const preview = escapeHtml(doc.preview || '');
      const wordNum = doc.size > 0 ? Math.max(1, Math.round(doc.size / 3)) + ' 字' : '空';
      const clickAttr = isDB ? `data-id="${doc.id}"` : `data-path="${escapeHtml(doc.path)}"`;
      cardsHtml += `
        <div class="doc-card" ${clickAttr}>
          <div class="doc-card-summary">
            <svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <span class="doc-card-summary-text">${preview || '—'}</span>
          </div>
          <div class="doc-card-title">${escapeHtml(isDB ? doc.name.replace(/\.md$/i,'') : fileNameWithoutExt(doc.name))}</div>
          <div class="doc-card-meta">
            <span>${formatDate(doc.modTime)}</span>
            <span>${wordNum}</span>
          </div>
        </div>
      `;
    }
    cardsHtml += '</div>';
  }

  const mainContent = isEmpty ? `
    <div class="empty-state">
      <svg class="empty-state-icon" data-lucide="pen-line" width="72" height="72" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
      <div class="empty-state-title">开始你的第一篇文字</div>
      <div class="empty-state-hint">点击「+ 新建文档」</div>
    </div>
  ` : cardsHtml;

  $app.innerHTML = `
    <div class="view-shell" id="library-view">
      <div class="window-drag-bar"></div>
      <header class="library-titlebar">
        <span class="library-title">文档库</span>
        <button class="btn-primary" id="btn-new-doc">
          <svg data-lucide="plus" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          新建文档
        </button>
      </header>
      <main class="library-main">
        ${mainContent}
      </main>
      <footer class="statusbar">
        <span>共 ${mdDocs.length} 篇文档</span>
        <span id="last-edited">${mdDocs.length > 0 ? '最近编辑：' + formatDate(mdDocs[0].modTime) : ''}</span>
      </footer>
    </div>
  `;

  lucideIcons();

  // Events
  qs('#btn-new-doc').addEventListener('click', createNewDoc);

  if (!isEmpty) {
    document.querySelectorAll('.doc-card').forEach(card => {
      card.addEventListener('click', () => {
        if (isDB) {
          const id = parseInt(card.dataset.id);
          const doc = state.docs.find(d => d.id === id);
          if (doc) openEditor(doc);
        } else {
          const path = card.dataset.path;
          const doc = state.docs.find(d => d.path === path);
          if (doc) openEditor(doc);
        }
      });
    });
  }
}

// ============================================================
// 编辑器视图
// ============================================================
async function openEditor(doc) {
  state.currentDoc = doc;
  state.view = 'editor';
  state.isEditor = true;
  state.currentRevision = 0;
  state.currentHash = '';
  state.selection = null;
  state.selectionIndex = null;
  compositionController.cancel();
  state.editorSession = null;
  resetParseResult();

  if (state.isDBMode && doc.id) {
    try {
      const result = await DBReadDocument(doc.id);
      if (result) {
        state.currentContent = result.content || '';
        state.currentRevision = result.revision || 0;
        state.currentDoc.name = result.name || doc.name;
      } else {
        state.currentContent = '';
      }
    } catch (e) {
      state.currentContent = '';
    }
    safety.stopFileWatcher();
  } else if (doc.path) {
    try {
      const result = await ReadDocumentWithMeta(doc.path);
      state.currentContent = result?.content ?? await ReadDocument(doc.path);
      state.currentRevision = result?.revision || 0;
      state.currentHash = result?.contentHash || '';
      safety.startFileWatcher(doc.path);
      if (result?.changed) safety.showExternalChangeDialog(result);
    } catch (e) {
      state.currentContent = '';
      safety.stopFileWatcher();
    }
    // 记录最近打开文件
    try { AddRecentFile(doc.path, doc.name); } catch (e) {}
    // 打开某个文档时自动展开其所在的所有父级目录
    if (doc && doc.path) {
      let parent = doc.path.replace(/[\\/][^\\/]+$/, '');
      while (parent && parent.startsWith(state.docDir) && parent !== state.docDir) {
        state.expandedDirs.add(parent);
        parent = parent.replace(/[\\/][^\\/]+$/, '');
      }
    }
  }

  renderEditor();
  saveAppState();
}

// 根据路径在文件树中查找文档节点
function renderEditor() {
  const name = state.currentDoc ? fileNameWithoutExt(state.currentDoc.name) : '未命名';
  const wc = wordCount(state.currentContent || '');
  const hasDoc = !!state.currentDoc;

  // Build file tree (recursive from state.docTree)
  const fileTreeHtml = buildFileTreeHtml(state.docTree, 0);

  // Build right panel content
  let rightPanelHtml;
  if (hasDoc) {
    rightPanelHtml = `
      <header class="editor-titlebar" id="editor-view-titlebar">
        <span class="titlebar-title" id="editor-title"><svg data-lucide="file-text" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5" class="titlebar-md-icon"></svg>${escapeHtml(name)}.md${state.isDirty ? ' *' : ''}</span>
        <button class="sidebar-icon" id="btn-toggle-panel" title="切换侧栏">
          <svg data-lucide="panel-left" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
        </button>
        <button class="sidebar-icon" id="btn-history" title="版本历史">
          <svg data-lucide="history" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
        </button>
        <button class="sidebar-icon" id="btn-delete-doc" title="移到回收站">
          <svg data-lucide="trash-2" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
        </button>
        <div class="export-wrapper" id="export-wrapper">
          <button class="sidebar-icon" id="btn-export" title="导出">
            <svg data-lucide="download" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          </button>
          <div class="export-dropdown hidden" id="export-dropdown">
            <button class="export-item" data-format="png"><svg data-lucide="image" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>图片 (PNG)</span></button>
            <button class="export-item" data-format="pdf"><svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>PDF</span></button>
            <button class="export-item" data-format="docx"><svg data-lucide="file-type" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>Word (.doc)</span></button>
            <button class="export-item" data-format="md"><svg data-lucide="file-code" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>Markdown</span></button>
            <button class="export-item" data-format="txt"><svg data-lucide="align-left" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>纯文本</span></button>
          </div>
        </div>
      </header>

      <div class="editor-content" id="editor-scroll">
        <div class="editor-paper" id="editor-paper">
          <div id="block-editor">
            ${buildBlockEditorHtml(state.currentContent || '')}
          </div>
        </div>
        <textarea class="editor-source" id="editor-source" spellcheck="false">${escapeHtml(state.currentContent || '')}</textarea>
      </div>

      <footer class="statusbar">
        <div class="statusbar-left">
          <span id="mode-indicator">
            <svg data-lucide="${state.sourceMode ? 'code' : 'eye'}" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <span>${state.sourceMode ? '源码' : '预览'}</span>
          </span>
        </div>
        <div class="statusbar-right">
          <span id="line-count">行数：${String(state.currentContent || '').split('\n').length}</span>
          <span class="statusbar-divider">|</span>
          <span id="word-count">字数：${wc}</span>
        </div>
      </footer>`;
  } else {
    // 无文档时的欢迎面板
    rightPanelHtml = `
      <div class="welcome-panel" id="welcome-panel">
        <div class="welcome-panel-inner">
          <div class="welcome-panel-hero">
            <img src="/logo.png" alt="Markdown Writing" class="welcome-panel-logo" />
            <h1>Markdown Writing</h1>
            <p>轻量级 Markdown 写作工具</p>
          </div>
          <div class="welcome-panel-actions" id="welcome-panel-actions">
            <button class="welcome-panel-btn" id="wp-new-doc">
              <svg data-lucide="file-plus" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>新建文档</span>
            </button>
            <button class="welcome-panel-btn" id="wp-open-file">
              <svg data-lucide="file-up" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>打开文件</span>
            </button>
            <button class="welcome-panel-btn" id="wp-open-folder">
              <svg data-lucide="folder-open" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>打开文件夹</span>
            </button>
          </div>
          <div class="welcome-panel-recent" id="welcome-panel-recent-container">
            <div class="welcome-panel-recent-header">
              <svg data-lucide="clock" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>最近打开</span>
            </div>
            <div class="welcome-panel-recent-list" id="welcome-panel-recent-list">
              <span class="welcome-panel-recent-empty">加载中...</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  $app.innerHTML = `
    <div class="view-shell" id="editor-view">
      <div class="window-drag-bar"></div>
      <div class="editor-body">
        <!-- 文件树侧栏（含独立顶部标题栏） -->
        <aside class="file-tree ${state.sidebarCollapsed ? 'collapsed' : ''}" id="file-tree-container" style="width:${state.sidebarCollapsed ? 0 : state.sidebarWidth}px;">
          <header class="sidebar-titlebar with-traffic-lights">
            <div class="sidebar-header">
              <span class="sidebar-title" id="sidebar-title">Markdown Writing</span>
            </div>
          </header>
          <div class="sidebar-toolbar">
            <button class="sidebar-icon" id="btn-back" title="返回文档库">
              <svg data-lucide="library" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            </button>
            <span class="sidebar-toolbar-divider">｜</span>
            <div class="sidebar-toolbar-right">
              <button class="sidebar-icon" id="sidebar-toggle" title="切换视图">
                <svg data-lucide="folder" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </button>
              <button class="sidebar-icon" id="sidebar-search-btn" title="搜索">
                <svg data-lucide="search" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </button>
            </div>
          </div>
          <div class="sidebar-section-title" id="sidebar-section-title">文件</div>
          <div class="sidebar-search hidden" id="sidebar-search">
            <svg data-lucide="search" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <input type="text" class="sidebar-search-input" id="sidebar-search-input" placeholder="搜索文件" />
          </div>
          <nav class="file-tree-nav" id="file-tree-nav">
            ${fileTreeHtml || '<div class="sidebar-empty">打开文件夹</div>'}
          </nav>
          <div class="file-tree-outline hidden" id="file-tree-outline">
            <div class="outline-list" id="outline-list"></div>
          </div>
          <div class="sidebar-footer">
            <button class="sidebar-footer-btn" id="btn-settings" title="设置">
              <svg data-lucide="settings" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>设置</span>
            </button>
            <button class="sidebar-footer-btn" id="btn-recycle-bin" title="回收站">
              <svg data-lucide="trash-2" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>回收站</span>
            </button>
          </div>
          <div class="sidebar-resizer" id="sidebar-resizer" title="拖动调整宽度"></div>
        </aside>

        <!-- 折叠后：左侧边缘悬浮展开按钮 -->
        <button class="sidebar-reopen ${state.sidebarCollapsed ? 'visible' : ''}" id="sidebar-reopen" title="展开侧边栏">
          <svg data-lucide="chevron-right" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.8"></svg>
        </button>

        <!-- 写作区 -->
        <div class="editor-writing-area">
          ${rightPanelHtml}
        </div>
      </div>
    </div>
  `;

  lucideIcons();
  hookEditorEvents();

  if (hasDoc) {
    hookBlockEvents();
    restoreBlockSelection();
    const parseResult = getLastParseResult();
    const blockEditor = qs('#block-editor');
    if (blockEditor) {
      blockEditor.dataset.parserStrategy = parseResult?.strategy || 'unknown';
      blockEditor.classList.toggle(
        'large-document',
        (parseResult?.document?.blocks?.length || 0) > 200,
      );
      if (parseResult?.error) {
        blockEditor.dataset.parserFallback = String(parseResult.error.message || parseResult.error);
      }
    }
    if (parseResult?.document) {
      const modelMarkdown = serializeDocument(parseResult.document);
      if (!state.editorSession || modelMarkdown !== state.currentContent) {
        state.editorSession = createEditorSession(parseResult.document, state.selection);
      }
      if (blockEditor) {
        blockEditor.dataset.sessionReady = String(Boolean(state.editorSession));
      }
    }

    // 处理源码模式初始状态
    if (state.sourceMode) {
      const paper = qs('#editor-paper');
      const sourceEditor = qs('#editor-source');
      if (paper) paper.style.display = 'none';
      if (sourceEditor) {
        sourceEditor.style.display = 'block';
        autoResizeTextarea(sourceEditor);
        sourceEditor.focus();
      }
    }

    // Focus the editor
    setTimeout(() => {
      if (state.sourceMode) {
        const se = qs('#editor-source');
        if (se) { se.focus(); autoResizeTextarea(se); }
      } else {
        const paper = qs('#editor-paper');
        if (paper) paper.focus();
      }
    }, 100);
  } else {
    // 欢迎面板事件 + 加载最近文件
    hookWelcomePanelEvents();
    loadWelcomePanelRecentFiles();
  }
}

// ============================================================
// 欢迎面板（无文档打开时显示在右侧）
// ============================================================
async function loadWelcomePanelRecentFiles() {
  const listEl = qs('#welcome-panel-recent-list');
  if (!listEl) return;
  try {
    const recentFiles = await ListRecentFiles(15) || [];
    if (recentFiles.length > 0) {
      listEl.innerHTML = recentFiles.map(f => `
        <button class="welcome-panel-recent-item" data-path="${escapeHtml(f.path)}">
          <svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          <span class="welcome-panel-recent-name">${escapeHtml(f.name)}</span>
          <span class="welcome-panel-recent-path">${escapeHtml(f.path)}</span>
        </button>
      `).join('');
    } else {
      listEl.innerHTML = '<span class="welcome-panel-recent-empty">暂无最近文件</span>';
    }
    lucideIcons();
  } catch (e) {
    listEl.innerHTML = '<span class="welcome-panel-recent-empty">暂无最近文件</span>';
  }
}

function hookWelcomePanelEvents() {
  const btn = qs('#wp-new-doc');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.currentDoc = { id: null, name: '未命名.md' };
    state.currentContent = '';
    state.currentRevision = 0;
    state.currentHash = '';
    state.isDirty = false;
    renderEditor();
  });

  const btnFile = qs('#wp-open-file');
  if (btnFile) {
    btnFile.addEventListener('click', async () => {
      state.isDBMode = false;
      try {
        const path = await OpenDocumentFile();
        if (!path) return;
        const meta = await ReadDocumentWithMeta(path);
        const content = meta.content;
        const name = path.split('/').pop();
        const dir = path.substring(0, path.lastIndexOf('/')) || '/';
        state.docDir = dir;
        state.currentDoc = { name, path, size: content.length, modTime: '' };
        state.currentContent = content;
        state.currentRevision = meta.revision || 0;
        state.currentHash = meta.contentHash || '';
        safety.startFileWatcher(path);
        try { AddRecentFile(path, name); } catch (e) {}
        renderEditor();
      } catch (e) { if (e && e.message !== 'canceled') console.error(e); }
    });
  }

  const btnFolder = qs('#wp-open-folder');
  if (btnFolder) {
    btnFolder.addEventListener('click', async () => {
      state.isDBMode = false;
      try {
        const dir = await SelectDocumentDir();
        if (dir) {
          state.docDir = dir;
          state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
          state.docTree = (await ListDocumentTree(dir) || []);
          renderEditor();
        }
      } catch (e) { if (e && e.message !== 'canceled') console.error(e); }
    });
  }

  // 最近文件点击
  qs('#welcome-panel-recent-list')?.addEventListener('click', async (e) => {
    const item = e.target.closest('.welcome-panel-recent-item');
    if (!item) return;
    const path = item.dataset.path;
    state.isDBMode = false;
    try {
      const meta = await ReadDocumentWithMeta(path);
      const content = meta.content;
      const name = path.split('/').pop();
      const dir = path.substring(0, path.lastIndexOf('/')) || '/';
      state.docDir = dir;
      state.currentDoc = { name, path, size: content.length, modTime: '' };
      state.currentContent = content;
      state.currentRevision = meta.revision || 0;
      state.currentHash = meta.contentHash || '';
      safety.startFileWatcher(path);
      try { AddRecentFile(path, name); } catch (e) {}
      try {
        state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
        state.docTree = (await ListDocumentTree(dir) || []);
      } catch (e) { state.docTree = []; }
      renderEditor();
    } catch (e) { console.error('打开最近文件失败:', e); }
  });
}

// ============================================================
// 编辑器事件绑定
// ============================================================
let autoSaveTimer = null;

let currentSidebarView = 'filetree';
let editorDocumentEventsBound = false;

function toggleSidebarPanel() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  const container = qs('#file-tree-container');
  const reopen = qs('#sidebar-reopen');
  if (state.sidebarCollapsed) {
    if (container) { container.classList.add('collapsed'); container.style.width = '0px'; }
    if (reopen) reopen.classList.add('visible');
  } else {
    if (container) { container.classList.remove('collapsed'); container.style.width = state.sidebarWidth + 'px'; }
    if (reopen) reopen.classList.remove('visible');
  }
}

function toggleSidebarView() {
  currentSidebarView = currentSidebarView === 'filetree' ? 'outline' : 'filetree';
  updateSidebarView();
}

function updateSidebarView() {
  const tree = qs('#file-tree-nav');
  const outline = qs('#file-tree-outline');
  const toggle = qs('#sidebar-toggle');
  const sectionTitle = qs('#sidebar-section-title');
  const searchBtn = qs('#sidebar-search-btn');

  if (currentSidebarView === 'filetree') {
    tree?.classList.remove('hidden');
    outline?.classList.add('hidden');
    searchBtn?.classList.remove('icon-placeholder');
    if (toggle) toggle.innerHTML = '<svg data-lucide="folder" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>';
    if (sectionTitle) sectionTitle.textContent = '文件';
    lucideIcons();
  } else {
    tree?.classList.add('hidden');
    outline?.classList.remove('hidden');
    searchBtn?.classList.add('icon-placeholder');
    if (toggle) toggle.innerHTML = '<svg data-lucide="list" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>';
    if (sectionTitle) sectionTitle.textContent = '大纲';
    lucideIcons();
    generateOutline();
  }
  // Hide search when switching views
  qs('#sidebar-search')?.classList.add('hidden');
  qs('#sidebar-search-input').value = '';
}

let searchVisible = false;
function toggleSearch() {
  searchVisible = !searchVisible;
  const searchBox = qs('#sidebar-search');
  if (searchVisible) {
    searchBox?.classList.remove('hidden');
    qs('#sidebar-search-input')?.focus();
  } else {
    searchBox?.classList.add('hidden');
    qs('#sidebar-search-input').value = '';
    filterFiles('');
  }
}

function filterFiles(query) {
  const items = document.querySelectorAll('.file-item');
  items.forEach(item => {
    const name = item.querySelector('.file-item-name')?.textContent || '';
    item.style.display = name.toLowerCase().includes(query.toLowerCase()) ? '' : 'none';
  });
}

function generateOutline() {
  const listDiv = qs('#outline-list');
  if (!listDiv) return;

  const headingBlocks = document.querySelectorAll('#block-editor .block-heading');
  if (headingBlocks.length === 0) {
    listDiv.innerHTML = '<div class="sidebar-empty">当前文档没有标题。</div>';
    return;
  }

  const levelColors = {
    1: '#5c89f2',
    2: '#4caf80',
    3: '#7bc4d4',
    4: '#a8c4d4'
  };

  let html = '';
  headingBlocks.forEach(block => {
    const classList = [...block.classList];
    const levelClass = classList.find(c => c.startsWith('block-h'));
    const level = levelClass ? parseInt(levelClass.replace('block-h', '')) : 1;
    const source = block.querySelector('.block-source');
    const text = source ? (source.textContent || '').replace(/^#{1,6}\s+/, '') : '';
    const indent = (level - 1) * 16;
    const color = levelColors[level] || levelColors[4];
    html += '<div class="outline-item" data-block-index="' + (block.dataset.blockIndex || '0') + '" style="padding-left:' + (8 + indent) + 'px;">';
    html += '<span class="outline-badge" style="background:' + color + ';">H' + level + '</span>';
    html += '<span class="outline-text">' + escapeHtml(text) + '</span>';
    html += '</div>';
  });
  listDiv.innerHTML = html;
}

function hookSidebarResize() {
  const container = qs('#file-tree-container');
  const resizer = qs('#sidebar-resizer');
  const reopen = qs('#sidebar-reopen');

  // 展开按钮
  reopen?.addEventListener('click', () => {
    state.sidebarCollapsed = false;
    if (state.sidebarWidth < 200) state.sidebarWidth = 250;
    if (container) {
      container.classList.remove('collapsed');
      container.style.width = state.sidebarWidth + 'px';
    }
    reopen.classList.remove('visible');
  });

  if (!resizer || !container) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onMouseMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    let newWidth = startWidth + dx;
    if (newWidth < 180) {
      // 自动折叠
      state.sidebarCollapsed = true;
      state.sidebarWidth = 0;
      container.classList.add('collapsed');
      container.style.width = '0px';
      reopen?.classList.add('visible');
      dragging = false;
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      return;
    }
    if (newWidth > 480) newWidth = 480;
    state.sidebarWidth = newWidth;
    state.sidebarCollapsed = false;
    container.classList.remove('collapsed');
    container.style.width = newWidth + 'px';
  };

  const onMouseUp = () => {
    dragging = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = container.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.preventDefault();
  });
}

function hookEditorEvents() {
  // 侧栏视图切换
  qs('#sidebar-toggle')?.addEventListener('click', toggleSidebarView);
  qs('#sidebar-title')?.addEventListener('click', toggleSidebarView);

  // 面板开关（折叠/展开文件树侧栏）
  qs('#btn-toggle-panel')?.addEventListener('click', toggleSidebarPanel);

  // 导出按钮
  qs('#btn-export')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = qs('#export-dropdown');
    if (dd) dd.classList.toggle('hidden');
  });

  // 导出下拉项点击
  qs('#export-dropdown')?.addEventListener('click', (e) => {
    const item = e.target.closest('.export-item');
    if (!item) return;
    const format = item.dataset.format;
    qs('#export-dropdown')?.classList.add('hidden');
    handleExport(format);
    lucideIcons();
  });

  // 点击其他区域关闭导出下拉
  if (!editorDocumentEventsBound) {
    editorDocumentEventsBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#export-wrapper')) {
        qs('#export-dropdown')?.classList.add('hidden');
      }
    });
    document.addEventListener('selectionchange', debounce(captureBlockSelection, 80));
  }

  // 搜索按钮
  qs('#sidebar-search-btn')?.addEventListener('click', toggleSearch);

  // 搜索输入
  qs('#sidebar-search-input')?.addEventListener('input', (e) => filterFiles(e.target.value));

  // 大纲定位
  qs('#outline-list')?.addEventListener('click', (e) => {
    const item = e.target.closest('.outline-item');
    if (!item) return;
    const index = parseInt(item.dataset.blockIndex || '', 10);
    if (Number.isNaN(index)) return;
    activateBlock(index);
    qs('#block-editor')?.querySelectorAll('.block')[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // 文件树导航
  hookFileTreeEvents();

  // 侧边栏：宽度拖拽 + 自动折叠 + 展开
  hookSidebarResize();

  // 设置按钮
  qs('#btn-settings')?.addEventListener('click', openSettingsModal);
  qs('#btn-recycle-bin')?.addEventListener('click', () => safety.openRecycleBin());
  qs('#btn-history')?.addEventListener('click', () => safety.openHistory());
  qs('#btn-delete-doc')?.addEventListener('click', deleteCurrentDocument);

  // 返回文档库
  qs('#btn-back')?.addEventListener('click', async () => {
    await saveCurrentDoc();
    state.currentDoc = null;
    state.currentContent = '';
    try {
      await initLibrary();
    } catch (err) {
      console.error(err);
      state.view = 'library';
      renderWelcome();
    }
  });


  // === 源码编辑器事件 ===
  const sourceEditor = qs('#editor-source');
  if (sourceEditor) {
    sourceEditor.addEventListener('input', () => {
      state.isDirty = true;
      state.currentContent = sourceEditor.value;
      autoResizeTextarea(sourceEditor);
      updateWordCount();
      scheduleAutoSave();
    });

    sourceEditor.addEventListener('keydown', (e) => {
      const isCmd = e.metaKey || e.ctrlKey;
      if (isCmd && e.key === '/') {
        e.preventDefault();
        toggleSourceMode();
        return;
      }
    });
  }

  // 源码模式指示器点击切换
  qs('#mode-indicator')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSourceMode();
  });
}

// ============================================================
// 源码模式切换
// ============================================================
function toggleSourceMode() {
  captureBlockSelection();
  state.sourceMode = !state.sourceMode;
  const paper = qs('#editor-paper');
  const sourceEditor = qs('#editor-source');
  const modeIndicator = qs('#mode-indicator');

  if (!paper || !sourceEditor) return;

  if (state.sourceMode) {
    // 切换到源码模式：从块编辑器收集 Markdown
    const md = collectBlocksMarkdown();
    sourceEditor.value = md;
    state.currentContent = md;
    paper.style.display = 'none';
    sourceEditor.style.display = 'block';
    autoResizeTextarea(sourceEditor);
    sourceEditor.focus();
    if (modeIndicator) {
      modeIndicator.innerHTML = '<svg data-lucide="code" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg> <span>源码</span>';
      lucideIcons();
    }
  } else {
    // 切换到块编辑模式：将 textarea 内容重新渲染为块
    const md = sourceEditor.value;
    state.currentContent = md;
    sourceEditor.style.display = 'none';
    paper.style.display = '';
    activeBlockIndex = Number.isInteger(state.selectionIndex) ? state.selectionIndex : 0;
    const blockEditor = qs('#block-editor');
    if (blockEditor) {
      blockEditor.innerHTML = buildBlockEditorHtml(md);
      hookBlockEvents();
    }
    restoreBlockSelection();
    if (modeIndicator) {
      modeIndicator.innerHTML = '<svg data-lucide="eye" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg> <span>预览</span>';
      lucideIcons();
    }
    updateWordCount();
  }
}

function handleEditorKeydown(e) {
  const isCmd = e.metaKey || e.ctrlKey;

  if (isCmd && e.key === 's') {
    e.preventDefault();
    saveCurrentDoc();
    return;
  }

  if (isCmd && e.key === 'b') {
    e.preventDefault();
    document.execCommand('bold');
    return;
  }

  if (isCmd && e.key === 'i') {
    e.preventDefault();
    document.execCommand('italic');
    return;
  }

  if (isCmd && e.key === '/') {
    e.preventDefault();
    toggleSourceMode();
    return;
  }

  // Enter in empty list item — insert <br>
  if (e.key === 'Enter') {
    setTimeout(updateWordCount, 0);
  }
}

function updateWordCount() {
  let md;
  if (state.sourceMode) {
    const sourceEditor = qs('#editor-source');
    if (!sourceEditor) return;
    md = sourceEditor.value;
  } else {
    md = collectBlocksMarkdown();
  }
  const wc = wordCount(md);
  const wcEl = qs('#word-count');
  if (wcEl) wcEl.textContent = '字数：' + wc;
  const lines = (md || '').split('\n').length;
  const lcEl = qs('#line-count');
  if (lcEl) lcEl.textContent = '行数：' + lines;
}

function syncIncrementalBlocks(changedBlockIds) {
  const session = state.editorSession;
  if (!session?.document) return;
  const root = qs('#block-editor');
  if (!root) return;
  const visibleBlocks = session.document.blocks.filter(block => !block.attrs?.separator);
  const template = document.createElement('div');
  template.innerHTML = buildBlockEditorHtml(serializeDocument(session.document));
  const templates = new Map(
    [...template.querySelectorAll('.block')].map(element => [element.dataset.blockId, element]),
  );
  const changed = new Set(changedBlockIds);
  const expectedIds = new Set();
  let cursor = root.firstChild;

  for (const block of visibleBlocks) {
    expectedIds.add(block.id);
    let element = root.querySelector(`[data-block-id="${block.id}"]`);
    if (!element) {
      element = templates.get(block.id)?.cloneNode(true);
      if (!element) continue;
      root.insertBefore(element, cursor);
      changed.add(block.id);
    } else if (element !== cursor) {
      root.insertBefore(element, cursor);
    } else {
      cursor = cursor.nextSibling;
    }

    if (!changed.has(block.id)) continue;
    const source = element.querySelector('.block-source');
    if (source && source.textContent !== block.raw) {
      source.textContent = block.raw;
    }
    renderBlockFromSource(source, element);
  }

  for (const element of [...root.querySelectorAll('.block')]) {
    if (!expectedIds.has(element.dataset.blockId)) element.remove();
  }
  hookBlockEvents();
  restoreBlockSelection();
}

function applyHistoryResult(result, action = 'history') {
  if (!result || !state.editorSession) return;
  state.currentContent = serializeDocument(result.document);
  state.selection = result.selection;
  state.selectionIndex = result.selection
    ? state.editorSession.document.blocks
      .filter(block => !block.attrs?.separator)
      .findIndex(block => block.id === result.selection.anchor.blockId)
    : null;
  syncIncrementalBlocks(result.changedBlockIds);
  const editor = qs('#block-editor');
  if (editor) {
    editor.dataset.editorRevision = String(result.document.version);
    editor.dataset.lastTransaction = action;
  }
  updateWordCount();
  updateTitleDirty();
  scheduleAutoSave();
}

function undoEditor() {
  applyHistoryResult(state.editorSession?.undo(), 'undo');
}

function redoEditor() {
  applyHistoryResult(state.editorSession?.redo(), 'redo');
}

function executeEditorCommand(name) {
  if (!state.editorSession) return null;
  captureBlockSelection();
  const result = editorCommands.execute(name, {
    session: state.editorSession,
  });
  if (!result) return null;
  state.currentContent = serializeDocument(result.document);
  state.selection = state.editorSession.selection;
  state.selectionIndex = state.selection
    ? result.document.blocks
      .filter(block => !block.attrs?.separator)
      .findIndex(block => block.id === state.selection.anchor.blockId)
    : null;
  syncIncrementalBlocks(result.changedBlockIds || []);
  updateWordCount();
  scheduleAutoSave();
  return result;
}

function captureBlockSelection() {
  if (state.sourceMode) return;
  const root = qs('#block-editor');
  if (!root) return;
  const selection = domSelectionToModel(root);
  if (selection) {
    const enrich = position => {
      const block = state.editorSession?.document?.getBlock(position.blockId);
      if (!block?.children?.length) return position;
      const inline = textOffsetToInlinePosition(block.children, position.offset);
      return createPosition(position.blockId, inline.offset, inline.path);
    };
    state.selection = createSelection(
      enrich(selection.anchor),
      enrich(selection.head),
    );
    const blockElement = root.querySelector(`[data-block-id="${selection.anchor.blockId}"]`);
    state.selectionIndex = blockElement ? Number(blockElement.dataset.blockIndex) : null;
    root.dataset.selectionBlock = selection.anchor.blockId;
    root.dataset.selectionOffset = String(selection.anchor.offset);
  }
}

function restoreBlockSelection() {
  if (state.sourceMode || !state.selection) return;
  const root = qs('#block-editor');
  if (!root) return;
  requestAnimationFrame(() => {
    let selection = state.selection;
    if (!selection) return;
    let anchorBlock = root.querySelector(`[data-block-id="${selection.anchor.blockId}"]`);
    let headBlock = root.querySelector(`[data-block-id="${selection.head.blockId}"]`);
    if ((!anchorBlock || !headBlock) && Number.isInteger(state.selectionIndex)) {
      const blocks = root.querySelectorAll('.block');
      const anchorFallback = blocks[state.selectionIndex];
      const headFallback = blocks[state.selectionIndex];
      if (anchorFallback && headFallback) {
        selection = createSelection(
          createPosition(anchorFallback.dataset.blockId, selection.anchor.offset),
          createPosition(headFallback.dataset.blockId, selection.head.offset),
        );
      }
    }
    root.dataset.selectionRestored = String(applyModelSelection(root, selection, {
      resolveOffset: position => {
        const block = state.editorSession?.document?.getBlock(position.blockId);
        if (!block?.children?.length || position.path.length === 0) return position.offset;
        return inlinePositionToTextOffset(block.children, position.path, position.offset);
      },
    }));
  });
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  void safety.persistRecoverySnapshot();
  scheduleShadowComparison(getCurrentMd());
  void parserWorker.compare(getCurrentMd()).then(result => {
    const editor = qs('#block-editor');
    if (editor && result) editor.dataset.workerRoundtrip = String(result.exact);
  }).catch(() => {});
  autoSaveTimer = setTimeout(() => saveCurrentDoc(), 2000);
  updateTitleDirty();
}

let saveInProgress = false;
let savePending = false;
let saveAsPending = false;
let activeSavePromise = null;

async function saveCurrentDoc(saveAs = false) {
  if (saveAs) saveAsPending = true;
  savePending = true;
  if (saveInProgress && activeSavePromise) return activeSavePromise;

  saveInProgress = true;
  activeSavePromise = (async () => {
    try {
      while (savePending) {
        const runSaveAs = saveAsPending;
        savePending = false;
        saveAsPending = false;
        await performSave(runSaveAs);
      }
    } finally {
      saveInProgress = false;
      activeSavePromise = null;
    }
  })();
  return activeSavePromise;
}

async function performSave(saveAs = false) {
  let md;
  if (state.sourceMode) {
    const sourceEditor = qs('#editor-source');
    if (!sourceEditor) return;
    md = sourceEditor.value;
  } else {
    md = collectBlocksMarkdown();
  }

  const docSnapshot = state.currentDoc;
  const stillSameDoc = () => state.currentDoc === docSnapshot;
  const contentUnchanged = () => getCurrentMd() === md;
  const finishSaveState = (nextDoc) => {
    if (nextDoc) state.currentDoc = nextDoc;
    if (state.currentDoc === docSnapshot || nextDoc) {
      state.currentContent = md;
      state.currentDoc.name = fileNameWithoutExt(state.currentDoc.name) + '.md';
    }
    const sameTargetDoc = nextDoc ? state.currentDoc === nextDoc : state.currentDoc === docSnapshot;
    if (sameTargetDoc && contentUnchanged()) {
      state.isDirty = false;
    } else if (sameTargetDoc) {
      savePending = true;
    }
    if (!state.isDirty) markModelPersisted();
    updateTitleDirty();
  };

  if (state.isDBMode) {
    const name = docSnapshot ? fileNameWithoutExt(docSnapshot.name) : '未命名';
    try {
      if (docSnapshot && docSnapshot.id) {
        state.currentRevision = await DBUpdateDocument(
          docSnapshot.id,
          name + '.md',
          md,
          state.currentRevision,
        );
        finishSaveState(stillSameDoc() ? docSnapshot : null);
      } else {
        const id = await DBCreateDocument(name + '.md', md);
        state.currentRevision = 1;
        const nextDoc = stillSameDoc() ? { id, name: name + '.md' } : null;
        finishSaveState(nextDoc);
        try { state.docs = await DBListDocuments() || []; } catch (e) {}
        const nav = qs('#file-tree-nav');
        if (nav && nextDoc) {
          nav.innerHTML = '<div class="sidebar-empty">数据库存储</div>';
        }
      }
    } catch (e) {
      updateTitleDirty();
      if (String(e?.message || e).includes('revision conflict')) {
        alert('检测到文档版本冲突。请先查看版本历史，或重新打开文档后再保存。');
      }
      console.error('DB save error:', e);
    }
    if (!state.isDirty) await safety.clearRecoverySnapshot();
    return;
  }

  if (!docSnapshot || saveAs) {
    if (!docSnapshot && !state.isDirty && !saveAs && (!md || !md.trim())) return;

    try {
      const doc = await SaveDocumentAs(md);
      if (doc) {
        finishSaveState(doc);
        const meta = await ReadDocumentWithMeta(doc.path);
        state.currentRevision = meta?.revision || 0;
        state.currentHash = meta?.contentHash || '';
        safety.startFileWatcher(doc.path);
        await safety.clearRecoverySnapshot();
        try { AddRecentFile(doc.path, doc.name); } catch (e) {}
        const dir = doc.path.substring(0, doc.path.lastIndexOf('/'));
        state.docDir = dir;
        state.sidebarCollapsed = false;
        state.expandedDirs.clear();
        const container = qs('#file-tree-container');
        if (container) {
          container.classList.remove('collapsed');
          container.style.width = state.sidebarWidth + 'px';
        }
        const reopen = qs('#sidebar-reopen');
        if (reopen) reopen.classList.remove('visible');
        const nav = qs('#file-tree-nav');
        if (nav) nav.innerHTML = '<div class="sidebar-empty">加载中...</div>';
        try {
          const flatDocs = await ListDocuments(dir) || [];
          state.docs = flatDocs.filter(d => d.name.endsWith('.md') || d.isDir);
          state.docTree = state.docs
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
              return a.modTime > b.modTime ? -1 : 1;
            })
            .map(d => ({
              name: d.name, path: d.path, size: d.size,
              modTime: d.modTime, isDir: d.isDir,
              children: d.isDir ? [] : undefined,
            }));
        } catch (e) {
          state.docTree = [{ name: doc.name, path: doc.path, size: doc.size, modTime: doc.modTime, isDir: false }];
        }
        if (nav) {
          nav.innerHTML = buildFileTreeHtml(state.docTree, 0);
          lucideIcons();
          hookFileTreeEvents();
        }
      }
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e && e.message);
      if (msg !== 'canceled') console.error('save error:', e);
    }
    return;
  }

  if (!state.isDirty) return;

  try {
    state.ignoreWatcherUntil = Date.now() + 1200;
    const revision = await WriteDocumentVersioned(
      docSnapshot.path,
      md,
      state.currentRevision,
      state.currentHash,
    );
    state.currentRevision = revision;
    const meta = await ReadDocumentWithMeta(docSnapshot.path);
    state.currentHash = meta?.contentHash || state.currentHash;
    if (stillSameDoc()) {
      state.currentContent = md;
      if (contentUnchanged()) {
        state.isDirty = false;
      } else {
        savePending = true;
      }
    }
    if (!state.isDirty) markModelPersisted();
    await safety.clearRecoverySnapshot();
    updateTitleDirty();
  } catch (e) {
    updateTitleDirty();
    if (String(e?.message || e).includes('revision conflict')) {
      safety.showExternalChangeDialog({ path: docSnapshot.path });
    }
    console.error('save error:', e);
  }
}

function markModelPersisted() {
  state.editorSession?.markPersisted();
  const editor = qs('#block-editor');
  if (editor && state.editorSession) {
    editor.dataset.persistedRevision = String(state.editorSession.persistedVersion);
    editor.dataset.persistedTransaction = String(state.editorSession.persistedTransactionId);
  }
}

function updateTitleDirty() {
  void SetPendingChanges(state.isDirty ? 1 : 0, state.currentDoc?.name || '未命名.md');
  const titleEl = qs('#editor-title');
  if (!titleEl) return;
  const name = state.currentDoc ? fileNameWithoutExt(state.currentDoc.name) : '未命名';
  titleEl.innerHTML = '<svg data-lucide="file-text" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5" class="titlebar-md-icon"></svg>' + escapeHtml(name) + '.md' + (state.isDirty ? ' *' : '');
}

async function applyExternalDocument(meta) {
  state.currentContent = meta.content || '';
  state.currentRevision = meta.revision || 0;
  state.currentHash = meta.contentHash || '';
  state.isDirty = false;
  await safety.clearRecoverySnapshot();
  renderEditor();
}

async function keepLocalVersion(meta) {
  state.currentRevision = meta.revision || 0;
  state.currentHash = meta.contentHash || '';
  state.isDirty = true;
  await saveCurrentDoc();
}

async function restoreDocumentSnapshot(snapshot) {
  state.currentDoc = snapshot.currentDoc || state.currentDoc;
  state.currentContent = snapshot.content || '';
  state.currentRevision = snapshot.revision || 0;
  state.currentHash = snapshot.contentHash || '';
  state.isDBMode = snapshot.isDBMode === true;
  state.isDirty = true;
  renderEditor();
}

async function deleteCurrentDocument() {
  if (!state.currentDoc) return;
  if (!confirm('将当前文档移到回收站？')) return;
  try {
    if (state.isDBMode && state.currentDoc.id) {
      await DBDeleteDocument(state.currentDoc.id);
    } else if (state.currentDoc.path) {
      await DeleteDocument(state.currentDoc.path);
    }
    safety.stopFileWatcher();
    await safety.clearRecoverySnapshot();
    state.currentDoc = null;
    state.currentContent = '';
    state.currentRevision = 0;
    state.currentHash = '';
    state.isDirty = false;
    await initLibrary();
  } catch (error) {
    alert(`删除失败：${error.message || error}`);
  }
}

// ============================================================
// 新建文档
// ============================================================
async function createNewDoc() {
  const title = prompt('文档标题', '无题');
  if (!title || !title.trim()) return;
  try {
    if (state.isDBMode) {
      const fullName = title.trim() + '.md';
      const id = await DBCreateDocument(fullName, `# ${title.trim()}\n\n`);
      const doc = { id, name: fullName };
      state.docs.unshift(doc);
      state.currentDoc = doc;
      state.currentContent = `# ${title.trim()}\n\n`;
      state.currentRevision = 1;
      state.currentHash = '';
    } else {
      const doc = await CreateDocument(state.docDir, title.trim());
      state.docs.unshift(doc);
      state.currentDoc = doc;
      state.currentContent = `# ${title.trim()}\n\n`;
      state.currentRevision = 1;
      const meta = await ReadDocumentWithMeta(doc.path);
      state.currentHash = meta?.contentHash || '';
      safety.startFileWatcher(doc.path);
    }
    renderEditor();
  } catch (e) {
    console.error(e);
  }
}

async function createNewDocFromEditor() {
  const title = prompt('文档标题', '无题');
  if (!title || !title.trim()) return;
  try {
    await saveCurrentDoc();
    const doc = await CreateDocument(state.docDir, title.trim());
    state.docs.unshift(doc);
    state.currentDoc = doc;
    state.currentContent = `# ${title.trim()}\n\n`;
    state.currentRevision = 1;
    const meta = await ReadDocumentWithMeta(doc.path);
    state.currentHash = meta?.contentHash || '';
    safety.startFileWatcher(doc.path);
    renderEditor();
  } catch (e) {
    console.error(e);
  }
}

// ============================================================
// Lucide 图标初始化
// ============================================================
function lucideIcons() {
  createIcons({ icons: LUCIDE_ICONS });
}
// ============================================================
// 应用启动
// ============================================================
async function init() {
  $app = document.querySelector('#app');

  try {
    const recovered = await safety.offerCrashRecovery();
    if (recovered) return;
  } catch (e) {}

  // 应用已保存的设置
  const savedSettings = await loadSettings();
  if (savedSettings) applySettings(savedSettings);

  // Setup demo data for dev preview
  state.docDir = '/demo-docs';
  state.docs = [];

  // 初始化窗口拖动
  initWindowDrag();

  // 菜单栏保存事件监听（Wails 开发模式热重载时可能失败）
  try { EventsOn('menu:save', () => { saveCurrentDoc(false); }); } catch (e) {}
  try { EventsOn('menu:saveas', () => { saveCurrentDoc(true); }); } catch (e) {}
  try {
    EventsOn('app:before-close', async () => {
      await saveCurrentDoc(false);
      if (!state.isDirty) {
        await ConfirmClose();
      } else {
        alert('仍有内容未能保存，已取消退出。请检查保存错误后重试。');
      }
    });
  } catch (e) {}

  window.addEventListener('beforeunload', (event) => {
    if (!state.isDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Cmd+S 全局保存
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentDoc(false);
    }
  });

  // 尝试恢复上次状态
  let lastState = null;
  try { lastState = await restoreAppState(); } catch (e) {}
  if (lastState) {
    state.isDBMode = lastState.isDBMode === true;
    if (lastState.docDir) state.docDir = lastState.docDir;

    if (lastState.lastView === 'editor') {
      // 恢复编辑器
      state.view = 'editor';
      if (state.isDBMode && lastState.lastDocId) {
        try {
          const result = await DBReadDocument(lastState.lastDocId);
          if (result) {
            state.currentDoc = { id: lastState.lastDocId, name: result.name || lastState.lastDocName };
            state.currentContent = result.content || '';
            state.currentRevision = result.revision || 0;
            renderEditor();
            return;
          }
        } catch (e) {}
      } else if (!state.isDBMode && lastState.lastDocPath) {
        try {
          const meta = await ReadDocumentWithMeta(lastState.lastDocPath);
          state.currentDoc = { name: lastState.lastDocName, path: lastState.lastDocPath, size: meta.content.length, modTime: '' };
          state.currentContent = meta.content;
          state.currentRevision = meta.revision || 0;
          state.currentHash = meta.contentHash || '';
          safety.startFileWatcher(lastState.lastDocPath);
          try {
            state.docs = (await ListDocuments(state.docDir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
          } catch (e) {}
          renderEditor();
          return;
        } catch (e) {}
      }
    }

    if (lastState.lastView === 'library') {
      // 恢复文档库视图
      if (!state.isDBMode && state.docDir) {
        try { await initLibrary(); return; } catch (e) {}
      }
      if (state.isDBMode) {
        try { await initLibrary(); return; } catch (e) {}
      }
    }
  }

  // 默认进入文档库（DB模式）
  state.isDBMode = true;
  try { await initLibrary(); } catch (e) { renderHome(); }
}

// ============================================================
// 导出功能
// ============================================================
function getCurrentMd() {
  if (state.sourceMode) {
    const se = qs('#editor-source');
    return se ? se.value : state.currentContent;
  }
  if (state.editorSession?.document) {
    return serializeDocument(state.editorSession.document);
  }
  return collectBlocksMarkdown() || state.currentContent;
}

function getExportName(ext) {
  const name = state.currentDoc
    ? fileNameWithoutExt(state.currentDoc.name)
    : '未命名';
  return name + '.' + ext;
}

const { handleExport } = createExportModule({
  getCurrentMd,
  getExportName,
  sanitizeHtml,
  escapeHtml,
});

const {
  findDocByPath,
  buildFileTreeHtml,
  renderFileTreeNav,
  hookFileTreeEvents,
} = createFileTreeModule({
  state,
  storage,
  escapeHtml,
  fileNameWithoutExt,
  lucideIcons,
  openEditor,
  saveCurrentDoc,
});

const safety = createSafetyModule({
  state,
  storage,
  escapeHtml,
  lucideIcons,
  getCurrentMd,
  onReloadDocument: applyExternalDocument,
  onKeepLocalVersion: keepLocalVersion,
  onSaveCopy: () => saveCurrentDoc(true),
  onContentRestored: restoreDocumentSnapshot,
  onWorkspaceChanged: initLibrary,
});

const {
  loadSettings,
  applySettings,
  openSettingsModal,
} = createSettingsModule({
  state,
  storage,
  appVersion: APP_VERSION,
  appRepo: APP_REPO,
  checkForUpdate,
  escapeHtml,
  qs,
  getApp: () => $app,
  lucideIcons,
  renderEditor,
  initLibrary,
});

function runCompositionSelfTest() {
  const source = qs('.block.active .block-source');
  if (!source) return false;
  source.focus();
  source.textContent = '';
  source.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  source.textContent = '你';
  source.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertCompositionText',
    data: '你',
  }));
  source.textContent = '你好';
  source.dispatchEvent(new CompositionEvent('compositionupdate', {
    bubbles: true,
    data: '你好',
  }));
  source.dispatchEvent(new CompositionEvent('compositionend', {
    bubbles: true,
    data: '你好',
  }));
  const block = source.closest('.block');
  const passed = source.textContent === '你好' && block?.dataset.compositionCommitted === 'true';
  document.documentElement.dataset.compositionSelfTest = passed ? 'pass' : 'fail';
  return passed;
}

function runInputSelfTest() {
  const source = qs('.block.active .block-source');
  if (!source || !state.editorSession) return false;
  source.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(source);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: 'a',
  });
  const debugSelection = domSelectionToModel(qs('#block-editor'));
  source.dispatchEvent(event);
  document.documentElement.dataset.inputSelfTestDebug = JSON.stringify({
    prevented: event.defaultPrevented,
    sessionVersion: state.editorSession.document.version,
    text: source.textContent || '',
    selection: debugSelection,
  });
  const afterInput = {
    text: source.textContent || '',
    revision: qs('#block-editor')?.dataset.editorRevision || '',
  };
  undoEditor();
  const afterUndo = source.textContent || '';
  redoEditor();
  const afterRedo = source.textContent || '';
  const passed = afterInput.text === 'a' &&
    afterInput.revision !== '' &&
    afterUndo === '' &&
    afterRedo === 'a';
  document.documentElement.dataset.inputSelfTest = passed ? 'pass' : 'fail';
  return true;
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('composition-self-test')) {
  const timer = setInterval(() => {
    if (!runCompositionSelfTest()) return;
    clearInterval(timer);
  }, 100);
  setTimeout(() => clearInterval(timer), 5000);
}

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('input-self-test')) {
  const timer = setInterval(() => {
    if (!runInputSelfTest()) return;
    clearInterval(timer);
  }, 100);
  setTimeout(() => clearInterval(timer), 5000);
}

// Start
init().catch(console.error);
