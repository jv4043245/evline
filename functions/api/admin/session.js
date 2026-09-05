import { adminUser, unauthorized } from "../../_lib/auth.js";
import { recordAuditEvent } from "../../_lib/audit-log.js";
import { json } from "../../_lib/http.js";

export function onRequestGet({ request, env }) {
  const user = adminUser(request, env);
  if (!user) return unauthorized();
  return json({ ok: true, user }, { headers: { "cache-control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  const user = adminUser(request, env);
  if (!user) return unauthorized();
  await recordAuditEvent(env, {
    actor: user.name,
    action: "admin.sign_in",
    entity_type: "admin_user",
    entity_id: user.id,
    entity_label: user.name,
  });
  return json({ ok: true, user }, { headers: { "cache-control": "no-store" } });
}
