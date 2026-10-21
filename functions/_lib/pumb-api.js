// PUMB's supplied REST API guide (PUMB_API.zip, received 2026-10-20).
// Credentials/tokens and raw bank error bodies must never leave this module.
import { safeBankCode, safeBankDiagnostic } from './bank-diagnostics.js';
const TOKEN_URL = 'https://auth.fuib.com/auth/realms/VegaNet/protocol/openid-connect/token';
const API_URL = 'https://service.fuib.com:4103/war_veganet_api';
export const bankError = (code, status=503, diagnostic={}) => Object.assign(new Error(safeBankCode(code)), { bankCode: safeBankCode(code), status, ...safeBankDiagnostic(diagnostic) });
export function bankFailure(error) { return safeBankCode(error?.bankCode); }

export function exactId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw bankError('bank_schema');
  if (!/^\d{1,20}$/.test(String(value))) throw bankError('bank_schema');
  return String(value);
}
export function minorUnits(value) {
  const s = String(value);
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(s)) throw bankError('bank_schema');
  const [whole, fraction=''] = s.split('.');
  const n = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(n) || n<=0) throw bankError('bank_schema');
  return n;
}
export function bankDate(value) {
  const s=String(value || ''), m=/^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(s);
  const iso=m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]||'00'}:${m[5]||'00'}:${m[6]||'00'}` : s;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/.test(iso) || !Number.isFinite(Date.parse(iso+'Z'))) throw bankError('bank_schema');
  if (new Date(iso+'Z').toISOString().slice(0,10)!==iso.slice(0,10)) throw bankError('bank_schema');
  return iso.length===10 ? iso+'T00:00:00' : iso;
}
export const normalizeIban = v => String(v || '').replace(/\s/g,'').toUpperCase();

// Preserve int64 identifiers before JSON.parse; do not silently round transaction IDs.
export function parseBankJson(raw) {
  return JSON.parse(raw.replace(/("(?:id|accountId|hostId|docId|transactionId)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"'));
}
async function oauthErrorCode(response) {
  // Bounded read; discard description, body and all unknown provider values.
  const reader=response.body?.getReader(); if(!reader)return null;
  let raw='',size=0;const decoder=new TextDecoder();
  try {
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)return null;raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();return safeBankDiagnostic({oauth_code:JSON.parse(raw)?.error}).oauth_code;
  } catch {return null;} finally {try{await reader.cancel();}catch{}}
}
async function responseJson(response, stage) {
  const diagnostic={stage,upstream_status:response.status};
  // Workers does not implement redirect:'error'. Manual mode prevents credential
  // forwarding; explicitly reject redirects without reading/following Location.
  if (response.status>=300 && response.status<400) throw bankError('bank_redirect',503,diagnostic);
  if (!response.ok) {
    const oauth=stage==='authorization'?await oauthErrorCode(response):null;
    diagnostic.oauth_code=oauth;
    const unavailable=stage==='authorization'?'bank_auth_unavailable':stage==='accounts'?'bank_accounts_unavailable':'bank_transactions_unavailable';
    const code=response.status===429?'bank_rate_limit':response.status>=500?unavailable:
      oauth==='invalid_grant'?'bank_login_rejected':['invalid_client','unauthorized_client'].includes(oauth)?'bank_client_rejected':
      ['invalid_request','unsupported_grant_type','invalid_scope'].includes(oauth)?'bank_auth_request':
      response.status===401 || response.status===403?'bank_auth':unavailable;
    throw bankError(code,503,diagnostic);
  }
  const raw=await response.text();
  if (raw.length>5000000) throw bankError('bank_response_large',503,diagnostic);
  try { return parseBankJson(raw); } catch { throw bankError('bank_schema',503,diagnostic); }
}
function requestFailure(e,stage) {
  const code=e?.bankCode?bankFailure(e):['TimeoutError','AbortError'].includes(e?.name)?'bank_timeout':'bank_network';
  return bankError(code,503,{...safeBankDiagnostic(e),stage});
}
export async function pumbSession(credentials, fetcher=fetch) {
  if (!['client_id','client_secret','username','password'].every(k=>typeof credentials?.[k]==='string' && credentials[k])) throw bankError('bank_not_configured');
  let auth;
  try {
    auth=await responseJson(await fetcher(TOKEN_URL,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'password',...Object.fromEntries(['client_id','client_secret','username','password'].map(k=>[k,credentials[k]]))}).toString()}),'authorization');
  } catch (e) { throw requestFailure(e,'authorization'); }
  if (typeof auth?.access_token!=='string' || !auth.access_token) throw bankError('bank_schema',503,{stage:'authorization',upstream_status:200});
  const session=crypto.randomUUID();
  return async (path, body) => {
    if (!['/account','/multi-account-transactions'].includes(path)) throw bankError('bank_operation_forbidden');
    const stage=path==='/account'?'accounts':'transactions';
    try {
      return await responseJson(await fetcher(API_URL+path,{method:body ? 'POST':'GET',redirect:'manual',signal:AbortSignal.timeout(25000),
        headers:{'content-type':'application/json',authorization:`Bearer ${auth.access_token}`,'X-App-Channel':'pure-api',
          'X-Flow-ID':`${crypto.randomUUID()}:${session}:evline-pumb-readonly-v1`},...(body ? {body:JSON.stringify(body)} : {})}),stage);
    } catch(e) { throw requestFailure(e,stage); }
  };
}
export function bankAccounts(rows) {
  if (!Array.isArray(rows)) throw bankError('bank_schema');
  return rows.filter(a=>a.currency==='UAH' && !a.isCardAccount && /^UA\d{27}$/.test(normalizeIban(a.iban)))
    .map(a=>({account_id:exactId(a.accountId),iban:normalizeIban(a.iban),currency:'UAH'}));
}
function schemaFormat(value) {
  if(value===undefined)return 'missing';if(value===null)return 'null';if(Array.isArray(value))return 'array';
  if(typeof value==='object' || typeof value==='boolean')return typeof value;
  const s=String(value);
  if(/^\d+$/.test(s))return 'integer';if(/^-\d+$/.test(s))return 'negative_integer';
  if(/^\d+\.\d{1,2}$/.test(s))return 'decimal';
  if(/^\d+\.\d{2}0+$/.test(s))return 'decimal_extra_zeroes';
  if(/^-?\d+\.\d{3,}$/.test(s))return 'decimal_extra_precision';
  if(/^\d{2}\.\d{2}\.\d{4}$/.test(s))return 'date_dot';
  if(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}/.test(s))return 'datetime_dot';
  if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s))return 'datetime_iso_zone';
  if(/^\d{4}-\d{2}-\d{2}T/.test(s))return 'datetime_iso';
  if(/^\d{4}-\d{2}-\d{2} /.test(s))return 'datetime_space';
  return typeof value==='number'?'number':'other';
}
function schemaFailure(field,value) {
  return bankError('bank_schema',503,{stage:'transactions',schema_field:field,schema_format:schemaFormat(value)});
}
function schemaValue(field,value,parse,row) {
  try{return parse(value);}catch{
    const error=schemaFailure(field,value);
    if(row){
      let usable=false;try{usable=BigInt(exactId(row.docId))>0n;}catch{}
      Object.assign(error,safeBankDiagnostic({...error,transaction_direction:row.direction,document_id_usable:usable}));
    }
    throw error;
  }
}
export function bankTransactions(response, accounts) {
  const rows=Array.isArray(response) ? response : response?.id!=null ? [response] : null;
  if (!rows) throw schemaFailure('response',response);
  return rows.flatMap(row=>{
    if(!row || typeof row!=='object')throw schemaFailure('row',row);
    if (row.cardTransaction || row.state!=='PROCESSED') return [];
    if (!['INBOUND','OUTBOUND'].includes(row.direction)) throw schemaFailure('direction',row.direction);
    const accountId=schemaValue('accountId',row.accountId,exactId);
    const account=accounts.find(a=>a.account_id===accountId);
    if (!account) throw schemaFailure('account_match',row.accountId);
    if (row.currencyCode!=='UAH' && row.currencyCode!=='980') throw schemaFailure('currencyCode',row.currencyCode);
    const transaction_id=`${schemaValue('hostId',row.hostId,exactId)}:${schemaValue('id',row.id,exactId,row)}`;
    return [{transaction_id,account_id:account.account_id,account_iban:account.iban,currency:'UAH',
      amount_minor:schemaValue('amount',row.amount,minorUnits),direction:row.direction,booked_at:schemaValue('operationDate',row.operationDate || row.date,bankDate),
      payer_name:String(row.direction==='INBOUND' ? row.senderName || '' : row.correspondentName || '').slice(0,300),
      purpose:String(row.description || '').slice(0,2000)}];
  });
}
export function bankRange(day) {
  const [y,m,d]=day.split('-'); return {fromDate:`${d}.${m}.${y} 00:00:00`,toDate:`${d}.${m}.${y} 23:59:59`};
}
