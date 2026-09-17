const FONT_FAMILIES = [
  { label: '霞鹜文楷（推荐）', value: "'LXGW WenKai', 'PingFang SC', 'Songti SC', serif" },
  { label: '默认（苹方 / 系统）', value: "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif" },
  { label: '衬线（Serif）', value: "'Georgia', 'Songti SC', serif" },
  { label: '等宽（Mono）', value: "'SF Mono', 'Menlo', 'Consolas', monospace" },
];

const THEMES = [
  { label: '亮色', value: 'light' },
  { label: '米黄', value: 'sepia' },
  { label: '暗色', value: 'dark' },
];

export function createSettingsModule({
  state,
  storage,
  appVersion,
  appRepo,
  checkForUpdate,
  escapeHtml,
  qs,
  getApp,
  lucideIcons,
  renderEditor,
  initLibrary,
}) {
  async function loadSettings() {
    try {
      const map = await storage.loadAppSettings();
      if (map && Object.keys(map).length > 0) {
        return {
          theme: map.theme || 'light',
          fontFamily: map.fontFamily || FONT_FAMILIES[0].value,
        };
      }
    } catch (error) {
      // Fall back to localStorage.
    }
    try {
      const raw = localStorage.getItem('app_settings');
      if (!raw) return null;
      const settings = JSON.parse(raw);
      await saveSettings(settings);
      return settings;
    } catch (error) {
      return null;
    }
  }

  async function saveSettings(settings) {
    try {
      await Promise.all([
        storage.saveAppSetting('theme', settings.theme || 'light'),
        storage.saveAppSetting('fontFamily', settings.fontFamily || ''),
      ]);
    } catch (error) {
      // Local persistence remains available below.
    }
    try {
      localStorage.setItem('app_settings', JSON.stringify(settings));
    } catch (error) {
      // Ignore storage failures.
    }
  }

  function applySettings(settings) {
    const html = document.documentElement;
    html.setAttribute('data-theme', settings.theme || 'light');
    const fontFamily = settings.fontFamily || FONT_FAMILIES[0].value;
    html.style.setProperty('--editor-font-family', fontFamily);
    html.style.fontFamily = fontFamily;
  }

  async function openSettingsModal() {
    const saved = await loadSettings() || {};
    const current = {
      theme: saved.theme || 'light',
      fontFamily: saved.fontFamily || FONT_FAMILIES[0].value,
    };
    const tabs = [
      { key: 'appearance', label: '外观设置' },
      { key: 'about', label: '关于' },
    ];
    let activeTab = 'appearance';

    const familyOptions = FONT_FAMILIES.map(font =>
      `<option value="${escapeHtml(font.value)}" ${font.value === current.fontFamily ? 'selected' : ''}>${escapeHtml(font.label)}</option>`
    ).join('');
    const themeCards = THEMES.map(theme =>
      `<button class="settings-theme-card ${theme.value === current.theme ? 'active' : ''}" data-theme="${theme.value}" data-theme-preview="${theme.value}">
         <span class="theme-preview theme-preview-${theme.value}">
           <span class="theme-preview-bar"></span>
           <span class="theme-preview-line"></span>
           <span class="theme-preview-line short"></span>
         </span>
         <span class="theme-card-label">${escapeHtml(theme.label)}</span>
       </button>`
    ).join('');
    const tabsHtml = tabs.map(tab =>
      `<button class="settings-tab ${tab.key === activeTab ? 'active' : ''}" data-tab="${tab.key}">${escapeHtml(tab.label)}</button>`
    ).join('');

    const fromView = state.view;
    state.view = 'settings';
    getApp().innerHTML = `
      <div class="view-shell settings-view" id="settings-view">
        <header class="settings-titlebar with-traffic-lights">
          <button class="modal-close" id="settings-close" title="关闭">
            <svg data-lucide="x" width="16" height="16" stroke="currentColor" fill="none" stroke-width="1.8"></svg>
          </button>
        </header>
        <div class="settings-hero">
          <span class="settings-hero-title">设置</span>
        </div>
        <div class="settings-body">
          <aside class="settings-sidebar">${tabsHtml}</aside>
          <div class="settings-content">
            <div class="settings-panel active" data-panel="appearance">
              <section class="settings-section">
                <div class="settings-section-head">
                  <div class="settings-section-title">外观</div>
                  <div class="settings-section-desc">选择整体主题风格。</div>
                </div>
                <div class="settings-section-body">
                  <div class="settings-theme-list" id="settings-theme-list">${themeCards}</div>
                </div>
              </section>
              <section class="settings-section">
                <div class="settings-section-head">
                  <div class="settings-section-title">字体</div>
                  <div class="settings-section-desc">设置应用界面和正文显示的字体。</div>
                </div>
                <div class="settings-section-body">
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-label">字体家族</span>
                      <span class="settings-row-desc">推荐使用霞鹜文楷或苹方以获得更好中文体验</span>
                    </div>
                    <div class="settings-row-control">
                      <div class="settings-select">
                        <select id="settings-font-family">${familyOptions}</select>
                        <svg class="settings-select-arrow" data-lucide="chevron-down" width="14" height="14" stroke="currentColor" fill="none" stroke-width="1.5"></svg>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
            <div class="settings-panel" data-panel="about">
              <section class="settings-section">
                <div class="settings-section-head">
                  <div class="settings-section-title">Markdown Writing</div>
                  <div class="settings-section-desc">Markdown 写作编辑器</div>
                </div>
                <div class="settings-section-body">
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-label">版本</span>
                      <span class="settings-row-desc">${appVersion}</span>
                    </div>
                  </div>
                  <div class="settings-row">
                    <div class="settings-row-info">
                      <span class="settings-row-label">更新</span>
                      <span class="settings-row-desc" id="update-status">点击检查最新版本</span>
                    </div>
                    <div class="settings-row-control">
                      <button class="btn-primary" id="btn-check-update" style="white-space:nowrap;height:32px;padding:0 16px;font-size:13px;">检查更新</button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;
    lucideIcons();

    const close = () => {
      document.removeEventListener('keydown', escHandler);
      if (fromView === 'library') {
        void initLibrary();
      } else {
        state.view = 'editor';
        renderEditor();
      }
    };

    qs('#settings-close').addEventListener('click', close);
    const escHandler = (event) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', escHandler);

    document.querySelectorAll('.settings-tab').forEach(button => {
      button.addEventListener('click', () => {
        const key = button.dataset.tab;
        activeTab = key;
        document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.toggle('active', tab === button));
        document.querySelectorAll('.settings-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === key));
      });
    });

    qs('#settings-font-family').addEventListener('change', async (event) => {
      current.fontFamily = event.target.value;
      applySettings(current);
      await saveSettings(current);
    });

    document.querySelectorAll('.settings-theme-card').forEach(card => {
      card.addEventListener('click', async () => {
        current.theme = card.dataset.theme;
        document.querySelectorAll('.settings-theme-card').forEach(other => other.classList.toggle('active', other === card));
        applySettings(current);
        await saveSettings(current);
      });
    });

    const checkButton = qs('#btn-check-update');
    const status = qs('#update-status');
    if (checkButton) {
      checkButton.addEventListener('click', async () => {
        checkButton.disabled = true;
        checkButton.textContent = '检查中...';
        status.textContent = '正在连接 GitHub...';
        const result = await checkForUpdate();
        if (result.error) {
          status.textContent = result.error;
        } else if (result.hasUpdate) {
          const installUrl = `https://raw.githubusercontent.com/${appRepo}/main/scripts/install.sh`;
          const dmgUrl = `https://github.com/${appRepo}/releases/download/md-editor-v${result.latest}/Markdown.Writing_${result.latest}_aarch64.dmg`;
          status.innerHTML = `发现新版本 <strong>v${escapeHtml(result.latest)}</strong><br><br>
            <a href="${installUrl}" target="_blank" style="color:var(--accent)">下载安装脚本</a>
            &nbsp;|&nbsp;
            <a href="${dmgUrl}" target="_blank" style="color:var(--accent)">直接下载 DMG</a>`;
        } else {
          status.textContent = `已是最新版本 (${result.current})`;
        }
        checkButton.disabled = false;
        checkButton.textContent = '检查更新';
      });
    }
  }

  return {
    loadSettings,
    saveSettings,
    applySettings,
    openSettingsModal,
  };
}
