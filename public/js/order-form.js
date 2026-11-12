export function minimumDate(offset = 3, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = name => Number(parts.find(part => part.type === name).value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + offset)).toISOString().slice(0, 10);
}

export function normalizePhone(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return /^7\d{10}$/.test(digits) ? '+' + digits : null;
}

export function initOrderForm(config) {
  const form = document.querySelector('#order-form');
  const steps = [...form.querySelectorAll('[data-step]')];
  const progress = [...document.querySelectorAll('[data-progress]')];
  const status = document.querySelector('#form-status');
  const next = document.querySelector('#next-step');
  const previous = document.querySelector('#previous-step');
  const submit = document.querySelector('#submit-order');
  const success = document.querySelector('#order-success');
  const manualCommand = document.querySelector('#manual-command');
  const copyCommand = document.querySelector('#copy-command');
  copyCommand.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(manualCommand.value);
      copyCommand.textContent = 'Скопировано — отправьте в чат бота';
    } catch {
      manualCommand.focus();
      manualCommand.select();
      copyCommand.textContent = 'Выделите и скопируйте команду';
    }
  });
  const date = form.elements.pickupDate;
  date.min = minimumDate();
  date.max = minimumDate(365);
  let step = 0;
  let selected = null;
  let requestId = crypto.randomUUID();
  let lastPayload = '';
  let pending = false;

  const maxAvailable = Boolean(config.maxBotUsername && config.maxEnabled);
  form.elements.channel.value = 'telegram';
  document.querySelector('#channel-max').disabled = !maxAvailable;

  function summary() {
    const receipt = [
      selected?.name || 'Начинка не выбрана',
      'Вес ' + form.elements.weight.value + ' кг',
      form.elements.pickupDate.value ? 'Получение ' + form.elements.pickupDate.value : ''
    ].filter(Boolean).join('\n');
    document.querySelector('#order-summary').textContent = receipt;
  }
  function showStep(number, focus = true) {
    step = number;
    steps.forEach((fieldset, index) => {
      fieldset.hidden = index !== step;
      fieldset.disabled = index !== step;
      if (index === step) progress[index].setAttribute('aria-current', 'step');
      else progress[index].removeAttribute('aria-current');
    });
    previous.hidden = step === 0;
    next.hidden = step === 2;
    submit.hidden = step !== 2;
    status.textContent = '';
    summary();
    if (focus) {
      const legend = steps[step].querySelector('legend');
      legend.tabIndex = -1;
      legend.focus({preventScroll: true});
    }
  }
  function validateCurrent() {
    if (step === 0 && !selected) {
      status.textContent = 'Выберите начинку в каталоге или нажмите «Мне нужна помощь с выбором».';
      return false;
    }
    date.min = minimumDate();
    if (step === 2) {
      form.elements.phone.setCustomValidity(
        normalizePhone(form.elements.phone.value) ? '' : 'Введите российский номер телефона целиком.'
      );
    }
    for (const control of steps[step].querySelectorAll('input, textarea')) {
      if (!control.reportValidity()) return false;
    }
    return true;
  }
  const selectCake = cake => {
    selected = cake;
    form.elements.filling.value = cake.name;
    success.hidden = true;
    form.hidden = false;
    showStep(0, false);
    document.querySelector('#order').scrollIntoView({behavior: 'smooth', block: 'start'});
    form.elements.filling.focus({preventScroll: true});
  };
  document.querySelector('#form-choose-help').addEventListener('click', () => selectCake({
    id: 'consultation', name: 'Помогите выбрать начинку'
  }));
  next.addEventListener('click', () => {
    if (validateCurrent()) showStep(Math.min(2, step + 1));
  });
  previous.addEventListener('click', () => showStep(Math.max(0, step - 1)));
  form.elements.notes.addEventListener('input', () => {
    document.querySelector('#notes-count').textContent = form.elements.notes.value.length + ' / 1000';
  });
  form.elements.phone.addEventListener('input', () => form.elements.phone.setCustomValidity(''));
  document.querySelector('#back-to-order').addEventListener('click', () => {
    success.hidden = true;
    form.hidden = false;
    showStep(2);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || step !== 2 || !validateCurrent()) return;
    const order = {
      fillingId: selected.id,
      weight: Number(form.elements.weight.value),
      candles: form.elements.candles.value,
      notes: form.elements.notes.value.trim(),
      pickupDate: date.value,
      fulfillment: form.elements.fulfillment.value,
      name: form.elements.name.value.trim(),
      phone: normalizePhone(form.elements.phone.value),
      channel: form.elements.channel.value
    };
    const content = JSON.stringify(order);
    if (lastPayload && content !== lastPayload) requestId = crypto.randomUUID();
    lastPayload = content;
    pending = true;
    submit.disabled = true;
    previous.disabled = true;
    status.textContent = 'Сохраняем заявку…';
    try {
      const response = await fetch(config.createApplicationUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          kind: 'order', order, idempotency_key: requestId,
          website: form.elements.website.value
        }),
        signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok) {
        const messages = {
          invalid_order: result.message || 'Проверьте параметры заказа.',
          rate: 'Слишком много попыток. Попробуйте немного позже.',
          channel_unavailable: 'Этот мессенджер пока подключается. Выберите Telegram.',
          conflict: 'Параметры заявки изменились. Попробуйте ещё раз.'
        };
        if (result.error === 'conflict') requestId = crypto.randomUUID();
        throw new Error(messages[result.error] || 'Не удалось сохранить заявку. Попробуйте ещё раз.');
      }
      const url = new URL(result.confirmation_url);
      const max = order.channel === 'max';
      const expectedHost = max ? 'max.ru' : 't.me';
      const username = max ? config.maxBotUsername : config.botUsername;
      if (url.protocol !== 'https:' || url.hostname !== expectedHost ||
          url.port || url.username || url.password || url.pathname !== '/' + username ||
          url.hash || !/^\?start=[A-Za-z0-9_-]{43}$/.test(url.search)) {
        throw new Error('Не удалось проверить ссылку бота. Позвоните нам для уточнения заявки.');
      }
      if (result.expired) {
        requestId = crypto.randomUUID();
        throw new Error('Срок ссылки истёк. Отправьте форму ещё раз для новой ссылки.');
      }
      form.hidden = true;
      success.hidden = false;
      document.querySelector('#order-receipt').textContent =
        'Заявка №' + result.number + ' сохранена. Подключите ' +
        (max ? 'MAX' : 'Telegram') + ', чтобы получать ответы кондитера.';
      const link = document.querySelector('#confirm-order');
      link.href = url.href;
      link.textContent = 'Подтвердить в ' + (max ? 'MAX' : 'Telegram') + '';
      manualCommand.value = '/start ' + url.searchParams.get('start');
      copyCommand.textContent = 'Скопировать команду';
      document.querySelector('#manual-confirmation').open = false;
      success.focus({preventScroll: true});
    } catch (error) {
      status.textContent = error.name === 'TimeoutError'
        ? 'Ответ задержался. Ваши данные остались в форме. Попробуйте снова.'
        : error.message;
    } finally {
      pending = false;
      submit.disabled = false;
      previous.disabled = false;
    }
  });
  showStep(0, false);
  return selectCake;
}
