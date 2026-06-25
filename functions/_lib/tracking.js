import {
  buildCustomerMessage,
  insertStatusEvent,
  loadOrder,
  normalizeOrderStatus,
  notifyManagerTrackingUpdate,
  queueOrderNotification,
} from "./crm.js";
import { integer, text } from "./http.js";

const MEEST_API_BASE = "https://track.meest.cn/api";
const TRACKING_USER_AGENT = "EVLine CRM tracking/1.0";
const TERMINAL_ORDER_STATUSES = new Set(["completed", "canceled"]);

const ORDER_PROGRESS = {
  new: 0,
  accepted: 1,
  proposal_sent: 2,
  awaiting_payment: 3,
  paid: 4,
  sourcing_china: 5,
  china_warehouse: 6,
  left_china: 7,
  in_ukraine: 8,
  ready_for_pickup: 9,
  completed: 10,
  canceled: 10,
};

let meestStatusMapPromise = null;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": TRACKING_USER_AGENT,
    },
  });
  const body = await response.text();
  let data = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
  }
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function localizationName(status, locale = "uk") {
  const localization = (status?.localizationData || []).find((item) => item.code === locale);
  return {
    name: text(localization?.name || status?.name),
    description: text(localization?.description),
  };
}

async function meestStatusMap() {
  if (!meestStatusMapPromise) {
    meestStatusMapPromise = fetchJson(`${MEEST_API_BASE}/v1/status/list/`).then((statuses) => {
      const map = new Map();
      for (const status of Array.isArray(statuses) ? statuses : []) {
        const label = localizationName(status, "uk");
        map.set(String(status.code), label);
        map.set(String(status.postal_code), label);
      }
      return map;
    });
  }
  return meestStatusMapPromise;
}

function isMeestOrder(order) {
  const carrier = `${text(order.shipping_carrier_id)} ${text(order.tracking_carrier)}`.toLowerCase();
  const trackingNumber = text(order.tracking_number).toUpperCase();
  return (
    carrier.includes("meest") ||
    carrier.includes("mist") ||
    trackingNumber.startsWith("MGR") ||
    trackingNumber.startsWith("CV")
  );
}

function trackingLocation(event) {
  return [text(event.city), text(event.country)].filter(Boolean).join(", ");
}

function normalizeMeestEvent(event, statusMap) {
  const statusCode = String(event.status || "");
  const label = statusMap.get(statusCode) || {};
  const statusText = text(event.status_desc_ua || label.name || event.status_desc_en || statusCode);
  return {
    carrier_event_id: `meest:${event.id || `${event.shipment}:${event.date}:${statusCode}`}`,
    occurred_at: text(event.date),
    country: text(event.country),
    city: text(event.city),
    status_code: statusCode,
    status_text: statusText,
    status_description: text(label.description),
    location: trackingLocation(event),
    raw_payload_json: JSON.stringify(event),
  };
}

function latestEvent(events) {
  return [...events].sort((a, b) => {
    const dateDiff = Date.parse(b.occurred_at || 0) - Date.parse(a.occurred_at || 0);
    if (dateDiff) return dateDiff;
    return text(b.carrier_event_id).localeCompare(text(a.carrier_event_id));
  })[0] || null;
}

function mapMeestToOrderStatus(event) {
  if (!event) return "";
  const statusCode = integer(event.status_code);
  const country = text(event.country).toUpperCase();
  const statusText = text(event.status_text).toLowerCase();

  if (country === "UA" || statusText.includes("україн")) return "in_ukraine";
  if (statusCode >= 400) return "left_china";
  if (statusCode >= 300) return "left_china";
  if (statusCode >= 200) return "china_warehouse";
  return "";
}

function advanceOrderStatus(currentStatus, candidateStatus) {
  const current = normalizeOrderStatus(currentStatus);
  const candidate = normalizeOrderStatus(candidateStatus, current);
  if (TERMINAL_ORDER_STATUSES.has(current)) return current;
  if ((ORDER_PROGRESS[candidate] ?? 0) > (ORDER_PROGRESS[current] ?? 0)) return candidate;
  return current;
}

function trackingUrl(carrier, trackingNumber) {
  const template = text(carrier?.tracking_url_template);
  if (template.includes("{tracking}")) return template.replace("{tracking}", encodeURIComponent(trackingNumber));
  if (template) return template;
  return `https://cab.meest.cn/`;
}

export async function fetchMeestTracking(trackingNumber) {
  const barcode = text(trackingNumber).toUpperCase();
  if (!barcode) throw new Error("Tracking number is required");

  const [statusMap, shipment, events] = await Promise.all([
    meestStatusMap(),
    fetchJson(`${MEEST_API_BASE}/v1/shipment/?barcode=${encodeURIComponent(barcode)}`).catch((error) => ({
      error: error.message || String(error),
    })),
    fetchJson(`${MEEST_API_BASE}/v1/track/list/?search=${encodeURIComponent(barcode)}`),
  ]);

  const normalizedEvents = (Array.isArray(events) ? events : []).map((event) => normalizeMeestEvent(event, statusMap));
  const latest = latestEvent(normalizedEvents);

  return {
    provider: "meest-china",
    tracking_number: barcode,
    shipment: shipment && !shipment.error ? shipment : null,
    shipment_error: shipment?.error || "",
    events: normalizedEvents,
    latest,
    estimated_delivery_at: text(shipment?.estimated_delivery_date),
    type_of_delivery: text(shipment?.type_of_delivery),
    type_of_service: text(shipment?.type_of_service),
  };
}

async function loadCarrier(env, order) {
  const carrierId = text(order.shipping_carrier_id);
  if (!carrierId) return null;
  return env.DB.prepare("SELECT * FROM shipping_carriers WHERE id = ?").bind(carrierId).first();
}

async function insertTrackingEvents(env, orderId, carrierId, trackingNumber, tracking) {
  for (const event of tracking.events) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO order_tracking_events (
        id, created_at, order_id, carrier_id, tracking_number, carrier_event_id,
        occurred_at, country, city, status_code, status_text, status_description,
        raw_payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        orderId,
        carrierId,
        trackingNumber,
        event.carrier_event_id,
        event.occurred_at,
        event.country,
        event.city,
        event.status_code,
        event.status_text,
        event.status_description,
        event.raw_payload_json
      )
      .run();
  }
}

function customerTrackingMessage(order, latest, nextStatus, tracking) {
  const lines = [
    "Оновлення доставки EVLine",
    `Статус: ${latest.status_text}`,
  ];
  if (latest.location) lines.push(`Місце: ${latest.location}`);
  if (latest.occurred_at) lines.push(`Дата: ${new Date(latest.occurred_at).toLocaleString("uk-UA")}`);
  const item = text(order.item_name || order.service_name);
  if (item) lines.push(`Замовлення: ${item}`);
  if (order.car) lines.push(`Авто: ${order.car}`);
  lines.push(`Трек-номер: ${tracking.tracking_number}`);
  if (tracking.estimated_delivery_at) {
    lines.push(`Орієнтовна дата доставки: ${new Date(tracking.estimated_delivery_at).toLocaleDateString("uk-UA")}`);
  }
  if (nextStatus !== order.status) {
    lines.push(`Статус замовлення в CRM: ${nextStatus}`);
  }
  return lines.join("\n");
}

async function updateOrderTrackingSnapshot(env, order, carrier, tracking, latest, nextStatus, error = "") {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE orders SET
      updated_at = ?,
      status = ?,
      tracking_carrier = COALESCE(NULLIF(tracking_carrier, ''), ?),
      tracking_url = COALESCE(NULLIF(tracking_url, ''), ?),
      tracking_last_checked_at = ?,
      tracking_last_event_id = COALESCE(NULLIF(?, ''), tracking_last_event_id),
      tracking_status_code = ?,
      tracking_status_text = ?,
      tracking_status_location = ?,
      tracking_status_at = ?,
      tracking_sync_error = ?,
      carrier_estimated_delivery_at = COALESCE(NULLIF(?, ''), carrier_estimated_delivery_at)
    WHERE id = ?`
  )
    .bind(
      now,
      nextStatus,
      text(carrier?.name) || "Meest China",
      trackingUrl(carrier, tracking.tracking_number),
      now,
      latest?.carrier_event_id || "",
      latest?.status_code || "",
      latest?.status_text || "",
      latest?.location || "",
      latest?.occurred_at || "",
      error,
      tracking.estimated_delivery_at || "",
      order.id
    )
    .run();
}

export async function syncOrderTracking(env, orderId, options = {}) {
  const order = await loadOrder(env, orderId);
  if (!order) return { ok: false, status: "order_not_found", error: "Order not found" };

  if (!text(order.tracking_number)) {
    return { ok: false, order_id: orderId, status: "missing_tracking_number", error: "Tracking number is empty" };
  }

  if (!isMeestOrder(order)) {
    return {
      ok: false,
      order_id: orderId,
      status: "unsupported_carrier",
      error: "Автоматичний трекінг зараз увімкнено тільки для Meest China",
    };
  }

  const carrier = await loadCarrier(env, order);
  const trackingNumber = text(order.tracking_number).toUpperCase();

  try {
    const tracking = await fetchMeestTracking(trackingNumber);
    const latest = tracking.latest;
    await insertTrackingEvents(env, order.id, text(carrier?.id || order.shipping_carrier_id || "mist-china"), trackingNumber, tracking);

    const mappedStatus = mapMeestToOrderStatus(latest);
    const nextStatus = advanceOrderStatus(order.status, mappedStatus);
    const latestEventChanged = Boolean(latest?.carrier_event_id && latest.carrier_event_id !== order.tracking_last_event_id);
    await updateOrderTrackingSnapshot(env, order, carrier, tracking, latest, nextStatus, "");

    let eventId = "";
    let notification = null;
    const hasTrackingBaseline = Boolean(order.tracking_last_event_id);
    const shouldNotify = latestEventChanged && (hasTrackingBaseline || options.notify_initial);
    let managerNotification = null;

    if (latestEventChanged && latest) {
      eventId = await insertStatusEvent(env, {
        order_id: order.id,
        previous_status: order.status,
        status: nextStatus,
        actor: "tracking:meest-china",
        comment: `Meest China: ${latest.status_text}${latest.location ? ` (${latest.location})` : ""}`,
        notify_customer: shouldNotify,
        notification_status: shouldNotify ? "queued" : "not_queued",
      });

      if (shouldNotify) {
        const updatedOrder = await loadOrder(env, order.id);
        notification = await queueOrderNotification(env, {
          order: updatedOrder,
          eventId,
          status: nextStatus,
          message: customerTrackingMessage(order, latest, nextStatus, tracking) || (await buildCustomerMessage(env, updatedOrder, nextStatus)),
        });
      }

      managerNotification = await notifyManagerTrackingUpdate(env, {
        order,
        latest,
        previousStatus: order.status,
        nextStatus,
        tracking,
        customerNotification: notification,
        isFirstSync: !hasTrackingBaseline,
      });
    }

    return {
      ok: true,
      order_id: order.id,
      provider: tracking.provider,
      status: latestEventChanged ? "updated" : "unchanged",
      notified: Boolean(notification),
      event_id: eventId,
      notification,
      manager_notification: managerNotification,
      latest,
      estimated_delivery_at: tracking.estimated_delivery_at,
      events_count: tracking.events.length,
    };
  } catch (error) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE orders SET tracking_last_checked_at = ?, tracking_sync_error = ? WHERE id = ?`
    )
      .bind(now, error.message || String(error), order.id)
      .run();
    return { ok: false, order_id: order.id, status: "sync_failed", error: error.message || String(error) };
  }
}

export async function syncOpenTrackings(env, options = {}) {
  const limit = Math.min(Math.max(integer(options.limit) || 25, 1), 100);
  const rows = await env.DB.prepare(
    `SELECT id FROM orders
    WHERE COALESCE(tracking_number, '') <> ''
      AND status NOT IN ('completed', 'canceled')
      AND (
        shipping_carrier_id IN ('mist-china', 'meest-china')
        OR lower(COALESCE(tracking_carrier, '')) LIKE '%meest%'
        OR lower(COALESCE(tracking_carrier, '')) LIKE '%mist%'
        OR upper(tracking_number) LIKE 'MGR%'
      )
    ORDER BY COALESCE(tracking_last_checked_at, '') ASC, created_at DESC
    LIMIT ?`
  )
    .bind(limit)
    .all();

  const results = [];
  for (const row of rows.results || []) {
    results.push(await syncOrderTracking(env, row.id, { notify_initial: false }));
  }

  return {
    ok: true,
    checked: results.length,
    updated: results.filter((result) => result.status === "updated").length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}
