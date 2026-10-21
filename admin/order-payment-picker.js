import { mountBankOrderSummary } from './bank-incoming.js?v=20261021-order-payment';

// One lazily loaded panel: no bank queries per order and no stale shared candidate cache.
export function createOrderPaymentPicker(table,api,{onLinked=()=>{},beforeLink=()=>''}={}) {
  let panelRow=null,trigger=null,saving=false;
  function close({focus=false}={}) {
    if(saving)return false;
    panelRow?.remove();panelRow=null;
    trigger?.setAttribute('aria-expanded','false');trigger?.removeAttribute('aria-controls');
    if(focus && trigger?.isConnected)trigger.focus();trigger=null;return true;
  }
  async function toggle(button) {
    if(saving)return;
    if(trigger===button && panelRow?.isConnected){close({focus:true});return;}
    close();trigger=button;
    const orderRow=button.closest('[data-order-id]');if(!orderRow || !table.contains(orderRow))return;
    const doc=table.ownerDocument,row=doc.createElement('tr'),cell=doc.createElement('td');
    row.dataset.orderPaymentPanelRow='';cell.colSpan=7;row.append(cell);
    const shell=doc.createElement('section');shell.className='order-payment-picker';shell.id='order-payment-picker';
    shell.setAttribute('aria-label','Прив’язка оплати до замовлення');
    const cancel=doc.createElement('button');cancel.type='button';cancel.className='admin-link-button order-payment-picker__close';cancel.textContent='Закрити ×';
    cancel.addEventListener('click',()=>close({focus:true}));
    const content=doc.createElement('div');content.className='bank-order-summary';shell.append(cancel,content);cell.append(shell);
    // The parent table opens order cards on row clicks; controls here must never do that.
    row.addEventListener('click',event=>event.stopPropagation());
    row.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close({focus:true});}});
    orderRow.after(row);panelRow=row;button.setAttribute('aria-expanded','true');button.setAttribute('aria-controls',shell.id);
    await mountBankOrderSummary(content,orderRow.dataset.orderId,api,{
      compact:true,beforeLink,onLinked,
      onBusy(value){saving=value;cancel.disabled=value;button.disabled=value;},
    });
    if(panelRow===row && row.isConnected)content.querySelector('select')?.focus({preventScroll:true});
  }
  return {toggle,reset:close};
}
