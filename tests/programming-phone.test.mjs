import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';

const root = path.resolve(import.meta.dirname, '..');
const phone = '+380630630304';
const partsPhone = '+380935251024';
const skipped = new Set(['node_modules', 'admin', 'supplier', '.git', '.local-data', '.wrangler']);
function htmlFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return skipped.has(entry.name) ? [] : htmlFiles(file);
    return entry.name.endsWith('.html') && !entry.name.endsWith('-test.html') ? [file] : [];
  });
}
const pages = htmlFiles().map(file => ({ file: path.relative(root, file), html: readFileSync(file, 'utf8') }));
const standalone = ['byd.html', 'zeekr.html', 'ru/byd.html', 'ru/zeekr.html'];
const programming = pages.filter(page => standalone.includes(page.file) || parse(page.html).querySelector('form[data-byd-seo-form]'));

test('every programming landing page uses the technical phone in calls, visible text and structured data', () => {
  assert.ok(programming.length >= 40);
  for (const { file, html } of programming) {
    const dom = parse(html);
    const links = dom.querySelectorAll('a[href^="tel:"]');
    assert.ok(links.length >= 3, file);
    for (const link of links) assert.equal(link.getAttribute('href'), `tel:${phone}`, file);
    assert.match(dom.textContent, /\+38 \(063\) 063-03-04/, file);
    assert.ok(!html.includes(partsPhone) && !html.includes('525-10-24'), file);
    const schemas = dom.querySelectorAll('script[type="application/ld+json"]').flatMap(script => {
      const json = JSON.parse(script.textContent);
      return json['@graph'] || [json];
    });
    const businesses = schemas.filter(schema => schema['@type'] === 'AutoRepair');
    assert.ok(businesses.length, file);
    for (const business of businesses) assert.equal(business.telephone, phone, file);
    assert.ok(dom.querySelector('a[href*="t.me/evline_tech"]'), file);
  }
});

test('parts pages keep their original phone; the technical phone is confined to programming cross-sell', () => {
  const programmingFiles = new Set(programming.map(page => page.file));
  let crossSell = 0;
  for (const { file, html } of pages.filter(page => !programmingFiles.has(page.file))) {
    const dom = parse(html);
    for (const link of dom.querySelectorAll('a[href^="tel:"]')) {
      if (link.getAttribute('href') === `tel:${phone}`) {
        assert.ok(link.closest('section')?.querySelector('a[href*="t.me/evline_tech"]'), file);
        crossSell++;
      } else {
        assert.equal(link.getAttribute('href'), `tel:${partsPhone}`, file);
      }
    }
    if (dom.querySelector('a[href^="tel:"]')) assert.ok(dom.querySelector(`a[href="tel:${partsPhone}"]`), file);
  }
  assert.equal(crossSell, 4);
});

test('programming templates preserve the separate technical contact on rebuild', () => {
  const seo = readFileSync(path.join(root, 'scripts/build-byd-seo-pages.mjs'), 'utf8');
  assert.ok(seo.includes(`telephone: "${phone}"`));
  assert.ok(!seo.includes(partsPhone));
  const ru = readFileSync(path.join(root, 'scripts/build-ru-version.mjs'), 'utf8');
  const schema = ru.split('\n').find(line => line.includes('"url":"https://evline.com.ua/ru/byd"'));
  assert.equal(JSON.parse(schema).telephone, phone);
});
