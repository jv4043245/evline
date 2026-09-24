import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fromOrder } from '../admin/documents/model.js';
import { onRequest as middleware } from '../functions/api/admin/_middleware.js';
import { onRequestGet, onRequestPost } from '../functions/api/admin/orders/[id]/documents.js';
import { onRequestPost as settings } from '../functions/api/admin/document-settings.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..'), output = process.env.SMOKE_OUTPUT || '/tmp/evline-order-documents';
await mkdir(output, { recursive: true });
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir(path.join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) db.exec(await readFile(path.join(root, 'migrations', file), 'utf8'));
const env = { ADMIN_TOKEN: 'synthetic-admin', DB: { prepare(sql) { const statement = db.prepare(sql); let args = []; return {
  bind(...values) { args = values; return this; }, async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
}; } } };
const order = { id: 'test-document-order', order_number: 'O-900001', customer_name: 'Тестовий Покупець', customer_phone: '+380000000001', item_name: 'Бампер передній BYD Yuan Plus', car: 'BYD Yuan Plus 2023', vin: 'TESTVIN00000000001', revenue_uah: 10000, type: 'parts' };
db.prepare('INSERT INTO orders(id,created_at,updated_at,order_number,customer_name,customer_phone,item_name,car,vin,revenue_uah,type) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(order.id, '2026-09-24', '2026-09-24', order.order_number, order.customer_name, order.customer_phone, order.item_name, order.car, order.vin, order.revenue_uah, order.type);
const fixture = fromOrder(order);
const ibanBody = '3000010000000000000000000';
Object.assign(fixture.seller, { name: 'ФОП Тестовий Продавець', tax_id: '0000000000', address: 'Тестова адреса продавця', iban: 'UA' + String(98 - Number(BigInt(ibanBody + '301000') % 97n)).padStart(2, '0') + ibanBody, bank: 'Тестовий банк' });
Object.assign(fixture.buyer, { address: 'Тестова адреса покупця', purpose: 'Особисті потреби' });
Object.assign(fixture, { condition: 'Новий, бампер без кріплень', warranty: 'Погоджені гарантійні умови', tax: 'Без ПДВ', included: 'Товар, пакування, міжнародна доставка, митні платежі', prepayment: '5000', prepayment_due: 'Після підписання', balance_due: 'До передачі', route: 'Море', forecast: '70-90 днів', deadline_days: '90', handover: 'Київ, за погодженням', recipient: 'Тестовий Покупець, +380000000001', partial: 'Лише після окремого погодження', reviewed: false });
fixture.items[0].kind = 'original';
fixture.seller_profile_id = 'primary';
db.prepare('INSERT INTO document_seller_settings(id,revision,updated_at,actor,data_json) VALUES(1,1,?,?,?)').run('2026-09-24', 'test', JSON.stringify(fixture.seller));
Object.assign(fixture.receipt, { enabled: true, amount: '5000', date: '2026-09-24', method: 'IBAN', reference: 'Тестовий платіж № TEST-001', confirmed: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const body = []; for await (const chunk of req) body.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(body.length ? { body: Buffer.concat(body) } : {}) });
      const next = () => url.pathname.endsWith('/documents') ? (req.method === 'GET' ? onRequestGet : onRequestPost)({ env, request, params: { id: order.id } }) : url.pathname === '/api/admin/document-settings' ? settings({ env, request }) : Response.json({ error: 'Unexpected API' }, { status: 404 });
      const response = await middleware({ env, request, next }); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = path.join(root, url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
    if (!file.startsWith(`${root}/`)) throw new Error('outside root');
    const contents = await readFile(file); res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }); res.end(contents);
  } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    db.exec('DELETE FROM order_documents');
    db.prepare('INSERT INTO order_documents(id,order_id,revision,created_at,actor,status,data_json) VALUES(?,?,?,?,?,?,?)').run('fixture', order.id, 1, '2026-09-24T09:00:00Z', 'Тестовий менеджер', 'draft', JSON.stringify(fixture));
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(() => localStorage.setItem('evline_admin_token', 'synthetic-admin'));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/admin/documents/?order=${order.id}`);
    await page.locator('[data-workspace]').waitFor({ state: 'visible' });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`Compact initial editor ${width}px: ${height}px high`);
    assert.ok(height < (width > 760 ? 1250 : 2400), `Compact editor unexpectedly tall at ${width}`);
    const heading = await page.locator('.page-heading').boundingBox();
    assert.ok(heading.height <= (width > 760 ? 32 : 110), `Header unexpectedly tall at ${width}`);
    if (width > 760) {
      const title = await page.locator('.page-identity h1').boundingBox();
      for (const selector of ['[data-order-number]', '[data-customer]']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.y >= title.y && box.y + box.height <= title.y + title.height, `Header not on one line at ${width}`);
      }
    }
    // Long customer names must wrap without covering the document status.
    const customerHeading = await page.locator('[data-customer]').textContent();
    await page.locator('[data-customer]').evaluate(el => { el.textContent = 'Товариство з обмеженою відповідальністю '.repeat(4) + '+380000000001'; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Long header overflow at ${width}`);
    const state = await page.locator('[data-state]').boundingBox();
    for (const element of await page.locator('.page-identity > *').all()) {
      const box = await element.boundingBox();
      assert.ok(box.x + box.width <= state.x || box.y + box.height <= state.y || box.y >= state.y + state.height, `Header overlaps status at ${width}`);
    }
    await page.locator('[data-customer]').evaluate((el, value) => { el.textContent = value; }, customerHeading);
    const spacing = await page.locator('.seller-section').evaluate(el => ({ padding: getComputedStyle(el).paddingTop, gap: getComputedStyle(document.querySelector('.fields')).rowGap }));
    assert.equal(spacing.padding, '12px'); assert.equal(spacing.gap, '8px');
    const sectionColors = await page.locator('#editor > .editor-section').evaluateAll(elements => elements.map(el => ({
      classes: el.className, background: getComputedStyle(el).backgroundColor,
      radius: getComputedStyle(el).borderRadius, shadow: getComputedStyle(el).boxShadow,
    })));
    for (const [section, color] of Object.entries({ 'seller-section': 'rgb(237, 240, 242)', 'buyer-section': 'rgb(255, 255, 255)', 'specification-section': 'rgb(238, 245, 250)', 'finance-section': 'rgb(237, 247, 240)' })) {
      const matches = sectionColors.filter(s => s.classes.split(' ').includes(section));
      assert.ok(matches.length); assert.ok(matches.every(s => s.background === color), `Wrong ${section} background at ${width}`);
    }
    assert.ok(sectionColors.every(s => s.radius === '0px' && s.shadow === 'none'), 'Sections must remain flat bands');
    assert.equal(await page.locator('[data-path="buyer.name"]').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('[data-disclosure="buyer"]').getAttribute('open'), null);
    await page.locator('[data-disclosure="buyer"] > summary').focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Адреса', { exact: true }).fill('Тестова адреса покупця');
    await page.getByLabel('ПІБ / найменування', { exact: true }).fill('Тестова Покупчиня');
    await page.locator('[data-action="save"]').click(); await page.getByText('Збережено версію 2', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-disclosure="buyer"]').getAttribute('open'), '');
    await page.locator('[data-disclosure="buyer"] > summary').click();
    assert.equal(db.prepare('SELECT count(*) n FROM order_documents').get().n, 2);
    await page.locator('[data-versions]').selectOption('fixture'); await page.getByLabel('ПІБ / найменування', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-path="buyer.name"]')?.value === 'Тестовий Покупець');
    assert.equal(await page.locator('[data-back]').getAttribute('href'), `/admin/?order=${order.id}`);
    if (width === 1440) {
      await page.locator('[data-action="add-seller"]').click();
      await page.locator('[data-new-seller-name]').fill('Фізична особа-підприємець Другий Тестовий Продавець');
      await page.locator('[data-action="create-seller"]').click();
      await page.locator('[data-seller-dialog]').waitFor({ state: 'hidden' });
      for (const [key, value] of Object.entries(fixture.seller)) if (key !== 'name') await page.locator(`[data-path="seller.${key}"]`).fill(value);
      await page.locator('[data-path="seller.tax_status"]').fill('Тестовий податковий статус');
      await page.locator('[data-action="save-seller"]').click();
      await page.getByText('Реквізити цього ФОПа збережено', { exact: true }).waitFor();
    } else {
      page.once('dialog', d => d.accept());
      await page.locator('[data-seller-profile]').selectOption({ label: 'Другий Тестовий Продавець' });
      await page.waitForFunction(() => document.querySelector('[data-path="seller.name"]')?.value.includes('Другий'));
    }
    assert.equal(await page.locator('[data-path="buyer.name"]').inputValue(), 'Тестовий Покупець');
    assert.equal(await page.locator('[data-path="items.0.price"]').inputValue(), '10000.00');
    if (width === 1440) {
      await page.locator('[data-output-mode]').selectOption('agreement');
      await page.locator('[data-disclosure="delivery"] > summary').click();
      await page.locator('[data-path="forecast"]').fill('');
      await page.locator('[data-disclosure="delivery"] > summary').click();
      await page.locator('[data-reviewed]').check();
      await page.locator('[data-action="pdf"]').click();
      await page.locator('[data-error]').filter({ hasText: 'Прогноз доставки' }).waitFor();
      assert.equal(await page.locator('[data-disclosure="delivery"]').getAttribute('open'), '');
      assert.equal(db.prepare('SELECT count(*) n FROM order_documents').get().n, 2);
      await page.locator('[data-path="forecast"]').fill(fixture.forecast);
      await page.locator('[data-output-mode]').selectOption('invoice');
    }
    await page.locator('[data-path="invoice.mode"]').selectOption('prepayment');
    assert.equal(await page.locator('[data-disclosure="payment"]').getAttribute('open'), '');
    if (width <= 760) {
      const title = await page.locator('.page-identity h1').boundingBox();
      assert.equal(title.height, 28, `Unsaved status wraps mobile title at ${width}`);
    }
    await page.locator('[data-reviewed]').check();
    await page.screenshot({ path: path.join(output, `editor-${width}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Editor overflow at ${width}`);
    for (const field of await page.locator('input:visible,textarea:visible,select:visible,button:visible').all()) {
      const box = await field.boundingBox(); assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1, `Clipped control at ${width}`);
      if (await field.getAttribute('type') !== 'checkbox') assert.ok(box.height >= (width <= 760 ? 44 : 32), `Small control at ${width}`);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const actionBox = await page.locator('.toolbar-actions').boundingBox();
    assert.ok(actionBox.y >= 0 && actionBox.y + actionBox.height <= 1001, `Actions scrolled away at ${width}`);
    if (width > 760) {
      const toolbar = await page.locator('.document-toolbar').boundingBox(), sidebar = await page.locator('.document-sidebar').boundingBox();
      assert.ok(sidebar.y >= toolbar.y + toolbar.height, `Sidebar under toolbar at ${width}`);
    }
    await page.screenshot({ path: path.join(output, `actions-${width}.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `top-${width}.png`) });
    await page.locator('[data-view="preview"]').click();
    assert.match(await page.locator('[data-paper]').innerText(), /До сплати за цим рахунком: 5.000,00 грн/);
    assert.match(await page.locator('[data-paper]').innerText(), /Другий Тестовий Продавець/);
    await page.screenshot({ path: path.join(output, `preview-${width}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Preview overflow at ${width}`);
    const downloaded = page.waitForEvent('download'); await page.locator('[data-action="pdf"]').click();
    const file = await downloaded; assert.match(file.suggestedFilename(), /-invoice-v\d+.pdf$/); await file.saveAs(path.join(output, `invoice-${width}.pdf`));
    await page.waitForFunction(() => document.querySelector('[data-state]').textContent === 'Підготовлено');
    assert.equal(db.prepare('SELECT status FROM order_documents ORDER BY revision DESC LIMIT 1').get().status, 'ready');
    assert.equal(JSON.parse(db.prepare('SELECT data_json FROM order_documents WHERE id=?').get('fixture').data_json).seller.name, fixture.seller.name);
    await page.locator('[data-action="send"]').click(); await page.locator('[data-send-dialog]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-send-content]').innerText(), /^Рахунок ·/);
    assert.equal(await page.locator('[data-action="telegram"]').isVisible(), false, 'No unknown or group recipient');
    await page.getByRole('button', { name: 'Закрити', exact: true }).click();
    await page.locator('[data-action="copy"]').click();
    assert.doesNotMatch(await page.evaluate(() => navigator.clipboard.readText()), /Договір|Специфікація/);
    await page.locator('[data-output-mode]').selectOption('agreement');
    assert.equal(await page.locator('[data-paper] h2').count(), 2);
    const agreementDownload = page.waitForEvent('download'); await page.locator('[data-action="pdf"]').click();
    const agreement = await agreementDownload; assert.match(agreement.suggestedFilename(), /-agreement-v\d+.pdf$/); await agreement.saveAs(path.join(output, `agreement-${width}.pdf`));
    await page.locator('[data-action="send"]').click(); await page.locator('[data-send-dialog]').waitFor({ state: 'visible' });
    assert.match(await page.locator('[data-send-content]').innerText(), /^Договір і специфікація ·/);
    await page.getByRole('button', { name: 'Закрити', exact: true }).click();
    if (width === 1440) {
      await page.locator('[data-action="copy"]').click(); assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Договір замовлення/);
      const popupEvent = page.waitForEvent('popup'); await page.locator('[data-action="print"]').click();
      const popup = await popupEvent; await popup.waitForURL('blob:**'); await popup.close();
      await page.locator('[data-view="edit"]').click();
      db.prepare('UPDATE orders SET customer_name=?,customer_phone=? WHERE id=?').run('Виправлено у замовленні', '+380000000009', order.id);
      await page.locator('[data-action="refresh-order"]').click(); await page.locator('[data-refresh-dialog]').waitFor({ state: 'visible' });
      await page.locator('.refresh-change').filter({ hasText: 'Виправлено у замовленні' }).filter({ hasText: 'Покупець' }).first().locator('input').check();
      await page.locator('[data-action="apply-order"]').click(); await page.locator('[data-refresh-dialog]').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-path="buyer.name"]').inputValue(), 'Виправлено у замовленні');
      assert.equal(await page.locator('[data-path="buyer.phone"]').inputValue(), '+380000000001');
      assert.equal(await page.locator('[data-path="seller.name"]').inputValue(), 'Фізична особа-підприємець Другий Тестовий Продавець');
      await page.locator('[data-back]').click(); await page.waitForURL(`${origin}/admin/?order=${order.id}`);
      assert.equal(JSON.parse(db.prepare('SELECT data_json FROM order_documents ORDER BY revision DESC LIMIT 1').get().data_json).buyer.name, 'Виправлено у замовленні');
      db.prepare('UPDATE orders SET customer_name=?,customer_phone=? WHERE id=?').run(order.customer_name, order.customer_phone, order.id);
    }
    assert.deepEqual(errors, []); await context.close();
    console.log(`PASS ${width}px: real protected API, edit/save/history/preview/PDF, no overflow, no external requests`);
  }
  // Exercise long line items and multi-page specification without changing live orders.
  const longData = structuredClone(fixture);
  longData.items = Array.from({ length: 18 }, (_, i) => ({ ...fixture.items[0], title: `Позиція ${i + 1}: декоративна накладка переднього бампера з логотипом, ліва та права сторона, чорна`, sku: `TEST-${i}-` + '1234567890'.repeat(9), notes: 'Погоджена комплектність і стан. '.repeat(6), price: '1234.56', quantity: 2 }));
  longData.reviewed = true;
  db.exec('DELETE FROM order_documents');
  db.prepare('INSERT INTO order_documents(id,order_id,revision,created_at,actor,status,data_json) VALUES(?,?,?,?,?,?,?)').run('long-fixture', order.id, 1, '2026-09-24T09:00:00Z', 'Тестовий менеджер', 'ready', JSON.stringify(longData));
  const longContext = await browser.newContext({ acceptDownloads: true }); await longContext.addInitScript(() => localStorage.setItem('evline_admin_token', 'synthetic-admin'));
  const page = await longContext.newPage(); await page.goto(`${origin}/admin/documents/?order=${order.id}`); await page.locator('[data-workspace]').waitFor({ state: 'visible' });
  await page.locator('[data-output-mode]').selectOption('all');
  const download = page.waitForEvent('download'); await page.locator('[data-action="pdf"]').click(); await (await download).saveAs(path.join(output, 'agreement-long.pdf')); await longContext.close();
  console.log('PASS long specification PDF');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); db.close(); }
