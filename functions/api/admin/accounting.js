import { json } from '../../_lib/http.js';
import { readAccounting } from '../../_lib/accounting.js';

// Authentication and no-store are supplied by the existing admin middleware.
// Read-only aggregates: no finance mutation, raw CRM rows, or PII are exposed.
export async function onRequestGet({ request, env, now }) {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some(key => !['from', 'to', 'range'].includes(key)) ||
      ['from', 'to', 'range'].some(key => url.searchParams.getAll(key).length > 1) ||
      (url.searchParams.has('range') && url.searchParams.get('range') !== 'all')) {
    return json({ error: 'invalid_accounting_parameters' }, { status: 400 });
  }
  try {
    return json(await readAccounting(env.DB, {
      from: url.searchParams.get('from'), to: url.searchParams.get('to'), range: url.searchParams.get('range'), now: now || new Date(),
    }));
  } catch (error) {
    if (error.status === 400) return json({ error: error.message }, { status: 400 });
    return json({ error: 'accounting_unavailable' }, { status: 503 });
  }
}

export function onRequestPost() {
  return json({ error: 'method_not_allowed' }, { status: 405 });
}
