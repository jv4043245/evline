import { json } from "./http.js";

export function isAdminRequest(request, env) {
  const expected = env.ADMIN_TOKEN;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = request.headers.get("x-admin-token") || "";
  if (expected) return bearer === expected || headerToken === expected;

  return false;
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}
