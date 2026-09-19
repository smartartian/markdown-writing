import {
  REPO,
  formatReleaseDate,
  getReleases,
  localizeRelease,
} from './releases-client.js';
import { getLanguage, locale, t } from './i18n.js';
import { initSiteShell, renderIcons } from './site.js';

const releaseList = document.querySelector('#release-list');
const statusElement = document.querySelector('#updates-status');
const syncedElement = document.querySelector('#updates-synced');
const refreshButton = document.querySelector('#refresh-updates');
let cachedReleases = [];
let lastSyncTime = null;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value) {
  return /^https?:\/\//i.test(value || '') ? value : '';
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
      const href = safeUrl(url);
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>` : label;
    });
}

function renderReleaseNotes(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listType = '';

  function closeList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = '';
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h3>${renderInline(heading[1])}</h3>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        html.push(`<${listType}>`);
      }
      html.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  closeList();
  return html.join('');
}

function releaseType(release) {
  if (release.prerelease) return { className: 'preview', label: t('updates.preview') };
  if (release.draft) return { className: 'draft', label: t('updates.draft') };
  return { className: 'stable', label: t('updates.stable') };
}

function renderReleases(releases) {
  cachedReleases = releases;
  if (!releases.length) {
    statusElement.hidden = true;
    releaseList.innerHTML = `
      <div class="updates-empty">
        <span class="feature-icon"><i data-lucide="inbox"></i></span>
        <h2>${escapeHtml(t('updates.emptyTitle'))}</h2>
        <p>${escapeHtml(t('updates.emptyBody'))}</p>
        <a class="button button-primary" href="https://github.com/${REPO}/releases" target="_blank" rel="noreferrer">
          ${escapeHtml(t('action.githubReleases'))}
        </a>
      </div>
    `;
    renderIcons();
    return;
  }

  statusElement.hidden = true;
  releaseList.innerHTML = releases.map(release => {
    const type = releaseType(release);
    const localized = localizeRelease(release, getLanguage());
    const title = localized.localizedName || t('updates.untitled');
    const notes = renderReleaseNotes(localized.localizedBody || t('updates.noNotes'));
    const originalNote = localized.usesOriginalLanguage
      ? `<div class="release-original-note">${escapeHtml(t('updates.originalNotes'))}</div>`
      : '';
    return `
      <article class="release-card">
        <header class="release-header">
          <div>
            <div class="release-title-row">
              <h2>${escapeHtml(title)}</h2>
              <span class="release-type ${type.className}">${type.label}</span>
            </div>
            <div class="release-meta">
              <span><i data-lucide="tag"></i>${escapeHtml(release.tag_name || '')}</span>
              <span><i data-lucide="calendar-days"></i>${escapeHtml(formatReleaseDate(release.published_at, locale()))}</span>
            </div>
          </div>
          <a class="release-link" href="${escapeHtml(safeUrl(release.html_url) || `https://github.com/${REPO}/releases`)}" target="_blank" rel="noreferrer">
            ${escapeHtml(t('action.openGithub'))}
            <i data-lucide="arrow-up-right"></i>
          </a>
        </header>
        ${originalNote}
        <div class="release-notes">${notes}</div>
      </article>
    `;
  }).join('');
  renderIcons();
}

function showError(error) {
  statusElement.hidden = true;
  syncedElement.textContent = t('updates.syncFailed');
  releaseList.innerHTML = `
    <div class="updates-empty error">
      <span class="feature-icon"><i data-lucide="cloud-off"></i></span>
      <h2>${escapeHtml(t('updates.errorTitle'))}</h2>
      <p>${escapeHtml(error.message || t('updates.errorFallback'))}</p>
      <div class="updates-empty-actions">
        <button class="button button-primary" id="retry-updates" type="button">${escapeHtml(t('updates.retry'))}</button>
        <a class="button button-secondary" href="https://github.com/${REPO}/releases" target="_blank" rel="noreferrer">${escapeHtml(t('action.githubReleases'))}</a>
      </div>
    </div>
  `;
  renderIcons();
  document.querySelector('#retry-updates')?.addEventListener('click', () => loadReleases({ force: true }));
}

async function loadReleases({ force = false } = {}) {
  refreshButton.disabled = true;
  statusElement.hidden = false;
  releaseList.innerHTML = '';
  statusElement.innerHTML = `<span class="updates-spinner"></span><span>${escapeHtml(t('updates.loading'))}</span>`;

  try {
    const releases = await getReleases({ force });
    lastSyncTime = new Intl.DateTimeFormat(locale(), {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    syncedElement.textContent = t('updates.synced', { time: lastSyncTime });
    renderReleases(releases);
  } catch (error) {
    showError(error);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton?.addEventListener('click', () => loadReleases({ force: true }));
initSiteShell({ solidHeader: true });
renderIcons();
loadReleases();

window.addEventListener('site-language-change', () => {
  if (lastSyncTime) {
    lastSyncTime = new Intl.DateTimeFormat(locale(), {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    syncedElement.textContent = t('updates.synced', { time: lastSyncTime });
  }
  if (cachedReleases.length) renderReleases(cachedReleases);
  else loadReleases();
});
