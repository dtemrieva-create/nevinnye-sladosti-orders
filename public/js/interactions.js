export function initInteractions(config) {
  const menu = document.querySelector('#menu-toggle');
  const nav = document.querySelector('#navigation');
  function closeMenu() {
    nav.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Открыть меню');
  }
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    nav.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  });
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  if ('IntersectionObserver' in window) {
    const fade = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          fade.unobserve(entry.target);
        }
      }
    }, {threshold: 0.12});
    document.documentElement.classList.add('motion-ready');
    document.querySelectorAll('.reveal').forEach(node => fade.observe(node));
    const sticky = document.querySelector('#mobile-order');
    new IntersectionObserver(entries => {
      sticky.classList.toggle('is-hidden', entries[0].isIntersecting);
    }, {threshold: 0}).observe(document.querySelector('#order'));
  }
  document.querySelector('.footer-year').textContent = '© ' + new Date().getFullYear();
  const telegram = new URL('https://t.me/');
  telegram.pathname = config.botUsername;
  document.querySelector('#telegram-contact').href = telegram.href;
  if (config.maxEnabled && config.maxBotUsername) {
    const max = document.querySelector('#max-contact');
    max.href = config.maxBaseUrl;
    max.hidden = false;
  }
  if (config.heroImage) {
    const image = document.querySelector('#hero-image');
    image.style.backgroundImage = 'url("' + new URL(config.heroImage, document.baseURI).href + '")';
    image.hidden = false;
    document.querySelector('.hero').classList.add('has-image');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && innerWidth > 900) {
      let scheduled = false;
      addEventListener('scroll', () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          if (scrollY < innerHeight) image.style.transform = 'translateY(' + scrollY * .15 + 'px)';
          scheduled = false;
        });
      }, {passive: true});
    }
  }
  for (const [key, imageSelector, fallbackSelector] of [
    ['headerLogo', '[data-brand-logo]', '[data-logo-fallback]'],
    ['footerLogo', '[data-footer-logo]', '[data-footer-fallback]']
  ]) {
    if (!config[key]) continue;
    const image = document.querySelector(imageSelector);
    image.addEventListener('load', () => {
      image.hidden = false;
      document.querySelector(fallbackSelector).hidden = true;
    }, {once: true});
    image.src = config[key];
  }
}
