import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = new URL('../', import.meta.url);
const main = await readFile(new URL('assets/js/main.js', root), 'utf8');
const inlinePages = ['index.html', 'ru/index.html', 'запчастини-з-китаю/index.html', 'byd.html', 'ru/byd.html', 'zeekr.html', 'ru/zeekr.html'];
const surfaces = [...inlinePages, 'main-parts', 'main-tech', 'main-generic'];
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(surface, mode) {
  const inline = inlinePages.includes(surface);
  const marker = surface === 'main-tech' ? 'data-byd-seo-form' : surface === 'main-generic' ? 'data-lead-form' : 'data-telegram-parts-form';
  const html = inline ? await readFile(new URL(surface, root), 'utf8') : `<!doctype html><html lang="ru"><head></head><body><form ${marker}><input name="car"><input name="vin"><input name="phone"><input name="part"><input name="issue"><button type="submit">Send</button></form></body></html>`;
  const dom = new JSDOM(html, {url:'https://evline.com.ua/' + (inline ? surface : 'qa-parts/') + '?gclid=synthetic-confirmation-only&utm_source=google&utm_campaign=local-test', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:new VirtualConsole()});
  const w = dom.window;
  const requests = [], errors = [];
  let deadline, late, signal;
  const realSetTimeout = w.setTimeout.bind(w), realClearTimeout = w.clearTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => {
    if (ms === 15000) { deadline = fn; return 'qa-deadline'; }
    return realSetTimeout(fn, ms, ...args);
  };
  w.clearTimeout = id => { if (id !== 'qa-deadline') realClearTimeout(id); };
  w.dataLayer = [];
  w.open = () => { throw new Error('Synthetic blocked popup'); };
  w.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}});
  w.addEventListener('error', e => errors.push(e.error?.message || e.message));
  if (mode === 'no-abort') w.AbortController = undefined;
  w.fetch = (url, options) => {
    signal = options.signal;
    requests.push({url, payload:JSON.parse(options.body), signal});
    if (['pending', 'no-abort'].includes(mode)) return new Promise(resolve => {late = resolve;});
    if (mode === 'network') return Promise.reject(new TypeError('Synthetic offline'));
    const body = mode === 'bad-ok' ? {ok:false,lead_id:'synthetic-lead'} : mode === 'no-id' ? {ok:true} : mode === 'empty-id' ? {ok:true,lead_id:'  '} : {ok:true,lead_id:'synthetic-lead'};
    return Promise.resolve({ok:mode !== '503',json:() => mode === 'non-json' ? Promise.reject(new SyntaxError('Synthetic HTML')) : mode === 'body-pending' ? new Promise(resolve => {late = resolve;}) : Promise.resolve(body)});
  };
  if (inline) {
    for (const s of w.document.querySelectorAll('script:not([src]):not([type="application/ld+json"])')) w.eval(s.textContent);
  } else w.eval(main);
  const form = inline ? w.document.querySelector('form') : w.document.querySelector(`[${marker}]`);
  for (const el of form.querySelectorAll('input,textarea,select')) {
    if (el.tagName === 'SELECT') el.value = [...el.options].find(x => x.value && !x.disabled)?.value || '';
    else if (['phone','contact'].includes(el.name)) el.value = '+380000000000';
    else if (['need','part','issue'].includes(el.name)) el.value = 'SYNTHETIC LOCAL ONLY';
    else if (['car','model'].includes(el.name)) el.value = 'BYD Song Plus';
  }
  const submit = () => inline ? w.submitLead(form.id) : form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {dom,w,form,requests,errors,submit,expire:() => {assert.equal(typeof deadline,'function'); deadline();},late:() => late,signal:() => signal};
}

for (const surface of surfaces) {
  for (const mode of ['success','503','network','bad-ok','no-id','empty-id','non-json','pending','body-pending','no-abort']) {
    test(`${surface}/${mode}: verified acknowledgment, bounded wait, no automatic retry`, async () => {
      const f = await fixture(surface, mode);
      try {
        const contact = f.form.querySelector('[name=contact],[name=phone]');
        const initial = contact.value;
        f.submit(); f.submit();
        assert.equal(f.requests.length,1,'one request while busy');
        assert.equal(f.form.getAttribute('aria-busy'),'true');
        await flush();
        const timedOut = ['pending','body-pending','no-abort'].includes(mode);
        if (timedOut) { f.expire(); await flush(); }
        const success = mode === 'success';
        const message = f.form.querySelector('[data-form-message]');
        assert.ok(message);
        assert.match(message.textContent,success ? /Заявк[ау].*(?:збережено|сохранена)/ : /Не (?:удалось|вдалося).*підтвердити|Не удалось подтвердить/);
        assert.doesNotMatch(message.textContent,/Telegram (?:открыт|відкрито)|Менеджер (?:получит|отримає)/);
        assert.equal(message.getAttribute('role'),'status');
        assert.equal(f.form.hasAttribute('aria-busy'),false);
        assert.equal(f.form.querySelector('button[type=submit]').disabled,false);
        assert.equal(contact.value,success ? '' : initial);
        assert.equal(message.querySelectorAll('a').length,success ? 0 : 2);
        if (!success) {
          const technical = /^(?:ru\/)?(?:byd|zeekr)\.html$/.test(surface) || surface === 'main-tech';
          const [telegram, phone] = message.querySelectorAll('a');
          assert.equal(new URL(telegram.href).pathname, technical ? '/evline_tech' : '/evline_support');
          assert.equal(phone.href, technical ? 'tel:+380630630304' : 'tel:+380935251024');
        }
        assert.equal(f.w.dataLayer.filter(e => e.event === 'evline_lead_submit').length,success ? 1 : 0);
        assert.equal(f.requests.length,1,'no blind retry after failure or timeout');
        assert.deepEqual(f.errors,[]);
        if (timedOut) {
          if (mode !== 'no-abort') assert.equal(f.signal().aborted,true);
          // A late response must not clear input, track a conversion or claim success.
          if (mode === 'body-pending') f.late()({ok:true,lead_id:'late-synthetic'});
          else f.late()({ok:true,json:async()=>({ok:true,lead_id:'late-synthetic'})});
          await flush();
          assert.equal(contact.value,initial);
          assert.equal(f.w.dataLayer.filter(e => e.event === 'evline_lead_submit').length,0);
          assert.equal(message.querySelectorAll('a').length,2);
        }
      } finally { f.dom.window.close(); }
    });
  }
  test(`${surface}: unchanged manual retry reuses event ID, edited request gets a new ID`, async () => {
    const f = await fixture(surface,'network');
    try {
      f.submit(); await flush();
      f.submit(); await flush();
      assert.ok(f.requests[0].payload.meta_event_id);
      assert.equal(f.requests[1].payload.meta_event_id,f.requests[0].payload.meta_event_id);
      const contact = f.form.querySelector('[name=contact],[name=phone]');
      contact.value = '+380000000001';
      f.submit(); await flush();
      assert.notEqual(f.requests[2].payload.meta_event_id,f.requests[0].payload.meta_event_id);
      assert.equal(f.requests[2].payload.gclid,'synthetic-confirmation-only');
    } finally {f.dom.window.close();}
  });
  test(`${surface}: analytics exception cannot hide a confirmed save`, async () => {
    const f = await fixture(surface,'success');
    try {
      f.w.gtag = () => {throw new Error('Synthetic analytics error');};
      f.submit(); await flush();
      assert.match(f.form.querySelector('[data-form-message]').textContent,/(?:збережено|сохранена)/);
      assert.equal(f.form.querySelector('[name=contact],[name=phone]').value,'');
    } finally {f.dom.window.close();}
  });
}
