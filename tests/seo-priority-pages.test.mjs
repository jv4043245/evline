import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'node-html-parser';
import { priorityPartsPages, withPriorityPartsContent } from '../scripts/lib/parts-priority-content.mjs';
import { withResponsivePartsImages } from '../scripts/lib/responsive-parts-images.mjs';
import { withFooterContacts } from '../scripts/lib/footer-contacts.mjs';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

test('ten priority pages have unique guides, real evidence and working internal links', async () => {
  const headings = new Set();
  for (const page of priorityPartsPages) {
    for (const pathname of [page.uk, page.ru]) {
      const html = await read(`${pathname.slice(1)}index.html`);
      const document = parse(html);
      const guide = document.querySelector('[data-parts-selection]');
      assert.ok(guide, pathname);
      assert.equal(document.querySelectorAll('[data-parts-selection]').length, 1);
      const heading = guide.querySelector('h2').textContent;
      assert.ok(!headings.has(heading));
      headings.add(heading);
      assert.equal(guide.querySelectorAll('dt').length, 3);
      assert.match(guide.textContent, /не є підтвердженням сумісності|не является подтверждением совместимости/);
      for (const link of guide.querySelectorAll('a')) {
        const url = new URL(link.getAttribute('href'), 'https://evline.com.ua');
        const file = url.pathname.endsWith('/') ? `${url.pathname.slice(1)}index.html` : url.pathname.slice(1);
        await access(new URL(file, root));
      }
      assert.equal(withPriorityPartsContent(html), html, `content sync: ${pathname}`);
      assert.equal(withResponsivePartsImages(html), html, `image sync: ${pathname}`);
      assert.equal(withFooterContacts(html), html, `footer sync: ${pathname}`);
      const form = document.querySelector('form[data-telegram-parts-form]');
      assert.deepEqual(form.querySelectorAll('input').map(input => input.getAttribute('name')), ['car', 'vin', 'part', 'phone']);
      assert.ok(document.querySelector('script[src*="assets/js/main.js"]'));
      assert.match(html, /AW-18146559745/);
    }
  }
});

test('responsive home images keep originals, gallery and first-viewport priorities', async () => {
  for (const file of ['index.html', 'ru/index.html']) {
    const html = await read(file);
    const document = parse(html);
    assert.equal(withResponsivePartsImages(html), html);
    assert.equal(document.querySelectorAll('head link[rel="stylesheet"]').length, 0);
    const footerStyle = document.querySelector('style[data-footer-contacts-inline]');
    assert.equal(footerStyle.textContent.trim(), (await read('assets/css/footer-contacts.css')).trim());
    assert.equal(withFooterContacts(html), html);
    assert.equal(document.querySelectorAll('.gal[data-full]').length, 17);
    assert.equal(document.querySelectorAll('.hero-proof img[fetchpriority="high"]').length, 1);
    for (const img of document.querySelectorAll('.hero-proof img, .proof-card__media img')) {
      assert.ok(img.getAttribute('sizes'));
      assert.ok(img.getAttribute('width'));
      assert.ok(img.getAttribute('height'));
      for (const candidate of img.getAttribute('srcset').split(', ')) {
        const [src] = candidate.split(' ');
        await access(new URL(src.slice(1), root));
      }
    }
  }
});

test('advertising landings remain excluded from organic enhancements and indexing', async () => {
  for (const file of ['запчастини-з-китаю/index.html', 'ru/zapchasti-iz-kitaya/index.html']) {
    const html = await read(file);
    const document = parse(html);
    assert.match(document.querySelector('meta[name="robots"]').getAttribute('content'), /noindex/);
    assert.equal(withPriorityPartsContent(html), html);
    assert.equal(document.querySelectorAll('[data-parts-selection]').length, 0);
  }
});
