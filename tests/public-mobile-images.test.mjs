import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'node-html-parser';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const fileSize = async url => (await stat(new URL(`../${url}`, import.meta.url))).size;

for (const file of ['index.html', 'ru/index.html', 'запчастини-з-китаю/index.html']) {
  test(`${file}: mobile gallery keeps the whole photo and opens the original`, async () => {
    const html = await read(file);
    assert.match(html, /\.gal\{[^}]*width:auto[^}]*object-fit:contain/);
    const images = parse(html).querySelectorAll('#galrow img');
    assert.equal(images.length, 17);
    for (const img of images) {
      const src = img.getAttribute('src');
      const full = img.getAttribute('data-full');
      assert.match(src, /assets\/thumbs\/gallery-\d+\.webp$/);
      assert.equal(path.basename(full, '.jpg'), path.basename(src, '.webp'));
      assert.equal(img.getAttribute('loading'), 'lazy');
      assert.ok(Number(img.getAttribute('width')) > 0 && Number(img.getAttribute('height')) > 0);
    }
    assert.match(html, /\.src=g\.dataset\.full\|\|/);
  });
}

test('Russian advertising gallery defers small previews instead of eager original JPEGs', async () => {
  const html = await read('ru/zapchasti-iz-kitaya/index.html');
  const images = parse(html).querySelectorAll('.parts-gallery__rail img');
  assert.equal(images.length, 11);
  let originals = 0;
  let previews = 0;
  for (const img of images) {
    const src = img.getAttribute('src');
    assert.match(src, /assets\/thumbs\/parts-gallery-\d+\.webp$/);
    const name = path.basename(src, '.webp');
    originals += await fileSize(`assets/images/${name}.jpg`);
    previews += await fileSize(`assets/thumbs/${name}.webp`);
    assert.equal(img.getAttribute('loading'), 'lazy');
    assert.ok(Number(img.getAttribute('width')) > 0 && Number(img.getAttribute('height')) > 0);
  }
  assert.ok(previews < originals / 2);
  const css = await read('assets/css/parts-ad.css');
  assert.match(css, /\.parts-gallery__rail img\s*\{[^}]*object-fit:contain/);
});

test('partner pages show the same locally hosted diagram without a third-party request', async () => {
  const asset = 'assets/images/sto/bumper-assembly-us20110285152a1.png';
  const png = await readFile(new URL(`../${asset}`, import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  for (const directory of ['spivpratsya-sto', 'spivpratsya-sto-v2', 'ru/sotrudnichestvo-sto', 'ru/sotrudnichestvo-sto-v2']) {
    const html = await read(`${directory}/index.html`);
    const diagram = parse(html).querySelector(`img[src="/${asset}"]`);
    assert.equal(Number(diagram?.getAttribute('width')), png.readUInt32BE(16));
    assert.equal(Number(diagram?.getAttribute('height')), png.readUInt32BE(20));
  }
});
