import { json, readPayload } from "../../../_lib/http.js";
import {
  deleteSupplierRequest,
  listChinaPreorders,
  replySupplierRequestClarification,
} from "../../../_lib/supplier-portal.js";

export async function onRequestPatch({ request, params, env }) {
  try {
    const payload = await readPayload(request);
    const supplierRequest = await replySupplierRequestClarification(env, params.id, payload);
    const preorders = await listChinaPreorders(env, { status: "active" });

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

export async function onRequestDelete({ params, env }) {
  try {
    const supplierRequest = await deleteSupplierRequest(env, params.id);
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
