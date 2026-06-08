import { json, readPayload } from "../../../_lib/http.js";
import { syncOpenTrackings } from "../../../_lib/tracking.js";

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const result = await syncOpenTrackings(env, payload);
  return json(result);
}
