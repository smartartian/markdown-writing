import { getLanguage, t } from './i18n.js';
import { initSiteShell, renderIcons } from './site.js';

const THEMES = {
  paper: {
    light: {
      page: '#f2f2f5', surface: '#ffffff', secondarySurface: '#f5f5f8', sidebar: '#ffffff',
      hover: 'rgba(92,137,242,0.08)', active: '#5c89f2', foreground: '#2c2e33', heading: '#1a1c20',
      secondary: '#5a5c62', muted: '#8e9098', border: '#e2e2e6', divider: '#e8e8ec',
      primary: '#5c89f2', primarySoft: 'rgba(92,137,242,0.10)', success: '#5ca85c'
    },
    dark: {
      page: '#1e1f22', surface: '#24262a', secondarySurface: '#2a2c30', sidebar: '#1a1b1e',
      hover: 'rgba(255,255,255,0.06)', active: '#79a0ff', foreground: '#e6e6ea', heading: '#ffffff',
      secondary: '#b6b8c0', muted: '#8f9098', border: '#34363b', divider: '#2f3136',
      primary: '#79a0ff', primarySoft: 'rgba(121,160,255,0.14)', success: '#72c982'
    }
  },
  sepia: {
    light: {
      page: '#f6efe1', surface: '#fbf5e6', secondarySurface: '#f0e8d3', sidebar: '#fbf5e6',
      hover: 'rgba(146,106,48,0.09)', active: '#9a6b2f', foreground: '#3a3126', heading: '#241d14',
      secondary: '#6b5e46', muted: '#8c7c5f', border: '#e0d3b5', divider: '#e8dcc0',
      primary: '#9a6b2f', primarySoft: 'rgba(154,107,47,0.12)', success: '#6c8c51'
    },
    dark: {
      page: '#211d18', surface: '#2a251f', secondarySurface: '#332d26', sidebar: '#1b1814',
      hover: 'rgba(224,190,132,0.09)', active: '#d1a66b', foreground: '#eee4d3', heading: '#fff7e9',
      secondary: '#c8b9a1', muted: '#a69783', border: '#494037', divider: '#3d352e',
      primary: '#d1a66b', primarySoft: 'rgba(209,166,107,0.15)', success: '#8fb27a'
    }
  },
  graphite: {
    light: {
      page: '#f1f2f3', surface: '#fafafa', secondarySurface: '#eceeef', sidebar: '#fafafa',
      hover: 'rgba(55,61,66,0.08)', active: '#3f474e', foreground: '#282d31', heading: '#15191c',
      secondary: '#565e64', muted: '#7d858b', border: '#d9dde0', divider: '#e2e5e7',
      primary: '#3f474e', primarySoft: 'rgba(63,71,78,0.10)', success: '#5f8b67'
    },
    dark: {
      page: '#17191b', surface: '#202326', secondarySurface: '#292d31', sidebar: '#131517',
      hover: 'rgba(255,255,255,0.07)', active: '#aeb7bf', foreground: '#e2e6e9', heading: '#f7f9fa',
      secondary: '#b3bbc1', muted: '#8e969d', border: '#363b40', divider: '#2d3236',
      primary: '#aeb7bf', primarySoft: 'rgba(174,183,191,0.14)', success: '#87b08e'
    }
  },
  ocean: {
    light: {
      page: '#eef4f7', surface: '#f9fcfd', secondarySurface: '#e5eef3', sidebar: '#f9fcfd',
      hover: 'rgba(36,112,150,0.09)', active: '#247096', foreground: '#20343d', heading: '#10262f',
      secondary: '#4e6873', muted: '#738b96', border: '#cddde4', divider: '#dce8ed',
      primary: '#247096', primarySoft: 'rgba(36,112,150,0.11)', success: '#4c8a70'
    },
    dark: {
      page: '#111b20', surface: '#18262d', secondarySurface: '#20323b', sidebar: '#0d171c',
      hover: 'rgba(128,205,235,0.08)', active: '#76c3e4', foreground: '#deedf3', heading: '#f4fbfe',
      secondary: '#afc6d0', muted: '#87a2ae', border: '#304852', divider: '#273d46',
      primary: '#76c3e4', primarySoft: 'rgba(118,195,228,0.15)', success: '#7bc09d'
    }
  }
};

const PREVIEW_DOCUMENTS = {
  plan: {
    name: 'preview.plan',
    heading: 'preview.heading',
    body: 'preview.body',
  },
  notes: {
    name: 'preview.notes',
    heading: 'preview.notes.heading',
    body: 'preview.notes.body',
  },
  release: {
    name: 'preview.release',
    heading: 'preview.release.heading',
    body: 'preview.release.body',
  },
};

const SCENARIOS = ['open', 'write', 'export'];

let activeTheme = 'paper';
let activeMode = 'light';
let activeDocument = 'plan';
let activeScenario = 'open';
let findMatchIndex = 1;
let toastTimer = null;

function applyPreviewTheme() {
  const preview = document.querySelector('#app-preview');
  if (!preview) return;
  const tokens = THEMES[activeTheme][activeMode];
  const variables = {
    '--app-bg-page': tokens.page,
    '--app-surface': tokens.surface,
    '--app-surface-secondary': tokens.secondarySurface,
    '--app-sidebar': tokens.sidebar,
    '--app-sidebar-hover': tokens.hover,
    '--app-sidebar-active': tokens.active,
    '--app-foreground': tokens.foreground,
    '--app-heading': tokens.heading,
    '--app-secondary': tokens.secondary,
    '--app-muted': tokens.muted,
    '--app-border': tokens.border,
    '--app-divider': tokens.divider,
    '--app-primary': tokens.primary,
    '--app-primary-soft': tokens.primarySoft,
    '--app-success': tokens.success,
  };

  Object.entries(variables).forEach(([name, value]) => {
    preview.style.setProperty(name, value);
  });

  document.querySelectorAll('[data-theme]').forEach(button => {
    button.classList.toggle('active', button.dataset.theme === activeTheme);
  });
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === activeMode);
  });
  document.querySelectorAll('[data-theme-card]').forEach(button => {
    const active = button.dataset.themeCard === activeTheme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  const summary = document.querySelector('#theme-summary');
  if (summary) {
    summary.textContent = t('preview.themeSummary', {
      theme: t(`theme.${activeTheme}`),
      mode: t(`mode.${activeMode}`),
    });
  }
}

function setPreviewMode(mode) {
  document.querySelectorAll('[data-preview-pane]').forEach(pane => {
    pane.hidden = pane.dataset.previewPane !== mode;
  });
  document.querySelectorAll('[data-preview-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.previewMode === mode);
  });
}

function setPreviewDocument(documentId) {
  const documentData = PREVIEW_DOCUMENTS[documentId];
  if (!documentData) return;
  activeDocument = documentId;
  document.querySelectorAll('[data-preview-document]').forEach(button => {
    button.classList.toggle('active', button.dataset.previewDocument === documentId);
  });

  const name = t(documentData.name);
  const heading = t(documentData.heading);
  const body = t(documentData.body);
  document.querySelectorAll('[data-preview-document-name]').forEach(element => {
    element.textContent = name;
  });
  const headingElement = document.querySelector('[data-preview-doc-heading]');
  const bodyElement = document.querySelector('[data-preview-doc-body]');
  const sourceView = document.querySelector('#preview-source-view');
  if (headingElement) headingElement.textContent = heading;
  if (bodyElement) bodyElement.textContent = body;
  if (sourceView) {
    sourceView.textContent = `# ${heading}\n\n${body}\n\n> ${t('preview.quote')}\n\n- [x] ${t('preview.task1')}\n- [x] ${t('preview.task2')}\n- [ ] ${t('preview.task3')}`;
  }
}

function setPreviewPanel(panel) {
  document.querySelectorAll('[data-preview-panel-button]').forEach(button => {
    button.classList.toggle('active', button.dataset.previewPanelButton === panel);
  });
  document.querySelectorAll('[data-preview-panel]').forEach(element => {
    element.hidden = element.dataset.previewPanel !== panel;
  });
  const label = document.querySelector('#preview-panel-label');
  if (label) label.textContent = t(panel === 'outline' ? 'preview.outline' : 'preview.files');
}

function closePreviewOverlays({ keepFind = false } = {}) {
  document.querySelectorAll('.preview-drawer').forEach(drawer => {
    drawer.hidden = true;
  });
  const exportMenu = document.querySelector('#preview-export-menu');
  if (exportMenu) exportMenu.hidden = true;
  if (!keepFind) {
    const findPanel = document.querySelector('#preview-find-panel');
    if (findPanel) findPanel.hidden = true;
  }
}

function openPreviewDrawer(drawerId, toastKey) {
  closePreviewOverlays();
  const drawer = document.querySelector(`#${drawerId}`);
  if (!drawer) return;
  drawer.hidden = false;
  if (toastKey) showPreviewToast(t(toastKey));
}

function setFindPanel({ open = true, replace = false } = {}) {
  const panel = document.querySelector('#preview-find-panel');
  const replacementRow = document.querySelector('[data-find-replace-row]');
  if (!panel) return;
  if (open) closePreviewOverlays({ keepFind: true });
  panel.hidden = !open;
  if (replacementRow) replacementRow.hidden = !replace;
  if (open) panel.querySelector('input')?.focus();
}

function setSettingsTab(tab) {
  document.querySelectorAll('[data-settings-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.settingsTab === tab);
  });
  document.querySelectorAll('[data-settings-panel]').forEach(panel => {
    panel.hidden = panel.dataset.settingsPanel !== tab;
  });
}

function showPreviewToast(message) {
  const toast = document.querySelector('#preview-toast');
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function selectScenario(name) {
  if (!SCENARIOS.includes(name)) return;
  activeScenario = name;
  document.querySelectorAll('[data-scenario]').forEach(button => {
    button.classList.toggle('active', button.dataset.scenario === name);
  });
  const current = document.querySelector('#scenario-current');
  if (current) current.textContent = t(`scenario.${name}`);
}

function runScenario(name, { notify = true } = {}) {
  if (!SCENARIOS.includes(name)) return;
  selectScenario(name);

  if (name === 'open') {
    closePreviewOverlays();
    setPreviewPanel('files');
    if (notify) showPreviewToast(t('preview.toast.workspace'));
  }
  if (name === 'write') {
    closePreviewOverlays();
    setPreviewMode('preview');
    setPreviewDocument('plan');
    if (notify) showPreviewToast(t('preview.toast.writing'));
  }
  if (name === 'export') {
    closePreviewOverlays();
    const menu = document.querySelector('#preview-export-menu');
    if (menu) menu.hidden = false;
    if (notify) showPreviewToast(t('preview.toast.export'));
  }
}

function initNavigationFeedback() {
  const links = [...document.querySelectorAll('[data-nav-section]')];
  if (!links.length) return;
  const sections = links
    .map(link => document.querySelector(`#${link.dataset.navSection}`))
    .filter(Boolean);
  const progress = document.querySelector('#scroll-progress-bar');
  let ticking = false;

  function update() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    if (progress) progress.style.width = `${ratio * 100}%`;

    let current = '';
    let nearestTop = Number.NEGATIVE_INFINITY;
    for (const section of sections) {
      const top = section.getBoundingClientRect().top;
      if (top <= 150 && top > nearestTop) {
        current = section.id;
        nearestTop = top;
      }
    }
    links.forEach(link => {
      link.classList.toggle('nav-current', link.dataset.navSection === current);
    });
    ticking = false;
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  update();
}

function initButtonFeedback() {
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button, .button');
    if (!button) return;
    button.classList.add('is-pressed');
    const clear = () => button.classList.remove('is-pressed');
    button.addEventListener('pointerup', clear, { once: true });
    button.addEventListener('pointercancel', clear, { once: true });
    button.addEventListener('pointerleave', clear, { once: true });
  });
}

function initInteractivePreview() {
  let hintDismissed = false;
  const dismissHint = () => {
    if (hintDismissed) return;
    hintDismissed = true;
    const hint = document.querySelector('#preview-hint');
    if (!hint) return;
    hint.classList.add('dismissed');
    window.setTimeout(() => {
      hint.hidden = true;
    }, 240);
  };
  window.setTimeout(dismissHint, 6500);
  document.querySelector('.hero')?.addEventListener('pointerdown', dismissHint, { once: true });

  document.querySelectorAll('[data-theme]').forEach(button => {
    button.addEventListener('click', () => {
      activeTheme = button.dataset.theme;
      applyPreviewTheme();
    });
  });
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      activeMode = button.dataset.mode;
      applyPreviewTheme();
    });
  });
  document.querySelectorAll('[data-theme-card]').forEach(button => {
    button.addEventListener('click', () => {
      activeTheme = button.dataset.themeCard;
      applyPreviewTheme();
      document.querySelector('#workflow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  document.querySelectorAll('[data-preview-mode]').forEach(button => {
    button.addEventListener('click', () => setPreviewMode(button.dataset.previewMode));
  });
  document.querySelectorAll('[data-preview-panel-button]').forEach(button => {
    button.addEventListener('click', () => setPreviewPanel(button.dataset.previewPanelButton));
  });
  document.querySelectorAll('[data-preview-document]').forEach(button => {
    button.addEventListener('click', () => {
      setPreviewDocument(button.dataset.previewDocument);
      setPreviewMode('preview');
      showPreviewToast(t('preview.toast.writing'));
    });
  });
  document.querySelectorAll('[data-outline-target]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-outline-target]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      document.querySelector(`#${button.dataset.outlineTarget}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  });

  document.querySelectorAll('[data-preview-action]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.previewAction;
      if (action === 'find') setFindPanel({ open: true });
      if (action === 'settings') openPreviewDrawer('preview-settings-drawer', 'preview.toast.settings');
      if (action === 'export') {
        closePreviewOverlays();
        const menu = document.querySelector('#preview-export-menu');
        if (menu) menu.hidden = false;
        showPreviewToast(t('preview.toast.export'));
      }
      if (action === 'close') closePreviewOverlays();
    });
  });

  document.querySelectorAll('[data-settings-tab]').forEach(button => {
    button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab));
  });
  document.querySelectorAll('[data-export-format]').forEach(button => {
    button.addEventListener('click', () => {
      const format = button.querySelector('small')?.textContent || button.dataset.exportFormat;
      closePreviewOverlays({ keepFind: true });
      showPreviewToast(t('preview.toast.exported', { format }));
    });
  });
  document.querySelectorAll('[data-preview-find]').forEach(button => {
    button.addEventListener('click', () => {
      findMatchIndex = ((findMatchIndex - 1 + Number(button.dataset.previewFind) + 4) % 4) + 1;
      const count = document.querySelector('#preview-find-count');
      if (count) count.textContent = `${findMatchIndex} / 4`;
    });
  });
  document.querySelector('[data-find-toggle]')?.addEventListener('click', () => {
    const row = document.querySelector('[data-find-replace-row]');
    if (row) row.hidden = !row.hidden;
  });
  document.querySelector('[data-find-close]')?.addEventListener('click', () => setFindPanel({ open: false }));
  document.querySelectorAll('[data-find-replace], [data-find-replace-all]').forEach(button => {
    button.addEventListener('click', () => {
      const count = button.matches('[data-find-replace-all]') ? 4 : 1;
      showPreviewToast(t('preview.toast.replaced', { count }));
    });
  });

  document.querySelectorAll('[data-scenario]').forEach(button => {
    button.addEventListener('click', () => runScenario(button.dataset.scenario));
  });
  document.querySelector('[data-scenario-next]')?.addEventListener('click', () => {
    const index = SCENARIOS.indexOf(activeScenario);
    runScenario(SCENARIOS[(index + 1) % SCENARIOS.length]);
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', event => {
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'f') {
      event.preventDefault();
      setFindPanel({ open: true });
    }
    if (modifier && key === 'h') {
      event.preventDefault();
      setFindPanel({ open: true, replace: true });
    }
    if (modifier && event.key === ',') {
      event.preventDefault();
      openPreviewDrawer('preview-settings-drawer', 'preview.toast.settings');
    }
    if (event.key === 'Escape') {
      closePreviewOverlays();
    }
  });
}

initSiteShell();
renderIcons();
initNavigationFeedback();
initButtonFeedback();
initInteractivePreview();
initKeyboardShortcuts();
setPreviewDocument(activeDocument);
setPreviewPanel('files');
applyPreviewTheme();

window.addEventListener('site-language-change', () => {
  setPreviewDocument(activeDocument);
  setPreviewPanel(document.querySelector('[data-preview-panel-button=outline]')?.classList.contains('active') ? 'outline' : 'files');
  selectScenario(activeScenario);
  applyPreviewTheme();
});

export { getLanguage };
