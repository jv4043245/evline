import { json } from "../../../../_lib/http.js";
import { insertStatusEvent, loadOrder, sendManagerOrderNotification } from "../../../../_lib/crm.js";
import { auditActor, recordAuditEvent } from "../../../../_lib/audit-log.js";

export async function onRequestPost({ request, params, env }) {
  const order = await loadOrder(env, params.id);
  if (!order) return json({ error: "Order not found" }, { status: 404 });

  const origin = new URL(request.url).origin;
  const result = await sendManagerOrderNotification(env, order, {
    origin,
    prefix: "Повторне повідомлення менеджеру",
  });

  await insertStatusEvent(env, {
    order_id: order.id,
    previous_status: order.status,
    status: order.status,
    actor: "system",
    comment: "Заявку повторно надіслано менеджеру в Telegram",
    notify_customer: false,
    notification_status: "sent",
  });

  const events = await env.DB.prepare(
    `SELECT * FROM order_status_events WHERE order_id = ? ORDER BY created_at DESC LIMIT 80`
  )
    .bind(order.id)
    .all();

  await recordAuditEvent(env, {
    actor: auditActor(request),
    action: "order.notify_manager",
    entity_type: "order",
    entity_id: order.id,
    entity_label: order.order_number || order.id,
    order_id: order.id,
    details: {
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      car: order.car,
      vin: order.vin,
      item_name: order.item_name,
    },
  });

  return json({ ok: true, order, events: events.results || [], ...result });
}
