import { loadOrder } from "../../../../_lib/crm.js";
import { json, readPayload, text } from "../../../../_lib/http.js";
import { getLatestMarketResearch, runMarketResearch } from "../../../../_lib/market-research.js";

export async function onRequestGet({ params, env }) {
  const order = await loadOrder(env, params.id);
  if (!order) return json({ error: "Order not found" }, { status: 404 });
  return json(await getLatestMarketResearch(env, order));
}

export async function onRequestPost({ request, params, env }) {
  const order = await loadOrder(env, params.id);
  if (!order) return json({ error: "Order not found" }, { status: 404 });
  const payload = await readPayload(request);
  const overrides = {
    query: text(payload.query).slice(0, 300),
    part_number: text(payload.part_number).slice(0, 100),
  };
  const result = await runMarketResearch(env, order, overrides);
  return json(result);
}
