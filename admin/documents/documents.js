import { normalizeDocument, validateReady, totals, money, escapeHtml as esc, fieldLabels, SELLER_FIELDS, kindLabels, syncStandardTerms } from './model.js';
import { previewHtml, pdfDefinition } from './render.js';
import { icon } from './icons.js';
import { adminApiError } from '../../assets/js/admin-api-errors.js';

const $ = s => document.querySelector(s);
const orderId = new URL(location.href).searchParams.get('order') || '';
const endpoint = `/api/admin/orders/${encodeURIComponent(orderId)}/documents`;
let context, data, baseline = '', view = 'edit', busy = false, pdfLoading, sendFile, pendingSave;
const dirty = () => data && JSON.stringify(data) !== baseline;
const clone = v => structuredClone(v);
function error(message, target = '[data-error]') { const el = $(target); el.textContent = message || ''; el.hidden = !message; }
function status(message) { $('[data-save-status]').textContent = message; }
async function api(path, options = {}) {
  const headers = { ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  const token = localStorage.getItem('evline_admin_token');
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers, cache: 'no-store' });
  if (response.status === 401 || response.status === 403) $('[data-auth]').hidden = false;
  if (!response.ok) throw new Error(await adminApiError(response));
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error('Сервер повернув некоректну відповідь.'); }
}
function input(label, path, value, { type = 'text', wide = false, rows, options, max = 3000 } = {}) {
  return `<label${wide ? ' class="wide"' : ''}>${esc(label)}${options ? `<select data-path="${path}"><option value="">Оберіть</option>${options.map(([v, title]) => `<option value="${esc(v)}" ${value === v ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select>` : rows ? `<textarea data-path="${path}" rows="${rows}" maxlength="${max}">${esc(value)}</textarea>` : `<input data-path="${path}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="1" max="1000" step="1"' : `maxlength="${max}"`} ${/price|prepayment|receipt.amount/.test(path) ? 'inputmode="decimal"' : ''}>`}</label>`;
}
const docInput = (key, options) => input(fieldLabels[key], key, data[key], options);
function renderEditor() {
  const s = data.seller, b = data.buyer;
  $('[data-editor]').innerHTML = `
    <section class="editor-section"><h2>Договір</h2><div class="fields three">${docInput('number')}${docInput('date', { type: 'date' })}${docInput('city')}</div></section>
    <section class="editor-section"><h2>Покупець</h2><div class="fields">
      ${input('ПІБ / найменування', 'buyer.name', b.name)}${input('Телефон', 'buyer.phone', b.phone, { type: 'tel' })}
      ${input('Email / месенджер', 'buyer.contact', b.contact)}${input('Адреса', 'buyer.address', b.address)}
      ${input('Мета придбання', 'buyer.purpose', b.purpose, { options: [['Особисті потреби', 'Особисті потреби'], ['Господарська діяльність', 'Господарська діяльність']] })}
      ${input('Код / РНОКПП, для бізнесу', 'buyer.code', b.code)}${docInput('car')}${docInput('vin')}
    </div></section>
    <section class="editor-section"><div class="section-heading"><h2>Специфікація</h2><button type="button" data-action="add-item">${icon('Plus')}Позиція</button></div>
    ${data.items.map((r, i) => `<div class="spec-item"><div class="item-heading"><strong>Позиція ${i + 1}</strong><button type="button" class="icon-button" data-remove-item="${i}" ${data.items.length === 1 ? 'disabled' : ''} aria-label="Видалити позицію ${i + 1}" title="Видалити позицію">${icon('Trash2')}</button></div><div class="item-fields">
      <label class="item-title">Найменування<input data-path="items.${i}.title" value="${esc(r.title)}" maxlength="2000"></label>
      ${input('Кількість', `items.${i}.quantity`, r.quantity, { type: 'number' })}${input('Ціна за одиницю, грн', `items.${i}.price`, r.price)}
      ${input('Артикул / OEM-номер', `items.${i}.sku`, r.sku, { max: 160 })}${input('Тип запчастини', `items.${i}.kind`, r.kind, { options: Object.entries(kindLabels) })}
      </div><details class="item-extra"><summary>VIN позиції та комплектність</summary><div class="fields">${input('VIN, якщо інший автомобіль', `items.${i}.vin`, r.vin)}${input('Примітка до позиції', `items.${i}.notes`, r.notes)}</div></details></div>`).join('')}
      <div class="fields">${docInput('condition', { rows: 2 })}${docInput('warranty', { rows: 2 })}${docInput('included', { wide: true, rows: 2 })}${docInput('tax', { wide: true })}</div>
      <details class="extras" ${data.extras.length ? 'open' : ''}><summary>Окремі погоджені витрати${data.extras.length ? ` · ${data.extras.length}` : ''}</summary>
      ${data.extras.map((r, i) => `<div class="extra-row">${input('Складова', `extras.${i}.title`, r.title)}${input('Сума, грн', `extras.${i}.price`, r.price)}<button class="icon-button" type="button" data-remove-extra="${i}" title="Видалити складову" aria-label="Видалити складову">${icon('Trash2')}</button></div>`).join('')}
      <button type="button" data-action="add-extra">${icon('Plus')}Додати складову</button>${data.extras.length ? `<div class="fields">${docInput('allocation', { wide: true, rows: 2 })}</div>` : ''}</details>
    </section>
    <section class="editor-section"><h2>Оплата клієнтом</h2><div class="fields">${input('Погоджена передоплата, грн', 'prepayment', data.prepayment)}${docInput('prepayment_due')}${docInput('balance_due', { wide: true })}</div>
      <p><label class="check-label"><input type="checkbox" data-path="receipt.enabled" ${data.receipt.enabled ? 'checked' : ''}><span>Додати підтвердження отриманої оплати</span></label></p>
      <div class="fields" data-receipt-fields ${data.receipt.enabled ? '' : 'hidden'}>
        ${input('Фактично отримано від клієнта, грн', 'receipt.amount', data.receipt.amount)}${input('Дата надходження', 'receipt.date', data.receipt.date, { type: 'date' })}
        ${input('Спосіб оплати', 'receipt.method', data.receipt.method)}${input('Підстава / номер платіжного документа', 'receipt.reference', data.receipt.reference)}
        <label class="check-label wide"><input type="checkbox" data-path="receipt.confirmed" ${data.receipt.confirmed ? 'checked' : ''}><span>Надходження від клієнта перевірено</span></label>
      </div>
    </section>
    <section class="editor-section"><h2>Доставка й отримання</h2><div class="fields">
      ${docInput('route')}${docInput('forecast')}${docInput('deadline_days')}${docInput('partial', { options: [['Допускається', 'Допускається'], ['Лише після окремого погодження', 'Лише після окремого погодження']] })}${docInput('handover')}${docInput('recipient')}${docInput('notes', { wide: true, rows: 3 })}
    </div></section>
    <details class="editor-section" ${!s.tax_id || !s.iban ? 'open' : ''}><summary>Реквізити продавця</summary><div class="fields">
      ${SELLER_FIELDS.map(key => input({ name: 'Продавець', tax_id: 'РНОКПП / ЄДРПОУ', address: 'Адреса реєстрації та для звернень', iban: 'IBAN', bank: 'Банк', phone: 'Телефон', email: 'Email' }[key], `seller.${key}`, s[key], { wide: key === 'address' || key === 'name' })).join('')}
      <div class="wide"><button type="button" data-action="save-seller">Зберегти реквізити для наступних документів</button></div></div></details>
    <details class="editor-section"><summary>Текст договору</summary>${data.terms.map((s, i) => `<details class="contract-section"><summary>${esc(s.title)}</summary><textarea data-path="terms.${i}.text" rows="10" maxlength="15000" aria-label="${esc(s.title)}">${esc(s.text)}</textarea></details>`).join('')}</details>
  `;
}
function refreshSummary() {
  let messages = [];
  try {
    const normalized = normalizeDocument(data), t = totals(normalized);
    messages = validateReady({ ...normalized, reviewed: true });
    $('[data-totals]').innerHTML = `<div><dt>Позиції (${data.items.length})</dt><dd>${money(t.items)} грн</dd></div>${data.extras.length ? `<div><dt>Окремі витрати</dt><dd>${money(t.extras)} грн</dd></div>` : ''}<div class="total-row"><dt>Разом</dt><dd>${money(t.total)} грн</dd></div><div><dt>Передоплата</dt><dd>${data.prepayment === '' ? '—' : `${money(t.total - t.balance)} грн`}</dd></div>${data.receipt.enabled ? `<div><dt>Отримано</dt><dd>${money(t.received)} грн</dd></div>` : ''}`;
  } catch (e) { messages = [e.message]; }
  $('[data-checks]').innerHTML = messages.length ? `<details><summary>Не заповнено / потребує перевірки: ${messages.length}</summary><ul class="checks-list">${messages.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>` : '<p class="checks-ok">Обов’язкові поля заповнено</p>';
  $('[data-reviewed]').checked = data.reviewed;
  const ready = !dirty() && context.document?.status === 'ready';
  $('[data-state]').textContent = dirty() ? 'Незбережені зміни' : ready ? 'Підготовлено до підписання' : 'Чернетка';
  $('[data-state]').classList.toggle('ready', ready);
  $('[data-action="save"]').disabled = !dirty() && !!context.document;
  if (view === 'preview') renderPreview();
}
function renderPreview() {
  try { $('[data-paper]').innerHTML = previewHtml(normalizeDocument(data), $('[data-preview-mode]').value, dirty() || context.document?.status !== 'ready'); }
  catch (e) { $('[data-paper]').innerHTML = `<p class="notice error">${esc(e.message)}</p>`; }
  $('[data-preview-mode] option[value="receipt"]').disabled = !data.receipt.enabled;
}
function setView(next) {
  view = next;
  $('[data-editor]').hidden = next !== 'edit'; $('[data-preview]').hidden = next !== 'preview';
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === next)));
  if (next === 'preview') renderPreview();
}
function adopt(result, initial = false) {
  context = result; data = clone(result.document?.data || result.defaults); baseline = JSON.stringify(data);
  if (initial) { document.title = `${context.order.number} · Документи | EVLine CRM`; $('[data-order-number]').textContent = context.order.number; $('[data-customer]').textContent = [context.order.customer_name, context.order.customer_phone].filter(Boolean).join(' · '); }
  $('[data-versions]').innerHTML = result.versions.length ? result.versions.map(v => `<option value="${esc(v.id)}" ${v.id === result.document?.id ? 'selected' : ''}>Версія ${v.revision} · ${v.status === 'ready' ? 'підготовлено' : 'чернетка'}</option>`).join('') : '<option value="">Ще не збережено</option>';
  $('[data-version-info]').textContent = result.document ? `${new Date(result.document.created_at).toLocaleString('uk-UA')} · ${result.document.actor}` : '';
  const delivery = result.deliveries[0];
  $('[data-delivery-status]').textContent = delivery ? `${delivery.status === 'sent' ? 'Надіслано в Telegram' : delivery.status === 'failed' ? 'Не надіслано' : 'Статус відправлення потребує перевірки'} · ${new Date(delivery.created_at).toLocaleString('uk-UA')}` : '';
  renderEditor(); refreshSummary(); setView(view);
}
async function save(state = 'draft') {
  const normalized = normalizeDocument(data);
  if (state === 'ready') {
    const errors = validateReady(normalized);
    if (errors.length) { $('[data-checks] details')?.setAttribute('open', ''); throw new Error(`Потрібно перевірити: ${errors.join('; ')}.`); }
  }
  if (!dirty() && context.document?.status === state) return;
  const fingerprint = JSON.stringify([normalized, state, context.latest_revision]);
  if (pendingSave?.fingerprint !== fingerprint) pendingSave = { fingerprint, id: crypto.randomUUID() };
  const result = await api(endpoint, { method: 'POST', body: JSON.stringify({ request_id: pendingSave.id, expected_revision: context.latest_revision, status: state, data: normalized }) });
  pendingSave = null; adopt(result); status(`Збережено версію ${result.document.revision}`);
}
async function loadPdf() {
  if (!pdfLoading) pdfLoading = (async () => {
    for (const path of ['pdfmake.min.js', 'vfs_fonts.js']) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = `/admin/documents/vendor/${path}`; script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('Не вдалося завантажити модуль PDF. Спробуйте ще раз.')); }; document.head.append(script);
    });
  })().catch(e => { pdfLoading = null; throw e; });
  return pdfLoading;
}
async function pdfFile(draft = false, autoPrint = false) {
  if (!draft) await save('ready');
  else if (dirty() || !context.document) await save('draft');
  await loadPdf();
  const model = pdfDefinition(data, { draft, revision: context.document.revision });
  const blob = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Створення PDF триває надто довго. Спробуйте ще раз.')), 30000);
    try { window.pdfMake.createPdf(model).getBlob(b => { clearTimeout(timeout); resolve(b); }, { autoPrint }); } catch (e) { clearTimeout(timeout); reject(e); }
  });
  return new File([blob], `EVLine-${context.order.number}-v${context.document.revision}${draft ? '-draft' : ''}.pdf`, { type: 'application/pdf' });
}
function download(file) { const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
async function prepareSend() {
  sendFile = await pdfFile();
  $('[data-send-content]').innerHTML = `<p>Договір, специфікація${data.receipt.enabled ? ' та підтвердження оплати' : ''} · версія ${context.document.revision}</p><p>${esc(data.buyer.name)}</p>${context.recipient ? `<div class="recipient"><strong>Telegram клієнта цього замовлення</strong>${esc([context.order.customer_name, context.order.customer_phone].filter(Boolean).join(' · '))}<br>ID: ${esc(context.recipient)}</div><label class="check-label"><input type="checkbox" data-confirm-recipient><span>Документ і одержувача перевірено</span></label>` : '<p>Telegram клієнта не підключено до бота.</p>'}`;
  $('[data-action="telegram"]').hidden = !context.recipient;
  $('[data-action="share"]').hidden = !navigator.canShare?.({ files: [sendFile] });
  error('', '[data-send-error]'); $('[data-send-dialog]').showModal();
}
async function action(name) {
  if (name === 'save') await save();
  else if (name === 'pdf' || name === 'draft-pdf') download(await pdfFile(name === 'draft-pdf'));
  else if (name === 'print') {
    // Open during the user gesture so browser popup blocking cannot discard the PDF.
    const popup = window.open('', '_blank');
    if (!popup) throw new Error('Дозвольте відкриття вікна PDF або завантажте файл для друку.');
    try { const file = await pdfFile(!data.reviewed, true); const url = URL.createObjectURL(file); popup.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 120000); }
    catch (e) { popup.close(); throw e; }
  }
  else if (name === 'send') await prepareSend();
  else if (name === 'send-download') download(sendFile);
  else if (name === 'share') await navigator.share({ files: [sendFile], title: `Документи EVLine ${data.number}` });
  else if (name === 'telegram') {
    if (!$('[data-confirm-recipient]')?.checked) throw new Error('Підтвердьте одержувача перед відправленням.');
    const payload = new FormData();
    payload.set('document_id', context.document.id); payload.set('recipient', context.recipient); payload.set('file', sendFile);
    await api(`/api/admin/orders/${encodeURIComponent(orderId)}/document-send`, { method: 'POST', body: payload });
    $('[data-send-dialog]').close(); adopt(await api(`${endpoint}?version=${encodeURIComponent(context.document.id)}`)); status('Документи надіслано клієнту в Telegram');
  }
  else if (name === 'save-seller') {
    const result = await api('/api/admin/document-settings', { method: 'POST', body: JSON.stringify({ seller: data.seller, expected_revision: context.seller_revision }) });
    context.seller_revision = result.revision; status('Реквізити продавця збережено');
  }
  else if (name === 'add-item') {
    if (data.items.length >= 40) throw new Error('Не більше 40 позицій.');
    data.items.push({ title: '', sku: '', quantity: 1, price: '', kind: '', vin: '', notes: '' }); data.reviewed = false; renderEditor(); refreshSummary();
    $(`[data-path="items.${data.items.length - 1}.title"]`)?.focus();
  }
  else if (name === 'add-extra') {
    if (data.extras.length >= 10) throw new Error('Не більше 10 складових.');
    data.extras.push({ title: '', price: '' }); data.reviewed = false; renderEditor(); refreshSummary();
    $(`[data-path="extras.${data.extras.length - 1}.title"]`)?.focus();
  }
}
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-action]');
  if (!button || busy) return;
  busy = true; error(''); error('', '[data-send-error]'); button.disabled = true; $('[data-editor]').inert = true;
  try { await action(button.dataset.action); }
  catch (err) { if (err.name !== 'AbortError') error(err.message, $('[data-send-dialog]').open ? '[data-send-error]' : '[data-error]'); }
  finally { busy = false; button.disabled = false; $('[data-editor]').inert = false; refreshSummary(); }
});
document.addEventListener('click', e => {
  if (busy) return;
  const switcher = e.target.closest('[data-view]'); if (switcher) setView(switcher.dataset.view);
  const removeItem = e.target.closest('[data-remove-item]'), removeExtra = e.target.closest('[data-remove-extra]');
  if (removeItem && data.items.length > 1) data.items.splice(Number(removeItem.dataset.removeItem), 1);
  if (removeExtra) data.extras.splice(Number(removeExtra.dataset.removeExtra), 1);
  if (removeItem || removeExtra) { data.reviewed = false; renderEditor(); refreshSummary(); }
});
$('[data-editor]').addEventListener('submit', e => e.preventDefault());
$('[data-editor]').addEventListener('input', e => {
  const path = e.target.dataset.path; if (!path || busy) return;
  const keys = path.split('.'), key = keys.pop(); let obj = data;
  for (const k of keys) obj = obj[k];
  obj[key] = e.target.type === 'checkbox' ? e.target.checked : key === 'quantity' ? Number(e.target.value) : e.target.value;
  if (key === 'kind') {
    syncStandardTerms(data);
    for (const i of [0, 3]) $(`[data-path="terms.${i}.text"]`).value = data.terms[i].text;
  }
  data.reviewed = false;
  if (path.startsWith('receipt.') && path !== 'receipt.confirmed') { data.receipt.confirmed = false; $('[data-path="receipt.confirmed"]').checked = false; }
  if (path === 'receipt.enabled') { $('[data-receipt-fields]').hidden = !data.receipt.enabled; if (!data.receipt.enabled && $('[data-preview-mode]').value === 'receipt') $('[data-preview-mode]').value = 'all'; }
  refreshSummary(); status('');
});
$('[data-reviewed]').addEventListener('change', e => { if (busy) return; data.reviewed = e.target.checked; refreshSummary(); });
$('[data-preview-mode]').addEventListener('change', renderPreview);
$('[data-versions]').addEventListener('change', async e => {
  if (busy) { e.target.value = context.document?.id || ''; return; }
  if (dirty() && !confirm('Відкрити збережену версію й відкинути незбережені зміни?')) { e.target.value = context.document?.id || ''; return; }
  busy = true; $('[data-editor]').inert = true;
  try { adopt(await api(`${endpoint}?version=${encodeURIComponent(e.target.value)}`)); error(''); }
  catch (err) { error(err.message); e.target.value = context.document?.id || ''; }
  finally { busy = false; $('[data-editor]').inert = false; }
});
window.addEventListener('beforeunload', e => { if (dirty() || busy) { e.preventDefault(); e.returnValue = ''; } });

async function boot() {
  $('[data-back]').href = `/admin/?order=${encodeURIComponent(orderId)}`;
  $('[data-back]').innerHTML = `${icon('ArrowLeft')} До замовлення`;
  for (const [name, symbol] of Object.entries({ save: 'Save', pdf: 'Download', print: 'Printer', send: 'Share2' })) {
    const b = $(`[data-action="${name}"]`); b.innerHTML = icon(symbol) + b.innerHTML;
  }
  if (!orderId) throw new Error('Відкрийте документи з картки конкретного замовлення.');
  adopt(await api(endpoint), true); $('[data-workspace]').hidden = false;
}
boot().catch(e => { error(e.message); $('[data-state]').textContent = 'Не завантажено'; });
