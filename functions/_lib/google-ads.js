import { number, text } from "./http.js";

export const GOOGLE_ADS_CUSTOMER_ID = "4028488894";

const EVENT_DEFINITIONS = {
  lead: {
    crm_status: "new",
    setting_key: "lead_conversion_action_name",
    conversion_action_name: "EVLine Lead",
  },
  paid: {
    crm_status: "paid",
    setting_key: "paid_conversion_action_name",
    conversion_action_name: "EVLine Paid Order",
  },
  completed: {
    crm_status: "completed",
    setting_key: "completed_conversion_action_name",
    conversion_action_name: "EVLine Completed Order",
  },
};

const PAID_OR_LATER = new Set([
  "paid",
  "sourcing_china",
  "china_warehouse",
  "left_china",
  "in_ukraine",
  "ready_for_pickup",
  "completed",
]);

function costTotal(row) {
  return (
    number(row.purchase_cost_uah) +
    number(row.delivery_cost_uah) +
    number(row.customs_cost_uah) +
    number(row.processing_cost_uah) +
    number(row.ad_cost_uah) +
    number(row.other_cost_uah)
  );
}

function grossProfit(row) {
  return number(row.revenue_uah) - costTotal(row);
}

function conversionTimeFor(order, eventType) {
  const raw =
    eventType === "completed"
      ? text(order.completed_at || order.updated_at || order.created_at)
      : eventType === "paid"
        ? text(order.paid_at || order.updated_at || order.created_at)
        : text(order.created_at || order.updated_at);
  return formatGoogleConversionTime(raw || new Date().toISOString());
}

function formatGoogleConversionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace("T", " ") + "+00:00";
  }
  return date.toISOString().slice(0, 19).replace("T", " ") + "+00:00";
}

function conversionValueFor(order, eventType) {
  if (eventType === "lead") return 0;
  return number(order.revenue_uah);
}

function orderHasClickId(order) {
  return Boolean(text(order.gclid) || text(order.gbraid) || text(order.wbraid));
}

function orderHasCustomerIdentifier(order) {
  return Boolean(text(order.customer_email || order.email) || text(order.customer_phone || order.phone));
}

function queueStatusFor(order) {
  if (orderHasClickId(order) || orderHasCustomerIdentifier(order)) {
    return { status: "queued", skip_reason: "" };
  }
  return {
    status: "skipped",
    skip_reason: "Немає gclid/gbraid/wbraid або email/телефону для enhanced conversion.",
  };
}

async function googleAdsSetting(env, key, fallback = "") {
  try {
    const row = await env.DB.prepare("SELECT value FROM google_ads_settings WHERE key = ?").bind(key).first();
    return text(row?.value) || fallback;
  } catch {
    return fallback;
  }
}

export function googleAdsEventTypesForStatus(status) {
  const normalized = text(status) || "new";
  const events = ["lead"];
  if (PAID_OR_LATER.has(normalized)) events.push("paid");
  if (normalized === "completed") events.push("completed");
  return events;
}

export function googleAdsEventTypesForStatusChange(status) {
  const normalized = text(status) || "new";
  if (normalized === "completed") return ["paid", "completed"];
  if (PAID_OR_LATER.has(normalized)) return ["paid"];
  return [];
}

export async function queueGoogleAdsConversion(env, order, eventType) {
  const definition = EVENT_DEFINITIONS[eventType];
  if (!definition || !order?.id) return null;

  const now = new Date().toISOString();
  const customerId = text(env.GOOGLE_ADS_CUSTOMER_ID) || (await googleAdsSetting(env, "customer_id", GOOGLE_ADS_CUSTOMER_ID));
  const currency = text(env.GOOGLE_ADS_CURRENCY_CODE) || (await googleAdsSetting(env, "currency_code", "UAH"));
  const conversionActionName = await googleAdsSetting(env, definition.setting_key, definition.conversion_action_name);
  const conversionAction = text(env[`GOOGLE_ADS_${eventType.toUpperCase()}_CONVERSION_ACTION`]);
  const conversionValue = conversionValueFor(order, eventType);
  const profit = grossProfit(order);
  const hasClickId = orderHasClickId(order) ? 1 : 0;
  const hasCustomerIdentifier = orderHasCustomerIdentifier(order) ? 1 : 0;
  const { status, skip_reason } = queueStatusFor(order);
  const orderIdForGoogle = `${order.id}_${eventType}`;

  const values = [
    crypto.randomUUID(),
    now,
    now,
    order.id,
    text(order.lead_id),
    eventType,
    definition.crm_status,
    customerId,
    conversionAction,
    conversionActionName,
    conversionTimeFor(order, eventType),
    conversionValue,
    profit,
    currency,
    orderIdForGoogle,
    text(order.source),
    text(order.medium),
    text(order.campaign),
    text(order.gclid),
    text(order.gbraid),
    text(order.wbraid),
    hasClickId,
    hasCustomerIdentifier,
    status,
    skip_reason,
  ];

  await env.DB.prepare(
    `INSERT OR IGNORE INTO google_ads_conversion_events (
      id, created_at, updated_at, order_id, lead_id, event_type, crm_status,
      google_ads_customer_id, conversion_action, conversion_action_name,
      conversion_time, conversion_value, gross_profit_uah, currency_code,
      order_id_for_google, source, medium, campaign, gclid, gbraid, wbraid,
      has_click_id, has_customer_identifier, status, skip_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(...values)
    .run();

  await env.DB.prepare(
    `UPDATE google_ads_conversion_events SET
      updated_at = ?,
      crm_status = ?,
      google_ads_customer_id = ?,
      conversion_action = COALESCE(NULLIF(?, ''), conversion_action),
      conversion_action_name = ?,
      conversion_time = ?,
      conversion_value = ?,
      gross_profit_uah = ?,
      currency_code = ?,
      source = ?,
      medium = ?,
      campaign = ?,
      gclid = ?,
      gbraid = ?,
      wbraid = ?,
      has_click_id = ?,
      has_customer_identifier = ?,
      status = CASE WHEN status = 'uploaded' THEN status ELSE ? END,
      skip_reason = CASE WHEN status = 'uploaded' THEN skip_reason ELSE ? END
    WHERE order_id = ? AND event_type = ?`
  )
    .bind(
      now,
      definition.crm_status,
      customerId,
      conversionAction,
      conversionActionName,
      conversionTimeFor(order, eventType),
      conversionValue,
      profit,
      currency,
      text(order.source),
      text(order.medium),
      text(order.campaign),
      text(order.gclid),
      text(order.gbraid),
      text(order.wbraid),
      hasClickId,
      hasCustomerIdentifier,
      status,
      skip_reason,
      order.id,
      eventType
    )
    .run();

  return { event_type: eventType, status, conversion_value: conversionValue, currency_code: currency };
}

export async function queueGoogleAdsConversionsForOrder(env, order, eventTypes) {
  const results = [];
  for (const eventType of eventTypes) {
    try {
      const result = await queueGoogleAdsConversion(env, order, eventType);
      if (result) results.push(result);
    } catch (error) {
      console.error("Failed to queue Google Ads conversion", error);
      results.push({ event_type: eventType, status: "failed", error: error.message || String(error) });
    }
  }
  return results;
}

export async function queueGoogleAdsConversionsForStatus(env, order, status) {
  return queueGoogleAdsConversionsForOrder(env, order, googleAdsEventTypesForStatusChange(status));
}
