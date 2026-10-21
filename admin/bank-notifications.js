// Small, independent poller. Does not refresh an order form or call the bank.
export function createBankNotifications(badge,api,{document=badge?.ownerDocument,intervalMs=60000}={}) {
  let running=false,timer=null,epoch=0,pendingGet=false,queue=Promise.resolve();
  const seenLocally=new Set();
  function render({count,unassigned_count=0}) {
    if(!badge || ![count,unassigned_count].every(n=>Number.isSafeInteger(n) && n>=0))return;
    const fresh=count>0,shown=fresh?count:unassigned_count;
    badge.textContent=shown>99?'99+':String(shown);badge.hidden=shown===0;
    badge.classList.toggle('bank-new-badge--unassigned',!fresh && shown>0);
    badge.dataset.state=fresh?'new':shown?'unassigned':'clear';
    badge.setAttribute('aria-label',fresh?`Нових надходжень: ${count}`:`Надходжень без прив’язки: ${unassigned_count}`);
    const button=badge.closest('button');
    if(button){button.setAttribute('aria-label',shown?`Надходження: ${count} нових, ${unassigned_count} без прив’язки`:'Надходження');button.title=fresh?`${count} нових надходжень для вас. Без прив’язки до замовлень: ${unassigned_count}.`:unassigned_count?`${unassigned_count} переглянутих надходжень ще не прив’язані до замовлень.`:'Усі надходження переглянуто та прив’язано.';}
  }
  function enqueue(work) {
    const current=epoch;
    const result=queue.then(async()=>{if(running && current===epoch)await work(current);});
    queue=result.catch(()=>{});return queue;
  }
  function refresh() {
    if(!running || pendingGet || document?.hidden)return Promise.resolve();
    pendingGet=true;const current=epoch;
    return enqueue(async revision=>{
      try{const result=await api('/api/admin/bank-notifications',{signal:AbortSignal.timeout(15000)});if(running && revision===epoch)render(result);}
      catch { /* Keep the last known count; never turn a failed poll into zero. */ }
    }).finally(()=>{if(current===epoch)pendingGet=false;});
  }
  function markSeen(rows) {
    if(!running || document?.hidden)return Promise.resolve();
    const ids=[...new Set(rows.filter(r=>r.direction==='INBOUND').map(r=>r.id))].filter(id=>!seenLocally.has(id)).slice(0,50);
    if(!ids.length)return refresh();
    return enqueue(async revision=>{
      const pending=ids.filter(id=>!seenLocally.has(id));if(!pending.length)return;
      const result=await api('/api/admin/bank-notifications',{method:'POST',body:JSON.stringify({ids:pending}),signal:AbortSignal.timeout(15000)});
      if(running && revision===epoch){pending.forEach(id=>seenLocally.add(id));render(result);}
    });
  }
  const visible=()=>{if(!document?.hidden)refresh();};
  document?.addEventListener('visibilitychange',visible);
  function reset(){running=false;epoch++;clearInterval(timer);timer=null;pendingGet=false;seenLocally.clear();queue=Promise.resolve();render({count:0,unassigned_count:0});}
  return {refresh,markSeen,start(){if(running)return;running=true;refresh();timer=setInterval(refresh,intervalMs);},reset,
    destroy(){reset();document?.removeEventListener('visibilitychange',visible);}};
}
