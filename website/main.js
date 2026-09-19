import {
  RELEASES_URL,
  detectPlatform,
  findPlatformAsset,
  formatFileSize,
  formatReleaseDate,
  getReleases,
  latestRelease,
} from './releases-client.js';
import { initSiteShell } from './site.js';

function platformLabel(platform) {
  return ({
    'mac-arm64': 'macOS Apple Silicon',
    'mac-x64': 'macOS Intel',
    windows: 'Windows',
    linux: 'Linux',
  })[platform] || '桌面版';
}

function updateDownloadLinks(release, platform) {
  const asset = findPlatformAsset(release, platform);
  const href = asset?.browser_download_url || release?.html_url || RELEASES_URL;
  document.querySelectorAll('[data-download-primary]').forEach(link => {
    link.href = href;
    const label = link.querySelector('[data-download-label]');
    if (!label) return;
    if (!release) {
      label.textContent = '前往 GitHub 下载';
    } else if (asset) {
      label.textContent = `下载 ${platformLabel(platform)} 版`;
    } else {
      label.textContent = `查看 ${platformLabel(platform)} 版`;
    }
  });
  const size = formatFileSize(asset?.size);
  const detail = document.querySelector('#download-detail');
  if (detail) {
    if (!release) {
      detail.textContent = '当前没有公开 Release，前往 GitHub 查看发布状态。';
    } else if (asset) {
      detail.textContent = `${release.tag_name || release.name || '最新版本'} · ${platformLabel(platform)}${size ? ` · ${size}` : ''}`;
    } else {
      detail.textContent = `${release.tag_name || release.name || '最新版本'} · 暂未找到 ${platformLabel(platform)} 安装包`;
    }
  }
}

function updateLatestRelease(release) {
  const version = document.querySelector('#latest-version');
  const date = document.querySelector('#latest-date');
  const notes = document.querySelector('#latest-notes');
  const link = document.querySelector('#latest-release-link');
  const versionBadge = document.querySelector('#download-version');
  if (!version || !date || !notes || !link) return;

  if (!release) {
    version.textContent = '等待首个公开版本';
    date.textContent = 'GitHub Releases';
    notes.textContent = '发布后，官网会自动同步版本、更新说明和平台下载入口。';
    link.href = RELEASES_URL;
    if (versionBadge) versionBadge.textContent = 'MARKDOWN WRITING';
    return;
  }

  version.textContent = release.name || release.tag_name || '最新版本';
  date.textContent = formatReleaseDate(release.published_at);
  notes.textContent = String(release.body || '该版本暂未填写更新说明。')
    .replace(/[#*_`>\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  link.href = release.html_url || RELEASES_URL;
  if (versionBadge) versionBadge.textContent = `MARKDOWN WRITING ${release.tag_name || release.name || ''}`.trim();
}

async function loadReleaseData() {
  const platform = detectPlatform();
  try {
    const releases = await getReleases();
    const release = latestRelease(releases);
    updateLatestRelease(release);
    updateDownloadLinks(release, platform);
  } catch (error) {
    updateLatestRelease(null);
    updateDownloadLinks(null, platform);
  }
}

const { renderIcons } = initSiteShell();
renderIcons();
loadReleaseData();
