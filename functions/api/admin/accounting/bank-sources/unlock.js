import { json } from '../../../../_lib/http.js';
import { requireBankSourceOwner, validateBankSourceRequest, readBankSourceJson, unlockBankSources, bankSourceError } from '../../../../_lib/accounting-bank-source-access.js';
import { listBankSources } from '../../../../_lib/accounting-bank-sources.js';

export async function onRequestPost({ request, env, now }) {
  try {
    const config = requireBankSourceOwner(request, env);
    validateBankSourceRequest(request, { mutation: true });
    const body = await readBankSourceJson(request, ['password']);
    const session = await unlockBankSources(env.DB, request, config, body.password, { now: now || new Date() });
    return json({ allowed: true, locked: false, files: await listBankSources(env.DB), ...session });
  } catch (error) { return bankSourceError(error); }
}
export function onRequestGet() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPut = onRequestGet;
export const onRequestPatch = onRequestGet;
export const onRequestDelete = onRequestGet;
