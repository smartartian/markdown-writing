const header = document.querySelector('#site-header');
const mobileMenuButton = document.querySelector('#mobile-menu-button');
const mobileNav = document.querySelector('#mobile-nav');

function renderIcons() {
  const lucideApi = window.lucide || globalThis.lucide;
  if (lucideApi) {
    lucideApi.createIcons();
  }
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

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('visible');
    observer.unobserve(entry.target);
  }
}, { threshold: 0.12, rootMargin: '0px 0px -48px' });

document.querySelectorAll('.reveal').forEach(element => observer.observe(element));

const yearElement = document.querySelector('#copyright-year');
if (yearElement) {
  yearElement.textContent = `© ${new Date().getFullYear()}`;
}

window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();
renderIcons();
