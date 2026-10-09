// Account-wide, GET-only Meta Insights reader. No advertising mutations.
export const META_ACCOUNT_ID = "1354524650161143";
const ORIGIN = "https://graph.facebook.com";
const TIMEZONE = "Europe/Kyiv";
const MAX_BYTES = 128 * 1024;
const MAX_PAGES = 10;
const CODES = new Set([
  "meta_configuration_unavailable", "meta_network_unavailable", "meta_api_unavailable",
  "meta_response_invalid", "meta_account_mismatch", "meta_currency_mismatch",
  "meta_timezone_mismatch", "meta_pagination_invalid", "meta_spend_invalid",
]);

function fail(code) { throw Object.assign(new Error(code), { code }); }
export function safeMetaErrorCode(error) {
  return CODES.has(error?.code) ? error.code : "meta_api_unavailable";
}
function shift(date, amount) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}
export function metaCompletedWindow(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("meta_configuration_unavailable");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return { from: shift(today, -30), to: shift(today, -1) };
}
function dateValid(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function minorUnits(value) {
  // UAH has two minor digits. Reject precision loss, exponents and negative spend.
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) fail("meta_spend_invalid");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result < 0) fail("meta_spend_invalid");
  return result;
}
async function proof(token, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function boundedJson(response) {
  if (!response.ok) fail("meta_api_unavailable");
  if (!response.body?.getReader) fail("meta_response_invalid");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) fail("meta_response_invalid");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); fail("meta_response_invalid"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let json;
  try { json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("meta_response_invalid"); }
  if (!json || typeof json !== "object" || Array.isArray(json)) fail("meta_response_invalid");
  if (json.error) fail("meta_api_unavailable");
  return json;
}
function nextCursor(body, path, seen) {
  if (body.paging === undefined) return null;
  if (!body.paging || typeof body.paging !== "object" || Array.isArray(body.paging)) fail("meta_pagination_invalid");
  if (body.paging.next === undefined || body.paging.next === null || body.paging.next === "") return null;
  let next;
  try { next = new URL(body.paging.next); } catch { fail("meta_pagination_invalid"); }
  // Validate the remote pointer but NEVER fetch it: rebuild fixed parameters locally.
  if (next.origin !== ORIGIN || next.pathname !== path || next.username || next.password || next.hash) fail("meta_pagination_invalid");
  const cursor = body.paging.cursors?.after;
  if (typeof cursor !== "string" || !/^[A-Za-z0-9+/_=-]{1,2048}$/.test(cursor)
      || next.searchParams.get("after") !== cursor || seen.has(cursor)) fail("meta_pagination_invalid");
  seen.add(cursor);
  return cursor;
}

export async function fetchMetaAdSpendSnapshot(env, { fetchImpl = fetch, now = new Date() } = {}) {
  const version = String(env.META_GRAPH_API_VERSION || "").trim();
  const token = String(env.META_ADS_INSIGHTS_ACCESS_TOKEN || "").trim();
  const appSecret = String(env.META_ADS_INSIGHTS_APP_SECRET || "").trim();
  if (!/^v\d{1,2}\.0$/.test(version) || token.length < 32 || /\s/.test(token)
      || (appSecret && (appSecret.length < 32 || appSecret === token))) fail("meta_configuration_unavailable");
  const { from, to } = metaCompletedWindow(now);
  const appProof = appSecret ? await proof(token, appSecret) : null;
  const basePath = `/${version}/act_${META_ACCOUNT_ID}`;
  async function request(path, parameters) {
    const url = new URL(path, ORIGIN);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (appProof) url.searchParams.set("appsecret_proof", appProof);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetchImpl(url.toString(), {
        method: "GET", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      return await boundedJson(response);
    } catch (error) {
      if (CODES.has(error?.code)) throw error;
      fail("meta_network_unavailable");
    } finally { clearTimeout(timer); }
  }
  const account = await request(basePath, { fields: "id,account_id,currency,timezone_name" });
  if (account.id !== `act_${META_ACCOUNT_ID}` || account.account_id !== META_ACCOUNT_ID) fail("meta_account_mismatch");
  if (account.currency !== "UAH") fail("meta_currency_mismatch");
  if (!["Europe/Kyiv", "Europe/Kiev"].includes(account.timezone_name)) fail("meta_timezone_mismatch");
  const path = `${basePath}/insights`;
  const amounts = new Map();
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await request(path, {
      fields: "account_id,account_currency,date_start,date_stop,spend", level: "account",
      time_increment: "1", time_range: JSON.stringify({ since: from, until: to }), limit: "100",
      ...(cursor ? { after: cursor } : {}),
    });
    if (!Array.isArray(body.data) || body.data.length > 100) fail("meta_response_invalid");
    for (const row of body.data) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail("meta_response_invalid");
      if (row.account_id !== META_ACCOUNT_ID) fail("meta_account_mismatch");
      if (row.account_currency !== "UAH") fail("meta_currency_mismatch");
      if (!dateValid(row.date_start) || row.date_stop !== row.date_start
          || row.date_start < from || row.date_start > to || amounts.has(row.date_start)
          || row.campaign_id !== undefined || row.adset_id !== undefined || row.ad_id !== undefined) fail("meta_response_invalid");
      amounts.set(row.date_start, minorUnits(row.spend));
    }
    cursor = nextCursor(body, path, seen);
    if (!cursor) break;
    if (page === MAX_PAGES - 1) fail("meta_pagination_invalid");
  }
  // Missing days mean zero only after verified account identity and every page succeeds.
  const days = [];
  for (let date = from; date <= to; date = shift(date, 1)) {
    days.push({ date, spend_minor: amounts.get(date) ?? 0, is_final: true });
  }
  return {
    provider: "meta", account_id: META_ACCOUNT_ID, currency: "UAH", timezone: TIMEZONE,
    from, to, fetched_at: now.toISOString(), scope: "account", coverage: "complete",
    source: "meta_insights", days,
  };
}
