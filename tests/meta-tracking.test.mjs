import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

import { inferAttribution } from "../functions/_lib/attribution.js";
import { normalizeLead } from "../functions/api/leads.js";

const metaSource = await readFile(new URL("../assets/js/meta-tracking.js", import.meta.url), "utf8");

function request() {
  return new Request("https://evline.com.ua/api/leads", {
    headers: { referer: "https://evline.com.ua/" },
  });
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function element(tagName, registry) {
  return {
    tagName: String(tagName || "").toUpperCase(),
    children: [],
    dataset: {},
    attributes: {},
    parentNode: null,
    textContent: "",
    className: "",
    _id: "",
    set id(value) {
      this._id = value;
      if (value) registry.set(value, this);
    },
    get id() {
      return this._id;
    },
    append(...nodes) {
      nodes.forEach((node) => {
        if (node && typeof node === "object") node.parentNode = this;
        this.children.push(node);
      });
    },
    appendChild(node) {
      this.append(node);
      return node;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    remove() {
      if (this._id) registry.delete(this._id);
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
    },
    focus() {},
    closest() {
      return null;
    },
  };
}

function metaContext(consentRecord) {
  const registry = new Map();
  const appendedScripts = [];
  const listeners = new Map();
  const localStorage = storage(
    consentRecord
      ? { evline_privacy_consent_v1: JSON.stringify(consentRecord) }
      : {}
  );
  const document = {
    readyState: "complete",
    cookie: "",
    documentElement: { lang: "uk-UA" },
    head: element("head", registry),
    body: element("body", registry),
    createElement(tagName) {
      return element(tagName, registry);
    },
    getElementById(id) {
      return registry.get(id) || null;
    },
    querySelector(selector) {
      if (selector === "[data-evline-consent-settings]") {
        return document.body.children.find((item) => Object.hasOwn(item.dataset || {}, "evlineConsentSettings")) || null;
      }
      return null;
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
  };
  const originalAppend = document.head.appendChild.bind(document.head);
  document.head.appendChild = (node) => {
    if (node.tagName === "SCRIPT") appendedScripts.push(node);
    return originalAppend(node);
  };

  const window = {
    document,
    localStorage,
    location: {
      hostname: "evline.com.ua",
      pathname: "/",
      search: "",
      reload() {},
    },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
  };
  window.window = window;

  vm.runInNewContext(metaSource, {
    window,
    document,
    localStorage,
    URLSearchParams,
    Set,
    Date,
    Math,
    JSON,
    decodeURIComponent,
  }, { filename: "meta-tracking.js" });

  return { window, appendedScripts };
}

test("fresh Meta click wins over stale Google attribution", () => {
  const attribution = inferAttribution(
    {
      fbclid: "fresh-meta-click",
      gclid: "stale-google-click",
      source: "google",
      medium: "cpc",
      page_url: "https://evline.com.ua/?fbclid=fresh-meta-click",
    },
    request()
  );
  assert.equal(attribution.source, "meta");
  assert.equal(attribution.medium, "paid_social");
  assert.equal(attribution.gclid, "");
  assert.equal(attribution.attribution_type, "social");
});

test("Google click remains Google without a Meta click", () => {
  const attribution = inferAttribution(
    {
      gclid: "google-click",
      page_url: "https://evline.com.ua/?gclid=google-click",
    },
    request()
  );
  assert.equal(attribution.source, "google");
  assert.equal(attribution.gclid, "google-click");
  assert.equal(attribution.attribution_type, "google_ads");
});

test("CRM accepts Meta identifiers only with marketing consent", () => {
  const withoutConsent = normalizeLead(
    { phone: "+380000000000", fbp: "fb.1.browser", fbc: "fb.1.click", marketing_consent: 0 },
    request()
  );
  assert.equal(withoutConsent.fbp, "");
  assert.equal(withoutConsent.fbc, "");

  const withConsent = normalizeLead(
    { phone: "+380000000000", fbp: "fb.1.browser", fbc: "fb.1.click", marketing_consent: true },
    request()
  );
  assert.equal(withConsent.fbp, "fb.1.browser");
  assert.equal(withConsent.fbc, "fb.1.click");
});

test("Pixel is not requested before marketing consent", () => {
  const context = metaContext(null);
  assert.equal(
    context.appendedScripts.some((script) => script.src === "https://connect.facebook.net/en_US/fbevents.js"),
    false
  );
  assert.equal(typeof context.window.fbq, "undefined");
});

test("Pixel starts and emits non-PII page events after consent", () => {
  const context = metaContext({
    necessary: true,
    marketing: true,
    decided_at: "2026-07-30T10:00:00.000Z",
    version: "2026-07-30",
  });
  const queued = Array.from(context.window.fbq.queue, (entry) => Array.from(entry));
  assert.equal(queued.some((entry) => entry[0] === "init" && entry[1] === "1331659882333207"), true);
  assert.equal(queued.some((entry) => entry[0] === "track" && entry[1] === "PageView"), true);
  assert.equal(queued.some((entry) => entry[0] === "track" && entry[1] === "ViewContent"), true);
  assert.equal(queued.some((entry) => /vin|phone|email|message/i.test(JSON.stringify(entry))), false);
});

test("Contact and Lead keep event IDs, dedupe, and exclude PII", () => {
  const context = metaContext({
    necessary: true,
    marketing: true,
    decided_at: "2026-07-30T10:00:00.000Z",
    version: "2026-07-30",
  });
  const tracking = context.window.EVLineMetaTracking;
  tracking.trackContact({ event_id: "contact-id", channel: "telegram", intent_type: "parts", phone: "+380000000000" });
  tracking.trackContact({ event_id: "contact-id", channel: "telegram", intent_type: "parts" });
  tracking.trackLead({ meta_event_id: "lead-id", type: "parts", form_id: "parts_form", vin: "PRIVATEVIN" });
  tracking.trackLead({ meta_event_id: "lead-id", type: "parts", form_id: "parts_form" });

  const queued = Array.from(context.window.fbq.queue, (entry) => Array.from(entry));
  assert.equal(queued.filter((entry) => entry[0] === "track" && entry[1] === "Contact").length, 1);
  assert.equal(queued.filter((entry) => entry[0] === "track" && entry[1] === "Lead").length, 1);
  assert.equal(/\+380000000000|PRIVATEVIN/.test(JSON.stringify(queued)), false);
});
