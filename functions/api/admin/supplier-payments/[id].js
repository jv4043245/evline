import { json, readPayload } from "../../../_lib/http.js";
import { loadOrder } from "../../../_lib/crm.js";
import {
  listSupplierPayments,
  updateSupplierPayment,
} from "../../../_lib/supplier-payments.js";

export async function onRequestPatch({ request, params, env }) {
  const payload = await readPayload(request);

  try {
    const payment = await updateSupplierPayment(env, params.id, payload);
    const order = payment?.order_id ? await loadOrder(env, payment.order_id) : null;
    const supplierPayments = payment?.order_id ? await listSupplierPayments(env, payment.order_id) : [];

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
