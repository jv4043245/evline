import { json } from "./http.js";

function configuredUsers(env) {
  const users = [];
  if (typeof env.ADMIN_TOKEN === "string" && env.ADMIN_TOKEN.trim()) {
    users.push({ id: "andrii", name: "Андрій", token: env.ADMIN_TOKEN.trim() });
  }
  try {
    const additional = JSON.parse(env.ADMIN_USERS_JSON || "[]");
    if (Array.isArray(additional)) {
      for (const user of additional) {
        if (typeof user?.id !== "string" || typeof user?.name !== "string" || typeof user?.token !== "string") continue;
        if (!user.id.trim() || !user.name.trim() || !user.token.trim() || user.id.trim() === "andrii") continue;
        users.push({ id: user.id.trim(), name: user.name.trim(), token: user.token.trim() });
      }
    }
  } catch {
    // A malformed additional-users secret must not lock out the existing token.
  }
  return users;
}

export function adminUser(request, env = {}) {
  const auth = request?.headers?.get("authorization") || "";
  const bearer = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  const headerToken = (request?.headers?.get("x-admin-token") || "").trim();
  if (bearer && headerToken && bearer !== headerToken) return null;
  const token = bearer || headerToken;
  if (!token) return null;

  const users = configuredUsers(env);
  const matches = users.filter((user) => user.token === token);
  if (matches.length !== 1) return null;
  const user = matches[0];
  if (users.filter((entry) => entry.id === user.id).length !== 1) return null;
  return { id: user.id, name: user.name, role: "admin" };
}

export function isAdminRequest(request, env) {
  return Boolean(adminUser(request, env));
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}
