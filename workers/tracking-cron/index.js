const DEFAULT_SYNC_URL = "https://evline.com.ua/api/cron/tracking-sync";

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
    ctx.waitUntil(
      runTrackingSync(env, "scheduled").then((result) => {
        console.log(JSON.stringify(result));
      })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/run") {
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
        sync_url: env.CRM_TRACKING_SYNC_URL || DEFAULT_SYNC_URL,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
