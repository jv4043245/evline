import { loadOrder } from "../../_lib/crm.js";
import { json, readPayload, text } from "../../_lib/http.js";
import {
  attachMarketLookupToOrder,
  getMarketLookup,
  listMarketLookups,
  runMarketLookup,
  continueMarketLookup,
} from "../../_lib/market-research.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = text(url.searchParams.get("id"));
  if (id) {
    const result = await getMarketLookup(env, id);
    return result ? json(result) : json({ error: "Пошук не знайдено" }, { status: 404 });
  }
  const history = await listMarketLookups(env, url.searchParams.get("limit"));
  return json({ history });
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  if (payload.action === 'continue') return json(await continueMarketLookup(env, text(payload.run_id)));
  if (text(payload.action) === "attach") {
    const order = await loadOrder(env, text(payload.order_id));
    if (!order) return json({ error: "Замовлення не знайдено" }, { status: 404 });
    const result = await attachMarketLookupToOrder(env, text(payload.lookup_id), order);
    return json({ order_id: order.id, market_research: result });
  }
  return json(await runMarketLookup(env, { ...payload, incremental: true }));
}
