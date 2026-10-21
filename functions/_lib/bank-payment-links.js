import { bankError } from './pumb-api.js';
import { recordAuditEvent } from './audit-log.js';

const first=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const all=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results || [];
// A linked receipt is distinct from a manually selected "paid" order status.
export const linkedBankPaymentSql = "EXISTS(SELECT 1 FROM bank_incoming b WHERE b.order_id=orders.id AND b.ignored=0 AND b.direction='INBOUND')";

// Only linked, verified incoming bank facts count. Invoice prepayment != full order price.
export async function refreshOrderPaymentStatus(env,orderId,actor='ПУМБ') {
  const order=await first(env,'SELECT id,payment_status,revenue_uah,status FROM orders WHERE id=?',orderId);
  if(!order || order.status==='canceled' || order.payment_status==='refunded')return;
  const previous=await first(env,'SELECT last_status FROM bank_order_payment_state WHERE order_id=?',orderId);
  if(order.payment_status==='paid' && previous?.last_status!=='paid')return;
  const total=`(SELECT COALESCE(SUM(amount_minor),0) FROM bank_incoming WHERE order_id=orders.id AND ignored=0 AND direction='INBOUND' AND review_reason IS NULL)`;
  const disputed=`EXISTS(SELECT 1 FROM bank_incoming WHERE order_id=orders.id AND ignored=0 AND review_reason IS NOT NULL)`;
  const target=`CASE WHEN ${disputed} THEN 'unknown' WHEN ${total}>0 THEN CASE WHEN revenue_uah>0 AND ${total}>=ROUND(revenue_uah*100) THEN 'paid' ELSE 'partial' END ELSE 'unknown' END`;
  const at=new Date().toISOString();
  const results=await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET payment_status=${target},updated_at=? WHERE id=? AND payment_status IS ? AND revenue_uah IS ? AND status!='canceled'
      AND EXISTS(SELECT 1 FROM bank_incoming WHERE order_id=orders.id AND ignored=0) AND payment_status IS NOT (${target})`).bind(at,orderId,order.payment_status,order.revenue_uah),
    env.DB.prepare(`INSERT INTO bank_order_payment_state(order_id,last_status,updated_at)
      SELECT id,payment_status,? FROM orders WHERE id=? AND changes()>0
      ON CONFLICT(order_id) DO UPDATE SET last_status=excluded.last_status,updated_at=excluded.updated_at`).bind(at,orderId),
  ]);
  if(results[0].meta.changes) {
    const updated=await first(env,'SELECT payment_status FROM orders WHERE id=?',orderId);
    await recordAuditEvent(env,{actor,action:'bank.order_payment_status',entity_type:'order',entity_id:orderId,order_id:orderId,
      details:{payment_status_from:order.payment_status,payment_status_to:updated?.payment_status}});
  }
}

export async function refreshLinkedOrderStatuses(env,actor='ПУМБ') {
  // One aggregate read on routine polls, not multiple queries for every historical order.
  const orders=await all(env,`SELECT o.id FROM orders o
    JOIN (SELECT order_id,SUM(CASE WHEN direction='INBOUND' AND review_reason IS NULL THEN amount_minor ELSE 0 END) received,
      SUM(CASE WHEN review_reason IS NOT NULL THEN 1 ELSE 0 END) disputed FROM bank_incoming WHERE order_id IS NOT NULL AND ignored=0 GROUP BY order_id) b ON b.order_id=o.id
    LEFT JOIN bank_order_payment_state s ON s.order_id=o.id
    WHERE o.status!='canceled' AND o.payment_status IS NOT 'refunded'
      AND (o.payment_status IS NOT 'paid' OR s.last_status='paid')
      AND o.payment_status IS NOT CASE WHEN b.disputed>0 THEN 'unknown' WHEN b.received>0 THEN CASE
        WHEN o.revenue_uah>0 AND b.received>=ROUND(o.revenue_uah*100) THEN 'paid' ELSE 'partial' END ELSE 'unknown' END`);
  for(const order of orders)await refreshOrderPaymentStatus(env,order.id,actor);
}

export async function linkPayment(env,payload,invoices,actor) {
  if(payload.confirmed!==true || typeof payload.payment_id!=='string' || typeof payload.order_id!=='string' || payload.order_id.length>100
    || !Number.isSafeInteger(payload.expected_amount_minor) || typeof payload.expected_fingerprint!=='string')throw bankError('bank_input',400);
  const tx=await first(env,'SELECT * FROM bank_incoming WHERE id=?',payload.payment_id);
  const order=await first(env,'SELECT id,status FROM orders WHERE id=?',payload.order_id);
  if(!tx || !order || order.status==='canceled' || tx.direction!=='INBOUND' || tx.currency!=='UAH' || tx.ignored
    || tx.amount_minor!==payload.expected_amount_minor || tx.fingerprint!==payload.expected_fingerprint
    || ['bank_record_changed','order_deleted','manual_review'].includes(tx.review_reason))throw bankError('bank_match_conflict',409);
  const invoice=payload.invoice_key ? invoices.find(i=>i.key===payload.invoice_key && i.order_id===order.id):null;
  if(payload.invoice_key && (!invoice || invoice.iban!==tx.account_iban || invoice.currency!==tx.currency || invoice.date>tx.booked_at.slice(0,10)))throw bankError('bank_match_conflict',409);
  if(tx.order_id) {
    if(tx.order_id!==order.id || (tx.invoice_key || '')!==(invoice?.key || '') || tx.match_method!=='manual')throw bankError('bank_match_conflict',409);
    await refreshOrderPaymentStatus(env,order.id,actor);return {ok:true,already_linked:true};
  }
  // Single conditional write prevents two operators from assigning the same bank fact.
  const result=await env.DB.prepare(`UPDATE bank_incoming SET order_id=?,document_id=?,invoice_number=?,invoice_key=?,matched_at=?,match_method='manual',review_reason=NULL
    WHERE id=? AND order_id IS NULL AND invoice_key IS NULL AND ignored=0 AND fingerprint=?
    AND COALESCE(review_reason,'') NOT IN ('bank_record_changed','order_deleted','manual_review')
    AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status!='canceled')
    AND (? IS NULL OR amount_minor+(SELECT COALESCE(SUM(amount_minor),0) FROM bank_incoming WHERE invoice_key=? AND ignored=0 AND direction='INBOUND' AND review_reason IS NULL)<=?)`)
    .bind(order.id,invoice?.document_id || null,invoice?.number || null,invoice?.key || null,new Date().toISOString(),tx.id,tx.fingerprint,order.id,
      invoice?.key || null,invoice?.key || null,invoice?.amount_minor || 0).run();
  if(!result.meta.changes)throw bankError('bank_match_conflict',409);
  await recordAuditEvent(env,{actor,action:'bank.payment_link',entity_type:'bank_incoming',entity_id:tx.id,order_id:order.id,
    details:{invoice_number:invoice?.number || null,amount_minor:tx.amount_minor,method:'manual'}});
  await refreshOrderPaymentStatus(env,order.id,actor);
  return {ok:true};
}

const nameWords=s=>String(s || '').toLocaleUpperCase('uk-UA').replace(/ФО-П|ФОП|ФІЗИЧНА ОСОБА|ПІДПРИЄМЕЦЬ/g,'').match(/[\p{L}]{3,}/gu) || [];
export function invoiceSuggestions(tx,invoices) {
  const words=nameWords(tx.payer_name);
  return invoices.filter(i=>i.iban===tx.account_iban && i.currency===tx.currency && i.order_status!=='canceled').map(i=>{
    const reasons=[];
    if(i.amount_minor===tx.amount_minor)reasons.push('amount');
    if(nameWords(i.customer_name).some(w=>words.includes(w)))reasons.push('name');
    return {order_id:i.order_id,order_number:i.order_number,customer_name:i.customer_name,invoice_key:i.key,invoice_number:i.number,amount_minor:i.amount_minor,reasons};
  }).filter(i=>i.reasons.length).sort((a,b)=>b.reasons.length-a.reasons.length).slice(0,10);
}
