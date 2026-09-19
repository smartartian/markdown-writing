import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILTIN_THEMES,
  applyThemeSelection,
  createThemeRegistry,
  migrateLegacyTheme,
  normalizeThemeConfig,
  resolveThemeSelection,
} from '../../themes/index.js';

test('themes: built-ins provide light and dark variants', () => {
  const registry = createThemeRegistry();
  assert.equal(registry.list().length, 8);
  assert.equal(registry.listByVariant('light').length, 4);
  assert.equal(registry.listByVariant('dark').length, 4);
  for (const theme of registry.list()) {
    assert.ok(theme.tokens.bgPage);
    assert.ok(theme.tokens.primary);
    assert.ok(['light', 'dark'].includes(theme.variant));
  }
});

test('themes: legacy settings migrate to mode and theme id', () => {
  assert.deepEqual(migrateLegacyTheme('system'), {
    themeMode: 'system',
    lightThemeId: 'paper-light',
    darkThemeId: 'paper-dark',
  });
  assert.deepEqual(migrateLegacyTheme('sepia'), {
    themeMode: 'light',
    lightThemeId: 'sepia-light',
    darkThemeId: 'sepia-dark',
  });
  assert.deepEqual(migrateLegacyTheme('dark'), {
    themeMode: 'dark',
    lightThemeId: 'graphite-light',
    darkThemeId: 'graphite-dark',
  });
});

test('themes: custom theme merges missing tokens from the fallback theme', () => {
  const theme = normalizeThemeConfig({
    schemaVersion: 1,
    id: 'custom-test',
    name: 'Custom',
    variants: {
      light: { tokens: { bgPage: '#ffffff', primary: '#336699' } },
    },
  });
  assert.equal(theme.id, 'custom-test');
  assert.equal(theme.variants.light.tokens.bgPage, '#ffffff');
  assert.equal(theme.variants.light.tokens.foreground, BUILTIN_THEMES[0].variants.light.tokens.foreground);
});

test('themes: resolution uses selected family and explicit mode', () => {
  const registry = createThemeRegistry();
  const selection = resolveThemeSelection(registry, {
    themeMode: 'dark',
    lightThemeId: 'paper-light',
    darkThemeId: 'ocean-dark',
  });
  assert.equal(selection.themeId, 'ocean-dark');
  assert.equal(selection.variant, 'dark');
  assert.equal(selection.tokens.primary, '#76c3e4');
});

test('themes: light and dark selections remain independent', () => {
  const registry = createThemeRegistry();
  const lightSelection = resolveThemeSelection(registry, {
    themeMode: 'light',
    lightThemeId: 'sepia-light',
    darkThemeId: 'ocean-dark',
  });
  const darkSelection = resolveThemeSelection(registry, {
    themeMode: 'dark',
    lightThemeId: 'sepia-light',
    darkThemeId: 'ocean-dark',
  });
  assert.equal(lightSelection.themeId, 'sepia-light');
  assert.equal(darkSelection.themeId, 'ocean-dark');
  assert.equal(lightSelection.lightThemeId, 'sepia-light');
  assert.equal(darkSelection.darkThemeId, 'ocean-dark');
});

test('themes: accent contrast follows primary luminance', () => {
  const lightProperties = {};
  const lightElement = {
    dataset: {},
    style: { setProperty: (name, value) => { lightProperties[name] = value; } },
  };
  applyThemeSelection({
    themeId: 'paper',
    themeMode: 'light',
    variant: 'light',
    tokens: { primary: '#f2f2f2' },
  }, lightElement);
  assert.equal(lightProperties['--accent-contrast'], '#111214');

  const darkProperties = {};
  const darkElement = {
    dataset: {},
    style: { setProperty: (name, value) => { darkProperties[name] = value; } },
  };
  applyThemeSelection({
    themeId: 'paper',
    themeMode: 'dark',
    variant: 'dark',
    tokens: { primary: '#1e1f22' },
  }, darkElement);
  assert.equal(darkProperties['--accent-contrast'], '#ffffff');
});
