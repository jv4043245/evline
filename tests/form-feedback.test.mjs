import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = new URL('../', import.meta.url);
const main = await readFile(new URL('assets/js/main.js', root), 'utf8');
const styles = await Promise.all(['styles.css', 'parts-clean.css'].map(name => readFile(new URL(`assets/css/${name}`, root), 'utf8')));
const languageText = {
  ru: { saved: 'Заявка сохранена.', failed: 'Не удалось подтвердить отправку', pending: 'Отправляем...' },
  uk: { saved: 'Заявку збережено.', failed: 'Не вдалося підтвердити надсилання', pending: 'Надсилаємо...' },
  ro: { saved: 'Solicitarea a fost salvată.', failed: 'Nu am putut confirma trimiterea', pending: 'Se trimite...' },
};

function fixture(language, kind, popupThrows = false) {
  const marker = { parts: 'data-telegram-parts-form', tech: 'data-byd-seo-form', generic: 'data-lead-form' }[kind];
  const dom = new JSDOM(`<!doctype html><html lang="${language}"><head></head><body class="${kind === 'tech' ? 'byd-seo-page' : 'parts-page brand-seo-page'}"><form class="brand-seo-form" ${marker}><input name="car"><input name="vin"><input name="phone"><input name="part"><input name="issue"><button type="submit">Original submit</button></form></body></html>`, {
    url: `https://evline.com.ua/${language}/zapchasti-posle-dtp/?gclid=synthetic-feedback-test&utm_source=google&utm_medium=cpc&utm_campaign=feedback-test&utm_term=bumper&utm_content=group-ad`,
    runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  window.dataLayer = [];
  for (const css of styles) {
    const style = window.document.createElement('style');
    style.textContent = css;
    window.document.head.append(style);
  }
  const requests = [], opened = [], errors = [];
  let finish;
  window.fetch = (endpoint, options) => {
    requests.push({ endpoint, method: options.method, payload: JSON.parse(options.body) });
    return new Promise((resolve, reject) => {
      finish = ok => ok instanceof Error ? reject(ok) : resolve({ ok, json: async () => ({ ok, lead_id: "synthetic-existing-test" }) });
    });
  };
  window.open = href => {
    opened.push(href);
    if (popupThrows) throw new Error('Synthetic popup blocked');
    return null; // noopener can return null even when a tab opens.
  };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.addEventListener('error', event => errors.push(event.error));
  window.eval(main);
  const form = window.document.querySelector('form');
  for (const [name, value] of Object.entries({ car: 'ZEEKR 001', vin: 'TESTVIN1234567890', phone: '+380000000000', part: 'Synthetic bumper', issue: 'Synthetic setup question' })) form.elements[name].value = value;
  return { dom, window, form, requests, opened, errors, finish: ok => finish(ok), submit: () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) };
}

for (const language of ['uk', 'ru', 'ro']) {
  for (const kind of ['parts', 'tech', 'generic']) {
    for (const success of [true, false]) {
      test(`${language}/${kind}: truthful ${success ? 'saved' : 'unconfirmed'} feedback, one in-flight request, preserved attribution`, async () => {
        const f = fixture(language, kind, !success);
        try {
          f.submit();
          f.submit();
          const button = f.form.querySelector('button');
          assert.equal(button.disabled, true);
          assert.equal(button.textContent, languageText[language].pending);
          assert.equal(f.form.getAttribute('aria-busy'), 'true');
          assert.equal(f.requests.length, 1);
          const { payload } = f.requests[0];
          assert.equal(f.requests[0].endpoint, '/api/leads');
          assert.equal(f.requests[0].method, 'POST');
          assert.equal(payload.type, kind === 'tech' ? 'byd' : 'parts');
          assert.equal(payload.gclid, 'synthetic-feedback-test');
          assert.equal(payload.utm_campaign, 'feedback-test');
          assert.equal(payload.utm_term, 'bumper');
          assert.equal(payload.utm_content, 'group-ad');
          assert.equal(payload.phone, '+380000000000');
          f.finish(success);
          await new Promise(resolve => setImmediate(resolve));
          assert.deepEqual(f.errors, []);
          assert.equal(button.disabled, false);
          assert.equal(button.textContent, 'Original submit');
          assert.equal(f.form.hasAttribute('aria-busy'), false);
          const status = f.form.querySelector('[data-form-message]');
          assert.equal(status.getAttribute('role'), 'status');
          assert.equal(status.getAttribute('aria-live'), 'polite');
          assert.ok(status.textContent.startsWith(languageText[language][success ? 'saved' : 'failed']));
          assert.doesNotMatch(status.textContent, /Telegram (?:открыт|відкрито)|Менеджер (?:получит|отримає)/);
          const events = (f.window.dataLayer || []).filter(event => event.event === 'evline_lead_submit');
          assert.equal(events.length, success ? 1 : 0);
          if (success) {
            assert.equal(f.form.elements.phone.value, '');
            assert.equal(status.querySelectorAll('a').length, 0);
          } else {
            assert.equal(f.form.elements.phone.value, '+380000000000');
            const links = status.querySelectorAll('a');
            assert.equal(links.length, 2);
            const url = new URL(links[0].href);
            assert.equal(url.hostname, 't.me');
            assert.equal(url.pathname, kind === 'tech' ? '/evline_tech' : '/evline_support');
            assert.ok(url.searchParams.get('text').includes('+380000000000'));
            assert.equal(links[1].href, kind === 'tech' ? 'tel:+380630630304' : 'tel:+380935251024');
            assert.equal(links[0].rel, 'noopener');
            f.submit();
            assert.equal(f.requests.length, 2, 'retry is possible after a completed failure');
            f.finish(true);
            await new Promise(resolve => setImmediate(resolve));
          }
          const expectedOpens = kind === 'generic' ? (success ? 0 : 1) : (success ? 1 : 2);
          assert.equal(f.opened.length, expectedOpens);
        } finally { f.dom.window.close(); }
      });
    }
  }
}

for (const success of [true, false]) {
  test(`white brand form has contrasting ${success ? 'success' : 'error'} text`, async () => {
    const f = fixture('ru', 'parts');
    try {
      f.submit(); f.finish(success);
      await new Promise(resolve => setImmediate(resolve));
      const style = f.window.getComputedStyle(f.form.querySelector('[data-form-message]'));
      assert.equal(f.window.getComputedStyle(f.form).backgroundColor, 'rgb(255, 255, 255)');
      assert.equal(style.color, success ? 'rgb(23, 99, 58)' : 'rgb(185, 28, 28)');
    } finally { f.dom.window.close(); }
  });
}

test('dark technical form retains light status contrast', async () => {
  const f = fixture('uk', 'tech');
  try {
    f.submit(); f.finish(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.window.getComputedStyle(f.form.querySelector('[data-form-message]')).color, 'rgba(255, 255, 255, 0.78)');
  } finally { f.dom.window.close(); }
});

test('network rejection keeps entered data and offers direct fallback without claiming delivery', async () => {
  const f = fixture('ru', 'parts', true);
  try {
    f.submit(); f.finish(new Error('Synthetic network unavailable'));
    await new Promise(resolve => setImmediate(resolve));
    const status = f.form.querySelector('[data-form-message]');
    assert.ok(status.textContent.startsWith(languageText.ru.failed));
    assert.equal(status.querySelectorAll('a').length, 2);
    assert.equal(f.form.elements.part.value, 'Synthetic bumper');
    assert.equal(f.form.querySelector('button').disabled, false);
    assert.equal(f.window.dataLayer.length, 0);
    assert.deepEqual(f.errors, []);
  } finally { f.dom.window.close(); }
});
