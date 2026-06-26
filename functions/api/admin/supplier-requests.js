import { json, integer, text } from "../../_lib/http.js";
import { listChinaPreorders } from "../../_lib/supplier-portal.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const preorders = await listChinaPreorders(env, {
      status: text(url.searchParams.get("status") || "active"),
      q: text(url.searchParams.get("q")),
      order_id: text(url.searchParams.get("order_id")),
      limit: integer(url.searchParams.get("limit")) || 120,
    });
    return json({ ok: true, preorders });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
