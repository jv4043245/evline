import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const root = new URL('../', import.meta.url);
const main = await readFile(new URL('assets/js/main.js', root), 'utf8');
const contact = await readFile(new URL('assets/js/contact-tracking.js', root), 'utf8');
const modes = ['normal', 'getter-local', 'getter-session', 'getter-both', 'methods-throw', 'getItem-throw', 'setItem-throw', 'unavailable'];

function restrictStorage(window, mode) {
  for (const name of ['localStorage', 'sessionStorage']) {
    const deniedGetter = mode === 'getter-both' || mode === `getter-${name === 'localStorage' ? 'local' : 'session'}`;
    if (deniedGetter) {
      Object.defineProperty(window, name, { get() { throw new window.DOMException('Storage blocked', 'SecurityError'); } });
    } else if (mode === 'unavailable') {
      Object.defineProperty(window, name, { value: undefined });
    } else if (['methods-throw', 'getItem-throw', 'setItem-throw'].includes(mode)) {
      const storage = window[name];
      Object.defineProperty(window, name, { value: {
        getItem(key) {
          if (mode !== 'setItem-throw') throw new window.DOMException('Read blocked', 'SecurityError');
          return storage.getItem(key);
        },
        setItem(key, value) {
          if (mode !== 'getItem-throw') throw new window.DOMException('Write blocked', 'QuotaExceededError');
          storage.setItem(key, value);
        },
      } });
    }
  }
}

const partForm = '<form data-telegram-parts-form><input name="car" value="ZEEKR 001"><input name="phone" value="+380000000000"><input name="part" value="Synthetic bumper"><button type="submit">Submit</button></form>';
const basicForm = '<form data-lead-form><input name="car" value="ZEEKR 001"><input name="phone" value="+380000000000"><input name="part" value="Synthetic bumper"><button type="submit">Submit</button></form>';

for (const surface of ['main-parts', 'main-lead', 'index.html', 'ru/index.html']) {
  for (const mode of modes) {
    test(`${surface}: ${mode} storage does not block CRM submission`, async () => {
      const isHome = surface.endsWith('.html');
      const html = isHome ? await readFile(new URL(surface, root), 'utf8') : `<!doctype html><html lang="ru"><head></head><body>${surface === 'main-parts' ? partForm : basicForm}</body></html>`;
      const dom = new JSDOM(html, {
        url: 'https://evline.com.ua/ru/zapchasti-posle-dtp/?gclid=synthetic-storage-regression&utm_source=google&utm_medium=cpc&utm_campaign=storage-test',
        runScripts: 'outside-only', pretendToBeVisual: true,
      });
      const { window } = dom;
      const requests = [];
      const opened = [];
      const errors = [];
      window.addEventListener('error', event => errors.push(event.error));
      // Every request is stubbed. External scripts are never loaded in outside-only mode.
      window.fetch = async (endpoint, options) => {
        requests.push({ endpoint, method: options.method, payload: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ ok: true }) };
      };
      window.open = href => { opened.push(href); return null; };
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      restrictStorage(window, mode);
      try {
        if (isHome) {
          for (const script of window.document.querySelectorAll('script:not([src]):not([type="application/ld+json"])')) window.eval(script.textContent);
        } else window.eval(main);
        window.eval(contact);
        assert.equal(window.__EVLINE_CONTACT_TRACKING_LOADED__, true);
        let form;
        if (isHome) {
          form = window.document.getElementById('hero-mobile-form');
          form.querySelector('[name="brand"]').value = 'ZEEKR';
          form.querySelector('[name="contact"]').value = '+380000000000';
          form.querySelector('[name="need"]').value = 'Synthetic storage regression';
          assert.equal(window.submitLead(form.id), false);
        } else {
          form = window.document.querySelector('form');
          const event = new window.Event('submit', { bubbles: true, cancelable: true });
          form.dispatchEvent(event);
          assert.equal(event.defaultPrevented, true);
        }
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(errors, []);
        const leads = requests.filter(row => row.endpoint === '/api/leads');
        assert.equal(leads.length, 1);
        assert.equal(leads[0].method, 'POST');
        assert.equal(leads[0].payload.type, 'parts');
        assert.equal(leads[0].payload.gclid, 'synthetic-storage-regression');
        assert.equal(leads[0].payload.utm_campaign, 'storage-test');
        assert.equal(form.querySelector('button[type="submit"]').disabled, false);
        assert.equal(opened.length, surface === 'main-lead' ? 0 : 1);
        if (opened.length) assert.ok(opened[0].startsWith('https://t.me/evline_support?text='));
        window.EVLineContactTracking.track({ channel: 'phone', href: 'tel:+380000000000', intent_type: 'parts' });
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(requests.some(row => row.endpoint === '/api/contact-events'));
        // No alternate persistence is introduced: inaccessible storage stays inaccessible.
        if (mode === 'getter-both') assert.throws(() => window.localStorage, { name: 'SecurityError' });
        if (mode === 'unavailable') assert.equal(window.localStorage, undefined);
      } finally { window.close(); }
    });
  }
}
