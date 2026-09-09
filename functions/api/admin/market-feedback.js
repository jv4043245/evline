import { adminUser } from '../../_lib/auth.js';
import { loadOrder } from '../../_lib/crm.js';
import { json, readPayload, text } from '../../_lib/http.js';
import { getLatestMarketResearch, getMarketLookup } from '../../_lib/market-research.js';
import { saveMarketFeedback } from '../../_lib/market-feedback.js';

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const user = adminUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  let result;
  if (payload.order_id) {
    const order = await loadOrder(env, text(payload.order_id));
    if (!order) return json({ error: 'Замовлення не знайдено.' }, { status: 404 });
    result = await getLatestMarketResearch(env, order);
  } else result = await getMarketLookup(env, text(payload.lookup_id));
  if (!result?.run || result.run.id !== payload.run_id) return json({ error: 'Результат змінився. Оновіть пошук.' }, { status: 409 });
  const reviewed = await saveMarketFeedback(env, result, payload, user.id);
  return json({ ...result, ...reviewed });
}
