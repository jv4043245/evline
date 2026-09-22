import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.SMOKE_OUTPUT || '/tmp/evline-telegram-intake';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!file.startsWith(`${root}/`)) throw new Error('outside root');
    const contents = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }); res.end(contents);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const chat = { id: 'synthetic:20001', generation: 2, display_name: 'Тестовий клієнт', username: 'synthetic_customer', mode: 'auto', state: 'review', updated_at: '2026-09-22T12:00:00Z', order_id: '00000000-0000-4000-8000-000000000001', order_number: 'O-900001', snapshot_json: JSON.stringify({ item_name: 'права передня дверь', car: 'BYD Yuan Plus 2023' }), proposal_json: JSON.stringify({ fields: { item_name: 'ліва передня дверь' }, evidence: { item_name: [{ message_id: 2, quote: 'Помилився, ліва' }] } }) };
    const detail = { chat, messages: [{ message_id: 1, role: 'customer', body: 'Тестова заявка. BYD Yuan Plus 2023. Потрібна права передня дверь.\nАртикул: TEST-12345678901234567890123456789012345678901234567890', sent_at: chat.updated_at }, { message_id: 2, role: 'customer', body: 'Помилився, ліва', sent_at: chat.updated_at }], changes: [] };
    const writes = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/admin/telegram-intake') {
        if (request.method() === 'POST') { writes.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ json: url.searchParams.has('chat') ? detail : { connections: [], chats: [chat], ai_available: true } });
      }
      if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected API: ${url.pathname}`);
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${origin}/admin/telegram/`);
    await page.locator('[data-chat]').click();
    await page.getByLabel('Телефон', { exact: true }).fill('+380000000002');
    await page.getByRole('button', { name: 'Підтвердити зміни', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-fields] button[type="submit"]')?.disabled === false);
    assert.equal(writes.length, 1); assert.equal(writes[0].fields.customer_phone, '+380000000002'); assert.equal(writes[0].generation, 2);
    assert.equal(await page.locator('.brand img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
    for (const field of await page.locator('input, textarea, form button').all()) {
      const box = await field.boundingBox();
      assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1, `Clipped control at ${width}`);
    }
    await page.screenshot({ path: path.join(output, `telegram-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: dialogue, editable form, protected API payload, no overflow, no real submissions`);
  }
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
