import { adminUser, unauthorized } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';
import { readIncoming, connectBank, pauseBank, syncBank, invoiceIndex } from '../../_lib/bank-incoming.js';
import { linkPayment } from '../../_lib/bank-payment-links.js';
import { bankError, bankFailure } from '../../_lib/pumb-api.js';
import { lastConnectDiagnostic, safeBankDiagnostic } from '../../_lib/bank-diagnostics.js';

export async function onRequest({request,env}) {
  const user=adminUser(request,env);
  if(!user) return unauthorized();
  try {
    const url=new URL(request.url);
    if(request.method==='GET') {
      const page=Number(url.searchParams.get('page') || 1),orderId=url.searchParams.get('order_id') || '';
      if(!Number.isInteger(page) || page<1 || page>10000 || orderId.length>100) throw bankError('bank_input',400);
      return json({...await readIncoming(env,{orderId,page,unmatched:url.searchParams.get('review')==='1'}),can_manage:user.id==='owner',can_link:user.id==='owner',
        ...(user.id==='owner'?{connect_diagnostic:await lastConnectDiagnostic(env)}:{})});
    }
    if(request.method!=='POST') return json({error:'Method not allowed'},{status:405});
    // Banking credentials and connection controls are owner-only, including direct API calls.
    if(user.id!=='owner') throw bankError('bank_owner_only',403);
    const origin=request.headers.get('origin');
    if(origin && origin!==url.origin) throw bankError('bank_origin',403);
    if(!request.headers.get('content-type')?.includes('application/json') || Number(request.headers.get('content-length'))>5000) throw bankError('bank_input',400);
    const raw=await request.text(); if(raw.length>5000) throw bankError('bank_input',400);
    let data; try {data=JSON.parse(raw);} catch {throw bankError('bank_input',400);}
    if(!data || typeof data!=='object') throw bankError('bank_input',400);
    if(data.action==='link') return json(await linkPayment(env,data,await invoiceIndex(env),user.name));
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
