const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH'}).format(Number(n || 0)/100);
const timestamp = s => s ? new Date(s).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}) : 'ще не було';
const statusLabels={paid:'Оплачено за випискою',partial:'Частково оплачено',unpaid:'Надходжень не знайдено',review:'Потрібна перевірка'};
const reviewLabels={no_invoice:'Не знайдено однозначного рахунку',ambiguous_invoice:'Кілька рахунків з цим номером',overpayment:'Сума перевищує залишок рахунку',before_invoice:'Платіж раніше дати рахунку',canceled_order:'Замовлення скасовано',possible_refund:'Можливе повернення — перевірте',bank_record_changed:'Банк змінив запис — перевірте',manual_review:'Ручна перевірка'};
const errorLabels={bank_auth:'ПУМБ не підтвердив доступ. Перевірте логін, пароль та активацію API у банку.',bank_server_setup:'Серверний доступ ПУМБ ще не налаштовано.',bank_no_accounts:'ПУМБ не повернув доступних гривневих рахунків.',bank_date_range:'Оберіть дату в межах останніх 90 днів, не пізніше сьогодні.',bank_connection_input:'Заповніть логін, пароль і підтвердіть збереження.',bank_owner_only:'Керувати підключенням може лише власник.',bank_schema:'Формат відповіді ПУМБ потребує перевірки інтеграції. Невідомі записи не зараховано.',bank_credentials_unavailable:'Не вдалося відкрити збережений доступ. Потрібна перевірка серверного ключа.',bank_rate_limit:'Банк обмежив частоту запитів. Спробуйте пізніше.',bank_busy:'Синхронізація вже триває.',bank_response_large:'Виписка перевищила безпечний обсяг. Потрібна перевірка інтеграції.'};
reviewLabels.order_deleted='Пов’язане замовлення видалено';
Object.assign(errorLabels,{
  bank_link_forbidden:'Прив’язувати платежі можуть лише власник та Андрій.',
  bank_match_conflict:'Прив’язку не виконано: платіж або замовлення змінилися, вже прив’язані, потребують перевірки або сума перевищує залишок рахунку. Оновіть список.',
  bank_redirect:'API ПУМБ повернув перенаправлення. EVLine заблокував перехід, щоб не передати доступ на іншу адресу. Потрібна перевірка адреси API.',
  bank_login_rejected:'ПУМБ відхилив авторизацію користувача. Перевірте логін і пароль для API та активацію доступу в банку. Це не помилка токена CRM.',
  bank_client_rejected:'ПУМБ відхилив серверний доступ інтеграції. Потрібна перевірка client_id / client_secret та дозволу API; повторне введення пароля не допоможе.',
  bank_auth_request:'ПУМБ відхилив формат запиту авторизації. Потрібна перевірка інтеграції; не вводьте пароль повторно.',
  bank_auth_unavailable:'Не вдалося завершити авторизацію через API ПУМБ. Технічні дані відповіді наведено нижче; це не доводить, що пароль неправильний.',
  bank_accounts_unavailable:'Авторизація пройшла, але API ПУМБ не повернув рахунки. Потрібна перевірка доступу до рахунків.',
  bank_transactions_unavailable:'API ПУМБ не повернув виписку. Збережені платежі залишаються без змін.',
  bank_timeout:'Час очікування API ПУМБ вичерпано. Це не підтверджує помилку пароля.',
  bank_network:'Не вдалося завершити мережевий запит до API ПУМБ. Потрібна перевірка з’єднання сервера EVLine з банком.',
  bank_save_failed:'Перевірка доступу пройшла, але EVLine не завершив збереження підключення. Не вводьте пароль повторно до перевірки стану.',
  bank_encryption_failed:'EVLine не зміг зашифрувати доступ. Потрібна перевірка серверного ключа; пароль не збережено.',
});
const stageLabels={validation:'перевірка форми',authorization:'авторизація ПУМБ',accounts:'отримання рахунків',encryption:'шифрування',save:'збереження підключення',complete:'підключення завершено',transactions:'отримання виписки'};
export function bankErrorMessage(code) {
  const text=String(code),message=errorLabels[text.split(/[\s.]/)[0]] || 'Не вдалося отримати дані ПУМБ. Останні збережені платежі не видалено. Спробуйте пізніше.';
  const d=/\[PUMB:([a-f0-9-]{36});stage:([a-z]+);http:(\d{1,3});saved:([01])\]/.exec(text);
  return message+(d?` Етап: ${stageLabels[d[2]] || 'перевірка'}.${Number(d[3])?` HTTP банку: ${Number(d[3])}.`:''} Номер діагностики: ${d[1]}.${d[4]==='0'?' Запис діагностики не вдалося зберегти — повідомте цей номер і текст помилки.':''}`:'');
}
const orderButton = i => `<button type="button" class="admin-link-button" data-bank-order="${escape(i.order_id)}">${escape(i.order_number || i.order_id)}</button>`;
export function invoiceTable(invoices,{compact=false}={}) {
  if(!invoices.length) return '<p class="muted">Немає готових рахунків. Відкрийте замовлення → Документи → Рахунок, перевірте дані та натисніть «Виставити рахунок». Збереження чернетки не вмикає відстеження.</p>';
  return `<div class="bank-table-scroll"><table class="bank-table"><thead><tr><th>Рахунок${compact ? '':' / замовлення'}</th><th>До сплати</th><th>Зараховано</th><th>Залишок</th><th>Стан</th></tr></thead><tbody>${invoices.map(i=>`<tr><td>${escape(i.number)}${compact?'':`<br>${orderButton(i)}`}</td><td>${money(i.amount_minor)}</td><td>${money(i.received_minor)}</td><td>${money(Math.max(0,i.amount_minor-i.received_minor))}</td><td><span class="bank-state bank-state--${escape(i.status)}">${escape(statusLabels[i.status])}</span></td></tr>`).join('')}</tbody></table></div>`;
}
const orderOptions = orders => orders.map(o=>`<option value="${escape(o.id)}">${escape(o.order_number)} · ${escape(o.customer_name)} · ${escape(o.car || o.item_name || '')} · ${money(Number(o.revenue_uah)*100)}</option>`).join('');
export function paymentTable(rows,{canLink=false,recentOrders=[]}={}) {
  if(!rows.length) return '<p class="muted">Платежів у цьому списку поки немає.</p>';
  return `<div class="bank-table-scroll"><table class="bank-table"><thead><tr><th>Дата проведення</th><th>Платник / призначення</th><th>Сума</th><th>Рахунок / перевірка</th></tr></thead><tbody>${rows.map(p=>{
    const selectable=canLink && !p.order_id && p.direction==='INBOUND' && p.currency==='UAH' && !['bank_record_changed','order_deleted','manual_review'].includes(p.review_reason);
    return `<tr><td>${escape(p.booked_at.replace('T',' '))}</td><td><strong>${escape(p.payer_name)}</strong><div class="bank-purpose">${escape(p.purpose)}</div></td><td class="bank-amount">${p.direction==='OUTBOUND'?'−':''}${money(p.amount_minor)}</td><td>${p.order_id ? `${escape(p.invoice_number || 'Без рахунку')}<br>${orderButton(p)}<br>`:''}<span class="bank-state${p.review_reason?' bank-state--review':''}">${escape(p.review_reason ? reviewLabels[p.review_reason] || 'Потрібна перевірка' : p.order_id ? 'Зіставлено' : 'Очікує зіставлення')}</span>${selectable?`<div class="bank-row-picker"><label>Замовлення<select data-bank-row-order="${escape(p.id)}"><option value="">Оберіть замовлення…</option>${orderOptions(recentOrders)}</select></label><button type="button" class="admin-btn" data-bank-link="${escape(p.id)}">Знайти інше замовлення</button></div>`:''}</td></tr>${selectable?`<tr data-bank-link-row="${escape(p.id)}" hidden><td colspan="4"><section data-bank-link-panel="${escape(p.id)}"></section></td></tr>`:''}`;
  }).join('')}</tbody></table></div>`;
}

export function createBankIncomingView(root,api,{openOrder=()=>{}}={}) {
  let data=null,page=1,review=false,busy=false,loading=false,revision=0,timer=null;
  let linking=null,searchOrders=[],chosenOrder=null,chosenInvoices=[],recentOrders=[];
  const post=body=>api('/api/admin/bank-incoming',{method:'POST',body:JSON.stringify(body)});
  const showMessage=(text,error=false)=>{const node=root.querySelector('[data-bank-message]');if(node){node.textContent=text;node.classList.toggle('bank-error',error);}};
  function render() {
    const c=data.connection;
    root.innerHTML=`<div class="admin-panel__head"><div><h2>Надходження · ПУМБ</h2><p class="muted">Виписка рахунків ФОП у гривні · стан останнього оновлення нижче</p></div><button type="button" class="admin-btn" data-bank-reload>Оновити список</button></div>
      <div class="bank-connection"><strong>${c.enabled?'Підключено':c.configured?'Синхронізацію призупинено':'Ще не підключено'}</strong>
      <span>${c.accounts.map(a=>escape(a.iban_masked)).join(' · ')}</span><span>Остання успішна перевірка: ${escape(timestamp(c.last_success_at))}</span>
      ${c.cursor_date?`<span>Виписку завантажено до ${escape(c.cursor_date)} включно${c.cursor_date<new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date())?' · історія ще завантажується':''}</span>`:''}
      ${c.last_error?`<p class="bank-error">${escape(bankErrorMessage(c.last_error))}</p>`:''}
      ${data.can_manage?`<div class="bank-actions">${c.enabled?'<button type="button" class="admin-btn" data-bank-sync>Перевірити банк зараз</button><button type="button" class="admin-btn" data-bank-pause>Призупинити</button>':''}</div>`:''}</div>
      <p data-bank-message role="status" aria-live="polite"></p>
      ${data.can_manage && data.connect_diagnostic?.outcome==='error'?`<p class="bank-error" data-bank-diagnostic>Остання спроба підключення (${escape(timestamp(data.connect_diagnostic.at))}): ${escape(bankErrorMessage(`${data.connect_diagnostic.code} [PUMB:${data.connect_diagnostic.id};stage:${data.connect_diagnostic.stage};http:${data.connect_diagnostic.upstream_status || 0};saved:1]`))}</p>`:''}
      ${data.can_manage ? `<details class="bank-setup" ${c.configured?'':'open'}><summary>${c.configured?'Змінити / поновити підключення':'Підключити ПУМБ'}</summary>
      ${c.server_ready ? `<form data-bank-connect autocomplete="off"><p>Інтеграція лише читає рахунки та виписки: не створює і не підписує платежів. Основний банківський користувач може мати ширші права. Безпечніший варіант — окремий користувач лише для перегляду.</p>
      <label>Логін ПУМБ Digital Business<input name="username" required maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label>Пароль ПУМБ<input name="password" type="password" required maxlength="500" autocomplete="new-password"></label>
      <label>Завантажити платежі починаючи з<input name="start_date" type="date" required value="${escape(c.start_date || new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date()))}"></label>
      <label class="bank-consent"><input name="consent" type="checkbox" required>Дозволяю зберегти логін і пароль зашифрованими на сервері EVLine для автоматичного читання виписок. Пароль не потрібно надсилати в чат.</label>
      <button class="admin-btn admin-btn--primary" type="submit">Перевірити та підключити</button></form>`:'<p>Серверні ключі ПУМБ ще не налаштовано. Банківський пароль поки вводити не потрібно.</p>'}</details>`:''}
      <p class="bank-note">Автоматично: номер готового рахунку в призначенні, IBAN та валюта. Короткі номери — лише після слова «рахунок». Часткові оплати накопичуються; статус оплати клієнта оновлюється відносно повної вартості замовлення. Сума та ім’я — тільки підказки для ручного підтвердження. Виручка, етап замовлення, повернення і витрати постачальникам не змінюються.</p>
      <h3>Рахунки клієнтам</h3>${invoiceTable(data.invoices)}
      <div class="bank-actions"><h3>Банківські операції</h3><label><input type="checkbox" data-bank-review ${review?'checked':''}>Лише для перевірки</label><span>${Number(data.summary.count)} записів · ${Number(data.summary.review_count || 0)} для перевірки</span></div>
      ${paymentTable(data.rows,{canLink:data.can_link,recentOrders})}<div class="bank-actions"><button type="button" class="admin-btn" data-bank-prev ${page<=1?'disabled':''}>Назад</button><span>Сторінка ${page}</span><button type="button" class="admin-btn" data-bank-next ${page*50>=data.summary.count?'disabled':''}>Далі</button></div>`;
  }
  function renderLink() {
    for(const node of root.querySelectorAll('[data-bank-link-panel]'))node.replaceChildren();
    for(const row of root.querySelectorAll('[data-bank-link-row]'))row.hidden=row.dataset.bankLinkRow!==linking?.id;
    for(const select of root.querySelectorAll('[data-bank-row-order]'))select.value=select.dataset.bankRowOrder===linking?.id ? chosenOrder?.id || '' : '';
    const panel=[...root.querySelectorAll('[data-bank-link-panel]')].find(node=>node.dataset.bankLinkPanel===linking?.id);if(!panel || !linking)return;
    panel.innerHTML=`<div class="bank-link-box"><h3>Прив’язати платіж ${money(linking.amount_minor)}</h3><p>${escape(linking.payer_name)} · ${escape(linking.purpose)}</p>
      <p>Виберіть замовлення і перевірте відповідність. Це змінить статус оплати клієнта, але не виручку чи етап замовлення. Уже позначені вручну «Оплачено» / «Повернено» захищені від автоматичного перезапису.</p>
      ${(linking.suggestions || []).length?`<p>Можливі збіги — не підтвердження:</p>${linking.suggestions.map(s=>`<button type="button" class="admin-btn" data-bank-suggest="${escape(s.order_number)}">${escape(s.order_number)} · ${escape(s.customer_name)} · №${escape(s.invoice_number)} · ${s.reasons.map(r=>r==='amount'?'сума':'ім’я').join(', ')}</button>`).join('')}`:''}
      <form data-bank-search><label>Номер замовлення, клієнт або авто<input name="query" required minlength="2" maxlength="100" autocomplete="off"></label><button class="admin-btn">Знайти</button></form>
      <div data-bank-search-results>${searchOrders.length?`<label>Замовлення<select data-bank-choose><option value="">Оберіть…</option>${searchOrders.map(o=>`<option value="${escape(o.id)}" ${chosenOrder?.id===o.id?'selected':''}>${escape(o.order_number)} · ${escape(o.customer_name)} · ${escape(o.car || o.item_name || '')} · ${money(Number(o.revenue_uah)*100)}</option>`).join('')}</select></label>`:''}</div>
      ${chosenOrder?`<form data-bank-confirm><p><strong>${escape(chosenOrder.order_number)} · ${escape(chosenOrder.customer_name)}</strong><br>Повна вартість замовлення: ${money(Number(chosenOrder.revenue_uah)*100)}.${Number(chosenOrder.revenue_uah)>0?' Статус врахує всі перевірені прив’язані надходження.':' Вартість не задана: буде часткова оплата, не повна.'}</p>
      <label>Рахунок (необов’язково)<select name="invoice_key"><option value="">Прив’язати лише до замовлення</option>${chosenInvoices.map(i=>`<option value="${escape(i.key)}">№${escape(i.number)} · залишок ${money(Math.max(0,i.amount_minor-i.received_minor))}</option>`).join('')}</select></label>
      <label class="bank-consent"><input type="checkbox" name="confirmed" required>Перевірено: цей платіж належить саме цьому замовленню</label><button class="admin-btn admin-btn--primary">Підтвердити прив’язку</button></form>`:''}
      <button class="admin-btn" type="button" data-bank-link-cancel>Скасувати</button><p data-bank-link-message role="status"></p></div>`;
  }
  const linkMessage=text=>{const el=root.querySelector('[data-bank-link-message]');if(el)el.textContent=text;};
  async function chooseOrder(order) {
    chosenOrder=null;chosenInvoices=[];renderLink();if(!order)return;linkMessage('Перевіряємо рахунки замовлення…');
    const current=revision,paymentId=linking?.id;busy=true;
    try{const r=await api(`/api/admin/bank-incoming?order_id=${encodeURIComponent(order.id)}`);if(current!==revision || linking?.id!==paymentId)return;chosenOrder=order;chosenInvoices=r.invoices;renderLink();}
    catch{if(current===revision){chosenOrder=null;renderLink();linkMessage('Не вдалося перевірити рахунки. Повторіть вибір.');}}finally{busy=false;}
  }
  async function searchLink(q) {
    const result=await api(`/api/admin/orders?range=all&limit=20&q=${encodeURIComponent(q)}`);
    searchOrders=(result.orders || []).filter(o=>o.status!=='canceled');chosenOrder=null;chosenInvoices=[];renderLink();
    linkMessage(searchOrders.length?`${result.total} збігів; показано до 20. Уточніть пошук за потреби.`:'Замовлень не знайдено. Спробуйте номер замовлення або інше ім’я.');
  }
  async function load() {
    if(busy || loading || linking || !root) return;
    // Never replace a form while the owner is entering credentials.
    if(root.querySelector('[data-bank-connect]')?.contains(root.ownerDocument.activeElement)) return;
    if(root.querySelector('[name="password"]')?.value || root.querySelector('[name="username"]')?.value) return;
    loading=true; const current=revision;
    try {const result=await api(`/api/admin/bank-incoming?page=${page}${review?'&review=1':''}`);
      const orders=result.can_link?await api('/api/admin/orders?range=all&limit=20').catch(()=>({orders:[]})):{orders:[]};
      if(current!==revision)return;recentOrders=(orders.orders || []).filter(o=>o.status!=='canceled');data=result;render();}
    catch(e){if(current!==revision)return;if(!data)root.innerHTML='<h2>Надходження · ПУМБ</h2><p data-bank-message role="alert"></p>';showMessage(bankErrorMessage(e.message),true);}
    finally{loading=false;}
  }
  root?.addEventListener('click',async e=>{
    const target=e.target.closest('button'); if(!target || busy)return;
    if(target.dataset.bankLink){linking=data.rows.find(p=>p.id===target.dataset.bankLink);chosenOrder=null;searchOrders=[];chosenInvoices=[];renderLink();root.querySelector('[name=query]')?.focus();return;}
    if(target.hasAttribute('data-bank-link-cancel')){linking=null;renderLink();return;}
    if(target.dataset.bankSuggest){busy=true;try{await searchLink(target.dataset.bankSuggest);}catch(e){linkMessage('Не вдалося знайти замовлення.');}finally{busy=false;}return;}
    if(target.dataset.bankOrder){openOrder(target.dataset.bankOrder);return;}
    if(target.hasAttribute('data-bank-prev')){page--;await load();return;}
    if(target.hasAttribute('data-bank-next')){page++;await load();return;}
    if(target.hasAttribute('data-bank-reload')){await load();return;}
    const action=target.hasAttribute('data-bank-sync')?'sync':target.hasAttribute('data-bank-pause')?'pause':null;
    if(!action)return;
    busy=true;target.disabled=true;showMessage(action==='sync'?'Читаємо виписку ПУМБ…':'Призупиняємо…');
    try{const r=await post({action});busy=false;await load();showMessage(r.skipped?'Перевірка вже виконується або щойно завершилась. Оновіть список трохи пізніше.':action==='pause'?'Синхронізацію призупинено. Збережені платежі залишаються.':'Виписку перевірено.');}
    catch(error){showMessage(bankErrorMessage(error.message),true);}finally{busy=false;target.disabled=false;}
  });
  root?.addEventListener('change',async e=>{
    if(e.target.hasAttribute('data-bank-row-order') && !busy){linking=data.rows.find(p=>p.id===e.target.dataset.bankRowOrder);searchOrders=[];await chooseOrder(recentOrders.find(o=>o.id===e.target.value));return;}
    if(e.target.hasAttribute('data-bank-choose') && !busy){await chooseOrder(searchOrders.find(o=>o.id===e.target.value));return;}
    if(e.target.hasAttribute('data-bank-review')){review=e.target.checked;page=1;load();}
  });
  root?.addEventListener('submit',async e=>{
    if(e.target.matches('[data-bank-search]')){e.preventDefault();if(busy)return;busy=true;try{await searchLink(e.target.elements.query.value.trim());}catch{linkMessage('Помилка пошуку. Спробуйте ще раз.');}finally{busy=false;}return;}
    if(e.target.matches('[data-bank-confirm]')){e.preventDefault();if(busy || !linking || !chosenOrder || !e.target.elements.confirmed.checked)return;
      busy=true;const button=e.target.querySelector('button');button.disabled=true;linkMessage('Зберігаємо прив’язку…');
      try{await post({action:'link',payment_id:linking.id,order_id:chosenOrder.id,invoice_key:e.target.elements.invoice_key.value,
        expected_amount_minor:linking.amount_minor,expected_fingerprint:linking.fingerprint,confirmed:true});linking=null;busy=false;await load();showMessage('Платіж прив’язано. Статус оплати перевірено. Відкрийте замовлення для перегляду.');}
      catch(error){linkMessage(bankErrorMessage(error.message));}finally{busy=false;button.disabled=false;}return;}
    if(!e.target.matches('[data-bank-connect]'))return;e.preventDefault();if(busy)return;
    const form=e.target;const body={action:'connect',username:form.elements.username.value,password:form.elements.password.value,start_date:form.elements.start_date.value,consent:form.elements.consent.checked};
    busy=true;form.querySelector('button').disabled=true;showMessage('Перевіряємо доступ до ПУМБ…');
    // Clear credentials from the DOM immediately; never put them in browser storage or logs.
    form.elements.password.value='';form.elements.username.value='';
    try{await post(body);body.password='';body.username='';showMessage('Доступ підтверджено. Завантажуємо першу виписку…');await post({action:'sync'});busy=false;await load();showMessage('ПУМБ підключено. Перевірте стан завантаження та надходження у списку.');}
    catch(error){showMessage(bankErrorMessage(error.message),true);}finally{body.password='';body.username='';busy=false;form.querySelector('button').disabled=false;}
  });
  return {load,setActive(active){clearInterval(timer);timer=null;if(active)timer=setInterval(()=>{
    if(!root.ownerDocument.hidden && !root.querySelector('details[open]'))load();
  },60000);},reset(){clearInterval(timer);timer=null;revision++;data=null;linking=null;searchOrders=[];chosenOrder=null;chosenInvoices=[];page=1;review=false;if(root)root.replaceChildren();}};
}

export async function mountBankOrderSummary(root,orderId,api,{beforeLink=()=>'',onLinked=()=>{},onBusy=()=>{}}={}) {
  if(!root)return;
  let data=null,available=null,days=3,page=1,selected=null,busy=false;
  const message=(text,error=false)=>{const el=root.querySelector('[data-order-bank-message]');if(el){el.textContent=text;el.classList.toggle('bank-error',error);}};
  function render() {
    const canLink=data.can_link && data.order && data.order.status!=='canceled';
    root.innerHTML=`<h3>Оплати клієнта · ПУМБ</h3><p class="muted">Перевірено: ${escape(timestamp(data.connection.last_success_at))}. Статус оплати враховує перевірені прив’язані надходження і повну вартість замовлення.</p>
      ${invoiceTable(data.invoices,{compact:true})}${paymentTable(data.rows)}
      ${canLink?`<div class="bank-link-box"><h4>Прив’язати надходження до цього замовлення</h4>
        <p>Вільні гривневі платежі, ще не прив’язані до замовлень. Сьогодні та два попередні дні за Києвом — період за замовчуванням. Вибір не зберігається без підтвердження.</p>
        <label>Період<select data-order-bank-days>${[[3,'Останні 3 дні'],[7,'Останні 7 днів'],[30,'Останні 30 днів'],[0,'Усі завантажені']].map(([n,label])=>`<option value="${n}" ${days===n?'selected':''}>${label}</option>`).join('')}</select></label>
        <label>Надходження<select data-order-bank-payment><option value="">Оберіть платіж…</option>${(available?.rows || []).map(p=>`<option value="${escape(p.id)}">${escape(p.booked_at.slice(0,10))} · ${escape(p.payer_name)} · ${money(p.amount_minor)} · ${escape(p.purpose)}</option>`).join('')}</select></label>
        <p>${available?`${Number(available.summary.count)} вільних платежів · сторінка ${page}`:'Список не завантажено.'}${available && !available.rows.length?' Збільште період або оновіть список.':''}</p>
        <div class="bank-actions"><button type="button" class="admin-btn" data-order-bank-prev ${page<=1?'disabled':''}>Назад</button><button type="button" class="admin-btn" data-order-bank-next ${!available || page*50>=available.summary.count?'disabled':''}>Далі</button><button type="button" class="admin-btn" data-order-bank-reload>Оновити список</button></div>
        <div data-order-bank-confirm-panel></div></div>`:''}<p role="status" data-order-bank-message></p>`;
    renderConfirmation();
  }
  function renderConfirmation() {
    const panel=root.querySelector('[data-order-bank-confirm-panel]');if(!panel)return;
    if(!selected){panel.replaceChildren();return;}
    panel.innerHTML=`<div class="bank-confirmation"><p><strong>${money(selected.amount_minor)} · ${escape(selected.payer_name)}</strong><br>${escape(selected.booked_at.replace('T',' '))}<br>${escape(selected.purpose)}</p>
      <p>Замовлення <strong>${escape(data.order.order_number)} · ${escape(data.order.customer_name)}</strong><br>Повна вартість: ${money(Number(data.order.revenue_uah)*100)}. Часткова або повна оплата визначається за всіма перевіреними надходженнями. Статуси, встановлені вручну як «Оплачено» / «Повернено», не перезаписуються.</p>
      <label>Рахунок (необов’язково)<select data-order-bank-invoice><option value="">Прив’язати лише до замовлення</option>${data.invoices.map(i=>`<option value="${escape(i.key)}">№${escape(i.number)} · залишок ${money(Math.max(0,i.amount_minor-i.received_minor))}</option>`).join('')}</select></label>
      <label class="bank-consent"><input type="checkbox" data-order-bank-confirmed>Перевірено: цей платіж належить саме цьому замовленню</label>
      <button type="button" class="admin-btn admin-btn--primary" data-order-bank-link>Підтвердити прив’язку</button></div>`;
  }
  async function load() {
    if(busy || !root.isConnected)return;busy=true;
    try {
      const next=await api(`/api/admin/bank-incoming?order_id=${encodeURIComponent(orderId)}`);
      const candidates=next.can_link && next.order?.status!=='canceled'?await api(`/api/admin/bank-incoming?available=1&days=${days}&page=${page}`):null;
      if(!root.isConnected)return false;data=next;available=candidates;selected=null;render();return true;
    } catch {
      if(!root.isConnected)return;
      if(!data)root.innerHTML='<h3>Оплати клієнта · ПУМБ</h3><p data-order-bank-message></p>';
      message('Банківські дані зараз недоступні. Оновіть список або відкрийте замовлення знову.',true);
      return false;
    } finally {busy=false;}
  }
  root.onchange=async e=>{
    if(busy)return;
    if(e.target.hasAttribute('data-order-bank-confirmed') || e.target.hasAttribute('data-order-bank-invoice'))message('');
    if(e.target.hasAttribute('data-order-bank-days')){days=Number(e.target.value);page=1;await load();}
    if(e.target.hasAttribute('data-order-bank-payment')){selected=available?.rows.find(p=>p.id===e.target.value) || null;renderConfirmation();message('');}
  };
  root.onclick=async e=>{
    const button=e.target.closest('button');if(!button || busy)return;
    if(button.hasAttribute('data-order-bank-prev')){page--;await load();return;}
    if(button.hasAttribute('data-order-bank-next')){page++;await load();return;}
    if(button.hasAttribute('data-order-bank-reload')){await load();return;}
    if(!button.hasAttribute('data-order-bank-link') || !selected)return;
    if(!root.querySelector('[data-order-bank-confirmed]')?.checked){message('Спочатку перевірте платіж і позначте підтвердження.',true);return;}
    const reason=beforeLink();if(reason){message(reason,true);return;}
    const payload={action:'link',payment_id:selected.id,order_id:orderId,invoice_key:root.querySelector('[data-order-bank-invoice]').value,
      expected_amount_minor:selected.amount_minor,expected_fingerprint:selected.fingerprint,confirmed:true};
    busy=true;onBusy(true);for(const control of root.querySelectorAll('button,input,select'))control.disabled=true;message('Зберігаємо прив’язку…');
    try {
      const result=await api('/api/admin/bank-incoming',{method:'POST',body:JSON.stringify(payload)});
      onLinked(result.order);selected=null;busy=false;const refreshed=await load();
      if(root.isConnected)message(refreshed?'Платіж прив’язано. Статус оплати замовлення оновлено; повторно зберігати прив’язку не потрібно.':'Прив’язку збережено, але список не оновився. Натисніть «Оновити список».');
    } catch(error) {if(root.isConnected)message(bankErrorMessage(error.message),true);}
    finally {busy=false;onBusy(false);if(root.isConnected){
      for(const control of root.querySelectorAll('button,input,select'))control.disabled=false;
      const prev=root.querySelector('[data-order-bank-prev]'),next=root.querySelector('[data-order-bank-next]');
      if(prev)prev.disabled=page<=1;if(next)next.disabled=!available || page*50>=available.summary.count;
    }}
  };
  root.innerHTML='<h3>Оплати клієнта · ПУМБ</h3><p>Завантаження…</p>';
  await load();
}
