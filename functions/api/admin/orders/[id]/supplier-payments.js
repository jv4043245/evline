import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  createSupplierPaymentRequest,
  listSupplierPayments,
} from "../../../../_lib/supplier-payments.js";
import { auditActor, recordAuditEvent } from "../../../../_lib/audit-log.js";

export async function onRequestPost({ request, params, env }) {
  const payload = await readPayload(request);

  try {
    const payment = await createSupplierPaymentRequest(env, params.id, payload);
    const order = await loadOrder(env, params.id);
    const supplierPayments = await listSupplierPayments(env, params.id);

    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_payment.create",
      entity_type: "supplier_payment",
      entity_id: payment.id,
      entity_label: payment.supplier_name || payment.id,
      order_id: params.id,
      details: {
        order_number: order?.order_number,
        supplier_name: payment.supplier_name,
        requested_amount: payment.requested_amount,
        requested_currency: payment.requested_currency,
        status: payment.status,
      },
    });

    return json({
      ok: true,
      order,
      supplier_payment: payment,
      supplier_payments: supplierPayments,
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
