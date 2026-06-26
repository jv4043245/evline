import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  createSupplierRequest,
  listSupplierRequests,
} from "../../../../_lib/supplier-portal.js";
import { auditActor, recordAuditEvent } from "../../../../_lib/audit-log.js";

export async function onRequestGet({ params, env }) {
  const order = await loadOrder(env, params.id);
  if (!order) return json({ error: "Order not found" }, { status: 404 });
  const supplierRequests = await listSupplierRequests(env, params.id);
  return json({ ok: true, order, supplier_requests: supplierRequests });
}

export async function onRequestPost({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const origin = new URL(request.url).origin;
    const supplierRequest = await createSupplierRequest(env, params.id, payload, { origin });
    const order = await loadOrder(env, params.id);
    const supplierRequests = await listSupplierRequests(env, params.id);
    const supplierRequestRow = supplierRequest.request || {};

    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_request.create",
      entity_type: "supplier_request",
      entity_id: supplierRequestRow.id || supplierRequest.id,
      entity_label: supplierRequestRow.public_number || supplierRequest.public_number || supplierRequestRow.id || supplierRequest.id,
      order_id: params.id,
      details: {
        order_number: order?.order_number,
        supplier_name: supplierRequestRow.supplier_name || payload.supplier_name,
        public_number: supplierRequestRow.public_number || supplierRequest.public_number,
        car: supplierRequestRow.car || payload.car,
        vin: supplierRequestRow.vin || payload.vin,
        item_name: supplierRequestRow.item_name || payload.item_name,
        quantity: supplierRequestRow.quantity || payload.quantity,
      },
    });

    return json({
      ok: true,
      order,
      supplier_request: supplierRequest,
      supplier_requests: supplierRequests,
    });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
