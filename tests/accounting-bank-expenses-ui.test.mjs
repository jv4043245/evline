import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAccountingBankExpensesView } from '../admin/accounting-bank-expenses.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const payment = (extra = {}) => ({
  id: 'p1', category: 'igor_china', payer: 'Женя', beneficiary: 'Ігор',
  transaction_at: '2026-04-24T23:59:58', date: '2026-04-24', description: 'Alipay*OtherRetail',
  amount_minor: 42111, original_amount_minor: 6500, original_currency: 'CNY', bank_rate: 6.48, derived_rate: 6.4786153846,
  mcc: '5999', source_filename: 'report.csv', source_sheet: 'Операції', source_row: 18,
  classification_note: 'Особисті витрати під час поїздки', possible_duplicate: false, ...extra,
});
const fixture = (extra = {}) => ({
  currency: 'UAH', summary: { count: 2, debit_count: 1, refund_count: 1, debit_minor: 42111, refund_minor: 1930, net_minor: 40181, possible_duplicate_count: 0 },
  pagination: { page: 1, page_size: 25, total_count: 2, total_pages: 1 },
  coverage: { from: '2025-09-14', to: '2026-10-07' }, trip: { from: '2026-04-10', to: '2026-05-07' },
  rows: [payment(), payment({ id: 'p2', date: '2026-04-28', transaction_at: '2026-04-28T01:47:00', amount_minor: -1930, original_amount_minor: -300, classification_note: 'Повернення покупки' })], ...extra,
});
function mount(t, api = async () => fixture(), options = {}) {
  const window = new JSDOM('<section id="root"></section>', { url: 'https://evline.test/admin/' }).window;
  t.after(() => window.close());
  const root = window.document.querySelector('#root'), calls = [];
  const controller = createAccountingBankExpensesView(root, (...args) => { calls.push(args); return api(...args); }, { category: 'igor_china', ...options });
  return { root, controller, window, calls, form: root.querySelector('form'), get: name => root.querySelector(`[data-bank-${name}]`) };
}
function submit(view) { view.form.dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true })); }

test('all-time authenticated ledger shows all filtered totals and preserves recorded local date/time and signed refunds', async t => {
  const view = mount(t);
  assert.equal(await view.controller.load(), true);
  const [url, options] = view.calls[0];
  assert.equal(url, '/api/admin/accounting/bank-expenses?category=igor_china&page=1&page_size=25');
  assert.equal(options.signal.aborted, false);
  assert.match(view.get('scope').textContent, /10\.04\.2026 — 07\.05\.2026 включно/);
  assert.match(view.get('net').textContent, /401,81/);
  assert.match(view.get('debit').textContent, /421,11/);
  assert.match(view.get('refund').textContent, /19,30/);
  assert.equal(view.get('count').textContent, '2');
  const rows = [...view.root.querySelectorAll('[data-bank-row]')];
  assert.match(rows[0].textContent, /24\.04\.202623:59:58/);
  assert.match(rows[1].textContent, /Повернення/);
  assert.match(rows[1].querySelector('.accounting-bank__amount').textContent, /-19,30/);
  assert.match(rows[1].querySelector('.accounting-bank__original').textContent, /-3,00 CNY/);
  assert.equal(view.get('prev').disabled, true); assert.equal(view.get('next').disabled, true);
  await view.controller.load(); assert.equal(view.calls.length, 1);
  await view.controller.load({ force: true }); assert.equal(view.calls.length, 2);
});

test('bank descriptions, filenames, notes and source metadata render as text; detail disclosures expose evidence and real duplicate flags', async t => {
  const evil = '<img src=x onerror=alert(1)>', summary = { ...fixture().summary, possible_duplicate_count: 1 };
  const view = mount(t, async () => fixture({ summary, rows: [payment({ description: evil, source_filename: `${evil}.csv`, classification_note: evil, possible_duplicate: true }), fixture().rows[1]] }));
  await view.controller.load();
  assert.equal(view.root.querySelector('img'), null);
  assert.equal(view.root.querySelectorAll('.accounting-bank__badge--review').length, 1);
  assert.match(view.get('duplicates').textContent, /1/);
  const toggle = view.get('details'), details = view.window.document.getElementById(toggle.getAttribute('aria-controls'));
  assert.equal(details.hidden, true);
  toggle.click(); assert.equal(details.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.match(details.textContent, /5999/); assert.match(details.textContent, /report|\.csv/);
  assert.match(details.textContent, /АркушОперації/); assert.match(details.textContent, /Рядок у джерелі18/);
  assert.match(details.textContent, /Курс у виписці6,48/); assert.match(details.textContent, /6,478615/);
  assert.match(details.textContent, /включено до суми, потрібне звіряння/);
  assert.ok(details.textContent.includes(evil));
  toggle.click(); assert.equal(details.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('pagination uses server totals for every page and resets to page one when applying date/search filters', async t => {
  const all = { ...fixture().summary, count: 28, debit_count: 27, debit_minor: 3000000, net_minor: 2998070 };
  const view = mount(t, async url => {
    const query = new URL(url, 'https://evline.test').searchParams, page = Number(query.get('page'));
    return fixture({ summary: all, pagination: { page, page_size: 25, total_count: 28, total_pages: 2 }, rows: [payment({ id: `page-${page}` })] });
  });
  await view.controller.load(); view.get('next').click(); await tick();
  assert.equal(new URL(view.calls.at(-1)[0], 'https://evline.test').searchParams.get('page'), '2');
  assert.match(view.get('net').textContent, /29[\s\u00a0]980,70/);
  assert.match(view.get('page-info').textContent, /26–26 із 28/);
  assert.equal(view.get('next').disabled, true); assert.equal(view.get('prev').disabled, false);
  view.form.elements.from.value = '2026-04-10'; view.form.elements.to.value = '2026-05-07'; view.form.elements.q.value = '  Alipay & Retail  ';
  submit(view); await tick();
  const query = new URL(view.calls.at(-1)[0], 'https://evline.test').searchParams;
  assert.equal(query.get('page'), '1'); assert.equal(query.get('from'), '2026-04-10'); assert.equal(query.get('to'), '2026-05-07'); assert.equal(query.get('q'), 'Alipay & Retail');
  assert.match(view.get('period').textContent, /10\.04\.2026 — 07\.05\.2026 · «Alipay & Retail»/);
  view.get('reset').click(); await tick();
  const reset = new URL(view.calls.at(-1)[0], 'https://evline.test').searchParams;
  for (const name of ['from', 'to', 'q']) assert.equal(reset.has(name), false);
  assert.equal(view.get('period').textContent, 'Усі дати');
});

test('an older filter response cannot replace newer results, even when the API ignores abort', async t => {
  let firstResolve;
  const view = mount(t, (url) => url.includes('q=latest') ? Promise.resolve(fixture({ rows: [payment({ description: 'latest recipient' })] })) : new Promise(resolve => { firstResolve = resolve; }));
  const old = view.controller.load(); await tick();
  view.form.elements.q.value = 'latest'; submit(view); await tick();
  assert.equal(view.calls[0][1].signal.aborted, true);
  assert.match(view.get('rows').textContent, /latest recipient/);
  firstResolve(fixture({ rows: [payment({ description: 'old recipient' })] })); await old;
  assert.match(view.get('rows').textContent, /latest recipient/); assert.doesNotMatch(view.get('rows').textContent, /old recipient/);
});

test('same pending request deduplicates; hide aborts work and prevents hidden responses and debounced search requests', async t => {
  let finish;
  const view = mount(t, () => new Promise(resolve => { finish = resolve; }));
  const first = view.controller.load(), second = view.controller.load(); await tick();
  assert.equal(view.calls.length, 1);
  view.form.elements.q.value = 'no background search'; view.form.elements.q.dispatchEvent(new view.window.Event('input'));
  view.controller.hide(); assert.equal(view.calls[0][1].signal.aborted, true); assert.equal(view.controller.isBusy(), false);
  finish(fixture()); assert.deepEqual(await Promise.all([first, second]), [false, false]);
  await new Promise(resolve => setTimeout(resolve, 340));
  assert.equal(view.calls.length, 1); assert.equal(view.get('net').textContent, '—');
});

test('debounced recipient search uses latest text once and keeps independent category selection', async t => {
  const view = mount(t, async () => fixture({ rows: fixture().rows.map(row => ({ ...row, category: 'zhenia_delivery' })) }), { category: 'zhenia_delivery' });
  await view.controller.load();
  for (const value of ['Mee', 'Meest China']) { view.form.elements.q.value = value; view.form.elements.q.dispatchEvent(new view.window.Event('input')); }
  await new Promise(resolve => setTimeout(resolve, 340));
  assert.equal(view.calls.length, 2);
  const query = new URL(view.calls[1][0], 'https://evline.test').searchParams;
  assert.equal(query.get('q'), 'Meest China'); assert.equal(query.get('category'), 'zhenia_delivery');
  assert.equal(view.get('title').textContent, 'Женя · доставка');
});

test('invalid date range makes no request, empty results show verified zero, and retry recovers a load failure', async t => {
  let fail = true;
  const empty = fixture({ summary: { count: 0, debit_count: 0, refund_count: 0, debit_minor: 0, refund_minor: 0, net_minor: 0, possible_duplicate_count: 0 }, pagination: { page: 1, page_size: 25, total_count: 0, total_pages: 0 }, rows: [] });
  const view = mount(t, async () => { if (fail) throw new Error('private bank details must not render'); return empty; });
  assert.equal(await view.controller.load(), false); assert.equal(view.get('retry').hidden, false);
  assert.doesNotMatch(view.root.textContent, /private bank details/); assert.equal(view.get('net').textContent, '—');
  fail = false; view.get('retry').click(); await tick();
  assert.match(view.get('net').textContent, /0,00/); assert.match(view.get('rows').textContent, /оплат немає/);
  assert.equal(view.get('retry').hidden, true);
  view.form.elements.from.value = '2026-05-08'; view.form.elements.to.value = '2026-04-10'; submit(view); await tick();
  assert.equal(view.calls.length, 2); assert.match(view.get('message').textContent, /Перевірте дати/);
});

test('malformed totals or rows from another category cannot show financial amounts; session failures propagate', async t => {
  for (const bad of [fixture({ summary: { ...fixture().summary, net_minor: 1 } }), fixture({ rows: [payment({ category: 'zhenia_alipay' })] })]) {
    const view = mount(t, async () => bad); assert.equal(await view.controller.load(), false); assert.equal(view.get('net').textContent, '—');
    assert.match(view.get('message').textContent, /Не вдалося/);
  }
  const view = mount(t, async () => { throw Object.assign(new Error('denied'), { status: 401 }); });
  await assert.rejects(view.controller.load(), error => error.status === 401);
  assert.match(view.get('message').textContent, /Увійдіть/); assert.equal(view.controller.isBusy(), false);
});

// Receipt examples below are synthetic; no private payment evidence belongs in tests.
const receipt = (extra = {}) => payment({
  id: 'synthetic-delivery-receipt', category: 'zhenia_delivery', payer: 'zhenia', beneficiary: 'evline',
  date: '2027-08-19', transaction_at: null, time_precision: 'date', description: 'Meest China',
  source_kind: 'receipt_image', source_filename: 'synthetic-receipt.png', source_sheet: null, source_row: null,
  source_id: 'a'.repeat(64), date_basis: 'user_confirmation',
  amount_minor: 70000, uah_status: 'confirmed', original_amount_minor: 10300, original_currency: 'CNY',
  service_original_minor: 10000, fee_original_minor: 300, fee_included: true, bank_rate: null, derived_rate: null, mcc: null,
  classification_note: 'Дата 19.08.2027 підтверджена власником картки; гривнева сума підтверджена другим знімком банку.', ...extra,
});
const delivery = (extra = {}) => fixture({
  summary: { count: 6, debit_count: 6, refund_count: 0, debit_minor: 270000, refund_minor: 0, net_minor: 270000, possible_duplicate_count: 0, receipt_count: 1, pending_uah_count: 0, pending_original_totals: [] },
  pagination: { page: 1, page_size: 25, total_count: 6, total_pages: 1 },
  coverage: { from: '2027-02-12', to: '2027-08-19' }, rows: [receipt()], ...extra,
});

test('confirmed image receipt adds its UAH once and preserves date-only provenance, service and included fee', async t => {
  const confirmation = { confirmation_source_kind: 'bank_screenshot', confirmation_source_id: 'b'.repeat(64), confirmation_source_filename: 'synthetic-bank-confirmation.png', confirmation_note: '700,00 грн — фактичне списання за доставку з комісією.', confirmed_at: '2027-08-19T16:42:00Z' };
  const view = mount(t, async () => delivery({ rows: [receipt(confirmation)] }), { category: 'zhenia_delivery' });
  assert.equal(await view.controller.load(), true);
  assert.match(view.get('net').textContent, /2[\s\u00a0]700,00/); assert.equal(view.get('count').textContent, '6');
  assert.equal(view.get('pending').hidden, true); assert.equal(view.get('net-label').textContent, 'Витрати після повернень');
  assert.equal(view.get('source').textContent, 'Банківські виписки та квитанції'); assert.match(view.get('scope').textContent, /^Джерела:.*19\.08\.2027/);
  const row = view.root.querySelector('[data-bank-row]');
  assert.match(row.querySelector('.accounting-bank__amount').textContent, /700,00/);
  assert.match(row.textContent, /19\.08\.2027Час не зазначено/); assert.match(row.textContent, /Квитанція/);
  assert.doesNotMatch(row.textContent, /00:00|16:42/); assert.match(row.querySelector('.accounting-bank__original').textContent, /103,00 CNY/);
  view.get('details').click(); const details = view.root.querySelector('.accounting-bank__details-row');
  assert.match(details.textContent, /Квитанція · зображення/); assert.match(details.textContent, /Файл квитанціїsynthetic-receipt\.png/);
  assert.match(details.textContent, /Послуга доставки100,00 CNYКомісія3,00 CNY/);
  assert.match(details.textContent, /Сплачено разом, включно з комісією103,00 CNY/);
  assert.match(details.textContent, /Комісію вже включено/); assert.match(details.textContent, /Дата 19\.08\.2027 підтверджена власником/);
  assert.match(details.textContent, /Джерело датиДата підтверджена власником картки/);
  assert.match(details.textContent, /Підтвердження гривневої сумиБанківський знімок/);
  assert.match(details.textContent, /Файл підтвердженняsynthetic-bank-confirmation\.png/); assert.match(details.textContent, /Пояснення підтвердження700,00 грн/);
  assert.ok(details.textContent.includes('a'.repeat(64))); assert.ok(details.textContent.includes('b'.repeat(64)));
  assert.doesNotMatch(details.textContent, /Аркуш|Рядок у джерелі|00:00|16:42|Файл виписки/);
});

test('source caption uses filtered receipt count even when a confirmed receipt is on another page', async t => {
  const bank = payment({ category: 'zhenia_delivery' });
  const view = mount(t, async () => delivery({ rows: [bank] }), { category: 'zhenia_delivery' });
  await view.controller.load(); assert.equal(view.get('source').textContent, 'Банківські виписки та квитанції');
  assert.equal(view.root.querySelector('.accounting-bank__badge--receipt'), null); assert.equal(view.get('pending').hidden, true);
});

test('pending receipt keeps known UAH net separate and shows CNY gross across filters and pages', async t => {
  const waiting = receipt({ amount_minor: null, uah_status: 'pending' });
  const summary = { ...delivery().summary, debit_minor: 200000, net_minor: 200000, pending_uah_count: 1, pending_original_totals: [{ currency: 'CNY', amount_minor: 10300, count: 1 }] };
  const view = mount(t, async url => {
    const query = new URL(url, 'https://evline.test').searchParams;
    if (query.get('from')) return delivery({ summary: { ...summary, count: 1, debit_count: 1, debit_minor: 0, net_minor: 0 }, pagination: { page: 1, page_size: 25, total_count: 1, total_pages: 1 }, rows: [waiting] });
    return delivery({ summary, rows: [payment({ category: 'zhenia_delivery' })] });
  }, { category: 'zhenia_delivery' });
  await view.controller.load();
  assert.match(view.get('net').textContent, /2[\s\u00a0]000,00/); assert.equal(view.get('net-label').textContent, 'Підтверджено в гривнях');
  assert.equal(view.get('pending').hidden, false); assert.match(view.get('pending-title').textContent, /1 оплата очікує суми в гривнях/);
  assert.match(view.get('pending-original').textContent, /103,00 CNY/); assert.match(view.get('pending').textContent, /не включено до гривневого підсумку/);
  assert.match(view.get('debit-count').textContent, /У гривнях: 5 · очікує: 1/);
  view.form.elements.from.value = '2027-08-19'; view.form.elements.to.value = '2027-08-19'; submit(view); await tick();
  assert.equal(view.get('net').textContent, '—'); assert.equal(view.get('debit').textContent, '—');
  const amount = view.root.querySelector('.accounting-bank__amount'); assert.equal(amount.textContent, 'Очікується сума в гривнях');
  assert.ok(amount.classList.contains('accounting-bank__amount--pending')); assert.doesNotMatch(amount.textContent, /0,00/);
  view.get('details').click(); assert.match(view.root.querySelector('.accounting-bank__details-row').textContent, /Очікується підтвердження фактичного списання/);
});

test('receipt validation rejects fabricated time, zero confirmation, missing UAH status and inconsistent fee totals', async t => {
  for (const change of [
    { transaction_at: '2027-08-19T00:00:00' }, { amount_minor: 0 }, { amount_minor: null, uah_status: 'confirmed' },
    { amount_minor: 0, uah_status: 'pending' }, { original_amount_minor: 0 }, { service_original_minor: 0 },
    { fee_original_minor: 301 }, { fee_included: false }, { source_row: 1 }, { source_sheet: 'Screenshot' },
  ]) {
    const view = mount(t, async () => delivery({ rows: [receipt(change)] }), { category: 'zhenia_delivery' });
    assert.equal(await view.controller.load(), false); assert.equal(view.get('net').textContent, '—'); assert.match(view.get('message').textContent, /Не вдалося/);
  }
});
