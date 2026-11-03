import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../admin/admin.js', import.meta.url), 'utf8');
const start = source.indexOf('document.querySelector("[data-order-editor]")?.addEventListener("click", async (event) => {');
const end = source.indexOf('  if (event.target.closest("[data-open-supplier-payment]"))', start);
assert.ok(start > 0 && end > start);
const entryHandler = source.slice(start, end) + '\n});';

test('order document actions keep the order link, select the requested output and never send an API request', t => {
  for (const mode of ['invoice', 'agreement']) {
    const dom = new JSDOM(`<form data-order-editor><button type="button" data-order-documents="${mode}">Документ</button></form>`, {runScripts:'outside-only'});
    t.after(() => dom.window.close());
    const w=dom.window, destination={href:''}, notices=[];
    Object.assign(w,{state:{selectedOrder:{id:'order/test?value'}},orderSaving:false,orderIsDirty:()=>false,orderDocumentsController:null,alert:m=>notices.push(m)});
    w.fetch=()=>{assert.fail('Opening an editor must not write or send anything');};
    w.Function('location',entryHandler)(destination);
    w.document.querySelector('button').click();
    const url=new URL(destination.href,'https://evline.test');
    assert.equal(url.pathname,'/admin/documents/');assert.equal(url.searchParams.get('order'),'order/test?value');assert.equal(url.searchParams.get('mode'),mode);
    assert.deepEqual(notices,[]);
  }
});
test('unsaved order edits, saves and file uploads block navigation without discarding manager work', t => {
  for (const state of ['dirty','saving','uploading']) {
    const dom=new JSDOM('<form data-order-editor><input value="Незбережене ім’я"><button type="button" data-order-documents="agreement">Договір</button></form>',{runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window,destination={href:''},notices=[];
    Object.assign(w,{state:{selectedOrder:{id:'test'}},orderSaving:state==='saving',orderIsDirty:()=>state==='dirty',orderDocumentsController:{isBusy:()=>state==='uploading'},alert:m=>notices.push(m)});
    w.Function('location',entryHandler)(destination);w.document.querySelector('button').click();
    assert.equal(destination.href,'');assert.equal(w.document.querySelector('input').value,'Незбережене ім’я');
    assert.equal(notices.length,state==='dirty'?1:0);
  }
});
