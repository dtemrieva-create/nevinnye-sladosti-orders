import {fetchCakes} from './catalog-data.js';

export async function initCatalog(config, selectCake) {
  const grid = document.querySelector('#catalog-grid');
  const status = document.querySelector('#catalog-status');
  document.querySelector('#choose-help').addEventListener('click', () => selectCake({
    id: 'consultation', name: 'Помогите выбрать начинку'
  }));
  function show(cakes) {
    grid.replaceChildren();
    for (const cake of cakes) {
      const article = document.createElement('article');
      article.className = 'cake-card';
      const media = document.createElement('div');
      media.className = 'cake-image';
      const image = document.createElement('img');
      const imageFile = config.catalogImageAliases?.[cake.image] || cake.image;
      image.src = new URL('./catalog/' + encodeURIComponent(imageFile), document.baseURI).href;
      image.alt = cake.name;
      image.loading = 'lazy';
      image.width = 700;
      image.height = 800;
      image.addEventListener('error', () => {
        media.classList.add('image-missing');
        media.textContent = cake.name;
      }, {once: true});
      media.append(image);
      const body = document.createElement('div');
      body.className = 'cake-body';
      const title = document.createElement('h3');
      title.textContent = cake.name;
      const description = document.createElement('p');
      description.textContent = cake.description;
      const bottom = document.createElement('div');
      bottom.className = 'cake-bottom';
      const price = document.createElement('span');
      price.className = 'cake-price';
      price.textContent = 'от ' + new Intl.NumberFormat('ru-RU').format(cake.price) + ' ₽/кг';
      const choose = document.createElement('button');
      choose.className = 'text-link';
      choose.textContent = 'Выбрать';
      choose.addEventListener('click', () => selectCake(cake));
      bottom.append(price, choose);
      body.append(title, description, bottom);
      article.append(media, body);
      grid.append(article);
    }
  }
  if (!config.catalogCsvUrl) {
    status.textContent = 'Начинки скоро появятся. Пока можно обсудить ваш торт с кондитером.';
    return;
  }
  try {
    const cakes = await fetchCakes(config.catalogCsvUrl);
    show(cakes);
    status.hidden = cakes.length > 0;
    if (!cakes.length) status.textContent = 'Список начинок обновляется. Поможем подобрать вкус в переписке.';
  } catch {
    status.textContent = 'Сейчас не удалось загрузить начинки. Можно оставить пожелания, и мы поможем с выбором.';
  }
}
