const ENDPOINT='https://office-telegram-assistant.jv4043245.workers.dev/evline-bank/receipts';
const stamp=()=>new Date().toISOString();
const clean=(s,max)=>String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const all=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results || [];
export async function dispatchBankReceiptAlerts(env,{fetcher=fetch}={}){
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(env.EVLINE_BANK_ALERT_SECRET || ''))return{enabled:false};
  const at=stamp();
  await env.DB.prepare(`INSERT OR IGNORE INTO bank_telegram_alerts(payment_id,status,created_at,updated_at)
    SELECT id,'pending',?,? FROM bank_incoming WHERE direction='INBOUND' AND currency='UAH' AND amount_minor>0 AND ignored=0`).bind(at,at).run();
  const rows=await all(env,`SELECT a.*,b.amount_minor,b.currency,b.booked_at,b.payer_name,b.purpose,b.order_id,b.invoice_number,o.order_number
    FROM bank_telegram_alerts a JOIN bank_incoming b ON b.id=a.payment_id LEFT JOIN orders o ON o.id=b.order_id
    WHERE a.status='pending' AND (a.next_attempt_at IS NULL OR a.next_attempt_at<=?) AND b.ignored=0 AND b.direction='INBOUND' AND b.amount_minor>0
    ORDER BY a.created_at,a.payment_id LIMIT 3`,at);
  let sent=0;
  for(const row of rows){
    const payload=row.payload_json || JSON.stringify({id:row.payment_id,amount_minor:row.amount_minor,currency:row.currency,booked_at:row.booked_at,
      payer_name:clean(row.payer_name,300),purpose:clean(row.purpose,500),order_id:row.order_id || null,order_number:row.order_id?clean(row.order_number,100) || null:null,invoice_number:clean(row.invoice_number,100) || null});
    const claim=await env.DB.prepare(`UPDATE bank_telegram_alerts SET payload_json=?,next_attempt_at=?,attempts=attempts+1,updated_at=?
      WHERE payment_id=? AND status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)`).bind(payload,new Date(Date.now()+60000).toISOString(),at,row.payment_id,at).run();
    if(!claim.meta.changes)continue;
    let state='pending',messageId=null,retryAt=new Date(Date.now()+15*60000).toISOString();
    try{
      const r=await fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${env.EVLINE_BANK_ALERT_SECRET}`,'content-type':'application/json'},body:payload});
      if(r.ok){
        const result=await r.json();
        if(result.state==='sent' && Number.isSafeInteger(result.message_id) && result.message_id>0){state='sent';messageId=result.message_id;sent++;}
        else if(['uncertain','rejected'].includes(result.state))state=result.state;
        else if(result.state==='prepared' && typeof result.retry_at==='string' && Number.isFinite(Date.parse(result.retry_at)))retryAt=result.retry_at;
      }else if([400,409].includes(r.status))state='rejected';
    }catch{/* Repeat only the identical event ID/payload; Slavik owns Telegram deduplication. */}
    await env.DB.prepare('UPDATE bank_telegram_alerts SET status=?,telegram_message_id=?,next_attempt_at=?,updated_at=? WHERE payment_id=? AND status=\'pending\'').bind(state,messageId,state==='pending'?retryAt:null,stamp(),row.payment_id).run();
  }
  return{enabled:true,processed:rows.length,sent};
}
