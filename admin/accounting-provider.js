import { accountingMonths, accountingPeriod } from './accounting.js';

const PROVIDERS = {
  google: { title: 'Google Ads', account: '4028488894', scope: 'account' },
  meta: { title: 'Facebook · Instagram', account: '1354524650161143', scope: 'campaign', sourceRef: 'evline_campaign_120251518463770454' },
};
const KINDS = { native_export: 'Оригінал', sync_payload: 'Синхронізація', derived: 'Зведений звіт' };
const MAX_BYTES = 8 * 1024 * 1024;
const money = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fullDate = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const monthDate = new Intl.DateTimeFormat('uk-UA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const timestamp = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
const amountKnown = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const dateValue = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};
const periodText = (from, to) => `${fullDate.format(dateValue(from))} — ${fullDate.format(dateValue(to))}`;
const safeFilename = value => String(value || 'report').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').slice(0, 180) || 'report';

export function validateAccountingReportFile(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES) return 'Оберіть файл до 8 МБ.';
  if (!/\.(csv|json|xlsx|pdf)$/i.test(file.name || '')) return 'Доступні CSV, JSON, XLSX та PDF.';
  return '';
}

// The server enforces access and business scope. This guard also prevents a bad
// list response from presenting another account/campaign as an EVLine original.
export function validAccountingArchiveFile(file, provider) {
  const expected = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null;
  return Boolean(expected && file && file.provider === provider && file.account_id === expected.account && file.scope === expected.scope &&
    (provider !== 'meta' || file.source_ref === expected.sourceRef) &&
    typeof file.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(file.id) && Object.hasOwn(KINDS, file.source_kind) &&
    typeof file.filename === 'string' && !validateAccountingReportFile({ name: file.filename, size: file.bytes }) &&
    dateValue(file.date_from) && dateValue(file.date_to) && file.date_from <= file.date_to);
}

const markup = `
  <button class="accounting-provider__back" type="button" data-provider-back>← Реклама</button>
  <div class="accounting-provider__heading"><div><h1 data-provider-title></h1><p data-provider-period></p></div>
    <div class="accounting-segmented" role="group" aria-label="Групування витрат джерела"><button type="button" data-provider-granularity="months" aria-pressed="true">Місяці</button><button type="button" data-provider-granularity="days" aria-pressed="false">Дні</button></div></div>
  <p class="accounting-provider__message" data-provider-message role="status" aria-live="polite"></p>
  <section class="accounting-provider__summary" aria-label="Витрати за вибраний період"><span>Витрати</span><strong data-provider-total>—</strong><small data-provider-coverage></small></section>
  <section class="accounting-provider__panel"><div class="accounting-provider__panel-heading"><h2 data-provider-table-title>За місяцями</h2></div>
    <div class="accounting-provider__table-wrap" tabindex="0" role="region" aria-label="Витрати на рекламу"><table class="orders-table accounting-provider__table"><thead><tr><th scope="col" data-provider-date-title>Місяць</th><th scope="col">Витрати, грн</th></tr></thead><tbody data-provider-rows></tbody></table></div></section>
  <section class="accounting-provider__panel accounting-provider__archive" aria-label="Архів рекламних звітів"><div class="accounting-provider__panel-heading"><h2>Файли</h2></div>
    <p class="accounting-provider__message" data-provider-files-message role="status" aria-live="polite"></p><div data-provider-files></div><button class="admin-btn admin-btn--small accounting-provider__more" type="button" data-provider-more hidden>Показати ще</button>
    <details class="accounting-provider__upload" data-provider-upload><summary>Додати файл</summary><form data-provider-form novalidate>
      <label class="accounting-provider__file">Файл<input type="file" name="file" accept=".csv,.json,.xlsx,.pdf" required><small>CSV, JSON, XLSX, PDF · до 8 МБ</small></label>
      <div class="accounting-provider__fields"><label>Від<input type="date" name="date_from" required></label><label>До<input type="date" name="date_to" required></label><label>Тип<select name="source_kind"><option value="native_export">Оригінал експорту</option><option value="derived">Зведений звіт</option></select></label></div>
      <label class="accounting-provider__confirm"><input type="checkbox" name="scope_confirmed" required>Лише реклама EVLine</label><div class="accounting-provider__upload-footer"><small>Файли не змінюють витрати.</small><button type="submit" class="admin-btn admin-btn--primary" data-provider-save>Зберегти файл</button></div><p class="accounting-provider__message" data-provider-upload-message role="status" aria-live="polite"></p>
    </form></details></section>`;

export function createAccountingProviderView(root, { api, request, onBack = () => {}, getRange = () => 'all', now = () => new Date(), confirmDiscard } = {}) {
  if (!root) return { load: async () => false, canLeave: () => true, hasChanges: () => false, isBusy: () => false, getProvider: () => null };
  root.classList.add('accounting-provider'); root.innerHTML = markup;
  const document = root.ownerDocument, window = document.defaultView;
  const ask = confirmDiscard || (text => window.confirm(text));
  const find = selector => root.querySelector(selector);
  const form = find('[data-provider-form]'), fileInput = form.elements.namedItem('file');
  let provider = null, ledger = null, files = [], nextCursor = null, generation = 0, listSequence = 0;
  let pending = null, listBusy = false, actionBusy = false;
  const hasChanges = () => Boolean(fileInput.files?.length);
  const isBusy = () => actionBusy;
  const notify = (selector, text = '', error = false) => { const node = find(selector); node.textContent = text; node.dataset.error = String(error); };
  const resetUpload = () => { form.reset(); if (ledger) { form.elements.date_from.value = ledger.from; form.elements.date_to.value = ledger.to; } notify('[data-provider-upload-message]'); };
  const canLeave = () => {
    if (actionBusy) return false;
    if (hasChanges() && !ask('Незбережений файл буде втрачено. Продовжити?')) return false;
    if (hasChanges()) resetUpload();
    return true;
  };
  const syncControls = () => {
    for (const node of form.elements) node.disabled = actionBusy || !ledger;
    find('[data-provider-back]').disabled = actionBusy;
    find('[data-provider-more]').disabled = listBusy || actionBusy;
    root.querySelectorAll('[data-provider-download]').forEach(node => { node.disabled = actionBusy; });
    form.setAttribute('aria-busy', String(actionBusy));
  };
  function renderLedger() {
    const mode = find('[data-provider-granularity="days"]').getAttribute('aria-pressed') === 'true' ? 'days' : 'months';
    const source = ledger?.sources?.[provider] || {}, status = source.status;
    const total = ledger?.totals?.[`${provider}_uah`];
    find('[data-provider-total]').textContent = ['complete', 'partial'].includes(status) && amountKnown(total) ? money.format(total) : '—';
    let coverage = !ledger ? '' : status === 'complete' ? 'Дані повні' : status === 'partial' ? 'Неповні дані' : 'Немає даних';
    if (ledger && provider === 'meta') coverage = `${coverage} · лише EVLine`;
    if (source.last_error) coverage += ' · не вдалося оновити';
    find('[data-provider-coverage]').textContent = coverage;
    find('[data-provider-table-title]').textContent = mode === 'days' ? 'За днями' : 'За місяцями';
    find('[data-provider-date-title]').textContent = mode === 'days' ? 'Дата' : 'Місяць';
    const tbody = find('[data-provider-rows]'); tbody.replaceChildren();
    const rows = !ledger ? [] : mode === 'days' ? ledger.daily || [] : ledger.monthly || accountingMonths(ledger.daily, ledger);
    for (const item of rows.slice().filter(item => dateValue(mode === 'days' ? item.date : `${item.month}-01`)).sort((a, b) => (b.date || b.month).localeCompare(a.date || a.month))) {
      const row = document.createElement('tr'), date = document.createElement('th'), cost = document.createElement('td');
      date.scope = 'row'; date.textContent = (mode === 'days' ? fullDate : monthDate).format(dateValue(mode === 'days' ? item.date : `${item.month}-01`));
      if (mode === 'months' && dateValue(item.from) && dateValue(item.to)) {
        const monthEnd = new Date(Date.UTC(Number(item.month.slice(0, 4)), Number(item.month.slice(5)), 0)).toISOString().slice(0, 10);
        if (item.from !== `${item.month}-01` || item.to !== monthEnd) { const note = document.createElement('small'); note.textContent = periodText(item.from, item.to); date.append(note); }
      }
      const value = item[`${provider}_uah`], coverage = item[`${provider}_coverage`];
      cost.textContent = amountKnown(value) && ['complete', 'partial'].includes(coverage) ? decimal.format(value) : '—';
      if (coverage === 'partial' && amountKnown(value)) { const note = document.createElement('small'); note.textContent = 'Неповні дані'; cost.append(note); }
      row.append(date, cost); tbody.append(row);
    }
    if (!tbody.children.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 2; cell.className = 'accounting-provider__empty'; cell.textContent = ledger ? 'За цей період даних немає.' : 'Дані ще не завантажено.'; row.append(cell); tbody.append(row); }
  }
  function renderFiles() {
    const mount = find('[data-provider-files]'); mount.replaceChildren();
    for (const file of files) {
      const row = document.createElement('article'), info = document.createElement('div'), title = document.createElement('strong'), meta = document.createElement('small'), dates = document.createElement('small'), button = document.createElement('button');
      row.className = 'accounting-provider__file-row'; title.textContent = file.filename;
      const created = new Date(file.created_at);
      meta.textContent = `${KINDS[file.source_kind]} · ${Math.ceil(file.bytes / 1024)} КБ${Number.isFinite(created.getTime()) ? ` · ${timestamp.format(created)}` : ''}`;
      dates.textContent = periodText(file.date_from, file.date_to); info.append(title, meta, dates);
      button.type = 'button'; button.className = 'admin-btn admin-btn--small'; button.textContent = 'Завантажити'; button.dataset.providerDownload = file.id; button.setAttribute('aria-label', `Завантажити ${file.filename}`);
      row.append(info, button); mount.append(row);
    }
    find('[data-provider-more]').hidden = !nextCursor;
    syncControls();
  }
  async function loadFiles({ append = false, requestGeneration = generation } = {}) {
    if (!ledger || (append && (!nextCursor || listBusy))) return;
    const listRequest = ++listSequence;
    const currentProvider = provider, params = new URLSearchParams({ provider, from: ledger.from, to: ledger.to });
    if (append) params.set('cursor', nextCursor);
    listBusy = true; syncControls(); notify('[data-provider-files-message]', 'Завантаження…');
    try {
      const data = await api(`/api/admin/accounting/reports?${params}`);
      if (generation !== requestGeneration || currentProvider !== provider || listRequest !== listSequence) return;
      if (!Array.isArray(data?.files) || (data.next_cursor !== null && data.next_cursor !== undefined && (typeof data.next_cursor !== 'string' || data.next_cursor.length > 1024))) throw new Error('invalid_archive_response');
      const accepted = data.files.filter(file => validAccountingArchiveFile(file, provider));
      files = [...new Map([...(append ? files : []), ...accepted].map(file => [file.id, file])).values()];
      nextCursor = data.next_cursor || null; renderFiles();
      notify('[data-provider-files-message]', accepted.length !== data.files.length ? 'Частину файлів не показано: перевірте джерело.' : files.length ? '' : 'Файлів за цей період ще немає.', accepted.length !== data.files.length);
    } catch (error) {
      if (generation !== requestGeneration || listRequest !== listSequence) return;
      notify('[data-provider-files-message]', error.status === 401 ? 'Увійдіть, щоб переглянути файли.' : 'Не вдалося завантажити файли. Натисніть «Оновити».', true);
      if (error.status === 401) throw error;
    } finally { if (generation === requestGeneration && listRequest === listSequence) { listBusy = false; syncControls(); } }
  }
  async function load({ provider: nextProvider = provider, range: nextRange = getRange() } = {}) {
    if (!Object.hasOwn(PROVIDERS, nextProvider)) return false;
    const period = accountingPeriod(nextRange, now()), key = `${nextProvider}/${JSON.stringify(period)}`;
    if (pending?.key === key) return pending.promise;
    if (!canLeave()) return false;
    const requestGeneration = ++generation;
    provider = nextProvider; ledger = null; files = []; nextCursor = null; listBusy = false;
    resetUpload(); find('[data-provider-title]').textContent = PROVIDERS[provider].title;
    find('[data-provider-period]').textContent = period.from ? `${periodText(period.from, period.to)} · Київ` : `Весь час — ${fullDate.format(dateValue(period.to))} · Київ`;
    renderLedger(); renderFiles(); notify('[data-provider-files-message]'); notify('[data-provider-message]', 'Завантаження…');
    const task = Promise.resolve().then(() => api(`/api/admin/accounting?${new URLSearchParams(period)}`)).then(async data => {
      if (generation !== requestGeneration) return false;
      if (!dateValue(data?.from) || !dateValue(data?.to) || data.from > data.to || data.currency !== 'UAH' || !Array.isArray(data.daily)) throw new Error('invalid_accounting_response');
      ledger = data; resetUpload(); renderLedger(); syncControls();
      find('[data-provider-period]').textContent = `${periodText(data.from, data.to)} · Київ${data.range_limited ? ' · Останні 5 років' : ''}`;
      notify('[data-provider-message]'); await loadFiles({ requestGeneration }); return true;
    }).catch(error => {
      if (generation !== requestGeneration) return false;
      notify('[data-provider-message]', error.status === 401 ? 'Увійдіть, щоб переглянути бухгалтерію.' : 'Не вдалося завантажити. Натисніть «Оновити».', true);
      if (error.status === 401) throw error;
      return false;
    }).finally(() => { if (generation === requestGeneration) { pending = null; syncControls(); } });
    pending = { key, promise: task }; return task;
  }
  async function checkedRequest(path, options) {
    const response = await request(path, options);
    if (!response?.ok) throw Object.assign(new Error('request_failed'), { status: response?.status });
    return response;
  }
  find('[data-provider-back]').addEventListener('click', () => { if (canLeave()) onBack(); });
  root.querySelectorAll('[data-provider-granularity]').forEach(button => button.addEventListener('click', () => { root.querySelectorAll('[data-provider-granularity]').forEach(node => node.setAttribute('aria-pressed', String(node === button))); renderLedger(); }));
  find('[data-provider-more]').addEventListener('click', () => { if (!actionBusy) loadFiles({ append: true }).catch(() => {}); });
  fileInput.addEventListener('change', () => { const error = fileInput.files?.length ? validateAccountingReportFile(fileInput.files[0]) : ''; notify('[data-provider-upload-message]', error, Boolean(error)); });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-provider-download]');
    if (!button || !root.contains(button) || actionBusy) return;
    const file = files.find(item => item.id === button.dataset.providerDownload);
    if (!validAccountingArchiveFile(file, provider)) return;
    actionBusy = true; syncControls(); notify('[data-provider-files-message]');
    try {
      const response = await checkedRequest(`/api/admin/accounting/reports/${encodeURIComponent(file.id)}/download`);
      const blob = await response.blob(), url = window.URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = safeFilename(file.filename); document.body.append(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => window.URL.revokeObjectURL(url), 60000); }
    } catch (error) { notify('[data-provider-files-message]', error.status === 401 ? 'Увійдіть, щоб завантажити файл.' : 'Не вдалося завантажити файл. Спробуйте ще раз.', true); }
    finally { actionBusy = false; syncControls(); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (actionBusy || !ledger) return;
    const file = fileInput.files?.[0], fileError = validateAccountingReportFile(file);
    const from = form.elements.date_from.value, to = form.elements.date_to.value, kind = form.elements.source_kind.value;
    const error = fileError || (!dateValue(from) || !dateValue(to) || from > to ? 'Оберіть коректний період файлу.' : !['native_export', 'derived'].includes(kind) ? 'Оберіть тип файлу.' : !form.elements.scope_confirmed.checked ? 'Підтвердьте, що файл містить лише рекламу EVLine.' : '');
    if (error) { notify('[data-provider-upload-message]', error, true); return; }
    const data = new window.FormData();
    data.set('metadata', JSON.stringify({ provider, date_from: from, date_to: to, source_kind: kind, scope_confirmed: true })); data.set('file', file);
    actionBusy = true; syncControls(); notify('[data-provider-upload-message]', 'Зберігаємо…');
    try {
      await checkedRequest('/api/admin/accounting/reports', { method: 'POST', body: data });
      resetUpload(); notify('[data-provider-upload-message]', 'Файл збережено. Витрати не змінені.');
      // The file is already saved. A list refresh failure must not invite a
      // duplicate upload or falsely report that the write failed.
      await loadFiles().catch(() => {});
    } catch (error) { notify('[data-provider-upload-message]', error.status === 401 ? 'Увійдіть знову. Вибраний файл залишився тут.' : error.status === 413 ? 'Файл перевищує 8 МБ.' : error.status === 400 || error.status === 415 ? 'Файл не прийнято. Перевірте формат і дані EVLine.' : 'Не вдалося зберегти. Спробуйте ще раз.', true); }
    finally { actionBusy = false; syncControls(); }
  });
  renderLedger(); syncControls();
  return { load, canLeave, hasChanges, isBusy, getProvider: () => provider };
}
