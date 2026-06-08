import { json, readPayload, text } from "../../../_lib/http.js";
import { syncOrderTracking } from "../../../_lib/tracking.js";

export async function onRequestPost({ request, params, env }) {
  const payload = await readPayload(request);
  const url = new URL(request.url);
  const notifyInitial = text(payload.notify_initial || url.searchParams.get("notify_initial")) === "1";
  const result = await syncOrderTracking(env, params.id, { notify_initial: notifyInitial });
  return json(result, { status: result.ok ? 200 : 400 });
}
