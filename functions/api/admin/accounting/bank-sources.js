import { json } from '../../../_lib/http.js';
import { bankSourceUser, bankSourceConfiguration, bankSourceSession, bankSourcesLockedState, bankSourceError, validateBankSourceRequest } from '../../../_lib/accounting-bank-source-access.js';
import { listBankSources } from '../../../_lib/accounting-bank-sources.js';

export async function onRequestGet({ request, env, now }) {
  try {
    const access = bankSourceUser(request, env);
    validateBankSourceRequest(request);
    if (!access.allowed) return json(bankSourcesLockedState(false));
    const config = bankSourceConfiguration(env), session = await bankSourceSession(env.DB, request, config, { now: now || new Date() });
    if (!session) return json(bankSourcesLockedState(true));
    return json({ allowed: true, locked: false, files: await listBankSources(env.DB), expires_at: session.expires_at });
  } catch (error) { return bankSourceError(error); }
}
export function onRequestPost() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPut = onRequestPost;
export const onRequestPatch = onRequestPost;
export const onRequestDelete = onRequestPost;
