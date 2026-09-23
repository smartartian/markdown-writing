import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SETTINGS,
  formatShortcut,
  matchesSettingsQuery,
  matchesShortcut,
  mergeSettings,
} from '../../modules/settings.js';

test('settings: merge keeps defaults while applying nested overrides', () => {
  const merged = mergeSettings({
    appearance: { fontSize: 20, theme: 'dark' },
    files: { defaultMode: 'filesystem' },
  });

  assert.equal(merged.appearance.fontSize, 20);
  assert.equal(merged.appearance.theme, 'dark');
  assert.equal(merged.appearance.contentWidth, DEFAULT_SETTINGS.appearance.contentWidth);
  assert.equal(merged.files.defaultMode, 'filesystem');
  assert.equal(merged.files.imageDir, 'assets');
  assert.equal(merged.shortcuts.save, DEFAULT_SETTINGS.shortcuts.save);
  assert.equal(merged.shortcuts.find, 'Cmd+F');
  assert.equal(merged.shortcuts.h1, 'Option+Cmd+1');
  assert.equal(merged.shortcuts.insertTable, 'Option+Cmd+T');
  assert.equal(merged.language, 'system');
  assert.equal(merged.appearance.themeMode, 'system');
  assert.equal(merged.appearance.themeId, 'paper-light');
  assert.equal(merged.appearance.contentWidth, 70);
  assert.equal(merged.appearance.logo, 'blue-on-white');
  assert.equal(merged.appearance.lightThemeId, 'paper-light');
  assert.equal(merged.appearance.darkThemeId, 'paper-dark');
  assert.notEqual(merged, DEFAULT_SETTINGS);
});

test('settings: shortcut recorder formats modifier combinations', () => {
  assert.equal(formatShortcut({
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: 's',
  }), 'Cmd+S');

  assert.equal(formatShortcut({
    metaKey: false,
    ctrlKey: true,
    altKey: true,
    shiftKey: true,
    key: 'p',
  }), 'Ctrl+Alt+Shift+P');
});

test('settings: shortcut matching supports platform alternatives and exact modifiers', () => {
  assert.equal(matchesShortcut({
    key: 's',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  }, 'Cmd/Ctrl+S'), true);

  assert.equal(matchesShortcut({
    key: 's',
    metaKey: false,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
  }, 'Cmd/Ctrl+S'), true);

  assert.equal(matchesShortcut({
    key: 's',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
  }, 'Cmd/Ctrl+S'), false);
});

test('settings: search query matching is case-insensitive and token based', () => {
  assert.equal(matchesSettingsQuery('应用图标 logo icon dock', ''), true);
  assert.equal(matchesSettingsQuery('应用图标 logo icon dock', '   '), true);
  assert.equal(matchesSettingsQuery('应用图标 logo icon dock', 'LOGO'), true);
  assert.equal(matchesSettingsQuery('应用图标 logo icon dock', 'logo dock'), true);
  assert.equal(matchesSettingsQuery('应用图标 logo icon dock', 'logo missing'), false);
  assert.equal(matchesSettingsQuery('应用图标 logo', '插件'), false);
  assert.equal(matchesSettingsQuery('语言、本地文件和软件更新', '本地文件'), true);
  assert.equal(matchesSettingsQuery(undefined, 'x'), false);
});
