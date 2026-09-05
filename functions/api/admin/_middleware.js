import { adminUser, unauthorized } from "../../_lib/auth.js";
import { json } from "../../_lib/http.js";

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return context.next();
  const user = adminUser(context.request, context.env);
  if (!user) return unauthorized();
  try {
    const original = await context.next();
    const response = new Response(original.body, original);
    response.headers.set("x-evline-admin-name", encodeURIComponent(user.name));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
