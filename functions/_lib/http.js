export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

const LEAD_CORS_ALLOWED_ORIGINS = new Set([
  "https://evline.com.ua",
  "https://www.evline.com.ua",
  "https://evline.pages.dev",
  "https://jv4043245.github.io",
]);

export function leadCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const isLocal = origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:");
  const allowOrigin = !origin || LEAD_CORS_ALLOWED_ORIGINS.has(origin) || isLocal ? origin || "*" : "https://evline.com.ua";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function csv(body, filename = "evline-export.csv") {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function readPayload(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    return request.json();
  }
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    return Object.fromEntries(await request.formData());
  }
  return {};
}

export function text(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function integer(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rangeStart(range = "30d") {
  if (range === "all") return null;
  const days = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365,
  }[range] || 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function escapeCsv(value) {
  const textValue = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}
