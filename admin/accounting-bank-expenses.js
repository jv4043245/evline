const CATEGORIES = {
  igor_china: { title: 'Витрати Ігоря · Китай', subtitle: 'Особисті витрати під час поїздки · оплата карткою Жені' },
  zhenia_alipay: { title: 'Женя · Alipay', subtitle: 'Оплата запчастин для замовлень' },
  zhenia_delivery: { title: 'Женя · доставка', subtitle: 'Оплата доставки Meest China' },
  order_other: { title: 'Інші оплати за замовленнями', subtitle: 'Підтверджені витрати Жені за замовленнями' },
};
const decimal = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat('uk-UA');
const rate = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 6 });
const minor = value => Number.isSafeInteger(value);
const nonnegative = value => minor(value) && value >= 0;
const money = value => minor(value) ? `${decimal.format(value / 100)} грн` : '—';
let instance = 0;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// The statements contain local bank time. Display the recorded date and time
// directly; converting them through Date would move payments across a day.
const dateText = value => validDate(value) ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
const timeText = value => typeof value === 'string' ? value.match(/[T ](\d{2}:\d{2})(?::(\d{2}))?/)?.[0].trim().replace(/^T/, '') || '' : '';
const periodText = (from, to) => `${dateText(from)} — ${dateText(to)}`;
const receiptRow = row => row?.source_kind === 'receipt_image';
const pendingRow = row => receiptRow(row) && row.amount_minor === null && row.uah_status === 'pending';
const originalMoney = (value, currency) => minor(value) && currency ? `${decimal.format(value / 100)} ${currency}` : '—';
const paymentWord = count => count % 10 === 1 && count % 100 !== 11 ? 'оплата' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'оплати' : 'оплат';

function validRow(row, category) {
  if (!row || row.category !== category || typeof row.id !== 'string' || !validDate(row.date) || typeof row.description !== 'string') return false;
  if (!receiptRow(row)) return minor(row.amount_minor) && (row.original_amount_minor === null || row.original_amount_minor === undefined || minor(row.original_amount_minor));
  return row.transaction_at === null && row.time_precision === 'date' &&
    (pendingRow(row) || (row.uah_status === 'confirmed' && minor(row.amount_minor) && row.amount_minor > 0)) &&
    minor(row.original_amount_minor) && row.original_amount_minor > 0 && /^[A-Z]{3}$/.test(row.original_currency) &&
    minor(row.service_original_minor) && row.service_original_minor > 0 && nonnegative(row.fee_original_minor) &&
    row.service_original_minor + row.fee_original_minor === row.original_amount_minor && row.fee_included === true &&
    (row.source_row === null || row.source_row === undefined) && (row.source_sheet === null || row.source_sheet === undefined);
}

function validateResponse(data, category) {
  const summary = data?.summary, page = data?.pagination;
  const pendingCount = summary?.pending_uah_count ?? 0, pendingTotals = summary?.pending_original_totals ?? [];
  if (data?.currency !== 'UAH' || !summary || !page || !Array.isArray(data.rows) ||
      !['count', 'debit_count', 'refund_count', 'debit_minor', 'refund_minor', 'possible_duplicate_count'].every(key => nonnegative(summary[key])) ||
      !minor(summary.net_minor) || summary.net_minor !== summary.debit_minor - summary.refund_minor ||
      summary.debit_count + summary.refund_count > summary.count || summary.possible_duplicate_count > summary.count ||
      !nonnegative(pendingCount) || pendingCount > summary.debit_count || !Array.isArray(pendingTotals) ||
      pendingTotals.some(total => !total || !/^[A-Z]{3}$/.test(total.currency) || !minor(total.amount_minor) || total.amount_minor <= 0 || !minor(total.count) || total.count <= 0) ||
      pendingTotals.reduce((sum, total) => sum + total.count, 0) !== pendingCount ||
      (summary.receipt_count !== undefined && (!nonnegative(summary.receipt_count) || summary.receipt_count > summary.count || summary.receipt_count < pendingCount)) ||
      !nonnegative(page.total_count) || page.total_count !== summary.count || !nonnegative(page.total_pages) ||
      !minor(page.page) || page.page < 1 || !minor(page.page_size) || page.page_size < 1 || data.rows.length > page.page_size ||
      (page.total_pages > 0 && page.page > page.total_pages) ||
      data.rows.some(row => !validRow(row, category)) || data.rows.filter(pendingRow).length > pendingCount ||
      (summary.receipt_count !== undefined && data.rows.filter(receiptRow).length > summary.receipt_count)) {
    throw new Error('invalid_bank_expenses_response');
  }
  return data;
}

const markup = `
  <div class="accounting-bank__heading"><div><h1 data-bank-title></h1><p data-bank-subtitle></p></div><span class="accounting-bank__source" data-bank-source>Банківські виписки</span></div>
  <p class="accounting-bank__scope" data-bank-scope></p>
  <section class="accounting-bank__summary" aria-label="Підсумки всіх операцій за вибраними умовами">
    <div class="accounting-bank__metric accounting-bank__metric--net"><span data-bank-net-label>Витрати після повернень</span><strong data-bank-net>—</strong><small data-bank-net-note>Усі операції за вибраними умовами</small></div>
    <div class="accounting-bank__metric"><span>Списання</span><strong data-bank-debit>—</strong><small data-bank-debit-count></small></div>
    <div class="accounting-bank__metric"><span>Повернення</span><strong data-bank-refund>—</strong><small data-bank-refund-count></small></div>
    <div class="accounting-bank__metric"><span>Операцій</span><strong data-bank-count>—</strong><small data-bank-duplicates></small></div>
  </section>
  <aside class="accounting-bank__pending" data-bank-pending role="note" hidden><strong data-bank-pending-title></strong><span data-bank-pending-original></span><small>Не перераховано до гривень і не включено до гривневого підсумку.</small></aside>
  <section class="accounting-bank__panel" aria-label="Реєстр банківських оплат">
    <form class="accounting-bank__filters" data-bank-form novalidate>
      <label>Від<input name="from" type="date" aria-label="Оплати від дати"></label><label>До<input name="to" type="date" aria-label="Оплати до дати"></label>
      <label class="accounting-bank__search">Пошук отримувача<input name="q" type="search" maxlength="160" autocomplete="off" placeholder="Назва або опис платежу"></label>
      <div class="accounting-bank__filter-actions"><button class="admin-btn admin-btn--small" type="submit">Застосувати</button><button class="accounting-bank__reset" type="button" data-bank-reset>Усі оплати</button></div>
    </form>
    <div class="accounting-bank__list-heading"><h2>Оплати</h2><p data-bank-period>Усі дати</p></div>
    <div class="accounting-bank__feedback"><p data-bank-message role="status" aria-live="polite"></p><button class="admin-btn admin-btn--small" type="button" data-bank-retry hidden>Спробувати ще</button></div>
    <div class="accounting-bank__table-wrap" data-bank-list aria-busy="false"><table class="orders-table accounting-bank__table"><caption class="visually-hidden">Дата, отримувач і суми банківських оплат</caption><thead><tr><th scope="col">Дата й час</th><th scope="col">Отримувач</th><th scope="col">Сума, грн</th><th scope="col">Валюта операції</th><th scope="col"><span class="visually-hidden">Деталі</span></th></tr></thead><tbody data-bank-rows></tbody></table></div>
    <nav class="accounting-bank__pagination" aria-label="Сторінки оплат"><p data-bank-page-info></p><div><button class="admin-btn admin-btn--small" type="button" data-bank-prev disabled>← Назад</button><span data-bank-page></span><button class="admin-btn admin-btn--small" type="button" data-bank-next disabled>Далі →</button></div></nav>
  </section>
  <p class="accounting-bank__footnote" data-bank-footnote>Суми в гривнях — фактичні списання з картки. Повернення зменшують витрати. Час наведено як у виписці. Джерело та пояснення — у деталях кожного платежу.</p>`;

export function createAccountingBankExpensesView(container, api, { category, title, subtitle } = {}) {
  const noop = { load: async () => false, hide() {}, hasChanges: () => false, isDirty: () => false, isBusy: () => false, canLeave: () => true };
  if (!container || !Object.hasOwn(CATEGORIES, category) || typeof api !== 'function') return noop;
  const document = container.ownerDocument, window = document.defaultView, prefix = `bank-expenses-${++instance}`;
  container.classList.add('accounting-bank'); container.innerHTML = markup;
  const find = selector => container.querySelector(selector), form = find('[data-bank-form]');
  find('[data-bank-title]').textContent = title || CATEGORIES[category].title;
  find('[data-bank-subtitle]').textContent = subtitle || CATEGORIES[category].subtitle;
  let filters = { from: '', to: '', q: '', page: 1 }, data = null, pending = null, loadedKey = '', sequence = 0, debounce = null, busy = false;
  const requestKey = () => JSON.stringify(filters);
  const notify = (text = '', error = false) => {
    find('[data-bank-message]').textContent = text; find('[data-bank-message]').dataset.error = String(error);
    find('[data-bank-retry]').hidden = !error;
  };
  const setBusy = value => {
    busy = value; find('[data-bank-list]').setAttribute('aria-busy', String(value));
    find('[data-bank-prev]').disabled = value || !data || data.pagination.page <= 1;
    find('[data-bank-next]').disabled = value || !data || data.pagination.page >= data.pagination.total_pages;
    find('[data-bank-retry]').disabled = value;
  };
  const clearDebounce = () => { if (debounce !== null) window.clearTimeout(debounce); debounce = null; };
  const abortPending = () => { sequence += 1; pending?.controller.abort(); pending = null; };
  const element = (tag, text, className) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; return node;
  };
  function renderPlaceholder(text) {
    const body = find('[data-bank-rows]'), row = element('tr'), cell = element('td', text, 'accounting-bank__empty');
    cell.colSpan = 5; row.append(cell); body.replaceChildren(row);
  }
  function clearResults(text) {
    for (const name of ['net', 'debit', 'refund', 'count']) find(`[data-bank-${name}]`).textContent = '—';
    for (const name of ['debit-count', 'refund-count', 'duplicates', 'page', 'page-info']) find(`[data-bank-${name}]`).textContent = '';
    find('[data-bank-pending]').hidden = true;
    renderPlaceholder(text);
  }
  function periodLabel() {
    const dates = filters.from && filters.to ? periodText(filters.from, filters.to) : filters.from ? `Від ${dateText(filters.from)}` : filters.to ? `До ${dateText(filters.to)}` : 'Усі дати';
    return `${dates}${filters.q ? ` · «${filters.q}»` : ''}`;
  }
  function detailList(row) {
    const list = element('dl', undefined, 'accounting-bank__details-grid');
    function add(label, value, wide = false) {
      if (value === null || value === undefined || value === '') return;
      const item = element('div'); if (wide) item.className = 'accounting-bank__detail-wide';
      item.append(element('dt', label), element('dd', String(value))); list.append(item);
    }
    const receipt = receiptRow(row);
    if (receipt) add('Джерело оплати', 'Квитанція · зображення');
    add(receipt ? 'Опис квитанції' : 'Опис у виписці', row.description, true);
    add('Призначення', row.classification_note, true);
    add('Платник', row.payer === 'zhenia' ? 'Женя' : row.payer);
    add('На кого віднесено', row.beneficiary === 'igor' ? 'Ігор · поїздка до Китаю' : row.beneficiary === 'evline' ? 'EVLine · замовлення' : row.beneficiary);
    add(receipt ? 'Дата оплати' : 'Дата й час у виписці', `${dateText(row.date)}${timeText(row.transaction_at) ? ` ${timeText(row.transaction_at)}` : ''}`);
    if (receipt) {
      add('Час оплати', 'Не зазначено');
      if (row.date_basis === 'user_confirmation') add('Джерело дати', 'Дата підтверджена власником картки');
      else if (row.date_basis === 'receipt_image') add('Джерело дати', 'Дата зазначена у квитанції');
      add('Сума у гривнях', pendingRow(row) ? 'Очікується підтвердження фактичного списання' : money(row.amount_minor));
      add('Послуга доставки', originalMoney(row.service_original_minor, row.original_currency));
      add('Комісія', originalMoney(row.fee_original_minor, row.original_currency));
      add('Сплачено разом, включно з комісією', originalMoney(row.original_amount_minor, row.original_currency));
      add('Облік комісії', 'Комісію вже включено до загальної суми квитанції.', true);
    }
    add('Тип операції', row.amount_minor < 0 ? 'Повернення коштів' : 'Списання');
    if (row.bank_rate !== null && row.bank_rate !== undefined && Number.isFinite(Number(row.bank_rate))) add('Курс у виписці', rate.format(Number(row.bank_rate)));
    if (row.derived_rate !== null && row.derived_rate !== undefined && Number.isFinite(Number(row.derived_rate))) add('Фактичний курс, грн / од. валюти', rate.format(Number(row.derived_rate)));
    add('MCC', row.mcc);
    add(receipt ? 'Файл квитанції' : 'Файл виписки', row.source_filename, true);
    if (receipt) {
      if (/^[a-f0-9]{64}$/.test(row.source_id)) add('SHA-256 квитанції', row.source_id, true);
      if (row.confirmation_source_kind === 'bank_screenshot') add('Підтвердження гривневої суми', 'Банківський знімок');
      else if (row.confirmation_source_kind === 'owner_confirmation') add('Підтвердження гривневої суми', 'Власник картки');
      add('Файл підтвердження', row.confirmation_source_filename, true);
      add('Пояснення підтвердження', row.confirmation_note, true);
      if (/^[a-f0-9]{64}$/.test(row.confirmation_source_id)) add('SHA-256 підтвердження', row.confirmation_source_id, true);
    }
    if (!receipt) { add('Аркуш', row.source_sheet); add('Рядок у джерелі', row.source_row); }
    if (row.possible_duplicate) add('Перевірка', 'Схожий платіж: включено до суми, потрібне звіряння.', true);
    return list;
  }
  function renderRows() {
    const body = find('[data-bank-rows]'); body.replaceChildren();
    if (!data.rows.length) { renderPlaceholder('За вибраними умовами оплат немає.'); return; }
    for (const [index, payment] of data.rows.entries()) {
      const row = element('tr', undefined, 'accounting-bank__row'); row.dataset.bankRow = payment.id;
      const date = element('td', undefined, 'accounting-bank__date');
      date.append(element('span', dateText(payment.date)));
      if (timeText(payment.transaction_at)) date.append(element('small', timeText(payment.transaction_at)));
      else if (receiptRow(payment)) date.append(element('small', 'Час не зазначено'));
      const recipient = element('th', undefined, 'accounting-bank__recipient'); recipient.scope = 'row'; recipient.append(element('strong', payment.description));
      if (receiptRow(payment)) recipient.append(element('span', 'Квитанція', 'accounting-bank__badge accounting-bank__badge--receipt'));
      if (payment.amount_minor < 0) recipient.append(element('span', 'Повернення', 'accounting-bank__badge accounting-bank__badge--refund'));
      if (payment.possible_duplicate) recipient.append(element('span', 'Схожий платіж', 'accounting-bank__badge accounting-bank__badge--review'));
      const amount = element('td', pendingRow(payment) ? 'Очікується сума в гривнях' : decimal.format(payment.amount_minor / 100), 'accounting-bank__amount'); amount.dataset.label = 'Сума, грн';
      if (pendingRow(payment)) amount.classList.add('accounting-bank__amount--pending');
      if (payment.amount_minor < 0) amount.classList.add('accounting-bank__amount--refund');
      const original = element('td', undefined, 'accounting-bank__original'); original.dataset.label = 'Валюта операції';
      original.textContent = originalMoney(payment.original_amount_minor, payment.original_currency);
      const control = element('td', undefined, 'accounting-bank__control'), toggle = element('button', 'Деталі', 'accounting-bank__detail-toggle');
      toggle.type = 'button'; toggle.dataset.bankDetails = ''; toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', `Деталі платежу: ${payment.description}, ${dateText(payment.date)}`);
      toggle.setAttribute('aria-controls', `${prefix}-detail-${index}`); control.append(toggle);
      row.append(date, recipient, amount, original, control);
      const details = element('tr', undefined, 'accounting-bank__details-row'); details.hidden = true; details.id = `${prefix}-detail-${index}`;
      const cell = element('td'); cell.colSpan = 5; cell.append(detailList(payment)); details.append(cell);
      body.append(row, details);
    }
  }
  function render() {
    const summary = data.summary, pagination = data.pagination;
    const pendingCount = summary.pending_uah_count || 0, hasReceipts = Boolean(summary.receipt_count || pendingCount || data.rows.some(receiptRow));
    find('[data-bank-net-label]').textContent = pendingCount ? 'Підтверджено в гривнях' : 'Витрати після повернень';
    find('[data-bank-net-note]').textContent = pendingCount ? 'Після повернень · оплати без гривневої суми окремо' : 'Усі операції за вибраними умовами';
    find('[data-bank-net]').textContent = pendingCount && summary.count === pendingCount ? '—' : money(summary.net_minor);
    find('[data-bank-debit]').textContent = pendingCount && summary.debit_count === pendingCount ? '—' : money(summary.debit_minor);
    find('[data-bank-refund]').textContent = money(summary.refund_minor);
    find('[data-bank-count]').textContent = whole.format(summary.count);
    find('[data-bank-debit-count]').textContent = pendingCount ? `У гривнях: ${whole.format(summary.debit_count - pendingCount)} · очікує: ${whole.format(pendingCount)}` : `Операцій: ${whole.format(summary.debit_count)}`;
    find('[data-bank-refund-count]').textContent = `Операцій: ${whole.format(summary.refund_count)}`;
    find('[data-bank-duplicates]').textContent = summary.possible_duplicate_count ? `Схожих платежів: ${whole.format(summary.possible_duplicate_count)}` : 'За вибраними умовами';
    find('[data-bank-period]').textContent = periodLabel();
    find('[data-bank-source]').textContent = hasReceipts ? 'Банківські виписки та квитанції' : 'Банківські виписки';
    find('[data-bank-pending]').hidden = !pendingCount;
    find('[data-bank-pending-title]').textContent = pendingCount ? `${whole.format(pendingCount)} ${paymentWord(pendingCount)} ${paymentWord(pendingCount) === 'оплата' ? 'очікує' : 'очікують'} суми в гривнях` : '';
    find('[data-bank-pending-original]').textContent = (summary.pending_original_totals || []).map(total => originalMoney(total.amount_minor, total.currency)).join(' · ');
    find('[data-bank-footnote]').textContent = hasReceipts ? 'Суми в гривнях — підтверджені списання з картки. Повернення зменшують витрати. Для квитанцій час показано лише за наявності. Джерело та пояснення — у деталях кожного платежу.' : 'Суми в гривнях — фактичні списання з картки. Повернення зменшують витрати. Час наведено як у виписці. Джерело та пояснення — у деталях кожного платежу.';
    const coverage = validDate(data.coverage?.from) && validDate(data.coverage?.to) ? `${hasReceipts ? 'Джерела' : 'Виписки'}: ${periodText(data.coverage.from, data.coverage.to)}` : '';
    const trip = category === 'igor_china' && validDate(data.trip?.from) && validDate(data.trip?.to) ? `Поїздка: ${periodText(data.trip.from, data.trip.to)} включно` : '';
    find('[data-bank-scope]').textContent = [trip, coverage].filter(Boolean).join(' · ');
    renderRows();
    const start = summary.count ? (pagination.page - 1) * pagination.page_size + 1 : 0;
    const end = summary.count ? start + data.rows.length - 1 : 0;
    find('[data-bank-page-info]').textContent = `Показано ${whole.format(start)}–${whole.format(end)} із ${whole.format(summary.count)} операцій`;
    find('[data-bank-page]').textContent = summary.count ? `${pagination.page} / ${pagination.total_pages}` : '';
  }
  async function load({ force = false } = {}) {
    clearDebounce();
    const key = requestKey();
    if (!force && pending?.key === key) return pending.promise;
    if (!force && loadedKey === key && data) { render(); notify(); setBusy(false); return true; }
    abortPending(); const requestSequence = sequence;
    const controller = new window.AbortController();
    const query = new URLSearchParams({ category, page: String(filters.page), page_size: '25' });
    for (const field of ['from', 'to', 'q']) if (filters[field]) query.set(field, filters[field]);
    data = null; clearResults('Завантаження оплат…'); find('[data-bank-period]').textContent = periodLabel();
    setBusy(true); notify('Завантаження…');
    const promise = Promise.resolve().then(() => api(`/api/admin/accounting/bank-expenses?${query}`, { signal: controller.signal })).then(result => {
      if (requestSequence !== sequence) return false;
      data = validateResponse(result, category); loadedKey = key; filters.page = data.pagination.page;
      render(); notify(); return true;
    }).catch(error => {
      if (requestSequence !== sequence || error?.name === 'AbortError') return false;
      data = null; loadedKey = ''; clearResults('Оплати не завантажено.');
      notify(error?.status === 401 ? 'Увійдіть, щоб переглянути бухгалтерію.' : 'Не вдалося завантажити оплати. Спробуйте ще раз.', true);
      if (error?.status === 401) throw error;
      return false;
    }).finally(() => { if (requestSequence === sequence) { pending = null; setBusy(false); } });
    pending = { key, promise, controller }; return promise;
  }
  function applyFilters() {
    clearDebounce();
    const from = form.elements.from.value, to = form.elements.to.value, q = form.elements.q.value.trim();
    if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
      abortPending(); setBusy(false);
      notify('Перевірте дати: початкова дата має бути не пізніше кінцевої.', true); return;
    }
    filters = { from, to, q, page: 1 }; load().catch(() => {});
  }
  form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
  form.elements.q.addEventListener('input', () => {
    clearDebounce(); debounce = window.setTimeout(applyFilters, 300);
  });
  find('[data-bank-reset]').addEventListener('click', () => { form.reset(); filters = { from: '', to: '', q: '', page: 1 }; load().catch(() => {}); });
  find('[data-bank-retry]').addEventListener('click', () => { load({ force: true }).catch(() => {}); });
  find('[data-bank-prev]').addEventListener('click', () => { if (!busy && data?.pagination.page > 1) { filters.page -= 1; load().catch(() => {}); } });
  find('[data-bank-next]').addEventListener('click', () => { if (!busy && data?.pagination.page < data?.pagination.total_pages) { filters.page += 1; load().catch(() => {}); } });
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-bank-details]'); if (!button || !container.contains(button)) return;
    const details = document.getElementById(button.getAttribute('aria-controls')); if (!details) return;
    details.hidden = !details.hidden; button.setAttribute('aria-expanded', String(!details.hidden)); button.textContent = details.hidden ? 'Деталі' : 'Згорнути';
  });
  clearResults('Оплати ще не завантажено.');
  return {
    load,
    hide() { clearDebounce(); abortPending(); setBusy(false); },
    hasChanges: () => false, isDirty: () => false, isBusy: () => busy, canLeave: () => true,
  };
}
