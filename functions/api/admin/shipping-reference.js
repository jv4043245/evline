import { loadShippingEvidence } from '../../_lib/shipping-evidence.js';
import { shippingAiEnabled } from '../../_lib/shipping-classification.js';
import { adminUser, unauthorized } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet({request,env}) {
  if (!adminUser(request,env)) return unauthorized();
  const evidence=await loadShippingEvidence(env);
  return json({...evidence,quotes:evidence?.quotes || [],reference_available:!!evidence,ai_enabled:shippingAiEnabled(env)}, {headers:{vary:'Authorization'}});
}
