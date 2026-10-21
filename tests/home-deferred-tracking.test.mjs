import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, ResourceLoader } from 'jsdom';

const root = new URL('../', import.meta.url);
const tracking = await readFile(new URL('assets/js/contact-tracking.js', root), 'utf8');
const meta = await readFile(new URL('assets/js/meta-tracking.js', root), 'utf8');
class OfflineResources extends ResourceLoader {
  fetch(url) {
    const path = new URL(url).pathname;
    if (path === '/assets/js/contact-tracking.js') {
      return Promise.resolve(Buffer.from(`window.contactBeforeDomReady=!window.domReadySeen; window.formCodeReady=typeof window.trackingPayload==='function';\n${tracking}`));
    }
    if (path === '/assets/js/meta-tracking.js') return Promise.resolve(Buffer.from(meta));
    return Promise.resolve(Buffer.from(''));
  }
}

for (const page of ['index.html', 'ru/index.html']) {
  const html = await readFile(new URL(page, root), 'utf8');
  for (const formId of ['hero-form', 'hero-mobile-form', 'final-form']) {
    for (const success of [true, false]) {
      test(`${page} ${formId}: deferred tracking preserves ${success ? 'success' : 'failure'} attribution`, async () => {
        const requests = [];
        const opened = [];
        const dom = new JSDOM(html, {
          url: `https://evline.com.ua/${page}?gclid=test-gclid&utm_source=google&utm_medium=cpc&utm_campaign=test-parts&utm_term=headlight&utm_content=test-group`,
          runScripts: 'dangerously', resources: new OfflineResources(), pretendToBeVisual: true,
          beforeParse(window) {
            window.document.addEventListener('DOMContentLoaded', () => { window.domReadySeen = true; });
            window.fetch = async (endpoint, options) => {
              requests.push({ endpoint, payload: JSON.parse(options.body) });
              return { ok: success, json: async () => ({ ok: success }) };
            };
            window.open = href => { opened.push(href); return null; };
            window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
          },
        });
        try {
          const { window } = dom;
          await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
          assert.equal(window.contactBeforeDomReady, true);
          assert.equal(window.formCodeReady, true);
          assert.equal(window.__EVLINE_CONTACT_TRACKING_LOADED__, true);
          const form = window.document.getElementById(formId);
          form.querySelector('[name="brand"]').value = 'ZEEKR';
          form.querySelector('[name="contact"]').value = '+380000000000';
          form.querySelector('[name="need"]').value = 'Synthetic regression, no real order';
          window.submitLead(formId);
          await new Promise(resolve => setImmediate(resolve));
          const leads = requests.filter(item => item.endpoint === '/api/leads');
          assert.equal(leads.length, 1);
          const payload = leads[0].payload;
          assert.equal(payload.type, 'parts');
          assert.equal(payload.gclid, 'test-gclid');
          assert.equal(payload.utm_source, 'google');
          assert.equal(payload.utm_medium, 'cpc');
          assert.equal(payload.utm_campaign, 'test-parts');
          assert.equal(payload.utm_term, 'headlight');
          assert.equal(payload.utm_content, 'test-group');
          assert.ok(payload.visitor_id);
          assert.ok(payload.session_id);
          assert.equal(window.dataLayer.filter(event => event.event === 'evline_lead_submit').length, success ? 1 : 0);
          assert.equal(opened.length, 1);
          assert.ok(opened[0].startsWith('https://t.me/evline_support?text='));
          assert.equal(window.document.querySelectorAll('script[src*="meta-tracking.js"]').length, 1);
          assert.equal(window.document.querySelectorAll('script[src*="fbevents.js"]').length, 0);
        } finally { dom.window.close(); }
      });
    }
  }
}
