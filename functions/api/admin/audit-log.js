import { json } from "../../_lib/http.js";
import { listAuditEvents } from "../../_lib/audit-log.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const events = await listAuditEvents(env, {
    limit: url.searchParams.get("limit"),
    q: url.searchParams.get("q"),
  });
  return json({ ok: true, events });
}
