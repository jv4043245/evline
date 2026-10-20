// PUMB's supplied REST API guide (PUMB_API.zip, received 2026-10-20).
// Credentials/tokens and raw bank error bodies must never leave this module.
const TOKEN_URL = 'https://auth.fuib.com/auth/realms/VegaNet/protocol/openid-connect/token';
const API_URL = 'https://service.fuib.com:4103/war_veganet_api';
export const bankError = (code, status=503) => Object.assign(new Error(code), { bankCode: code, status });
export function bankFailure(error) { return error?.bankCode || 'bank_unavailable'; }

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
async function responseJson(response) {
  if (!response.ok) throw bankError(response.status===401 || response.status===403 ? 'bank_auth' : response.status===429 ? 'bank_rate_limit' : 'bank_unavailable');
  const raw=await response.text();
  if (raw.length>5000000) throw bankError('bank_response_large');
  try { return parseBankJson(raw); } catch { throw bankError('bank_schema'); }
}
export async function pumbSession(credentials, fetcher=fetch) {
  if (!['client_id','client_secret','username','password'].every(k=>typeof credentials?.[k]==='string' && credentials[k])) throw bankError('bank_not_configured');
  let auth;
  try {
    auth=await responseJson(await fetcher(TOKEN_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'password',...Object.fromEntries(['client_id','client_secret','username','password'].map(k=>[k,credentials[k]]))}).toString()}));
  } catch (e) { throw bankError(bankFailure(e)); }
  if (typeof auth.access_token!=='string' || !auth.access_token) throw bankError('bank_auth');
  const session=crypto.randomUUID();
  return async (path, body) => {
    if (!['/account','/multi-account-transactions'].includes(path)) throw bankError('bank_operation_forbidden');
    try {
      return await responseJson(await fetcher(API_URL+path,{method:body ? 'POST':'GET',redirect:'error',signal:AbortSignal.timeout(25000),
        headers:{'content-type':'application/json',authorization:`Bearer ${auth.access_token}`,'X-App-Channel':'pure-api',
          'X-Flow-ID':`${crypto.randomUUID()}:${session}:evline-pumb-readonly-v1`},...(body ? {body:JSON.stringify(body)} : {})}));
    } catch(e) { throw bankError(bankFailure(e)); }
  };
}
export function bankAccounts(rows) {
  if (!Array.isArray(rows)) throw bankError('bank_schema');
  return rows.filter(a=>a.currency==='UAH' && !a.isCardAccount && /^UA\d{27}$/.test(normalizeIban(a.iban)))
    .map(a=>({account_id:exactId(a.accountId),iban:normalizeIban(a.iban),currency:'UAH'}));
}
export function bankTransactions(response, accounts) {
  const rows=Array.isArray(response) ? response : response?.id!=null ? [response] : null;
  if (!rows) throw bankError('bank_schema');
  return rows.flatMap(row=>{
    if (row.cardTransaction || row.state!=='PROCESSED') return [];
    if (!['INBOUND','OUTBOUND'].includes(row.direction)) throw bankError('bank_schema');
    const account=accounts.find(a=>a.account_id===exactId(row.accountId));
    if (!account) throw bankError('bank_schema');
    if (row.currencyCode!=='UAH' && row.currencyCode!=='980') throw bankError('bank_schema');
    const transaction_id=`${exactId(row.hostId)}:${exactId(row.id)}`;
    return [{transaction_id,account_id:account.account_id,account_iban:account.iban,currency:'UAH',
      amount_minor:minorUnits(row.amount),direction:row.direction,booked_at:bankDate(row.operationDate || row.date),
      payer_name:String(row.direction==='INBOUND' ? row.senderName || '' : row.correspondentName || '').slice(0,300),
      purpose:String(row.description || '').slice(0,2000)}];
  });
}
export function bankRange(day) {
  const [y,m,d]=day.split('-'); return {fromDate:`${d}.${m}.${y} 00:00:00`,toDate:`${d}.${m}.${y} 23:59:59`};
}
