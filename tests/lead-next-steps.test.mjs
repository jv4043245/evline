import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../assets/js/lead-next-steps.js", import.meta.url), "utf8");

function load() {
  const window = {};
  vm.runInNewContext(source, { window, document: { documentElement: { lang: "uk" } }, Intl });
  return window.EVLineLeadNextSteps;
}

// Kyiv is UTC+2 in November.
const at = (iso) => new Date(iso);

test("working hours give an estimated response time, including just before closing", () => {
  const steps = load();
  for (const date of ["2026-11-10T10:00:00Z", "2026-11-13T15:59:00Z"]) {
    assert.match(steps.text("uk", at(date)), /Зазвичай.*30 хвилин у робочий час/);
    assert.match(steps.text("ru", at(date)), /Обычно.*30 минут в рабочее время/);
    assert.doesNotMatch(steps.text("uk", at(date)), /зв’яжеться.*протягом/);
  }
});

test("evenings promise the next working day without a fixed 30-minute claim", () => {
  const steps = load();
  const text = steps.text("uk", at("2026-11-10T18:30:00Z")); // Tue 20:30 Kyiv
  assert.match(text, /неробочий час/);
  assert.match(text, /завтра після 10:00/);
  assert.doesNotMatch(text, /30 хвилин/);
  assert.doesNotMatch(text, /не пізніше/);
});

for (const lang of ['uk', 'ru']) for (const type of ['parts', 'byd', 'sto', 'general', 'unknown']) {
  test(`${lang}/${type}: next steps match the direction and keep the right manager`, () => {
    const dom = new JSDOM(`<html lang="${lang}"><div id="status"></div></html>`, {runScripts:'outside-only'});
    try {
      const w=dom.window;w.eval(source);
      const node=w.document.querySelector('#status');
      w.EVLineLeadNextSteps.render(node,{lang,type,date:at('2026-11-10T10:00:00Z')});
      const text=node.textContent,link=node.querySelector('a');
      assert.equal(new URL(link.href).pathname,type==='byd'?'/evline_tech':'/evline_support');
      assert.equal(link.dataset.contactIntent,type==='unknown'?'general':type);
      if(type==='parts')assert.match(text,/фото детал/);
      else assert.doesNotMatch(text,/фото детал|техпаспорт/);
      if(type==='byd')assert.match(text,/VIN.*фото (?:помилки|ошибки)/);
      if(type==='sto')assert.match(text,/співпраці|сотрудничества/);
      w.EVLineLeadNextSteps.render(node,{lang,type});assert.equal(node.querySelectorAll('a').length,1);
    } finally {dom.window.close();}
  });
}

const mainSource = await readFile(new URL('../assets/js/main.js',import.meta.url),'utf8');
for (const [page,intent] of [
  ['zapchastyny-byd/song-plus/index.html','parts'],['ru/zapchasti-byd/song-plus/index.html','parts'],
  ['diagnostyka-byd/index.html','byd'],['ru/diagnostika-byd/index.html','byd'],
  ['spivpratsya-sto/index.html','sto'],['ru/sotrudnichestvo-sto/index.html','sto'],
  ['spivpratsya-sto-v2/index.html','sto'],['ru/sotrudnichestvo-sto-v2/index.html','sto'],
]) for (const accepted of [true,false]) {
  test(`${page}/${accepted}: payment note is parts-only and confirmation keeps CRM attribution`,async()=>{
    const html=await readFile(new URL('../'+page,import.meta.url),'utf8');
    const dom=new JSDOM(html,{url:`https://evline.test/${page}?gclid=synthetic-funnel-check&utm_source=google`,runScripts:'outside-only',pretendToBeVisual:true});
    try {
      const w=dom.window,requests=[];w.dataLayer=[];
      w.open=()=>({});w.matchMedia=()=>({matches:false,addEventListener(){}});
      w.fetch=async(url,options)=>{requests.push({url,data:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:accepted,lead_id:'synthetic-funnel-check'})};};
      w.eval(source);w.eval(mainSource);
      const forms=[...w.document.querySelectorAll('form[data-telegram-parts-form],form[data-byd-seo-form],form[data-lead-form]')];
      for(const form of forms) {
        assert.equal(!!form.querySelector('[data-payment-note]'),intent==='parts');
        for(const el of form.querySelectorAll('input:not([type=hidden]),textarea'))el.value=['phone','contact'].includes(el.name)?'+380000000000':'SYNTHETIC LOCAL ONLY';
        form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
        await new Promise(resolve=>setImmediate(resolve));
        const message=form.querySelector('[data-form-message]');assert.ok(message);
        const last=requests.at(-1).data;
        assert.equal(last.type,intent==='byd'?'byd':'parts','Do not change backend classification');
        assert.equal(last.gclid,'synthetic-funnel-check');
        if(accepted) {
          assert.match(message.textContent,/Заявку (?:отримали|получили)/);
          assert.equal(message.querySelector('a').dataset.contactIntent,intent);
          if(intent!=='parts')assert.doesNotMatch(message.textContent,/фото детал/);
          assert.equal(form.querySelector('[name=phone],[name=contact]').value,'');
        } else {
          assert.doesNotMatch(message.textContent,/Заявку (?:отримали|получили)/);
          assert.equal(form.querySelector('[name=phone],[name=contact]').value,'+380000000000');
        }
      }
      assert.equal(requests.length,forms.length);
      assert.equal(w.dataLayer.filter(e=>e.event==='evline_lead_submit').length,accepted?forms.length:0);
    } finally {dom.window.close();}
  });
}

test("Friday evening and Saturday point to Monday, Sunday to tomorrow", () => {
  const steps = load();
  assert.match(steps.text("uk", at("2026-11-13T17:00:00Z")), /у понеділок/); // Fri 19:00
  assert.match(steps.text("ru", at("2026-11-14T09:00:00Z")), /в понедельник/); // Sat 11:00
  assert.match(steps.text("uk", at("2026-11-15T09:00:00Z")), /завтра після 10:00/); // Sun 11:00
});

test("early morning on a working day points to today", () => {
  const steps = load();
  assert.match(steps.text("uk", at("2026-11-11T05:00:00Z")), /сьогодні після 10:00/); // Wed 07:00
});

test("mobile ad styles stay scoped to the noindex advertising pages", async () => {
  for (const page of ["запчастини-з-китаю/index.html", "ru/zapchasti-iz-kitaya/index.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /<body class="[^"]*parts-ad-page/);
    assert.match(html, /parts-ad\.css\?v=20261110-funnel-release-1/);
    assert.match(html, /noindex/);
  }
  for (const page of ["index.html", "ru/index.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /parts-ad\.css/);
  }
});

test("pages and main.js load the next-steps script with the current version", async () => {
  const main = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
  assert.match(main, /lead-next-steps\.js\?v=/);
  assert.match(main, /showLeadSaved\(form, payload\.type\)/);
  for (const page of ["index.html", "ru/index.html", "byd.html", "запчастини-з-китаю/index.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /lead-next-steps\.js\?v=/, page);
    assert.match(html, /EVLineLeadNextSteps\.render/, page);
  }
});
