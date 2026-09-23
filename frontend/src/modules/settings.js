import { createPluginStatusPanel } from '../ui/settings/plugins-panel.js';
import { applyLanguage, getLanguage, getLanguageOptions, resolveLanguage, t } from '../i18n/index.js';
import {
  applyThemeSelection,
  createThemeRegistry,
  migrateLegacyTheme,
  parseUserTheme,
  resolveThemeSelection,
  THEME_TOKEN_MAP,
  themeBaseDisplayName,
  themeDescription,
  themeDisplayName,
} from '../themes/index.js';

const FONT_FAMILIES = [
  { labelKey: 'font.lxgw', value: "'LXGW WenKai', 'PingFang SC', 'Songti SC', serif" },
  { labelKey: 'font.system', value: "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif" },
  { labelKey: 'font.serif', value: "'Georgia', 'Songti SC', serif" },
  { labelKey: 'font.mono', value: "'SF Mono', 'Menlo', 'Consolas', monospace" },
];

const SHORTCUT_DEFINITIONS = {
  save: { label: '保存文档', default: 'Cmd+S', description: '保存当前 Markdown 文件' },
  find: { label: '文档内查找', default: 'Cmd+F', description: '在当前文档中查找文本' },
  replace: { label: '文档内替换', default: 'Cmd+H', description: '在当前文档中替换文本' },
  bold: { label: '加粗 (Bold)', default: 'Cmd+B', description: '将选中文本包裹为粗体' },
  italic: { label: '斜体 (Italic)', default: 'Cmd+I', description: '将选中文本包裹为斜体' },
  strike: { label: '删除线 (Strikethrough)', default: 'Cmd+Shift+S', description: '为选中文本添加删除线' },
  inlineCode: { label: '行内代码 (Inline Code)', default: 'Cmd+E', description: '将选中文本包裹为行内代码' },
  highlight: { label: '文本高亮 (Highlight)', default: 'Cmd+Shift+H', description: '使用 Markdown 高亮标记选中文本' },
  link: { label: '插入 / 包裹链接', default: 'Cmd+K', description: '为选中文本添加 Markdown 链接' },
  codeBlock: { label: '插入代码块', default: 'Cmd+Shift+C', description: '插入 Markdown 代码块' },
  quote: { label: '切换引用块', default: 'Cmd+Shift+Q', description: '将当前块切换为引用块' },
  unorderedList: { label: '无序列表', default: 'Cmd+Shift+U', description: '切换无序列表' },
  orderedList: { label: '有序列表', default: 'Cmd+Shift+O', description: '切换有序列表' },
  taskList: { label: '待办任务列表', default: 'Cmd+Shift+T', description: '切换待办任务列表' },
  h1: { label: '一级标题 (H1)', default: 'Option+Cmd+1', description: '设为一级标题' },
  h2: { label: '二级标题 (H2)', default: 'Option+Cmd+2', description: '设为二级标题' },
  h3: { label: '三级标题 (H3)', default: 'Option+Cmd+3', description: '设为三级标题' },
  h4: { label: '四级标题 (H4)', default: 'Option+Cmd+4', description: '设为四级标题' },
  h5: { label: '五级标题 (H5)', default: 'Option+Cmd+5', description: '设为五级标题' },
  h6: { label: '六级标题 (H6)', default: 'Option+Cmd+6', description: '设为六级标题' },
  paragraph: { label: '正文段落', default: 'Option+Cmd+0', description: '移除标题并恢复正文段落' },
  toggleSource: { label: '切换源码模式', default: 'Cmd+/', description: '在预览和 Markdown 源码之间切换' },
  sourcePeek: { label: '块源码精修', default: 'F5', description: '编辑当前块的 Markdown 源码' },
  toggleSidebar: { label: '切换文件树 / 大纲', default: 'Cmd+Shift+B', description: '切换左侧文件树和大纲' },
  openSettings: { label: '打开设置', default: 'Cmd+,', description: '打开设置界面' },
  insertMdx: { label: '插入 MDX 组件', default: 'Cmd+Shift+M', description: '插入 MDX 组件模板' },
  insertTable: { label: '插入表格', default: 'Option+Cmd+T', description: '在当前块后插入 Markdown 表格' },
  undo: { label: '撤销', default: 'Cmd+Z', description: '撤销上一步编辑' },
  redo: { label: '重做', default: 'Cmd+Shift+Z', description: '恢复已撤销的编辑' },
};

const SHORTCUT_GROUPS = [
  {
    title: '查找与导航',
    description: '在文档、侧栏和设置之间导航。',
    keys: ['find', 'replace', 'toggleSidebar', 'openSettings'],
  },
  {
    title: '文本格式',
    description: '对选中文本应用 Markdown 格式。',
    keys: ['bold', 'italic', 'strike', 'inlineCode', 'highlight', 'link'],
  },
  {
    title: '块与列表',
    description: '调整当前块或插入新的 Markdown 结构。',
    keys: [
      'codeBlock',
      'quote',
      'unorderedList',
      'orderedList',
      'taskList',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'paragraph',
      'insertMdx',
      'insertTable',
    ],
  },
  {
    title: '编辑器操作',
    description: '保存、源码模式和编辑历史。',
    keys: ['save', 'toggleSource', 'sourcePeek', 'undo', 'redo'],
  },
];

const DEFAULT_SHORTCUTS = Object.fromEntries(
  Object.entries(SHORTCUT_DEFINITIONS).map(([key, definition]) => [key, definition.default]),
);

const DEFAULT_SETTINGS = {
  language: 'system',
  appearance: {
    themeMode: 'system',
    themeId: 'paper-light',
    lightThemeId: 'paper-light',
    darkThemeId: 'paper-dark',
    theme: 'system',
    uiFont: FONT_FAMILIES[1].value,
    editorFont: FONT_FAMILIES[0].value,
    codeFont: FONT_FAMILIES[3].value,
    fontSize: 18,
    lineHeight: 1.8,
    contentWidth: 70,
    density: 'comfortable',
    reducedMotion: false,
  },
  editor: {
    defaultMode: 'block',
    autosaveDelay: 2000,
    indentSize: 2,
    spellcheck: true,
    autoPair: true,
    pasteMode: 'auto',
    lineNumbers: false,
    typewriterMode: false,
    focusMode: false,
  },
  files: {
    imageDir: 'assets',
    imageWidth: 100,
    watcherInterval: 3000,
    recentLimit: 15,
    defaultExport: 'md',
  },
  recovery: {
    enabled: true,
    snapshotLimit: 50,
    versionLimit: 50,
    recycleRetentionDays: 30,
  },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  update: {
    channel: 'stable',
    autoCheck: true,
  },
};

const CATEGORIES = [
  { key: 'system', labelKey: 'settings.categories.system', descriptionKey: 'settings.categories.system.desc', icon: 'sliders-horizontal' },
  { key: 'shortcuts', labelKey: 'settings.categories.shortcuts', descriptionKey: 'settings.categories.shortcuts.desc', icon: 'keyboard' },
  { key: 'appearance', labelKey: 'settings.categories.appearance', descriptionKey: 'settings.categories.appearance.desc', icon: 'palette' },
  { key: 'plugins', labelKey: 'settings.categories.plugins', descriptionKey: 'settings.categories.plugins.desc', icon: 'puzzle' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(...sources) {
  const result = clone(DEFAULT_SETTINGS);
  for (const source of sources) {
    if (!source) continue;
    for (const [group, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[group] = { ...(result[group] || {}), ...value };
      } else {
        result[group] = value;
      }
    }
  }
  return result;
}

function getPath(object, path, fallback = undefined) {
  const value = path.split('.').reduce((current, key) => current?.[key], object);
  return value === undefined ? fallback : value;
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let current = object;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    current[key] = current[key] || {};
    current = current[key];
  }
  current[parts[parts.length - 1]] = value;
}

function optionHtml(options, selected) {
  return options.map(option => `
    <option value="${escapeAttribute(option.value)}" ${option.value === selected ? 'selected' : ''}>
      ${escapeAttribute(option.label)}
    </option>
  `).join('');
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function settingRow({ label, description, control, search = '' }) {
  return `
    <div class="settings-row" data-search="${escapeAttribute(`${label} ${description || ''} ${search}`.toLowerCase())}">
      <div class="settings-row-info">
        <span class="settings-row-label">${escapeAttribute(label)}</span>
        ${description ? `<span class="settings-row-desc">${escapeAttribute(description)}</span>` : ''}
      </div>
      <div class="settings-row-control">${control}</div>
    </div>
  `;
}

function sectionHtml(title, description, content) {
  return `
    <section class="settings-section">
      <div class="settings-section-head">
        <div class="settings-section-title">${escapeAttribute(title)}</div>
        ${description ? `<div class="settings-section-desc">${escapeAttribute(description)}</div>` : ''}
      </div>
      <div class="settings-section-body">${content}</div>
    </section>
  `;
}

function settingsPageHeader(kicker, title, description, action = '') {
  return `
    <header class="settings-page-intro">
      <div class="settings-page-copy">
        <span class="settings-page-kicker">${escapeAttribute(kicker)}</span>
        <h1>${escapeAttribute(title)}</h1>
        <p>${escapeAttribute(description)}</p>
      </div>
      ${action ? `<div class="settings-page-action">${action}</div>` : ''}
    </header>
  `;
}

function formatShortcut(event) {
  const parts = [];
  if (event.metaKey) parts.push('Cmd');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

function displayShortcut(shortcut) {
  return String(shortcut || '')
    .replace(/\bCmd\b/g, 'Command')
    .replace(/\bCtrl\b/g, 'Control')
    .replace(/\bOption\b/g, 'Option');
}

function matchesShortcut(event, shortcut) {
  if (!shortcut) return false;
  const eventKey = String(event.key || '').toLowerCase();
  const slashParts = String(shortcut)
    .split('/')
    .map(part => part.trim())
    .filter(Boolean);
  let combinations = slashParts;

  if (slashParts.length > 1) {
    const lastParts = slashParts[slashParts.length - 1].split('+').map(part => part.trim());
    const finalKey = lastParts.pop();
    const trailingModifiers = lastParts.slice(1);
    combinations = slashParts.map((part, index) => {
      const leadingParts = part.split('+').map(token => token.trim()).filter(Boolean);
      const modifiers = index === slashParts.length - 1
        ? leadingParts
        : [...leadingParts, ...trailingModifiers];
      return [...new Set([...modifiers, finalKey].filter(Boolean))].join('+');
    });
  }

  return combinations
    .some(combination => {
      const parts = combination.split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
      const key = parts.pop();
      if (!key) return false;

      const wantsMeta = parts.includes('cmd') || parts.includes('meta') || parts.includes('command');
      const wantsCtrl = parts.includes('ctrl') || parts.includes('control');
      const wantsAlt = parts.includes('alt') || parts.includes('option');
      const wantsShift = parts.includes('shift');
      const normalizedEventKey = eventKey === ' ' ? 'space' : eventKey;
      const normalizedShortcutKey = key === 'space' ? 'space' : key;

      return normalizedEventKey === normalizedShortcutKey &&
        Boolean(event.metaKey) === wantsMeta &&
        Boolean(event.ctrlKey) === wantsCtrl &&
        Boolean(event.altKey) === wantsAlt &&
        Boolean(event.shiftKey) === wantsShift;
    });
}

export function createSettingsModule({
  state,
  storage,
  appVersion,
  appRepo,
  checkForUpdate,
  openExternal,
  qs,
  getApp,
  lucideIcons,
  renderEditor,
}) {
  let currentSettings = clone(DEFAULT_SETTINGS);
  let saveTimer = null;
  let systemThemeQuery = null;
  let pluginRuntime = null;
  let themeRegistry = createThemeRegistry();
  let themeVariantTarget = 'light';

  function migrateAppearanceSettings(settings, stored) {
    const next = mergeSettings(settings);
    const storedAppearance = stored?.appearance || {};
    if (Number(storedAppearance.contentWidth) > 100) {
      next.appearance.contentWidth = DEFAULT_SETTINGS.appearance.contentWidth;
    }
    if (!storedAppearance.lightThemeId || !storedAppearance.darkThemeId) {
      Object.assign(next.appearance, migrateLegacyTheme(
        storedAppearance.theme || next.appearance.theme,
        storedAppearance.themeId || next.appearance.themeId,
      ));
    }
    return next;
  }

  async function loadThemeRegistry() {
    let userThemes = [];
    try {
      const files = typeof storage.listUserThemes === 'function'
        ? await storage.listUserThemes()
        : {};
      userThemes = Object.entries(files || {}).map(([id, content]) => {
        try {
          return JSON.parse(content);
        } catch (error) {
          return { id, schemaVersion: 999 };
        }
      });
    } catch (error) {
      userThemes = [];
    }
    themeRegistry = createThemeRegistry({ userThemes });
    return themeRegistry;
  }

  async function loadSettings() {
    let stored = null;
    try {
      const map = await storage.loadAppSettings();
      if (map?.settingsV2) stored = JSON.parse(map.settingsV2);
      if (!stored && (map?.theme || map?.fontFamily)) {
        stored = {
          appearance: {
            theme: map.theme || 'light',
            editorFont: map.fontFamily || FONT_FAMILIES[0].value,
          },
        };
      }
    } catch (error) {
      // Fall through to localStorage.
    }
    if (!stored) {
      try {
        const raw = localStorage.getItem('app_settings_v2') || localStorage.getItem('app_settings');
        if (raw) stored = JSON.parse(raw);
      } catch (error) {
        stored = null;
      }
    }
    await loadThemeRegistry();
    currentSettings = migrateAppearanceSettings(stored, stored);
    return currentSettings;
  }

  async function saveSettings(settings) {
    currentSettings = mergeSettings(settings);
    const serialized = JSON.stringify(currentSettings);
    try {
      await Promise.all([
        storage.saveAppSetting('settingsV2', serialized),
        storage.saveAppSetting('theme', currentSettings.appearance.theme),
        storage.saveAppSetting('fontFamily', currentSettings.appearance.editorFont),
        storage.saveAppSetting('language', currentSettings.language),
      ]);
    } catch (error) {
      // Local fallback below.
    }
    try {
      localStorage.setItem('app_settings_v2', serialized);
      localStorage.setItem('app_settings', serialized);
    } catch (error) {
      // Ignore local storage failure.
    }
  }

  function applySettings(settings = currentSettings) {
    currentSettings = mergeSettings(settings);
    const appearance = currentSettings.appearance;
    const previousLanguage = getLanguage();
    const language = applyLanguage(currentSettings.language);
    const html = document.documentElement;
    const selection = resolveThemeSelection(themeRegistry, appearance);
    applyThemeSelection(selection, html);
    currentSettings.appearance.themeMode = selection.themeMode;
    currentSettings.appearance.themeId = selection.themeId;
    currentSettings.appearance.lightThemeId = selection.lightThemeId;
    currentSettings.appearance.darkThemeId = selection.darkThemeId;
    currentSettings.appearance.theme = selection.themeMode;
    const resolvedTheme = selection.variant;
    html.dataset.themePreference = appearance.themeMode;
    html.dataset.density = appearance.density;
    html.dataset.reducedMotion = String(Boolean(appearance.reducedMotion));
    html.style.colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';
    html.style.setProperty('--editor-font-family', appearance.editorFont);
    html.style.setProperty('--ui-font-family', appearance.uiFont);
    html.style.setProperty('--code-font-family', appearance.codeFont);
    html.style.setProperty('--editor-font-size', `${appearance.fontSize}px`);
    html.style.setProperty('--editor-line-height', String(appearance.lineHeight));
    html.style.setProperty('--editor-content-width', `${appearance.contentWidth}%`);
    html.style.fontFamily = appearance.uiFont;
    const systemThemeNote = document.querySelector('[data-theme-system-note]');
    if (systemThemeNote) {
      systemThemeNote.textContent = t(resolvedTheme === 'dark'
        ? 'settings.theme.systemCurrentDark'
        : 'settings.theme.systemCurrentLight');
    }

    if (previousLanguage !== language && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-language-change', {
        detail: { language, preference: currentSettings.language },
      }));
    }

    if (!systemThemeQuery && window.matchMedia) {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      systemThemeQuery.addEventListener?.('change', () => {
        if (currentSettings.appearance.themeMode === 'system') applySettings(currentSettings);
      });
    }
  }

  function getSettings() {
    return currentSettings;
  }

  function getSetting(path, fallback = undefined) {
    return getPath(currentSettings, path, fallback);
  }

  function scheduleSave(statusElement) {
    clearTimeout(saveTimer);
    if (statusElement) statusElement.textContent = t('common.saving');
    saveTimer = setTimeout(async () => {
      await saveSettings(currentSettings);
      applySettings(currentSettings);
      if (statusElement) statusElement.textContent = t('common.saved');
    }, 180);
  }

  function controlId(path) {
    return `setting-${path.replace(/\./g, '-')}`;
  }

  function fontSelect(path, value) {
    const options = FONT_FAMILIES.map(font => ({
      value: font.value,
      label: t(font.labelKey),
    }));
    return `
      <div class="settings-select">
        <select id="${controlId(path)}" data-setting-path="${path}">
          ${optionHtml(options, value)}
        </select>
        <svg class="settings-select-arrow" data-lucide="chevron-down" width="14" height="14"></svg>
      </div>
    `;
  }

  function selectControl(path, value, options) {
    return `
      <div class="settings-select">
        <select id="${controlId(path)}" data-setting-path="${path}">
          ${optionHtml(options, value)}
        </select>
        <svg class="settings-select-arrow" data-lucide="chevron-down" width="14" height="14"></svg>
      </div>
    `;
  }

  function toggleControl(path, value) {
    return `
      <button class="settings-toggle ${value ? 'active' : ''}" type="button"
        data-setting-path="${path}" data-setting-type="boolean" aria-pressed="${String(value)}">
        <span></span>
      </button>
    `;
  }

  function rangeControl(path, value, min, max, step, suffix = '') {
    return `
      <div class="settings-range">
        <input type="range" data-setting-path="${path}" data-setting-type="number"
          min="${min}" max="${max}" step="${step}" value="${value}">
        <span data-range-value="${path}">${value}${suffix}</span>
      </div>
    `;
  }

  function textControl(path, value, placeholder = '') {
    return `
      <input class="settings-text-input" type="text"
        data-setting-path="${path}" data-setting-type="text"
        value="${escapeAttribute(value ?? '')}"
        placeholder="${escapeAttribute(placeholder)}"
        spellcheck="false" autocomplete="off">
    `;
  }

  function renderThemeCards(settings, variant) {
    const selectedThemeId = variant === 'light'
      ? settings.appearance.lightThemeId
      : settings.appearance.darkThemeId;
    return themeRegistry.listByVariant(variant).map(theme => {
      const tokens = theme.tokens;
      const previewStyle = [
        `--theme-preview-bg:${tokens.bgPage}`,
        `--theme-preview-surface:${tokens.surface}`,
        `--theme-preview-surface-secondary:${tokens.surfaceSecondary}`,
        `--theme-preview-sidebar:${tokens.sidebarBg}`,
        `--theme-preview-text:${tokens.foreground}`,
        `--theme-preview-primary:${tokens.primary}`,
        `--theme-preview-border:${tokens.border}`,
      ].join(';');
      return `
      <button class="settings-theme-card ${theme.id === selectedThemeId ? 'active' : ''}"
        data-theme-id="${theme.id}" data-theme-variant="${theme.variant}" type="button" style="${escapeAttribute(previewStyle)}"
        title="${escapeAttribute(themeDescription(theme, getLanguage()))}"
        aria-pressed="${String(theme.id === selectedThemeId)}">
        <span class="theme-preview theme-preview-custom">
          <span class="theme-preview-mini-titlebar">
            <i></i><i></i><i></i>
          </span>
          <span class="theme-preview-mini-body">
            <span class="theme-preview-mini-sidebar">
              <i></i><i></i><i></i>
            </span>
            <span class="theme-preview-mini-content">
              <i class="heading"></i>
              <i></i>
              <i></i>
              <i class="button"></i>
            </span>
          </span>
        </span>
        <span class="theme-card-copy">
          <span class="theme-card-title-row">
            <span class="theme-card-label">${escapeAttribute(themeDisplayName(theme, getLanguage()))}</span>
            ${theme.id === selectedThemeId
              ? `<span class="theme-card-current">${t('settings.theme.currentBadge')}</span>`
              : ''}
          </span>
          <span class="theme-card-description">${escapeAttribute(themeDescription(theme, getLanguage()))}</span>
          <span class="theme-card-tags">
            <span>${t(theme.source === 'user' ? 'settings.theme.customBadge' : 'settings.theme.builtinBadge')}</span>
            <span>${t(theme.variant === 'dark' ? 'settings.theme.preview.dark' : 'settings.theme.preview.light')}</span>
          </span>
        </span>
      </button>
    `;
    }).join('');
  }

  function renderThemeModeButtons(settings) {
    const modes = [
      { value: 'system', labelKey: 'settings.theme.mode.system' },
      { value: 'light', labelKey: 'settings.theme.mode.light' },
      { value: 'dark', labelKey: 'settings.theme.mode.dark' },
    ];
    return modes.map(mode => `
      <button class="settings-segmented-option ${settings.appearance.themeMode === mode.value ? 'active' : ''}"
        type="button" data-theme-mode="${mode.value}">
        ${t(mode.labelKey)}
      </button>
    `).join('');
  }

  function renderThemeVariantTabs(activeVariant) {
    return `
      <div class="theme-variant-tabs" role="tablist" aria-label="${escapeAttribute(t('settings.theme.variantTarget.title'))}">
        ${['light', 'dark'].map(variant => `
          <button class="theme-variant-tab ${activeVariant === variant ? 'active' : ''}"
            type="button" data-theme-variant-target="${variant}" role="tab"
            aria-selected="${String(activeVariant === variant)}">
            ${t(variant === 'light' ? 'settings.theme.lightThemes' : 'settings.theme.darkThemes')}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderCustomThemeManagement() {
    const userThemes = themeRegistry.list().filter(theme => theme.source === 'user');
    if (!userThemes.length) return '';
    return `
      <div class="settings-custom-theme-list">
        ${userThemes.map(theme => `
          <div class="settings-custom-theme-row">
            <span>${escapeAttribute(themeDisplayName(theme, getLanguage()))}</span>
            <button type="button" data-delete-theme="${theme.id}">${t('settings.theme.delete')}</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderLiveThemePreview(settings, activeVariant) {
    const selection = resolveThemeSelection(themeRegistry, settings.appearance);
    const previewTheme = themeRegistry.get(activeVariant === 'dark'
      ? settings.appearance.darkThemeId
      : settings.appearance.lightThemeId);
    const previewStyle = Object.entries(THEME_TOKEN_MAP)
      .map(([tokenName, cssVariable]) => `${cssVariable}:${previewTheme.tokens[tokenName]}`)
      .join(';');
    return `
      <aside class="theme-live-preview" style="${escapeAttribute(previewStyle)}" aria-label="${escapeAttribute(t('settings.theme.preview.title'))}">
        <div class="theme-live-preview-head">
          <span>${t('settings.theme.preview.title')}</span>
          <strong>${escapeAttribute(themeDisplayName(previewTheme, getLanguage()))}</strong>
        </div>
        <div class="theme-preview-app">
          <div class="theme-preview-titlebar">
            <span class="theme-preview-window-dots"><i></i><i></i><i></i></span>
            <span>${t('settings.theme.preview.appName')}</span>
          </div>
          <div class="theme-preview-app-body">
            <div class="theme-preview-sidebar">
              <span class="active"></span>
              <span></span>
              <span></span>
            </div>
            <div class="theme-preview-workarea">
              <div class="theme-preview-toolbar">
                <span></span>
                <button type="button" tabindex="-1">${t('settings.theme.preview.button')}</button>
              </div>
              <div class="theme-preview-paper">
                <span class="heading"></span>
                <span></span>
                <span></span>
                <span class="short"></span>
              </div>
            </div>
          </div>
        </div>
        <div class="theme-live-preview-meta">
          <span>${t(activeVariant === 'dark' ? 'settings.theme.darkThemes' : 'settings.theme.lightThemes')}</span>
          <span>${t(selection.themeId === previewTheme.id ? 'settings.theme.preview.current' : 'settings.theme.preview.idle')}</span>
        </div>
      </aside>
    `;
  }

  function renderThemeWorkbench(settings) {
    const selection = resolveThemeSelection(themeRegistry, settings.appearance);
    const activeVariant = settings.appearance.themeMode === 'system'
      ? themeVariantTarget
      : settings.appearance.themeMode;
    const lightTheme = themeRegistry.get(settings.appearance.lightThemeId);
    const darkTheme = themeRegistry.get(settings.appearance.darkThemeId);
    const modeLabel = t(selection.themeMode === 'system'
      ? 'settings.theme.mode.system'
      : selection.themeMode === 'dark'
        ? 'settings.theme.mode.dark'
        : 'settings.theme.mode.light');
    const variantLabel = t(selection.variant === 'dark'
      ? 'settings.theme.preview.dark'
      : 'settings.theme.preview.light');
    return `
      <section class="theme-workbench">
        <header class="theme-workbench-head">
          <div>
            <span class="settings-section-title">${t('settings.theme.workbench.title')}</span>
            <p>${t('settings.theme.workbench.desc')}</p>
          </div>
          <div class="theme-mode-control">
            <span>${t('settings.theme.mode.title')}</span>
            <div class="settings-segmented" role="group" aria-label="${escapeAttribute(t('settings.theme.mode.title'))}">
              ${renderThemeModeButtons(settings)}
            </div>
          </div>
        </header>
        <div class="theme-workbench-body">
          <div class="theme-style-area">
            <div class="theme-style-head">
              <div>
                <span>${t('settings.theme.style.title')}</span>
                <p>${t(activeVariant === 'light'
                  ? 'settings.theme.lightThemes.desc'
                  : 'settings.theme.darkThemes.desc')}</p>
              </div>
              ${settings.appearance.themeMode === 'system' ? renderThemeVariantTabs(activeVariant) : ''}
            </div>
            <div class="settings-theme-list">${renderThemeCards(settings, activeVariant)}</div>
          </div>
          ${renderLiveThemePreview(settings, activeVariant)}
        </div>
        <footer class="theme-workbench-footer">
          <div class="theme-workbench-footer-grid">
            <div class="theme-workbench-actions">
              <span class="theme-workbench-section-label">${t('settings.theme.actionsTitle')}</span>
              <div>
                <button class="btn-secondary" type="button" data-action="import-theme">${t('settings.theme.import')}</button>
                <button class="btn-secondary" type="button" data-action="duplicate-theme">${t('settings.theme.duplicate')}</button>
                <button class="btn-secondary" type="button" data-action="export-theme">${t('settings.theme.export')}</button>
                <button class="btn-secondary" type="button" data-action="open-theme-folder">${t('settings.theme.openFolder')}</button>
              </div>
            </div>
            <div class="theme-workbench-status">
              <span class="theme-workbench-section-label">${t('settings.theme.statusTitle')}</span>
              <div class="theme-selection-status-list">
                <span class="${selection.variant === 'light' ? 'active' : ''}">
                  <em>${t('settings.theme.light')}</em>
                  <strong>${escapeAttribute(themeDisplayName(lightTheme, getLanguage()))}</strong>
                </span>
                <span class="${selection.variant === 'dark' ? 'active' : ''}">
                  <em>${t('settings.theme.dark')}</em>
                  <strong>${escapeAttribute(themeDisplayName(darkTheme, getLanguage()))}</strong>
                </span>
              </div>
              <span class="theme-current-summary">${modeLabel} · ${variantLabel}</span>
              <span data-theme-directory>${t('settings.theme.directoryHint')}</span>
            </div>
          </div>
          ${renderCustomThemeManagement()}
          ${themeRegistry.errors.length ? `
            <details class="settings-theme-errors">
              <summary>${t('settings.theme.errorsSummary', { count: themeRegistry.errors.length })}</summary>
              ${themeRegistry.errors.map(error => `<span>${escapeAttribute(error.id)}: ${escapeAttribute(error.message)}</span>`).join('')}
            </details>
          ` : ''}
        </footer>
      </section>
    `;
  }

  function renderCategory(key, pluginPanel) {
    if (key === 'plugins') {
      return pluginPanel.render();
    }

    const settings = currentSettings;
    if (key === 'shortcuts') {
      const shortcutRow = shortcutKey => {
        const definition = SHORTCUT_DEFINITIONS[shortcutKey];
        const current = settings.shortcuts[shortcutKey] || definition.default;
        const label = t(`shortcut.${shortcutKey}.label`);
        const description = t(`shortcut.${shortcutKey}.desc`);
        return settingRow({
          label,
          description: t('settings.shortcuts.default', { shortcut: displayShortcut(definition.default) }),
          control: `
            <div class="settings-shortcut-control">
              <button class="settings-keycap" type="button" data-shortcut="${shortcutKey}">${escapeAttribute(displayShortcut(current))}</button>
              <button class="settings-shortcut-reset" type="button" data-reset-shortcut="${shortcutKey}">${t('settings.shortcuts.reset')}</button>
            </div>
          `,
          search: `${shortcutKey} ${label} ${description}`,
        });
      };
      const shortcutKeys = SHORTCUT_GROUPS.flatMap(group => group.keys);
      return `
        <header class="settings-page-intro settings-shortcut-intro">
          <h1>${t('settings.shortcuts.title')}</h1>
        </header>
        <section class="settings-section settings-shortcut-section">
          <div class="settings-section-body">
            ${shortcutKeys.map(shortcutRow).join('')}
          </div>
        </section>
      `;
    }

    if (key === 'appearance') {
      return `
        ${settingsPageHeader(
          'APPEARANCE',
          t('settings.appearance.title'),
          t('settings.appearance.desc'),
        )}
        ${renderThemeWorkbench(settings)}
        ${sectionHtml(t('settings.typography.title'), t('settings.typography.desc'), `
        ${settingRow({
          label: t('settings.typography.editorFont'),
          description: t('settings.typography.editorFontDesc'),
          control: fontSelect('appearance.editorFont', settings.appearance.editorFont),
          search: 'font editor code',
        })}
        ${settingRow({
          label: t('settings.typography.fontSize'),
          control: rangeControl('appearance.fontSize', settings.appearance.fontSize, 12, 24, 1, 'px'),
        })}
        ${settingRow({
          label: t('settings.typography.lineHeight'),
          control: rangeControl('appearance.lineHeight', settings.appearance.lineHeight, 1.4, 2.4, 0.1),
        })}
        ${settingRow({
          label: t('settings.typography.contentWidth'),
          control: rangeControl('appearance.contentWidth', settings.appearance.contentWidth, 40, 100, 1, '%'),
        })}
        `)}
        ${sectionHtml(t('settings.editor.title'), t('settings.editor.desc'), `
        ${settingRow({
          label: t('settings.editor.autosave'),
          description: t('settings.editor.autosaveDesc'),
          control: rangeControl('editor.autosaveDelay', settings.editor.autosaveDelay, 500, 5000, 250, 'ms'),
        })}
        ${settingRow({
          label: t('settings.editor.indent'),
          description: t('settings.editor.indentDesc'),
          control: selectControl('editor.indentSize', settings.editor.indentSize, [
            { value: 2, label: t('settings.editor.spaces2') },
            { value: 4, label: t('settings.editor.spaces4') },
          ]),
        })}
        `)}
      `;
    }

    return `
      ${settingsPageHeader('SYSTEM', t('settings.system.title'), t('settings.system.desc'))}
      ${sectionHtml(t('settings.language.title'), t('settings.language.desc'), `
        ${settingRow({
          label: t('settings.language.label'),
          description: t('settings.language.controlDesc'),
          control: selectControl('language', settings.language, getLanguageOptions()),
        })}
      `)}
      ${sectionHtml(t('settings.localFiles.title'), t('settings.localFiles.desc'), `
        ${settingRow({
          label: t('settings.localFiles.imageDir'),
          description: t('settings.localFiles.imageDirDesc'),
          control: textControl('files.imageDir', settings.files.imageDir, 'assets'),
        })}
        ${settingRow({
          label: t('settings.localFiles.imageWidth'),
          description: t('settings.localFiles.imageWidthDesc'),
          control: rangeControl('files.imageWidth', settings.files.imageWidth, 10, 100, 5, '%'),
          search: 'image width 图片 宽度',
        })}
      `)}
      ${sectionHtml(t('settings.update.title'), t('settings.update.desc'), `
        ${settingRow({ label: t('settings.update.version'), description: appVersion, control: '' })}
        ${settingRow({
          label: t('settings.update.label'),
          description: t('settings.update.current', { version: appVersion }),
          control: `<button class="btn-primary" id="btn-check-update" data-action="check-update" type="button">${t('settings.update.check')}</button>`,
        })}
        ${settingRow({
          label: t('settings.update.github'),
          description: t('settings.update.repo'),
          control: `<a class="settings-link" href="https://github.com/${appRepo}" target="_blank" rel="noreferrer">https://github.com/${appRepo}</a>`,
        })}
      `)}
    `;
  }

  async function openSettingsModal({ container = null, onClose = null } = {}) {
    await loadSettings();
    const fromView = state.view;
    state.view = 'settings';
    let activeCategory = 'system';
    const embedded = Boolean(container);
    const app = container || getApp();
    const eventController = new AbortController();
    const pluginPanel = createPluginStatusPanel({
      runtime: pluginRuntime,
      hostName: storage.name === 'wails' ? 'Wails' : 'Browser',
      t,
    });
    await pluginPanel.refresh();
    app.innerHTML = `
      <div class="view-shell settings-view settings-workspace ${embedded ? 'settings-embedded' : ''}" id="settings-view">
        <header class="settings-titlebar with-traffic-lights">
          <button class="modal-close" id="settings-close" title="关闭" type="button">
            <svg data-lucide="x" width="16" height="16"></svg>
          </button>
          <div class="settings-titlebar-main">
            <div class="settings-breadcrumb">
              <span>${t('settings.workspace')}</span>
              <i>/</i>
              <strong>${t('settings.title')}</strong>
            </div>
            <nav class="settings-header-tabs" aria-label="${escapeAttribute(t('settings.title'))}">
              ${CATEGORIES.map(category => `
                <button class="settings-tab ${category.key === activeCategory ? 'active' : ''}"
                  data-tab="${category.key}" type="button" title="${escapeAttribute(t(category.descriptionKey))}">
                  <span class="settings-tab-icon">
                    <svg data-lucide="${category.icon}" width="14" height="14"></svg>
                  </span>
                  <span class="settings-tab-label">${t(category.labelKey)}</span>
                </button>
              `).join('')}
            </nav>
          </div>
          <span class="settings-save-status" id="settings-save-status">
            <span class="settings-save-dot"></span>${t('common.saved')}
          </span>
        </header>
        <div class="settings-body">
          <main class="settings-content" id="settings-content"></main>
        </div>
        <div class="settings-toast-host" id="settings-toast-host" aria-live="polite"></div>
      </div>
    `;

    const content = app.querySelector('#settings-content');
    const status = app.querySelector('#settings-save-status');
    const toastHost = app.querySelector('#settings-toast-host');
    let toastTimer = 0;
    let cancelShortcutCapture = null;
    const showToast = (message, link) => {
      if (!toastHost) return;
      toastHost.innerHTML = '';
      const toast = document.createElement('div');
      toast.className = 'settings-toast';
      toast.append(document.createTextNode(message));
      if (link) {
        const anchor = document.createElement('a');
        anchor.href = link.url;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        anchor.textContent = link.label;
        toast.append(anchor);
      }
      toastHost.append(toast);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastHost.innerHTML = ''; }, 4000);
    };
    const installPluginFromFile = ({ upgrade = false } = {}) => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) {
          input.remove();
          resolve(false);
          return;
        }
        try {
          const content = await file.text();
          const result = await pluginRuntime.installPlugin(content, { upgrade });
          await pluginPanel.refresh();
          renderActive();
          showToast(t(upgrade ? 'plugin.action.upgraded' : 'plugin.action.installed', {
            name: result.pluginId,
            version: result.version,
          }));
          resolve(true);
        } catch (error) {
          showToast(t(upgrade ? 'plugin.action.upgradeFailed' : 'plugin.action.installFailed', {
            message: error.message || String(error),
          }));
          resolve(false);
        } finally {
          input.remove();
        }
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
    const renderActive = ({ focusPluginSearch = false } = {}) => {
      const breadcrumb = app.querySelector('.settings-breadcrumb');
      if (breadcrumb) {
        breadcrumb.querySelector('span').textContent = t('settings.workspace');
        breadcrumb.querySelector('strong').textContent = t('settings.title');
      }
      app.querySelectorAll('.settings-tab').forEach(tab => {
        const category = CATEGORIES.find(item => item.key === tab.dataset.tab);
        if (!category) return;
        tab.title = t(category.descriptionKey);
        const label = tab.querySelector('.settings-tab-label');
        if (label) label.textContent = t(category.labelKey);
      });
      const closeButton = app.querySelector('#settings-close');
      if (closeButton) closeButton.title = t('common.close');
      if (status) status.textContent = t('common.saved');
      content.innerHTML = renderCategory(activeCategory, pluginPanel);
      const directoryNode = content.querySelector('[data-theme-directory]');
      if (directoryNode && storage.name === 'browser') {
        directoryNode.textContent = t('settings.theme.browserStorage');
      } else if (directoryNode && typeof storage.getThemesDirectory === 'function') {
        Promise.resolve(storage.getThemesDirectory()).then(directory => {
          if (directory && directoryNode.isConnected) directoryNode.textContent = directory;
        }).catch(() => {});
      }
      lucideIcons();
      if (focusPluginSearch) {
        const searchInput = content.querySelector('[data-plugin-search]');
        searchInput?.focus();
        if (searchInput?.value) searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    };
    renderActive();

    const dispose = () => {
      cancelShortcutCapture?.();
      cancelShortcutCapture = null;
      eventController.abort();
      document.removeEventListener('keydown', escHandler);
    };
    const close = () => {
      dispose();
      state.view = fromView;
      if (embedded) {
        onClose?.();
        return;
      }
      state.view = 'editor';
      renderEditor();
    };
    const escHandler = event => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', escHandler);
    app.querySelector('#settings-close')?.addEventListener('click', close);

    app.addEventListener('click', async event => {
      const tab = event.target.closest('.settings-tab');
      if (tab) {
        activeCategory = tab.dataset.tab;
        app.querySelectorAll('.settings-tab').forEach(item => item.classList.toggle('active', item === tab));
        renderActive();
        return;
      }

      const themeMode = event.target.closest('.settings-segmented-option[data-theme-mode]');
      if (themeMode) {
        currentSettings.appearance.themeMode = themeMode.dataset.themeMode;
        themeVariantTarget = themeMode.dataset.themeMode === 'system'
          ? resolveThemeSelection(themeRegistry, currentSettings.appearance).variant
          : themeMode.dataset.themeMode;
        applySettings(currentSettings);
        scheduleSave(status);
        renderActive();
        return;
      }

      const themeVariantTargetButton = event.target.closest('[data-theme-variant-target]');
      if (themeVariantTargetButton) {
        themeVariantTarget = themeVariantTargetButton.dataset.themeVariantTarget;
        renderActive();
        return;
      }

      const theme = event.target.closest('.settings-theme-card');
      if (theme) {
        const variant = theme.dataset.themeVariant === 'dark' ? 'dark' : 'light';
        if (variant === 'dark') {
          currentSettings.appearance.darkThemeId = theme.dataset.themeId;
        } else {
          currentSettings.appearance.lightThemeId = theme.dataset.themeId;
        }
        currentSettings.appearance.themeId = theme.dataset.themeId;
        applySettings(currentSettings);
        scheduleSave(status);
        renderActive();
        return;
      }

      const deleteTheme = event.target.closest('[data-delete-theme]');
      if (deleteTheme) {
        try {
          if (typeof storage.deleteUserTheme !== 'function') throw new Error('当前存储不支持用户主题');
          await storage.deleteUserTheme(deleteTheme.dataset.deleteTheme);
          await loadThemeRegistry();
          if (!themeRegistry.get(currentSettings.appearance.lightThemeId)) {
            currentSettings.appearance.lightThemeId = 'paper-light';
          }
          if (!themeRegistry.get(currentSettings.appearance.darkThemeId)) {
            currentSettings.appearance.darkThemeId = 'paper-dark';
          }
          currentSettings.appearance.themeId = themeVariantTarget === 'dark'
            ? currentSettings.appearance.darkThemeId
            : currentSettings.appearance.lightThemeId;
          applySettings(currentSettings);
          await saveSettings(currentSettings);
          renderActive();
          showToast(t('settings.theme.deleted'));
        } catch (error) {
          showToast(t('settings.theme.deleteFailed', { message: error.message || String(error) }));
        }
        return;
      }

      const pluginResult = await pluginPanel.handleClick(event);
      if (pluginResult) {
        if (pluginResult.requestInstall) {
          await installPluginFromFile();
          return;
        }
        if (pluginResult.requestUpgrade) {
          await installPluginFromFile({ upgrade: true });
          return;
        }
        if (pluginResult.openPluginFolder) {
          try {
            const directory = await pluginRuntime.getPluginDirectory();
            await pluginRuntime.revealPluginDirectory();
            showToast(directory
              ? t('plugin.directory.opened', { path: directory })
              : t('plugin.directory.browserHint'));
          } catch (error) {
            showToast(t('plugin.directory.failed', { message: error.message || String(error) }));
          }
          return;
        }
        renderActive({ focusPluginSearch: Boolean(pluginResult.focusPluginSearch) });
        if (pluginResult.toast) showToast(pluginResult.toast);
        return;
      }

      const externalLink = event.target.closest('a[href^="http"]');
      if (externalLink && typeof openExternal === 'function') {
        event.preventDefault();
        openExternal(externalLink.href);
        return;
      }

      const toggle = event.target.closest('.settings-toggle');
      if (toggle) {
        const path = toggle.dataset.settingPath;
        const next = !Boolean(getPath(currentSettings, path));
        setPath(currentSettings, path, next);
        toggle.classList.toggle('active', next);
        toggle.setAttribute('aria-pressed', String(next));
        applySettings(currentSettings);
        scheduleSave(status);
        return;
      }

      const resetShortcut = event.target.closest('[data-reset-shortcut]');
      if (resetShortcut) {
        const shortcutKey = resetShortcut.dataset.resetShortcut;
        const defaultValue = SHORTCUT_DEFINITIONS[shortcutKey]?.default;
        if (!defaultValue) return;
        currentSettings.shortcuts[shortcutKey] = defaultValue;
        const control = app.querySelector(`[data-shortcut="${shortcutKey}"]`);
        if (control) control.textContent = displayShortcut(defaultValue);
        scheduleSave(status);
        return;
      }

      const shortcut = event.target.closest('[data-shortcut]');
      if (shortcut) {
        cancelShortcutCapture?.();
        shortcut.textContent = t('settings.shortcuts.press');
        const capture = keyEvent => {
          if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            shortcut.textContent = displayShortcut(currentSettings.shortcuts[shortcut.dataset.shortcut] || '');
            document.removeEventListener('keydown', capture, true);
            cancelShortcutCapture = null;
            return;
          }
          if (['Meta', 'Control', 'Alt', 'Shift'].includes(keyEvent.key)) return;
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          const value = formatShortcut(keyEvent);
          currentSettings.shortcuts[shortcut.dataset.shortcut] = value;
          shortcut.textContent = displayShortcut(value);
          scheduleSave(status);
          document.removeEventListener('keydown', capture, true);
          cancelShortcutCapture = null;
        };
        cancelShortcutCapture = () => document.removeEventListener('keydown', capture, true);
        document.addEventListener('keydown', capture, true);
        return;
      }

      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'duplicate-theme') {
        try {
          const selectedTheme = themeRegistry.get(themeVariantTarget === 'dark'
            ? currentSettings.appearance.darkThemeId
            : currentSettings.appearance.lightThemeId);
          if (!selectedTheme) throw new Error('theme not found');
          if (typeof storage.saveUserTheme !== 'function') throw new Error('当前存储不支持用户主题');
          const baseName = themeBaseDisplayName(selectedTheme, getLanguage());
          let nextID = `${selectedTheme.familyId}-copy`;
          if (themeRegistry.get(nextID)) nextID = `${nextID}-${Date.now().toString(36)}`;
          const copiedTheme = {
            schemaVersion: 1,
            id: nextID,
            name: {
              'zh-CN': `${themeBaseDisplayName(selectedTheme, 'zh-CN')} 副本`,
              en: `${themeBaseDisplayName(selectedTheme, 'en')} Copy`,
            },
            description: {
              'zh-CN': selectedTheme.description['zh-CN'],
              en: selectedTheme.description.en,
            },
            variants: {
              [selectedTheme.variant]: { tokens: clone(selectedTheme.tokens) },
            },
          };
          await storage.saveUserTheme(nextID, JSON.stringify(copiedTheme, null, 2));
          await loadThemeRegistry();
          const copiedThemeID = `${nextID}-${selectedTheme.variant}`;
          if (selectedTheme.variant === 'dark') {
            currentSettings.appearance.darkThemeId = copiedThemeID;
          } else {
            currentSettings.appearance.lightThemeId = copiedThemeID;
          }
          currentSettings.appearance.themeId = copiedThemeID;
          applySettings(currentSettings);
          await saveSettings(currentSettings);
          renderActive();
          showToast(t('settings.theme.duplicated', { name: copiedTheme.name['zh-CN'] }));
        } catch (error) {
          showToast(t('settings.theme.duplicateFailed', { message: error.message || String(error) }));
        }
        return;
      }
      if (action.dataset.action === 'export-theme') {
        try {
          const selectedTheme = themeRegistry.get(themeVariantTarget === 'dark'
            ? currentSettings.appearance.darkThemeId
            : currentSettings.appearance.lightThemeId);
          if (!selectedTheme) throw new Error('theme not found');
          const exportedTheme = {
            schemaVersion: 1,
            id: selectedTheme.familyId,
            name: {
              'zh-CN': baseName,
              en: themeBaseDisplayName(selectedTheme, 'en'),
            },
            description: clone(selectedTheme.description),
            variants: {
              [selectedTheme.variant]: { tokens: clone(selectedTheme.tokens) },
            },
          };
          const blob = new Blob([JSON.stringify(exportedTheme, null, 2)], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${selectedTheme.id}.json`;
          anchor.click();
          URL.revokeObjectURL(url);
          showToast(t('settings.theme.exported', { name: themeDisplayName(selectedTheme, getLanguage()) }));
        } catch (error) {
          showToast(t('settings.theme.exportFailed', { message: error.message || String(error) }));
        }
        return;
      }
      if (action.dataset.action === 'import-theme') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.style.display = 'none';
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          if (!file) {
            input.remove();
            return;
          }
          try {
            const content = await file.text();
            const parsed = parseUserTheme(content);
            if (typeof storage.saveUserTheme !== 'function') {
              throw new Error('当前存储不支持用户主题');
            }
            await storage.saveUserTheme(parsed.id, content);
            await loadThemeRegistry();
            const importedVariant = parsed.variants.light ? 'light' : 'dark';
            const importedThemeID = `${parsed.id}-${importedVariant}`;
            themeVariantTarget = importedVariant;
            if (importedVariant === 'dark') {
              currentSettings.appearance.darkThemeId = importedThemeID;
            } else {
              currentSettings.appearance.lightThemeId = importedThemeID;
            }
            currentSettings.appearance.themeId = importedThemeID;
            applySettings(currentSettings);
            await saveSettings(currentSettings);
            renderActive();
            showToast(t('settings.theme.imported', { name: themeDisplayName(parsed, getLanguage()) }));
          } catch (error) {
            showToast(t('settings.theme.importFailed', { message: error.message || String(error) }));
          } finally {
            input.remove();
          }
        }, { once: true });
        document.body.appendChild(input);
        input.click();
        return;
      }
      if (action.dataset.action === 'open-theme-folder') {
        try {
          const directory = typeof storage.getThemesDirectory === 'function'
            ? await storage.getThemesDirectory()
            : '';
          if (typeof storage.revealThemesDirectory === 'function') {
            await storage.revealThemesDirectory();
          }
          showToast(directory
            ? t('settings.theme.directoryOpened', { path: directory })
            : t('settings.theme.directoryBrowserHint'));
        } catch (error) {
          showToast(t('settings.theme.directoryFailed', { message: error.message || String(error) }));
        }
        return;
      }
      if (action.dataset.action === 'check-update') {
        const button = action;
        button.disabled = true;
        button.textContent = t('settings.update.checking');
        showToast(t('settings.update.connecting'));
        const result = await checkForUpdate();
        if (result.error) {
          showToast(result.error);
        } else if (result.noRelease) {
          showToast(t('settings.update.noRelease'));
        } else if (result.hasUpdate) {
          showToast(t('settings.update.found', { version: result.latest }), { url: result.url, label: t('settings.update.view') });
        } else {
          showToast(t('settings.update.latest', { version: result.current }));
        }
        button.disabled = false;
        button.textContent = t('settings.update.check');
      }

    }, { signal: eventController.signal });

    app.addEventListener('change', event => {
      const control = event.target.closest('[data-setting-path]');
      if (control && control.tagName === 'SELECT') {
        const path = control.dataset.settingPath;
        const value = path === 'editor.indentSize' ? Number(control.value) : control.value;
        setPath(currentSettings, path, value);
        applySettings(currentSettings);
        scheduleSave(status);
        if (path === 'language') renderActive();
        return;
      }
      if (control && control.dataset.settingType === 'text') {
        const value = control.value.trim() || 'assets';
        control.value = value;
        setPath(currentSettings, control.dataset.settingPath, value);
        scheduleSave(status);
        renderActive();
      }
    }, { signal: eventController.signal });

    app.addEventListener('input', event => {
      const pluginSearch = event.target.closest('[data-plugin-search]');
      if (pluginSearch) {
        pluginPanel.setQuery(pluginSearch.value);
        renderActive({ focusPluginSearch: true });
        return;
      }

      const control = event.target.closest('input[data-setting-path]');
      if (!control) return;
      const path = control.dataset.settingPath;
      const value = Number(control.value);
      setPath(currentSettings, path, value);
      const output = app.querySelector(`[data-range-value="${path}"]`);
      if (output) {
        const suffix = path === 'appearance.contentWidth' || path === 'files.imageWidth'
          ? '%'
          : path.includes('Delay') || path.includes('Interval')
            ? 'ms'
            : path.includes('Retention')
              ? ' 天'
              : '';
        output.textContent = `${value}${suffix}`;
      }
      applySettings(currentSettings);
      scheduleSave(status);
    }, { signal: eventController.signal });

    return {
      close,
      dispose,
    };
  }

  return {
    loadSettings,
    saveSettings,
    applySettings,
    getSettings,
    getSetting,
    setPluginRuntime(runtime) {
      pluginRuntime = runtime;
    },
    openSettingsModal,
  };
}

export {
  DEFAULT_SETTINGS,
  formatShortcut,
  matchesShortcut,
  mergeSettings,
};
