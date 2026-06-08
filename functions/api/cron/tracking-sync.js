import { json, readPayload, text } from "../../_lib/http.js";
import { syncOpenTrackings } from "../../_lib/tracking.js";

function timingSafeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function isCronRequest(request, env) {
  const expected = text(env.CRON_SYNC_TOKEN);
  if (!expected) return false;

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = request.headers.get("x-cron-token") || "";

  return timingSafeEqual(bearer, expected) || timingSafeEqual(headerToken, expected);
}

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  if (!isCronRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await readPayload(request).catch(() => ({}));
  const result = await syncOpenTrackings(env, {
    limit: payload.limit || 50,
  });

  return json({
    ...result,
    triggered_by: "cron",
    checked_at: new Date().toISOString(),
  });
}

export async function onRequestGet({ request, env }) {
  if (!isCronRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return json({
    ok: true,
    endpoint: "tracking-sync",
    ready: Boolean(env.DB && env.CRON_SYNC_TOKEN),
  });
}
