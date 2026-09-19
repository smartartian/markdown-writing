export const REPO = 'smartartian/Markdown-writing';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const TARGET_PLATFORM = 'mac-arm64';

const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const CACHE_KEY = `markdown-writing-releases:${REPO}`;
const CACHE_TTL = 10 * 60 * 1000;

function readCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (!cached || Date.now() - cached.savedAt > CACHE_TTL) return null;
    return cached.releases;
  } catch (error) {
    return null;
  }
}

function writeCache(releases) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), releases }));
  } catch (error) {
    // Cache failures should not block the page.
  }
}

async function fetchStaticReleases() {
  try {
    const response = await fetch('./releases.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    const releases = await response.json();
    return Array.isArray(releases) && releases.length ? releases : null;
  } catch (error) {
    return null;
  }
}

async function fetchGitHubReleases() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub Releases 暂时不可用（${response.status}）`);
    }
    const releases = await response.json();
    return releases.filter(release => !release.draft);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getReleases({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }

  const staticReleases = await fetchStaticReleases();
  if (staticReleases) {
    writeCache(staticReleases);
    return staticReleases;
  }

  const releases = await fetchGitHubReleases();
  writeCache(releases);
  return releases;
}

export function latestRelease(releases) {
  return releases.find(release => !release.draft) || null;
}

export function localizeRelease(release, language = 'zh') {
  if (!release) return null;
  const localized = release.i18n?.[language]
    || release.translations?.[language]
    || {};
  const fallbackBody = String(release.body || '');
  const localizedBody = String(localized.body || fallbackBody);
  const usesOriginalLanguage = language === 'en'
    && !localized.body
    && /[\u3400-\u9fff]/.test(fallbackBody);

  return {
    ...release,
    localizedName: localized.name || release.name || release.tag_name || '',
    localizedBody,
    usesOriginalLanguage,
  };
}

export function formatReleaseDate(value, dateLocale = 'zh-CN') {
  if (!value) return dateLocale.startsWith('zh') ? '未标注日期' : 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dateLocale.startsWith('zh') ? '未标注日期' : 'Date unavailable';
  return new Intl.DateTimeFormat(dateLocale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function detectPlatform() {
  return TARGET_PLATFORM;
}

export function findPlatformAsset(release, platform) {
  if (platform !== TARGET_PLATFORM) return null;
  const assets = release?.assets || [];
  const match = name => assets.find(asset => String(asset.name || '').toLowerCase().includes(name));
  return match('aarch64') || match('arm64') || match('apple-silicon');
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
