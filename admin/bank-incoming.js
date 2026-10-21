const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH'}).format(Number(n || 0)/100);
const timestamp = s => s ? new Date(s).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv'}) : 'ще не було';
const statusLabels={paid:'Оплачено за випискою',partial:'Частково оплачено',unpaid:'Надходжень не знайдено',review:'Потрібна перевірка'};
const reviewLabels={no_invoice:'Не знайдено однозначного рахунку',ambiguous_invoice:'Кілька рахунків з цим номером',overpayment:'Сума перевищує залишок рахунку',before_invoice:'Платіж раніше дати рахунку',canceled_order:'Замовлення скасовано',possible_refund:'Можливе повернення — перевірте',bank_record_changed:'Банк змінив запис — перевірте',manual_review:'Ручна перевірка'};
const errorLabels={bank_auth:'ПУМБ не підтвердив доступ. Перевірте логін, пароль та активацію API у банку.',bank_server_setup:'Серверний доступ ПУМБ ще не налаштовано.',bank_no_accounts:'ПУМБ не повернув доступних гривневих рахунків.',bank_date_range:'Оберіть дату в межах останніх 90 днів, не пізніше сьогодні.',bank_connection_input:'Заповніть логін, пароль і підтвердіть збереження.',bank_owner_only:'Керувати підключенням може лише власник.',bank_schema:'Формат відповіді ПУМБ потребує перевірки інтеграції. Невідомі записи не зараховано.',bank_credentials_unavailable:'Не вдалося відкрити збережений доступ. Потрібна перевірка серверного ключа.',bank_rate_limit:'Банк обмежив частоту запитів. Спробуйте пізніше.',bank_busy:'Синхронізація вже триває.',bank_response_large:'Виписка перевищила безпечний обсяг. Потрібна перевірка інтеграції.'};
reviewLabels.order_deleted='Пов’язане замовлення видалено';
export const bankErrorMessage = code => errorLabels[String(code).split(/[\s.]/)[0]] || 'Не вдалося отримати дані ПУМБ. Останні збережені платежі не видалено. Спробуйте пізніше.';
const orderButton = i => `<button type="button" class="admin-link-button" data-bank-order="${escape(i.order_id)}">${escape(i.order_number || i.order_id)}</button>`;
export function invoiceTable(invoices,{compact=false}={}) {
  if(!invoices.length) return '<p class="muted">Немає збережених готових рахунків для зіставлення. Створіть і збережіть рахунок у документах замовлення.</p>';
  return `<div class="bank-table-scroll"><table class="bank-table"><thead><tr><th>Рахунок${compact ? '':' / замовлення'}</th><th>До сплати</th><th>Зараховано</th><th>Залишок</th><th>Стан</th></tr></thead><tbody>${invoices.map(i=>`<tr><td>${escape(i.number)}${compact?'':`<br>${orderButton(i)}`}</td><td>${money(i.amount_minor)}</td><td>${money(i.received_minor)}</td><td>${money(Math.max(0,i.amount_minor-i.received_minor))}</td><td><span class="bank-state bank-state--${escape(i.status)}">${escape(statusLabels[i.status])}</span></td></tr>`).join('')}</tbody></table></div>`;
}
export function paymentTable(rows) {
  if(!rows.length) return '<p class="muted">Платежів у цьому списку поки немає.</p>';
  return `<div class="bank-table-scroll"><table class="bank-table"><thead><tr><th>Дата проведення</th><th>Платник / призначення</th><th>Сума</th><th>Рахунок / перевірка</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${escape(p.booked_at.replace('T',' '))}</td><td><strong>${escape(p.payer_name)}</strong><div class="bank-purpose">${escape(p.purpose)}</div></td><td class="bank-amount">${p.direction==='OUTBOUND'?'−':''}${money(p.amount_minor)}</td><td>${p.order_id ? `${escape(p.invoice_number)}<br>${orderButton(p)}<br>`:''}<span class="bank-state${p.review_reason?' bank-state--review':''}">${escape(p.review_reason ? reviewLabels[p.review_reason] || 'Потрібна перевірка' : p.order_id ? 'Зіставлено' : 'Очікує зіставлення')}</span></td></tr>`).join('')}</tbody></table></div>`;
}

export function createBankIncomingView(root,api,{openOrder=()=>{}}={}) {
  let data=null,page=1,review=false,busy=false,loading=false,revision=0,timer=null;
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
      ${data.can_manage ? `<details class="bank-setup" ${c.configured?'':'open'}><summary>${c.configured?'Змінити / поновити підключення':'Підключити ПУМБ'}</summary>
      ${c.server_ready ? `<form data-bank-connect autocomplete="off"><p>Інтеграція лише читає рахунки та виписки: не створює і не підписує платежів. Основний банківський користувач може мати ширші права. Безпечніший варіант — окремий користувач лише для перегляду.</p>
      <label>Логін ПУМБ Digital Business<input name="username" required maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label>Пароль ПУМБ<input name="password" type="password" required maxlength="500" autocomplete="new-password"></label>
      <label>Завантажити платежі починаючи з<input name="start_date" type="date" required value="${escape(c.start_date || new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date()))}"></label>
      <label class="bank-consent"><input name="consent" type="checkbox" required>Дозволяю зберегти логін і пароль зашифрованими на сервері EVLine для автоматичного читання виписок. Пароль не потрібно надсилати в чат.</label>
      <button class="admin-btn admin-btn--primary" type="submit">Перевірити та підключити</button></form>`:'<p>Серверні ключі ПУМБ ще не налаштовано. Банківський пароль поки вводити не потрібно.</p>'}</details>`:''}
      <p class="bank-note">Автоматичне зіставлення: повний номер готового рахунку в призначенні, IBAN отримувача та валюта. Часткові оплати накопичуються. Спірні платежі не позначаються оплаченими автоматично. Ці дані не змінюють вручну внесену виручку, статус замовлення чи витрати постачальникам.</p>
      <h3>Рахунки клієнтам</h3>${invoiceTable(data.invoices)}
      <div class="bank-actions"><h3>Банківські операції</h3><label><input type="checkbox" data-bank-review ${review?'checked':''}>Лише для перевірки</label><span>${Number(data.summary.count)} записів · ${Number(data.summary.review_count || 0)} для перевірки</span></div>
      ${paymentTable(data.rows)}<div class="bank-actions"><button type="button" class="admin-btn" data-bank-prev ${page<=1?'disabled':''}>Назад</button><span>Сторінка ${page}</span><button type="button" class="admin-btn" data-bank-next ${page*50>=data.summary.count?'disabled':''}>Далі</button></div>`;
  }
  async function load() {
    if(busy || loading || !root) return;
    // Never replace a form while the owner is entering credentials.
    if(root.querySelector('[data-bank-connect]')?.contains(root.ownerDocument.activeElement)) return;
    if(root.querySelector('[name="password"]')?.value || root.querySelector('[name="username"]')?.value) return;
    loading=true; const current=revision;
    try {const result=await api(`/api/admin/bank-incoming?page=${page}${review?'&review=1':''}`);if(current!==revision)return;data=result;render();}
    catch(e){if(current!==revision)return;if(!data)root.innerHTML='<h2>Надходження · ПУМБ</h2><p data-bank-message role="alert"></p>';showMessage(bankErrorMessage(e.message),true);}
    finally{loading=false;}
  }
  root?.addEventListener('click',async e=>{
    const target=e.target.closest('button'); if(!target || busy)return;
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
  root?.addEventListener('change',e=>{if(e.target.hasAttribute('data-bank-review')){review=e.target.checked;page=1;load();}});
  root?.addEventListener('submit',async e=>{
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
  },60000);},reset(){clearInterval(timer);timer=null;revision++;data=null;page=1;review=false;if(root)root.replaceChildren();}};
}

export async function mountBankOrderSummary(root,orderId,api) {
  if(!root)return;
  root.innerHTML='<h3>Оплати клієнта · ПУМБ</h3><p>Завантаження…</p>';
  try{const data=await api(`/api/admin/bank-incoming?order_id=${encodeURIComponent(orderId)}`);if(!root.isConnected)return;
    root.innerHTML=`<h3>Оплати клієнта · ПУМБ</h3><p class="muted">Перевірено: ${escape(timestamp(data.connection.last_success_at))}. Надходження за банківською випискою, окремо від ручного статусу.</p>${invoiceTable(data.invoices,{compact:true})}`;
  }catch{if(root.isConnected)root.innerHTML='<h3>Оплати клієнта · ПУМБ</h3><p class="muted">Банківські дані зараз недоступні. Ручний облік не змінено.</p>';}
}
