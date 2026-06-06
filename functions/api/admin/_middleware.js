import { isAdminRequest, unauthorized } from "../../_lib/auth.js";

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return context.next();
  if (!isAdminRequest(context.request, context.env)) return unauthorized();
  return context.next();
}
