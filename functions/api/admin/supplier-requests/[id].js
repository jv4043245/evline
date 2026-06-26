import { json, readPayload } from "../../../_lib/http.js";
import {
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
