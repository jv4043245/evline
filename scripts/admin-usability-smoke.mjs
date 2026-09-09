import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeMarketItem } from '../assets/js/market-comparison.js';

// Isolated browser regression: every admin API call is intercepted, never sent live.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.SMOKE_OUTPUT || '/tmp/evline-admin-ux-smoke';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!file.startsWith(`${root}/`)) throw new Error('outside root');
    const contents = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
    res.end(contents);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.SMOKE_BROWSER || 'chrome' });
const errors = [];
try {
  for (const width of [1440, 1024, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('evline_admin_token', 'isolated-ui-test'));
    let order = { id: 'smoke-order', order_number: 'O-900001', customer_phone: '+380000000001', customer_name: 'Тест', type: 'parts', status: 'new', car: 'VW ID4 Crozz', vin: 'TESTVIN0000000001', item_name: 'Фара права', request_text: 'Фара права', created_at: new Date().toISOString(), manager_notes: '', telegram_chat_id: '123', payment_status: 'unpaid' };
    const payment = { id: 'pay', payment_number: 'P-900001', supplier_name: 'BYD', requested_amount: 9133, requested_currency: 'CNY', paid_amount: 9133, commission_amount: 273.99, charged_total_amount: 9406.99, status: 'paid', receipt_count: 2, receipts: [{ chat_id: '-100123456', message_id: '2' }, { chat_id: '-100123456', message_id: '3' }] };
    const detail = () => ({ order, supplier_payments: [payment], events: [], notifications: [], tracking_events: [], supplier_requests: [] });
    const item = { key: 'lamp', label: 'Фара права', query: 'VW ID4 Crozz фара права', part_numbers: ['13158405-00'] };
    const offers = [1000, 2000, 3000, 4000, 5000, 6000].map((price, i) => ({ verified_product: true, currency: 'UAH', item_key: 'lamp', title: 'Фара права 13158405-00', part_number: '13158405-00', price_uah: price, source_key: `seller-${i}`, source_name: `Продавець ${i}`, product_url: `https://example.test/product-${i}`, match_type: 'exact', availability: i < 3 ? 'in_stock' : 'order_needed', part_type: 'original', lead_time_min: i < 3 ? 0 : 90 }));
    offers.push({ ...offers[0], title: 'Фара права матрична', part_number: '', match_type: 'probable', price_uah: 99000 });
    offers.push({ ...offers[0], product_url: 'https://example.test/wrong-side', title: 'Фара ліва', match_type: 'irrelevant', match_reason: 'Інша сторона деталі', price_uah: 100 });
    const market = { run: { id: 'run', status: 'complete', updated_at: new Date().toISOString() }, offers, summary: { items: [summarizeMarketItem(item, offers)] }, sources: [], should_refresh: false, can_search: true };
    let failSave = true;
    let saved;
    let supplierPayload;
    const requests = [];
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ path: url.pathname, method: request.method() });
      let body = {};
      if (url.pathname.endsWith('/market-research')) body = market;
      else if (url.pathname === '/api/admin/market-feedback') {
        const payload = request.postDataJSON();
        const row = market.offers.find(row => JSON.stringify([row.item_key, row.source_key, row.product_url]) === payload.offer_key);
        row.feedback = payload.undo ? null : { rejected: true, reason: payload.reason };
        row.match_type = payload.undo ? 'exact' : 'irrelevant';
        market.summary.items = [summarizeMarketItem(item, market.offers)];
        body = market;
      }
      else if (url.pathname.endsWith('/supplier-requests') && request.method() === 'POST') {
        supplierPayload = request.postDataJSON();
        body = { order, supplier_request: { supplier_url: 'https://example.test/supplier-access' } };
      }
      else if (url.pathname === '/api/admin/orders/smoke-order') {
        if (request.method() === 'PATCH') {
          if (failSave) { failSave = false; return route.fulfill({ status: 500, json: { error: 'Simulated save failure' } }); }
          saved = request.postDataJSON(); order = { ...order, ...saved };
        }
        body = detail();
      } else if (url.pathname === '/api/admin/orders') body = { orders: [order, { ...order, id: 'duplicate', order_number: 'O-900002' }], total: 2 };
      else if (url.pathname === '/api/admin/summary') body = { totals: {}, sources: [], campaigns: [], daily: [] };
      else if (url.pathname === '/api/admin/market-search') body = { history: [], ...market };
      else if (url.pathname === '/api/admin/suppliers') body = { suppliers: [{ id: 'byd', name: 'BYD', active: 1 }] };
      return route.fulfill({ json: body });
    });
    await page.goto(`${origin}/admin/`);
    await page.locator('[data-open-order="smoke-order"]').first().waitFor();
    assert.equal(await page.locator('#search').isVisible(), true);
    await page.screenshot({ path: `${output}/orders-${width}.png`, fullPage: true });
    await page.locator('[data-open-order="smoke-order"]').first().click();
    const form = page.locator('[data-order-editor]');
    await form.locator('[name="status"]').waitFor();
    await page.locator('[data-order-detail-panel]').evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    const tabSize = await form.locator('.order-editor__tabs').evaluate((el) => ({ scrollWidth: el.scrollWidth, width: el.clientWidth, scrollHeight: el.scrollHeight, height: el.clientHeight, columns: getComputedStyle(el).gridTemplateColumns }));
    await page.screenshot({ path: `${output}/order-${width}.png` });
    assert.equal(tabSize.scrollWidth > tabSize.width + 1 || tabSize.scrollHeight > tabSize.height + 1, false, JSON.stringify(tabSize));
    const phoneBox = await form.locator('.order-editor__identity a.orders-table__contact').boundingBox();
    assert.ok(phoneBox.height < 35 && phoneBox.width > 100, `Contact must stay readable: ${JSON.stringify(phoneBox)}`);
    const tabsBox = await form.locator('.order-editor__tabs').boundingBox();
    assert.ok(tabsBox.y + tabsBox.height < 570, 'Header must leave room for working fields');
    const emptyCells = page.locator('[data-orders] td:empty');
    if (width <= 760) for (const cell of await emptyCells.all()) assert.equal(await cell.isVisible(), false);
    assert.equal(await form.locator('.order-editor__tabs [data-order-tab]').count(), 5);
    assert.equal(await form.locator('[data-order-pane="messages"]').count(), 0);
    await page.screenshot({ path: `${output}/order-${width}.png` });
    await form.locator('[name="manager_notes"]').fill('Незбережена нотатка');
    await form.locator('[data-order-tab="market"]').click();
    await form.locator('.market-price-group').first().waitFor();
    await form.locator('[data-market-filter-group="availability"][data-market-filter-value="in_stock"]').click();
    assert.equal(await form.locator('.market-price-group').count(), 1);
    assert.match(await form.locator('.market-price-group').innerText(), /2\s?000/);
    await form.locator('[data-copy-market-summary]').click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /2\s?000/);
    assert.doesNotMatch(copied, /99\s?000|6\s?000/);
    assert.equal(await form.locator('[data-order-save-bar]').isVisible(), true);
    await page.screenshot({ path: `${output}/market-${width}.png` });
    const colors = await form.locator('.market-trust-group > summary, .market-trust-group > h4').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    assert.equal(new Set(colors).size, 3, 'Three trust groups must have distinct colors and labels');
    assert.equal(await form.locator('.market-trust-group--irrelevant').getAttribute('open'), null);
    await form.locator('.market-trust-group--probable > summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/market-groups-${width}.png` });
    await form.locator('.market-trust-group--exact .market-offer__feedback summary').first().click();
    await form.locator('.market-trust-group--exact [data-market-feedback-save]').first().click();
    await form.locator('.market-trust-group--irrelevant [data-market-feedback-undo]').waitFor({ state: 'attached' });
    await form.locator('.market-trust-group--irrelevant > summary').click();
    await form.locator('[data-market-feedback-undo]').click();
    await page.waitForFunction(() => !document.querySelector('[data-market-feedback-undo]'));
    await form.locator('[data-market-filter-group="partType"][data-market-filter-value="oem"]').click();
    assert.equal(await form.locator('.market-price-group').count(), 0);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('[data-close-order]').last().click();
    assert.equal(await page.locator('[data-order-detail-panel]').getAttribute('aria-hidden'), 'false');
    await form.locator('[data-order-tab="main"]').click();
    assert.equal(await form.locator('[name="manager_notes"]').inputValue(), 'Незбережена нотатка');
    await form.locator('[name="status"]').selectOption('accepted');
    assert.equal(await form.locator('[data-status-message]').isVisible(), true);
    await form.locator('[name="notify_customer"]').uncheck();
    await form.locator('[data-order-save-bar] button').click();
    await form.locator('[data-order-save-error]:not([hidden])').waitFor();
    assert.equal(await form.locator('[name="manager_notes"]').inputValue(), 'Незбережена нотатка');
    await form.locator('[data-order-save-bar] button').click();
    await page.waitForFunction(() => document.querySelector('[data-save-state]')?.textContent === 'Усі зміни збережено');
    assert.equal(saved.notify_customer, '0');
    assert.equal(saved.manager_notes, 'Незбережена нотатка');
    await form.locator('[data-order-tab="payment"]').click();
    assert.equal(await form.locator('.supplier-payments__create').isVisible(), false);
    assert.equal(await form.locator('.supplier-payment-card__edit').isVisible(), false);
    assert.match(await form.locator('.supplier-payment-card__main').innerText(), /9\s?133/);
    await form.locator('summary').filter({ hasText: 'Квитанції' }).click();
    assert.equal(await form.locator('.supplier-receipt-links a').count(), 2);
    await page.screenshot({ path: `${output}/payment-${width}.png` });
    await form.locator('[data-order-tab="history"]').click();
    assert.equal(await form.locator('[data-order-save-bar]').isVisible(), false);
    await form.locator('[data-order-tab="suppliers"]').click();
    await form.locator('[data-order-to-china]').click();
    const china = page.locator('[data-china-preorder-form]');
    await china.waitFor({ state: 'visible' });
    assert.equal(await china.locator('[name="order_id"]').inputValue(), order.id);
    assert.equal(await china.locator('[data-china-order-search]').getAttribute('readonly') !== null, true);
    assert.equal(await china.locator('input[type="file"]').count() > 0, true);
    await china.locator('[name="supplier_name"]').selectOption('BYD');
    await china.locator('input[type="file"]').setInputFiles({ name: 'test-part.png', mimeType: 'image/png', buffer: await readFile(path.join(root, 'assets/images/logo.png')) });
    await page.waitForFunction(() => document.querySelector('[data-china-photo-data]')?.value.startsWith('data:image/'));
    await china.locator('[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-china-preorder-form] a[href="https://example.test/supplier-access"]'));
    assert.match(supplierPayload.image_url, /^data:image\//);
    assert.equal(supplierPayload.supplier_name, 'BYD');
    assert.equal(supplierPayload.item_name, 'Фара права');
    assert.equal('customer_phone' in supplierPayload, false);
    await page.screenshot({ path: `${output}/supplier-${width}.png` });
    const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth + 1, panels: [...document.querySelectorAll('[aria-hidden="false"]')].filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 2).map((el) => el.className) }));
    assert.deepEqual(overflow, { page: false, panels: [] });
    assert.equal(requests.some((request) => request.method !== 'GET' && !['/api/admin/orders/smoke-order', '/api/admin/orders/smoke-order/supplier-requests', '/api/admin/market-feedback'].includes(request.path)), false);
    await page.locator('[data-china-request-close]').last().click();
    await page.locator('.admin-tabs [data-admin-tab="analytics"]').click();
    assert.equal(await page.locator('[data-analytics-nav]').isVisible(), true);
    assert.equal(await page.locator('[data-google-ads-conversions]').isVisible(), false);
    await page.locator('[data-analytics-nav] [data-admin-tab="contacts"]').click();
    assert.equal(await page.locator('[data-admin-view="contacts"]').isVisible(), true);
    await page.locator('.admin-header [data-filter-menu-button]').click();
    await page.locator('.admin-header [data-admin-tab="delivery"]').click();
    assert.equal(await page.locator('[data-shipping-form]').isVisible(), false);
    await page.locator('[data-new-shipping-carrier]').click();
    assert.equal(await page.locator('[data-shipping-form]').isVisible(), true);
    await page.locator('[data-close-shipping-form]').click();
    assert.equal(await page.locator('[data-shipping-form]').isVisible(), false);
    await page.goto(`${origin}/admin/shipping-pricelist/`);
    await page.locator('[data-profile] option').first().waitFor({ state: 'attached' });
    const calculatorBox = await page.locator('[data-shipping-calculator]').boundingBox();
    assert.ok(calculatorBox.y < 550, 'Calculator must come before methodology');
    assert.equal(await page.locator('.shipping-source-card').isVisible(), false);
    await page.screenshot({ path: `${output}/shipping-calculator-${width}.png` });
    await context.close();
    console.log(`PASS ${width}px: navigation, market filters/copy, dirty guard, failed/successful save, payments, supplier link, overflow`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
