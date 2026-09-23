import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { currentDeliveryCopy } from '../scripts/lib/delivery-copy.mjs';

test('public delivery corrections are specific and idempotent', () => {
  const source = 'Авіа 14 днів · море 60 днів. Від 14 днів. Авиа от 14 дней. авіа 14 / море 60. width:14px; return 14; gallery-14.jpg';
  const result = currentDeliveryCopy(source);
  assert.equal(result, 'Авіа від 20 днів · море 60 днів. Від 20 днів. Авиа от 20 дней. авіа від 20 / море 60. width:14px; return 14; gallery-14.jpg');
  assert.equal(currentDeliveryCopy(result), result);
});

test('an unverified average is replaced with a minimum promise, not a fabricated new average', () => {
  assert.equal(currentDeliveryCopy('<b>14,5 днів</b><span>середній строк авіа</span>'), '<b>Від 20 днів</b><span>доставка авіа</span>');
  assert.equal(currentDeliveryCopy('<b>14,5 дней</b><span>средний срок авиа</span>'), '<b>От 20 дней</b><span>доставка авиа</span>');
});

test('historical testimonials and unrelated sea transit are preserved', () => {
  const source = 'авіа дійшло за 16 днів. Через два тижні вже стояла на авто. Море — від 60 днів.';
  assert.equal(currentDeliveryCopy(source), source);
});

for (const file of ['index.html', 'ru/index.html', 'запчастини-з-китаю/index.html', 'ru/zapchasti-iz-kitaya/index.html']) {
  test(`current offer is consistent in ${file}`, async () => {
    const source = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.equal(currentDeliveryCopy(source), source);
    assert.doesNotMatch(source, /14(?:,5)?\s*(?:днів|дней)|18–20\s*(?:днів|дней)/u);
    assert.match(source, /(?:від|Від|от|От) 20 (?:днів|дней)/u);
    for (const match of source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(match[1]);
  });
}
