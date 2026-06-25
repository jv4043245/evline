import { json, readPayload } from "../../../../_lib/http.js";
import { loadOrder } from "../../../../_lib/crm.js";
import {
  createSupplierRequest,
  listSupplierRequests,
} from "../../../../_lib/supplier-portal.js";

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
