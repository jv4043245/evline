import { json } from "../../../_lib/http.js";
import { auditActor, recordAuditEvent } from "../../../_lib/audit-log.js";
import { deleteSupplierDirectoryEntry, listSupplierDirectory } from "../../../_lib/supplier-portal.js";

export async function onRequestDelete({ request, params, env }) {
  try {
    const supplier = await deleteSupplierDirectoryEntry(env, params.id);
    await recordAuditEvent(env, {
      actor: auditActor(request, env),
      action: "supplier.delete",
      entity_type: "supplier",
      entity_id: supplier.id,
      entity_label: supplier.display_name,
      details: { supplier_name: supplier.display_name },
    });
    return json({ ok: true, deleted_supplier: supplier, suppliers: await listSupplierDirectory(env) });
  } catch (error) {
    return json({ error: error.message || String(error) }, { status: error.status || 500 });
  }
}
