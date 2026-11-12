function localImage(path, folder) {
  if (typeof path !== 'string' || !/^[A-Za-zА-Яа-яЁё0-9_-]+\.(?:webp|avif|jpe?g|png)$/i.test(path)) {
    return null;
  }
  return new URL('./' + folder + '/' + encodeURIComponent(path), document.baseURI).href;
}

export async function initMedia(config) {
  const gallery = document.querySelector('#gallery-grid');
  for (const item of config.gallery || []) {
    const src = localImage(item.file, 'gallery');
    if (!src) continue;
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = src;
    image.alt = item.alt || 'Торт «Невинные сладости»';
    image.loading = 'lazy';
    figure.append(image);
    gallery.append(figure);
  }
  document.querySelector('#gallery').hidden = gallery.children.length === 0;
  if (config.pinterestUrl) {
    const url = new URL(config.pinterestUrl);
    if (url.protocol === 'https:' && (url.hostname === 'pin.it' || /(^|\.)pinterest\.(com|ru)$/.test(url.hostname))) {
      const link = document.querySelector('#pinterest-link');
      link.href = url.href;
      link.hidden = false;
      document.querySelector('#gallery').hidden = false;
    }
  }
  const slides = document.querySelector('#reviews-slides');
  for (const item of config.reviews || []) {
    const src = localImage(item.file, 'reviews');
    if (!src) continue;
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    const image = document.createElement('img');
    image.src = src;
    image.alt = item.alt || 'Отзыв заказчика';
    image.loading = 'lazy';
    const full = document.createElement('a');
    full.href = src;
    full.target = '_blank';
    full.rel = 'noopener';
    full.setAttribute('aria-label', 'Открыть отзыв целиком');
    full.append(image);
    slide.append(full);
    slides.append(slide);
  }
  if (!slides.children.length) return;
  document.querySelector('#reviews-empty').hidden = true;
  document.querySelector('#reviews-carousel').hidden = false;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './vendor/swiper-bundle.min.css';
  document.head.append(css);
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/swiper-bundle.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  });
  new window.Swiper('#reviews-carousel', {
    slidesPerView: 1, spaceBetween: 24,
    breakpoints: {700: {slidesPerView: 2}, 1050: {slidesPerView: 3}},
    navigation: {prevEl: '.review-previous', nextEl: '.review-next'},
    pagination: {el: '.swiper-pagination', clickable: true},
    keyboard: {enabled: true},
    a11y: {prevSlideMessage: 'Предыдущий отзыв', nextSlideMessage: 'Следующий отзыв'}
  });
}
