import { adminUser, unauthorized } from '../../../_lib/auth.js';
import { json } from '../../../_lib/http.js';
import { readBankExpenses } from '../../../_lib/accounting-bank-expenses.js';

export async function onRequestGet({ request, env }) {
  if (!adminUser(request, env)) return unauthorized();
  try { return json(await readBankExpenses(env.DB, new URL(request.url).searchParams)); }
  catch (error) { return json({ error: error.status === 400 ? error.message : 'accounting_bank_expenses_unavailable' }, { status: error.status === 400 ? 400 : 503 }); }
}

function readOnly({ request, env } = {}) {
  if (!adminUser(request, env)) return unauthorized();
  return json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET' } });
}
export const onRequestPost = readOnly;
export const onRequestPut = readOnly;
export const onRequestPatch = readOnly;
export const onRequestDelete = readOnly;
