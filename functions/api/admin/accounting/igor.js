import { adminUser, unauthorized } from '../../../_lib/auth.js';
import { json } from '../../../_lib/http.js';
import { readIgorDraft, saveIgorDraft } from '../../../_lib/accounting-igor-drafts.js';

const errors = error => json({ error: [400, 409].includes(error.status) ? error.message : 'accounting_igor_unavailable' }, { status: [400, 409].includes(error.status) ? error.status : 503 });
function parameters(request, required) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'month') || params.getAll('month').length > 1 || required && params.getAll('month').length !== 1) return null;
  return params;
}

export async function onRequestGet({ request, env, now }) {
  if (!adminUser(request, env)) return unauthorized();
  const params = parameters(request, true);
  if (!params) return json({ error: 'accounting_igor_invalid_parameters' }, { status: 400 });
  try { return json(await readIgorDraft(env.DB, params.get('month'), { now: now || new Date() })); }
  catch (error) { return errors(error); }
}

export async function onRequestPut({ request, env, now }) {
  const user = adminUser(request, env);
  if (!user) return unauthorized();
  const params = parameters(request, false);
  if (!params) return json({ error: 'accounting_igor_invalid_parameters' }, { status: 400 });
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json({ error: 'accounting_igor_json_required' }, { status: 400 });
  let payload;
  try {
    const body = await request.text();
    if (body.length > 8192) return json({ error: 'accounting_igor_payload_too_large' }, { status: 400 });
    payload = JSON.parse(body);
  } catch { return json({ error: 'accounting_igor_invalid_json' }, { status: 400 }); }
  if (params.has('month') && params.get('month') !== payload?.month) return json({ error: 'accounting_igor_month_mismatch' }, { status: 400 });
  try { return json(await saveIgorDraft(env.DB, payload, user.id, { now: now || new Date() })); }
  catch (error) { return errors(error); }
}

export function onRequestPost() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPatch = onRequestPost;
export const onRequestDelete = onRequestPost;
