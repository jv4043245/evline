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
