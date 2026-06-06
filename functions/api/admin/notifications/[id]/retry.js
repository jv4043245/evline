import { json } from "../../../../_lib/http.js";
import { retryOrderNotification } from "../../../../_lib/crm.js";

export async function onRequestPost({ params, env }) {
  const result = await retryOrderNotification(env, params.id);
  return json(result, { status: result.status === "not_found" ? 404 : 200 });
}
