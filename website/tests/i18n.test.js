import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MESSAGES, normalizeLanguage } from '../i18n.js';

test('language normalization defaults to English outside Chinese locales', () => {
  assert.equal(normalizeLanguage('zh-CN'), 'zh');
  assert.equal(normalizeLanguage('zh-Hant'), 'zh');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('fr-FR'), 'en');
  assert.equal(normalizeLanguage(''), 'en');
});

test('all website messages provide Chinese and English translations', () => {
  for (const [key, entry] of Object.entries(MESSAGES)) {
    assert.ok(entry.zh, `${key} is missing Chinese copy`);
    assert.ok(entry.en, `${key} is missing English copy`);
  }
});

test('every HTML translation key exists in the message registry', () => {
  const pages = ['index.html', 'docs.html', 'updates.html', 'install.html', 'download.html'];
  for (const page of pages) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label|-value)?="([^"]+)"/g)]
      .map(match => match[1]);
    const missing = [...new Set(keys.filter(key => !MESSAGES[key]))];
    assert.deepEqual(missing, [], `${page} contains missing translation keys`);
  }
});
