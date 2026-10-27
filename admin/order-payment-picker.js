import { bankErrorMessage } from './bank-incoming.js?v=20261027-invoices';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH'}).format(Number(n)/100);
const paymentTitle=linked=>linked?'Є прив’язана оплата. Можна додати ще один платіж':'Прив’язати оплату';
export function orderPaymentButton(id,number,linked=false) {
  linked=Boolean(Number(linked));
  return `<button class="admin-btn orders-table__payment${linked?' orders-table__payment--linked':''}" type="button" data-order-payment="${escape(id)}" data-order-payment-number="${escape(number)}" aria-expanded="false" aria-haspopup="dialog" aria-label="${paymentTitle(linked)} — ${escape(number)}" title="${paymentTitle(linked)}"><span class="orders-table__payment-symbol" aria-hidden="true">₴<span class="orders-table__payment-caret">▾</span></span><span class="orders-table__payment-label">${linked?'Є оплата':'Оплата'}</span></button>`;
}
function updatePaymentButton(button,linked) {
  if(!button)return;
  linked=Boolean(Number(linked));button.classList.toggle('orders-table__payment--linked',linked);
  button.title=paymentTitle(linked);button.setAttribute('aria-label',`${paymentTitle(linked)} — ${button.dataset.orderPaymentNumber || button.dataset.orderPayment}`);
  const label=button.querySelector('.orders-table__payment-label');if(label)label.textContent=linked?'Є оплата':'Оплата';
}

// Body-level overlay avoids table clipping and never inserts rows or shifts orders.
export function createOrderPaymentPicker(table,api,{onLinked=()=>{},beforeLink=()=>''}={}) {
  const doc=table.ownerDocument,win=doc.defaultView;
  let panel=null,trigger=null,orderId='',order=null,rows=[],count=0,page=1,selected=null,saving=false,loading=false,revision=0;
  function position() {
    if(!panel || !trigger?.isConnected)return;
    const rect=trigger.getBoundingClientRect(),width=win.innerWidth,height=win.innerHeight;
    panel.style.width=`${Math.min(350,width-16)}px`;panel.style.maxHeight=`${Math.max(120,height-16)}px`;
    const box=panel.getBoundingClientRect();
    panel.style.left=`${Math.max(8,Math.min(rect.right-box.width,width-box.width-8))}px`;
    const below=rect.bottom+6,above=rect.top-box.height-6;
    panel.style.top=`${Math.max(8,Math.min(below+box.height<=height-8?below:above>=8?above:height-box.height-8,height-box.height-8))}px`;
  }
  const outside=e=>{if(panel && !panel.contains(e.target) && !trigger?.contains(e.target))close();};
  const scroll=e=>{if(!panel?.contains(e.target))position();};
  const key=e=>{
    if(!panel)return;
    if(e.key==='Escape'){e.preventDefault();close({focus:true});return;}
    if(!panel.contains(e.target) || !['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    const buttons=[...panel.querySelectorAll('[data-payment-choice]')];if(!buttons.length)return;
    e.preventDefault();const current=buttons.indexOf(doc.activeElement);
    buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(current+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();
  };
  function close({focus=false,force=false}={}) {
    if(saving && !force)return false;
    revision++;panel?.remove();panel=null;
    trigger?.setAttribute('aria-expanded','false');trigger?.removeAttribute('aria-controls');
    if(trigger)trigger.disabled=false;if(focus && trigger?.isConnected)trigger.focus();trigger=null;
    loading=false;saving=false;selected=null;
    doc.removeEventListener('pointerdown',outside);doc.removeEventListener('focusin',outside);doc.removeEventListener('keydown',key);doc.removeEventListener('scroll',scroll,true);win.removeEventListener('resize',position);
    return true;
  }
  function render(message='',error=false) {
    if(!panel)return;
    panel.innerHTML=`<div class="order-payment-menu__head"><strong>${selected?'Прив’язати оплату?':'Прив’язати оплату'}</strong><button type="button" data-payment-close aria-label="Закрити" ${saving?'disabled':''}>×</button></div>
      <div class="order-payment-menu__subtitle">${escape(order?.order_number || orderId)} · ${selected?escape(order?.customer_name || ''):'Вільні надходження · 7 днів'}</div>
      ${message?`<p class="order-payment-menu__message${error?' bank-error':''}" role="status">${escape(message)}</p>`:''}
      ${loading?'<p role="status">Завантаження…</p>':selected?`<div class="order-payment-menu__confirmation"><strong>${money(selected.amount_minor)}</strong><span>${escape(selected.payer_name)}</span><small>${escape(selected.booked_at.slice(0,10))}</small><p>${escape(selected.purpose)}</p><div class="order-payment-menu__footer"><button type="button" data-payment-back ${saving?'disabled':''}>Назад</button><button type="button" class="order-payment-menu__confirm" data-payment-confirm ${saving?'disabled':''}>${saving?'Зберігаємо…':'Підтвердити'}</button></div></div>`:
      order?`<div class="order-payment-menu__list">${rows.length?rows.map(p=>`<button type="button" data-payment-choice="${escape(p.id)}"><span class="order-payment-menu__line"><strong>${money(p.amount_minor)}</strong><small title="${escape(p.booked_at.slice(0,10))}">${escape(p.booked_at.slice(8,10)+'.'+p.booked_at.slice(5,7))}</small></span><span class="order-payment-menu__payer">${escape(p.payer_name || 'Платник не вказаний')}</span><small class="order-payment-menu__purpose">${escape(p.purpose)}</small></button>`).join(''):'<p>Неприв’язаних оплат за тиждень немає.</p>'}</div>
      <div class="order-payment-menu__footer">${count>50 || page>1?`<button type="button" data-payment-prev ${page<=1?'disabled':''}>←</button><small>${page} / ${Math.max(1,Math.ceil(count/50))}</small><button type="button" data-payment-next ${page*50>=count?'disabled':''}>→</button>`:''}<button type="button" data-payment-reload>Оновити</button></div>`:'<button type="button" data-payment-reload>Спробувати знову</button>'}`;
    position();
  }
  async function load() {
    const current=++revision;loading=true;selected=null;render();
    try {
      const [details,available]=await Promise.all([api(`/api/admin/bank-incoming?order_id=${encodeURIComponent(orderId)}`),api(`/api/admin/bank-incoming?available=1&days=7&page=${page}`)]);
      if(current!==revision || !panel)return;
      if(!details.can_link || !details.order || details.order.status==='canceled')throw Error('bank_link_forbidden');
      order=details.order;updatePaymentButton(trigger,order.has_bank_payment);rows=available.rows;count=Number(available.summary.count);loading=false;render();
      panel.querySelector('[data-payment-choice]')?.focus({preventScroll:true});
      return true;
    } catch(error){if(current===revision && panel){loading=false;order=null;rows=[];render(bankErrorMessage(error.message),true);}return false;}
  }
  async function click(e) {
    const button=e.target.closest('button');if(!button || saving)return;
    if(button.hasAttribute('data-payment-close')){close({focus:true});return;}
    if(loading)return;
    if(button.hasAttribute('data-payment-reload')){await load();return;}
    if(button.hasAttribute('data-payment-prev')){page--;await load();return;}
    if(button.hasAttribute('data-payment-next')){page++;await load();return;}
    if(button.hasAttribute('data-payment-back')){selected=null;render();panel.querySelector('[data-payment-choice]')?.focus();return;}
    if(button.hasAttribute('data-payment-choice')){selected=rows.find(p=>p.id===button.dataset.paymentChoice);render();panel.querySelector('[data-payment-back]')?.focus();return;}
    if(!button.hasAttribute('data-payment-confirm') || !selected)return;
    const reason=beforeLink();if(reason){render(reason,true);return;}
    const current=revision,payload={action:'link',payment_id:selected.id,order_id:orderId,invoice_key:'',expected_amount_minor:selected.amount_minor,expected_fingerprint:selected.fingerprint,confirmed:true};
    saving=true;trigger.disabled=true;render();
    try {
      const result=await api('/api/admin/bank-incoming',{method:'POST',body:JSON.stringify(payload)});
      if(current!==revision || !panel)return;
      updatePaymentButton(trigger,result.order?.has_bank_payment);onLinked(result.order);saving=false;trigger.disabled=false;
      // Refresh before allowing another choice; never reuse linked candidates.
      const savedPanel=panel,refreshed=await load();
      if(panel===savedPanel && !loading){render(refreshed?'Оплату прив’язано. Статус замовлення оновлено.':'Оплату збережено, але список не оновився. Спробуйте оновити список.');panel.querySelector('[data-payment-close]')?.focus();}
    } catch(error){if(current===revision && panel){saving=false;trigger.disabled=false;selected=null;order=null;rows=[];render(bankErrorMessage(error.message),true);}}
  }
  async function toggle(button) {
    if(saving)return;
    if(trigger===button && panel){close({focus:true});return;}
    close();const row=button.closest('[data-order-id]');if(!row || !table.contains(row))return;
    trigger=button;orderId=row.dataset.orderId;order=null;rows=[];count=0;page=1;
    panel=doc.createElement('section');panel.className='order-payment-menu';panel.id='order-payment-menu';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Прив’язати оплату');
    doc.body.append(panel);panel.addEventListener('click',click);button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',panel.id);
    doc.addEventListener('pointerdown',outside);doc.addEventListener('focusin',outside);doc.addEventListener('keydown',key);doc.addEventListener('scroll',scroll,true);win.addEventListener('resize',position);
    await load();
  }
  return {toggle,reset:()=>close({force:true})};
}
