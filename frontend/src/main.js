import './style.css';

import { version as APP_VERSION } from '../package.json';
import { BrowserOpenURL, EventsOn, OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime';
import { bootstrapApplication } from './app/bootstrap';
import { syncDirtyState } from './core/dirty-state.js';
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
import { compareVersions, createAppPluginRuntime } from './plugin-runtime';
import { isBrowserMode, storage } from './services/document-store';
import { brandHeroHtml, DEFAULT_LOGO_ID, getLogoUrl } from './ui/brand';
import { autoResizeTextarea, debounce, escapeHtml, qs } from './ui/dom';
import { findTextMatches, replaceAllText, replaceTextRange } from './ui/editor/find-replace';
import { renderIcons as lucideIcons } from './ui/icons';
import { canPeekBlock, createSourcePeek } from './ui/source-peek.js';
import { createSplitter } from './ui/splitter';
import {
  buildOutlineTree,
  headingsFromDocument,
  headingsFromMarkdown,
  renderOutlineTree,
} from './ui/outline';
import { expandDocumentParents } from './ui/paths.js';
import {
  getEditableTextOffset,
  getRenderedTextLength,
  isLayoutWhitespaceNode,
  renderedHtmlToMarkdown,
} from './ui/wysiwyg.js';
import { planPaste } from './ui/paste.js';

const {
  selectDocumentDir: NativeSelectDocumentDir,
  listDocuments: NativeListDocuments,
  listDocumentTree: NativeListDocumentTree,
  readDocument: NativeReadDocument,
  readImageAsset: NativeReadImageAsset,
  writeDocument: NativeWriteDocument,
  writeImageAsset: NativeWriteImageAsset,
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
const WriteDocument = pluginServiceProxy('workspace', 'writeDocument', NativeWriteDocument);
const WriteImageAsset = pluginServiceProxy('workspace', 'writeImageAsset', NativeWriteImageAsset);
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
const CJK_CHAR_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const LATIN_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const PUNCTUATION_PATTERN = /\p{P}/gu;

function computeStats(text) {
  const source = String(text || '');
  const cjk = (source.match(CJK_CHAR_PATTERN) || []).length;
  const latinWords = (source.match(LATIN_WORD_PATTERN) || []).length;
  return {
    // 词数：中日韩字符数 + 英文单词数
    words: cjk + latinWords,
    characters: source.length,
    charactersNoSpaces: source.replace(/\s+/g, '').length,
    cjk,
    charactersNoPunctuation: source.replace(PUNCTUATION_PATTERN, '').length,
    lines: source.split('\n').length,
  };
}

function formatStatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
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
const sourcePeek = createSourcePeek({
  onApply: applySourcePeek,
  onOpenChange: open => document.body.classList.toggle('source-peek-open', open),
  labels: {
    title: t('sourcePeek.title'),
    cancel: t('sourcePeek.cancel'),
    apply: t('sourcePeek.apply'),
    editorLabel: t('sourcePeek.editorLabel'),
    hint: t('sourcePeek.hint'),
  },
});
async function scheduleEditorShadowComparison(markdown) {
  if (!import.meta.env.DEV) return;
  try {
    const { scheduleShadowComparison } = await import('./dev-tools/markdown-shadow/markdown-shadow.js');
    scheduleShadowComparison(markdown);
  } catch (error) {
    console.warn('Editor shadow comparison unavailable:', error);
  }
}

// 激活指定块
async function activateBlock(index) {
  const container = qs('#block-editor');
  if (!container) return;
  let blocks = container.querySelectorAll('.block');
  if (index < 0) index = 0;
  if (index >= blocks.length) index = blocks.length - 1;

  // 等待当前块的全部同步任务落盘，避免点击切换时用旧源码覆盖刚粘贴的内容。
  const pendingBlock = container.querySelector('.block.active');
  if (pendingBlock) await syncRenderedBlock(pendingBlock);

  const refreshedContainer = qs('#block-editor');
  if (!refreshedContainer) return;
  blocks = refreshedContainer.querySelectorAll('.block');
  if (index >= blocks.length) index = blocks.length - 1;

  const prevActive = refreshedContainer.querySelector('.block.active');
  if (prevActive) {
    prevActive.classList.remove('active');
    const prevSource = prevActive.querySelector('.block-source');
    if (prevSource) {
      prevSource.contentEditable = 'false';
      const raw = (prevSource.textContent || '').replace(/\u200B/g, '');
      prevActive.__raw = raw;
      const rendered = renderBlockHtml({
        type: prevActive.dataset.blockType || 'paragraph',
        raw,
        level: Number(prevActive.dataset.blockLevel) || undefined,
        ordered: prevActive.dataset.blockOrdered === 'true',
      });
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
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(rendered);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

// 用模型块直接建 DOM 元素。
// 不能拿「重新解析 markdown 得到的 HTML」当模板按 id 查：那份 HTML 的 data-block-id 来自解析器，
// 和会话里新生成的块 id（例如 Enter 分块产生的块）对不上，查不到就会漏块——
// 表现出来就是「撤销到底再重做，块没回来」（模型有、DOM 没有）。
function createBlockElement(block) {
  const element = document.createElement('div');
  element.className = 'block';
  element.dataset.blockId = block.id;
  element.dataset.blockType = block.type;

  const source = document.createElement('div');
  source.className = 'block-source';
  source.contentEditable = 'false';
  source.hidden = true;
  source.textContent = block.raw || '\u200B';

  const rendered = document.createElement('div');
  rendered.className = 'block-rendered';
  rendered.contentEditable = 'false';
  rendered.spellcheck = true;
  rendered.innerHTML = '<p><br></p>';

  element.append(source, rendered);
  return element;
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
      // 勾选框是 disabled 的 <input>：Chromium 不会为它派发 click/mousedown，
      // 事件直接落到容器上，所以只能在容器里用坐标命中检测判断「点的是不是勾选框」。
      rendered.removeEventListener('mousedown', onRenderedCheckboxMousedown, true);
      rendered.addEventListener('mousedown', onRenderedCheckboxMousedown, true);
      rendered.removeEventListener('input', onRenderedBlockInput);
      rendered.addEventListener('input', onRenderedBlockInput);
      rendered.removeEventListener('beforeinput', onRenderedBlockBeforeInput);
      rendered.addEventListener('beforeinput', onRenderedBlockBeforeInput);
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
  // 以 DOM 上的 .active 为准：activeBlockIndex 可能因为别处的夹紧逻辑与 DOM 脱节，
  // 一旦脱节，点击「下一个」块会被误判为「已经激活」而毫无反应。
  const activeIndex = Number(qs('#block-editor .block.active')?.dataset.blockIndex);
  if (!isNaN(idx) && idx !== activeIndex) {
    captureBlockSelection();
    void activateBlock(idx);
  }
}

function onBlockInput(e) {
  // 未能在 beforeinput 阶段拦下的原生撤销/重做（historyUndo/historyRedo）：丢弃 DOM 变更，改用模型级撤销/重做。
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    const action = e.inputType === 'historyUndo' ? 'undo' : 'redo';
    const session = state.editorSession;
    const result = session ? (action === 'undo' ? session.undo() : session.redo()) : null;
    if (result) {
      applyHistoryResult(result, action);
    } else {
      const block = e.target.closest?.('.block');
      const raw = block ? session?.document?.getBlock(block.dataset.blockId)?.raw : null;
      if (block && typeof raw === 'string') {
        e.target.textContent = raw;
        renderBlockFromSource(e.target, block);
      }
    }
    state.suppressNextInput = true;
    return;
  }
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

function syncRenderedBlock(block) {
  if (!block) return Promise.resolve();
  const previous = block.richSyncPromise || Promise.resolve();
  const current = previous
    .catch(error => {
      console.error('[editor] previous block sync failed', error);
    })
    .then(() => syncRenderedBlockNow(block))
    .catch(error => {
      // 不能再静默吞掉：同步失败的后果是「DOM 有内容、模型没有」，保存时会丢数据。
      console.error('[editor] block sync failed', error);
      const editor = qs('#block-editor');
      if (editor) editor.dataset.syncError = String(error?.message || error);
    });
  block.richSyncPromise = current;
  void current.finally(() => {
    if (block.richSyncPromise === current) delete block.richSyncPromise;
  });
  return current;
}

async function syncRenderedBlockNow(block) {
  if (!block || !state.editorSession?.document) return;
  const rendered = block.querySelector('.block-rendered');
  const source = block.querySelector('.block-source');
  const blockId = block.dataset.blockId;
  if (!rendered || !source || !blockId) return;

  const modelBlock = state.editorSession.document.getBlock(blockId);
  const raw = await renderedHtmlToMarkdown(
    rendered.innerHTML,
    rendered.innerText || rendered.textContent || '',
  );
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
    // DOM 文本里没有 `#`、`> `、`- ` 这些前缀，直接当成模型偏移会让后续 restoreBlockSelection
    // 把光标放回行首（列表/标题/引用里打字会出现字符插到前面的现象），所以这里补上前缀。
    const offset = getEditableTextOffset(rendered, selection.anchorNode, selection.anchorOffset)
      + blockMarkdownPrefix(modelBlock);
    setModelSelection(createSelection(
      createPosition(blockId, offset),
      createPosition(blockId, offset),
    ));
  }
  const nextModelBlock = transactionResult?.document.getBlock(blockId);
  // 手打的任务列表标记（`- [ ] x`）与普通列表是同一个块类型，不会走上面的类型变化分支，
  // 可视区就会一直停在字面量 `[ ]` 上；这里补一次重渲染把勾选框画出来。
  const currentModelBlock = nextModelBlock || state.editorSession.document.getBlock(blockId);
  const typedTaskMarker = currentModelBlock?.type === 'list'
    && !rendered.querySelector('input[type="checkbox"]')
    && /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]/.test(currentModelBlock.raw || '');
  if ((nextModelBlock && nextModelBlock.type !== modelBlock?.type) || typedTaskMarker) {
    syncIncrementalBlocks(transactionResult?.changedBlockIds || [blockId]);
  }
  state.isDirty = true;
  updateTitleDirty();
  updateWordCount();
  scheduleAutoSave();
}

function onRenderedBlockBeforeInput(event) {
  // 浏览器原生撤销会直接改 DOM（且只撤一个字符），与模型撤销栈脱节；一律改走模型级撤销/重做。
  if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
  event.preventDefault();
  const action = event.inputType === 'historyUndo' ? 'undo' : 'redo';
  const session = state.editorSession;
  if (!session) return;
  applyHistoryResult(action === 'undo' ? session.undo() : session.redo(), action);
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

function renderedSelectionOffsets(rendered) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!rendered.contains(range.startContainer) || !rendered.contains(range.endContainer)) return null;
  return {
    start: getEditableTextOffset(rendered, range.startContainer, range.startOffset),
    end: getEditableTextOffset(rendered, range.endContainer, range.endOffset),
  };
}

// 本块里第 index 个勾选框 → 模型 raw 里第 index 行任务项的 `[ ]` 中间那个字符的偏移。
// 可视区 DOM 不保留 Markdown 前缀，且列表项结构里混着排版空白，只能按「第几个」对齐。
function taskMarkerOffset(rendered, modelBlock, checkbox) {
  const boxes = [...rendered.querySelectorAll('input.md-task')];
  const index = boxes.indexOf(checkbox);
  if (index < 0) return null;
  const raw = modelBlock.raw || '';
  const pattern = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/;
  const offsets = [];
  let lineStart = 0;
  for (;;) {
    const lineEndIndex = raw.indexOf('\n', lineStart);
    const lineEnd = lineEndIndex === -1 ? raw.length : lineEndIndex;
    const match = pattern.exec(raw.slice(lineStart, lineEnd));
    if (match) offsets.push(lineStart + match[1].length + 1);
    if (lineEndIndex === -1) break;
    lineStart = lineEndIndex + 1;
  }
  return offsets[index] ?? null;
}

// disabled 的 <input> 不参与命中测试（elementFromPoint / elementsFromPoint 都会跳过它），
// 所以只能拿勾选框自己的矩形去比对坐标。
function hitTaskCheckbox(rendered, clientX, clientY, pad = 2) {
  for (const box of rendered.querySelectorAll('input.md-task')) {
    const rect = box.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (clientX >= rect.left - pad && clientX <= rect.right + pad
      && clientY >= rect.top - pad && clientY <= rect.bottom + pad) {
      return box;
    }
  }
  return null;
}

// 点击可视区勾选框 → 切换该任务项的 `[ ]` / `[x]`（Typora 行为）。
// 整个操作走模型事务：DOM 只是渲染结果，勾选状态以模型为唯一真源，撤销/重做、字数、脏标记都跟着模型走。
function onRenderedCheckboxMousedown(event) {
  if (state.sourceMode || event.button !== 0 || !state.editorSession?.document) return;
  const container = event.target?.closest?.('.block-rendered');
  if (!container) return;
  const checkbox = hitTaskCheckbox(container, event.clientX, event.clientY);
  if (!checkbox) return;
  const block = container.closest('.block');
  const blockId = block?.dataset.blockId;
  const modelBlock = blockId ? state.editorSession.document.getBlock(blockId) : null;
  if (!modelBlock) return;
  const offset = taskMarkerOffset(container, modelBlock, checkbox);
  if (offset == null) return;
  // 阻止 contenteditable 抢焦点/放光标：命中后这个块马上会被重渲染替换，原生选区留在旧节点上没有意义。
  event.preventDefault();
  setModelSelection(createSelection(
    createPosition(blockId, offset),
    createPosition(blockId, offset),
  ));
  executeEditorCommand('toggleTaskChecked', {}, { capture: false });
}

// 剪贴板 HTML 里出现这些块级标签，说明浏览器会往可视区插一段自带标签的 DOM（而不是纯文本）。
const BLOCK_LEVEL_CLIPBOARD_HTML = /<(?:table|thead|tbody|tfoot|tr|th|td|ul|ol|li|h[1-6]|blockquote|pre|hr|div|section|article)\b/i;

function onRenderedBlockPaste(event) {
  const block = event.target?.closest?.('.block');
  const rendered = block?.querySelector('.block-rendered');
  const text = event.clipboardData?.getData('text/plain') ?? '';
  const html = event.clipboardData?.getData('text/html') ?? '';

  // 剪贴板里没有值得保留的标记时以纯文本为准（见 ui/paste.js 里对空行放大的说明）。
  const blockId = block?.dataset.blockId;
  const modelBlock = blockId ? state.editorSession?.document?.getBlock(blockId) : null;
  const offsets = rendered ? renderedSelectionOffsets(rendered) : null;
  const plan = modelBlock
    ? planPaste({
      clipboardText: text,
      clipboardHtml: html,
      renderedHtml: rendered?.innerHTML || '',
      blockType: modelBlock.type,
      offsets,
      raw: modelBlock.raw,
    })
    : null;
  if (plan) {
    event.preventDefault();
    applyModelBlockUpdate(blockId, plan.nextRaw, plan.caret, {
      source: 'paste',
      coalesceKey: null,
      selection: createSelection(
        createPosition(blockId, offsets.start),
        createPosition(blockId, offsets.end),
      ),
    });
    return;
  }

  // 富文本粘贴是浏览器自己往可视区插 DOM：插进来的表格/列表带的是剪贴板那一套标签，没有渲染层的
  // class（`.md-table` 等），可视区就会停在「外来 HTML」上（无样式表格），直到源码模式往返才恢复。
  // 这类粘贴结束后按模型重渲染一次；纯文本粘贴走上面的模型写入分支，不走这里。
  const forceRerender = BLOCK_LEVEL_CLIPBOARD_HTML.test(html);
  requestAnimationFrame(async () => {
    const pasted = block || document.activeElement?.closest?.('.block');
    if (!pasted) return;
    const pastedId = pasted.dataset.blockId;
    await syncRenderedBlock(pasted);
    if (forceRerender && pastedId) syncIncrementalBlocks([pastedId]);
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
      // 空块后还有内容：把焦点交给下一个块（列表/引用里「回车跳出」的既有手感）。
      block.classList.remove('active');
      const currentRendered = block.querySelector('.block-rendered');
      if (currentRendered) currentRendered.contentEditable = 'false';
      nextBlockElement.classList.add('active');
      const nextRendered = nextBlockElement.querySelector('.block-rendered');
      if (nextRendered) {
        nextRendered.contentEditable = 'true';
        nextRendered.focus();
      }
      return;
    }
    // 末尾的空块不能什么都不做（用户看到的现象就是「回车没反应」）：继续往下走，
    // 按 cursor=0 切分，等于在下面再起一行。
  }
  const textOffset = getEditableTextOffset(rendered, range.endContainer, range.endOffset);
  // 必须和 getEditableTextOffset 用同一把尺子：textContent 会把 `<ul>\n<li>` 之间的排版空白也算进去。
  const textLength = getRenderedTextLength(rendered);
  const prefix = blockMarkdownPrefix(modelBlock);
  // 偏移来自 DOM，模型可能与之脱节；必须夹紧到 raw 长度，否则 splitBlock 会抛 RangeError
  const cursor = Math.max(0, Math.min(
    raw.length,
    textOffset >= textLength ? raw.length : textOffset + prefix,
  ));
  const documentIndex = state.editorSession.document.getBlockIndex(blockId);
  let result;
  try {
    const transaction = state.editorSession
      .createTransaction({ source: 'keyboard' })
      .split(blockId, cursor);
    transaction.insert(documentIndex + 1, createMarkdownSeparatorBlock());
    result = state.editorSession.apply(transaction);
  } catch (error) {
    console.error('[editor] split block failed', error);
    return;
  }
  state.currentContent = serializeDocument(result.document);
  const rightBlock = result.document.blocks
    .slice(documentIndex + 1)
    .find(candidate => !candidate.attrs?.separator);
  if (rightBlock) {
    setModelSelection(createSelection(
      createPosition(rightBlock.id, 0),
      createPosition(rightBlock.id, 0),
    ));
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


function openSourcePeek() {
  if (state.sourceMode || sourcePeek.isOpen() || !state.editorSession) return;
  captureBlockSelection();
  const activeBlock = qs('#block-editor .block.active');
  const blockId = activeBlock?.dataset.blockId || state.selection?.anchor?.blockId;
  const block = blockId ? state.editorSession.document.getBlock(blockId) : null;
  if (!block || !canPeekBlock(block.type)) return;
  sourcePeek.open(blockId, { raw: block.raw, type: block.type });
}

function applySourcePeek(blockId, raw) {
  const session = state.editorSession;
  const before = session?.document.getBlock(blockId);
  if (!session || !before || before.raw === raw) return;
  const result = session.apply(
    session.createTransaction({ source: 'source-peek' }).replace(blockId, raw),
  );
  state.currentContent = serializeDocument(result.document);
  setModelSelection(createSelection(
    createPosition(blockId, raw.length),
    createPosition(blockId, raw.length),
  ));
  state.selectionIndex = result.document.blocks
    .filter(block => !block.attrs?.separator)
    .findIndex(block => block.id === blockId);
  syncIncrementalBlocks(result.changedBlockIds);
  state.isDirty = true;
  updateTitleDirty();
  updateWordCount();
  restoreBlockSelection();
  scheduleAutoSave();
}

// 编辑器快捷键表（可视区块与源码块共用一张表）。
// 可视区原来只认 Cmd+B / Cmd+I / Cmd+Shift+S，Cmd+E、Cmd+Shift+H、Cmd+K、Cmd+Shift+U …
// 都落回浏览器默认行为，用户看到的就是「按了没反应」。这里把两个模式收敛到同一张表，
// 键名与设置面板里的 SHORTCUT_DEFINITIONS 一一对应（用户可以改键）。
const INLINE_FORMAT_SHORTCUTS = [
  { setting: 'bold', fallback: 'Cmd+B', command: 'toggleStrong' },
  { setting: 'italic', fallback: 'Cmd+I', command: 'toggleEmphasis' },
  { setting: 'strike', fallback: 'Cmd+Shift+S', command: 'toggleStrike' },
  { setting: 'inlineCode', fallback: 'Cmd+E', command: 'toggleInlineCode' },
  { setting: 'highlight', fallback: 'Cmd+Shift+H', command: 'toggleHighlight' },
  { setting: 'link', fallback: 'Cmd+K', command: 'insertLink' },
];

// 光标（没有选中内容）时的加粗/斜体/删除线沿用浏览器的「待输入格式」：接着敲的字直接带上标记。
// 光标状态走模型命令只会插入占位文本，而「下一次输入加粗」这种挂起状态没法用模型表达。
const RENDERED_PENDING_FORMAT = {
  toggleStrong: 'bold',
  toggleEmphasis: 'italic',
  toggleStrike: 'strikeThrough',
};

const BLOCK_COMMAND_SHORTCUTS = [
  { setting: 'codeBlock', fallback: 'Cmd+Shift+C', command: 'toggleCodeBlock' },
  { setting: 'quote', fallback: 'Cmd+Shift+Q', command: 'toggleQuote' },
  { setting: 'unorderedList', fallback: 'Cmd+Shift+U', command: 'toggleUnorderedList' },
  { setting: 'orderedList', fallback: 'Cmd+Shift+O', command: 'toggleOrderedList' },
  { setting: 'taskList', fallback: 'Cmd+Shift+T', command: 'toggleTaskList' },
  { setting: 'insertMdx', fallback: 'Cmd+Shift+M', command: 'insertMdx' },
  { setting: 'insertTable', fallback: 'Option+Cmd+T', command: 'insertTable' },
];

function matchInlineFormatShortcut(event) {
  return INLINE_FORMAT_SHORTCUTS.find(item =>
    matchesShortcut(event, getSetting(`shortcuts.${item.setting}`, item.fallback))) || null;
}

function matchBlockCommandShortcut(event) {
  const hit = BLOCK_COMMAND_SHORTCUTS.find(item =>
    matchesShortcut(event, getSetting(`shortcuts.${item.setting}`, item.fallback)));
  if (hit) return { command: hit.command, args: {} };
  for (let level = 1; level <= 6; level += 1) {
    if (matchesShortcut(event, getSetting(`shortcuts.h${level}`, `Option+Cmd+${level}`))) {
      return { command: 'setHeading', args: { level } };
    }
  }
  if (matchesShortcut(event, getSetting('shortcuts.paragraph', 'Option+Cmd+0'))) {
    return { command: 'setHeading', args: { level: 0 } };
  }
  const isCommand = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (isCommand && event.shiftKey && key === 'd') return { command: 'duplicateBlock', args: {} };
  if (event.altKey && event.key === 'ArrowUp') return { command: 'moveBlockUp', args: {} };
  if (event.altKey && event.key === 'ArrowDown') return { command: 'moveBlockDown', args: {} };
  return null;
}

function onRenderedBlockKeydown(event) {
  if (matchesShortcut(event, getSetting('shortcuts.sourcePeek', 'F5'))) {
    event.preventDefault();
    openSourcePeek();
    return;
  }
  const isCommand = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (matchesShortcut(event, getSetting('shortcuts.toggleSource', 'Cmd+/'))) {
    event.preventDefault();
    toggleSourceMode();
    return;
  }
  if (matchesShortcut(event, getSetting('shortcuts.undo', 'Cmd+Z'))) {
    event.preventDefault();
    undoEditor();
    return;
  }
  if (matchesShortcut(event, getSetting('shortcuts.redo', 'Cmd+Shift+Z'))
    || (isCommand && key === 'y' && !event.altKey)) {
    event.preventDefault();
    redoEditor();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void splitRenderedBlock(event.target.closest('.block'));
    return;
  }
  // 行内格式与块级命令：走模型命令注册表，和源码块/命令面板同一套语义，
  // 不再用 execCommand 直接改 DOM（标题里 execCommand('bold') 会把字变回常规体，选中文字也拿不到标记）。
  const inlineFormat = matchInlineFormatShortcut(event);
  if (inlineFormat) {
    event.preventDefault();
    const pendingCommand = RENDERED_PENDING_FORMAT[inlineFormat.command];
    if (pendingCommand && window.getSelection()?.isCollapsed) {
      document.execCommand(pendingCommand);
      void syncRenderedBlock(event.target.closest('.block'));
      return;
    }
    executeRenderedEditorCommand(inlineFormat.command);
    return;
  }
  const blockCommand = matchBlockCommandShortcut(event);
  if (blockCommand) {
    event.preventDefault();
    executeRenderedEditorCommand(blockCommand.command, blockCommand.args);
    return;
  }
  if (event.key === 'Tab') {
    const tabBlock = event.target.closest('.block');
    const tabModelBlock = tabBlock && state.editorSession?.document.getBlock(tabBlock.dataset.blockId);
    if (tabModelBlock?.type === 'list') {
      event.preventDefault();
      executeRenderedEditorCommand(event.shiftKey ? 'outdentList' : 'indentList', {
        size: Number(getSetting('editor.indentSize', 2)) || 2,
      });
      return;
    }
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
        // 光标回到上一个块的末尾；被删掉的正是刚才的活动块，可编辑焦点也要一并交还。
        const previousBlock = result.document.blocks
          .filter(item => !item.attrs?.separator)[index - 1];
        if (previousBlock) {
          setModelSelection(createSelection(
            createPosition(previousBlock.id, previousBlock.raw.length),
            createPosition(previousBlock.id, previousBlock.raw.length),
          ));
        }
        syncIncrementalBlocks(result.changedBlockIds);
        focusBlockForSelection();
        updateWordCount();
        scheduleAutoSave();
      }
    }
  }
}

// 可视区里不显示的 Markdown 前缀（#、>、- 等）：DOM 文本偏移 + 前缀长度 = 模型 raw 偏移。
function blockMarkdownPrefix(modelBlock) {
  if (!modelBlock) return 0;
  const raw = modelBlock.raw || '';
  switch (modelBlock.type) {
    case 'heading':
      return (raw.match(/^#{1,6}\s+/) || [''])[0].length;
    case 'quote':
      return (raw.match(/^>\s+/) || [''])[0].length;
    case 'list': {
      // 任务列表（`- [ ] abc`）渲染后 DOM 文本是 " abc"（勾选框自身不产生文本），
      // 前缀要算上 `[ ]` 这一段，否则光标偏移会落到标记里。
      const task = raw.match(/^(?:[-*+]|\d+[.)])\s+\[[ xX]\]/);
      if (task) return task[0].length;
      return (raw.match(/^(?:[-*+]|\d+\.)\s+/) || [''])[0].length;
    }
    default:
      return 0;
  }
}

// 模型改动后统一登记光标：state.selection 供 UI 恢复，session.setSelection 让撤销/重做回到同一位置。
function setModelSelection(selection) {
  state.selection = selection;
  if (state.editorSession) state.editorSession.setSelection(selection);
  return selection;
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
  setModelSelection(createSelection(
    createPosition(blockId, inlinePosition.offset, inlinePosition.path),
    createPosition(blockId, inlinePosition.offset, inlinePosition.path),
  ));
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
  // 原生「编辑」菜单的撤销/重做会直接改写 DOM；拦下来交回编辑器自身的模型级撤销/重做，避免 DOM 与模型分叉。
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    e.preventDefault();
    const action = e.inputType === 'historyUndo' ? 'undo' : 'redo';
    applyHistoryResult(action === 'undo' ? state.editorSession?.undo() : state.editorSession?.redo(), action);
    state.suppressNextInput = true;
    return;
  }
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
      setModelSelection(createSelection(
        createPosition(right.id, 0),
        createPosition(right.id, 0),
      ));
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
      setModelSelection(createSelection(
        createPosition(previous.id, previous.raw.length),
        createPosition(previous.id, previous.raw.length),
      ));
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
  const parsed = parseMarkdownBlocks(raw)[0] || { type: 'paragraph', raw };
  const blockType = { ...parsed, raw };
  block.className = getBlockClassName(blockType, true);
  block.dataset.blockType = blockType.type;
  const newHtml = raw ? markdownRenderer.render(raw) : '<p><br></p>';
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
  updateTitleDirty();
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
  const documentPath = state.currentDoc?.path;
  const alt = String(file.name || 'image').replace(/[\[\]]/g, '');

  if (documentPath && typeof WriteImageAsset === 'function') {
    try {
      const relativePath = await WriteImageAsset(documentPath, imageDir, file.name || 'image.png', encoded);
      return `![${alt}](${relativePath})`;
    } catch (error) {
      console.error('保存图片资源失败，回退为内嵌图片:', error);
    }
  }

  const mime = file.type || 'image/png';
  return `![${alt}](data:${mime};base64,${encoded})`;
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
  if (matchesShortcut(e, getSetting('shortcuts.sourcePeek', 'F5'))) {
    e.preventDefault();
    openSourcePeek();
    return;
  }
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

  const inlineFormat = matchInlineFormatShortcut(e);
  if (inlineFormat) {
    e.preventDefault();
    executeEditorCommand(inlineFormat.command);
    return;
  }
  const blockCommand = matchBlockCommandShortcut(e);
  if (blockCommand) {
    e.preventDefault();
    executeEditorCommand(blockCommand.command, blockCommand.args);
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
        setModelSelection(createSelection(
          createPosition(rightBlock.id, 0),
          createPosition(rightBlock.id, 0),
        ));
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
            setModelSelection(createSelection(
              createPosition(previous.id, previous.raw.length),
              createPosition(previous.id, previous.raw.length),
            ));
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
      void activateBlock(idx - 1);
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
      void activateBlock(idx + 1);
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
    void activateBlock(blocks.length - 1);
  }
}

// ============================================================
// 首页（启动画面）
// ============================================================
async function openDocumentByPath(path) {
  const content = await ReadDocument(path);
  const name = path.split('/').pop().replace(/\\/g, '/').split('/').pop();
  const dir = path.substring(0, path.lastIndexOf('/')) || '/';

  state.docDir = dir;
  state.currentDoc = { name, path, size: content.length, modTime: '' };
  state.currentContent = content;
  state.persistedContent = content;
  state.view = 'editor';
  state.isEditor = true;
  // 通过单个文件进入（打开文件 / 最近文件）时默认收起侧栏。
  state.sidebarCollapsed = true;
  state.expandedDirs.clear();
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
      <section class="app-panel home-surface" id="home-surface">
        <div class="home-center">
          <header class="home-hero">
            <img class="home-logo" src="${getLogoUrl(getSetting('appearance.logo', DEFAULT_LOGO_ID))}" alt="">
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
        <div class="home-drop-overlay" id="home-drop-overlay" aria-hidden="true">
          <div class="home-drop-indicator">
            <svg data-lucide="file-up" width="28" height="28" stroke="currentColor" fill="none" stroke-width="1.6"></svg>
            <strong>${t('main.homeDropTitle')}</strong>
            <span>${t('main.homeDropHint')}</span>
          </div>
        </div>
      </section>
    </div>
  `;

  lucideIcons();
  hookHomeDropEvents();

  qs('#home-action-new-doc')?.addEventListener('click', () => {
    state.currentDoc = { id: null, name: `${t('main.untitled')}.md` };
    state.currentContent = '';
    state.persistedContent = '';
    state.isDirty = false;
    state.view = 'editor';
    // 首页新建文档同样按「单个文档」处理：进编辑器时左侧面板保持收起。
    state.sidebarCollapsed = true;
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
      // 打开的是工作区，侧栏保持展开。
      state.sidebarCollapsed = false;
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
  state.persistedContent = '';
  state.selection = null;
  state.selectionIndex = null;
  compositionController.cancel();
  state.editorSession = null;
  resetParseResult();

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
  state.selection = null;
  state.selectionIndex = null;
  compositionController.cancel();
  state.editorSession = null;
  resetParseResult();

  if (doc.path) {
    try {
      state.currentContent = await ReadDocument(doc.path);
      state.persistedContent = state.currentContent;
    } catch (e) {
      state.currentContent = '';
      state.persistedContent = '';
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
  hideHomeDropIndicator();
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
    // 拖入的是单个文件，默认收起侧栏。
    state.sidebarCollapsed = true;
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

async function openBrowserDroppedFiles(files) {
  hideHomeDropIndicator();
  const markdownFile = [...(files || [])].find(file => /\.(md|markdown)$/i.test(file.name || ''));
  if (!markdownFile) {
    if (files?.length) showAppToast(t('main.dropUnsupported'), { error: true });
    return;
  }
  try {
    await saveCurrentDoc();
    const document = await storage.acceptBrowserDroppedDocument?.(markdownFile);
    if (!document) throw new Error('Browser file drop is unavailable');
    const dir = document.path.substring(0, document.path.lastIndexOf('/')) || '/';
    state.docDir = dir;
    // 拖入的是单个文件，默认收起侧栏。
    state.sidebarCollapsed = true;
    state.expandedDirs.clear();
    state.docs = [{ ...document, isDir: false }];
    state.docTree = [{ ...document, isDir: false }];
    await openEditor(document);
    showAppToast(t('main.dropOpened', { name: document.name }));
  } catch (error) {
    showAppToast(t('main.dropFailed', { message: error?.message || error }), { error: true });
  }
}

let homeDropDepth = 0;

function setHomeDropIndicator(active) {
  qs('#home-surface')?.classList.toggle('is-dragging-file', active);
  qs('#home-drop-overlay')?.classList.toggle('visible', active);
  qs('#home-drop-overlay')?.setAttribute('aria-hidden', String(!active));
}

function hideHomeDropIndicator() {
  homeDropDepth = 0;
  setHomeDropIndicator(false);
}

function hookHomeDropEvents() {
  const zone = qs('#home-surface');
  if (!zone) return;
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');

  zone.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    homeDropDepth += 1;
    setHomeDropIndicator(true);
  });
  zone.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setHomeDropIndicator(true);
  });
  zone.addEventListener('dragleave', event => {
    if (!hasFiles(event)) return;
    homeDropDepth = Math.max(0, homeDropDepth - 1);
    if (homeDropDepth === 0) setHomeDropIndicator(false);
  });
  zone.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    hideHomeDropIndicator();
    if (isBrowserMode()) {
      void openBrowserDroppedFiles(event.dataTransfer?.files);
    }
  });
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

// 底部状态栏的字数按钮 + 点击展开的统计面板
function wordStatsHtml(stats) {
  const row = (id, key, labelKey) => `
                <div class="word-stats-row">
                  <dt data-i18n="${labelKey}">${t(labelKey)}</dt>
                  <dd id="${id}">${formatStatNumber(stats?.[key])}</dd>
                </div>`;
  return `
          <div class="word-stats-wrapper">
            <button class="word-stats-button" id="btn-word-stats" type="button" aria-haspopup="true" aria-expanded="false" title="${t('main.stats.title')}" data-i18n-title="main.stats.title">
              <span id="word-stats-label">${t('main.wordCount', { count: formatStatNumber(stats?.words) })}</span>
            </button>
            <div class="word-stats-panel hidden" id="word-stats-panel" role="dialog" aria-label="${t('main.stats.title')}">
              <div class="word-stats-heading" data-i18n="main.stats.title">${t('main.stats.title')}</div>
              <dl class="word-stats-list">
                ${row('stat-words', 'words', 'main.stats.words')}
                ${row('stat-characters', 'characters', 'main.stats.characters')}
                ${row('stat-characters-no-spaces', 'charactersNoSpaces', 'main.stats.charactersNoSpaces')}
                ${row('stat-characters-no-punctuation', 'charactersNoPunctuation', 'main.stats.charactersNoPunctuation')}
                ${row('stat-lines', 'lines', 'main.stats.lines')}
              </dl>
            </div>
          </div>`;
}

// 根据路径在文件树中查找文档节点
function renderEditor() {
  sourcePeek.close();
  closeFindReplace({ restoreFocus: false });
  disposeWorkspacePanel?.();
  disposeWorkspacePanel = null;
  workspacePanel = 'documents';
  currentSidebarView = 'filetree';
  const name = state.currentDoc ? fileNameWithoutExt(state.currentDoc.name) : t('main.untitled');
  const stats = computeStats(state.currentContent || '');
  const hasDoc = !!state.currentDoc;

  // 底部状态栏左下角的侧栏开关（有文档 / 无文档 共用，位置固定）
  const sidebarToggleHtml = `
          <button class="sidebar-icon${state.sidebarCollapsed ? '' : ' is-active'}" id="btn-toggle-panel" type="button" title="${t('main.toggleSidebar')}" data-i18n-title="main.toggleSidebar" aria-pressed="${state.sidebarCollapsed ? 'false' : 'true'}">
            <svg data-lucide="panel-left" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          </button>`;

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
          ${sidebarToggleHtml}
        </div>
        <div class="statusbar-right">
          ${wordStatsHtml(stats)}
          <span class="statusbar-divider">|</span>
          <button class="sidebar-icon" id="mode-indicator" type="button" title="${state.sourceMode ? t('main.mode.source') : t('main.mode.preview')}" data-i18n-title="${state.sourceMode ? 'main.mode.source' : 'main.mode.preview'}">
            <svg data-lucide="${state.sourceMode ? 'code' : 'eye'}" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
          </button>
          <div class="editor-titlebar-actions">
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
          ${brandHeroHtml(getSetting('appearance.logo', DEFAULT_LOGO_ID))}
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
      </div>

      <footer class="app-panel editor-statusbar statusbar">
        <div class="statusbar-left">
          ${sidebarToggleHtml}
        </div>
      </footer>`;
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
          <div class="workspace-nav workspace-nav-switch">
            <div class="workspace-view-switch" role="tablist" aria-label="${t('main.files')} / ${t('main.nav.outline')}">
              <button class="workspace-view-option is-active" type="button" role="tab" data-sidebar-view="files" aria-selected="true" aria-controls="file-tree-nav" title="${t('main.nav.files')}">
                <svg data-lucide="folder" width="15" height="15"></svg>
                <span data-i18n="main.nav.files">${t('main.nav.files')}</span>
              </button>
              <button class="workspace-view-option" type="button" role="tab" data-sidebar-view="outline" aria-selected="false" aria-controls="file-tree-outline" title="${t('main.nav.outline')}">
                <svg data-lucide="list" width="15" height="15"></svg>
                <span data-i18n="main.nav.outline">${t('main.nav.outline')}</span>
              </button>
            </div>
          </div>
          <div class="sidebar-document-context" id="sidebar-document-context">
            <div class="sidebar-context-header" id="sidebar-context-header">
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
          </nav>
        </aside>

        <!-- 文件树与正文区之间的拖拽把手 -->
        <div class="panel-resizer editor-sidebar-resizer" id="sidebar-resizer" title="${t('main.dragSidebar')}"></div>

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
    state.persistedContent = '';
    state.isDirty = false;
    // 新建文档同样按「单个文档」处理：进入编辑时左侧面板保持收起。
    state.sidebarCollapsed = true;
    renderEditor();
  });

  const btnFile = qs('#wp-open-file');
  if (btnFile) {
    btnFile.addEventListener('click', async () => {
      try {
        const path = await OpenDocumentFile();
        if (!path) return;
        const content = await ReadDocument(path);
        const name = path.split('/').pop();
        const dir = path.substring(0, path.lastIndexOf('/')) || '/';
        state.docDir = dir;
        state.currentDoc = { name, path, size: content.length, modTime: '' };
        state.currentContent = content;
        state.persistedContent = content;
        try { AddRecentFile(path, name); } catch (e) {}
        // 通过单个文件进入时默认收起侧栏。
        state.sidebarCollapsed = true;
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
          // 打开的是工作区，侧栏保持展开。
          state.sidebarCollapsed = false;
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
      const content = await ReadDocument(path);
      const name = path.split('/').pop();
      const dir = path.substring(0, path.lastIndexOf('/')) || '/';
      state.docDir = dir;
      state.currentDoc = { name, path, size: content.length, modTime: '' };
      state.currentContent = content;
      state.persistedContent = content;
      try { AddRecentFile(path, name); } catch (e) {}
      // 通过单个文件进入时默认收起侧栏。
      state.sidebarCollapsed = true;
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

// 侧栏内容（文件树 / 大纲）与主区域页面（文档 / 设置）分开记录：打开设置时侧栏继续
// 展示当前的文件树或大纲，不再隐藏、也不再重置回文件树。
let currentSidebarView = 'filetree';
let workspacePanel = 'documents';
let disposeWorkspacePanel = null;
let editorDocumentEventsBound = false;

function toggleSidebarPanel() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  const container = qs('#file-tree-container');
  if (state.sidebarCollapsed) {
    container?.classList.add('collapsed');
    applySidebarWidth(0);
  } else {
    container?.classList.remove('collapsed');
    if (state.sidebarWidth < SIDEBAR_MIN_WIDTH) state.sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
    applySidebarWidth(state.sidebarWidth);
  }
  syncSidebarToggleState();
}

// 点击分段控件切换侧栏内容（文件树 / 大纲），不影响主区域当前页面（如设置）。
function setSidebarView(view) {
  currentSidebarView = view === 'outline' ? 'outline' : 'filetree';
  updateSidebarView();
}

function updateSidebarView() {
  const tree = qs('#file-tree-nav');
  const outline = qs('#file-tree-outline');
  const contextHeader = qs('#sidebar-context-header');
  const searchBtn = qs('#sidebar-search-btn');
  const newFileBtn = qs('#sidebar-new-file-btn');

  if (currentSidebarView === 'filetree') {
    tree?.classList.remove('hidden');
    outline?.classList.add('hidden');
    searchBtn?.classList.remove('icon-placeholder');
    newFileBtn?.classList.remove('hidden');
    contextHeader?.classList.remove('hidden');
  } else {
    tree?.classList.add('hidden');
    outline?.classList.remove('hidden');
    searchBtn?.classList.add('icon-placeholder');
    newFileBtn?.classList.add('hidden');
    // 大纲视图下两个图标都不可用，整行收起，标题行不再留空
    contextHeader?.classList.add('hidden');
    generateOutline();
  }
  // 分段控件跟随当前侧栏内容
  const activeView = currentSidebarView === 'outline' ? 'outline' : 'files';
  document.querySelectorAll('[data-sidebar-view]').forEach(item => {
    const isActive = item.dataset.sidebarView === activeView;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Hide search when switching views
  qs('#sidebar-search')?.classList.add('hidden');
  const searchInput = qs('#sidebar-search-input');
  if (searchInput) searchInput.value = '';
}

function setWorkspacePanel(panel) {
  const documentView = qs('#editor-document-view');
  const workspaceHost = qs('#editor-workspace-host');
  if (!documentView || !workspaceHost) return;

  const isSettings = panel === 'settings';

  if (!isSettings) {
    disposeWorkspacePanel?.();
    disposeWorkspacePanel = null;
  }
  workspacePanel = isSettings ? 'settings' : 'documents';
  document.querySelectorAll('[data-workspace-nav]').forEach(item => {
    item.classList.toggle('active', item.dataset.workspaceNav === workspacePanel);
  });

  // 侧栏（文件树 / 大纲）在主区域切到设置时保持不动：既不清空内容，也不重置选择。
  qs('#sidebar-document-context')?.classList.remove('hidden');
  workspaceHost.innerHTML = '';

  if (!isSettings) {
    documentView.classList.remove('hidden');
    workspaceHost.classList.add('hidden');
    updateSidebarView();
    return;
  }

  documentView.classList.add('hidden');
  workspaceHost.classList.remove('hidden');
  void openSettingsModal({
    container: workspaceHost,
    onClose: () => {
      // 关闭前记下侧栏当前展示的内容，重建 DOM 之后再恢复，避免被打回文件树。
      const sidebarView = currentSidebarView;
      setWorkspacePanel('documents');
      renderEditor();
      currentSidebarView = sidebarView;
      setSidebarView(sidebarView);
    },
  }).then(handle => {
    if (workspacePanel === 'settings') {
      disposeWorkspacePanel = () => handle?.dispose?.();
    }
  });
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
  if (Number.isInteger(index) && index !== activeBlockIndex) void activateBlock(index);
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
    // 排版空白节点不参与计数，否则模型偏移会被映射到 `<ul>` 与 `<li>` 之间的换行上，
    // 光标落到列表结构外面，接着敲的字符就插到了行首。
    if (isLayoutWhitespaceNode(node)) {
      node = walker.nextNode();
      continue;
    }
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
  setModelSelection(createSelection(
    createPosition(block.id, caret),
    createPosition(block.id, caret),
  ));
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

// 侧栏开关按钮的选中态：侧栏展开时高亮
function syncSidebarToggleState() {
  const btn = qs('#btn-toggle-panel');
  if (!btn) return;
  const expanded = !state.sidebarCollapsed;
  btn.classList.toggle('is-active', expanded);
  btn.setAttribute('aria-pressed', String(expanded));
}

function hookSidebarResize() {
  const container = qs('#file-tree-container');
  const resizer = qs('#sidebar-resizer');

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
      syncSidebarToggleState();
    },
    onCollapse: () => {
      state.sidebarCollapsed = true;
      // 先恢复过渡，折叠动画才能生效
      container.classList.remove('resizing');
      container.classList.add('collapsed');
      applySidebarWidth(0);
      syncSidebarToggleState();
    },
    // 窄窗口下侧栏改为浮层，此时不响应拖动
    isBlocked: () => getComputedStyle(container).position === 'absolute',
    onCommit: () => saveAppState(),
  });
}

function hookEditorEvents() {
  // 左侧导航切换（应用导航：设置）
  document.querySelectorAll('[data-workspace-nav]').forEach(item => {
    item.addEventListener('click', () => setWorkspacePanel(item.dataset.workspaceNav));
  });

  // 侧栏内容切换（文件树 / 大纲合并后的分段控件）
  document.querySelectorAll('[data-sidebar-view]').forEach(item => {
    item.addEventListener('click', () => setSidebarView(item.dataset.sidebarView));
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

  // 状态栏字数统计（点击按钮展开/收起统计面板）
  const statsTrigger = qs('#btn-word-stats');
  const statsPanel = qs('#word-stats-panel');
  statsTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const shouldOpen = statsPanel?.classList.contains('hidden');
    if (shouldOpen) updateWordCount();
    statsPanel?.classList.toggle('hidden', !shouldOpen);
    statsTrigger.classList.toggle('is-active', Boolean(shouldOpen));
    statsTrigger.setAttribute('aria-expanded', String(Boolean(shouldOpen)));
  });

  // 点击其他区域关闭导出下拉
  if (!editorDocumentEventsBound) {
    editorDocumentEventsBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.export-wrapper')) {
        document.querySelectorAll('.export-dropdown').forEach(menu => menu.classList.add('hidden'));
      }
      if (!e.target.closest('.word-stats-wrapper')) {
        qs('#word-stats-panel')?.classList.add('hidden');
        const trigger = qs('#btn-word-stats');
        trigger?.classList.remove('is-active');
        trigger?.setAttribute('aria-expanded', 'false');
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
    void activateBlock(index);
    qs('#block-editor')?.querySelectorAll('.block')[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // 文件树导航
  hookFileTreeEvents();

  // 侧边栏：宽度拖拽 + 自动折叠 + 展开
  hookSidebarResize();

  // 文档操作
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
      modeIndicator.innerHTML = `<svg data-lucide="code" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.5"></svg>`;
      modeIndicator.title = t('main.mode.source');
      modeIndicator.dataset.i18nTitle = 'main.mode.source';
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
      modeIndicator.innerHTML = `<svg data-lucide="eye" width="15" height="15" stroke="currentColor" fill="none" stroke-width="1.5"></svg>`;
      modeIndicator.title = t('main.mode.preview');
      modeIndicator.dataset.i18nTitle = 'main.mode.preview';
      lucideIcons();
    }
    updateWordCount();
  }
  refreshFindReplaceMatches();
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
  const stats = computeStats(md);
  const label = qs('#word-stats-label');
  if (label) label.textContent = t('main.wordCount', { count: formatStatNumber(stats.words) });
  const setStatValue = (selector, value) => {
    const el = qs(selector);
    if (el) el.textContent = formatStatNumber(value);
  };
  setStatValue('#stat-words', stats.words);
  setStatValue('#stat-characters', stats.characters);
  setStatValue('#stat-characters-no-spaces', stats.charactersNoSpaces);
  setStatValue('#stat-characters-no-punctuation', stats.charactersNoPunctuation);
  setStatValue('#stat-lines', stats.lines);
}

function syncIncrementalBlocks(changedBlockIds) {
  const session = state.editorSession;
  if (!session?.document) return;
  const root = qs('#block-editor');
  if (!root) return;
  const visibleBlocks = session.document.blocks.filter(block => !block.attrs?.separator);
  const changed = new Set(changedBlockIds);
  const expectedIds = new Set();
  let cursor = root.firstChild;

  for (const block of visibleBlocks) {
    expectedIds.add(block.id);
    let element = root.querySelector(`[data-block-id="${block.id}"]`);
    if (!element) {
      element = createBlockElement(block);
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
  // DOM 顺序可能变过（插入/重排/删除）：重新编号，否则点击/激活会按旧索引找错块。
  root.querySelectorAll('.block').forEach((element, index) => {
    element.dataset.blockIndex = String(index);
  });
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
  // 撤销/重做可能把结构改回去（例如把两块合并成一块）：原来的 .block.active 已经不在了，
  // 不交还可编辑焦点的话整屏都不可编辑（打字/回车都没反应）。
  focusBlockForSelection(result.selection);
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

// 在可视区执行编辑器命令：把 DOM 选区换算成模型 raw 偏移（补上 #、>、- 等前缀）再交给命令注册表。
// 可视区文本不含这些前缀，直接用 DOM 偏移会让命令在标题/引用/列表块里插错位置。
function executeRenderedEditorCommand(name, args = {}) {
  const session = state.editorSession;
  const block = document.activeElement?.closest?.('.block') || qs('#block-editor .block.active');
  const rendered = block?.querySelector('.block-rendered');
  const blockId = block?.dataset.blockId;
  const modelBlock = blockId ? session?.document.getBlock(blockId) : null;
  if (!session || !rendered || !modelBlock) return null;
  const prefix = blockMarkdownPrefix(modelBlock);
  const offsets = renderedSelectionOffsets(rendered) || { start: 0, end: 0 };
  const toRaw = value => Math.max(0, Math.min(modelBlock.raw.length, value + prefix));
  session.selection = createSelection(
    createPosition(blockId, toRaw(offsets.start)),
    createPosition(blockId, toRaw(offsets.end)),
  );
  return executeEditorCommand(name, args, { capture: false });
}

function executeEditorCommand(name, args = {}, { capture = true } = {}) {
  if (!state.editorSession) return null;
  // 可视区已经自己把 DOM 选区换算成模型偏移时，不要再让 captureBlockSelection 覆盖它。
  if (capture) captureBlockSelection();
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
      // DOM 文本里没有 Markdown 前缀（#、>、- ），模型偏移要补回去；同时保留整个选区而不只是光标，
      // 否则「选中一段文字再按 Cmd+B」只会作用在光标处。
      const prefix = blockMarkdownPrefix(state.editorSession?.document?.getBlock(blockId));
      const clamp = value => Math.max(0, value + prefix);
      const start = clamp(getEditableTextOffset(editable, domSelection.anchorNode, domSelection.anchorOffset));
      const end = clamp(getEditableTextOffset(editable, domSelection.focusNode, domSelection.focusOffset));
      state.selection = createSelection(
        createPosition(blockId, Math.min(start, end)),
        createPosition(blockId, Math.max(start, end)),
      );
      if (state.editorSession) state.editorSession.selection = state.selection;
      state.selectionIndex = Number(block.dataset.blockIndex);
      root.dataset.selectionBlock = blockId;
      root.dataset.selectionOffset = String(start);
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

// 把选区所在的块提升为「唯一可编辑块」。
// 撤销/重做、合并块之后，原来的 .block.active 元素可能已经被移除，结果是整屏没有任何可编辑块：
// 打字、回车都没有反应，必须先点一下块才能继续。这里按选区把可编辑态交还回去。
function activateBlockForSelection(selection = state.selection) {
  const blockId = selection?.anchor?.blockId;
  const root = qs('#block-editor');
  if (!root || !blockId) return false;
  const target = root.querySelector(`.block[data-block-id="${blockId}"]`);
  if (!target) return false;
  for (const element of root.querySelectorAll('.block')) {
    const isTarget = element === target;
    if (!isTarget && element.classList.contains('active')) element.classList.remove('active');
    const rendered = element.querySelector('.block-rendered');
    if (rendered && !isTarget && rendered.contentEditable === 'true') rendered.contentEditable = 'false';
  }
  target.classList.add('active');
  const rendered = target.querySelector('.block-rendered');
  if (rendered) rendered.contentEditable = 'true';
  activeBlockIndex = Number(target.dataset.blockIndex);
  state.selectionIndex = activeBlockIndex;
  return true;
}

// 结构变化后的统一收尾：先恢复可编辑块，再让 restoreBlockSelection 把光标放进去。
function focusBlockForSelection(selection = state.selection) {
  if (!activateBlockForSelection(selection)) return;
  restoreBlockSelection();
}

function restoreBlockSelection() {
  if (state.sourceMode || !state.selection) return;
  const root = qs('#block-editor');
  if (!root) return;
  requestAnimationFrame(() => {
    const activeRendered = root.querySelector('.block.active .block-rendered[contenteditable="true"]');
    if (activeRendered && state.selection?.anchor?.blockId === activeRendered.closest('.block')?.dataset.blockId) {
      activeRendered.focus();
      // state.selection 存的是模型 raw 偏移，可视区要去掉 Markdown 前缀才是 DOM 偏移。
      const prefix = blockMarkdownPrefix(state.editorSession?.document?.getBlock(state.selection.anchor.blockId));
      const toDom = value => Math.max(0, value - prefix);
      setContentEditableSelection(activeRendered, toDom(state.selection.anchor.offset), toDom(state.selection.head.offset));
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
  updateTitleDirty();
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
      state.persistedContent = md;
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
        await safety.clearRecoverySnapshot();
        try { AddRecentFile(doc.path, doc.name); } catch (e) {}
        const dir = doc.path.substring(0, doc.path.lastIndexOf('/'));
        state.docDir = dir;
        // 保存 / 另存为后保持侧栏当前状态，不再自动展开。
        state.expandedDirs.clear();
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
    await WriteDocument(docSnapshot.path, md);
    if (stillSameDoc()) {
      state.currentContent = md;
      state.persistedContent = md;
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
  const wasDirty = state.isDirty;
  syncDirtyState(state);
  if (wasDirty && !state.isDirty) {
    void safety.clearRecoverySnapshot();
  }
  void SetPendingChanges(state.isDirty ? 1 : 0, state.currentDoc?.name || `${t('main.untitled')}.md`);
  const titleEl = qs('#editor-title');
  if (!titleEl) return;
  const name = state.currentDoc ? fileNameWithoutExt(state.currentDoc.name) : t('main.untitled');
  titleEl.textContent = `${name}.md${state.isDirty ? ' *' : ''}`;
}

async function restoreDocumentSnapshot(snapshot) {
  state.currentDoc = snapshot.currentDoc || state.currentDoc;
  state.currentContent = snapshot.content || '';
  state.persistedContent = snapshot.persistedContent ?? state.persistedContent ?? '';
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
    await safety.clearRecoverySnapshot();
    state.currentDoc = null;
    state.currentContent = '';
    state.persistedContent = '';
    state.isDirty = false;
    await initLibrary();
  } catch (error) {
    alert(`删除失败：${error.message || error}`);
  }
}

async function handleTreeDocumentDeleted(path) {
  if (state.currentDoc?.path === path) {
    await safety.clearRecoverySnapshot();
    state.currentDoc = null;
    state.currentContent = '';
    state.persistedContent = '';
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
      // 没有未保存的修改：直接关闭，不再弹任何提示。
      if (!state.isDirty) {
        await ConfirmClose();
        return;
      }
      const choice = await safety.confirmUnsavedChanges(
        state.currentDoc?.name || `${t('main.untitled')}.md`,
      );
      if (choice === 'save') {
        await saveCurrentDoc(false);
        if (!state.isDirty) {
          await ConfirmClose();
        } else {
          showAppToast('保存未完成，已取消关闭。', { error: true });
        }
        return;
      }
      if (choice === 'discard') {
        // 主动丢弃后清掉恢复快照，避免下次启动又被恢复回来。
        await safety.clearRecoverySnapshot();
        await ConfirmClose();
        return;
      }
      // 取消：保持窗口打开，下次关闭仍会再次询问。
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
      setSidebarView(currentSidebarView === 'outline' ? 'files' : 'outline');
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
  onContentRestored: restoreDocumentSnapshot,
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
    writeDocument: NativeWriteDocument,
    writeImageAsset: NativeWriteImageAsset,
  },
  documentStoreService: {
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
