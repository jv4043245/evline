import { adminUser, unauthorized } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';
import { readIncoming, connectBank, pauseBank, syncBank, invoiceIndex } from '../../_lib/bank-incoming.js';
import { linkPayment, linkedBankPaymentSql } from '../../_lib/bank-payment-links.js';
import { bankError, bankFailure } from '../../_lib/pumb-api.js';
import { lastConnectDiagnostic, safeBankDiagnostic } from '../../_lib/bank-diagnostics.js';

export async function onRequest({request,env}) {
  const user=adminUser(request,env);
  if(!user) return unauthorized();
  const canLink=['owner','andrii'].includes(user.id);
  try {
    const url=new URL(request.url);
    if(request.method==='GET') {
      const page=Number(url.searchParams.get('page') || 1),orderId=url.searchParams.get('order_id') || '';
      const available=url.searchParams.get('available')==='1',days=Number(url.searchParams.get('days') ?? 3);
      if(!Number.isInteger(page) || page<1 || page>10000 || orderId.length>100 || (available && (!Number.isInteger(days) || ![0,3,7,30].includes(days) || orderId))) throw bankError('bank_input',400);
      return json({...await readIncoming(env,{orderId,page,unmatched:url.searchParams.get('review')==='1',available,days}),can_manage:user.id==='owner',can_link:canLink,
        ...(user.id==='owner'?{connect_diagnostic:await lastConnectDiagnostic(env)}:{})});
    }
    if(request.method!=='POST') return json({error:'Method not allowed'},{status:405});
    const origin=request.headers.get('origin');
    if(origin && origin!==url.origin) throw bankError('bank_origin',403);
    if(!request.headers.get('content-type')?.includes('application/json') || Number(request.headers.get('content-length'))>5000) throw bankError('bank_input',400);
    const raw=await request.text(); if(raw.length>5000) throw bankError('bank_input',400);
    let data; try {data=JSON.parse(raw);} catch {throw bankError('bank_input',400);}
    if(!data || typeof data!=='object') throw bankError('bank_input',400);
    if(data.action==='link') {
      if(!canLink) throw bankError('bank_link_forbidden',403);
      const result=await linkPayment(env,data,await invoiceIndex(env),user.name);
      const order=await env.DB.prepare(`SELECT id,payment_status,revenue_uah,${linkedBankPaymentSql} AS has_bank_payment FROM orders WHERE id=?`).bind(data.order_id).first();
      return json({...result,order});
    }
    // Andrii may reconcile receipts, never manage bank credentials or connection controls.
    if(user.id!=='owner') throw bankError('bank_owner_only',403);
    if(data.action==='connect') return json({connection:await connectBank(env,data,user.name)});
    if(data.action==='pause') {await pauseBank(env,user.name);return json({ok:true});}
    if(data.action==='sync') return json(await syncBank(env,{force:true}));
    throw bankError('bank_input',400);
  } catch(error) {
    // Never forward DB, authentication-provider or bank response bodies to the browser.
    const d=error.diagnostic;
    // Fixed, generated metadata only; keep the code first for older clients.
    const reference=d?` [PUMB:${d.id};stage:${d.stage};http:${d.upstream_status || 0};saved:${d.saved?1:0}]`:'';
    return json({error:bankFailure(error)+reference,...(d?{diagnostic:d}:user.id==='owner' && error.schema_field?{diagnostic:safeBankDiagnostic(error)}:{})},{status:error.bankCode ? error.status : 503});
  }
}
