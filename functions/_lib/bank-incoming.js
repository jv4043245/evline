import { invoiceAmount, validateReady } from '../../admin/documents/model.js';
import { bankError, bankFailure, normalizeIban, pumbSession, bankAccounts, bankTransactions, bankRange } from './pumb-api.js';
import { recordAuditEvent } from './audit-log.js';
import { saveConnectDiagnostic, safeBankDiagnostic } from './bank-diagnostics.js';
import { refreshLinkedOrderStatuses, invoiceSuggestions } from './bank-payment-links.js';

const now=()=>new Date().toISOString();
const all=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results || [];
const first=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const run=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).run();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function hash(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join(''); }
async function encryptionKey(env) {
  if (!env.PUMB_ENCRYPTION_KEY) throw bankError('bank_server_setup');
  const key=bytes(env.PUMB_ENCRYPTION_KEY);
  if (key.length!==32) throw bankError('bank_server_setup');
  return crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encryptCredentials(env,value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('evline:pumb:v1')},await encryptionKey(env),new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(cipher)}`;
}
export async function decryptCredentials(env,value) {
  try {
    const [version,iv,cipher]=value.split('.'); if(version!=='v1') throw new Error();
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode('evline:pumb:v1')},await encryptionKey(env),bytes(cipher))));
  } catch { throw bankError('bank_credentials_unavailable'); }
}
export const kyivDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date());
const shiftDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function validDay(day) { const time=Date.parse(day+'T12:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(day || '') && Number.isFinite(time) && new Date(time).toISOString().slice(0,10)===day; }

export async function connectionStatus(env) {
  const row=await first(env,"SELECT * FROM bank_connections WHERE id='pumb'");
  return {configured:Boolean(row?.credentials_encrypted),enabled:Boolean(row?.enabled),server_ready:Boolean(env.PUMB_CLIENT_ID && env.PUMB_CLIENT_SECRET && env.PUMB_ENCRYPTION_KEY),
    accounts:JSON.parse(row?.accounts_json || '[]').map(a=>({iban_masked:a.iban.slice(0,6)+'…'+a.iban.slice(-4),currency:a.currency})),
    start_date:row?.start_date || null,cursor_date:row?.cursor_date || null,last_attempt_at:row?.last_attempt_at || null,
    last_success_at:row?.last_success_at || null,last_error:row?.last_error || null,interval_minutes:15};
}
export async function connectBank(env,data,actor,fetcher=fetch) {
  const started=Date.now();let stage='validation';
  try {
    const result=await connectBankAttempt(env,data,actor,fetcher,value=>{stage=value;});
    await saveConnectDiagnostic(env,{outcome:'ok',stage:'complete',elapsed_ms:Date.now()-started});
    return result;
  } catch(error) {
    const code=error?.bankCode?bankFailure(error):stage==='encryption'?'bank_encryption_failed':stage==='save'?'bank_save_failed':'bank_unavailable';
    const safe=bankError(code,error?.bankCode?error.status:503,{...safeBankDiagnostic(error),stage});
    safe.diagnostic=await saveConnectDiagnostic(env,{...safeBankDiagnostic(safe),outcome:'error',code,elapsed_ms:Date.now()-started});
    throw safe;
  }
}
async function connectBankAttempt(env,data,actor,fetcher,setStage) {
  if (!env.PUMB_CLIENT_ID || !env.PUMB_CLIENT_SECRET || !env.PUMB_ENCRYPTION_KEY) throw bankError('bank_server_setup');
  if (typeof data.username!=='string' || typeof data.password!=='string' || !data.username.trim() || !data.password || data.username.length>200 || data.password.length>500 || data.consent!==true) throw bankError('bank_connection_input',400);
  const start=data.start_date || kyivDay();
  if (!validDay(start) || start>kyivDay() || start<shiftDay(kyivDay(),-90)) throw bankError('bank_date_range',400);
  // Check authorization and available accounts before replacing a working connection.
  const credentials={client_id:env.PUMB_CLIENT_ID,client_secret:env.PUMB_CLIENT_SECRET,username:data.username.trim(),password:data.password};
  setStage('authorization');
  const api=await pumbSession(credentials,fetcher);
  setStage('accounts');
  const accounts=bankAccounts(await api('/account'));
  if (!accounts.length) throw bankError('bank_no_accounts');
  setStage('encryption');
  const encrypted=await encryptCredentials(env,{username:credentials.username,password:credentials.password});
  setStage('save');
  const changed=await run(env,`UPDATE bank_connections SET credentials_encrypted=?,enabled=1,accounts_json=?,start_date=?,cursor_date=NULL,
    last_error=NULL,updated_at=? WHERE id='pumb' AND (lease_until IS NULL OR lease_until<?)`,encrypted,JSON.stringify(accounts),start,now(),now());
  if (!changed.meta.changes) throw bankError('bank_busy',409);
  await recordAuditEvent(env,{actor,action:'bank.connect',entity_type:'bank_connection',entity_id:'pumb',details:{account_count:accounts.length,start_date:start}});
  return connectionStatus(env);
}
export async function pauseBank(env,actor) {
  await run(env,"UPDATE bank_connections SET enabled=0,updated_at=? WHERE id='pumb'",now());
  await recordAuditEvent(env,{actor,action:'bank.pause',entity_type:'bank_connection',entity_id:'pumb'});
}

const normalizeNumber=s=>String(s || '').normalize('NFKC').toUpperCase().replace(/[‐‑–—]/g,'-').trim();
export function hasInvoiceReference(purpose,number) {
  const ref=normalizeNumber(number); if (!ref) return false;
  const escaped=ref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Numeric identifiers must be explicitly labelled as invoices, never dates or amounts.
  if(/^\d+$/.test(ref) || ref.length<3) return new RegExp(`(^|[^\\p{L}\\p{N}])(?:РАХУН(?:ОК|КУ|КОМ|КА)|СЧ[ЕЁ]Т(?:У|А|ОМ)?|INVOICE)(?:\\s+НА\\s+ОПЛАТУ)?\\s*(?:№|N[OО]?[.]?)?\\s*${escaped}(?=$|[\\s,;:)])(?![\\s]*[.,/]\\d)`,'u').test(normalizeNumber(purpose));
  // The full identifier must be present: EV-O-001 cannot match EV-O-0012.
  return new RegExp(`(^|[^\\p{L}\\p{N}\\-])${escaped}($|[^\\p{L}\\p{N}\\-])`,'u').test(normalizeNumber(purpose));
}
export async function invoiceIndex(env,orderId='') {
  const rows=await all(env,`SELECT d.*,o.order_number,o.customer_name,o.status AS order_status FROM order_documents d JOIN orders o ON o.id=d.order_id
    WHERE d.status='ready' AND d.output_mode IN ('invoice','all') ${orderId ? 'AND d.order_id=?':''} ORDER BY d.created_at DESC`,...(orderId ? [orderId]:[]));
  const map=new Map();
  for(const row of rows) {
    let d; try { d=JSON.parse(row.data_json); if(!d.invoice?.enabled || validateReady(d,'invoice').length) continue; } catch {continue;}
    const number=normalizeNumber(d.invoice.number),iban=normalizeIban(d.seller.iban),amount_minor=invoiceAmount(d);
    if (!Number.isSafeInteger(amount_minor) || amount_minor<=0) continue;
    const key=await hash(`${row.order_id}|${number}|${iban}|UAH|${amount_minor}`);
    if (!map.has(key)) map.set(key,{key,document_id:row.id,order_id:row.order_id,order_number:row.order_number,customer_name:row.customer_name,
      order_status:row.order_status,number,iban,currency:'UAH',amount_minor,date:d.invoice.date,created_at:row.created_at});
  }
  return [...map.values()];
}
export function matchingInvoices(transaction,invoices) {
  return invoices.filter(i=>i.iban===transaction.account_iban && i.currency===transaction.currency && hasInvoiceReference(transaction.purpose,i.number));
}
export async function ingestTransactions(env,transactions,invoices) {
  let inserted=0;
  // Bounded batches avoid a network round trip for every statement in a busy day's statement.
  for(let offset=0;offset<transactions.length;offset+=40) {
    const entries=[];
    for(const tx of transactions.slice(offset,offset+40)) {
      if(tx.direction==='OUTBOUND' && !matchingInvoices(tx,invoices).length) continue;
      const {alternate_transaction_ids=[],...fact}=tx;
      const ids=await Promise.all([tx.transaction_id,...alternate_transaction_ids].map(id=>hash(`pumb|${tx.account_iban}|${id}`)));
      entries.push({tx,id:ids[0],ids,fingerprint:await hash(JSON.stringify(fact))});
    }
    if(!entries.length)continue;
    const candidateIds=[...new Set(entries.flatMap(e=>e.ids))];
    const existing=await all(env,`SELECT id,fingerprint FROM bank_incoming WHERE id IN (${candidateIds.map(()=>'?').join(',')})`,...candidateIds);
    const known=new Map(existing.map(e=>[e.id,e])),statements=[];
    for(const {tx,id,ids,fingerprint} of entries) {
      const matches=ids.map(key=>known.get(key)).filter(Boolean);
      if(new Set(matches.map(m=>m.id)).size>1)throw bankError('bank_schema');
      const match=matches[0];
      if(match) {
        if(match.fingerprint!==fingerprint) statements.push(env.DB.prepare("UPDATE bank_incoming SET review_reason='bank_record_changed' WHERE id=?").bind(match.id));
        for(const key of ids)known.set(key,match);
        continue;
      }
      for(const key of ids)known.set(key,{id,fingerprint});inserted++;
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO bank_incoming(id,bank,transaction_id,account_id,account_iban,currency,amount_minor,direction,booked_at,payer_name,purpose,fingerprint,first_seen_at,review_reason)
        VALUES(?,'pumb',?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,tx.transaction_id,tx.account_id,tx.account_iban,tx.currency,tx.amount_minor,tx.direction,tx.booked_at,tx.payer_name,tx.purpose,fingerprint,now(),tx.direction==='OUTBOUND' ? 'possible_refund':null));
    }
    if(statements.length)await env.DB.batch(statements);
  }
  return inserted;
}
export async function reconcile(env,invoices,actor='ПУМБ') {
  const pending=await all(env,"SELECT * FROM bank_incoming WHERE order_id IS NULL AND invoice_key IS NULL AND ignored=0 AND direction='INBOUND' AND COALESCE(review_reason,'') NOT IN ('bank_record_changed','manual_review','order_deleted') ORDER BY booked_at,id");
  const totals=await all(env,"SELECT invoice_key,SUM(amount_minor) total FROM bank_incoming WHERE ignored=0 AND review_reason IS NULL AND direction='INBOUND' AND invoice_key IS NOT NULL GROUP BY invoice_key");
  const paid=new Map(totals.map(r=>[r.invoice_key,r.total])),updates=[];
  for(const tx of pending) {
    const candidates=matchingInvoices(tx,invoices);
    const invoice=candidates.length===1 ? candidates[0]:null;
    let reason=candidates.length>1 ? 'ambiguous_invoice': !invoice ? 'no_invoice': invoice.order_status==='canceled' ? 'canceled_order':tx.booked_at.slice(0,10)<invoice.date ? 'before_invoice':null;
    if(!reason && (paid.get(invoice.key)||0)+tx.amount_minor>invoice.amount_minor) reason='overpayment';
    if(reason) { if(tx.review_reason!==reason)updates.push({statement:env.DB.prepare('UPDATE bank_incoming SET review_reason=? WHERE id=? AND order_id IS NULL').bind(reason,tx.id)});continue; }
    paid.set(invoice.key,(paid.get(invoice.key)||0)+tx.amount_minor);
    updates.push({id:tx.id,statement:env.DB.prepare(`UPDATE bank_incoming SET order_id=?,document_id=?,invoice_number=?,invoice_key=?,matched_at=?,match_method='automatic',review_reason=NULL
      WHERE id=? AND order_id IS NULL AND ignored=0 AND amount_minor+(SELECT COALESCE(SUM(amount_minor),0) FROM bank_incoming WHERE invoice_key=? AND ignored=0 AND review_reason IS NULL AND direction='INBOUND')<=?`).bind(invoice.order_id,invoice.document_id,invoice.number,invoice.key,now(),tx.id,invoice.key,invoice.amount_minor)});
  }
  const matched=[];
  for(let offset=0;offset<updates.length;offset+=40) {
    const group=updates.slice(offset,offset+40),results=await env.DB.batch(group.map(u=>u.statement));
    results.forEach((r,i)=>{if(r.meta.changes && group[i].id)matched.push(group[i].id);});
  }
  if(matched.length)await recordAuditEvent(env,{actor,action:'bank.payments_match',entity_type:'bank_connection',entity_id:'pumb',details:{count:matched.length,payment_ids:matched.slice(0,40)}});
  await refreshLinkedOrderStatuses(env,actor);
  return matched.length;
}
export async function syncBank(env,{fetcher=fetch,force=false}={}) {
  const row=await first(env,"SELECT * FROM bank_connections WHERE id='pumb'");
  if(!row?.enabled || !row.credentials_encrypted) return {skipped:true,reason:'bank_not_configured'};
  const time=now();
  // Manual refresh and cron share the same durable lease/cooldown.
  if(row.last_attempt_at && Date.now()-Date.parse(row.last_attempt_at)<(force ? 60000:14*60000)) return {skipped:true,reason:'bank_cooldown'};
  const lease=crypto.randomUUID();
  const lock=await run(env,"UPDATE bank_connections SET lease_id=?,lease_until=?,last_attempt_at=? WHERE id='pumb' AND enabled=1 AND (lease_until IS NULL OR lease_until<?)",lease,new Date(Date.now()+240000).toISOString(),time,time);
  if(!lock.meta.changes) return {skipped:true,reason:'bank_busy'};
  try {
    const credentials={...await decryptCredentials(env,row.credentials_encrypted),client_id:env.PUMB_CLIENT_ID,client_secret:env.PUMB_CLIENT_SECRET};
    const api=await pumbSession(credentials,fetcher),accounts=bankAccounts(await api('/account'));
    const allowed=JSON.parse(row.accounts_json);
    const selected=accounts.filter(a=>allowed.some(b=>a.iban===b.iban));
    if(!selected.length) throw bankError('bank_no_accounts');
    const invoices=await invoiceIndex(env),today=kyivDay();
    let day=row.cursor_date && row.cursor_date<today ? shiftDay(row.cursor_date,1) : row.cursor_date ? shiftDay(today,-1) : row.start_date;
    if(day<row.start_date) day=row.start_date;
    let imported=0,count=0,lastDay=row.cursor_date;
    // Up to three daily windows per run; overlapping today/yesterday catches delayed postings.
    while(day<=today && count<3) {
      const accountIds=selected.map(a=>{const id=Number(a.account_id);if(!Number.isSafeInteger(id))throw bankError('bank_schema');return id;});
      const response=await api('/multi-account-transactions',{...bankRange(day),accountIds});
      imported+=await ingestTransactions(env,bankTransactions(response,selected),invoices);
      lastDay=day; count++; day=shiftDay(day,1);
    }
    const matched=await reconcile(env,invoices);
    await run(env,"UPDATE bank_connections SET cursor_date=?,last_success_at=?,last_error=NULL,lease_id=NULL,lease_until=NULL WHERE id='pumb' AND lease_id=?",lastDay,now(),lease);
    return {imported,matched,through:lastDay};
  } catch(e) {
    const code=bankFailure(e);
    await run(env,"UPDATE bank_connections SET last_error=?,lease_id=NULL,lease_until=NULL WHERE id='pumb' AND lease_id=?",code,lease);
    throw bankError(code,503,safeBankDiagnostic(e));
  }
}
export async function readIncoming(env,{orderId='',page=1,unmatched=false}={}) {
  const invoices=await invoiceIndex(env,orderId);
  const clauses=['ignored=0'],args=[];
  if(orderId) {clauses.push('order_id=?');args.push(orderId);}
  if(unmatched) clauses.push('(order_id IS NULL OR review_reason IS NOT NULL)');
  const where=clauses.join(' AND ');
  const rows=await all(env,`SELECT b.id,b.currency,b.amount_minor,b.direction,b.booked_at,b.payer_name,b.purpose,b.order_id,b.invoice_number,b.invoice_key,b.review_reason,b.match_method,o.order_number
    FROM bank_incoming b LEFT JOIN orders o ON o.id=b.order_id WHERE ${clauses.map(c=>c.replace(/\border_id\b/g,'b.order_id')).join(' AND ')} ORDER BY booked_at DESC,b.id LIMIT 50 OFFSET ?`,...args,(page-1)*50);
  const summary=await first(env,`SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN direction='INBOUND' THEN amount_minor ELSE 0 END),0) received_minor,
    SUM(CASE WHEN order_id IS NULL OR review_reason IS NOT NULL THEN 1 ELSE 0 END) review_count FROM bank_incoming WHERE ${where}`,...args);
  const payments=await all(env,"SELECT invoice_key,SUM(amount_minor) received_minor FROM bank_incoming WHERE ignored=0 AND review_reason IS NULL AND direction='INBOUND' AND invoice_key IS NOT NULL GROUP BY invoice_key");
  const flagged=await all(env,"SELECT account_iban,currency,purpose,invoice_key FROM bank_incoming WHERE ignored=0 AND review_reason IS NOT NULL");
  const facts=await all(env,`SELECT id,account_iban,fingerprint FROM bank_incoming WHERE id IN (${rows.length?rows.map(()=>'?').join(','):'NULL'})`,...rows.map(r=>r.id));
  return {connection:await connectionStatus(env),summary,rows:rows.map(row=>{const fact=facts.find(f=>f.id===row.id);return {...row,fingerprint:fact?.fingerprint,
    suggestions:row.order_id?[]:invoiceSuggestions({...row,account_iban:fact?.account_iban},invoices)};}),page,invoices:invoices.map(({iban,...i})=>{
    const received=payments.find(p=>p.invoice_key===i.key)?.received_minor || 0;
    const review=flagged.some(t=>t.invoice_key===i.key || matchingInvoices(t,[{...i,iban}]).length);
    return {...i,iban_masked:iban.slice(0,6)+'…'+iban.slice(-4),received_minor:received,status:review ? 'review':received>=i.amount_minor ? 'paid':received>0 ? 'partial':'unpaid'};
  })};
}
