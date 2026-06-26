import { json, readPayload } from "../../../_lib/http.js";
import { loadOrder } from "../../../_lib/crm.js";
import {
  listSupplierPayments,
  updateSupplierPayment,
} from "../../../_lib/supplier-payments.js";
import { auditActor, recordAuditEvent } from "../../../_lib/audit-log.js";

export async function onRequestPatch({ request, params, env }) {
  const payload = await readPayload(request);

  try {
    const payment = await updateSupplierPayment(env, params.id, payload);
    const order = payment?.order_id ? await loadOrder(env, payment.order_id) : null;
    const supplierPayments = payment?.order_id ? await listSupplierPayments(env, payment.order_id) : [];

    await recordAuditEvent(env, {
      actor: auditActor(request),
      action: "supplier_payment.update",
      entity_type: "supplier_payment",
      entity_id: payment.id,
      entity_label: payment.supplier_name || payment.id,
      order_id: payment.order_id || "",
      details: {
        order_number: order?.order_number,
        supplier_name: payment.supplier_name,
        status: payment.status,
        requested_amount: payment.requested_amount,
        requested_currency: payment.requested_currency,
        paid_amount: payment.paid_amount,
        paid_currency: payment.paid_currency,
        receipt_image_url: payment.receipt_image_url,
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
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
