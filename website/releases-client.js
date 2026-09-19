export const REPO = 'smartartian/Markdown-writing';
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

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

export function formatReleaseDate(value) {
  if (!value) return '未标注日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未标注日期';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function detectPlatform() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const architecture = navigator.userAgentData?.architecture || '';
  if (/Mac/i.test(platform) || /Mac OS/i.test(ua)) {
    return /arm64|aarch64|arm/i.test(`${architecture} ${ua}`) ? 'mac-arm64' : 'mac-x64';
  }
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

export function findPlatformAsset(release, platform) {
  const assets = release?.assets || [];
  const match = name => assets.find(asset => String(asset.name || '').toLowerCase().includes(name));
  switch (platform) {
    case 'mac-arm64':
      return match('aarch64') || match('arm64') || match('apple-silicon');
    case 'mac-x64':
      return match('x86_64') || match('x64') || match('intel');
    case 'windows':
      return match('.exe') || match('.msi') || match('windows');
    case 'linux':
      return match('.appimage') || match('.deb') || match('linux');
    default:
      return null;
  }
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
