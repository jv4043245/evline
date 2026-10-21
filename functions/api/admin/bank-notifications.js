import { adminUser, unauthorized } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';

async function unread(env,userId) {
  const row=await env.DB.prepare(`SELECT COUNT(*) count FROM bank_incoming b
    WHERE b.ignored=0 AND b.direction='INBOUND'
    AND NOT EXISTS(SELECT 1 FROM bank_receipt_views v WHERE v.user_id=? AND v.payment_id=b.id)`).bind(userId).first();
  return {count:Number(row?.count || 0)};
}

export async function onRequest({env,request}) {
  const user=adminUser(request,env);if(!user)return unauthorized();
  try {
    if(request.method==='GET')return json(await unread(env,user.id));
    if(request.method!=='POST')return json({error:'Method not allowed'},{status:405});
    const origin=request.headers.get('origin');
    if(origin && origin!==new URL(request.url).origin)return json({error:'bank_origin'},{status:403});
    if(!request.headers.get('content-type')?.includes('application/json') || Number(request.headers.get('content-length'))>5000)return json({error:'bank_input'},{status:400});
    const raw=await request.text();if(raw.length>5000)return json({error:'bank_input'},{status:400});
    let data;try{data=JSON.parse(raw);}catch{return json({error:'bank_input'},{status:400});}
    if(!Array.isArray(data?.ids) || data.ids.length<1 || data.ids.length>50 || data.ids.some(id=>typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))return json({error:'bank_input'},{status:400});
    const at=new Date().toISOString();
    await env.DB.batch([...new Set(data.ids)].map(id=>env.DB.prepare(`INSERT INTO bank_receipt_views(user_id,payment_id,seen_at)
      SELECT ?,id,? FROM bank_incoming WHERE id=? AND direction='INBOUND' AND ignored=0
      ON CONFLICT(user_id,payment_id) DO NOTHING`).bind(user.id,at,id)));
    return json(await unread(env,user.id));
  }catch{return json({error:'bank_unavailable'},{status:503});}
}
