import { json, readPayload, text } from "../../../_lib/http.js";
import { auditActor, recordAuditEvent } from "../../../_lib/audit-log.js";
import { syncOrderTracking } from "../../../_lib/tracking.js";

export async function onRequestPost({ request, params, env }) {
  const payload = await readPayload(request);
  const url = new URL(request.url);
  const notifyInitial = text(payload.notify_initial || url.searchParams.get("notify_initial")) === "1";
  const result = await syncOrderTracking(env, params.id, { notify_initial: notifyInitial });
  if (result.ok) {
    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "tracking.sync",
      entity_type: "order",
      entity_id: params.id,
      entity_label: result.order_number || params.id,
      order_id: params.id,
      details: {
        status: result.status,
        tracking_number: result.tracking_number,
        tracking_status: result.tracking_status,
      },
    });
  }
  return json(result, { status: result.ok ? 200 : 400 });
}
