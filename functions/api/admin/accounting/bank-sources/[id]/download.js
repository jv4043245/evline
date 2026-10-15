import { json } from '../../../../../_lib/http.js';
import { requireBankSourceOwner, validateBankSourceRequest, bankSourceSession, bankSourceError } from '../../../../../_lib/accounting-bank-source-access.js';
import { readBankSourceDownload } from '../../../../../_lib/accounting-bank-sources.js';

export async function onRequestGet({ request, env, params, now }) {
  try {
    const config = requireBankSourceOwner(request, env);
    validateBankSourceRequest(request);
    const session = await bankSourceSession(env.DB, request, config, { now: now || new Date() });
    if (!session) return json({ error: 'bank_sources_locked' }, { status: 423 });
    const { meta, bytes } = await readBankSourceDownload(env.DB, params.id);
    return new Response(bytes, { headers: { 'content-type': meta.mime, 'content-length': String(bytes.length),
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none';",
      'content-disposition': `attachment; filename="bank-statement.${meta.filename.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx'}"; filename*=UTF-8''${encodeURIComponent(meta.filename)}` } });
  } catch (error) { return bankSourceError(error); }
}
export function onRequestPost() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPut = onRequestPost;
export const onRequestPatch = onRequestPost;
export const onRequestDelete = onRequestPost;
