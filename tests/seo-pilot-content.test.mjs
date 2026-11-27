import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'node-html-parser';

const routes = [
  '/zapchastyny-xiaomi/su7/',
  '/zapchastyny-xiaomi/yu7/',
  '/zapchastyny-byd/song-plus/',
  '/zapchastyny-byd/song-l/',
  '/zapchastyny-zeekr/x/',
];
const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const sitemap = await read('sitemap.xml');

for (const route of routes) {
  test(`${route} keeps its canonical URL and FAQ markup aligned with public answers`, async () => {
    const doc = parse(await read(`${route.slice(1)}index.html`));
    const url = `https://evline.com.ua${route}`;
    assert.deepEqual(doc.querySelectorAll('link[rel="canonical"]').map(e => e.getAttribute('href')), [url]);
    assert.ok(sitemap.includes(`<loc>${url}</loc>`));
    assert.equal(doc.querySelectorAll('h1').length, 1);
    const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]').text);
    const faq = data['@graph'].find(node => node['@type'] === 'FAQPage');
    const visible = doc.querySelectorAll('.parts-faq__grid article').map(e => [
      e.querySelector('h3').text.trim(),
      e.querySelector('p').text.trim(),
    ]);
    assert.ok(visible.length > 0);
    assert.deepEqual(faq.mainEntity.map(e => [e.name, e.acceptedAnswer.text]), visible);
  });
}

test('the Ukrainian Song L buyer guidance matches the generator source', async () => {
  const config = JSON.parse(await read('scripts/parts-demand-pages.json'));
  const { uk } = config.pages.find(p => p.key === 'song-l');
  const doc = parse(await read('zapchastyny-byd/song-l/index.html'));
  const proof = doc.querySelector('.brand-seo-proof__text');
  assert.equal(proof.querySelector('h2').text, uk.proofTitle);
  assert.equal(proof.querySelector('p').text, uk.proofText);
  const bumper = doc.querySelector('.brand-seo-section--soft .parts-section-head');
  assert.equal(bumper.querySelector('h2').text, uk.secondaryTitle);
  assert.equal(bumper.querySelector('p').text, uk.secondaryIntro);
});
