import supplierReminders from '../supplier-document-reminders/index.js';
import pumbIncoming from '../pumb-incoming/index.js';

const DEFAULT_SYNC_URL = "https://evline.com.ua/api/cron/tracking-sync";

function timingSafeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function isAuthorizedManualRun(request, env) {
  const expected = env.CRON_SYNC_TOKEN || "";
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerToken = request.headers.get("x-cron-token") || "";
  return timingSafeEqual(bearer, expected) || timingSafeEqual(headerToken, expected);
}

async function runTrackingSync(env, source = "scheduled") {
  const token = env.CRON_SYNC_TOKEN;
  if (!token) {
    return {
      ok: false,
      error: "CRON_SYNC_TOKEN is not configured",
      source,
    };
  }

  const syncUrl = env.CRM_TRACKING_SYNC_URL || DEFAULT_SYNC_URL;
  const response = await fetch(syncUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "EVLine CRM tracking cron/1.0",
    },
    body: JSON.stringify({
      limit: Number(env.CRM_TRACKING_SYNC_LIMIT || 50),
      source,
    }),
  });

  const bodyText = await response.text();
  let body = bodyText;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    // Keep non-JSON responses readable in Worker logs.
  }

  return {
    ok: response.ok,
    status: response.status,
    source,
    body,
  };
}

export default {
  async scheduled(event, env, ctx) {
    // The shared trigger wakes every 15 minutes. Bank failures do not prevent
    // dispatching the existing tasks; each task owns its waitUntil promise.
    if (env.PUMB_CRON_TOKEN) ctx.waitUntil(pumbIncoming.scheduled(event, env, ctx));
    const scheduledAt = new Date(event.scheduledTime);
    // Preserve the original 00:00, 02:00, ... UTC schedule, including delayed
    // deliveries: use the scheduled timestamp, not the execution wall clock.
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getUTCMinutes() !== 0 || scheduledAt.getUTCHours() % 2 !== 0) return;
    // Independent task on the existing schedule; neither failure blocks the other.
    if (env.SUPPLIER_DOCS_CRON_TOKEN) await supplierReminders.scheduled(event, env, ctx);
    ctx.waitUntil(
      runTrackingSync(env, "scheduled").then((result) => {
        console.log(JSON.stringify(result));
      })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/run") {
      if (!isAuthorizedManualRun(request, env)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const result = await runTrackingSync(env, "manual");
      return Response.json(result, {
        status: result.ok ? 200 : 502,
        headers: { "cache-control": "no-store" },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        worker: "evline-crm-tracking-cron",
        has_token: Boolean(env.CRON_SYNC_TOKEN),
        has_pumb_token: Boolean(env.PUMB_CRON_TOKEN),
        schedule_revision: "shared-pumb-15m-legacy-2h-v2",
        sync_url: env.CRM_TRACKING_SYNC_URL || DEFAULT_SYNC_URL,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
