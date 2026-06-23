import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  createSupplierPaymentRequest,
  listSupplierPayments,
} from "../../../../_lib/supplier-payments.js";

export async function onRequestPost({ request, params, env }) {
  const payload = await readPayload(request);

  try {
    const payment = await createSupplierPaymentRequest(env, params.id, payload);
    const order = await loadOrder(env, params.id);
    const supplierPayments = await listSupplierPayments(env, params.id);

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
