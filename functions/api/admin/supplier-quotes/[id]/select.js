import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  listSupplierRequests,
  sendSupplierRequestToPayment,
} from "../../../../_lib/supplier-portal.js";
import { listSupplierPayments } from "../../../../_lib/supplier-payments.js";
import { auditActor, recordAuditEvent } from "../../../../_lib/audit-log.js";

export async function onRequestPost({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const quote = await env.DB.prepare("SELECT * FROM supplier_quotes WHERE id = ?")
      .bind(params.id)
      .first();
    if (!quote) return json({ error: "Supplier quote not found" }, { status: 404 });
    const result = await sendSupplierRequestToPayment(env, quote.supplier_request_id, {
      quote_id: quote.id,
      client_approved: payload.client_approved === true,
    });
    const orderId = result.request?.request?.order_id || result.payment?.order_id || quote.order_id || "";
    const order = orderId ? await loadOrder(env, orderId) : null;
    const supplierRequests = orderId ? await listSupplierRequests(env, orderId) : [];
    const supplierPayments = orderId ? await listSupplierPayments(env, orderId) : [];
    const requestRow = result.request?.request || {};

    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_quote.select",
      entity_type: "supplier_quote",
      entity_id: quote.id,
      entity_label: requestRow.public_number || quote.id,
      order_id: orderId,
      details: {
        order_number: order?.order_number,
        public_number: requestRow.public_number,
        supplier_request_id: quote.supplier_request_id,
        supplier_name: requestRow.supplier_name,
        price_cny: quote.price_cny,
        purchase_days: quote.purchase_days,
        payment_id: result.payment?.id,
      },
    });

    return json({
      ok: true,
      order,
      supplier_request: result.request,
      supplier_payment: result.payment,
      supplier_requests: supplierRequests,
      supplier_payments: supplierPayments,
    });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
