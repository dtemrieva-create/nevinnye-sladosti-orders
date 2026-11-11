import {fetchCakes} from '../../../public/js/catalog-data.js';

export function moscowDate(offsetDays = 0, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(value => value.type === type).value;
  const date = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + offsetDays));
  return date.toISOString().slice(0, 10);
}

export async function validateOrder(input, catalogUrl, transport = fetch, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Проверьте форму');
  const {name, phone, fillingId, weight, candles, notes, pickupDate, fulfillment, channel} = input;
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80 ||
      typeof phone !== 'string' || !/^\+7\d{10}$/.test(phone) ||
      typeof fillingId !== 'string' || fillingId.length > 80 ||
      typeof weight !== 'number' || weight < 1 || weight > 10 || !Number.isInteger(weight * 2) ||
      !['gold', 'silver', 'none'].includes(candles) ||
      typeof notes !== 'string' || notes.trim().length > 1000 || notes.includes('\u0000') ||
      typeof pickupDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) ||
      new Date(pickupDate + 'T00:00:00Z').toISOString().slice(0, 10) !== pickupDate ||
      pickupDate < moscowDate(3, now) || pickupDate > moscowDate(365, now) ||
      !['pickup', 'delivery'].includes(fulfillment) || !['telegram', 'max'].includes(channel)) {
    throw new Error('Проверьте поля заказа и дату получения');
  }
  let filling = {id: 'consultation', name: 'Помогите выбрать начинку'};
  if (fillingId !== filling.id) {
    const catalog = await fetchCakes(catalogUrl, transport);
    filling = catalog.find(cake => cake.id === fillingId);
    if (!filling) throw new Error('Эта начинка сейчас недоступна');
  }
  const details = {
    fillingId: filling.id, filling: filling.name, weight, candles,
    notes: notes.trim(), pickupDate, fulfillment, channel
  };
  const description = [
    'Начинка: ' + filling.name,
    'Вес: ' + weight + ' кг',
    'Свечи: ' + ({gold: 'Золотые', silver: 'Серебряные', none: 'Без свечей'})[candles],
    'Дата получения: ' + pickupDate,
    'Получение: ' + (fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка, уточнить условия'),
    'Пожелания: ' + (notes.trim() || 'Не указаны')
  ].join('\n');
  return {details, description, name: name.trim(), phone, channel, subject: 'Заказ торта · ' + pickupDate};
}
