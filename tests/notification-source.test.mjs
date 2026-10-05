import assert from "node:assert/strict";
import { test } from "node:test";
import { notificationSource } from "../functions/_lib/notification-source.js";
import { inferAttribution } from "../functions/_lib/attribution.js";
import { buildManagerOrderMessage, sendManagerOrderNotification } from "../functions/_lib/crm.js";
import { onRequestPost } from "../functions/api/leads.js";

const cases = [
  [{ source: "google", medium: "cpc" }, "Google — реклама"],
  [{ source: "Google", medium: "PAID_SEARCH" }, "Google — реклама"],
  [{ gclid: "test", referrer: "https://www.google.com/" }, "Google — реклама"],
  [{ gbraid: "test" }, "Google — реклама"],
  [{ wbraid: "test" }, "Google — реклама"],
  [{ has_google_click: true }, "Google — реклама"],
  [{ attribution_type: "google_ads" }, "Google — реклама"],
  [{ source: "google", medium: "organic" }, "Google — пошук"],
  [{ referrer: "https://www.google.com.ua/search?q=bumper" }, "Google — пошук"],
  [{ source: "site", referrer: "https://www.google.pl/" }, "Google — пошук"],
  [{ source: "google" }, "Google"],
  [{ source: "facebook", medium: "paid_social" }, "Facebook"],
  [{ source: " FB ", medium: "social" }, "Facebook"],
  [{ source: "fb", gclid: "stale", attribution_type: "social" }, "Facebook"],
  [{ source: "instagram" }, "Instagram"],
  [{ source: "ig", fbclid: "test" }, "Instagram"],
  [{ source: "https://l.facebook.com/" }, "Facebook"],
  [{ source: "site", referrer: "https://l.instagram.com/" }, "Instagram"],
  [{ fbclid: "test" }, "Meta (Facebook / Instagram)"],
  [{ source: "meta", medium: "paid_social" }, "Meta (Facebook / Instagram)"],
  [{ fbclid: "test", gclid: "stale", referrer: "https://google.com/" }, "Meta (Facebook / Instagram)"],
  [{ source: "meta", fbclid: "test", referrer: "https://m.facebook.com/" }, "Facebook"],
  [{ source: "telegram", medium: "business_chat" }, "Telegram"],
  [{ referrer: "https://t.me/example" }, "Telegram"],
  [{ source: "tiktok", medium: "cpc" }, "TikTok"],
  [{ referrer: "https://www.youtube.com/" }, "YouTube"],
  [{ source: "bing", medium: "organic" }, "Bing — пошук"],
  [{ source: "bing", medium: "ppc" }, "Bing — реклама"],
  [{ source: "newsletter", referrer: "https://google.com/" }, "Email"],
  [{ source: "phone", attribution_type: "manual" }, "Телефон"],
  [{ attribution_type: "manual" }, "Внесено вручну"],
  [{ source: "manual", medium: "manual", attribution_type: "manual" }, "Внесено вручну"],
  [{ source: "site", attribution_type: "direct" }, "Прямий / невідомий"],
  [{ source: "direct" }, "Прямий / невідомий"],
  [{ referrer: "https://www.evline.com.ua/ru/" }, "Прямий / невідомий"],
  [{ referrer: "https://test.evline.pages.dev/" }, "Прямий / невідомий"],
  [{ referrer: "https://example.org/" }, "Перехід з іншого сайту"],
  [{ source: "unknown", medium: "ppc" }, "Реклама (джерело невідоме)"],
  [{ medium: "organic" }, "Пошук (система невідома)"],
  [{ attribution_type: "social" }, "Соцмережі"],
  [{ source: "strange\nFAKE_SOURCE" }, "Інше джерело"],
  [{ referrer: "https://example.org/?facebook.com&google.com" }, "Перехід з іншого сайту"],
  [{ referrer: "https://facebook.com.example.org/" }, "Перехід з іншого сайту"],
  [{ referrer: "https://google.com.example.org/" }, "Перехід з іншого сайту"],
  [{ referrer: "https://google.evil/" }, "Перехід з іншого сайту"],
  [{ referrer: "javascript:facebook.com" }, "Невідомо"],
  [{ referrer: "not-a-url" }, "Невідомо"],
  [{}, "Невідомо"],
];

for (const [record, expected] of cases) {
  test(`source label: ${JSON.stringify(record)} → ${expected}`, () => {
    const original = JSON.stringify(record);
    assert.equal(notificationSource(Object.freeze(record)), expected);
    assert.equal(JSON.stringify(record), original);
    assert.doesNotMatch(notificationSource(record), /[\r\n]/);
  });
}

test("normalization does not turn fbclid alone into a Facebook/paid claim in notifications", () => {
  const normalized = inferAttribution({ fbclid: "synthetic-only" }, new Request("https://evline.com.ua/api/leads"));
  assert.equal(notificationSource(normalized), "Meta (Facebook / Instagram)");
});

test("bare Google UTM remains Google without claiming paid or organic search", () => {
  const normalized = inferAttribution({ utm_source: "google" }, new Request("https://evline.com.ua/api/leads"));
  assert.equal(notificationSource(normalized), "Google");
});

test("manual contact channels do not pretend to identify marketing acquisition", () => {
  for (const medium of ["phone", "email", "viber", "telegram", "instagram", "other", "china-preorder"]) {
    const label = notificationSource({ source: "manual", medium, attribution_type: "manual" });
    assert.equal(label, "Внесено вручну");
  }
});

test("both Google Ads URL markers survive normalization as paid labels", () => {
  for (const marker of ["gad_source", "gad_campaignid"]) {
    const normalized = inferAttribution({ landing_page: `https://evline.com.ua/?${marker}=123` }, new Request("https://evline.com.ua/api/leads"));
    assert.equal(notificationSource(normalized), "Google — реклама");
  }
});

test("parts, programming and resend message have exactly one short source line", () => {
  for (const type of ["parts", "byd"]) {
    const message = buildManagerOrderMessage({ type, source: "google", medium: "cpc", customer_phone: "+380000000000", item_name: "test part", campaign: "PRIVATE_CAMPAIGN", gclid: "PRIVATE_CLICK" }, "https://evline.com.ua", "Повторне сповіщення");
    assert.equal(message.split("\n").filter(line => line.startsWith("Джерело:")).length, 1);
    assert.match(message, /Джерело: Google — реклама\n/);
    assert.match(message, /Телефон: \+380000000000/);
    assert.match(message, /Адмінка: https:\/\/evline.com.ua\/admin\//);
    assert.doesNotMatch(message, /PRIVATE_CAMPAIGN|PRIVATE_CLICK/);
  }
});

test("manager sender sends the source line to the existing channel (mock Telegram only)", async t => {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.telegram.org/botTEST_TOKEN/sendMessage");
    sent.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: { message_id: 123 } });
  });
  await sendManagerOrderNotification({ TELEGRAM_BOT_TOKEN: "TEST_TOKEN", TELEGRAM_PARTS_CHAT_ID: "TEST_PARTS" }, { type: "parts", source: "fb" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, "TEST_PARTS");
  assert.match(sent[0].text, /Джерело: Facebook\n/);
});

test("lead-only fallback also sends one source line if CRM order creation fails (fully mocked)", async t => {
  const sent = [];
  const logged = [];
  t.mock.method(console, "error", (...args) => logged.push(args));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://api.telegram.org/botTEST_TOKEN/sendMessage");
    sent.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: { message_id: 124 } });
  });
  const db = {
    prepare(sql) {
      if (/FROM customers/.test(sql)) throw new Error("Synthetic order creation failure");
      const statement = {
        bind() { return statement; },
        async run() { return { success: true }; },
        async first() { return { value: 1 }; },
        async all() { return { results: ["id", "source", "medium", "phone"].map(name => ({ name })) }; },
      };
      return statement;
    },
  };
  const response = await onRequestPost({
    env: { DB: db, TELEGRAM_BOT_TOKEN: "TEST_TOKEN", TELEGRAM_PARTS_CHAT_ID: "TEST_PARTS" },
    request: new Request("https://evline.com.ua/api/leads", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "parts", phone: "+380000000000", part: "test part", utm_source: "google", utm_medium: "organic" }),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).order_id, "");
  assert.equal(logged.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, "TEST_PARTS");
  assert.equal(sent[0].text.split("\n").filter(line => line.startsWith("Джерело:")).length, 1);
  assert.match(sent[0].text, /Джерело: Google — пошук\n/);
});
