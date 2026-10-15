import { adminIdentities } from './auth.js';
import { first, run, digest, nowISO } from './supplier-documents.js';

const WORKER_ORIGIN='https://office-telegram-assistant.jv4043245.workers.dev';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TELEGRAM_ID=/^[1-9][0-9]{0,15}$/;
const STATES=new Set(['none','waiting_start','confirm','active','closed','expired']);
const RECEIPT_KEY='slavik_support_andrii_control_message';
const problem=(message,status=400)=>Object.assign(new Error(message),{status,publicMessage:message});
const record=value=>value && typeof value==='object' && !Array.isArray(value);
const exactKeys=(value,keys)=>record(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));

export function supportSecret(env) {
  const secret=env.EVLINE_SUPPORT_CRM_SECRET;
  return typeof secret==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(secret) ? secret : null;
}
export function supportAvailable(env,userId) {
  return userId==='andrii' && Boolean(supportSecret(env));
}
export async function internalSupportAuthorized(request,env) {
  const expected=supportSecret(env);
  const auth=request.headers.get('authorization') || '';
  if (!expected || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(auth)) return false;
  // Compare fixed-size digests, without early exits based on the secret's content.
  const [left,right]=await Promise.all([digest(expected),digest(auth.slice(7))]);
  let mismatch=0;
  for (let i=0;i<left.length;i++) mismatch|=left.charCodeAt(i)^right.charCodeAt(i);
  return mismatch===0;
}
export async function boundedSupportJSON(source,limit=4096) {
  const length=source.headers.get('content-length');
  if (length && Number(length)>limit) throw problem('Завеликий запит.',413);
  const reader=source.body?.getReader();
  if (!reader) throw problem('Некоректний запит.');
  let size=0;const chunks=[];
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>limit) { await reader.cancel();throw problem('Завеликий запит.',413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch {throw problem('Некоректний запит.');}
}
export function validateSupportAction(action,data) {
  if (action==='connect' && exactKeys(data,[])) return {};
  if (action==='close' && exactKeys(data,['session_id']) && UUID.test(data.session_id)) return {session_id:data.session_id};
  if (action==='confirm' && exactKeys(data,['session_id','telegram_id']) && UUID.test(data.session_id) && typeof data.telegram_id==='string' && TELEGRAM_ID.test(data.telegram_id)) return {session_id:data.session_id,telegram_id:data.telegram_id};
  throw problem('Некоректний запит підтримки.');
}
function iso(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
function publicSession(value) {
  const invalid=()=>{throw problem('Славик повернув некоректний статус. Спробуйте пізніше.',502);};
  if (!record(value) || !STATES.has(value.state)) return invalid();
  if (value.state==='none') {
    if (value.session_id!==null || value.expires_at!==null || value.pending!==null || (value.link_expires_at!==undefined && value.link_expires_at!==null) || value.link!==undefined) return invalid();
    return {session_id:null,state:'none',expires_at:null,link_expires_at:null,pending:null};
  }
  if (typeof value.session_id!=='string' || !UUID.test(value.session_id) || !iso(value.expires_at) || !(value.link_expires_at===null || iso(value.link_expires_at))) return invalid();
  let pending=null;
  if (value.pending!==null) {
    if (!record(value.pending) || typeof value.pending.telegram_id!=='string' || !TELEGRAM_ID.test(value.pending.telegram_id) || typeof value.pending.display_name!=='string') return invalid();
    const display_name=value.pending.display_name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,160);
    pending={telegram_id:value.pending.telegram_id,display_name:display_name || 'Telegram'};
  }
  if (value.state==='confirm' && !pending) return invalid();
  // An expired/closed session must never reveal a stale candidate identity.
  if (value.state==='expired' || value.state==='closed') pending=null;
  const result={session_id:value.session_id,state:value.state,expires_at:value.expires_at,link_expires_at:value.link_expires_at,pending};
  if (value.link!==undefined) {
    if (typeof value.link!=='string' || !/^https:\/\/t\.me\/slavik_office_bot\?start=help_[A-Za-z0-9_-]{43}$/.test(value.link) || value.state!=='waiting_start' || !iso(value.link_expires_at)) return invalid();
    result.link=value.link;
  }
  return result;
}
export async function requestSlavikSupport(env,action,data) {
  const secret=supportSecret(env);
  if (!secret) throw problem('Підтримка Славика ще не налаштована.',503);
  const paths={status:'/session',connect:'/session',confirm:'/confirm',close:'/close'};
  if (!Object.hasOwn(paths,action)) throw problem('Невідома дія.',400);
  const payload=action==='status' ? null : validateSupportAction(action,data);
  let response;
  try {
    response=await fetch(`${WORKER_ORIGIN}/evline-support/crm${paths[action]}`,{
      method:action==='status'?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{authorization:`Bearer ${secret}`,...(payload?{'content-type':'application/json'}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{}),
    });
  } catch {throw problem('Славик тимчасово недоступний. Спробуйте пізніше.',502);}
  if (!response.ok) {
    if (response.status===409) throw problem('Стан підключення змінився. Оновіть статус і спробуйте ще раз.',409);
    if (response.status===429) throw problem('Зачекайте хвилину перед повторною спробою.',429);
    throw problem('Славик тимчасово недоступний. Спробуйте пізніше.',503);
  }
  let value;
  try {value=await boundedSupportJSON(response,16384);}
  catch {throw problem('Славик повернув некоректний статус. Спробуйте пізніше.',502);}
  return publicSession(value);
}
async function currentRecipient(env) {
  if (!adminIdentities(env).some(user=>user.id==='andrii')) return null;
  return first(env,'SELECT telegram_id,chat_id,created_at FROM supplier_document_telegram WHERE admin_id=?','andrii');
}
const recipientDigest=recipient=>digest(JSON.stringify(['andrii',recipient.telegram_id,recipient.chat_id,recipient.created_at]));

export async function recordControlMessageReceipt(env,user,recipient) {
  if (!supportAvailable(env,user.id)) return;
  try {
    const current=await currentRecipient(env);
    if (!current || current.telegram_id!==recipient.telegram_id || current.chat_id!==recipient.chat_id) return;
    const value=JSON.stringify({sent_at:nowISO(),recipient_digest:await recipientDigest(current)});
    await run(env,"INSERT INTO supplier_document_runtime(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",RECEIPT_KEY,value);
  } catch { /* Delivery succeeded; unavailable receipt storage must not undo it. */ }
}
export async function readSupportStatus(env) {
  const [recipient,pair,receipt,cron]=await Promise.all([
    currentRecipient(env),
    first(env,'SELECT telegram_id,expires_at FROM supplier_document_pairings WHERE admin_id=?','andrii'),
    first(env,'SELECT value FROM supplier_document_runtime WHERE key=?',RECEIPT_KEY),
    first(env,"SELECT value FROM supplier_document_runtime WHERE key='cron_last_run_at'"),
  ]);
  const now=Date.now();
  let control_message_sent=false;
  if (recipient && receipt?.value) {
    try {
      const saved=JSON.parse(receipt.value),sent=Date.parse(saved.sent_at);
      control_message_sent=Number.isFinite(sent) && sent<=now && saved.recipient_digest===await recipientDigest(recipient);
    } catch { /* An absent/corrupt receipt is unknown, never confirmation. */ }
  }
  const lastRun=Date.parse(cron?.value);
  return {
    connected:Boolean(recipient),
    pairing_state:pair ? (Date.parse(pair.expires_at)>now ? (pair.telegram_id?'confirm':'waiting_start') : 'expired') : null,
    control_message_sent,
    cron_ready:Number.isFinite(lastRun) && lastRun<=now && now-lastRun<86400000,
  };
}
