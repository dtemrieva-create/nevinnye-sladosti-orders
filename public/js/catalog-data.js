export function parseCatalog(csv) {
  const rows = [];
  let row = [], cell = '', quoted = false, afterQuote = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else cell += char;
      continue;
    }
    if (char === '"' && cell === '' && !afterQuote) { quoted = true; continue; }
    if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell.trim()); cell = ''; afterQuote = false;
      if (char !== ',') {
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
        if (char === '\r' && csv[index + 1] === '\n') index++;
      }
      continue;
    }
    if (afterQuote && char.trim()) throw new Error('Некорректные кавычки CSV');
    if (!afterQuote) cell += char;
  }
  if (quoted) throw new Error('Незакрытая кавычка CSV');
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  const headers = rows.shift() || [];
  if (headers[0]) headers[0] = headers[0].replace(/^\uFEFF/, '');
  const required = ['id', 'name', 'description', 'price', 'image', 'available'];
  if (new Set(headers).size !== headers.length || !required.every(name => headers.includes(name))) {
    throw new Error('Проверьте колонки каталога');
  }
  const ids = new Set();
  return rows.flatMap(values => {
    if (values.length !== headers.length) throw new Error('Проверьте строки каталога');
    const entry = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const available = entry.available.toUpperCase();
    // A row without an availability flag is an unpublished draft.
    if (available === '') return [];
    if (!['TRUE', 'FALSE'].includes(available)) throw new Error('Проверьте доступность начинки');
    if (available === 'FALSE') return [];
    const priceText = entry.price.replace(',', '.');
    const price = Number(priceText);
    if (!entry.id || entry.id.length > 80 || ids.has(entry.id) ||
        !entry.name || entry.name.length > 120 ||
        !entry.description || entry.description.length > 1500 ||
        !/^\d+(?:\.\d{1,2})?$/.test(priceText) || !Number.isFinite(price) || price <= 0 ||
        !/^[A-Za-zА-Яа-яЁё0-9_-]+\.(?:webp|avif|jpe?g|png)$/i.test(entry.image)) {
      throw new Error('Проверьте данные начинки ' + entry.id);
    }
    ids.add(entry.id);
    return [{...entry, price, available: true}];
  });
}

export async function fetchCakes(url, transport = fetch) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'docs.google.com' ||
      !target.pathname.startsWith('/spreadsheets/d/e/') ||
      target.searchParams.get('output') !== 'csv') {
    throw new Error('Неверная ссылка каталога');
  }
  const response = await transport(target, {
    credentials: 'omit',
    signal: AbortSignal.timeout(10000),
    cache: 'no-cache'
  });
  if (!response.ok) throw new Error('Каталог временно недоступен');
  const csv = await response.text();
  if (csv.length > 500000) throw new Error('Каталог слишком большой');
  return parseCatalog(csv);
}
