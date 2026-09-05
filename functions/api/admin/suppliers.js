import { json, readPayload } from "../../_lib/http.js";
import { auditActor, recordAuditEvent } from "../../_lib/audit-log.js";
import { listSupplierDirectory, registerSupplier } from "../../_lib/supplier-portal.js";

export async function onRequestGet({ env }) {
  const suppliers = await listSupplierDirectory(env);
  return json({ ok: true, suppliers });
}

export async function onRequestPost({ request, env }) {
  try {
    const payload = await readPayload(request);
    const supplier = await registerSupplier(env, payload.supplier_name || payload.display_name || payload.name);
    await recordAuditEvent(env, {
      actor: auditActor(request, env),
      action: "supplier.create",
      entity_type: "supplier",
      entity_id: supplier.id,
      entity_label: supplier.display_name,
      details: { supplier_name: supplier.display_name },
    });
    return json({ ok: true, supplier, suppliers: await listSupplierDirectory(env) });
  } catch (error) {
    return json({ error: error.message || String(error) }, { status: error.status || 500 });
  }
}
