const REPO = 'smartartian/Markdown-writing';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=12`;
const CACHE_KEY = `markdown-writing-releases:${REPO}`;
const CACHE_TTL = 10 * 60 * 1000;

const header = document.querySelector('#site-header');
const mobileMenuButton = document.querySelector('#mobile-menu-button');
const mobileNav = document.querySelector('#mobile-nav');
const releaseList = document.querySelector('#release-list');
const statusElement = document.querySelector('#updates-status');
const syncedElement = document.querySelector('#updates-synced');
const refreshButton = document.querySelector('#refresh-updates');

function renderIcons() {
  const lucideApi = window.lucide || globalThis.lucide;
  if (lucideApi) lucideApi.createIcons();
}

function updateHeader() {
  header?.classList.toggle('scrolled', window.scrollY > 18);
}

mobileMenuButton?.addEventListener('click', () => {
  const open = mobileMenuButton.getAttribute('aria-expanded') === 'true';
  mobileMenuButton.setAttribute('aria-expanded', String(!open));
  mobileNav?.classList.toggle('open', !open);
  document.body.classList.toggle('menu-open', !open);
});

mobileNav?.addEventListener('click', event => {
  if (!event.target.closest('a')) return;
  mobileMenuButton?.setAttribute('aria-expanded', 'false');
  mobileNav.classList.remove('open');
  document.body.classList.remove('menu-open');
});

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

function formatDate(value) {
  if (!value) return '未标注日期';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

function releaseType(release) {
  if (release.prerelease) return { className: 'preview', label: '预览版' };
  if (release.draft) return { className: 'draft', label: '草稿' };
  return { className: 'stable', label: '正式版' };
}

function renderReleases(releases) {
  if (!releases.length) {
    statusElement.hidden = true;
    releaseList.innerHTML = `
      <div class="updates-empty">
        <span class="feature-icon"><i data-lucide="inbox"></i></span>
        <h2>还没有公开版本</h2>
        <p>GitHub Releases 中暂时没有可展示的版本记录。发布后，这里会自动同步。</p>
        <a class="button button-dark" href="https://github.com/${REPO}/releases" target="_blank" rel="noreferrer">
          前往 GitHub Releases
        </a>
      </div>
    `;
    renderIcons();
    return;
  }

  statusElement.hidden = true;
  releaseList.innerHTML = releases.map(release => {
    const type = releaseType(release);
    const title = release.name || release.tag_name || '未命名版本';
    const notes = renderReleaseNotes(release.body || '该版本暂未填写更新说明。');
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
              <span><i data-lucide="calendar-days"></i>${escapeHtml(formatDate(release.published_at))}</span>
            </div>
          </div>
          <a class="release-link" href="${escapeHtml(release.html_url)}" target="_blank" rel="noreferrer">
            在 GitHub 查看
            <i data-lucide="arrow-up-right"></i>
          </a>
        </header>
        <div class="release-notes">${notes}</div>
      </article>
    `;
  }).join('');
  renderIcons();
}

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

function showError(error) {
  statusElement.hidden = true;
  syncedElement.textContent = '同步失败';
  releaseList.innerHTML = `
    <div class="updates-empty error">
      <span class="feature-icon"><i data-lucide="cloud-off"></i></span>
      <h2>暂时无法读取 GitHub 更新</h2>
      <p>${escapeHtml(error.message || '网络请求失败，请稍后重试。')}</p>
      <div class="updates-empty-actions">
        <button class="button button-dark" id="retry-updates" type="button">重新加载</button>
        <a class="button button-light" href="https://github.com/${REPO}/releases" target="_blank" rel="noreferrer">打开 GitHub Releases</a>
      </div>
    </div>
  `;
  renderIcons();
  document.querySelector('#retry-updates')?.addEventListener('click', () => loadReleases({ force: true }));
}

async function fetchReleases() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub 返回 ${response.status}`);
    }
    const releases = await response.json();
    return releases.filter(release => !release.draft);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadReleases({ force = false } = {}) {
  refreshButton.disabled = true;
  statusElement.hidden = false;
  releaseList.innerHTML = '';
  statusElement.innerHTML = '<span class="updates-spinner"></span>正在从 GitHub 获取更新记录...';

  if (!force) {
    const cached = readCache();
    if (cached) {
      syncedElement.textContent = '已使用最近一次同步结果';
      renderReleases(cached);
      refreshButton.disabled = false;
      return;
    }
  }

  try {
    const releases = await fetchReleases();
    writeCache(releases);
    syncedElement.textContent = `最近同步：${new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date())}`;
    renderReleases(releases);
  } catch (error) {
    showError(error);
  } finally {
    refreshButton.disabled = false;
  }
}

const yearElement = document.querySelector('#copyright-year');
if (yearElement) yearElement.textContent = `© ${new Date().getFullYear()}`;

refreshButton?.addEventListener('click', () => loadReleases({ force: true }));
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();
renderIcons();
loadReleases();
