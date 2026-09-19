import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLanguage,
  getLanguage,
  resolveLanguage,
  t,
} from '../../i18n/index.js';

test('language: resolves explicit and system preferences', () => {
  assert.equal(resolveLanguage('zh-CN'), 'zh-CN');
  assert.equal(resolveLanguage('en'), 'en');
  assert.ok(['zh-CN', 'en'].includes(resolveLanguage('system')));
});

test('language: translation switches immediately', () => {
  applyLanguage('zh-CN');
  assert.equal(t('settings.categories.appearance'), '外观设置');
  applyLanguage('en');
  assert.equal(t('settings.categories.appearance'), 'Appearance');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('main.lines', { count: 12 }), 'Lines: 12');
});
