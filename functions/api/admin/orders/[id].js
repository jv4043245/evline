import { json, number, readPayload, text } from "../../../_lib/http.js";
import {
  buildCustomerMessage,
  insertStatusEvent,
  loadOrder,
  managerContactForType,
  normalizeOrderStatus,
  queueOrderNotification,
} from "../../../_lib/crm.js";
import { listSupplierPayments } from "../../../_lib/supplier-payments.js";
import { listSupplierRequests } from "../../../_lib/supplier-portal.js";
import { queueGoogleAdsConversionsForStatus } from "../../../_lib/google-ads.js";
import { auditActor, recordAuditEvent } from "../../../_lib/audit-log.js";

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

const AUDITED_ORDER_FIELDS = [
  "status",
  "type",
  "customer_name",
  "customer_phone",
  "car",
  "vin",
  "item_name",
  "service_name",
  "tracking_carrier",
  "tracking_number",
  "china_warehouse",
  "revenue_uah",
  "purchase_cost_uah",
  "delivery_cost_uah",
  "payment_status",
  "manager_notes",
  "client_notes",
  "next_action_at",
];

function changedOrderFields(current, updated) {
  return AUDITED_ORDER_FIELDS.filter((field) => String(current?.[field] ?? "") !== String(updated?.[field] ?? ""));
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

  const trackingEvents = await env.DB.prepare(
    `SELECT * FROM order_tracking_events WHERE order_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT 80`
  )
    .bind(params.id)
    .all();

  const supplierPayments = await listSupplierPayments(env, params.id);
  const supplierRequests = await listSupplierRequests(env, params.id);

  return json({
    order,
    events: events.results,
    notifications: notifications.results,
    tracking_events: trackingEvents.results,
    supplier_payments: supplierPayments,
    supplier_requests: supplierRequests,
  });
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
      shipping_carrier_id = ?,
      shipping_rate_id = ?,
      shipping_mode = ?,
      shipping_weight_kg = ?,
      shipping_volume_m3 = ?,
      shipping_rate = ?,
      shipping_rate_currency = ?,
      shipping_rate_unit = ?,
      shipping_exchange_rate_uah = ?,
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
      text(payload.shipping_carrier_id ?? current.shipping_carrier_id),
      text(payload.shipping_rate_id ?? current.shipping_rate_id),
      text(payload.shipping_mode ?? current.shipping_mode),
      number(payload.shipping_weight_kg ?? current.shipping_weight_kg),
      number(payload.shipping_volume_m3 ?? current.shipping_volume_m3),
      number(payload.shipping_rate ?? current.shipping_rate),
      text(payload.shipping_rate_currency ?? current.shipping_rate_currency),
      text(payload.shipping_rate_unit ?? current.shipping_rate_unit),
      number(payload.shipping_exchange_rate_uah ?? current.shipping_exchange_rate_uah),
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
  let googleAdsConversions = [];
  const updated = await loadOrder(env, params.id);

  if (statusChanged) {
    googleAdsConversions = await queueGoogleAdsConversionsForStatus(env, updated, nextStatus);

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

  const trackingEvents = await env.DB.prepare(
    `SELECT * FROM order_tracking_events WHERE order_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT 80`
  )
    .bind(params.id)
    .all();

  const supplierPayments = await listSupplierPayments(env, params.id);
  const supplierRequests = await listSupplierRequests(env, params.id);

  await recordAuditEvent(env, {
    actor: auditActor(request),
    action: statusChanged ? "order.status_update" : "order.update",
    entity_type: "order",
    entity_id: updated.id,
    entity_label: updated.order_number || updated.id,
    order_id: updated.id,
    details: {
      order_number: updated.order_number,
      status_from: current.status,
      status_to: updated.status,
      changed_fields: changedOrderFields(current, updated),
      customer_name: updated.customer_name,
      customer_phone: updated.customer_phone,
      car: updated.car,
      vin: updated.vin,
      item_name: updated.item_name,
      service_name: updated.service_name,
    },
  });

  return json({
    ok: true,
    order: updated,
    event_id: eventId,
    notification,
    google_ads_conversions: googleAdsConversions,
    events: events.results,
    notifications: notifications.results,
    tracking_events: trackingEvents.results,
    supplier_payments: supplierPayments,
    supplier_requests: supplierRequests,
  });
}

async function safeDelete(env, sql, ...binds) {
  try {
    await env.DB.prepare(sql).bind(...binds).run();
  } catch (error) {
    if (!/no such table|no such column/i.test(error.message || String(error))) throw error;
  }
}

export async function onRequestDelete({ request, params, env }) {
  const current = await loadOrder(env, params.id);
  if (!current) return json({ error: "Order not found" }, { status: 404 });

  const leadId = current.lead_id || "";
  const customerId = current.customer_id || "";

  await recordAuditEvent(env, {
    actor: auditActor(request),
    action: "order.delete",
    entity_type: "order",
    entity_id: current.id,
    entity_label: current.order_number || current.id,
    order_id: current.id,
    details: {
      order_number: current.order_number,
      lead_id: leadId,
      customer_id: customerId,
      status: current.status,
      payment_status: current.payment_status,
      customer_name: current.customer_name,
      customer_phone: current.customer_phone,
      customer_email: current.customer_email,
      car: current.car,
      vin: current.vin,
      item_name: current.item_name,
      service_name: current.service_name,
      request_text: current.request_text,
      revenue_uah: current.revenue_uah,
    },
  });

  await safeDelete(env, "DELETE FROM google_ads_conversion_events WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM order_tracking_events WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM supplier_telegram_messages WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM supplier_telegram_messages WHERE supplier_request_id IN (SELECT id FROM supplier_requests WHERE order_id = ?)", params.id);
  await safeDelete(env, "DELETE FROM supplier_payment_receipts WHERE supplier_payment_id IN (SELECT id FROM supplier_payments WHERE order_id = ?)", params.id);
  await safeDelete(env, "DELETE FROM supplier_payment_receipts WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM supplier_payments WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM supplier_tracking_events WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM supplier_request_images WHERE supplier_request_id IN (SELECT id FROM supplier_requests WHERE order_id = ?)", params.id);
  await safeDelete(env, "DELETE FROM supplier_quotes WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM supplier_requests WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM notification_queue WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM order_status_events WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM order_items WHERE order_id = ?", params.id);
  await safeDelete(env, "DELETE FROM orders WHERE id = ?", params.id);

  let leadDeleted = false;
  if (leadId) {
    const remainingLeadOrders = await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE lead_id = ?")
      .bind(leadId)
      .first();
    if (!Number(remainingLeadOrders?.count || 0)) {
      await safeDelete(env, "DELETE FROM leads WHERE id = ?", leadId);
      leadDeleted = true;
    }
  }

  let customerDeleted = false;
  if (customerId) {
    const remainingCustomerOrders = await env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?")
      .bind(customerId)
      .first();
    if (!Number(remainingCustomerOrders?.count || 0)) {
      await safeDelete(env, "DELETE FROM customers WHERE id = ?", customerId);
      customerDeleted = true;
    }
  }

  return json({
    ok: true,
    deleted_order_id: params.id,
    deleted_order_number: current.order_number || "",
    deleted_lead_id: leadDeleted ? leadId : "",
    deleted_customer_id: customerDeleted ? customerId : "",
  });
}
