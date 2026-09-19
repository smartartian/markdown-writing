import {
  TARGET_PLATFORM,
  findPlatformAsset,
  formatFileSize,
  formatReleaseDate,
  getReleases,
  latestRelease,
  localizeRelease,
} from './releases-client.js';
import { getLanguage, locale, t } from './i18n.js';
import { initSiteShell, renderIcons } from './site.js';

let currentRelease = null;

function renderRelease(release) {
  const link = document.querySelector('#download-release-link');
  const label = document.querySelector('#download-release-label');
  const versionNodes = document.querySelectorAll('#download-version, #download-version-meta');
  const date = document.querySelector('#download-release-date');
  const size = document.querySelector('#download-size');
  const note = document.querySelector('#download-release-note');
  const notes = document.querySelector('#download-notes');
  const notesLabel = document.querySelector('#download-notes-label');
  const state = document.querySelector('#download-release-state');
  if (!link || !label || !date || !size || !note || !notes || !state) return;

  if (!release) {
    versionNodes.forEach(node => { node.textContent = t('downloadPage.noRelease'); });
    date.textContent = t('release.repo');
    size.textContent = t('downloadPage.unknown');
    state.textContent = t('downloadPage.noRelease');
    state.className = 'release-type preview';
    note.textContent = t('downloadPage.noReleaseBody');
    notes.textContent = t('downloadPage.noReleaseBody');
    if (notesLabel) notesLabel.hidden = true;
    label.textContent = t('action.githubReleases');
    link.href = 'https://github.com/smartartian/Markdown-writing/releases';
    return;
  }

  const localized = localizeRelease(release, getLanguage());
  const asset = findPlatformAsset(release, TARGET_PLATFORM);
  versionNodes.forEach(node => { node.textContent = localized.localizedName || release.tag_name || '-'; });
  date.textContent = formatReleaseDate(release.published_at, locale());
  size.textContent = formatFileSize(asset?.size) || t('downloadPage.unknown');
  state.textContent = release.prerelease ? t('updates.preview') : t('updates.stable');
  state.className = `release-type ${release.prerelease ? 'preview' : 'stable'}`;
  note.textContent = asset ? t('release.downloadHint') : t('downloadPage.noAsset');
  notes.textContent = localized.localizedBody || t('downloadPage.notesFallback');
  if (notesLabel) notesLabel.hidden = !localized.usesOriginalLanguage;
  label.textContent = asset ? t('downloadPage.downloadButton') : t('downloadPage.openRelease');
  link.href = asset?.browser_download_url || release.html_url || 'https://github.com/smartartian/Markdown-writing/releases';
}

async function loadRelease() {
  try {
    const releases = await getReleases();
    currentRelease = latestRelease(releases);
  } catch (error) {
    currentRelease = null;
  }
  renderRelease(currentRelease);
}

initSiteShell({ solidHeader: true });
renderIcons();
loadRelease();

window.addEventListener('site-language-change', () => {
  renderRelease(currentRelease);
});
