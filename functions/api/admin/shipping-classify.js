import { classifyShippingWithAi } from '../../_lib/shipping-classification.js';
import { adminUser, unauthorized } from '../../_lib/auth.js';
import { json, readPayload } from '../../_lib/http.js';

export async function onRequestPost({request,env}) {
  if (!adminUser(request,env)) return unauthorized();
  const payload=await readPayload(request);
  return json(await classifyShippingWithAi(env,{
    item_name:String(payload.item_name || '').slice(0,300),
    request_text:String(payload.request_text || '').slice(0,600),
    vin:String(payload.vin || '').slice(0,32),
  }));
}
