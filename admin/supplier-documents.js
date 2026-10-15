import { icon } from './documents/icons.js';

const kinds={invoice:'Рахунок постачальника',china_shipping:'Доставка Китаєм',packing:'Пакування',other:'Інше'};
const states={waiting:'Очікуємо відправлення',sending:'Відправлення нагадування',notified:'Нагадування надіслане',failed:'Перевірте Telegram перед повтором',paused:'Нагадування призупинене',shipped:'Товар відправлено'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value ? new Date(value).toLocaleString('uk-UA',{dateStyle:'short',timeStyle:'short'}) : '';
const localDate=value=>value ? new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
const button=(action,label,name='FileText',extra='')=>`<button type="button" class="admin-btn admin-btn--small" data-sd-action="${action}" ${extra}>${icon(name)}${esc(label)}</button>`;
const tool=(action,label,name,id,version='')=>`<button type="button" class="admin-btn admin-btn--icon" data-sd-action="${action}" data-id="${esc(id)}" data-version="${version}" title="${esc(label)}" aria-label="${esc(label)}">${icon(name)}</button>`;
const panels=new WeakMap();
const pairingPollMs=4000;

export function documentRequest(getHeaders) {
  return async function request(action,{data,params={},blob=false,signal}={}) {
    const multipart=data instanceof FormData;
    const headers={...getHeaders()};
    if (multipart) delete headers['content-type'];
    const response=await fetch(`/api/admin/supplier-documents?${new URLSearchParams({action,...params})}`,{
      method:data?'POST':'GET',headers,body:data?(multipart?data:JSON.stringify(data)):undefined,cache:'no-store',signal,
    });
    if (!response.ok) {
      const result=await response.json().catch(()=>({}));
      throw new Error(result.error || `Документи тимчасово недоступні (${response.status}).`);
    }
    return blob?response.blob():response.json();
  };
}

export function mountSupplierDocuments(root,{order,payments=[],suppliers=[],getHeaders,onCountChanged=()=>{},onStateChanged=()=>{},draft=null}) {
  if (!root) return;
  panels.get(root)?.destroy();
  const request=documentRequest(getHeaders);
  let documents=[],followups=[],setup=null,pendingFiles=draft?.files.slice() || [],replacement=draft?.replacement || null,busy=false;
  const page=root.ownerDocument,win=page.defaultView;
  const eventAbort=new win.AbortController();
  let disposed=false,pairingLink=null,setupError='',deliveryStatus=null,connectionSignature='',setupFlight=null,setupGeneration=0,setupAbort=null,pollTimer=null;
  const payload=()=>({order_id:order.id,payment_id:root.querySelector('[data-sd-payment]').value,
    supplier_name:root.querySelector('[data-sd-supplier]').value,kind:root.querySelector('[data-sd-kind]').value,
    reference:root.querySelector('[data-sd-reference]').value});
  const notify=(text,error=false)=>{if(!active())return;const node=root.querySelector('[data-sd-notice]');node.textContent=text;node.classList.toggle('sd-error',error);};
  const options=(rows,current)=>rows.map(([value,label])=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`).join('');
  root.innerHTML=`<header class="sd-heading"><strong>Документи постачальника</strong><span data-sd-total></span>${button('refresh','Оновити','RefreshCw')}</header>
    <p class="sd-notice" data-sd-notice role="status" aria-live="polite"></p>
    <details class="sd-telegram-card" data-sd-telegram open><summary>Мій Telegram · перевіряємо</summary><div data-sd-connection aria-live="polite"><p>Перевіряємо підключення…</p></div></details>
    <details data-sd-upload><summary>Додати документ</summary>
      <div class="sd-fields">
        <label>Оплата<select data-sd-payment>${options([['','Без прив’язки до оплати'],...payments.map(p=>[p.id,`${p.payment_number} · ${p.supplier_name}`])],payments.length===1?payments[0].id:'')}</select></label>
        <label>Постачальник<input data-sd-supplier list="sd-suppliers-${esc(order.id)}" maxlength="200"><datalist id="sd-suppliers-${esc(order.id)}">${suppliers.map(s=>`<option value="${esc(s.display_name || s)}"></option>`).join('')}</datalist></label>
        <label>Тип<select data-sd-kind>${options(Object.entries(kinds),'invoice')}</select></label>
        <label>№ рахунку, необов’язково<input data-sd-reference maxlength="200"></label>
      </div>
      <div class="sd-drop" tabindex="0" aria-label="Файли документа: вибрати, перетягнути або вставити">
        <input data-sd-file type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple aria-label="Файли документа">
        <span>JPG, PNG, WebP, PDF · до 10 МБ на файл</span>
        <div data-sd-pending></div>
      </div>
      <div class="sd-toolbar">${button('upload','Зберегти файли','Save')}${button('cancel-upload','Скасувати','ArrowLeft')}${button('intake','Додати через Telegram','Share2')}</div><div data-sd-intake-link></div>
    </details>
    <details data-sd-shared><summary>Приєднати спільний рахунок</summary><div class="sd-toolbar"><input data-sd-search placeholder="№ замовлення, постачальник або файл" aria-label="Пошук наявного документа">${button('search','Знайти','FileText')}</div><div data-sd-search-results></div></details>
    <div class="sd-toolbar sd-selection"><span data-sd-selected>Вибрано: 0</span>${button('bundle','ZIP для перевізника','Download')}${button('send','У мій Telegram','Share2')}${button('send-followup','Telegram + запит китайською','Share2')}</div>
    <div data-sd-list></div>
    <details><summary>Вилучені з цього замовлення <span data-sd-archived-count></span></summary><div data-sd-archive></div></details>
    <details data-sd-followups><summary>Контроль відправлення</summary><div data-sd-followup-list></div></details>`;
  const connectionRoot=root.querySelector('[data-sd-connection]');
  function active() {return !disposed && root.isConnected && root.querySelector('[data-sd-connection]')===connectionRoot;}
  function clearPoll() {if(pollTimer!==null){win.clearTimeout(pollTimer);pollTimer=null;}}
  function destroy() {
    if(disposed)return;
    disposed=true;setupGeneration++;clearPoll();setupAbort?.abort();eventAbort.abort();observer.disconnect();
    win.removeEventListener('focus',checkOnReturn);page.removeEventListener('visibilitychange',checkOnReturn);
  }
  function pairingState() {
    const candidate=setup?.pairing || (setup?.pending?{state:'confirm',expires_at:setup.pending.expires_at}:null);
    if(candidate && Date.parse(candidate.expires_at)<=Date.now())return {...candidate,state:'expired'};
    return candidate;
  }
  function schedulePoll() {
    clearPoll();
    if(!active()){destroy();return;}
    const pairing=pairingState();
    if(!pairing || !['waiting_start','confirm'].includes(pairing.state))return;
    const remaining=Date.parse(pairing.expires_at)-Date.now();
    if(!Number.isFinite(remaining) || remaining<=0)return;
    pollTimer=win.setTimeout(()=>{
      pollTimer=null;
      if(!active()){destroy();return;}
      if(pairingState()?.state==='expired'){pairingLink=null;renderConnection();return;}
      if(busy || page.hidden){schedulePoll();return;}
      refreshSetup().catch(()=>{});
    },Math.min(pairingPollMs,remaining));
  }
  function checkOnReturn() {
    if(!active()){destroy();return;}
    if(!page.hidden && !busy && (pairingState() || setupError))refreshSetup().catch(()=>{});
  }
  const observer=new win.MutationObserver(()=>{if(!active())destroy();});
  observer.observe(page.documentElement,{childList:true,subtree:true});
  win.addEventListener('focus',checkOnReturn);page.addEventListener('visibilitychange',checkOnReturn);
  panels.set(root,{destroy});
  function syncSupplier() {
    const payment=payments.find(p=>p.id===payload().payment_id);
    const field=root.querySelector('[data-sd-supplier]');
    field.readOnly=Boolean(payment);
    if (payment) field.value=payment.supplier_name || '';
  }
  if (draft) {
    for (const [key,selector] of Object.entries({payment_id:'payment',supplier_name:'supplier',kind:'kind',reference:'reference'})) {
      root.querySelector(`[data-sd-${selector}]`).value=draft.payload[key];
    }
    root.querySelector('[data-sd-upload]').open=true;
  }
  syncSupplier();
  root.addEventListener('sd:payment',event=>{
    if(!active())return;
    root.querySelector('[data-sd-payment]').value=event.detail;
    root.querySelector('[data-sd-upload]').open=true;
    root.querySelector('[data-sd-followups]').open=true;
    syncSupplier();root.scrollIntoView({block:'start'});
  },{signal:eventAbort.signal});
  function selected() { return [...root.querySelectorAll('[data-sd-select]:checked')].map(node=>node.dataset.sdSelect); }
  function updateSelection() {
    const count=selected().length;
    root.querySelector('[data-sd-selected]').textContent=`Вибрано: ${count}`;
    for (const node of root.querySelectorAll('[data-sd-action="bundle"],[data-sd-action="send"],[data-sd-action="send-followup"]')) node.disabled=!count || busy;
  }
  function renderPending() {
    root.querySelector('[data-sd-pending]').textContent=`${replacement?'Нова версія · ':''}${pendingFiles.map(f=>f.name).join(', ')}`;
    root.querySelector('[data-sd-action="upload"]').disabled=!pendingFiles.length || busy || !setup?.storage_ready;
    if (root.isConnected) onStateChanged();
  }
  function setBusy(value) {
    if(!active())return;
    busy=value;root.inert=value;
    updateSelection();renderPending();
    if(!value)schedulePoll();
  }
  function acceptFiles(files) {
    if (busy) return;
    const candidates=[...files];
    if (candidates.length>10 || (replacement && candidates.length!==1)) throw new Error(replacement?'Для заміни оберіть один файл.':'Оберіть до 10 файлів.');
    if (candidates.some(f=>f.size>10*1024*1024)) throw new Error('Максимум 10 МБ на файл.');
    pendingFiles=candidates;
    renderPending();
  }
  function renderRows() {
    const kept=new Set(selected());
    const active=documents.filter(d=>!d.archived_at), archived=documents.filter(d=>d.archived_at);
    root.querySelector('[data-sd-total]').textContent=String(active.length);
    root.querySelector('[data-sd-archived-count]').textContent=archived.length?`· ${archived.length}`:'';
    const row=d=>`<article class="sd-document" data-sd-row="${esc(d.id)}">
      ${d.archived_at?'':`<input type="checkbox" data-sd-select="${esc(d.id)}" aria-label="Вибрати ${esc(d.filename)}" ${kept.has(d.id)?'checked':''}>`}
      <div class="sd-document-info"><strong>${esc(d.reference || d.filename)}</strong><small>${esc(d.supplier_name)} · ${esc(kinds[d.kind])}${d.payment_id?` · ${esc(payments.find(p=>p.id===d.payment_id)?.payment_number || '')}`:''}</small><small>${date(d.version_created_at)} · ${esc(setup?.managers.find(u=>u.id===d.version_created_by)?.name || d.version_created_by)} · v${d.current_version} · ${Math.ceil(d.bytes/1024)} КБ${d.linked_orders>1?` · ${d.linked_orders} замовлення`:''}</small></div>
      <div class="sd-tools">${tool('preview','Переглянути','Eye',d.id)}${tool('download','Завантажити','Download',d.id)}${d.archived_at?tool('restore','Повернути в замовлення','RefreshCw',d.id):`${tool('replace','Нова версія','Pencil',d.id)}${tool('archive','Вилучити з замовлення','Trash2',d.id)}`}${tool('versions','Попередні версії','History',d.id)}</div><div class="sd-versions" data-sd-versions="${esc(d.id)}"></div></article>`;
    root.querySelector('[data-sd-list]').innerHTML=active.map(row).join('') || '<p class="muted">Документів ще немає.</p>';
    root.querySelector('[data-sd-archive]').innerHTML=archived.map(row).join('');
    updateSelection(); onCountChanged(order.id,active.length);
  }
  function renderFollowups() {
    root.querySelector('[data-sd-followup-list]').innerHTML=payments.map(p=>{
      const f=followups.find(f=>f.payment_id===p.id);
      const effective=f?.effective_due_at || (p.status==='paid' && p.paid_at ? new Date(Date.parse(p.paid_at)+5*86400000).toISOString() : '');
      const owner=setup?.managers.find(u=>u.id===(f?.admin_id || setup?.user.id));
      const dispatched=['china_warehouse','left_china','in_ukraine','ready_for_pickup','completed','canceled'].includes(order.status);
      return `<div class="sd-followup" data-sd-followup="${esc(p.id)}"><strong>${esc(p.payment_number)} · ${esc(p.supplier_name)}</strong><small data-sd-followup-status>${esc(dispatched?'Нагадування зупинені за статусом замовлення':f?states[f.state]:'Нагадування не ввімкнене')}${p.status!=='paid'?' · після повної оплати':''}${!dispatched && !owner?.telegram_ready?' · підключіть Telegram відповідального':''}</small>
        <div class="sd-fields"><label>Відповідальний<select data-sd-owner>${options((setup?.managers||[]).map(u=>[u.id,`${u.name}${u.telegram_ready?'':' (без Telegram)'}`]),f?.admin_id || setup?.user.id)}</select></label><label>Перевірити<input data-sd-due type="datetime-local" value="${localDate(effective)}"></label><label>Стан<select data-sd-state>${options([['waiting','Очікуємо'],['paused','Пауза'],['shipped','Товар відправлено']],['paused','shipped'].includes(f?.state)?f.state:'waiting')}</select></label><label>Трек Китаєм<input data-sd-track value="${esc(f?.tracking_number)}"></label></div>
        <div class="sd-toolbar">${button('followup-save','Зберегти','Save')}${button('asked','Запитав · +2 дні','RefreshCw')}${button('later','Відкласти на день','History')}${button('copy-followup','Запит китайською','Copy')}</div></div>`;
    }).join('') || '<p class="muted">Нагадування доступні після створення оплати постачальнику.</p>';
  }
  function refreshFollowupTelegramLabels() {
    // Update identity/readiness only: polling must never replace an unsaved date,
    // owner, tracking number or follow-up state the manager is currently editing.
    for(const row of root.querySelectorAll('[data-sd-followup]')) {
      const ownerSelect=row.querySelector('[data-sd-owner]');
      for(const option of ownerSelect.options) {
        const manager=setup?.managers?.find(u=>u.id===option.value);
        if(manager)option.textContent=`${manager.name}${manager.telegram_ready?'':' (без Telegram)'}`;
      }
      const payment=payments.find(p=>p.id===row.dataset.sdFollowup),followup=followups.find(f=>f.payment_id===payment?.id);
      const owner=setup?.managers?.find(u=>u.id===ownerSelect.value);
      const dispatched=['china_warehouse','left_china','in_ukraine','ready_for_pickup','completed','canceled'].includes(order.status);
      row.querySelector('[data-sd-followup-status]').textContent=(dispatched?'Нагадування зупинені за статусом замовлення':followup?states[followup.state]:'Нагадування не ввімкнене')+(payment?.status!=='paid'?' · після повної оплати':'')+(!dispatched && !owner?.telegram_ready?' · підключіть Telegram відповідального':'');
    }
  }
  function renderConnection() {
    if(!active())return;
    const connected=setup?.connected,pairing=pairingState(),pending=pairing?.state==='confirm'?setup?.pending:null;
    if(!pairing || pairing.state==='expired')pairingLink=null;
    const signature=JSON.stringify({connected,pairing,pending,pairingLink,setupError,deliveryStatus,user:setup?.user,cron_ready:setup?.cron_ready,cron_last_run_at:setup?.cron_last_run_at});
    if(signature===connectionSignature)return;
    connectionSignature=signature;
    const details=root.querySelector('[data-sd-telegram]');
    const status=pairing?.state==='confirm'?'потрібне підтвердження':pairing?.state==='waiting_start'?'очікуємо Start у боті':connected?'підключено':pairing?.state==='expired'?'посилання прострочене':setup?'не підключено':'не вдалося перевірити';
    details.querySelector('summary').textContent=`Мій Telegram · ${status}`;
    details.dataset.connectionState=pairing?.state || (connected?'connected':setup?'disconnected':'error');
    if(!connected || pairing)details.open=true;
    let content='';
    if(connected)content+=`<p class="sd-connection-current"><strong>Підключено: ${esc(connected.display_name)}</strong> · ${esc(setup?.user.name)}</p>`;
    else if(setup)content+=`<p>${esc(setup.user.name)} · особисті нагадування поки не надходять.</p>`;
    if(pairing?.state==='waiting_start') {
      content+=`<p><strong>1. Відкрийте бота й натисніть «Запустити / Start».</strong><br>2. Поверніться сюди — з’явиться кнопка підтвердження.</p><div class="sd-toolbar" data-sd-connect-link>${pairingLink?`<a class="admin-btn sd-primary" href="${esc(pairingLink)}" target="_blank" rel="noopener noreferrer">Відкрити бота в Telegram</a>`:button('connect','Отримати нове посилання','Share2','data-sd-primary')}</div><p class="sd-connection-help">${pairingLink?'Чекаємо відповідь від бота автоматично.':'Після перезавантаження сторінки відкрийте бота за новим посиланням.'} Посилання діє до ${esc(date(pairing.expires_at))}.</p>`;
    } else if(pending) {
      content+=`<p><strong>Останній крок: це ваш Telegram?</strong><br>${esc(pending.display_name)} · ID ${esc(pending.telegram_id)}</p><div class="sd-toolbar">${button('confirm','Це мій Telegram','Save','data-sd-primary')}${button('connect','Ні, підключити інший','Share2')}</div>`;
    } else if(pairing?.state==='expired') {
      content+=`<p>Час для підключення минув. Відкрийте нове посилання та натисніть Start у боті.</p><div class="sd-toolbar">${button('connect','Підключити знову','Share2','data-sd-primary')}</div>`;
    } else if(!connected && setup) {
      content+=`<p>Підключіть один раз: відкрити бота → Start → підтвердити тут.</p><div class="sd-toolbar">${button('connect','Підключити мій Telegram','Share2','data-sd-primary')}</div>`;
    } else if(connected) {
      content+=`<p class="sd-connection-help">Telegram прив’язано. Терміни нагадувань — у «Контролі відправлення».</p><div class="sd-toolbar">${button('test-connection','Перевірити повідомлення','Share2')}${button('connect','Змінити Telegram','Share2')}${button('disconnect','Відключити','Trash2')}</div>`;
    }
    if(connected && deliveryStatus==='sent')content+='<p class="sd-connection-delivery" role="status">Підключено · контрольне повідомлення надіслано у ваш Telegram.</p>';
    if(connected && deliveryStatus==='failed')content+='<p class="sd-connection-error" role="status">Telegram прив’язано, але повідомлення не доставлено. Перевірте, чи бот не заблокований, і натисніть «Перевірити повідомлення».</p>';
    if(setup && !setup.cron_ready)content+=`<p class="sd-connection-warning" role="status">Планувальник нагадувань не підтверджений: ${setup.cron_last_run_at?`остання перевірка ${esc(date(setup.cron_last_run_at))}`:'ще немає успішної перевірки'}. Саме підключення Telegram не гарантує надсилання. Повідомте адміністратора.</p>`;
    if(setupError)content+=`<p class="sd-connection-error" role="status">${esc(setupError)}</p><div class="sd-toolbar">${button('setup','Повторити перевірку','RefreshCw')}</div>`;
    connectionRoot.innerHTML=content;
  }
  async function refresh() {
    if(!active())return;
    const result=await request('list',{params:{order_id:order.id}});
    if (!active()) return;
    documents=result.documents; followups=result.followups;
    renderRows(); renderFollowups();
  }
  async function refreshSetup() {
    if(!active()){destroy();return;}
    if(setupFlight)return setupFlight;
    const generation=setupGeneration;
    setupAbort=new AbortController();
    setupFlight=(async()=>{
      try {
        const result=await request('setup',{signal:setupAbort.signal});
        if(!active() || generation!==setupGeneration)return;
        setup=result;setupError='';renderConnection();renderPending();refreshFollowupTelegramLabels();
        if(!setup.storage_ready)notify('Приватне сховище ще не підключене. Завантаження тимчасово недоступне.',true);
      } catch(error) {
        if(!active() || generation!==setupGeneration)return;
        setupError='Не вдалося перевірити підключення. Перевірте інтернет або спробуйте ще раз.';
        renderConnection();throw error;
      } finally {
        setupFlight=null;setupAbort=null;if(active())schedulePoll();
      }
    })();
    return setupFlight;
  }
  async function preparePairingAction() {
    setupGeneration++;clearPoll();setupAbort?.abort();
    await setupFlight?.catch(()=>{});
  }
  async function uploadPendingFiles() {
    const total=pendingFiles.length;
    if (!total) return;
    if (!setup?.storage_ready) throw new Error('Приватне сховище ще не готове. Спробуйте оновити документи.');
    const uploadPayload=payload();
    if (replacement?.linked_orders>1 && !confirm(`Замінити файл у ${replacement.linked_orders} пов’язаних замовленнях? Стара версія збережеться.`)) return false;
    while (pendingFiles.length) {
      const form=new FormData();
      for (const [key,value] of Object.entries(uploadPayload)) form.set(key,value);
      if (replacement) {form.set('document_id',replacement.id);form.set('version',replacement.current_version);}
      form.set('file',pendingFiles[0]);
      await request('upload',{data:form});pendingFiles.shift();renderPending();
    }
    replacement=null;root.querySelector('[data-sd-file]').value='';
    await refresh();notify(`Збережено файлів: ${total}. Суми оплати не змінені.`);
    return true;
  }
  async function savePending() {
    if (busy) throw new Error('Дочекайтеся завершення дії з документами.');
    if (!pendingFiles.length) return true;
    setBusy(true);notify('');
    try {return await uploadPendingFiles();}
    catch (error) {notify(error.message,true);throw error;}
    finally {setBusy(false);}
  }
  function intakeLinkNotice(link) {
    const container=root.querySelector('[data-sd-intake-link]');
    container.innerHTML=`<p>Це посилання лише для завантаження документів.</p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Відкрити завантаження в Telegram</a>`;
    root.querySelector('[data-sd-upload]').open=true;
    container.scrollIntoView({block:'nearest'});
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url; a.download=name; a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function preview(blob,name) {
    const url=URL.createObjectURL(blob),dialog=document.createElement('dialog');
    dialog.className='sd-preview';
    dialog.innerHTML=`<header><strong>${esc(name)}</strong><button type="button" class="admin-btn" data-close>Закрити</button></header>${blob.type==='application/pdf'?`<iframe sandbox title="${esc(name)}" src="${url}"></iframe>`:`<img alt="${esc(name)}" src="${url}">`}`;
    document.body.append(dialog);dialog.showModal();
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();},{once:true});
  }
  root.addEventListener('change',event=>{
    if(!active())return;
    if (event.target.matches('[data-sd-payment]')) syncSupplier();
    if (event.target.matches('[data-sd-select]')) updateSelection();
    if (event.target.matches('[data-sd-file]')) try {acceptFiles(event.target.files);}catch(e){notify(e.message,true);}
    if (event.target.matches('[data-sd-owner]'))refreshFollowupTelegramLabels();
  },{signal:eventAbort.signal});
  root.addEventListener('keydown',event=>{
    if(!active())return;
    if (event.key!=='Enter' || !event.target.matches('input:not([type=file]):not([type=checkbox])')) return;
    event.preventDefault();
    if (event.target.matches('[data-sd-search]')) root.querySelector('[data-sd-action="search"]').click();
  },{signal:eventAbort.signal});
  const drop=root.querySelector('.sd-drop');
  drop.addEventListener('dragover',event=>{event.preventDefault();},{signal:eventAbort.signal});
  drop.addEventListener('drop',event=>{event.preventDefault();try{acceptFiles(event.dataTransfer.files);}catch(e){notify(e.message,true);}},{signal:eventAbort.signal});
  drop.addEventListener('paste',event=>{if(event.clipboardData.files.length){event.preventDefault();try{acceptFiles(event.clipboardData.files);}catch(e){notify(e.message,true);}}},{signal:eventAbort.signal});
  root.addEventListener('click',async event=>{
    if(!active())return;
    const target=event.target.closest('[data-sd-action]');
    if (!target || busy) return;
    event.preventDefault();
    const action=target.dataset.sdAction,id=target.dataset.id;
    const doc=documents.find(d=>d.id===id);
    const version=target.dataset.version;
    setBusy(true);target.disabled=true;notify('');
    try {
      if(action==='refresh') {await refreshSetup();await refresh();}
      else if(action==='setup') {await refreshSetup();}
      else if(action==='connect') {
        await preparePairingAction();
        const result=await request('connect',{data:{}});
        if(!active())return;
        pairingLink=result.link;setupError='';deliveryStatus=null;
        setup={...setup,pending:null,pairing:{state:'waiting_start',expires_at:result.expires_at || new Date(Date.now()+600000).toISOString()}};
        renderConnection();schedulePoll();root.querySelector('[data-sd-telegram]').scrollIntoView({block:'nearest'});
      }
      else if(action==='confirm') {
        const pending=setup?.pending;
        if(!pending || pairingState()?.state!=='confirm')throw new Error('Посилання вже не дійсне. Підключіть Telegram знову.');
        await preparePairingAction();const result=await request('confirm',{data:{telegram_id:pending.telegram_id}});pairingLink=null;
        deliveryStatus=result.connection_message_sent===true?'sent':'failed';
        await refreshSetup();
        notify(deliveryStatus==='sent'?'Telegram підключено. Контрольне повідомлення надіслано.':'Telegram прив’язано, але повідомлення не доставлено. Перевірте бота й повторіть перевірку.',deliveryStatus==='failed');
      }
      else if(action==='test-connection') {
        deliveryStatus=null;
        try {const result=await request('test-connection',{data:{}});deliveryStatus=result.connection_message_sent===true?'sent':'failed';}
        catch(error){deliveryStatus='failed';throw error;}
        finally {renderConnection();}
      }
      else if(action==='disconnect') {if(confirm('Відключити ваш Telegram? Особисті нагадування зупиняться.')){await preparePairingAction();await request('disconnect',{data:{}});pairingLink=null;deliveryStatus=null;await refreshSetup();}}
      else if(action==='intake') intakeLinkNotice((await request('intake',{data:payload()})).link);
      else if(action==='replace') {
        replacement=doc;pendingFiles=[];
        root.querySelector('[data-sd-upload]').open=true;
        root.querySelector('[data-sd-payment]').value=doc.payment_id || '';
        root.querySelector('[data-sd-supplier]').value=doc.supplier_name;
        root.querySelector('[data-sd-kind]').value=doc.kind;
        root.querySelector('[data-sd-reference]').value=doc.reference;
        syncSupplier();renderPending();
        root.querySelector('[data-sd-file]').value='';
        root.querySelector('[data-sd-upload]').scrollIntoView({block:'nearest'});
        if(doc.linked_orders>1) notify(`Нова версія оновить документ у ${doc.linked_orders} замовленнях.`);
      }
      else if(action==='cancel-upload') {pendingFiles=[];replacement=null;root.querySelector('[data-sd-file]').value='';renderPending();}
      else if(action==='upload') {
        await uploadPendingFiles();
      }
      else if(action==='preview' || action==='download') {
        const blob=await request('file',{params:{order_id:order.id,id,...(version?{version}:{})},blob:true});
        if(action==='preview') preview(blob,doc.filename);else download(blob,doc.filename);
      }
      else if(action==='versions') {
        const {versions}=await request('versions',{params:{order_id:order.id,id}});
        root.querySelector(`[data-sd-versions="${CSS.escape(id)}"]`).innerHTML=versions.map(v=>`<div><span>v${v.version} · ${date(v.created_at)} · ${esc(v.filename)}</span>${tool('preview','Переглянути версію','Eye',id,v.version)}${tool('download','Завантажити версію','Download',id,v.version)}</div>`).join('');
      }
      else if(action==='archive' || action==='restore') {
        if(action==='restore' || confirm('Вилучити документ лише з цього замовлення? Його можна буде відновити.')){await request(action,{data:{order_id:order.id,id}});await refresh();}
      }
      else if(action==='search') {
        const result=await request('search',{params:{q:root.querySelector('[data-sd-search]').value}});
        root.querySelector('[data-sd-search-results]').innerHTML=result.documents.map(d=>`<div class="sd-shared-result"><span>${esc(d.order_number)} · ${esc(d.supplier_name)} · ${esc(d.reference || d.filename)}</span>${button('link','Приєднати','Plus',`data-id="${esc(d.id)}"`)}</div>`).join('') || '<p class="muted">Збігів немає.</p>';
      }
      else if(action==='link') {await request('link',{data:{...payload(),id}});await refresh();notify('Спільний документ приєднано.');}
      else if(action==='bundle') {download(await request('bundle',{data:{order_id:order.id,ids:selected()},blob:true}),`${order.order_number}-supplier-documents.zip`);}
      else if(action==='send' || action==='send-followup') {
        if(!setup?.connected){root.querySelector('[data-sd-telegram]').open=true;throw new Error('Спочатку підключіть особистий Telegram.');}
        if(!confirm(`Надіслати вибрані файли (${selected().length}) у ваш Telegram: ${setup.connected.display_name}?`)) return;
        const result=await request('send',{data:{order_id:order.id,ids:selected(),followup_text:action==='send-followup'}});
        for(const input of root.querySelectorAll('[data-sd-select]')) if(result.sent.includes(input.dataset.sdSelect)) input.checked=false;
        notify(result.uncertain?`Підтверджено файлів: ${result.sent.length}. Решта не підтверджені: перевірте Telegram перед повтором.`:`Надіслано файлів: ${result.sent.length}.`,result.uncertain);
      }
      else if(['followup-save','asked','later','copy-followup'].includes(action)) {
        const row=target.closest('[data-sd-followup]'),paymentId=row.dataset.sdFollowup,payment=payments.find(p=>p.id===paymentId);
        if(action==='copy-followup') {
          const reference=documents.find(d=>d.payment_id===paymentId && d.kind==='invoice' && !d.archived_at)?.reference || payment.payment_number;
          await navigator.clipboard.writeText(`您好，请帮忙确认订单 ${reference} 的发货进度。请问什么时候可以发货？如已发货，请提供中国境内快递单号。谢谢！`);notify('Запит скопійовано.');
        } else {
          const dateValue=row.querySelector('[data-sd-due]').value;
          await request('followup',{data:{order_id:order.id,payment_id:paymentId,admin_id:row.querySelector('[data-sd-owner]').value,
            state:action==='followup-save'?row.querySelector('[data-sd-state]').value:'waiting',
            due_at:action==='followup-save'?(dateValue?new Date(dateValue).toISOString():null):new Date(Date.now()+(action==='asked'?2:1)*86400000).toISOString(),
            tracking_number:row.querySelector('[data-sd-track]').value,asked:action==='asked'}});
          await refresh();notify('Контроль відправлення оновлено.');
        }
      }
    } catch(error) {notify(error.message,true);}
    finally {if(target.isConnected)target.disabled=false;setBusy(false);}
  },{signal:eventAbort.signal});
  refreshSetup().then(refresh).catch(error=>notify(error.message,true));
  renderPending();
  return {refresh,savePending,destroy,orderId:order.id,hasPendingFiles:()=>pendingFiles.length>0,isBusy:()=>busy,
    getDraft:()=>pendingFiles.length?{files:pendingFiles.slice(),replacement,payload:payload()}:null};
}
