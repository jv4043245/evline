import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { icon } from '../admin/documents/icons.js';

const source=await readFile(new URL('../admin/supplier-documents.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(predicate) {
  for(let i=0;i<50;i++){if(predicate())return;await tick();}
  assert.ok(predicate(),'UI settled');
}
function baseSetup(extra={}) {
  return {storage_ready:true,cron_ready:true,user:{id:'andrii',name:'Андрій'},managers:[{id:'andrii',name:'Андрій',telegram_ready:false},{id:'ihor',name:'Ігор',telegram_ready:false}],connected:null,pending:null,pairing:null,...extra};
}
async function fixture(t,{initial=baseSetup(),setupHook=null,confirmationDelivered=true,testDelivered=true,supportInitial={session_id:null,state:'none',expires_at:null,link_expires_at:null,pending:null}}={}) {
  const dom=new JSDOM('<section class="sd-panel" id="panel"></section>',{url:'https://fixture.local/admin/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,root=w.document.querySelector('#panel'),calls=[],timers=new Map();
  let clock=Date.parse('2026-10-15T10:00:00Z'),timerId=0,current=initial,hook=setupHook,setupCalls=0;
  let support=supportInitial,supportHook=null;
  w.Date.now=()=>clock;
  w.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:clock+ms,ms});return id;};
  w.clearTimeout=id=>timers.delete(id);
  w.icon=icon;w.HTMLElement.prototype.scrollIntoView=()=>{};w.confirm=()=>true;
  w.fetch=async(url,options={})=>{
    if(String(url).startsWith('/api/admin/slavik-support')) {
      const action=new URL(url,w.location.href).searchParams.get('action') || 'status',body=options.body?JSON.parse(options.body):null;
      calls.push({action:`support-${action}`,body:options.body,signal:options.signal});
      let result;
      if(supportHook)result=await supportHook(action,body,support);
      else if(action==='status')result=structuredClone(support);
      else if(action==='connect') {
        support={session_id:'support-1',state:'waiting_start',expires_at:new Date(clock+48*3600000).toISOString(),link_expires_at:new Date(clock+600000).toISOString(),pending:null};
        result={...support,link:'https://t.me/slavik_office_bot?start=help_synthetic_only'};
      } else if(action==='confirm') {
        assert.deepEqual(body,{session_id:support.session_id,telegram_id:support.pending.telegram_id});
        support={...support,state:'active',pending:null};result=structuredClone(support);
      } else if(action==='close') {
        assert.deepEqual(body,{session_id:support.session_id});support={...support,state:'closed',pending:null};result=structuredClone(support);
      } else throw new Error(`Unexpected support action ${action}`);
      return {ok:true,json:async()=>result};
    }
    assert.match(String(url),/^\/api\/admin\/supplier-documents\?/,'No external requests');
    const action=new URL(url,w.location.href).searchParams.get('action');
    calls.push({action,body:options.body,signal:options.signal});
    let result={};
    if(action==='setup') {setupCalls++;result=hook?await hook(setupCalls,current):structuredClone(current);}
    else if(action==='list')result={documents:[],followups:[{payment_id:'payment1',admin_id:'andrii',state:'waiting',effective_due_at:'2026-10-20T10:00:00Z',tracking_number:'saved'}]};
    else if(action==='connect') {
      current={...current,pending:null,pairing:{state:'waiting_start',expires_at:new Date(clock+600000).toISOString()}};
      result={link:`https://t.me/fixture_bot?start=pair-${calls.filter(c=>c.action==='connect').length}`,expires_at:current.pairing.expires_at};
    } else if(action==='confirm') {
      const body=JSON.parse(options.body);assert.equal(body.telegram_id,current.pending.telegram_id);
      current={...current,connected:{telegram_id:current.pending.telegram_id,display_name:current.pending.display_name},pending:null,pairing:null,managers:current.managers.map(u=>({...u,telegram_ready:u.id==='andrii'}))};
      result={ok:true,connection_message_sent:confirmationDelivered};
    } else if(action==='disconnect') current={...current,connected:null,pending:null,pairing:null,managers:current.managers.map(u=>({...u,telegram_ready:false}))};
    else if(action==='test-connection') {
      if(!testDelivered)throw new Error('Не вдалося надіслати повідомлення.');
      result={ok:true,connection_message_sent:true};
    }
    else if(action==='intake')result={link:'https://t.me/fixture_bot?start=intake-only'};
    else throw new Error(`Unexpected action ${action}`);
    return {ok:true,json:async()=>result};
  };
  w.eval(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
  const mount=()=>w.eval(`mountSupplierDocuments(document.querySelector('#panel'),{order:{id:'order1',order_number:'O-TEST',status:'paid'},payments:[{id:'payment1',payment_number:'P-TEST',supplier_name:'BYD',status:'paid',paid_at:'2026-10-15T10:00:00Z'}],suppliers:['BYD'],getHeaders:()=>({})})`);
  let controller=mount();
  t.after(()=>{controller.destroy();w.close();});
  const q=selector=>root.querySelector(selector),count=action=>calls.filter(c=>c.action===action).length;
  const idle=()=>settle(()=>!controller.isBusy());
  const click=async action=>{const node=q(`[data-sd-action="${action}"]`);assert.ok(node,action);node.click();await tick();await idle();};
  const advance=async(ms=4000)=>{
    clock+=ms;const ready=[...timers].filter(([,timer])=>timer.at<=clock);
    for(const[id,timer]of ready){timers.delete(id);timer.fn();}
    await tick();
  };
  await settle(()=>q('[data-sd-connection]').textContent!=='Перевіряємо підключення…');
  await tick();
  return {w,root,q,calls,count,idle,click,advance,timers,get controller(){return controller;},
    current:()=>current,setSetup:value=>{current=value;},setHook:value=>{hook=value;},
    support:()=>support,setSupport:value=>{support=value;},setSupportHook:value=>{supportHook=value;},
    expiry:()=>new Date(clock+600000).toISOString(),remount:()=>{controller=mount();return controller;}};
}

test('connection state and primary CTA are visible before uploads; no false connected or reminder success',async t=>{
  const p=await fixture(t);
  assert.equal(p.q('[data-sd-telegram]').open,true);
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'disconnected');
  assert.match(p.q('[data-sd-telegram] summary').textContent,/не підключено/);
  assert.ok(p.q('[data-sd-action=connect]').hasAttribute('data-sd-primary'));
  assert.ok(p.q('[data-sd-telegram]').compareDocumentPosition(p.q('[data-sd-upload]'))&p.w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(p.timers.size,0);
  assert.equal(p.calls.some(c=>!['setup','list'].includes(c.action)),false);
});

test('connect shows direct bot Start instructions; automatic polling exposes but never performs final confirmation',async t=>{
  const p=await fixture(t);await p.click('connect');
  const link=p.q('[data-sd-connect-link] a');
  assert.match(link.href,/start=pair-1$/);assert.match(p.q('[data-sd-connection]').textContent,/Запустити \/ Start/);
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'waiting_start');
  assert.equal(p.timers.size,1);assert.equal([...p.timers.values()][0].ms,4000);
  await p.advance();assert.equal(p.q('[data-sd-connect-link] a'),link,'unchanged status preserves focused link');
  p.setSetup({...p.current(),pairing:{state:'confirm',expires_at:p.expiry()},pending:{telegram_id:'123',display_name:'Test manager',expires_at:p.expiry()}});
  await p.advance();
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'confirm');assert.ok(p.q('[data-sd-action=confirm]'));
  assert.equal(p.count('confirm'),0);assert.equal(p.q('[data-sd-connect-link]'),null);
  await p.click('confirm');
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'connected');assert.match(p.q('[data-sd-connection]').textContent,/Підключено: Test manager/);
  assert.equal(p.count('confirm'),1);assert.equal(p.timers.size,0);
  assert.match(p.q('.sd-connection-delivery').textContent,/контрольне повідомлення надіслано/);
  assert.equal(p.w.localStorage.length,0,'pairing token is never persisted');
});

test('return focus and visibility check automatically without overlapping setup requests',async t=>{
  const p=await fixture(t);await p.click('connect');
  let resolve;const deferred=new Promise(done=>{resolve=done;});p.setHook(()=>deferred);
  const before=p.count('setup');
  p.w.dispatchEvent(new p.w.Event('focus'));p.w.dispatchEvent(new p.w.Event('focus'));
  p.w.document.dispatchEvent(new p.w.Event('visibilitychange'));await p.advance();
  assert.equal(p.count('setup'),before+1);
  resolve({...p.current(),pending:{telegram_id:'123',display_name:'Test manager',expires_at:p.expiry()},pairing:{state:'confirm',expires_at:p.expiry()}});
  await tick();assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'confirm');
});

test('hidden page does not poll the server and resumes when visible without manual refresh',async t=>{
  const p=await fixture(t);await p.click('connect');const before=p.count('setup');
  Object.defineProperty(p.w.document,'hidden',{configurable:true,value:true});
  await p.advance();await p.advance();assert.equal(p.count('setup'),before);
  Object.defineProperty(p.w.document,'hidden',{configurable:true,value:false});
  p.w.document.dispatchEvent(new p.w.Event('visibilitychange'));await tick();
  assert.equal(p.count('setup'),before+1);
});

test('background status changes and confirmed/disconnected label updates preserve every unsaved followup input',async t=>{
  const p=await fixture(t);await p.click('connect');
  const due=p.q('[data-sd-due]'),owner=p.q('[data-sd-owner]'),track=p.q('[data-sd-track]'),state=p.q('[data-sd-state]');
  due.value='2026-11-01T12:34';track.value='unsaved tracking';state.value='paused';owner.value='ihor';
  p.setSetup({...p.current(),pending:{telegram_id:'123',display_name:'Test manager',expires_at:p.expiry()},pairing:{state:'confirm',expires_at:p.expiry()}});
  await p.advance();await p.click('confirm');
  assert.equal(p.q('[data-sd-due]'),due);assert.equal(due.value,'2026-11-01T12:34');assert.equal(track.value,'unsaved tracking');assert.equal(state.value,'paused');assert.equal(owner.value,'ihor');
  assert.equal([...owner.options].find(o=>o.value==='andrii').textContent,'Андрій');
  owner.value='andrii';owner.dispatchEvent(new p.w.Event('change',{bubbles:true}));
  assert.doesNotMatch(p.q('[data-sd-followup-status]').textContent,/підключіть Telegram/);
  await p.click('disconnect');
  assert.match([...owner.options].find(o=>o.value==='andrii').textContent,/без Telegram/);
  assert.match(p.q('[data-sd-followup-status]').textContent,/підключіть Telegram/);
  assert.equal(track.value,'unsaved tracking');assert.equal(due.value,'2026-11-01T12:34');
});

test('intake links remain in upload area and cannot replace pairing links or confirmation state',async t=>{
  const p=await fixture(t);await p.click('connect');
  const link=p.q('[data-sd-connect-link] a').href;
  await p.click('intake');
  assert.equal(p.q('[data-sd-connect-link] a').href,link);
  assert.match(p.q('[data-sd-intake-link] a').href,/start=intake-only$/);
  assert.match(p.q('[data-sd-intake-link]').textContent,/лише для завантаження/);
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'waiting_start');
});

test('expired pairing stops polling and replaces unusable links with an explicit retry',async t=>{
  const p=await fixture(t);await p.click('connect');const before=p.count('setup');
  await p.advance(600000);
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'expired');assert.equal(p.q('[data-sd-connect-link] a'),null);
  assert.match(p.q('[data-sd-action=connect]').textContent,/Підключити знову/);
  assert.equal(p.count('setup'),before);assert.equal(p.timers.size,0);
  await p.click('connect');assert.match(p.q('[data-sd-connect-link] a').href,/start=pair-2$/);
});

test('remount restores waiting state but not private token; old root handlers cannot duplicate actions',async t=>{
  const p=await fixture(t);await p.click('connect');const old=p.controller;
  p.remount();await tick();await tick();
  assert.notEqual(p.controller,old);assert.equal(p.q('[data-sd-connect-link] a'),null);
  assert.match(p.q('[data-sd-action=connect]').textContent,/Отримати нове посилання/);
  assert.equal(p.timers.size,1);
  await p.click('connect');assert.equal(p.count('connect'),2,'one action per click despite root reuse');
});

test('detaching or replacing panel stops timer and focus listeners without later setup writes',async t=>{
  for(const mode of ['detach','replace']) {
    const p=await fixture(t);await p.click('connect');const before=p.count('setup');
    if(mode==='detach')p.root.remove();else p.root.innerHTML='<p>Different order</p>';
    await tick();assert.equal(p.timers.size,0);
    p.w.dispatchEvent(new p.w.Event('focus'));await p.advance(12000);
    assert.equal(p.count('setup'),before);
    if(mode==='replace')assert.equal(p.root.textContent,'Different order');
  }
});

test('setup failure has visible retry; poll failure never claims successful connection',async t=>{
  const p=await fixture(t,{setupHook:()=>{throw new Error('Synthetic unavailable');}});
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'error');assert.ok(p.q('[data-sd-action=setup]'));
  p.setHook(null);await p.click('setup');assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'disconnected');
  await p.click('connect');p.setHook(()=>{throw new Error('Synthetic offline');});await p.advance();
  assert.match(p.q('[data-sd-connection]').textContent,/Не вдалося перевірити/);assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'waiting_start');
  p.setHook(null);await p.click('setup');assert.equal(p.q('.sd-connection-error'),null);
});

test('connected account distinctly warns about unverified scheduler instead of claiming delivery works',async t=>{
  const p=await fixture(t,{initial:baseSetup({connected:{display_name:'Test manager',telegram_id:'123'},cron_ready:false,cron_last_run_at:'2026-10-01T10:00:00Z'})});
  assert.match(p.q('[data-sd-telegram] summary').textContent,/підключено/);
  assert.match(p.q('.sd-connection-warning').textContent,/Планувальник нагадувань не підтверджений/);
  assert.match(p.q('.sd-connection-warning').textContent,/не гарантує надсилання/);
  assert.equal(p.timers.size,0);
  assert.ok(p.q('[data-sd-action=test-connection]'));assert.equal(p.count('test-connection'),0);
});

test('delivery test is an explicit action only; failed confirmation message leaves connection and retry visible',async t=>{
  const p=await fixture(t,{initial:baseSetup({pairing:{state:'confirm',expires_at:'2026-10-15T10:10:00Z'},pending:{telegram_id:'123',display_name:'Test manager',expires_at:'2026-10-15T10:10:00Z'}}),confirmationDelivered:false});
  await p.click('confirm');
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'connected');
  assert.match(p.q('.sd-connection-error').textContent,/Telegram прив’язано, але повідомлення не доставлено/);
  assert.equal(p.count('test-connection'),0);
  await p.click('test-connection');
  assert.equal(p.count('test-connection'),1);assert.deepEqual(JSON.parse(p.calls.find(c=>c.action==='test-connection').body),{});
  assert.equal(p.q('.sd-connection-error'),null);assert.match(p.q('.sd-connection-delivery').textContent,/контрольне повідомлення надіслано/);
  p.remount();await tick();await tick();
  assert.equal(p.count('test-connection'),1,'reload does not send another message');assert.equal(p.q('.sd-connection-delivery'),null);
});

test('failed explicit message test does not disconnect or silently claim success',async t=>{
  const p=await fixture(t,{initial:baseSetup({connected:{display_name:'Test manager',telegram_id:'123'}}),testDelivered:false});
  await p.click('test-connection');
  assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'connected');
  assert.match(p.q('.sd-connection-error').textContent,/повідомлення не доставлено/);
  assert.equal(p.q('.sd-connection-delivery'),null);
  assert.equal(p.count('disconnect'),0);
});

test('restart waits for stale setup request and ignores old candidate despite a late response',async t=>{
  const waiting=baseSetup({pairing:{state:'waiting_start',expires_at:'2026-10-15T10:10:00Z'}});
  const p=await fixture(t,{initial:waiting});
  let resolve;const deferred=new Promise(done=>{resolve=done;});p.setHook(()=>deferred);
  p.w.dispatchEvent(new p.w.Event('focus'));await tick();
  p.q('[data-sd-action=connect]').click();await tick();
  assert.equal(p.calls.filter(c=>c.action==='setup').at(-1).signal.aborted,true);
  assert.equal(p.count('connect'),0,'mutating request waits for prior setup settlement');
  resolve({...waiting,pairing:{state:'confirm',expires_at:p.expiry()},pending:{telegram_id:'old-id',display_name:'Old stale identity',expires_at:p.expiry()}});
  await p.idle();
  assert.equal(p.count('connect'),1);assert.equal(p.q('[data-sd-action=confirm]'),null);
  assert.doesNotMatch(p.q('[data-sd-connection]').textContent,/Old stale identity/);
  assert.match(p.q('[data-sd-connect-link] a').href,/start=pair-1$/);
});

test('legacy setup pending contract still exposes only explicit confirmation and escapes display names',async t=>{
  const p=await fixture(t,{initial:baseSetup({pairing:undefined,pending:{telegram_id:'123',display_name:'<img src=x onerror=alert(1)>',expires_at:'2026-10-15T10:10:00Z'}})});
  assert.ok(p.q('[data-sd-action=confirm]'));assert.equal(p.count('confirm'),0);assert.equal(p.q('img'),null);
  assert.match(p.q('[data-sd-connection]').textContent,/<img src=x/);
});

test('Slavik support is opt-in and visible only to the exact enabled Andrii identity',async t=>{
  for(const initial of [baseSetup(),baseSetup({support_available:true,user:{id:'ihor',name:'Ігор'}}),baseSetup({support_available:true,user:{id:'Andrii',name:'Андрій'}})]) {
    const p=await fixture(t,{initial});
    assert.equal(p.q('[data-sd-support]').hidden,true);assert.equal(p.q('[data-sd-action=support-open]'),null);assert.equal(p.count('support-status'),0);
  }
  const p=await fixture(t,{initial:baseSetup({support_available:true})});
  assert.equal(p.q('[data-sd-support]').hidden,false);assert.ok(p.q('[data-sd-action=support-open]'));
  assert.equal(p.count('support-status'),0);assert.equal(p.count('support-connect'),0);
});

test('Slavik support uses a separate Start and explicit confirmation flow without altering reminders or unsaved fields',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true,connected:{display_name:'Reminder manager',telegram_id:'456'}})});
  const reminder=p.q('[data-sd-connection]').innerHTML,due=p.q('[data-sd-due]'),track=p.q('[data-sd-track]');
  due.value='2026-11-22T10:30';track.value='unsaved tracking';
  await p.click('support-open');assert.equal(p.count('support-status'),1);assert.equal(p.count('support-connect'),0);
  assert.match(p.q('[data-sd-support]').textContent,/Бот нагадувань вище не змінюється/);
  await p.click('support-connect');assert.match(p.q('[data-sd-support] a').href,/slavik_office_bot\?start=help_/);
  p.setSupport({...p.support(),state:'confirm',pending:{telegram_id:'123',display_name:'Support manager'}});
  await p.advance();assert.ok(p.q('[data-sd-action=support-confirm]'));assert.equal(p.count('support-confirm'),0);
  assert.match(p.q('[data-sd-action=support-confirm]').textContent,/Це мій Telegram — відкрити допомогу/);
  await p.click('support-confirm');
  assert.match(p.q('[data-sd-support]').textContent,/Допомогу відкрито до/);
  assert.equal(p.q('[data-sd-support] a').href,'https://t.me/slavik_office_bot');
  assert.equal(p.q('[data-sd-connection]').innerHTML,reminder);assert.equal(p.q('[data-sd-due]'),due);
  assert.equal(due.value,'2026-11-22T10:30');assert.equal(track.value,'unsaved tracking');
  assert.equal(p.count('connect'),0);assert.equal(p.count('confirm'),0);assert.equal(p.count('send'),0);
  const statusCalls=p.count('support-status');await p.advance();assert.equal(p.count('support-status'),statusCalls,'active session does not poll');
  await p.click('support-close');assert.match(p.q('[data-sd-support]').textContent,/Чат допомоги закрито/);
  assert.equal(p.count('disconnect'),0);assert.equal(p.q('[data-sd-connection]').innerHTML,reminder);
});

test('Slavik link expires after 10 minutes, independently of 48-hour session access',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true})});await p.click('support-open');await p.click('support-connect');
  assert.equal(Date.parse(p.support().expires_at)-Date.parse(p.support().link_expires_at),47*3600000+50*60000);
  const before=p.count('support-status');await p.advance(600000);
  assert.equal(p.count('support-status'),before);assert.equal(p.q('[data-sd-support] a'),null);
  assert.match(p.q('[data-sd-support]').textContent,/Час доступу минув/);assert.equal(p.timers.size,0);
});

test('active Slavik support expires locally without repeated requests or retaining an access link',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true}),supportInitial:{session_id:'active-session',state:'active',expires_at:'2026-10-17T10:00:00Z',link_expires_at:'2026-10-15T10:10:00Z',pending:null}});
  await p.click('support-open');const before=p.count('support-status');
  await p.advance(48*3600000);assert.equal(p.count('support-status'),before);assert.equal(p.q('[data-sd-support] a'),null);
  assert.match(p.q('[data-sd-support]').textContent,/Час доступу минув/);assert.equal(p.timers.size,0);
});

test('Slavik support state survives via GET but link secrets are never saved or recreated automatically',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true})});await p.click('support-open');await p.click('support-connect');
  assert.equal(p.w.localStorage.length,0);
  p.remount();await tick();await tick();assert.equal(p.q('[data-sd-support] a'),null);
  assert.equal(p.count('support-connect'),1);await p.click('support-open');
  assert.equal(p.q('[data-sd-support] a'),null);assert.match(p.q('[data-sd-action=support-connect]').textContent,/Отримати посилання/);
  assert.equal(p.count('support-connect'),1);
});

test('Slavik poll/focus coalesce; detach cancels requests without affecting main connection',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true})});await p.click('support-open');await p.click('support-connect');
  let resolve;const deferred=new Promise(done=>{resolve=done;});p.setSupportHook(()=>deferred);
  const before=p.count('support-status');p.w.dispatchEvent(new p.w.Event('focus'));p.w.dispatchEvent(new p.w.Event('focus'));await p.advance();
  assert.equal(p.count('support-status'),before+1);
  p.root.remove();await tick();assert.equal(p.timers.size,0);
  assert.equal(p.calls.filter(c=>c.action==='support-status').at(-1).signal.aborted,true);
  resolve({...p.support(),state:'confirm',pending:{telegram_id:'123',display_name:'Late user'}});await tick();
  assert.equal(p.q('[data-sd-action=support-confirm]'),null);
});

test('Slavik errors stay in help area and never disable main reminder pairing',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true})});const reminder=p.q('[data-sd-connection]').innerHTML;
  p.setSupportHook(()=>{throw new Error('Synthetic private failure');});await p.click('support-open');
  assert.match(p.q('[data-sd-support]').textContent,/Не вдалося перевірити/);assert.doesNotMatch(p.q('[data-sd-support]').textContent,/private/);
  assert.equal(p.q('[data-sd-connection]').innerHTML,reminder);assert.equal(p.q('[data-sd-notice]').textContent,'');
  assert.equal(p.q('[data-sd-action=connect]').disabled,false);assert.equal(p.controller.isBusy(),false);
  await p.click('connect');assert.equal(p.q('[data-sd-telegram]').dataset.connectionState,'waiting_start');assert.equal(p.count('connect'),1);
});

test('support display names are escaped and unexpected bot URLs are never rendered',async t=>{
  const p=await fixture(t,{initial:baseSetup({support_available:true}),supportInitial:{session_id:'support-1',state:'confirm',expires_at:'2026-10-17T10:00:00Z',link_expires_at:'2026-10-15T10:10:00Z',pending:{telegram_id:'123',display_name:'<img src=x onerror=alert(1)>'}}});
  await p.click('support-open');assert.equal(p.q('[data-sd-support] img'),null);assert.match(p.q('[data-sd-support]').textContent,/<img/);
  await p.click('support-close');p.setSupportHook(()=>({...p.support(),state:'waiting_start',link:'javascript:alert(1)'}));
  await p.click('support-connect');assert.equal(p.q('[data-sd-support] a'),null);assert.match(p.q('[data-sd-support]').textContent,/Не вдалося отримати посилання/);
});
