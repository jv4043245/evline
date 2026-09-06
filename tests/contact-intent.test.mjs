import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/contact-tracking.js', import.meta.url), 'utf8');

function store(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function contact(url, href = 'tel:+380000000000', options = {}, saved = {}) {
  const location = new URL(url);
  const events = [];
  let id = 0;
  const window = {
    location,
    localStorage: store(saved),
    sessionStorage: store(),
    crypto: { randomUUID: () => `test-${++id}` },
  };
  const document = { referrer: '', querySelector: () => ({}), documentElement: { lang: 'ru' }, addEventListener() {} };
  vm.runInNewContext(source, {
    window, document, URLSearchParams, decodeURIComponent, Date,
    fetch: (_url, request) => { events.push(JSON.parse(request.body)); return Promise.resolve({ ok: true }); },
  });
  window.EVLineContactTracking.track({ channel: 'phone', href, ...options });
  assert.equal(events.length, 1);
  return events[0];
}

const routes = [
  ['/ru/zapchasti-zeekr/', 'parts'],
  ['/ru/zapchasti-zeekr/x/', 'parts'],
  ['/zapchastyny-zeekr/', 'parts'],
  ['/%D0%B7%D0%B0%D0%BF%D1%87%D0%B0%D1%81%D1%82%D0%B8%D0%BD%D0%B8-zeekr/', 'parts'],
  ['/ru/zapchasti-byd/', 'parts'],
  ['/ru/zapchasti-posle-dtp/', 'parts'],
  ['/zapchastyny-pislia-dtp/', 'parts'],
  ['/ru/sotrudnichestvo-sto-v2/', 'sto'],
  ['/spivpratsya-sto/', 'sto'],
  ['/komplekty-to/', 'to'],
  ['/ru/byd.html', 'byd'],
  ['/byd.html', 'byd'],
  ['/zeekr', 'byd'],
  ['/zeekr.html', 'byd'],
  ['/ru/zeekr.html', 'byd'],
  ['/ru/byd-ne-zaryazhaetsya/', 'byd'],
  ['/ru/diagnostika-byd/', 'byd'],
  ['/ru/obnovlenie-byd/', 'byd'],
  ['/%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D1%83%D0%B2%D0%B0%D0%BD%D0%BD%D1%8F-byd/', 'byd'],
  ['/ru/privacy/', 'general'],
];

for (const [pathname, expected] of routes) {
  test(`contact intent for ${pathname} is ${expected}`, () => {
    assert.equal(contact(`https://evline.com.ua${pathname}`).intent_type, expected);
  });
}

test('explicit destination and caller intent retain priority', () => {
  assert.equal(contact('https://evline.com.ua/ru/zapchasti-zeekr/', 'https://t.me/evline_tech').intent_type, 'byd');
  assert.equal(contact('https://evline.com.ua/ru/', 'https://t.me/evline_support').intent_type, 'parts');
  assert.equal(contact('https://evline.com.ua/ru/sotrudnichestvo-sto/', 'https://t.me/evline_support').intent_type, 'sto');
  assert.equal(contact('https://evline.com.ua/ru/zapchasti-zeekr/', undefined, { intent_type: 'other' }).intent_type, 'other');
});

test('fresh paid click replaces saved keyword and ad-group attribution', () => {
  const saved = { evline_attribution_v1: {
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'old-campaign',
    utm_term: 'old-keyword', utm_content: 'old-group-old-ad', gclid: 'old-click',
    expires_at: Date.now() + 60000,
  } };
  const fresh = contact('https://evline.com.ua/ru/zapchasti-zeekr/?gclid=new-click&utm_source=google&utm_medium=cpc&utm_campaign=new-campaign&utm_term=new-keyword&utm_content=new-group-new-ad', undefined, {}, saved);
  assert.equal(fresh.gclid, 'new-click');
  assert.equal(fresh.utm_campaign, 'new-campaign');
  assert.equal(fresh.utm_term, 'new-keyword');
  assert.equal(fresh.utm_content, 'new-group-new-ad');
  const direct = contact('https://evline.com.ua/ru/zapchasti-zeekr/', undefined, {}, saved);
  assert.equal(direct.gclid, 'old-click');
  assert.equal(direct.utm_term, 'old-keyword');
  const idOnly = contact('https://evline.com.ua/ru/zapchasti-zeekr/?gclid=new-click', undefined, {}, saved);
  assert.equal(idOnly.utm_term, '');
  assert.equal(idOnly.utm_content, '');
});
