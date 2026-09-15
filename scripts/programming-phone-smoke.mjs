import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(import.meta.dirname, '..');
const output = process.env.SMOKE_OUTPUT || '/tmp/evline-programming-phone';
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
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const events = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/contact-events') {
        events.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.startsWith('/api/')) throw new Error(`Unexpected API call: ${url.pathname}`);
      return route.continue();
    });
    const page = await context.newPage();
    for (const pathname of ['/byd.html', '/ru/byd.html', '/zeekr.html', '/ru/zeekr.html', '/onovlennya-byd/', '/ru/multimedia-byd/', '/', '/ru/', '/запчастини-з-китаю/', '/ru/zapchasti-iz-kitaya/']) {
      await page.goto(`${origin}${pathname}?gclid=synthetic-phone-test`);
      await page.waitForFunction(() => Boolean(window.EVLineContactTracking));
      // Inspect tracked clicks without handing off to a dialer or any real API.
      await page.evaluate(() => document.addEventListener('click', event => {
        if (event.target.closest('a[href^="tel:"]')) event.preventDefault();
      }));
      const phone = page.locator('a[href="tel:+380630630304"]').first();
      await phone.click();
      await page.waitForFunction(() => window.dataLayer?.some(event => event.event === 'evline_contact_click'));
      assert.equal(events.at(-1)?.destination, 'tel:+380630630304', pathname);
      assert.equal(events.at(-1)?.intent_type, 'byd', pathname);
      assert.equal(events.at(-1)?.gclid, 'synthetic-phone-test', pathname);
      const rect = await phone.boundingBox();
      assert.ok(rect.width > 0 && rect.x >= 0 && rect.x + rect.width <= width + 1, pathname);
      if (['/byd.html', '/ru/zeekr.html', '/onovlennya-byd/', '/'].includes(pathname)) {
        await page.screenshot({ path: path.join(output, `${pathname.replaceAll('/', '_') || 'home'}-${width}.png`) });
      }
    }
    await context.close();
    console.log(`PASS ${width}px: 10 pages, phone links, tracked technical intent, preserved attribution`);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
