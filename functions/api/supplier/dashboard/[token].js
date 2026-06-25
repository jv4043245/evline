import { json } from "../../../_lib/http.js";
import { listSupplierDashboardByToken } from "../../../_lib/supplier-portal.js";

export async function onRequestGet({ params, env }) {
  try {
    const dashboard = await listSupplierDashboardByToken(env, params.token);
    if (!dashboard) return json({ error: "Supplier dashboard not found" }, { status: 404 });
    return json({ ok: true, ...dashboard });
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
