import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fetchMetaAdSpendSnapshot, metaCompletedWindow, META_ACCOUNT_ID, safeMetaErrorCode } from "../functions/_lib/accounting-meta.js";
import worker, { runAccountingMetaSync } from "../workers/accounting-meta/index.js";

const now = new Date("2026-10-09T05:45:00Z");
const env = { META_GRAPH_API_VERSION: "v24.0", META_ADS_INSIGHTS_ACCESS_TOKEN: "test-access-token-".repeat(4) };
const account = { id: `act_${META_ACCOUNT_ID}`, account_id: META_ACCOUNT_ID, currency: "UAH", timezone_name: "Europe/Kyiv" };
const row = (date = "2026-10-08", spend = "12.34") => ({ account_id: META_ACCOUNT_ID, account_currency: "UAH", date_start: date, date_stop: date, spend });
const response = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function mock(values) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    const value = values.shift();
    if (value instanceof Error) throw value;
    assert.notEqual(value, undefined, "Unexpected network request");
    return value instanceof Response ? value : response(value);
  } };
}
async function collect(values, config = env) {
  const m = mock(values);
  return { result: await fetchMetaAdSpendSnapshot(config, { now, fetchImpl: m.fetchImpl }), calls: m.calls };
}
const next = cursor => ({ next: `https://graph.facebook.com/v24.0/act_${META_ACCOUNT_ID}/insights?after=${cursor}`, cursors: { after: cursor } });

test("30 completed Kyiv dates, including local midnight and DST boundaries", () => {
  assert.deepEqual(metaCompletedWindow(now), { from: "2026-09-09", to: "2026-10-08" });
  assert.deepEqual(metaCompletedWindow(new Date("2026-10-08T21:30:00Z")), { from: "2026-09-09", to: "2026-10-08" });
  assert.deepEqual(metaCompletedWindow(new Date("2026-10-26T00:30:00Z")), { from: "2026-09-26", to: "2026-10-25" });
});
test("account-wide complete snapshot is minor-unit precise and explicitly fills completed zero days", async () => {
  const { result, calls } = await collect([account, { data: [row()] }]);
  assert.equal(result.days.length, 30); assert.equal(result.days.at(-1).spend_minor, 1234);
  assert.equal(result.days[0].spend_minor, 0); assert.ok(result.days.every(day => day.is_final));
  assert.equal(result.account_id, META_ACCOUNT_ID); assert.equal(result.scope, "account");
  assert.equal(result.coverage, "complete"); assert.equal(result.source, "meta_insights");
  const url = calls[1].url;
  assert.equal(url.searchParams.get("level"), "account"); assert.equal(url.searchParams.get("time_increment"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("time_range")), { since: "2026-09-09", until: "2026-10-08" });
  for (const key of ["filtering", "breakdowns", "campaign_id", "access_token"]) assert.equal(url.searchParams.has(key), false);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${env.META_ADS_INSIGHTS_ACCESS_TOKEN}`);
});
test("Europe/Kiev metadata alias is accepted and normalized", async () => {
  const { result } = await collect([{ ...account, timezone_name: "Europe/Kiev" }, { data: [] }]);
  assert.equal(result.timezone, "Europe/Kyiv"); assert.ok(result.days.every(day => day.spend_minor === 0));
});
test("all pages succeed before zero coverage and next URLs are not followed", async () => {
  const paging = next("CURSOR1"); paging.next += "&filtering=evil&access_token=wrong";
  const { result, calls } = await collect([account, { data: [row()], paging }, { data: [row("2026-10-07", "20")] }]);
  assert.equal(result.days.at(-2).spend_minor, 2000);
  assert.equal(calls[2].url.searchParams.get("after"), "CURSOR1");
  assert.equal(calls[2].url.searchParams.has("filtering"), false);
  assert.equal(calls[2].url.searchParams.has("access_token"), false);
});
test("foreign pagination origins fail without transmitting any next request", async () => {
  const m = mock([account, { data: [], paging: { ...next("A"), next: "https://evil.example/steal?after=A" } }]);
  await assert.rejects(fetchMetaAdSpendSnapshot(env, { now, fetchImpl: m.fetchImpl }), /meta_pagination_invalid/);
  assert.equal(m.calls.length, 2);
});
test("foreign account pagination path is rejected", async () => {
  await assert.rejects(collect([account, { data: [], paging: { ...next("A"), next: "https://graph.facebook.com/v24.0/act_999/insights?after=A" } }]), /meta_pagination_invalid/);
});
test("missing, mismatched and looping cursors fail", async () => {
  await assert.rejects(collect([account, { data: [], paging: { next: next("A").next } }]), /meta_pagination_invalid/);
  await assert.rejects(collect([account, { data: [], paging: { ...next("A"), cursors: { after: "B" } } }]), /meta_pagination_invalid/);
  await assert.rejects(collect([account, { data: [], paging: next("A") }, { data: [], paging: next("A") }]), /meta_pagination_invalid/);
});
test("pagination safety limit aborts whole import", async () => {
  await assert.rejects(collect([account, ...Array.from({ length: 10 }, (_, i) => ({ data: [], paging: next(`C${i}`) }))]), /meta_pagination_invalid/);
});
test("account ID/currency/timezone mismatch blocks insights entirely", async () => {
  for (const [key, value, code] of [["id", "act_999", "account"], ["account_id", "999", "account"], ["currency", "USD", "currency"], ["timezone_name", "America/New_York", "timezone"]]) {
    const m = mock([{ ...account, [key]: value }]);
    await assert.rejects(fetchMetaAdSpendSnapshot(env, { now, fetchImpl: m.fetchImpl }), new RegExp(`meta_${code}_mismatch`));
    assert.equal(m.calls.length, 1);
  }
});
test("foreign insight account or currency rejects full snapshot", async () => {
  await assert.rejects(collect([account, { data: [{ ...row(), account_id: "999" }] }]), /meta_account_mismatch/);
  await assert.rejects(collect([account, { data: [{ ...row(), account_currency: "USD" }] }]), /meta_currency_mismatch/);
});
test("duplicate, out-of-window, malformed or non-daily dates are rejected", async () => {
  for (const data of [[row(), row()], [row("2026-10-09")], [row("2026-09-08")], [row("2026-02-30")], [{ ...row(), date_stop: "2026-10-09" }]]) {
    await assert.rejects(collect([account, { data }]), /meta_response_invalid/);
  }
});
test("campaign/ad-set/ad rows cannot masquerade as account total", async () => {
  for (const key of ["campaign_id", "adset_id", "ad_id"]) {
    await assert.rejects(collect([account, { data: [{ ...row(), [key]: "123" }] }]), /meta_response_invalid/);
  }
});
test("spend parsing never rounds silently or accepts negative/malformed values", async () => {
  for (const spend of ["-1", "1e3", "NaN", "1.234", 12.34, "", " 1.00", "99999999999999999999"]) {
    await assert.rejects(collect([account, { data: [row("2026-10-08", spend)] }]), /meta_spend_invalid/);
  }
  const { result } = await collect([account, { data: [row("2026-10-08", "0.01")] }]);
  assert.equal(result.days.at(-1).spend_minor, 1);
});
test("partial second-page API or network failure returns no snapshot", async () => {
  await assert.rejects(collect([account, { data: [row()], paging: next("A") }, new Response("private provider details", { status: 500 })]), /meta_api_unavailable/);
  await assert.rejects(collect([account, { data: [row()], paging: next("A") }, new Error("token PRIVATE")]), /meta_network_unavailable/);
});
test("successful HTTP with upstream error, malformed JSON/data or oversized body fails", async () => {
  for (const value of [{ error: { message: "PRIVATE" } }, { data: null }, new Response("{bad"), new Response("x".repeat(131073))]) {
    await assert.rejects(collect([account, value]), /meta_(?:api_unavailable|response_invalid)/);
  }
});
test("explicit API version and access token are mandatory before network access", async () => {
  for (const config of [{}, { ...env, META_GRAPH_API_VERSION: "" }, { ...env, META_GRAPH_API_VERSION: "latest" }, { ...env, META_ADS_INSIGHTS_ACCESS_TOKEN: "short" }]) {
    const m = mock([]);
    await assert.rejects(fetchMetaAdSpendSnapshot(config, { now, fetchImpl: m.fetchImpl }), /meta_configuration_unavailable/);
    assert.equal(m.calls.length, 0);
  }
});
test("optional app secret proof is correct and never uses a query access token", async () => {
  const secret = "test-app-secret-".repeat(4);
  const { calls } = await collect([account, { data: [] }], { ...env, META_ADS_INSIGHTS_APP_SECRET: secret });
  const expected = createHmac("sha256", secret).update(env.META_ADS_INSIGHTS_ACCESS_TOKEN).digest("hex");
  for (const call of calls) {
    assert.equal(call.url.searchParams.get("appsecret_proof"), expected);
    assert.equal(call.url.toString().includes(env.META_ADS_INSIGHTS_ACCESS_TOKEN), false);
  }
});
test("only bounded fixed error codes can leave the collector", () => {
  assert.equal(safeMetaErrorCode(new Error("PRIVATE token")), "meta_api_unavailable");
  assert.equal(safeMetaErrorCode({ code: "token=PRIVATE" }), "meta_api_unavailable");
  assert.equal(safeMetaErrorCode({ code: "meta_currency_mismatch" }), "meta_currency_mismatch");
});
test("worker source has no public trigger, uses scheduled handler and reviewed daily cron", async () => {
  const source = await readFile(new URL("../workers/accounting-meta/index.js", import.meta.url), "utf8");
  const config = await readFile(new URL("../workers/accounting-meta/wrangler.toml", import.meta.url), "utf8");
  assert.match(source, /async scheduled\(/); assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(config, /crons = \["45 5 \* \* \*"\]/); assert.match(config, /workers_dev = false/);
  assert.doesNotMatch(config, /^META_GRAPH_API_VERSION\s*=\s*/m);
  assert.equal(worker.fetch, undefined);
});
test("worker persists complete snapshot once, delegates idempotency and records no false failure", async () => {
  const calls = [];
  const { result: snapshot } = await collect([account, { data: [row()] }]);
  const expected = { ok: true, run_id: "fixture", days_received: 30, days_imported: 30 };
  const result = await runAccountingMetaSync({ DB: "fixture-db" }, {
    now, fetchSnapshot: async () => snapshot,
    persist: async (...args) => { calls.push(args); return expected; },
    recordFailure: async () => assert.fail("No failure for complete success"),
  });
  assert.deepEqual(result, expected); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "fixture-db"); assert.equal(calls[0][1], snapshot);
});
test("worker records fixed failure metadata without overwriting previous costs or leaking errors", async t => {
  const logged = []; t.mock.method(console, "error", value => logged.push(value));
  const receipts = [];
  await assert.rejects(runAccountingMetaSync({ DB: "fixture-db" }, {
    now, fetchSnapshot: async () => { throw new Error("https://secret.example?token=PRIVATE"); },
    persist: async () => assert.fail("Failed fetch cannot persist zeros"),
    recordFailure: async (...args) => receipts.push(args),
  }), /^Error: meta_api_unavailable$/);
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0][1], { provider: "meta", from: "2026-09-09", to: "2026-10-08", source: "meta_insights", error_code: "meta_api_unavailable" });
  assert.doesNotMatch(JSON.stringify({ receipts, logged }), /PRIVATE|secret\.example/);
});
test("worker surfaces receipt failure using only fixed code", async t => {
  const logged = []; t.mock.method(console, "error", value => logged.push(value));
  await assert.rejects(runAccountingMetaSync({ DB: "fixture-db" }, {
    now, fetchSnapshot: async () => { throw new Error("upstream-private"); },
    recordFailure: async () => { throw new Error("database-private"); },
  }), /^Error: accounting_meta_receipt_unavailable$/);
  assert.doesNotMatch(JSON.stringify(logged), /upstream-private|database-private/);
});
