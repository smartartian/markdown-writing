import { BUILTIN_THEMES } from './builtins.js';

const THEME_TOKEN_MAP = {
  bgPage: '--bg-page',
  surface: '--surface',
  surfaceSecondary: '--surface-secondary',
  sidebarBg: '--sidebar-bg',
  sidebarItemHover: '--sidebar-item-hover',
  sidebarItemActive: '--sidebar-item-active',
  sidebarText: '--sidebar-text',
  sidebarTextDim: '--sidebar-text-dim',
  titlebarBg: '--titlebar-bg',
  titlebarText: '--titlebar-text',
  titlebarTextDim: '--titlebar-text-dim',
  foreground: '--foreground',
  heading: '--fg-heading',
  secondary: '--fg-secondary',
  placeholder: '--fg-placeholder',
  border: '--border',
  divider: '--divider',
  primary: '--primary',
  primaryHover: '--primary-hover',
  accent: '--accent',
  accentSoft: '--accent-soft',
  error: '--error',
  success: '--success',
};

const REQUIRED_TOKENS = ['bgPage', 'surface', 'foreground', 'heading', 'border', 'primary'];
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLocalizedText(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    return { 'zh-CN': value.trim(), en: value.trim() };
  }
  if (value && typeof value === 'object') {
    const zh = String(value['zh-CN'] || value.zh || fallback || '').trim();
    const en = String(value.en || fallback || zh || '').trim();
    return { 'zh-CN': zh || fallback, en: en || fallback };
  }
  return { 'zh-CN': fallback, en: fallback };
}

function validateColor(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', value);
  }
  return /^(#(?:[0-9a-f]{3,8})|rgba?\(|hsla?\(|transparent$)/i.test(value.trim());
}

function colorToRgb(value) {
  const color = String(value || '').trim();
  const shortHex = color.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return shortHex[1].split('').map(part => parseInt(part + part, 16));
  }
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [0, 2, 4].map(index => parseInt(hex[1].slice(index, index + 2), 16));
  }
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map(Number);
  return null;
}

function accentContrast(primary) {
  const rgb = colorToRgb(primary);
  if (!rgb) return '#ffffff';
  const [red, green, blue] = rgb.map(value => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.52 ? '#111214' : '#ffffff';
}

function sanitizeTokens(tokens, fallbackTokens) {
  const next = { ...fallbackTokens };
  const errors = [];
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return { tokens: next, errors: ['variants tokens must be an object'] };
  }
  for (const [tokenName, value] of Object.entries(tokens)) {
    if (!(tokenName in THEME_TOKEN_MAP)) {
      errors.push(`unknown token: ${tokenName}`);
      continue;
    }
    if (!validateColor(value)) {
      errors.push(`invalid color for ${tokenName}`);
      continue;
    }
    next[tokenName] = String(value).trim();
  }
  for (const tokenName of REQUIRED_TOKENS) {
    if (!next[tokenName]) errors.push(`missing required token: ${tokenName}`);
  }
  return { tokens: next, errors };
}

function normalizeVariant(rawVariant, fallbackVariant) {
  const result = sanitizeTokens(rawVariant?.tokens, fallbackVariant.tokens);
  return {
    tokens: result.tokens,
    errors: result.errors,
  };
}

export function normalizeThemeConfig(rawTheme, { source = 'user', fallbackTheme = BUILTIN_THEMES[0] } = {}) {
  if (!rawTheme || typeof rawTheme !== 'object' || Array.isArray(rawTheme)) {
    throw new Error('theme config must be a JSON object');
  }
  const id = String(rawTheme.id || '').trim().toLowerCase();
  if (!THEME_ID_PATTERN.test(id)) {
    throw new Error('theme id must match [a-z0-9][a-z0-9_-]{1,63}');
  }
  const schemaVersion = Number(rawTheme.schemaVersion || 1);
  if (schemaVersion !== 1) throw new Error(`unsupported theme schemaVersion: ${schemaVersion}`);

  const fallback = fallbackTheme.variants || {};
  const fallbackLight = fallback.light || { tokens: {} };
  const fallbackDark = fallback.dark || fallbackLight;
  const rawLight = rawTheme.variants?.light;
  const rawDark = rawTheme.variants?.dark;
  const light = rawLight ? normalizeVariant(rawLight, fallbackLight) : null;
  const dark = rawDark ? normalizeVariant(rawDark, fallbackDark) : null;
  const errors = [...(light?.errors || []), ...(dark?.errors || [])];
  if (!rawLight && !rawDark) errors.push('theme requires a light or dark variant');

  return {
    schemaVersion: 1,
    id,
    name: normalizeLocalizedText(rawTheme.name, id),
    description: normalizeLocalizedText(rawTheme.description, ''),
    variants: {
      ...(light ? { light: { tokens: light.tokens } } : {}),
      ...(dark ? { dark: { tokens: dark.tokens } } : {}),
    },
    source,
    warnings: errors,
  };
}

function themeFamilyID(value) {
  return String(value || '').toLowerCase().replace(/-(light|dark)$/, '');
}

export function migrateLegacyTheme(theme, themeId = '') {
  let family = themeFamilyID(themeId);
  if (!family) {
    family = theme === 'sepia'
      ? 'sepia'
      : theme === 'dark'
        ? 'graphite'
        : 'paper';
  }
  const themeMode = theme === 'dark'
    ? 'dark'
    : theme === 'light' || theme === 'sepia'
      ? 'light'
      : 'system';
  return {
    themeMode,
    lightThemeId: `${family}-light`,
    darkThemeId: `${family}-dark`,
  };
}

function expandThemeVariants(theme) {
  return Object.entries(theme.variants).map(([variant, value]) => ({
    schemaVersion: 1,
    id: `${themeFamilyID(theme.id)}-${variant}`,
    familyId: themeFamilyID(theme.id),
    variant,
    name: {
      'zh-CN': `${theme.name['zh-CN']} ${variant === 'light' ? '亮色' : '暗色'}`,
      en: `${theme.name.en} ${variant === 'light' ? 'Light' : 'Dark'}`,
    },
    description: clone(theme.description),
    tokens: clone(value.tokens),
    source: theme.source,
    warnings: [...theme.warnings],
  }));
}

export function createThemeRegistry({ builtins = BUILTIN_THEMES, userThemes = [] } = {}) {
  const themes = new Map();
  const families = new Map();
  const errors = [];

  function addTheme(rawTheme, source) {
    const normalized = normalizeThemeConfig(rawTheme, {
      source,
      fallbackTheme: BUILTIN_THEMES[0],
    });
    const family = new Map();
    for (const theme of expandThemeVariants(normalized)) {
      themes.set(theme.id, theme);
      family.set(theme.variant, theme);
    }
    families.set(normalized.id, family);
  }

  for (const builtin of builtins) {
    try {
      addTheme(builtin, 'builtin');
    } catch (error) {
      errors.push({ id: builtin?.id || 'unknown', message: error.message || String(error) });
    }
  }

  for (const rawTheme of userThemes) {
    try {
      addTheme(rawTheme, 'user');
    } catch (error) {
      errors.push({ id: rawTheme?.id || 'unknown', message: error.message || String(error) });
    }
  }

  function get(id) {
    const key = String(id || '').toLowerCase();
    if (themes.has(key)) return themes.get(key);
    const family = families.get(themeFamilyID(key));
    return family?.light || family?.dark;
  }

  function getByVariant(variant, preferredId = '') {
    const preferred = get(preferredId);
    if (preferred?.variant === variant) return preferred;
    const family = families.get(themeFamilyID(preferredId));
    if (family?.get(variant)) return family.get(variant);
    return listByVariant(variant)[0] || null;
  }

  function listByVariant(variant) {
    return [...themes.values()].filter(theme => theme.variant === variant);
  }

  return {
    list: () => [...themes.values()],
    listByVariant,
    get,
    getByVariant,
    errors,
  };
}

export function resolveThemeSelection(registry, appearance = {}) {
  const migrated = migrateLegacyTheme(appearance.theme, appearance.themeId);
  const themeMode = ['system', 'light', 'dark'].includes(appearance.themeMode)
    ? appearance.themeMode
    : migrated.themeMode;
  const lightTheme = registry.getByVariant(
    'light',
    appearance.lightThemeId || migrated.lightThemeId,
  );
  const darkTheme = registry.getByVariant(
    'dark',
    appearance.darkThemeId || migrated.darkThemeId,
  );
  const systemDark = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
  const variant = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;
  const theme = variant === 'dark' ? darkTheme : lightTheme;
  return {
    theme,
    themeId: theme.id,
    lightThemeId: lightTheme.id,
    darkThemeId: darkTheme.id,
    themeMode,
    variant,
    tokens: clone(theme.tokens),
  };
}

export function applyThemeSelection(selection, element = document.documentElement) {
  element.dataset.themeId = selection.themeId;
  element.dataset.themeMode = selection.themeMode;
  element.dataset.themeVariant = selection.variant;
  element.dataset.theme = selection.variant;
  element.style.colorScheme = selection.variant;
  element.style.setProperty('--accent-contrast', accentContrast(selection.tokens.primary));
  for (const [tokenName, cssVariable] of Object.entries(THEME_TOKEN_MAP)) {
    const value = selection.tokens[tokenName];
    if (value) element.style.setProperty(cssVariable, value);
  }
  return selection;
}

export function themeDisplayName(theme, language = 'zh-CN') {
  return theme?.name?.[language] || theme?.name?.['zh-CN'] || theme?.id || '';
}

export function themeDescription(theme, language = 'zh-CN') {
  return theme?.description?.[language] || theme?.description?.['zh-CN'] || '';
}

export function themeBaseDisplayName(theme, language = 'zh-CN') {
  return themeDisplayName(theme, language)
    .replace(/\s*(亮色|暗色|Light|Dark)$/i, '')
    .trim();
}

export function parseUserTheme(content) {
  const parsed = typeof content === 'string' ? JSON.parse(content) : content;
  return normalizeThemeConfig(parsed, { source: 'user' });
}

export {
  BUILTIN_THEMES,
  REQUIRED_TOKENS,
  THEME_ID_PATTERN,
  THEME_TOKEN_MAP,
};
