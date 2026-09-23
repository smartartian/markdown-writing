import './style.css';

import { version as APP_VERSION } from '../package.json';
import { BrowserOpenURL, EventsOn, OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
import { bootstrapApplication } from './app/bootstrap';
import { state } from './core/state';
import { t } from './i18n';
import { createMarkdownAssetResolver } from './markdown/assets.js';
import { createMarkdownRenderer } from './markdown/renderer.js';
import { sanitizeMarkdownHtml } from './markdown/sanitizer.js';
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
import { BLOCK_TYPES } from './editor-core/model/types.js';
import { parseMarkdown } from './editor-core/parser/block-parser.js';
import { createEditorSession } from './editor-core/session/index.js';
import { serializeDocument } from './editor-core/serializer/markdown-serializer.js';
import { createParserWorkerClient } from './editor-core/worker/index.js';

import {
  createEditorCore,
  createMarkdownSeparatorBlock,
  preserveBlockBoundaryNewlines,
} from './modules/editor';
import { createExportModule } from './modules/export';
import { createFileTreeModule } from './modules/file-tree';
import { createSafetyModule } from './modules/safety';
import { createSettingsModule, matchesShortcut } from './modules/settings';
import { createAppPluginRuntime } from './plugin-runtime';
import { isBrowserMode, storage } from './services/document-store';
import { brandHeroHtml } from './ui/brand';
import { autoResizeTextarea, debounce, escapeHtml, qs } from './ui/dom';
import { findTextMatches, replaceAllText, replaceTextRange } from './ui/editor/find-replace';
import { renderIcons as lucideIcons } from './ui/icons';
import { createSplitter } from './ui/splitter';
import {
  buildOutlineTree,
  headingsFromDocument,
  headingsFromMarkdown,
  renderOutlineTree,
} from './ui/outline';
import { expandDocumentParents } from './ui/paths.js';
import { getEditableTextOffset, htmlToMarkdown } from './ui/wysiwyg.js';

const {
  selectDocumentDir: NativeSelectDocumentDir,
  listDocuments: NativeListDocuments,
  listDocumentTree: NativeListDocumentTree,
  readDocument: NativeReadDocument,
  readDocumentWithMeta: NativeReadDocumentWithMeta,
  readImageAsset: NativeReadImageAsset,
  writeDocument: NativeWriteDocument,
  writeImageAsset: NativeWriteImageAsset,
  writeDocumentVersioned: WriteDocumentVersioned,
  listFileVersions: NativeListFileVersions,
  restoreFileVersion: NativeRestoreFileVersion,
  deleteDocument: NativeDeleteDocument,
  listRecycleBin: NativeListRecycleBin,
  restoreRecycleItem: NativeRestoreRecycleItem,
  purgeRecycleItem: NativePurgeRecycleItem,
  renameDocument: RenameDocument,
  revealDocument: RevealDocument,
  openDocumentFile: OpenDocumentFile,
  acceptDroppedDocument: AcceptDroppedDocument,
  saveDocumentAs: SaveDocumentAs,
  saveExportFile: SaveExportFile,
  addRecentFile: AddRecentFile,
  listRecentFiles: ListRecentFiles,
  getAppState: GetAppState,
  getAppVersion: GetAppVersion,
  saveAppSetting: SaveAppSetting,
  loadAppSettings: LoadAppSettings,
  saveRecoveryState: SaveRecoveryState,
  loadRecoveryState: LoadRecoveryState,
  clearRecoveryState: ClearRecoveryState,
  setPendingChanges: SetPendingChanges,
  confirmClose: ConfirmClose,
} = storage;

let pluginRuntime = null;

function pluginServiceProxy(serviceName, method, fallback) {
  return (...args) => {
    if (pluginRuntime) return pluginRuntime.invokeService(serviceName, method, fallback, ...args);
    return fallback(...args);
  };
}

const SelectDocumentDir = pluginServiceProxy('workspace', 'selectDirectory', NativeSelectDocumentDir);
const ListDocuments = pluginServiceProxy('workspace', 'listDocuments', NativeListDocuments);
const ListDocumentTree = pluginServiceProxy('workspace', 'listDocumentTree', NativeListDocumentTree);
const ReadDocument = pluginServiceProxy('workspace', 'readDocument', NativeReadDocument);
const ReadDocumentWithMeta = pluginServiceProxy('workspace', 'readDocumentWithMeta', NativeReadDocumentWithMeta);
const WriteDocument = pluginServiceProxy('workspace', 'writeDocument', NativeWriteDocument);
const WriteImageAsset = pluginServiceProxy('workspace', 'writeImageAsset', NativeWriteImageAsset);
const ListFileVersions = pluginServiceProxy('documentStore', 'listFileVersions', NativeListFileVersions);
const RestoreFileVersion = pluginServiceProxy('documentStore', 'restoreFileVersion', NativeRestoreFileVersion);
const DeleteDocument = pluginServiceProxy('documentStore', 'deleteDocument', NativeDeleteDocument);
const ListRecycleBin = pluginServiceProxy('documentStore', 'listRecycleBin', NativeListRecycleBin);
const RestoreRecycleItem = pluginServiceProxy('documentStore', 'restoreRecycleItem', NativeRestoreRecycleItem);
const PurgeRecycleItem = pluginServiceProxy('documentStore', 'purgeRecycleItem', NativePurgeRecycleItem);

const APP_REPO = 'smartartian/Markdown-writing';

// 检查 GitHub 最新版本
async function checkForUpdate() {
  try {
    const resp = await fetch(`https://api.github.com/repos/${APP_REPO}/releases/latest`);
    if (resp.status === 404) {
      return {
        latest: null,
        current: APP_VERSION,
        hasUpdate: false,
        noRelease: true,
      };
    }
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
      docDir: state.docDir,
      sidebarWidth: Math.round(state.sidebarWidth),
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

  // 恢复侧栏宽度，越界值一律忽略并退回默认宽度
  function restorePanelWidths(data) {
    const sidebar = Number(data?.sidebarWidth);
    if (Number.isFinite(sidebar) && sidebar >= 180 && sidebar <= 480) {
      state.sidebarWidth = Math.round(sidebar);
    }
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

const sanitizeHtml = sanitizeMarkdownHtml;
const markdownRenderer = createMarkdownRenderer({ sanitize: sanitizeHtml });
const markdownAssetResolver = createMarkdownAssetResolver({
  getContext: () => {
    const documentPath = state.currentDoc?.path;
    if (storage.name !== 'wails' || typeof NativeReadImageAsset !== 'function' || !documentPath) {
      return null;
    }
    return {
      documentPath,
      imageDir: getSetting('files.imageDir', 'assets'),
    };
  },
  resolveAsset: ({ documentPath, imageDir, source }) =>
    NativeReadImageAsset(documentPath, imageDir, source),
  getRoot: () => $app || document.body,
});

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
  marked: markdownRenderer.marked,
  renderMarkdown: markdownRenderer.render,
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
async function scheduleEditorShadowComparison(markdown) {
  if (!import.meta.env.DEV) return;
  try {
    const { scheduleShadowComparison } = await import('./dev-tools/markdown-shadow/markdown-shadow.js');
    scheduleShadowComparison(markdown);
  } catch (error) {
    console.warn('Editor shadow comparison unavailable:', error);
  }
}

// 重新渲染块编辑器（保留当前激活块的位置）
function refreshBlockEditor() {
  const container = qs('#block-editor');
  if (!container) return;
  const md = collectBlocksMarkdown();
  activeBlockIndex = Math.max(0, activeBlockIndex);
  container.innerHTML = buildBlockEditorHtml(md);
  hookBlockEvents();
  // 聚焦激活块
  const activeEl = container.querySelector('.block.active .block-rendered');
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
      if (renderedEl) {
        renderedEl.innerHTML = rendered;
        renderedEl.contentEditable = 'false';
      }
    }
  }

  activeBlockIndex = index;
  const nextBlock = blocks[index];
  if (nextBlock) {
    nextBlock.classList.add('active');
    const rendered = nextBlock.querySelector('.block-rendered');
    if (rendered) {
      rendered.contentEditable = 'true';
      rendered.focus();
      // 光标放到末尾
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(rendered);
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
    <div class="block-source" contenteditable="false" hidden>${escapeHtml(raw) || '&#8203;'}</div>
    <div class="block-rendered" contenteditable="true" spellcheck="true"><p><br></p></div>
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
      source.removeEventListener('paste', onBlockPaste);
      source.addEventListener('paste', onBlockPaste);
    }

    const rendered = el.querySelector('.block-rendered');
    if (rendered) {
      rendered.removeEventListener('input', onRenderedBlockInput);
      rendered.addEventListener('input', onRenderedBlockInput);
      rendered.removeEventListener('keydown', onRenderedBlockKeydown);
      rendered.addEventListener('keydown', onRenderedBlockKeydown);
      rendered.removeEventListener('paste', onRenderedBlockPaste);
      rendered.addEventListener('paste', onRenderedBlockPaste);
      rendered.removeEventListener('drop', onRenderedBlockDrop);
      rendered.addEventListener('drop', onRenderedBlockDrop);
      rendered.removeEventListener('blur', onRenderedBlockBlur);
      rendered.addEventListener('blur', onRenderedBlockBlur);
      rendered.removeEventListener('compositionend', onRenderedCompositionEnd);
      rendered.addEventListener('compositionend', onRenderedCompositionEnd);
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

  const editedRaw = (source.textContent || '').replace(/\u200B/g, '');
  if (state.editorSession?.document) {
    const block = source.closest('.block');
    const blockId = block?.dataset.blockId;
    const modelBlock = state.editorSession.document.getBlock(blockId);
    const nextRaw = modelBlock
      ? preserveBlockBoundaryNewlines(modelBlock.raw, editedRaw)
      : editedRaw;
    if (blockId && modelBlock && modelBlock.raw !== nextRaw) {
      state.editorSession.selection = state.selection;
      const transaction = state.editorSession
        .createTransaction({ source: 'input' })
        .replace(blockId, nextRaw);
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

function renderedBlockToMarkdown(rendered) {
  const html = rendered.innerHTML;
  const hasRichMarkup = /<(?:strong|em|code|a|img|mark|del|ul|ol|li|blockquote|pre|table|br)\b/i
    .test(html);
  const isPlainParagraph = /^\s*<p(?:\s[^>]*)?>[\s\S]*<\/p>\s*$/i.test(html);
  if (isPlainParagraph && !hasRichMarkup) {
    return (rendered.textContent || '').replace(/\u200B/g, '').trimEnd();
  }
  return htmlToMarkdown(html);
}

async function syncRenderedBlock(block) {
  if (!block || !state.editorSession?.document) return;
  const rendered = block.querySelector('.block-rendered');
  const source = block.querySelector('.block-source');
  const blockId = block.dataset.blockId;
  if (!rendered || !source || !blockId) return;

  const token = String(Number(block.dataset.richSyncToken || 0) + 1);
  block.dataset.richSyncToken = token;
  const modelBlock = state.editorSession.document.getBlock(blockId);
  const raw = await renderedBlockToMarkdown(rendered);
  if (block.dataset.richSyncToken !== token) return;
  const nextRaw = modelBlock
    ? preserveBlockBoundaryNewlines(modelBlock.raw, raw)
    : raw;
  if (source.textContent === nextRaw && modelBlock?.raw === nextRaw) return;

  source.textContent = nextRaw;
  let transactionResult = null;
  if (modelBlock && modelBlock.raw !== nextRaw) {
    const transaction = state.editorSession
      .createTransaction({ source: 'wysiwyg' })
      .replace(blockId, nextRaw);
    transactionResult = state.editorSession.apply(transaction, {
      coalesceKey: `wysiwyg:${blockId}`,
    });
    state.currentContent = serializeDocument(transactionResult.document);
    const editor = qs('#block-editor');
    if (editor) {
      editor.dataset.editorRevision = String(transactionResult.document.version);
      editor.dataset.lastTransaction = 'wysiwyg';
    }
  }

  const selection = window.getSelection();
  if (selection?.anchorNode && rendered.contains(selection.anchorNode)) {
    const offset = getEditableTextOffset(rendered, selection.anchorNode, selection.anchorOffset);
    state.selection = createSelection(
      createPosition(blockId, offset),
      createPosition(blockId, offset),
    );
    state.editorSession.selection = state.selection;
  }
  const nextModelBlock = transactionResult?.document.getBlock(blockId);
  if (nextModelBlock && nextModelBlock.type !== modelBlock?.type) {
    syncIncrementalBlocks(transactionResult.changedBlockIds);
  }
  state.isDirty = true;
  updateTitleDirty();
  updateWordCount();
  scheduleAutoSave();
}

function onRenderedBlockInput(event) {
  if (event.isComposing || compositionController.isActive()) return;
  const block = event.target.closest('.block');
  if (!block) return;
  void syncRenderedBlock(block);
}

function onRenderedCompositionEnd(event) {
  const block = event.target.closest('.block');
  if (block) void syncRenderedBlock(block);
}

function onRenderedBlockBlur(event) {
  const block = event.target.closest('.block');
  if (block) void syncRenderedBlock(block);
}

function onRenderedBlockPaste() {
  requestAnimationFrame(() => {
    const block = document.activeElement?.closest?.('.block');
    if (block) void syncRenderedBlock(block);
  });
}

function onRenderedBlockDrop() {
  requestAnimationFrame(() => {
    const block = document.activeElement?.closest?.('.block');
    if (block) void syncRenderedBlock(block);
  });
}

async function splitRenderedBlock(block) {
  if (!block || !state.editorSession?.document) return;
  const rendered = block.querySelector('.block-rendered');
  const source = block.querySelector('.block-source');
  const blockId = block.dataset.blockId;
  const selection = window.getSelection();
  if (!rendered || !source || !blockId || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!rendered.contains(range.startContainer)) return;

  await syncRenderedBlock(block);
  const raw = source.textContent || '';
  const modelBlock = state.editorSession.document.getBlock(blockId);
  if (!modelBlock) return;
  if (!raw.trim()) {
    const visibleBlocks = [...block.parentElement.querySelectorAll('.block')];
    const currentIndex = visibleBlocks.indexOf(block);
    const nextBlockElement = visibleBlocks[currentIndex + 1];
    if (nextBlockElement) {
      block.classList.remove('active');
      const currentRendered = block.querySelector('.block-rendered');
      if (currentRendered) currentRendered.contentEditable = 'false';
      nextBlockElement.classList.add('active');
      const nextRendered = nextBlockElement.querySelector('.block-rendered');
      if (nextRendered) {
        nextRendered.contentEditable = 'true';
        nextRendered.focus();
      }
    }
    return;
  }
  const textOffset = getEditableTextOffset(rendered, range.endContainer, range.endOffset);
  const textLength = (rendered.textContent || '').replace(/\u200B/g, '').length;
  const prefix = modelBlock.type === 'heading'
    ? (raw.match(/^#{1,6}\s+/) || [''])[0].length
    : modelBlock.type === 'blockquote'
      ? (raw.match(/^>\s+/) || [''])[0].length
      : modelBlock.type === 'list'
        ? (raw.match(/^(?:[-*+]|\d+\.)\s+/) || [''])[0].length
        : 0;
  const cursor = textOffset >= textLength
    ? raw.length
    : Math.min(raw.length, textOffset + prefix);
  const documentIndex = state.editorSession.document.getBlockIndex(blockId);
  const transaction = state.editorSession
    .createTransaction({ source: 'keyboard' })
    .split(blockId, cursor);
  transaction.insert(documentIndex + 1, createMarkdownSeparatorBlock());
  const result = state.editorSession.apply(transaction);
  state.currentContent = serializeDocument(result.document);
  const rightBlock = result.document.blocks
    .slice(documentIndex + 1)
    .find(candidate => !candidate.attrs?.separator);
  if (rightBlock) {
    state.selection = createSelection(
      createPosition(rightBlock.id, 0),
      createPosition(rightBlock.id, 0),
    );
    state.selectionIndex = documentIndex + 1;
    activeBlockIndex = documentIndex + 1;
  }
  syncIncrementalBlocks([...result.changedBlockIds, rightBlock?.id].filter(Boolean));
  let nextBlockElement = rightBlock
    ? qs(`#block-editor [data-block-id="${rightBlock.id}"]`)
    : null;
  if (!nextBlockElement && rightBlock) {
    const newIndex = insertBlockAfter(documentIndex, rightBlock.raw || '');
    nextBlockElement = qs(`#block-editor .block[data-block-index="${newIndex}"]`);
    if (nextBlockElement) nextBlockElement.dataset.blockId = rightBlock.id;
  }
  const current = block;
  current.classList.remove('active');
  const currentRendered = current.querySelector('.block-rendered');
  if (currentRendered) currentRendered.contentEditable = 'false';
  if (nextBlockElement) {
    nextBlockElement.classList.add('active');
    const nextRendered = nextBlockElement.querySelector('.block-rendered');
    if (nextRendered) nextRendered.contentEditable = 'true';
  }
  updateWordCount();
  scheduleAutoSave();
  requestAnimationFrame(() => {
    const next = nextBlockElement?.querySelector('.block-rendered');
    if (next) {
      next.focus();
      const nextSelection = window.getSelection();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(next);
      nextRange.collapse(false);
      nextSelection.removeAllRanges();
      nextSelection.addRange(nextRange);
    }
  });
}

function onRenderedBlockKeydown(event) {
  const isCommand = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (matchesShortcut(event, getSetting('shortcuts.toggleSource', 'Cmd+/'))) {
    event.preventDefault();
    toggleSourceMode();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void splitRenderedBlock(event.target.closest('.block'));
    return;
  }
  if (isCommand && key === 'b') {
    event.preventDefault();
    document.execCommand('bold');
    void syncRenderedBlock(event.target.closest('.block'));
    return;
  }
  if (isCommand && key === 'i') {
    event.preventDefault();
    document.execCommand('italic');
    void syncRenderedBlock(event.target.closest('.block'));
    return;
  }
  if (isCommand && event.shiftKey && key === 's') {
    event.preventDefault();
    document.execCommand('strikeThrough');
    void syncRenderedBlock(event.target.closest('.block'));
    return;
  }
  if (event.key === 'Backspace') {
    const rendered = event.target;
    const block = rendered.closest('.block');
    const selection = window.getSelection();
    if (block && selection?.isCollapsed && getEditableTextOffset(rendered, selection.anchorNode, selection.anchorOffset) === 0) {
      const index = Number(block.dataset.blockIndex);
      if (index > 0 && state.editorSession?.document) {
        event.preventDefault();
        const transaction = state.editorSession
          .createTransaction({ source: 'delete' })
          .remove(block.dataset.blockId);
        const result = state.editorSession.apply(transaction);
        state.currentContent = serializeDocument(result.document);
        activeBlockIndex = index - 1;
        syncIncrementalBlocks(result.changedBlockIds);
        requestAnimationFrame(() => {
          const previous = qs(`#block-editor .block[data-block-index="${index - 1}"] .block-rendered`);
          previous?.focus();
        });
      }
    }
  }
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
    ? markdownRenderer.render(blockType.raw)
    : '<p><br></p>';
  const renderedEl = block.querySelector('.block-rendered');
  if (renderedEl) {
    renderedEl.innerHTML = newHtml || '<p><br></p>';
    renderedEl.contentEditable = block.classList.contains('active') ? 'true' : 'false';
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
      inserted = await createImageMarkdown(file);
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

async function onBlockPaste(e) {
  const imageItem = [...(e.clipboardData?.items || [])]
    .find(item => item.type.startsWith('image/'));
  if (!imageItem) return;
  const file = imageItem.getAsFile();
  if (!file) return;
  e.preventDefault();

  const source = e.target.closest?.('.block-source');
  const block = source?.closest?.('.block');
  if (!source || !block || !state.editorSession?.document) return;
  const modelBlock = state.editorSession.document.getBlock(block.dataset.blockId);
  if (!modelBlock) return;

  const inserted = await createImageMarkdown(file);
  if (!inserted) return;
  const selection = domSelectionToModel(qs('#block-editor'));
  const offset = selection?.anchor.offset ?? modelBlock.raw.length;
  const raw = modelBlock.raw.slice(0, offset) + inserted + modelBlock.raw.slice(offset);
  applyModelBlockUpdate(modelBlock.id, raw, offset + inserted.length, {
    source: 'paste',
    coalesceKey: null,
    selection,
  });
}

async function createImageMarkdown(file) {
  const encoded = await fileToBase64(file);
  const imageDir = getSetting('files.imageDir', 'assets');
  const configuredWidth = Number(getSetting('files.imageWidth', 100));
  const imageWidth = Number.isFinite(configuredWidth)
    ? Math.max(10, Math.min(100, Math.round(configuredWidth)))
    : 100;
  const widthAttribute = imageWidth < 100 ? `{width=${imageWidth}%}` : '';
  const documentPath = state.currentDoc?.path;
  const alt = String(file.name || 'image').replace(/[\[\]]/g, '');

  if (documentPath && typeof WriteImageAsset === 'function') {
    try {
      const relativePath = await WriteImageAsset(documentPath, imageDir, file.name || 'image.png', encoded);
      return `![${alt}](${relativePath})${widthAttribute}`;
    } catch (error) {
      console.error('保存图片资源失败，回退为内嵌图片:', error);
    }
  }

  const mime = file.type || 'image/png';
  return `![${alt}](data:${mime};base64,${encoded})${widthAttribute}`;
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function onBlockKeydown(e) {
  const source = e.target;
  const block = source.closest('.block');
  if (!block) return;
  const idx = parseInt(block.dataset.blockIndex);
  const isCmd = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  if (matchesShortcut(e, getSetting('shortcuts.toggleSource', 'Cmd+/'))) {
    e.preventDefault();
    toggleSourceMode();
    return;
  }

  if (matchesShortcut(e, getSetting('shortcuts.undo', 'Cmd+Z'))) {
    e.preventDefault();
    undoEditor();
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.redo', 'Cmd+Shift+Z')) || (isCmd && key === 'y' && !e.altKey)) {
    e.preventDefault();
    redoEditor();
    return;
  }

  if (matchesShortcut(e, getSetting('shortcuts.bold', 'Cmd+B'))) {
    e.preventDefault();
    executeEditorCommand('toggleStrong');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.italic', 'Cmd+I'))) {
    e.preventDefault();
    executeEditorCommand('toggleEmphasis');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.strike', 'Cmd+Shift+S'))) {
    e.preventDefault();
    executeEditorCommand('toggleStrike');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.inlineCode', 'Cmd+E'))) {
    e.preventDefault();
    executeEditorCommand('toggleInlineCode');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.highlight', 'Cmd+Shift+H'))) {
    e.preventDefault();
    executeEditorCommand('toggleHighlight');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.link', 'Cmd+K'))) {
    e.preventDefault();
    executeEditorCommand('insertLink');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.codeBlock', 'Cmd+Shift+C'))) {
    e.preventDefault();
    executeEditorCommand('toggleCodeBlock');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.quote', 'Cmd+Shift+Q'))) {
    e.preventDefault();
    executeEditorCommand('toggleQuote');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.unorderedList', 'Cmd+Shift+U'))) {
    e.preventDefault();
    executeEditorCommand('toggleUnorderedList');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.orderedList', 'Cmd+Shift+O'))) {
    e.preventDefault();
    executeEditorCommand('toggleOrderedList');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.taskList', 'Cmd+Shift+T'))) {
    e.preventDefault();
    executeEditorCommand('toggleTaskList');
    return;
  }

  for (let level = 1; level <= 6; level += 1) {
    if (matchesShortcut(e, getSetting(`shortcuts.h${level}`, `Option+Cmd+${level}`))) {
      e.preventDefault();
      executeEditorCommand('setHeading', { level });
      return;
    }
  }
  if (matchesShortcut(e, getSetting('shortcuts.paragraph', 'Option+Cmd+0'))) {
    e.preventDefault();
    executeEditorCommand('setHeading', { level: 0 });
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.insertMdx', 'Cmd+Shift+M'))) {
    e.preventDefault();
    executeEditorCommand('insertMdx');
    return;
  }
  if (matchesShortcut(e, getSetting('shortcuts.insertTable', 'Option+Cmd+T'))) {
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
    if (modelBlock?.type === 'list') {
      e.preventDefault();
      executeEditorCommand(e.shiftKey ? 'outdentList' : 'indentList', {
        size: Number(getSetting('editor.indentSize', 2)) || 2,
      });
      return;
    }
    if (modelBlock?.type === 'code') {
      e.preventDefault();
      const selection = domSelectionToModel(qs('#block-editor'));
      const offset = selection?.anchor.offset ?? (source.textContent || '').length;
      const spaces = e.shiftKey ? '' : ' '.repeat(getSetting('editor.indentSize', 2));
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
async function openDocumentByPath(path) {
  const meta = await ReadDocumentWithMeta(path);
  const content = meta.content;
  const name = path.split('/').pop().replace(/\\/g, '/').split('/').pop();
  const dir = path.substring(0, path.lastIndexOf('/')) || '/';

  state.docDir = dir;
  state.currentDoc = { name, path, size: content.length, modTime: '' };
  state.currentContent = content;
  state.currentRevision = meta.revision || 0;
  state.currentHash = meta.contentHash || '';
  state.view = 'editor';
  state.isEditor = true;
  state.sidebarCollapsed = false;
  state.expandedDirs.clear();
  safety.startFileWatcher(path);
  try { AddRecentFile(path, name); } catch (e) {}
  try {
    state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
    state.docTree = await ListDocumentTree(dir) || [];
  } catch (e) {
    state.docs = [];
    state.docTree = [];
  }
  expandDocumentParents(path, state.docDir, state.expandedDirs);
  renderEditor();
}

async function loadHomeRecentFiles() {
  const listEl = qs('#home-recent-list');
  if (!listEl) return;
  try {
    const recentFiles = await ListRecentFiles(8) || [];
    listEl.innerHTML = recentFiles.length > 0
      ? recentFiles.map(file => `
        <button class="home-recent-item" data-path="${escapeHtml(file.path)}">
          <svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          <span class="home-recent-name">${escapeHtml(file.name)}</span>
          <span class="home-recent-path">${escapeHtml(file.path)}</span>
        </button>
      `).join('')
      : `<span class="home-recent-empty">${t('main.noRecent')}</span>`;
  } catch (e) {
    listEl.innerHTML = `<span class="home-recent-empty">${t('main.noRecent')}</span>`;
  }
  lucideIcons();
}

function renderHome() {
  state.view = 'home';

  $app.innerHTML = `
    <div class="home-shell app-shell-page home-page">
      <section class="app-panel home-surface">
        <div class="home-center">
          <header class="home-hero">
            <h1 class="home-title">Markdown Writing</h1>
            <p class="home-subtitle">${t('main.homeSubtitle')}</p>
          </header>
          <div class="home-actions">
            <button class="home-pill" id="home-action-new-doc">
              <svg data-lucide="file-plus" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.6"></svg>
              <span>${t('main.newDoc')}</span>
            </button>
            <button class="home-pill" id="home-action-open-file">
              <svg data-lucide="file-up" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.6"></svg>
              <span>${t('main.openFile')}</span>
            </button>
            <button class="home-pill" id="home-action-open-folder">
              <svg data-lucide="folder-open" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.6"></svg>
              <span>${t('main.openWorkspace')}</span>
            </button>
          </div>
          <section class="home-recent-block">
            <h2 class="home-recent-heading">${t('main.recentFiles')}</h2>
            <div class="home-recent-list" id="home-recent-list">
              <span class="home-recent-empty">${t('main.loading')}</span>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;

  lucideIcons();

  qs('#home-action-new-doc')?.addEventListener('click', () => {
    state.currentDoc = { id: null, name: `${t('main.untitled')}.md` };
    state.currentContent = '';
    state.currentRevision = 0;
    state.currentHash = '';
    state.isDirty = false;
    state.view = 'editor';
    renderEditor();
  });

  qs('#home-action-open-file')?.addEventListener('click', async () => {
    try {
      const path = await OpenDocumentFile();
      if (path) await openDocumentByPath(path);
    } catch (error) {
      if (error?.message !== 'canceled') console.error(error);
    }
  });

  qs('#home-action-open-folder')?.addEventListener('click', async () => {
    try {
      const dir = await SelectDocumentDir();
      if (!dir) return;
      state.docDir = dir;
      state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
      state.docTree = await ListDocumentTree(dir) || [];
      state.view = 'editor';
      renderEditor();
    } catch (error) {
      if (error?.message !== 'canceled') console.error(error);
    }
  });

  qs('#home-recent-list')?.addEventListener('click', async event => {
    const item = event.target.closest('.home-recent-item');
    if (!item) return;
    try {
      await openDocumentByPath(item.dataset.path);
    } catch (error) {
      console.error('打开最近文件失败:', error);
    }
  });

  void loadHomeRecentFiles();
}

// ============================================================
// 编辑器工作区初始化
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

  const docs = await ListDocuments(state.docDir) || [];
  state.docs = docs.filter(d => d.name.endsWith('.md') || d.isDir);
  try {
    state.docTree = await ListDocumentTree(state.docDir) || [];
  } catch (e) {
    state.docTree = [];
  }
  renderEditor();
  saveAppState();
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

  if (doc.path) {
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
    expandDocumentParents(doc.path, state.docDir, state.expandedDirs);
  }

  renderEditor();
  saveAppState();
}

async function openDroppedFiles(paths) {
  const markdownPath = (paths || []).find(path => /\.(md|markdown)$/i.test(path));
  if (!markdownPath) {
    if (paths?.length) showAppToast(t('main.dropUnsupported'), { error: true });
    return;
  }
  try {
    await saveCurrentDoc();
    const document = await AcceptDroppedDocument(markdownPath);
    const dir = markdownPath.substring(0, markdownPath.lastIndexOf('/')) || '/';
    state.docDir = dir;
    state.expandedDirs.clear();
    try {
      state.docs = (await ListDocuments(dir) || []).filter(item => item.name.endsWith('.md') || item.isDir);
      state.docTree = await ListDocumentTree(dir) || [];
    } catch (error) {
      state.docs = [];
      state.docTree = [];
    }
    await openEditor(document);
    showAppToast(t('main.dropOpened', { name: document.name }));
  } catch (error) {
    showAppToast(t('main.dropFailed', { message: error?.message || error }), { error: true });
  }
}

function exportDropdownHtml(id, extraClass = '') {
  return `
    <div class="export-dropdown ${extraClass} hidden" id="${id}">
      <button class="export-item" data-format="png"><svg data-lucide="image" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>${t('main.export.png')}</span></button>
      <button class="export-item" data-format="pdf"><svg data-lucide="file-text" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>${t('main.export.pdf')}</span></button>
      <button class="export-item" data-format="docx"><svg data-lucide="file-type" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>${t('main.export.docx')}</span></button>
      <button class="export-item" data-format="txt"><svg data-lucide="align-left" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg><span>${t('main.export.txt')}</span></button>
    </div>
  `;
}

// 根据路径在文件树中查找文档节点
function renderEditor() {
  closeFindReplace({ restoreFocus: false });
  disposeWorkspacePanel?.();
  disposeWorkspacePanel = null;
  workspacePanel = 'files';
  currentSidebarView = 'filetree';
  const name = state.currentDoc ? fileNameWithoutExt(state.currentDoc.name) : t('main.untitled');
  const wc = wordCount(state.currentContent || '');
  const hasDoc = !!state.currentDoc;

  // Build file tree (recursive from state.docTree)
  const fileTreeHtml = buildFileTreeHtml(state.docTree, 0);
  const hasWorkspaceDirectory = Boolean(state.docDir && state.docDir !== '/demo-docs');

  // Build right panel content
  let rightPanelHtml;
  if (hasDoc) {
    rightPanelHtml = `
      <header class="app-panel editor-titlebar" id="editor-view-titlebar">
        <div class="editor-titlebar-document">
          <div class="editor-document-copy">
            <span class="editor-document-name" id="editor-title">${escapeHtml(name)}.md${state.isDirty ? ' *' : ''}</span>
          </div>
        </div>
      </header>

      <div class="editor-content" id="editor-scroll">
        <div class="app-panel editor-paper" id="editor-paper">
          <div id="block-editor">
            ${buildBlockEditorHtml(state.currentContent || '')}
          </div>
        </div>
        <textarea class="app-panel editor-source" id="editor-source" spellcheck="false">${escapeHtml(state.currentContent || '')}</textarea>
      </div>

      <footer class="app-panel editor-statusbar statusbar">
        <div class="statusbar-left">
          <span id="mode-indicator">
            <svg data-lucide="${state.sourceMode ? 'code' : 'eye'}" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            <span>${state.sourceMode ? t('main.mode.source') : t('main.mode.preview')}</span>
          </span>
        </div>
        <div class="statusbar-right">
          <span id="line-count">${t('main.lines', { count: String(state.currentContent || '').split('\n').length })}</span>
          <span class="statusbar-divider">|</span>
          <span id="word-count">${t('main.words', { count: wc })}</span>
          <div class="editor-titlebar-actions">
            <button class="sidebar-icon" id="btn-history" title="${t('main.history')}">
              <svg data-lucide="history" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            </button>
            <button class="sidebar-icon" id="btn-delete-doc" title="${t('main.delete')}">
              <svg data-lucide="trash-2" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            </button>
            <div class="export-wrapper" id="export-wrapper">
              <button class="sidebar-icon" id="btn-export" data-export-button title="${t('main.export')}">
                <svg data-lucide="download" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </button>
              ${exportDropdownHtml('export-dropdown', 'export-dropdown-up')}
            </div>
          </div>
        </div>
      </footer>`;
  } else {
    // 无文档时的欢迎面板
    rightPanelHtml = `
      <div class="app-panel welcome-panel" id="welcome-panel">
        <div class="welcome-panel-inner welcome-dashboard">
          ${brandHeroHtml()}
          <div class="welcome-action-grid" id="welcome-panel-actions">
            <button class="welcome-dashboard-action welcome-dashboard-action-primary" id="wp-new-doc">
              <span class="welcome-dashboard-icon">
                <svg data-lucide="file-plus" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </span>
              <span class="welcome-dashboard-copy">
                <strong>${t('main.newDoc')}</strong>
                <small>${t('main.newDocHint')}</small>
              </span>
            </button>
            <button class="welcome-dashboard-action" id="wp-open-file">
              <span class="welcome-dashboard-icon">
                <svg data-lucide="file-up" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </span>
              <span class="welcome-dashboard-copy">
                <strong>${t('main.openFile')}</strong>
                <small>${t('main.openFileHint')}</small>
              </span>
            </button>
            <button class="welcome-folder-action" id="wp-open-folder">
              <svg data-lucide="folder-open" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <span>
                <strong>${t('main.openFolder')}</strong>
                <small>${t('main.openFolderHint')}</small>
              </span>
              <svg class="welcome-folder-arrow" data-lucide="chevron-right" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  $app.innerHTML = `
    <div class="view-shell" id="editor-view">
      <div class="editor-body" style="--editor-sidebar-width:${state.sidebarCollapsed ? 0 : state.sidebarWidth}px">
        <!-- 文件树侧栏（含独立顶部标题栏） -->
        <aside class="app-panel editor-sidebar-panel file-tree ${state.sidebarCollapsed ? 'collapsed' : ''} ${hasWorkspaceDirectory ? '' : 'workspace-empty'}" id="file-tree-container">
          <header class="sidebar-titlebar with-traffic-lights">
            <div class="sidebar-header">
              <span class="sidebar-app-name" id="sidebar-title"></span>
            </div>
          </header>
          <nav class="workspace-nav workspace-nav-primary" aria-label="文档导航">
            <button class="workspace-nav-item active" type="button" data-workspace-nav="files">
              <svg data-lucide="folder" width="15" height="15"></svg>
              <span data-i18n="main.nav.files">${t('main.nav.files')}</span>
            </button>
            <button class="workspace-nav-item" type="button" data-workspace-nav="outline">
              <svg data-lucide="list" width="15" height="15"></svg>
              <span data-i18n="main.nav.outline">${t('main.nav.outline')}</span>
            </button>
          </nav>
          <div class="sidebar-document-context" id="sidebar-document-context">
            <div class="sidebar-context-header">
              <div class="sidebar-context-title">
                <span class="sidebar-section-kicker" id="sidebar-section-kicker">FILES</span>
                <span class="sidebar-section-title" id="sidebar-section-title" data-i18n="main.files">${t('main.files')}</span>
              </div>
              <button class="sidebar-icon" id="sidebar-search-btn" title="${t('main.search')}" data-i18n-title="main.search">
                <svg data-lucide="search" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </button>
              <button class="sidebar-icon" id="sidebar-new-file-btn" title="${t('fileTree.newFile')}" data-i18n-title="fileTree.newFile">
                <svg data-lucide="file-plus" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              </button>
            </div>
            <div class="sidebar-search hidden" id="sidebar-search">
              <svg data-lucide="search" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
              <input type="text" class="sidebar-search-input" id="sidebar-search-input" placeholder="${t('main.searchFiles')}" data-i18n-placeholder="main.searchFiles" />
            </div>
            <nav class="file-tree-nav" id="file-tree-nav">
              ${fileTreeHtml || `<div class="sidebar-empty">${t('main.openFolder')}</div>`}
            </nav>
            <div class="file-tree-outline hidden" id="file-tree-outline">
              <div class="outline-list" id="outline-list"></div>
            </div>
          </div>
          <nav class="workspace-nav workspace-nav-footer" aria-label="应用导航">
            <button class="workspace-nav-item" type="button" data-workspace-nav="settings">
              <svg data-lucide="settings" width="15" height="15"></svg>
              <span data-i18n="main.nav.settings">${t('main.nav.settings')}</span>
            </button>
            <button class="workspace-nav-item workspace-nav-item-icon" id="btn-toggle-panel" type="button" title="${t('main.toggleSidebar')}" data-i18n-title="main.toggleSidebar">
              <svg data-lucide="panel-left" width="15" height="15"></svg>
            </button>
          </nav>
        </aside>

        <!-- 文件树与正文区之间的拖拽把手 -->
        <div class="panel-resizer editor-sidebar-resizer" id="sidebar-resizer" title="${t('main.dragSidebar')}"></div>

        <!-- 折叠后：左侧边缘悬浮展开按钮 -->
        <button class="sidebar-reopen ${state.sidebarCollapsed ? 'visible' : ''}" id="sidebar-reopen" title="${t('main.expandSidebar')}">
          <svg data-lucide="chevron-right" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.8"></svg>
        </button>

        <!-- 写作区 -->
        <div class="editor-writing-area">
          <div class="editor-document-view" id="editor-document-view">
            ${rightPanelHtml}
          </div>
          <div class="editor-workspace-host hidden" id="editor-workspace-host"></div>
        </div>
      </div>
    </div>
  `;

  lucideIcons();
  hookEditorEvents();
  updateExportPluginState();
  requestAnimationFrame(() => fileTree.revealActiveFileInTree());
  updateTitleDirty();

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
        const active = qs('#block-editor .block.active .block-rendered');
        if (active) active.focus();
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
      listEl.innerHTML = `
        <div class="welcome-recent-empty">
          <svg data-lucide="file-text" width="18" height="18" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          <strong>${t('main.noRecent')}</strong>
          <span>${t('main.noRecentHint')}</span>
        </div>
      `;
    }
    lucideIcons();
  } catch (e) {
    listEl.innerHTML = `<span class="welcome-panel-recent-empty">${t('main.noRecent')}</span>`;
  }
}

function hookWelcomePanelEvents() {
  const btn = qs('#wp-new-doc');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.currentDoc = { id: null, name: `${t('main.untitled')}.md` };
    state.currentContent = '';
    state.currentRevision = 0;
    state.currentHash = '';
    state.isDirty = false;
    renderEditor();
  });

  const btnFile = qs('#wp-open-file');
  if (btnFile) {
    btnFile.addEventListener('click', async () => {
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
        state.expandedDirs.clear();
        try {
          state.docs = (await ListDocuments(dir) || []).filter(d => d.name.endsWith('.md') || d.isDir);
          state.docTree = await ListDocumentTree(dir) || [];
        } catch (e) {
          state.docs = [];
          state.docTree = [];
        }
        renderEditor();
      } catch (e) { if (e && e.message !== 'canceled') console.error(e); }
    });
  }

  const btnFolder = qs('#wp-open-folder');
  if (btnFolder) {
    btnFolder.addEventListener('click', async () => {
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
let findReplaceSession = null;

let currentSidebarView = 'filetree';
let workspacePanel = 'files';
let disposeWorkspacePanel = null;
let editorDocumentEventsBound = false;

function toggleSidebarPanel() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  const container = qs('#file-tree-container');
  const reopen = qs('#sidebar-reopen');
  if (state.sidebarCollapsed) {
    container?.classList.add('collapsed');
    reopen?.classList.add('visible');
    applySidebarWidth(0);
  } else {
    container?.classList.remove('collapsed');
    reopen?.classList.remove('visible');
    applySidebarWidth(state.sidebarWidth);
  }
}

function updateSidebarView() {
  const tree = qs('#file-tree-nav');
  const outline = qs('#file-tree-outline');
  const sectionTitle = qs('#sidebar-section-title');
  const sectionKicker = qs('#sidebar-section-kicker');
  const searchBtn = qs('#sidebar-search-btn');
  const newFileBtn = qs('#sidebar-new-file-btn');

  if (currentSidebarView === 'filetree') {
    tree?.classList.remove('hidden');
    outline?.classList.add('hidden');
    searchBtn?.classList.remove('icon-placeholder');
    newFileBtn?.classList.remove('hidden');
    if (sectionKicker) sectionKicker.textContent = 'FILES';
    if (sectionTitle) sectionTitle.textContent = t('main.files');
  } else {
    tree?.classList.add('hidden');
    outline?.classList.remove('hidden');
    searchBtn?.classList.add('icon-placeholder');
    newFileBtn?.classList.add('hidden');
    if (sectionKicker) sectionKicker.textContent = 'OUTLINE';
    if (sectionTitle) sectionTitle.textContent = t('main.outline');
    generateOutline();
  }
  // Hide search when switching views
  qs('#sidebar-search')?.classList.add('hidden');
  const searchInput = qs('#sidebar-search-input');
  if (searchInput) searchInput.value = '';
}

function setWorkspacePanel(panel) {
  disposeWorkspacePanel?.();
  disposeWorkspacePanel = null;
  workspacePanel = panel;
  document.querySelectorAll('[data-workspace-nav]').forEach(item => {
    item.classList.toggle('active', item.dataset.workspaceNav === panel);
  });

  const documentContext = qs('#sidebar-document-context');
  const documentView = qs('#editor-document-view');
  const workspaceHost = qs('#editor-workspace-host');
  if (!documentView || !workspaceHost) return;

  if (panel === 'files' || panel === 'outline') {
    currentSidebarView = panel === 'files' ? 'filetree' : 'outline';
    documentContext?.classList.remove('hidden');
    documentView.classList.remove('hidden');
    workspaceHost.classList.add('hidden');
    workspaceHost.innerHTML = '';
    updateSidebarView();
    return;
  }

  documentContext?.classList.add('hidden');
  documentView.classList.add('hidden');
  workspaceHost.classList.remove('hidden');
  workspaceHost.innerHTML = '';

  if (panel === 'settings') {
    void openSettingsModal({
      container: workspaceHost,
      onClose: () => {
        setWorkspacePanel('files');
        renderEditor();
      },
    }).then(handle => {
      if (workspacePanel === 'settings') {
        disposeWorkspacePanel = () => handle?.dispose?.();
      }
    });
    return;
  }

}

function ensureFindReplacePanel() {
  const host = qs('#editor-document-view');
  if (!host) return null;
  let panel = qs('#find-replace-panel');
  if (panel) return panel;

  host.insertAdjacentHTML('beforeend', `
    <section class="find-replace-panel" id="find-replace-panel" aria-label="${t('find.query')} / ${t('find.replace')}">
      <div class="find-replace-row">
        <button class="find-replace-case" type="button" data-find-case title="${t('find.case')}" aria-pressed="false">Aa</button>
        <input class="find-replace-input" data-find-query type="text" placeholder="${t('find.query')}" autocomplete="off" spellcheck="false">
        <span class="find-replace-count" data-find-count>0 / 0</span>
        <button class="find-replace-icon" type="button" data-find-prev title="${t('find.previous')}" aria-label="${t('find.previous')}">
          <svg data-lucide="chevron-up" width="15" height="15"></svg>
        </button>
        <button class="find-replace-icon" type="button" data-find-next title="${t('find.next')}" aria-label="${t('find.next')}">
          <svg data-lucide="chevron-down" width="15" height="15"></svg>
        </button>
        <button class="find-replace-icon" type="button" data-find-close title="${t('common.close')}" aria-label="${t('common.close')}">
          <svg data-lucide="x" width="15" height="15"></svg>
        </button>
      </div>
      <div class="find-replace-row find-replace-replace-row hidden" data-find-replace-controls>
        <input class="find-replace-input" data-find-replacement type="text" placeholder="${t('find.replacement')}" autocomplete="off" spellcheck="false">
        <button class="find-replace-action" type="button" data-find-replace>${t('find.replace')}</button>
        <button class="find-replace-action" type="button" data-find-replace-all>${t('find.replaceAll')}</button>
      </div>
    </section>
  `);

  panel = qs('#find-replace-panel');
  panel.addEventListener('input', event => {
    if (!findReplaceSession) return;
    if (event.target.matches('[data-find-query]')) {
      findReplaceSession.query = event.target.value;
      refreshFindReplaceMatches({ resetIndex: true });
      return;
    }
    if (event.target.matches('[data-find-replacement]')) {
      findReplaceSession.replacement = event.target.value;
    }
  });

  panel.addEventListener('click', event => {
    if (event.target.closest('[data-find-close]')) {
      closeFindReplace();
      return;
    }
    if (event.target.closest('[data-find-case]')) {
      if (!findReplaceSession) return;
      findReplaceSession.caseSensitive = !findReplaceSession.caseSensitive;
      refreshFindReplaceMatches({ resetIndex: true });
      return;
    }
    if (event.target.closest('[data-find-prev]')) {
      moveFindMatch(-1);
      return;
    }
    if (event.target.closest('[data-find-next]')) {
      moveFindMatch(1);
      return;
    }
    if (event.target.closest('[data-find-replace-all]')) {
      replaceAllFindMatches();
      return;
    }
    if (event.target.closest('[data-find-replace]')) {
      replaceCurrentFindMatch();
    }
  });

  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFindReplace();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if ((event.metaKey || event.ctrlKey) && findReplaceSession?.replaceMode) {
      replaceAllFindMatches();
    } else if (event.altKey && findReplaceSession?.replaceMode) {
      replaceCurrentFindMatch();
    } else {
      moveFindMatch(event.shiftKey ? -1 : 1);
    }
  });

  lucideIcons();
  return panel;
}

function openFindReplace({ replace = false } = {}) {
  if (!state.currentDoc || state.view !== 'editor') return;
  const panel = ensureFindReplacePanel();
  if (!panel) return;

  if (!findReplaceSession) {
    findReplaceSession = {
      query: '',
      replacement: '',
      caseSensitive: false,
      matches: [],
      index: 0,
      replaceMode: replace,
    };
  } else {
    findReplaceSession.replaceMode = replace;
  }

  panel.classList.remove('hidden');
  const replaceControls = panel.querySelector('[data-find-replace-controls]');
  replaceControls?.classList.toggle('hidden', !findReplaceSession.replaceMode);
  refreshFindReplaceMatches({ resetIndex: true });

  const focusTarget = findReplaceSession.replaceMode
    ? panel.querySelector('[data-find-replacement]')
    : panel.querySelector('[data-find-query]');
  focusTarget?.focus();
  focusTarget?.select();
}

function closeFindReplace({ restoreFocus = true } = {}) {
  const panel = qs('#find-replace-panel');
  panel?.remove();
  findReplaceSession = null;
  if (!restoreFocus) return;
  if (state.sourceMode) {
    qs('#editor-source')?.focus();
    return;
  }
  const activeBlock = qs('#block-editor .block.active .block-rendered');
  if (activeBlock instanceof HTMLElement) activeBlock.focus();
}

function refreshFindReplaceMatches({ resetIndex = false } = {}) {
  if (!findReplaceSession) return;
  const { query, caseSensitive } = findReplaceSession;
  const matches = [];

  if (query) {
    if (state.sourceMode) {
      const source = qs('#editor-source');
      for (const match of findTextMatches(source?.value || '', query, { caseSensitive })) {
        matches.push({ ...match, kind: 'source' });
      }
    } else if (state.editorSession?.document) {
      for (const block of state.editorSession.document.blocks) {
        for (const match of findTextMatches(block.raw, query, { caseSensitive })) {
          matches.push({ ...match, kind: 'block', blockId: block.id });
        }
      }
    }
  }

  findReplaceSession.matches = matches;
  if (resetIndex) findReplaceSession.index = 0;
  if (matches.length === 0) findReplaceSession.index = 0;
  if (findReplaceSession.index >= matches.length) findReplaceSession.index = matches.length - 1;
  updateFindReplaceUi();
}

function updateFindReplaceUi() {
  const panel = qs('#find-replace-panel');
  if (!panel || !findReplaceSession) return;
  const count = panel.querySelector('[data-find-count]');
  const caseButton = panel.querySelector('[data-find-case]');
  const hasMatches = findReplaceSession.matches.length > 0;
  const position = hasMatches ? findReplaceSession.index + 1 : 0;
  if (count) count.textContent = `${position} / ${findReplaceSession.matches.length}`;
  caseButton?.classList.toggle('active', findReplaceSession.caseSensitive);
  caseButton?.setAttribute('aria-pressed', String(findReplaceSession.caseSensitive));
  panel.querySelectorAll('[data-find-prev], [data-find-next], [data-find-replace], [data-find-replace-all]')
    .forEach(button => { button.disabled = !hasMatches; });
}

function moveFindMatch(direction) {
  if (!findReplaceSession) return;
  refreshFindReplaceMatches();
  const matches = findReplaceSession.matches;
  if (!matches.length) return;
  findReplaceSession.index = (findReplaceSession.index + direction + matches.length) % matches.length;
  updateFindReplaceUi();
  focusFindMatch(matches[findReplaceSession.index]);
}

function focusFindMatch(match) {
  if (!match) return;
  if (match.kind === 'source' || state.sourceMode) {
    const source = qs('#editor-source');
    if (!source) return;
    source.focus();
    source.setSelectionRange(match.start, match.end);
    return;
  }

  const root = qs('#block-editor');
  if (!root) return;
  const block = [...root.querySelectorAll('.block')]
    .find(element => element.dataset.blockId === match.blockId);
  if (!block) return;
  const index = Number(block.dataset.blockIndex);
  if (Number.isInteger(index) && index !== activeBlockIndex) activateBlock(index);
  const rendered = block.querySelector('.block-rendered[contenteditable="true"]');
  if (rendered) {
    rendered.focus();
    setContentEditableSelection(rendered, match.start, match.end);
    rendered.scrollIntoView({ block: 'center' });
    return;
  }
  const source = block.querySelector('.block-source');
  if (!source) return;
  source.focus();
  setContentEditableSelection(source, match.start, match.end);
  source.scrollIntoView({ block: 'center' });
}

function setContentEditableSelection(root, start, end) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let offset = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  while (node) {
    const length = node.textContent?.length || 0;
    if (!startNode && start <= offset + length) {
      startNode = node;
      startOffset = Math.max(0, start - offset);
    }
    if (!endNode && end <= offset + length) {
      endNode = node;
      endOffset = Math.max(0, end - offset);
      break;
    }
    offset += length;
    node = walker.nextNode();
  }

  if (!startNode || !endNode) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceCurrentFindMatch() {
  if (!findReplaceSession) return;
  refreshFindReplaceMatches();
  const match = findReplaceSession.matches[findReplaceSession.index];
  if (!match) return;
  const replacement = findReplaceSession.replacement;

  if (match.kind === 'source' || state.sourceMode) {
    const source = qs('#editor-source');
    if (!source) return;
    source.value = replaceTextRange(source.value, match, replacement);
    state.currentContent = source.value;
    state.isDirty = true;
    autoResizeTextarea(source);
    updateWordCount();
    scheduleAutoSave();
    refreshFindReplaceMatches();
    if (findReplaceSession.matches.length) {
      setTimeout(() => focusFindMatch(findReplaceSession.matches[findReplaceSession.index]), 0);
    }
    return;
  }

  const session = state.editorSession;
  const block = session?.document?.getBlock(match.blockId);
  if (!session || !block) return;
  const nextRaw = replaceTextRange(block.raw, match, replacement);
  const transaction = session.createTransaction({ source: 'find-replace' }).replace(block.id, nextRaw);
  const result = session.apply(transaction);
  const caret = match.start + replacement.length;
  session.selection = createSelection(
    createPosition(block.id, caret),
    createPosition(block.id, caret),
  );
  state.selection = session.selection;
  state.currentContent = serializeDocument(result.document);
  state.isDirty = true;
  syncIncrementalBlocks(result.changedBlockIds);
  updateWordCount();
  scheduleAutoSave();
  refreshFindReplaceMatches();
  if (findReplaceSession.matches.length) {
    const nextIndex = Math.min(findReplaceSession.index, findReplaceSession.matches.length - 1);
    findReplaceSession.index = nextIndex;
    updateFindReplaceUi();
    setTimeout(() => focusFindMatch(findReplaceSession.matches[nextIndex]), 0);
  }
}

function replaceAllFindMatches() {
  if (!findReplaceSession) return;
  refreshFindReplaceMatches();
  const { query, replacement, caseSensitive, matches } = findReplaceSession;
  if (!query || !matches.length) return;

  if (state.sourceMode) {
    const source = qs('#editor-source');
    if (!source) return;
    const result = replaceAllText(source.value, query, replacement, { caseSensitive });
    if (!result.count) return;
    source.value = result.text;
    state.currentContent = source.value;
    state.isDirty = true;
    autoResizeTextarea(source);
    updateWordCount();
    scheduleAutoSave();
    refreshFindReplaceMatches({ resetIndex: true });
    return;
  }

  const session = state.editorSession;
  if (!session) return;
  const grouped = new Map();
  for (const match of matches) {
    if (!grouped.has(match.blockId)) grouped.set(match.blockId, []);
    grouped.get(match.blockId).push(match);
  }

  const transaction = session.createTransaction({ source: 'find-replace' });
  for (const [blockId, blockMatches] of grouped) {
    const block = session.document.getBlock(blockId);
    if (!block) continue;
    let raw = block.raw;
    for (let index = blockMatches.length - 1; index >= 0; index -= 1) {
      raw = replaceTextRange(raw, blockMatches[index], replacement);
    }
    transaction.replace(blockId, raw);
  }

  const result = session.apply(transaction);
  state.currentContent = serializeDocument(result.document);
  state.isDirty = true;
  syncIncrementalBlocks(result.changedBlockIds);
  updateWordCount();
  scheduleAutoSave();
  refreshFindReplaceMatches({ resetIndex: true });
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

  const collapsedKeys = new Set(
    [...listDiv.querySelectorAll('.outline-node.collapsed')]
      .map(node => node.dataset.outlineKey),
  );
  const headings = state.sourceMode
    ? headingsFromMarkdown(qs('#editor-source')?.value || state.currentContent)
    : headingsFromDocument(state.editorSession?.document);

  if (headings.length === 0) {
    listDiv.innerHTML = `<div class="sidebar-empty">${t('main.noHeadings')}</div>`;
    return;
  }

  const tree = buildOutlineTree(headings);
  listDiv.innerHTML = `<div class="outline-tree">${renderOutlineTree(tree, { collapsedKeys })}</div>`;
}

// 文件树侧栏宽度约束
const SIDEBAR_DEFAULT_WIDTH = 250;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;

// 侧栏宽度由 CSS 变量驱动，把手据此定位（与首页最近文档面板同构）
function applySidebarWidth(width) {
  const body = qs('#editor-view .editor-body');
  if (body) body.style.setProperty('--editor-sidebar-width', Math.round(width) + 'px');
}

function hookSidebarResize() {
  const container = qs('#file-tree-container');
  const resizer = qs('#sidebar-resizer');
  const reopen = qs('#sidebar-reopen');

  // 展开按钮
  reopen?.addEventListener('click', () => {
    state.sidebarCollapsed = false;
    if (state.sidebarWidth < SIDEBAR_MIN_WIDTH) state.sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
    container?.classList.remove('collapsed');
    reopen.classList.remove('visible');
    applySidebarWidth(state.sidebarWidth);
  });

  if (!resizer || !container) return;

  // 拖动期间关闭侧栏宽度过渡，保证跟手（与首页面板一致）
  resizer.addEventListener('mousedown', () => container.classList.add('resizing'));
  document.addEventListener('mouseup', () => container.classList.remove('resizing'));

  createSplitter({
    handle: resizer,
    axis: 'x',
    side: 'left',
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    collapseAt: SIDEBAR_MIN_WIDTH,
    getSize: () => container.getBoundingClientRect().width,
    setSize: next => {
      state.sidebarWidth = Math.round(next);
      state.sidebarCollapsed = false;
      container.classList.remove('collapsed');
      applySidebarWidth(next);
    },
    onCollapse: () => {
      state.sidebarCollapsed = true;
      // 先恢复过渡，折叠动画才能生效
      container.classList.remove('resizing');
      container.classList.add('collapsed');
      applySidebarWidth(0);
      reopen?.classList.add('visible');
    },
    // 窄窗口下侧栏改为浮层，此时不响应拖动
    isBlocked: () => getComputedStyle(container).position === 'absolute',
    onCommit: () => saveAppState(),
  });
}

function hookEditorEvents() {
  // 左侧导航切换
  document.querySelectorAll('[data-workspace-nav]').forEach(item => {
    item.addEventListener('click', () => setWorkspacePanel(item.dataset.workspaceNav));
  });

  // 面板开关（折叠/展开文件树侧栏）
  qs('#btn-toggle-panel')?.addEventListener('click', toggleSidebarPanel);

  // 导出按钮（编辑器右下角状态栏内的按钮组）
  const exportControls = [
    { trigger: qs('#btn-export'), menu: qs('#export-dropdown') },
  ];
  const hideExportMenus = () => {
    exportControls.forEach(control => control.menu?.classList.add('hidden'));
  };
  exportControls.forEach(control => {
    control.trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const shouldOpen = control.menu?.classList.contains('hidden');
      hideExportMenus();
      if (shouldOpen) control.menu?.classList.remove('hidden');
    });
    control.menu?.addEventListener('click', (e) => {
      const item = e.target.closest('.export-item');
      if (!item) return;
      const format = item.dataset.format;
      hideExportMenus();
      void handleExportWithPlugins(format);
      lucideIcons();
    });
  });

  // 点击其他区域关闭导出下拉
  if (!editorDocumentEventsBound) {
    editorDocumentEventsBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.export-wrapper')) {
        document.querySelectorAll('.export-dropdown').forEach(menu => menu.classList.add('hidden'));
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
    const toggle = e.target.closest('[data-outline-toggle]');
    if (toggle) {
      toggle.closest('.outline-node')?.classList.toggle('collapsed');
      return;
    }

    const item = e.target.closest('.outline-item');
    if (!item) return;
    if (state.sourceMode) {
      const offset = Number(item.dataset.sourceOffset);
      const sourceEditor = qs('#editor-source');
      if (!Number.isNaN(offset) && sourceEditor) {
        sourceEditor.focus();
        sourceEditor.setSelectionRange(offset, offset);
      }
      return;
    }
    const index = parseInt(item.dataset.blockIndex || '', 10);
    if (Number.isNaN(index)) return;
    activateBlock(index);
    qs('#block-editor')?.querySelectorAll('.block')[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // 文件树导航
  hookFileTreeEvents();

  // 侧边栏：宽度拖拽 + 自动折叠 + 展开
  hookSidebarResize();

  // 文档操作
  qs('#btn-history')?.addEventListener('click', () => safety.openHistory());
  qs('#btn-delete-doc')?.addEventListener('click', deleteCurrentDocument);

  // === 源码编辑器事件 ===
  const sourceEditor = qs('#editor-source');
  if (sourceEditor) {
    sourceEditor.addEventListener('input', () => {
      state.isDirty = true;
      state.currentContent = sourceEditor.value;
      autoResizeTextarea(sourceEditor);
      updateWordCount();
      if (currentSidebarView === 'outline') generateOutline();
      scheduleAutoSave();
    });

    sourceEditor.addEventListener('keydown', (e) => {
      if (matchesShortcut(e, getSetting('shortcuts.toggleSource', 'Cmd/Ctrl+/'))) {
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
      modeIndicator.innerHTML = `<svg data-lucide="code" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg> <span>${t('main.mode.source')}</span>`;
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
    state.selection = null;
    state.selectionIndex = 0;
    const parseResult = getLastParseResult();
    state.editorSession = parseResult?.document
      ? createEditorSession(parseResult.document, null)
      : null;
    restoreBlockSelection();
    if (modeIndicator) {
      modeIndicator.innerHTML = `<svg data-lucide="eye" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg> <span>${t('main.mode.preview')}</span>`;
      lucideIcons();
    }
    updateWordCount();
  }
  refreshFindReplaceMatches();
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
  if (wcEl) wcEl.textContent = t('main.words', { count: wc });
  const lines = (md || '').split('\n').length;
  const lcEl = qs('#line-count');
  if (lcEl) lcEl.textContent = t('main.lines', { count: lines });
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
  if (currentSidebarView === 'outline') generateOutline();
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

function executeEditorCommand(name, args = {}) {
  if (!state.editorSession) return null;
  captureBlockSelection();
  const result = editorCommands.execute(name, {
    session: state.editorSession,
    ...args,
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
  const domSelection = window.getSelection();
  const editable = domSelection?.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? domSelection.anchorNode.closest?.('.block-rendered')
    : domSelection?.anchorNode?.parentElement?.closest?.('.block-rendered');
  if (editable) {
    const block = editable.closest('.block');
    const blockId = block?.dataset.blockId;
    if (blockId) {
      const offset = getEditableTextOffset(editable, domSelection.anchorNode, domSelection.anchorOffset);
      state.selection = createSelection(
        createPosition(blockId, offset),
        createPosition(blockId, offset),
      );
      if (state.editorSession) state.editorSession.selection = state.selection;
      state.selectionIndex = Number(block.dataset.blockIndex);
      root.dataset.selectionBlock = blockId;
      root.dataset.selectionOffset = String(offset);
      return;
    }
  }
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
    if (state.editorSession) state.editorSession.selection = state.selection;
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
    const activeRendered = root.querySelector('.block.active .block-rendered[contenteditable="true"]');
    if (activeRendered && state.selection?.anchor?.blockId === activeRendered.closest('.block')?.dataset.blockId) {
      activeRendered.focus();
      setContentEditableSelection(activeRendered, state.selection.anchor.offset, state.selection.head.offset);
      root.dataset.selectionRestored = 'true';
      return;
    }
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
  void scheduleEditorShadowComparison(getCurrentMd());
  void parserWorker.compare(getCurrentMd()).then(result => {
    const editor = qs('#block-editor');
    if (editor && result) editor.dataset.workerRoundtrip = String(result.exact);
  }).catch(() => {});
  // 未命名文档（尚无本地路径）不做自动保存：否则会弹原生保存对话框。
  // 内容仍由上面的恢复快照保护，用户主动保存（Cmd+S / 菜单保存）时再选择位置。
  autoSaveTimer = setTimeout(() => {
    if (!state.currentDoc?.path) return;
    saveCurrentDoc();
  }, getSetting('editor.autosaveDelay', 2000));
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
    md = getCurrentMd();
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

  const needsSaveAs = !docSnapshot || saveAs || !docSnapshot.path;
  if (needsSaveAs) {
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
        container?.classList.remove('collapsed');
        applySidebarWidth(state.sidebarWidth);
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
  void SetPendingChanges(state.isDirty ? 1 : 0, state.currentDoc?.name || `${t('main.untitled')}.md`);
  const titleEl = qs('#editor-title');
  if (!titleEl) return;
  const name = state.currentDoc ? fileNameWithoutExt(state.currentDoc.name) : t('main.untitled');
  titleEl.textContent = `${name}.md${state.isDirty ? ' *' : ''}`;
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
  state.isDirty = true;
  renderEditor();
}

async function deleteCurrentDocument() {
  if (!state.currentDoc) return;
  if (!confirm(t('main.deleteConfirm'))) return;
  try {
    if (state.currentDoc.path) {
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

async function handleTreeDocumentDeleted(path) {
  if (state.currentDoc?.path === path) {
    safety.stopFileWatcher();
    await safety.clearRecoverySnapshot();
    state.currentDoc = null;
    state.currentContent = '';
    state.currentRevision = 0;
    state.currentHash = '';
    state.selection = null;
    state.selectionIndex = null;
    state.isDirty = false;
    state.editorSession = null;
    compositionController.cancel();
    resetParseResult();
  }
  await initLibrary();
}

// ============================================================
// Lucide 图标初始化
// ============================================================
// ============================================================
// 应用启动
// ============================================================
async function init() {
  $app = document.querySelector('#app');
  markdownAssetResolver.start();

  // 关闭守卫必须在恢复流程之前注册，否则恢复文档后提前返回会导致应用无法关闭。
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

  if (!isBrowserMode()) {
    try {
      OnFileDrop((_x, _y, paths) => {
        void openDroppedFiles(paths);
      }, true);
    } catch (error) {
      console.warn('Native file drop is unavailable:', error);
    }
  }

  await pluginRuntime.start();

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

  // 菜单栏保存事件监听（Wails 开发模式热重载时可能失败）
  try { EventsOn('menu:save', () => { saveCurrentDoc(false); }); } catch (e) {}
  try { EventsOn('menu:saveas', () => { saveCurrentDoc(true); }); } catch (e) {}

  window.addEventListener('beforeunload', (event) => {
    if (!state.isDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('app-language-change', () => {
    if (state.view === 'home') {
      void renderHome();
    } else if (state.view === 'editor') {
      renderEditor();
    }
  });

  // Cmd+S 全局保存
  document.addEventListener('keydown', (e) => {
    if (state.view === 'editor' && state.currentDoc) {
      if (matchesShortcut(e, getSetting('shortcuts.find', 'Cmd+F'))) {
        e.preventDefault();
        openFindReplace();
        return;
      }
      if (matchesShortcut(e, getSetting('shortcuts.replace', 'Cmd+H'))) {
        e.preventDefault();
        openFindReplace({ replace: true });
        return;
      }
    }
    if (matchesShortcut(e, getSetting('shortcuts.openSettings', 'Cmd+,'))) {
      e.preventDefault();
      setWorkspacePanel('settings');
      return;
    }
    if (matchesShortcut(e, getSetting('shortcuts.toggleSidebar', 'Cmd+Shift+B'))) {
      e.preventDefault();
      setWorkspacePanel(workspacePanel === 'outline' ? 'files' : 'outline');
      return;
    }
    if (matchesShortcut(e, getSetting('shortcuts.save', 'Cmd+S'))) {
      e.preventDefault();
      saveCurrentDoc(false);
    }
  });

  // 恢复文档目录等轻量状态，但始终从首页启动。
  let lastState = null;
  try { lastState = await restoreAppState(); } catch (e) {}
  if (lastState?.docDir) state.docDir = lastState.docDir;
  restorePanelWidths(lastState);
  await renderHome();
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
    : t('main.untitled');
  return name + '.' + ext;
}

let appToastTimer = null;

function showAppToast(message, { error = false } = {}) {
  let toast = document.querySelector('#app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  window.clearTimeout(appToastTimer);
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  requestAnimationFrame(() => toast.classList.add('visible'));
  appToastTimer = window.setTimeout(() => {
    toast.classList.remove('visible');
  }, 2800);
}

async function handleExportWithPlugins(format) {
  const exportService = pluginRuntime?.getService('export');
  if (!exportService?.handleExport) {
    showAppToast(t('find.exportDisabled'), { error: true });
    return;
  }
  try {
    const result = await exportService.handleExport(format);
    if (result?.canceled) return;
    const label = format === 'docx' ? 'Word' : format.toUpperCase();
    if (result?.printed) {
      showAppToast(t('main.exportPrinted'));
      return;
    }
    const fileName = result?.path?.split(/[\\/]/).pop();
    showAppToast(fileName
      ? t('main.exportSaved', { name: fileName })
      : t('main.exportReady', { format: label }));
  } catch (error) {
    if (/canceled|cancelled/i.test(String(error?.message || error))) return;
    showAppToast(t('main.exportFailed', { message: error?.message || error }), { error: true });
  }
}

function updateExportPluginState() {
  const enabled = Boolean(pluginRuntime?.getService('export'));
  document.querySelectorAll('[data-export-button]').forEach(button => {
    button.disabled = !enabled;
    button.classList.toggle('is-disabled', !enabled);
    button.title = enabled ? t('main.export') : t('main.exportDisabledTitle');
  });
}

const exportModule = createExportModule({
  getCurrentMd,
  getExportName,
  renderMarkdown: markdownRenderer.render,
  escapeHtml,
  saveExportFile: SaveExportFile,
  alert,
});
const { handleExport } = exportModule;

const fileTree = createFileTreeModule({
  state,
  storage,
  escapeHtml,
  fileNameWithoutExt,
  lucideIcons,
  openEditor,
  saveCurrentDoc,
  onCurrentDocumentDeleted: handleTreeDocumentDeleted,
  t,
});
const {
  findDocByPath,
  buildFileTreeHtml,
  renderFileTreeNav,
  hookFileTreeEvents,
} = fileTree;

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
  getWatcherInterval: () => getSetting('files.watcherInterval', 3000),
});

const settingsModule = createSettingsModule({
  state,
  storage,
  appVersion: APP_VERSION,
  appRepo: APP_REPO,
  checkForUpdate,
  openExternal: isBrowserMode() ? null : url => BrowserOpenURL(url),
  qs,
  getApp: () => $app,
  lucideIcons,
  renderEditor,
});

const {
  loadSettings,
  saveSettings,
  applySettings,
  getSettings,
  getSetting,
  setPluginRuntime,
  openSettingsModal,
} = settingsModule;

async function loadPluginPreferences() {
  try {
    const settings = await storage.loadAppSettings();
    if (settings?.pluginPreferences) return JSON.parse(settings.pluginPreferences);
  } catch (error) {
    // Fall through to local storage.
  }
  try {
    return JSON.parse(localStorage.getItem('plugin_preferences') || '{}');
  } catch (error) {
    return {};
  }
}

async function savePluginPreferences(preferences) {
  const serialized = JSON.stringify(preferences || {});
  try {
    await storage.saveAppSetting('pluginPreferences', serialized);
  } catch (error) {
    // Browser adapter does not persist app settings.
  }
  try {
    localStorage.setItem('plugin_preferences', serialized);
  } catch (error) {
    // Ignore local storage failure.
  }
}

pluginRuntime = createAppPluginRuntime({
  appVersion: APP_VERSION,
  hostName: storage.name === 'wails' ? 'Wails' : 'Browser',
  hostService: {
    name: storage.name,
    appVersion: APP_VERSION,
  },
  editorCoreService: {
    parse: markdown => parseMarkdown(markdown),
    createSession: (markdown, selection = null) => createEditorSession(parseMarkdown(markdown), selection),
    serialize: serializeDocument,
  },
  markdownService: {
    render: markdown => markdownRenderer.render(markdown),
    sanitize: sanitizeHtml,
  },
  shortcutService: {
    all: () => getSettings().shortcuts,
    get: key => getSetting(`shortcuts.${key}`, ''),
  },
  workspaceService: {
    selectDirectory: NativeSelectDocumentDir,
    listDocuments: NativeListDocuments,
    listDocumentTree: NativeListDocumentTree,
    readDocument: NativeReadDocument,
    readDocumentWithMeta: NativeReadDocumentWithMeta,
    writeDocument: NativeWriteDocument,
    writeImageAsset: NativeWriteImageAsset,
  },
  documentStoreService: {
    listFileVersions: NativeListFileVersions,
    restoreFileVersion: NativeRestoreFileVersion,
    deleteDocument: NativeDeleteDocument,
    listRecycleBin: NativeListRecycleBin,
    restoreRecycleItem: NativeRestoreRecycleItem,
    purgeRecycleItem: NativePurgeRecycleItem,
  },
  settingsService: {
    load: loadSettings,
    save: saveSettings,
    get: getSetting,
  },
  exportService: {
    handleExport,
  },
  recoveryService: {
    persist: safety.persistRecoverySnapshot,
    clear: safety.clearRecoverySnapshot,
    restore: safety.offerCrashRecovery,
  },
  pluginStorage: storage,
  loadPreferences: loadPluginPreferences,
  savePreferences: savePluginPreferences,
});

setPluginRuntime(pluginRuntime);
pluginRuntime.subscribe(updateExportPluginState);

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

const application = bootstrapApplication({ init });
application.onDispose(() => {
  if (!isBrowserMode()) {
    try { OnFileDropOff(); } catch (error) {}
  }
  markdownAssetResolver.stop();
  void pluginRuntime.dispose();
});
void application.start();
