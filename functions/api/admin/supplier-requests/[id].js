import { json, readPayload } from "../../../_lib/http.js";
import {
  deleteSupplierRequest,
  listChinaPreorders,
  replySupplierRequestClarification,
} from "../../../_lib/supplier-portal.js";
import { auditActor, recordAuditEvent } from "../../../_lib/audit-log.js";

export async function onRequestPatch({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const supplierRequest = await replySupplierRequestClarification(env, params.id, payload);
    const preorders = await listChinaPreorders(env, { status: "active" });
    const requestRow = supplierRequest.request || {};

    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_request.message",
      entity_type: "supplier_request",
      entity_id: requestRow.id || params.id,
      entity_label: requestRow.public_number || params.id,
      order_id: requestRow.order_id || "",
      details: {
        public_number: requestRow.public_number,
        supplier_name: requestRow.supplier_name,
        message: payload.manager_comment || payload.comment || payload.comment_cn,
      },
    });

    return json({
      ok: true,
      supplier_request: supplierRequest,
      preorders,
    });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}

export async function onRequestDelete({ request, params, env }) {
  try {
    const supplierRequest = await deleteSupplierRequest(env, params.id);
    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_request.delete",
      entity_type: "supplier_request",
      entity_id: supplierRequest.id,
      entity_label: supplierRequest.public_number || supplierRequest.id,
      order_id: supplierRequest.order_id || "",
      details: {
        public_number: supplierRequest.public_number,
        supplier_name: supplierRequest.supplier_name,
        status: supplierRequest.status,
        car: supplierRequest.car,
        vin: supplierRequest.vin,
        item_name: supplierRequest.item_name,
        quantity: supplierRequest.quantity,
        request_text: supplierRequest.request_text_ru || supplierRequest.request_text,
      },
    });
    return json({
      ok: true,
      deleted_supplier_request_id: supplierRequest.id,
      deleted_supplier_request_number: supplierRequest.public_number || "",
      order_id: supplierRequest.order_id || "",
    });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
