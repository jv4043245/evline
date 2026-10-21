import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { priorityPartsPages } from '../scripts/lib/parts-priority-content.mjs';

const root = new URL('../', import.meta.url);
const mainScript = await readFile(new URL('assets/js/main.js', root), 'utf8');
const pages = ['/', '/ru/', ...priorityPartsPages.flatMap(page => [page.uk, page.ru])];

for (const pathname of pages) {
  for (const success of [true, false]) {
    test(`${pathname} preserves CRM attribution and ${success ? 'success' : 'failure'} conversion behavior`, async () => {
      const html = await readFile(new URL(`${pathname.slice(1)}index.html`, root), 'utf8');
      const url = `https://evline.com.ua${pathname}?gclid=synthetic-seo-regression&utm_source=google&utm_medium=cpc&utm_campaign=parts-test&utm_term=bumper&utm_content=group-ad`;
      const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
      const { window } = dom;
      const requests = [];
      const opened = [];
      window.fetch = async (endpoint, options) => {
        requests.push({ endpoint, payload: JSON.parse(options.body), method: options.method });
        return { ok: success, json: async () => ({ ok: success }) };
      };
      window.open = href => { opened.push(href); return null; };
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      try {
        for (const script of window.document.querySelectorAll('script:not([src]):not([type="application/ld+json"])')) window.eval(script.textContent);
        const isHome = ['/', '/ru/'].includes(pathname);
        if (!isHome) window.eval(mainScript);
        const form = window.document.querySelector(isHome ? 'form' : '[data-telegram-parts-form]');
        for (const input of form.querySelectorAll('input')) {
          const name = input.name;
          if (name === 'vin') input.value = 'TESTVIN1234567890';
          else if (['phone', 'contact'].includes(name)) input.value = '+380000000000';
          else if (['part', 'need'].includes(name)) input.value = 'QA bumper, no real order';
          else if (name === 'car') input.value = 'ZEEKR 001';
        }
        if (isHome) {
          form.querySelector('[name="brand"]').value = 'ZEEKR';
          window.submitLead(form.id);
        } else form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(resolve => setImmediate(resolve));
        const leads = requests.filter(item => item.endpoint === '/api/leads');
        assert.equal(leads.length, 1);
        assert.equal(leads[0].method, 'POST');
        const { payload } = leads[0];
        assert.equal(payload.type, 'parts');
        assert.equal(payload.gclid, 'synthetic-seo-regression');
        assert.equal(payload.utm_source, 'google');
        assert.equal(payload.utm_medium, 'cpc');
        assert.equal(payload.utm_campaign, 'parts-test');
        assert.equal(payload.utm_term, 'bumper');
        assert.equal(payload.utm_content, 'group-ad');
        assert.equal(payload.page_url, url);
        assert.equal(payload.phone, '+380000000000');
        const conversionEvents = window.dataLayer.filter(item => item.event === 'evline_lead_submit');
        assert.equal(conversionEvents.length, success ? 1 : 0);
        for (const event of conversionEvents) {
          assert.equal(event.lead_type, 'parts');
          assert.ok(!JSON.stringify(event).includes('TESTVIN'));
          assert.ok(!JSON.stringify(event).includes('+380000000000'));
        }
        assert.equal(opened.length, 1);
        assert.ok(opened[0].startsWith('https://t.me/evline_support?text='));
      } finally { window.close(); }
    });
  }
}
