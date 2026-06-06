import { json } from "./http.js";

export function isAdminRequest(request, env) {
  const email = request.headers.get("cf-access-authenticated-user-email");
  const accessJwt = request.headers.get("cf-access-jwt-assertion");
  if (email || accessJwt) return true;

  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = request.headers.get("x-admin-token") || "";
  return bearer === expected || headerToken === expected;
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}
