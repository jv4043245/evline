import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.SMOKE_OUTPUT || '/tmp/evline-footer-contacts';
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!file.startsWith(`${root}/`)) throw new Error('outside root');
    const contents = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream' });
    res.end(contents);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const events = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/contact-events') {
        events.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected API: ${url.pathname}`);
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const pathname of ['/', '/ru/', '/byd.html', '/ru/zeekr.html', '/spivpratsya-sto/', '/ru/zapchasti-byd/', '/onovlennya-byd/', '/privacy/']) {
      await page.goto(`${origin}${pathname}?gclid=synthetic-footer-test`);
      await page.waitForFunction(() => Boolean(window.EVLineContactTracking));
      const consent = page.locator('[data-consent="necessary"]');
      if (await consent.isVisible()) await consent.click();
      // Exercise clicks locally; never launch native apps or send real CRM events.
      await page.evaluate(() => document.addEventListener('click', event => {
        if (event.target.closest('[data-footer-contacts] a')) event.preventDefault();
      }));
      const footer = page.locator('[data-footer-contacts]');
      await footer.scrollIntoViewIfNeeded();
      const links = footer.locator('a');
      assert.equal(await links.count(), 2);
      const bounds = [];
      for (let i = 0; i < 2; i++) {
        const link = links.nth(i);
        const rect = await link.boundingBox();
        assert.ok(rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= width + 1, `${pathname}: button outside ${width}px viewport`);
        bounds.push(rect);
        assert.ok(await link.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), `${pathname}: missing icon`);
        const before = events.length;
        await link.click();
        for (let attempt = 0; attempt < 20 && events.length === before; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(events.length, before + 1, pathname);
        assert.equal(events.at(-1).channel, i ? 'viber' : 'whatsapp');
        assert.equal(events.at(-1).intent_type, 'parts');
        assert.equal(events.at(-1).gclid, 'synthetic-footer-test');
        assert.equal(events.at(-1).destination, await link.getAttribute('href'));
      }
      assert.ok(bounds[0].x + bounds[0].width <= bounds[1].x || bounds[0].y + bounds[0].height <= bounds[1].y, `${pathname}: buttons overlap`);
      if (['/', '/ru/zeekr.html', '/privacy/'].includes(pathname)) await page.screenshot({ path: path.join(output, `${pathname.replaceAll('/', '_')}-${width}.png`) });
    }
    assert.deepEqual(errors, [], `Unexpected browser errors at ${width}px`);
    await context.close();
    console.log(`PASS ${width}px: eight pages, visible icons, 16 tracked clicks, no overlap or real submissions`);
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
  const page = await noScript.newPage();
  await page.goto(origin);
  assert.equal(await page.locator('[data-footer-contacts] a').count(), 2);
  await noScript.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
