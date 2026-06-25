import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  listChinaPreorders,
  sendSupplierRequestToPayment,
} from "../../../../_lib/supplier-portal.js";
import { listSupplierPayments } from "../../../../_lib/supplier-payments.js";

export async function onRequestPost({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const result = await sendSupplierRequestToPayment(env, params.id, payload);
    const orderId = result.request?.request?.order_id || result.payment?.order_id || "";
    const order = orderId ? await loadOrder(env, orderId) : null;
    const supplierPayments = orderId ? await listSupplierPayments(env, orderId) : [];
    const preorders = await listChinaPreorders(env, { status: "active" });

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
