import { adminUser, unauthorized } from '../../../_lib/auth.js';
import { json } from '../../../_lib/http.js';
import { readProfitDraft, saveProfitDraft } from '../../../_lib/accounting-profit-drafts.js';

function errorResponse(error) {
  return json({ error: [400, 409].includes(error.status) ? error.message : 'accounting_profit_unavailable' },
    { status: [400, 409].includes(error.status) ? error.status : 503 });
}

export async function onRequestGet({ request, env, now }) {
  if (!adminUser(request, env)) return unauthorized();
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'month') || params.getAll('month').length !== 1) return json({ error: 'invalid_profit_parameters' }, { status: 400 });
  try { return json(await readProfitDraft(env.DB, params.get('month'), { now: now || new Date() })); }
  catch (error) { return errorResponse(error); }
}

export async function onRequestPut({ request, env, now }) {
  const user = adminUser(request, env);
  if (!user) return unauthorized();
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'month') || params.getAll('month').length > 1) return json({ error: 'invalid_profit_parameters' }, { status: 400 });
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ error: 'profit_json_required' }, { status: 400 });
  let payload;
  try {
    const body = await request.text();
    if (body.length > 8192) return json({ error: 'profit_payload_too_large' }, { status: 400 });
    payload = JSON.parse(body);
  } catch { return json({ error: 'invalid_profit_json' }, { status: 400 }); }
  if (params.has('month') && params.get('month') !== payload?.month) return json({ error: 'profit_month_mismatch' }, { status: 400 });
  try { return json(await saveProfitDraft(env.DB, payload, user.id, { now: now || new Date() })); }
  catch (error) { return errorResponse(error); }
}

export function onRequestPost() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestDelete = onRequestPost;
export const onRequestPatch = onRequestPost;
