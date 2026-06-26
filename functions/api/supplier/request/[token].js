import { json, readPayload } from "../../../_lib/http.js";
import { recordAuditEvent } from "../../../_lib/audit-log.js";
import {
  createSupplierMessageByToken,
  createSupplierQuoteByToken,
  loadSupplierRequestByToken,
  publicSupplierBundle,
  updateSupplierDeliveryCostByToken,
  updateSupplierRequestByToken,
} from "../../../_lib/supplier-portal.js";

async function recordSupplierAudit(env, action, bundle, payload = {}) {
  const request = bundle?.request || {};
  const quote = (bundle?.quotes || [])[0] || {};
  await recordAuditEvent(env, {
    actor: request.supplier_name || "supplier",
    action,
    entity_type: "supplier_request",
    entity_id: request.id || "",
    entity_label: request.public_number || request.id || "",
    order_id: request.order_id || "",
    details: {
      public_number: request.public_number,
      supplier_name: request.supplier_name,
      status: request.status,
      car: request.car,
      vin: request.vin,
      item_name: request.item_name,
      price_cny: quote.price_cny ?? payload.price_cny,
      delivery_cost_cny: payload.delivery_cost_cny ?? quote.delivery_cost_cny,
      purchase_days: quote.purchase_days ?? payload.purchase_days,
      tracking_number: payload.tracking_number,
      message: payload.comment_cn || payload.comment || payload.comment_translated,
    },
  });
}

export async function onRequestGet({ params, env }) {
  try {
    const bundle = await loadSupplierRequestByToken(env, params.token, { markViewed: false });
    if (!bundle) return json({ error: "Supplier request not found" }, { status: 404 });
    return json({ ok: true, ...publicSupplierBundle(bundle) });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}

export async function onRequestPost({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const action = String(payload.action || "quote").trim();
    let bundle = null;
    if (action === "quote") {
      bundle = await createSupplierQuoteByToken(env, params.token, payload, { requestUrl: request.url });
      await recordSupplierAudit(env, "supplier.quote", bundle, payload);
    } else if (action === "message") {
      bundle = await createSupplierMessageByToken(env, params.token, payload, { requestUrl: request.url });
      await recordSupplierAudit(env, "supplier.message", bundle, payload);
    } else if (action === "delivery_cost") {
      bundle = await updateSupplierDeliveryCostByToken(env, params.token, payload);
      await recordSupplierAudit(env, "supplier.delivery_cost", bundle, payload);
    } else if (action === "no_stock" || action === "needs_info") {
      bundle = await updateSupplierRequestByToken(env, params.token, {
        status: action,
        tracking_number: payload.tracking_number,
        comment_cn: payload.comment_cn,
        comment_translated: payload.comment_translated,
        delivery_cost_cny: payload.delivery_cost_cny,
      }, { requestUrl: request.url });
      await recordSupplierAudit(env, "supplier.status_update", bundle, { ...payload, status: action });
    } else {
      return json({ error: "Unsupported supplier action" }, { status: 400 });
    }

    return json({ ok: true, ...publicSupplierBundle(bundle) });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}

export async function onRequestPatch({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const bundle = await updateSupplierRequestByToken(env, params.token, payload, { requestUrl: request.url });
    const action = ["china_tracking", "china_warehouse"].includes(String(payload.status || ""))
      ? "supplier.tracking_update"
      : "supplier.status_update";
    await recordSupplierAudit(env, action, bundle, payload);
    return json({ ok: true, ...publicSupplierBundle(bundle) });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
