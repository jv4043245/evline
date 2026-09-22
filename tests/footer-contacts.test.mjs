import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { publicHtmlFiles } from '../scripts/lib/seller-identity.mjs';
import { withFooterContacts } from '../scripts/lib/footer-contacts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('all public footers contain localized static parts messenger links', async () => {
  let count = 0;
  for (const file of await publicHtmlFiles(root)) {
    const html = await readFile(file, 'utf8');
    const document = parse(html);
    if (!document.querySelector('footer')) continue;
    assert.equal(document.querySelectorAll('footer [data-footer-contacts]').length, 1, file);
    assert.equal(document.querySelectorAll('head [data-footer-contacts-style]').length, 1, file);
    const footer = document.querySelector('[data-footer-contacts]');
    const ru = document.querySelector('html').getAttribute('lang').startsWith('ru');
    assert.equal(footer.querySelector('strong').textContent, ru ? 'Менеджер по запчастям' : 'Менеджер із запчастин', file);
    const links = footer.querySelectorAll('a');
    assert.deepEqual(links.map(a => a.getAttribute('href')), ['https://wa.me/380935251024', 'viber://chat?number=%2B380935251024'], file);
    for (const link of links) {
      assert.equal(link.getAttribute('data-contact-intent'), 'parts', file);
      assert.ok(link.getAttribute('aria-label'), file);
      const icon = await readFile(new URL(`..${link.querySelector('img').getAttribute('src')}`, import.meta.url), 'utf8');
      assert.match(icon, /<svg/);
    }
    assert.equal(withFooterContacts(html), html, `Must be idempotent: ${file}`);
    count++;
  }
  assert.ok(count > 100, `Expected public site coverage, got ${count}`);
});

test('footer sync preserves existing content, forms and business phone links', () => {
  for (const language of ['uk-UA', 'ru-UA']) {
    const original = `<html lang="${language}"><head></head><body><form action="/api/leads"><input name="phone"></form><footer><a href="tel:+380630630304">Existing phone</a></footer></body></html>`;
    const updated = withFooterContacts(original);
    const withoutAdditions = updated.replace(/<link\b[^>]*data-footer-contacts-style>\n/, '').replace(/\n<section\b[^>]*data-footer-contacts\b[^>]*>[\s\S]*?<\/section>/, '');
    assert.equal(withoutAdditions, original);
    assert.equal(withFooterContacts(updated), updated);
  }
  assert.equal(withFooterContacts('<html><head></head><body>No footer</body></html>'), '<html><head></head><body>No footer</body></html>');
});
