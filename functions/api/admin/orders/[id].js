import { json, number, readPayload, text } from "../../../_lib/http.js";
import {
  buildCustomerMessage,
  insertStatusEvent,
  loadOrder,
  managerContactForType,
  normalizeOrderStatus,
  queueOrderNotification,
} from "../../../_lib/crm.js";

function statusDates(status) {
  const now = new Date().toISOString();
  return {
    paid: { paid_at: now },
    sourcing_china: { ordered_at: now },
    ready_for_pickup: { delivered_at: now },
    completed: { completed_at: now },
    canceled: { canceled_at: now },
  }[status] || {};
}

function boolFromPayload(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

export async function onRequestGet({ params, env }) {
  const order = await loadOrder(env, params.id);
  if (!order) return json({ error: "Order not found" }, { status: 404 });

  const events = await env.DB.prepare(
    `SELECT * FROM order_status_events WHERE order_id = ? ORDER BY created_at DESC LIMIT 80`
  )
    .bind(params.id)
    .all();

  const notifications = await env.DB.prepare(
    `SELECT id, created_at, status, channel, recipient_contact, attempts, sent_at, error
    FROM notification_queue WHERE order_id = ? ORDER BY created_at DESC LIMIT 40`
  )
    .bind(params.id)
    .all();

  return json({ order, events: events.results, notifications: notifications.results });
}

export async function onRequestPatch({ request, params, env }) {
  const payload = await readPayload(request);
  const current = await loadOrder(env, params.id);
  if (!current) return json({ error: "Order not found" }, { status: 404 });

  const nextStatus = normalizeOrderStatus(payload.status, current.status);
  const statusChanged = nextStatus !== current.status;
  const now = new Date().toISOString();
  const dates = statusChanged ? statusDates(nextStatus) : {};

  await env.DB.prepare(
    `UPDATE orders SET
      updated_at = ?,
      status = ?,
      type = ?,
      manager_contact = ?,
      customer_name = ?,
      customer_phone = ?,
      customer_email = ?,
      customer_telegram = ?,
      telegram_chat_id = ?,
      car = ?,
      vin = ?,
      item_name = ?,
      service_name = ?,
      request_text = ?,
      tracking_carrier = ?,
      tracking_number = ?,
      tracking_url = ?,
      china_warehouse = ?,
      revenue_uah = ?,
      purchase_cost_uah = ?,
      delivery_cost_uah = ?,
      customs_cost_uah = ?,
      processing_cost_uah = ?,
      ad_cost_uah = ?,
      other_cost_uah = ?,
      payment_status = ?,
      paid_at = COALESCE(NULLIF(?, ''), paid_at),
      ordered_at = COALESCE(NULLIF(?, ''), ordered_at),
      delivered_at = COALESCE(NULLIF(?, ''), delivered_at),
      completed_at = COALESCE(NULLIF(?, ''), completed_at),
      canceled_at = COALESCE(NULLIF(?, ''), canceled_at),
      manager_notes = ?,
      client_notes = ?,
      loss_reason = ?,
      next_action_at = ?
    WHERE id = ?`
  )
    .bind(
      now,
      nextStatus,
      text(payload.type || current.type) || "parts",
      text(payload.manager_contact ?? current.manager_contact) || managerContactForType(payload.type || current.type),
      text(payload.customer_name ?? current.customer_name),
      text(payload.customer_phone ?? current.customer_phone),
      text(payload.customer_email ?? current.customer_email),
      text(payload.customer_telegram ?? current.customer_telegram),
      text(payload.telegram_chat_id ?? current.telegram_chat_id),
      text(payload.car ?? current.car),
      text(payload.vin ?? current.vin).toUpperCase(),
      text(payload.item_name ?? current.item_name),
      text(payload.service_name ?? current.service_name),
      text(payload.request_text ?? current.request_text),
      text(payload.tracking_carrier ?? current.tracking_carrier),
      text(payload.tracking_number ?? current.tracking_number),
      text(payload.tracking_url ?? current.tracking_url),
      text(payload.china_warehouse ?? current.china_warehouse),
      number(payload.revenue_uah ?? current.revenue_uah),
      number(payload.purchase_cost_uah ?? current.purchase_cost_uah),
      number(payload.delivery_cost_uah ?? current.delivery_cost_uah),
      number(payload.customs_cost_uah ?? current.customs_cost_uah),
      number(payload.processing_cost_uah ?? current.processing_cost_uah),
      number(payload.ad_cost_uah ?? current.ad_cost_uah),
      number(payload.other_cost_uah ?? current.other_cost_uah),
      text(payload.payment_status ?? current.payment_status) || "unknown",
      text(payload.paid_at ?? dates.paid_at ?? ""),
      text(payload.ordered_at ?? dates.ordered_at ?? ""),
      text(payload.delivered_at ?? dates.delivered_at ?? ""),
      text(payload.completed_at ?? dates.completed_at ?? ""),
      text(payload.canceled_at ?? dates.canceled_at ?? ""),
      text(payload.manager_notes ?? current.manager_notes),
      text(payload.client_notes ?? current.client_notes),
      text(payload.loss_reason ?? current.loss_reason),
      text(payload.next_action_at ?? current.next_action_at),
      params.id
    )
    .run();

  let eventId = "";
  let notification = null;
  const updated = await loadOrder(env, params.id);

  if (statusChanged) {
    const shouldNotify = boolFromPayload(payload.notify_customer, true);
    eventId = await insertStatusEvent(env, {
      order_id: params.id,
      previous_status: current.status,
      status: nextStatus,
      actor: text(payload.actor) || "manager",
      comment: text(payload.status_comment),
      notify_customer: shouldNotify,
      notification_status: shouldNotify ? "queued" : "not_queued",
    });

    if (shouldNotify) {
      const message = await buildCustomerMessage(env, updated, nextStatus, payload.customer_message);
      notification = await queueOrderNotification(env, {
        order: updated,
        eventId,
        status: nextStatus,
        message,
      });
    }
  }

  const events = await env.DB.prepare(
    `SELECT * FROM order_status_events WHERE order_id = ? ORDER BY created_at DESC LIMIT 80`
  )
    .bind(params.id)
    .all();

  const notifications = await env.DB.prepare(
    `SELECT id, created_at, status, channel, recipient_contact, attempts, sent_at, error
    FROM notification_queue WHERE order_id = ? ORDER BY created_at DESC LIMIT 40`
  )
    .bind(params.id)
    .all();

  return json({ ok: true, order: updated, event_id: eventId, notification, events: events.results, notifications: notifications.results });
}
