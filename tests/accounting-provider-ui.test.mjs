import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAccountingProviderView, validAccountingArchiveFile, validateAccountingReportFile } from '../admin/accounting-provider.js';
import { createAccountingPeriodState } from '../admin/accounting.js';

const now = () => new Date('2026-10-09T12:00:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ledger = (extra = {}) => ({
  from: '2026-10-01', to: '2026-10-08', currency: 'UAH', timezone: 'Europe/Kyiv',
  totals: { google_uah: 123.45, meta_uah: 999.99, orders: 500 },
  sources: { google: { status: 'partial' }, meta: { status: 'complete' } },
  daily: [
    { date: '2026-10-01', google_uah: 123.45, google_coverage: 'complete', meta_uah: 999.99, meta_coverage: 'complete', orders: 500 },
    { date: '2026-10-02', google_uah: 0, google_coverage: 'complete', meta_uah: null, meta_coverage: 'missing', orders: 0 },
    { date: '2026-10-03', google_uah: null, google_coverage: 'missing', meta_uah: null, meta_coverage: 'missing', orders: 0 },
  ],
  monthly: [{ month: '2026-10', from: '2026-10-01', to: '2026-10-08', google_uah: 123.45, google_coverage: 'partial', meta_uah: 999.99, meta_coverage: 'partial', orders: 500 }],
  ...extra,
});
const archived = (extra = {}) => ({ id: 'file-1', provider: 'google', account_id: '4028488894', date_from: '2026-10-01', date_to: '2026-10-08', source_kind: 'native_export', filename: 'google.csv', mime: 'text/csv', bytes: 24, sha256: 'a'.repeat(64), created_at: '2026-10-09T12:00:00Z', source_fetched_at: null, scope: 'account', source_ref: '', run_id: null, ...extra });
const metaFile = () => archived({ id: 'file-meta', provider: 'meta', account_id: '1354524650161143', scope: 'campaign', source_ref: 'evline_campaign_120251518463770454', filename: 'meta.csv' });
function mount(t, { api, request, ...options } = {}) {
  const window = new JSDOM('<section id="root"></section>', { url: 'https://example.test/admin/' }).window;
  t.after(() => window.close());
  const root = window.document.querySelector('#root'), apiCalls = [], rawCalls = [], downloads = [], revoked = [];
  window.URL.createObjectURL = () => 'blob:test-private'; window.URL.revokeObjectURL = url => revoked.push(url);
  window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, download: this.download }); };
  const controller = createAccountingProviderView(root, {
    api: async (...args) => { apiCalls.push(args); return api ? api(...args) : args[0].startsWith('/api/admin/accounting?') ? ledger() : { files: [archived()], next_cursor: null }; },
    request: async (...args) => { rawCalls.push(args); return request ? request(...args) : new Response('date,spend\n2026-10-01,123.45'); },
    getRange: () => 'all', now, confirmDiscard: () => true, ...options,
  });
  const form = root.querySelector('form'), fileInput = form.elements.file;
  let selectedFiles = [];
  Object.defineProperty(fileInput, 'files', { configurable: true, get: () => selectedFiles });
  const nativeReset = form.reset.bind(form);
  form.reset = () => { nativeReset(); selectedFiles = []; };
  const choose = (name = 'report.csv', bytes = 'a,b\n1,2') => { selectedFiles = [new window.File([bytes], name, { type: 'text/csv' })]; fileInput.dispatchEvent(new window.Event('change', { bubbles: true })); };
  return { window, root, controller, apiCalls, rawCalls, downloads, revoked, form, choose };
}
async function submit(view) { view.form.dispatchEvent(new view.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); }

test('archive upload validation is bounded and excludes executable or unsupported formats', () => {
  for (const name of ['a.csv', 'a.JSON', 'a.xlsx', 'a.pdf']) assert.equal(validateAccountingReportFile({ name, size: 1 }), '');
  for (const file of [{ name: 'a.html', size: 1 }, { name: 'a.csv.exe', size: 1 }, { name: 'a.csv', size: 0 }, { name: 'a.csv', size: 8 * 1024 * 1024 + 1 }]) assert.notEqual(validateAccountingReportFile(file), '');
});

test('archive rows require the exact EVLine provider account and business scope', () => {
  assert.equal(validAccountingArchiveFile(archived(), 'google'), true);
  assert.equal(validAccountingArchiveFile(metaFile(), 'meta'), true);
  for (const change of [{ provider: 'meta' }, { account_id: 'another' }, { id: '../private' }, { source_kind: '__proto__' }, { date_to: '2026-02-31' }, { bytes: 0 }]) assert.equal(validAccountingArchiveFile(archived(change), 'google'), false);
  for (const change of [{ scope: 'shared_account' }, { scope: 'account' }, { source_ref: 'bb_campaign_120252865188010454' }]) assert.equal(validAccountingArchiveFile({ ...metaFile(), ...change }, 'meta'), false);
  assert.equal(validAccountingArchiveFile(archived(), '__proto__'), false);
});

test('provider detail shows only its ledger spend, never attributes CRM orders or sums archive files', async t => {
  const view = mount(t);
  await view.controller.load({ provider: 'google', range: 'all' });
  assert.match(view.apiCalls[0][0], /^\/api\/admin\/accounting\?range=all&to=2026-10-08$/);
  assert.equal(view.apiCalls[1][0], '/api/admin/accounting/reports?provider=google&from=2026-10-01&to=2026-10-08');
  assert.match(view.root.querySelector('[data-provider-total]').textContent, /123,45/);
  assert.match(view.root.querySelector('[data-provider-coverage]').textContent, /Неповні дані/);
  assert.doesNotMatch(view.root.textContent, /999,99|Замовлення|CRM/);
  assert.equal(view.root.querySelectorAll('[data-provider-download]').length, 1);
  assert.match(view.root.querySelector('[data-provider-files]').textContent, /Оригінал/);
  assert.equal(view.controller.getProvider(), 'google');
  assert.equal(view.form.elements.date_from.value, '2026-10-01');
});

test('day/month controls do not refetch and preserve known zero, unknown and partial rows', async t => {
  const view = mount(t); await view.controller.load({ provider: 'google' });
  const calls = view.apiCalls.length;
  assert.match(view.root.querySelector('[data-provider-rows]').textContent, /Неповні дані/);
  view.root.querySelector('[data-provider-granularity="days"]').click();
  const rows = [...view.root.querySelectorAll('[data-provider-rows] tr')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].lastChild.textContent, '—');
  assert.equal(rows[1].lastChild.textContent, '0,00');
  assert.equal(rows[2].lastChild.textContent, '123,45');
  assert.equal(view.apiCalls.length, calls);
});

test('missing source never masquerades as zero or uses another provider total', async t => {
  const view = mount(t, { api: async url => url.includes('reports?') ? { files: [], next_cursor: null } : ledger({ sources: { google: { status: 'missing' }, meta: { status: 'complete' } } }) });
  await view.controller.load({ provider: 'google' });
  assert.equal(view.root.querySelector('[data-provider-total]').textContent, '—');
  assert.match(view.root.querySelector('[data-provider-files-message]').textContent, /Файлів за цей період ще немає/);
});

test('foreign and shared-account files never receive download controls, while filenames render as text', async t => {
  const valid = metaFile(); valid.filename = '<img src=x>.csv';
  const view = mount(t, { api: async url => url.includes('reports?') ? { files: [valid, { ...metaFile(), id: 'other', scope: 'shared_account' }, archived()], next_cursor: null } : ledger() });
  await view.controller.load({ provider: 'meta' });
  assert.equal(view.root.querySelectorAll('[data-provider-download]').length, 1);
  assert.equal(view.root.querySelector('img'), null);
  assert.match(view.root.querySelector('[data-provider-files]').textContent, /<img src=x>/);
  assert.match(view.root.querySelector('[data-provider-coverage]').textContent, /лише EVLine/);
  assert.match(view.root.querySelector('[data-provider-files-message]').textContent, /Частину файлів не показано/);
});

test('pagination keeps prior files, deduplicates IDs and includes only the opaque cursor', async t => {
  const view = mount(t, { api: async url => !url.includes('reports?') ? ledger() : url.includes('cursor=') ? { files: [archived(), archived({ id: 'file-2', filename: 'second.json', source_kind: 'sync_payload' })], next_cursor: null } : { files: [archived()], next_cursor: 'opaque_cursor' } });
  await view.controller.load({ provider: 'google' });
  assert.equal(view.root.querySelector('[data-provider-more]').hidden, false);
  view.root.querySelector('[data-provider-more]').click(); await tick();
  assert.equal(view.root.querySelectorAll('[data-provider-download]').length, 2);
  assert.match(view.apiCalls.at(-1)[0], /cursor=opaque_cursor$/);
  assert.equal(view.root.querySelector('[data-provider-more]').hidden, true);
});

test('a late old-provider response cannot overwrite the new provider or its file list', async t => {
  let firstResolve, count = 0;
  const view = mount(t, { api: async url => {
    if (url.includes('reports?')) return { files: [metaFile()], next_cursor: null };
    count += 1; return count === 1 ? new Promise(resolve => { firstResolve = resolve; }) : ledger();
  } });
  const old = view.controller.load({ provider: 'google' }); await tick();
  await view.controller.load({ provider: 'meta', range: '7d' });
  firstResolve(ledger({ totals: { google_uah: 1, meta_uah: 1 } })); await old;
  assert.equal(view.controller.getProvider(), 'meta');
  assert.match(view.root.querySelector('[data-provider-total]').textContent, /999,99/);
  assert.match(view.root.querySelector('[data-provider-files]').textContent, /meta.csv/);
});

test('same pending period is deduplicated; stale archive responses cannot cross a provider switch', async t => {
  let resolveGoogle, ledgerCalls = 0;
  const view = mount(t, { api: async url => {
    if (!url.includes('reports?')) { ledgerCalls += 1; return ledger(); }
    if (url.includes('provider=google')) return new Promise(resolve => { resolveGoogle = resolve; });
    return { files: [metaFile()], next_cursor: null };
  } });
  const first = view.controller.load({ provider: 'google' }); await tick();
  const repeat = view.controller.load({ provider: 'google' });
  await view.controller.load({ provider: 'meta' });
  resolveGoogle({ files: [archived()], next_cursor: null }); await Promise.all([first, repeat]);
  assert.equal(ledgerCalls, 2);
  assert.match(view.root.querySelector('[data-provider-files]').textContent, /meta.csv/);
  assert.doesNotMatch(view.root.querySelector('[data-provider-files]').textContent, /google.csv/);
});

test('selected upload is protected during provider/period changes and back navigation', async t => {
  let approved = false, backs = 0;
  const view = mount(t, { confirmDiscard: () => approved, onBack: () => { backs += 1; } });
  await view.controller.load({ provider: 'google' }); view.choose();
  assert.equal(view.controller.hasChanges(), true);
  assert.equal(await view.controller.load({ provider: 'meta' }), false);
  view.root.querySelector('[data-provider-back]').click();
  assert.equal(backs, 0); assert.equal(view.controller.getProvider(), 'google');
  approved = true; view.root.querySelector('[data-provider-back]').click();
  assert.equal(backs, 1); assert.equal(view.controller.hasChanges(), false);
});

test('upload requires EVLine confirmation and sends only exact metadata plus original file, not a ledger write', async t => {
  const view = mount(t); await view.controller.load({ provider: 'google' }); view.choose('original.csv', 'date,spend\n2026-10-01,123.45');
  await submit(view); assert.equal(view.rawCalls.length, 0);
  assert.match(view.root.querySelector('[data-provider-upload-message]').textContent, /Підтвердьте/);
  view.form.elements.scope_confirmed.checked = true;
  view.form.elements.source_kind.value = 'derived';
  await submit(view);
  assert.equal(view.rawCalls.length, 1);
  const [path, options] = view.rawCalls[0];
  assert.equal(path, '/api/admin/accounting/reports'); assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body.get('metadata')), { provider: 'google', date_from: '2026-10-01', date_to: '2026-10-08', source_kind: 'derived', scope_confirmed: true });
  assert.deepEqual([...options.body.keys()], ['metadata', 'file']);
  assert.equal(options.body.get('file').name, 'original.csv');
  assert.equal(view.controller.hasChanges(), false);
  assert.match(view.root.querySelector('[data-provider-upload-message]').textContent, /Витрати не змінені/);
  assert.match(view.root.querySelector('[data-provider-total]').textContent, /123,45/);
});

test('busy upload cannot be duplicated or abandoned; server error keeps selected file and secrets out of UI', async t => {
  let rejectUpload;
  const view = mount(t, { request: async () => new Promise((resolve, reject) => { rejectUpload = reject; }) });
  await view.controller.load({ provider: 'google' }); view.choose(); view.form.elements.scope_confirmed.checked = true;
  await submit(view);
  assert.equal(view.controller.isBusy(), true); assert.equal(view.controller.canLeave(), false);
  assert.equal(await view.controller.load({ provider: 'meta' }), false);
  await submit(view); assert.equal(view.rawCalls.length, 1);
  rejectUpload(new Error('secret backend token')); await tick();
  assert.equal(view.controller.isBusy(), false); assert.equal(view.controller.hasChanges(), true);
  assert.doesNotMatch(view.root.textContent, /secret|token/);
  assert.match(view.root.querySelector('[data-provider-upload-message]').textContent, /Не вдалося зберегти/);
});

test('download uses the protected endpoint and a blob URL, never an auth-bearing or public link', async t => {
  const view = mount(t); await view.controller.load({ provider: 'google' });
  view.root.querySelector('[data-provider-download]').click(); await tick();
  assert.equal(view.rawCalls[0][0], '/api/admin/accounting/reports/file-1/download');
  assert.deepEqual(view.downloads, [{ href: 'blob:test-private', download: 'google.csv' }]);
  assert.equal(view.root.querySelector('a'), null);
});

test('archive failure leaves costs usable, while ledger auth failure propagates without private details', async t => {
  const view = mount(t, { api: async url => { if (url.includes('reports?')) throw new Error('private database secret'); return ledger(); } });
  await view.controller.load({ provider: 'google' });
  assert.match(view.root.querySelector('[data-provider-total]').textContent, /123,45/);
  assert.match(view.root.querySelector('[data-provider-files-message]').textContent, /Не вдалося завантажити файли/);
  assert.doesNotMatch(view.root.textContent, /private|secret/);
  const denied = mount(t, { api: async () => { throw Object.assign(new Error('token'), { status: 401 }); } });
  await assert.rejects(denied.controller.load({ provider: 'google' }), { status: 401 });
  assert.match(denied.root.querySelector('[data-provider-message]').textContent, /Увійдіть/);
  assert.equal(denied.form.elements.file.disabled, true);
});

test('successful upload remains successful even if refreshing the archive fails authentication', async t => {
  let lists = 0;
  const view = mount(t, { api: async url => { if (!url.includes('reports?')) return ledger(); if (++lists > 1) throw Object.assign(new Error('auth'), { status: 401 }); return { files: [], next_cursor: null }; } });
  await view.controller.load({ provider: 'google' }); view.choose(); view.form.elements.scope_confirmed.checked = true;
  await submit(view);
  assert.equal(view.controller.hasChanges(), false);
  assert.match(view.root.querySelector('[data-provider-upload-message]').textContent, /Файл збережено/);
  assert.match(view.root.querySelector('[data-provider-files-message]').textContent, /Увійдіть/);
});

test('upload refresh wins over an older still-pending archive list', async t => {
  let resolveOld, lists = 0;
  const view = mount(t, { api: async url => {
    if (!url.includes('reports?')) return ledger();
    if (++lists === 1) return new Promise(resolve => { resolveOld = resolve; });
    return { files: [archived({ id: 'new-file', filename: 'new.csv' })], next_cursor: null };
  } });
  const first = view.controller.load({ provider: 'google' }); await tick();
  view.choose(); view.form.elements.scope_confirmed.checked = true; await submit(view);
  resolveOld({ files: [archived({ filename: 'outdated.csv' })], next_cursor: null }); await first;
  assert.match(view.root.querySelector('[data-provider-files]').textContent, /new.csv/);
  assert.doesNotMatch(view.root.querySelector('[data-provider-files]').textContent, /outdated.csv/);
});

const adminHtml = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const adminSource = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
function navigationHarness(t) {
  const window = new JSDOM(adminHtml, { url: 'https://example.test/admin/', runScripts: 'outside-only' }).window;
  t.after(() => window.close());
  window.localStorage.setItem('evline_accounting_range', '90d');
  const state = { activeTab: 'accounting' }, guards = { provider: true, profit: true, order: true }, loads = [];
  const providerView = { canLeave: () => guards.provider, load: async options => { loads.push(options); } };
  const profitView = { canLeave: () => guards.profit, load: async () => {} };
  const code = adminSource.slice(adminSource.indexOf('function setActiveTab(tab)'), adminSource.indexOf('function renderSummary(data)'));
  assert.match(code, /function navigateAccountingProvider/);
  const initialize = new window.Function('state', 'guards', 'accountingProviderView', 'accountingProfitView', 'accountingPeriods', `
    const adminTabs = new Set(['orders','contacts','china','analytics','delivery','accounting']);
    let accountingProvider = null, accountingPanel = 'advertising';
    const accountingView = { load: async () => {} };
    const adminToken = () => 'test-session', allowDiscardOrder = () => guards.order;
    const setOrderDetailOpen = () => {}, setMarketLookupOpen = () => {}, setChinaRequestPanelOpen = () => {}, setChinaPreorderPanelOpen = () => {};
    const startChinaAutoRefresh = () => {}, stopChinaAutoRefresh = () => {}, loadChinaPreorders = async () => {}, renderShippingDirectory = () => {};
    ${code}
    setActiveTab('accounting');
    return { setActiveTab, navigateAccountingProvider, state: () => ({provider:accountingProvider,panel:accountingPanel,tab:state.activeTab}) };
  `);
  const navigation = initialize(state, guards, providerView, profitView, createAccountingPeriodState(window.localStorage));
  return { window, document: window.document, guards, loads, navigation };
}

test('actual admin markup exposes exactly two native links, one isolated detail mount and no extra primary tab', t => {
  const { document } = navigationHarness(t);
  const links = [...document.querySelectorAll('[data-accounting-provider]')];
  assert.deepEqual(links.map(link => [link.tagName, link.dataset.accountingProvider, link.getAttribute('href')]), [['A', 'google', '#accounting/google'], ['A', 'meta', '#accounting/meta']]);
  assert.equal(document.querySelectorAll('[data-accounting-provider-view]').length, 1);
  assert.ok(document.querySelector('[data-accounting-panel="advertising"] [data-accounting-provider-view]'));
  assert.equal(document.querySelectorAll('.admin-tabs [data-admin-tab="accounting"]').length, 1);
  assert.match(adminSource, /createAccountingProviderView\(document\.querySelector\('\[data-accounting-provider-view\]'\)/);
});

test('actual navigation opens a card and returns to the overview with its saved period intact', async t => {
  const { document, window, navigation, loads } = navigationHarness(t);
  document.querySelector('[data-accounting-provider="google"]').click(); await tick();
  assert.equal(window.location.hash, '#accounting/google');
  assert.deepEqual({ ...navigation.state() }, { provider: 'google', panel: 'advertising', tab: 'accounting' });
  assert.equal(document.querySelector('[data-accounting-overview]').hidden, true);
  assert.equal(document.querySelector('[data-accounting-provider-view]').hidden, false);
  assert.deepEqual({ ...loads.at(-1) }, { provider: 'google', range: '90d' });
  assert.equal(document.querySelector('#range').value, '90d');
  navigation.navigateAccountingProvider(null); await tick();
  assert.equal(window.location.hash, '#accounting');
  assert.equal(document.querySelector('[data-accounting-overview]').hidden, false);
  assert.equal(document.querySelector('[data-accounting-provider-view]').hidden, true);
  assert.equal(document.querySelector('#range').value, '90d');
});

test('actual navigation guards hash changes, primary tabs and profit tab against abandoning a selected upload', async t => {
  const { document, window, guards, navigation } = navigationHarness(t);
  navigation.navigateAccountingProvider('google'); guards.provider = false;
  assert.equal(navigation.setActiveTab('orders'), false);
  document.querySelector('[data-accounting-tab="profit"]').click();
  assert.equal(navigation.state().panel, 'advertising');
  window.history.replaceState(null, '', '#accounting/meta');
  window.dispatchEvent(new window.HashChangeEvent('hashchange')); await tick();
  assert.equal(window.location.hash, '#accounting/google');
  assert.equal(navigation.state().provider, 'google');
  guards.provider = true;
  window.history.replaceState(null, '', '#accounting/meta');
  window.dispatchEvent(new window.HashChangeEvent('hashchange')); await tick();
  assert.equal(navigation.state().provider, 'meta');
  assert.equal(navigation.setActiveTab('orders'), true);
  assert.equal(window.location.hash, '');
});

test('authenticated binary helper omits JSON content-type for multipart and never embeds credentials in URLs', async t => {
  const window = new JSDOM('', { url: 'https://example.test/admin/', runScripts: 'outside-only' }).window;
  t.after(() => window.close());
  window.Headers = Headers;
  const calls = [], auth = [];
  const functionSource = adminSource.slice(adminSource.indexOf('async function accountingReportsRequest('), adminSource.indexOf('function setText(selector'));
  const helper = new window.Function('headers', 'fetch', 'setAdminUser', 'state', 'shippingClassifier', 'setAuthVisible', `return (${functionSource.trim()});`)(
    () => ({ 'content-type': 'application/json', authorization: 'Bearer private-test-token' }),
    async (path, options) => { calls.push({ path, options }); return new Response('', { status: 401 }); },
    () => {}, {}, { clear() {} }, value => auth.push(value),
  );
  const form = new window.FormData(); form.set('metadata', '{}');
  await helper('/api/admin/accounting/reports', { method: 'POST', body: form });
  assert.equal(calls[0].options.headers.get('content-type'), null);
  assert.equal(calls[0].options.headers.get('authorization'), 'Bearer private-test-token');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.doesNotMatch(calls[0].path, /token|Bearer/);
  assert.deepEqual(auth, [true]);
});
