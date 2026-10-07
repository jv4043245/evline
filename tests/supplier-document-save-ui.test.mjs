import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { icon } from '../admin/documents/icons.js';

const documentsSource=await readFile(new URL('../admin/supplier-documents.js',import.meta.url),'utf8');
const adminSource=await readFile(new URL('../admin/admin.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate) {
  for (let i=0;i<40;i++) {if(predicate())return;await tick();}
  assert.ok(predicate(),'UI settled');
}
async function fixture(t,{upload=async()=>{},patch=async()=>{},connected=true}={}) {
  const dom=new JSDOM(`<form data-order-editor><input name="id" value="order-test"><input name="customer_name" value="Test"><input name="revenue_uah" value="900"><input name="status" value="paid"><input name="notify_customer" type="checkbox" value="1" checked><section data-supplier-documents></section><div data-order-save-bar><span data-save-state></span><button type="submit">Save</button><p data-order-save-error hidden></p></div></form>`,{url:'https://fixture.local/admin/',runScripts:'outside-only'});
  const w=dom.window,document=w.document,calls=[],patches=[],saved=[];
  t.after(()=>w.close());
  w.icon=icon;w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
  w.state={selectedOrder:{id:'order-test',order_number:'O-TEST',status:'paid'},selectedNotifications:[],selectedTrackingEvents:[],selectedSupplierPayments:[],selectedSupplierRequests:[]};
  w.activeOrderEditorTab=()=> 'payment';w.refresh=async()=>{};
  w.fetch=async(url,options={})=>{
    const action=new URL(url,w.location.href).searchParams.get('action');
    assert.ok(String(url).startsWith('/api/admin/supplier-documents?'),'No live request');
    calls.push({action,body:options.body});
    let data={};
    if(action==='setup') data={storage_ready:true,cron_ready:true,user:{id:'andrii',name:'Andrii'},managers:[{id:'andrii',name:'Andrii',telegram_ready:connected}],connected:connected?{display_name:'Test Telegram',telegram_id:'1001'}:null};
    else if(action==='list') data={documents:saved,followups:[]};
    else if(action==='upload') {
      await upload(options.body);
      const file=options.body.get('file');
      saved.push({id:`doc-${saved.length}`,filename:file.name,reference:options.body.get('reference'),supplier_name:'BYD',kind:'invoice',current_version:1,bytes:file.size,linked_orders:1});
    } else throw new Error(`Unexpected action ${action}`);
    return {ok:true,json:async()=>data};
  };
  w.api=async(url,options)=>{
    assert.equal(url,'/api/admin/orders/order-test');assert.equal(options.method,'PATCH');
    const data=JSON.parse(options.body);patches.push(data);await patch(data);
    return {order:{...w.state.selectedOrder,...data}};
  };
  w.eval(documentsSource.replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
  const saveState=adminSource.slice(adminSource.indexOf('let orderFormBaseline ='),adminSource.indexOf('\nconst money ='));
  const submitStart=adminSource.indexOf('document.querySelector("[data-order-editor]")?.addEventListener("submit"');
  const inputStart=adminSource.indexOf('document.querySelector("[data-order-editor]")?.addEventListener("input"',submitStart);
  w.eval(saveState+adminSource.slice(submitStart,inputStart)+`window.qa={mount(draft=null){
    orderDocumentsController=mountSupplierDocuments(document.querySelector('[data-supplier-documents]'),{order:state.selectedOrder,suppliers:['BYD'],getHeaders:()=>({}),onStateChanged:()=>queueMicrotask(updateOrderSaveState),draft});
    orderFormBaseline=orderFormSnapshot();updateOrderSaveState();
  },controller:()=>orderDocumentsController,dirty:orderIsDirty,update:updateOrderSaveState,discard:allowDiscardOrder};`);
  w.renderOrderEditor=order=>{w.state.selectedOrder=order;w.qa.mount();};
  w.qa.mount();await until(()=>document.querySelector('[data-sd-connection]').textContent.includes('Andrii'));
  const q=selector=>document.querySelector(selector);
  const choose=(...names)=>{
    const input=q('[data-sd-file]');
    Object.defineProperty(input,'files',{configurable:true,value:names.map(name=>new w.File(['synthetic'],name,{type:'image/png'}))});
    q('[data-sd-supplier]').value='BYD';input.dispatchEvent(new w.Event('change',{bubbles:true}));
  };
  const submit=()=>q('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const idle=()=>until(()=>!q('form').inert && !w.qa.controller().isBusy());
  return {w,q,calls,patches,saved,choose,submit,idle};
}

test('main Save activates for files, saves without PATCH, Telegram send or financial changes',async t=>{
  const p=await fixture(t);assert.equal(p.q('[data-order-save-bar] button').disabled,true);
  p.choose('invoice.png');await tick();
  assert.equal(p.q('[data-order-save-bar] button').disabled,false);assert.match(p.q('[data-save-state]').textContent,/незбережені файли/);
  p.submit();await p.idle();
  assert.equal(p.saved.length,1);assert.equal(p.patches.length,0);assert.equal(p.w.qa.dirty(),false);
  assert.equal(p.q('[name=revenue_uah]').value,'900');assert.equal(p.q('[name=status]').value,'paid');
  assert.equal(p.q('[data-order-save-bar] button').disabled,true);
  assert.ok(p.calls.every(c=>['setup','list','upload'].includes(c.action)));
  assert.match(p.q('[data-sd-telegram] summary').textContent,/підключено/);
});
test('existing Save files still works and cancel clears the common save state',async t=>{
  const p=await fixture(t);p.choose('invoice.png');p.q('[data-sd-action=upload]').click();await p.idle();
  assert.equal(p.saved.length,1);p.choose('cancel.png');p.q('[data-sd-action=cancel-upload]').click();await p.idle();
  assert.equal(p.w.qa.dirty(),false);assert.equal(p.patches.length,0);assert.equal(p.saved.length,1);
});
test('main Save commits both files and edited order fields',async t=>{
  const p=await fixture(t);p.choose('invoice.png');p.q('[name=customer_name]').value='Corrected';p.w.qa.update();
  assert.match(p.q('[data-save-state]').textContent,/зміни та файли/);
  p.submit();await p.idle();
  assert.equal(p.saved.length,1);assert.equal(p.patches.length,1);assert.equal(p.patches[0].customer_name,'Corrected');assert.equal(p.w.qa.dirty(),false);
});
test('upload error keeps pending file and edited fields; retry succeeds without discarding either',async t=>{
  let fail=true;const p=await fixture(t,{upload:async()=>{if(fail)throw new Error('Upload failed');}});
  p.choose('invoice.png');p.q('[name=customer_name]').value='Corrected';p.submit();await p.idle();
  assert.equal(p.patches.length,0);assert.equal(p.w.qa.controller().hasPendingFiles(),true);assert.equal(p.q('[data-order-save-error]').hidden,false);
  assert.equal(p.q('[name=customer_name]').value,'Corrected');fail=false;p.submit();await p.idle();assert.equal(p.patches.length,1);assert.equal(p.saved.length,1);
});
test('partial batch retry uploads only remaining files and never resends completed files',async t=>{
  let fail=true;const names=[];const p=await fixture(t,{upload:async form=>{const name=form.get('file').name;names.push(name);if(fail && name==='second.png')throw new Error('Try again');}});
  p.choose('first.png','second.png');p.submit();await p.idle();
  assert.deepEqual(names,['first.png','second.png']);assert.match(p.q('[data-sd-pending]').textContent,/second.png/);assert.doesNotMatch(p.q('[data-sd-pending]').textContent,/first.png/);
  fail=false;p.submit();await p.idle();assert.deepEqual(names,['first.png','second.png','second.png']);assert.equal(p.saved.length,2);
});
test('order PATCH retry does not re-upload an already saved invoice',async t=>{
  let fail=true;const p=await fixture(t,{patch:async()=>{if(fail)throw new Error('Order unavailable');}});
  p.choose('invoice.png');p.q('[name=customer_name]').value='Corrected';p.submit();await p.idle();
  assert.equal(p.saved.length,1);assert.equal(p.w.qa.controller().hasPendingFiles(),false);assert.equal(p.w.qa.dirty(),true);
  fail=false;p.submit();await p.idle();assert.equal(p.saved.length,1);assert.equal(p.patches.length,2);assert.equal(p.w.qa.dirty(),false);
});
test('pending files participate in discard/unload guards and double-submit protection',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});const p=await fixture(t,{upload:()=>gate});
  p.choose('invoice.png');p.w.confirm=()=>false;assert.equal(p.w.qa.discard(),false);
  const unload=new p.w.Event('beforeunload',{cancelable:true});p.w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
  p.submit();p.submit();await tick();assert.equal(p.calls.filter(c=>c.action==='upload').length,1);assert.equal(p.w.qa.discard(),false);
  assert.equal(p.q('[data-order-save-bar] button').disabled,true);finish();await p.idle();assert.equal(p.saved.length,1);
});
test('draft files and supplier metadata survive a same-order panel remount',async t=>{
  const p=await fixture(t);p.choose('invoice.png');p.q('[data-sd-reference]').value='CN-TEST';
  const draft=p.w.qa.controller().getDraft();p.w.qa.mount(draft);await tick();
  assert.match(p.q('[data-sd-pending]').textContent,/invoice.png/);assert.equal(p.q('[data-sd-reference]').value,'CN-TEST');
  assert.equal(p.q('[data-order-save-bar] button').disabled,false);p.submit();await p.idle();assert.equal(p.saved[0].reference,'CN-TEST');
  assert.match(adminSource,/preserveDraft && orderDocumentsController\?\.orderId === order\?\.id/);
});
