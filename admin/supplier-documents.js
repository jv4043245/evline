import { icon } from './documents/icons.js';

const kinds={invoice:'Рахунок постачальника',china_shipping:'Доставка Китаєм',packing:'Пакування',other:'Інше'};
const states={waiting:'Очікуємо відправлення',sending:'Відправлення нагадування',notified:'Нагадування надіслане',failed:'Перевірте Telegram перед повтором',paused:'Нагадування призупинене',shipped:'Товар відправлено'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value ? new Date(value).toLocaleString('uk-UA',{dateStyle:'short',timeStyle:'short'}) : '';
const localDate=value=>value ? new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
const button=(action,label,name='FileText',extra='')=>`<button type="button" class="admin-btn admin-btn--small" data-sd-action="${action}" ${extra}>${icon(name)}${esc(label)}</button>`;
const tool=(action,label,name,id,version='')=>`<button type="button" class="admin-btn admin-btn--icon" data-sd-action="${action}" data-id="${esc(id)}" data-version="${version}" title="${esc(label)}" aria-label="${esc(label)}">${icon(name)}</button>`;

export function documentRequest(getHeaders) {
  return async function request(action,{data,params={},blob=false}={}) {
    const multipart=data instanceof FormData;
    const headers={...getHeaders()};
    if (multipart) delete headers['content-type'];
    const response=await fetch(`/api/admin/supplier-documents?${new URLSearchParams({action,...params})}`,{
      method:data?'POST':'GET',headers,body:data?(multipart?data:JSON.stringify(data)):undefined,cache:'no-store',
    });
    if (!response.ok) {
      const result=await response.json().catch(()=>({}));
      throw new Error(result.error || `Документи тимчасово недоступні (${response.status}).`);
    }
    return blob?response.blob():response.json();
  };
}

export function mountSupplierDocuments(root,{order,payments=[],suppliers=[],getHeaders,onCountChanged=()=>{}}) {
  if (!root) return;
  const request=documentRequest(getHeaders);
  let documents=[],followups=[],setup=null,pendingFiles=[],replacement=null,busy=false;
  const payload=()=>({order_id:order.id,payment_id:root.querySelector('[data-sd-payment]').value,
    supplier_name:root.querySelector('[data-sd-supplier]').value,kind:root.querySelector('[data-sd-kind]').value,
    reference:root.querySelector('[data-sd-reference]').value});
  const notify=(text,error=false)=>{const node=root.querySelector('[data-sd-notice]');node.textContent=text;node.classList.toggle('sd-error',error);};
  const options=(rows,current)=>rows.map(([value,label])=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`).join('');
  root.innerHTML=`<header class="sd-heading"><strong>Документи постачальника</strong><span data-sd-total></span>${button('refresh','Оновити','RefreshCw')}</header>
    <p class="sd-notice" data-sd-notice role="status" aria-live="polite"></p>
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
      <div class="sd-toolbar">${button('upload','Зберегти файли','Save')}${button('cancel-upload','Скасувати','ArrowLeft')}${button('intake','Додати через Telegram','Share2')}</div>
    </details>
    <details data-sd-shared><summary>Приєднати спільний рахунок</summary><div class="sd-toolbar"><input data-sd-search placeholder="№ замовлення, постачальник або файл" aria-label="Пошук наявного документа">${button('search','Знайти','FileText')}</div><div data-sd-search-results></div></details>
    <div class="sd-toolbar sd-selection"><span data-sd-selected>Вибрано: 0</span>${button('bundle','ZIP для перевізника','Download')}${button('send','У мій Telegram','Share2')}${button('send-followup','Telegram + запит китайською','Share2')}</div>
    <div data-sd-list></div>
    <details><summary>Вилучені з цього замовлення <span data-sd-archived-count></span></summary><div data-sd-archive></div></details>
    <details data-sd-followups><summary>Контроль відправлення</summary><div data-sd-followup-list></div></details>
    <details data-sd-telegram><summary>Мій Telegram</summary><div data-sd-connection></div></details>`;
  function syncSupplier() {
    const payment=payments.find(p=>p.id===payload().payment_id);
    const field=root.querySelector('[data-sd-supplier]');
    field.readOnly=Boolean(payment);
    if (payment) field.value=payment.supplier_name || '';
  }
  syncSupplier();
  root.addEventListener('sd:payment',event=>{
    root.querySelector('[data-sd-payment]').value=event.detail;
    root.querySelector('[data-sd-upload]').open=true;
    root.querySelector('[data-sd-followups]').open=true;
    syncSupplier();root.scrollIntoView({block:'start'});
  });
  function selected() { return [...root.querySelectorAll('[data-sd-select]:checked')].map(node=>node.dataset.sdSelect); }
  function updateSelection() {
    const count=selected().length;
    root.querySelector('[data-sd-selected]').textContent=`Вибрано: ${count}`;
    for (const node of root.querySelectorAll('[data-sd-action="bundle"],[data-sd-action="send"],[data-sd-action="send-followup"]')) node.disabled=!count || busy;
  }
  function renderPending() {
    root.querySelector('[data-sd-pending]').textContent=`${replacement?'Нова версія · ':''}${pendingFiles.map(f=>f.name).join(', ')}`;
    root.querySelector('[data-sd-action="upload"]').disabled=!pendingFiles.length || busy || !setup?.storage_ready;
  }
  function acceptFiles(files) {
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
      return `<div class="sd-followup" data-sd-followup="${esc(p.id)}"><strong>${esc(p.payment_number)} · ${esc(p.supplier_name)}</strong><small>${esc(dispatched?'Нагадування зупинені за статусом замовлення':f?states[f.state]:'Нагадування не ввімкнене')}${p.status!=='paid'?' · після повної оплати':''}${!dispatched && !owner?.telegram_ready?' · підключіть Telegram відповідального':''}</small>
        <div class="sd-fields"><label>Відповідальний<select data-sd-owner>${options((setup?.managers||[]).map(u=>[u.id,`${u.name}${u.telegram_ready?'':' (без Telegram)'}`]),f?.admin_id || setup?.user.id)}</select></label><label>Перевірити<input data-sd-due type="datetime-local" value="${localDate(effective)}"></label><label>Стан<select data-sd-state>${options([['waiting','Очікуємо'],['paused','Пауза'],['shipped','Товар відправлено']],['paused','shipped'].includes(f?.state)?f.state:'waiting')}</select></label><label>Трек Китаєм<input data-sd-track value="${esc(f?.tracking_number)}"></label></div>
        <div class="sd-toolbar">${button('followup-save','Зберегти','Save')}${button('asked','Запитав · +2 дні','RefreshCw')}${button('later','Відкласти на день','History')}${button('copy-followup','Запит китайською','Copy')}</div></div>`;
    }).join('') || '<p class="muted">Нагадування доступні після створення оплати постачальнику.</p>';
  }
  function renderConnection() {
    const connected=setup?.connected, pending=setup?.pending;
    root.querySelector('[data-sd-connection]').innerHTML=`<p>${esc(setup?.user.name)}${connected?` · ${esc(connected.display_name)} · ${esc(connected.telegram_id)}`:' · Telegram не підключений'}</p>
      ${pending?`<p>Підтвердити Telegram: <strong>${esc(pending.display_name)}</strong> · ${esc(pending.telegram_id)}</p>${button('confirm','Це мій Telegram','Save')}`:''}
      <div class="sd-toolbar">${button('connect',connected?'Змінити підключення':'Підключити мій Telegram','Share2')}${button('setup','Перевірити підключення','RefreshCw')}${connected?button('disconnect','Відключити','Trash2'):''}</div><div data-sd-connect-link></div>`;
  }
  async function refresh() {
    const result=await request('list',{params:{order_id:order.id}});
    if (!root.isConnected) return;
    documents=result.documents; followups=result.followups;
    renderRows(); renderFollowups();
  }
  async function refreshSetup() {
    setup=await request('setup');
    if (!root.isConnected) return;
    renderConnection(); renderPending();
    if (!setup.storage_ready) notify('Приватне сховище ще не підключене. Завантаження тимчасово недоступне.',true);
    else if (!setup.cron_ready) notify('Автоматичні нагадування ще не підключені.');
  }
  function linkNotice(link) {
    const container=root.querySelector('[data-sd-connect-link]');
    container.innerHTML=`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Відкрити бота в Telegram</a>`;
    root.querySelector('[data-sd-telegram]').open=true;
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
    if (event.target.matches('[data-sd-payment]')) syncSupplier();
    if (event.target.matches('[data-sd-select]')) updateSelection();
    if (event.target.matches('[data-sd-file]')) try {acceptFiles(event.target.files);}catch(e){notify(e.message,true);}
  });
  root.addEventListener('keydown',event=>{
    if (event.key!=='Enter' || !event.target.matches('input:not([type=file]):not([type=checkbox])')) return;
    event.preventDefault();
    if (event.target.matches('[data-sd-search]')) root.querySelector('[data-sd-action="search"]').click();
  });
  const drop=root.querySelector('.sd-drop');
  drop.addEventListener('dragover',event=>{event.preventDefault();});
  drop.addEventListener('drop',event=>{event.preventDefault();try{acceptFiles(event.dataTransfer.files);}catch(e){notify(e.message,true);}});
  drop.addEventListener('paste',event=>{if(event.clipboardData.files.length){event.preventDefault();try{acceptFiles(event.clipboardData.files);}catch(e){notify(e.message,true);}}});
  root.addEventListener('click',async event=>{
    const target=event.target.closest('[data-sd-action]');
    if (!target || busy) return;
    event.preventDefault();
    const action=target.dataset.sdAction,id=target.dataset.id;
    const doc=documents.find(d=>d.id===id);
    const version=target.dataset.version;
    busy=true;target.disabled=true;notify('');
    try {
      if(action==='refresh') {await refreshSetup();await refresh();}
      else if(action==='setup') {await refreshSetup();renderFollowups();}
      else if(action==='connect') linkNotice((await request('connect',{data:{}})).link);
      else if(action==='confirm') {await request('confirm',{data:{telegram_id:setup.pending.telegram_id}});await refreshSetup();notify('Telegram підключено.');}
      else if(action==='disconnect') {if(confirm('Відключити ваш Telegram? Особисті нагадування зупиняться.')){await request('disconnect',{data:{}});await refreshSetup();}}
      else if(action==='intake') linkNotice((await request('intake',{data:payload()})).link);
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
        const total=pendingFiles.length;
        const uploadPayload=payload();
        if(!total) throw new Error('Оберіть файл.');
        if(replacement?.linked_orders>1 && !confirm(`Замінити файл у ${replacement.linked_orders} пов’язаних замовленнях? Стара версія збережеться.`)) return;
        while(pendingFiles.length) {
          const form=new FormData();
          for(const [key,value] of Object.entries(uploadPayload)) form.set(key,value);
          if(replacement){form.set('document_id',replacement.id);form.set('version',replacement.current_version);}
          form.set('file',pendingFiles[0]);
          await request('upload',{data:form});pendingFiles.shift();renderPending();
        }
        replacement=null;root.querySelector('[data-sd-file]').value='';
        await refresh();notify(`Збережено файлів: ${total}. Суми оплати не змінені.`);
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
    finally {busy=false;if(target.isConnected)target.disabled=false;updateSelection();renderPending();}
  });
  refreshSetup().then(refresh).catch(error=>notify(error.message,true));
  return {refresh};
}
