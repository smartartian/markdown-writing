import { initI18n } from './i18n.js';

export function renderIcons() {
  const lucideApi = window.lucide || globalThis.lucide;
  if (lucideApi) lucideApi.createIcons();
}

function initReveal() {
  const elements = [...document.querySelectorAll('.reveal')];
  if (!elements.length) return;
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach(element => element.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -48px' });

  elements.forEach(element => observer.observe(element));
}

function listenForMediaChange(query, listener) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
  } else {
    query.addListener(listener);
  }
}

export function initSiteShell({ solidHeader = false } = {}) {
  initI18n();
  const header = document.querySelector('#site-header');
  const mobileMenuButton = document.querySelector('#mobile-menu-button');
  const mobileNav = document.querySelector('#mobile-nav');

  function updateHeader() {
    header?.classList.toggle('scrolled', solidHeader || window.scrollY > 18);
  }

  function closeMobileMenu({ restoreFocus = false } = {}) {
    mobileMenuButton?.setAttribute('aria-expanded', 'false');
    mobileMenuButton?.setAttribute('aria-label', '打开导航');
    mobileNav?.classList.remove('open');
    document.body.classList.remove('menu-open');
    if (restoreFocus) mobileMenuButton?.focus();
  }

  mobileMenuButton?.addEventListener('click', () => {
    const open = mobileMenuButton.getAttribute('aria-expanded') === 'true';
    mobileMenuButton.setAttribute('aria-expanded', String(!open));
    mobileMenuButton.setAttribute('aria-label', open ? '打开导航' : '关闭导航');
    mobileNav?.classList.toggle('open', !open);
    document.body.classList.toggle('menu-open', !open);
  });

  mobileNav?.addEventListener('click', event => {
    if (event.target.closest('a')) closeMobileMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileMenuButton?.getAttribute('aria-expanded') === 'true') {
      closeMobileMenu({ restoreFocus: true });
    }
  });

  listenForMediaChange(window.matchMedia('(min-width: 821px)'), event => {
    if (event.matches) closeMobileMenu();
  });

  const yearElement = document.querySelector('#copyright-year');
  if (yearElement) yearElement.textContent = `© ${new Date().getFullYear()}`;

  window.addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();
  initReveal();

  return { renderIcons, closeMobileMenu, updateHeader };
}
