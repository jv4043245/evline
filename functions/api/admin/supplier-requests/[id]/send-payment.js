import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  listChinaPreorders,
  sendSupplierRequestToPayment,
} from "../../../../_lib/supplier-portal.js";
import { listSupplierPayments } from "../../../../_lib/supplier-payments.js";
import { auditActor, recordAuditEvent } from "../../../../_lib/audit-log.js";

export async function onRequestPost({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const result = await sendSupplierRequestToPayment(env, params.id, payload);
    const orderId = result.request?.request?.order_id || result.payment?.order_id || "";
    const order = orderId ? await loadOrder(env, orderId) : null;
    const supplierPayments = orderId ? await listSupplierPayments(env, orderId) : [];
    const preorders = await listChinaPreorders(env, { status: "active" });
    const requestRow = result.request?.request || {};
    const payment = result.payment || {};

    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_request.send_payment",
      entity_type: "supplier_request",
      entity_id: requestRow.id || params.id,
      entity_label: requestRow.public_number || params.id,
      order_id: orderId,
      details: {
        order_number: order?.order_number,
        public_number: requestRow.public_number,
        supplier_name: requestRow.supplier_name,
        requested_amount: payment.requested_amount,
        requested_currency: payment.requested_currency,
        payment_id: payment.id,
      },
    });

    return json({
      ok: true,
      order,
      supplier_payment: result.payment,
      supplier_request: result.request,
      supplier_payments: supplierPayments,
      preorders,
    });
  } catch (error) {
    return json(
      {
        error: error.message || String(error),
        ...(error.migrate_to_chat_id ? { migrate_to_chat_id: error.migrate_to_chat_id } : {}),
      },
      { status: error.status || 500 }
    );
  }
}
