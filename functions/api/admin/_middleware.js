import { isAdminRequest, unauthorized } from "../../_lib/auth.js";
import { json } from "../../_lib/http.js";

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return context.next();
  if (!isAdminRequest(context.request, context.env)) return unauthorized();
  try {
    return await context.next();
  } catch (error) {
    return json(
      { error: error.message || String(error) },
      { status: error.status || 500 }
    );
  }
}
