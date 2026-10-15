import { json } from '../../../../_lib/http.js';
import { requireBankSourceOwner, validateBankSourceRequest, readBankSourceJson, lockBankSources, bankSourcesLockedState, bankSourceError } from '../../../../_lib/accounting-bank-source-access.js';

export async function onRequestPost({ request, env, now }) {
  try {
    const config = requireBankSourceOwner(request, env);
    validateBankSourceRequest(request, { mutation: true });
    await readBankSourceJson(request, []);
    await lockBankSources(env.DB, request, config, { now: now || new Date() });
    return json(bankSourcesLockedState(true));
  } catch (error) { return bankSourceError(error); }
}
export function onRequestGet() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPut = onRequestGet;
export const onRequestPatch = onRequestGet;
export const onRequestDelete = onRequestGet;
