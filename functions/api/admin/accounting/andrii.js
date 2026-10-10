import { adminUser, unauthorized } from '../../../_lib/auth.js';
import { json } from '../../../_lib/http.js';
import { readAndriiAdvertising } from '../../../_lib/accounting-andrii.js';

export async function onRequestGet({ request, env, now }) {
  if (!adminUser(request, env)) return unauthorized();
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['from', 'to'].includes(key))
      || ['from', 'to'].some(key => params.getAll(key).length !== 1)) {
    return json({ error: 'invalid_accounting_andrii_parameters' }, { status: 400 });
  }
  try {
    return json(await readAndriiAdvertising(env.DB, { from: params.get('from'), to: params.get('to'), now: now || new Date() }));
  } catch (error) {
    return json({ error: error.status === 400 ? error.message : 'accounting_andrii_unavailable' }, { status: error.status === 400 ? 400 : 503 });
  }
}

export function onRequestPost() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPut = onRequestPost;
export const onRequestDelete = onRequestPost;
export const onRequestPatch = onRequestPost;
