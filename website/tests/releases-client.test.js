import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findPlatformAsset,
  formatReleaseDate,
  getReleases,
  localizeRelease,
} from '../releases-client.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

async function withBrowserGlobals(run) {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = createMemoryStorage();
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.sessionStorage = originalStorage;
  }
}

test('empty static release manifest falls back to the GitHub API', async () => {
  await withBrowserGlobals(async () => {
    const requestedUrls = [];
    globalThis.fetch = async url => {
      requestedUrls.push(String(url));
      if (String(url).endsWith('/releases.json')) {
        return { ok: true, json: async () => [] };
      }
      return {
        ok: true,
        json: async () => [{
          tag_name: 'v1.0.0',
          html_url: 'https://github.com/smartartian/Markdown-writing/releases/tag/v1.0.0',
          assets: [],
        }],
      };
    };

    const releases = await getReleases();

    assert.equal(releases.length, 1);
    assert.equal(releases[0].tag_name, 'v1.0.0');
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /api\.github\.com/);
  });
});

test('release dates and invalid dates use stable labels', () => {
  assert.match(formatReleaseDate('2026-09-18T00:00:00Z'), /2026/);
  assert.equal(formatReleaseDate('not-a-date'), '未标注日期');
  assert.equal(formatReleaseDate(''), '未标注日期');
  assert.equal(formatReleaseDate('not-a-date', 'en-US'), 'Date unavailable');
});

test('platform asset lookup only exposes Apple Silicon packages', () => {
  const release = {
    assets: [
      { name: 'Markdown-Writing-macos-x64.zip', browser_download_url: 'https://example.com/x64' },
      { name: 'Markdown-Writing-macos-arm64.dmg', browser_download_url: 'https://example.com/arm64' },
      { name: 'Markdown-Writing-windows.exe', browser_download_url: 'https://example.com/windows' },
    ],
  };

  assert.equal(findPlatformAsset(release, 'mac-arm64').browser_download_url, 'https://example.com/arm64');
  assert.equal(findPlatformAsset(release, 'mac-x64'), null);
  assert.equal(findPlatformAsset(release, 'windows'), null);
});

test('release localization uses explicit translations before original notes', () => {
  const translated = localizeRelease({
    tag_name: 'v1.0.0',
    body: '中文说明',
    i18n: { en: { name: 'Version 1.0.0', body: 'English notes' } },
  }, 'en');
  assert.equal(translated.localizedName, 'Version 1.0.0');
  assert.equal(translated.localizedBody, 'English notes');
  assert.equal(translated.usesOriginalLanguage, false);

  const fallback = localizeRelease({
    tag_name: 'v1.0.0',
    body: '中文说明',
  }, 'en');
  assert.equal(fallback.localizedBody, '中文说明');
  assert.equal(fallback.usesOriginalLanguage, true);
});
