(function () {
  if (window.__EVLINE_CONTACT_TRACKING_LOADED__) return;
  window.__EVLINE_CONTACT_TRACKING_LOADED__ = true;

  function ensureMetaTracking() {
    if (window.__EVLINE_META_TRACKING_LOADED__ || document.querySelector("script[data-evline-meta-tracking]")) return;
    var script = document.createElement("script");
    script.src = "/assets/js/meta-tracking.js?v=20260730-consent-1";
    script.async = false;
    script.dataset.evlineMetaTracking = "";
    document.head.appendChild(script);
  }

  var VISITOR_KEY = "evline_visitor_id_v1";
  var SESSION_KEY = "evline_session_id_v1";
  var ATTRIBUTION_KEY = "evline_attribution_v1";
  var SESSION_ATTRIBUTION_KEY = "evline_tracking";
  var lastEvent = { key: "", at: 0 };

  function isPartsOrderingPage() {
    var path = window.location.pathname.toLowerCase();
    try {
      path = decodeURIComponent(path);
    } catch (_) {}

    return path === "/"
      || path === "/index.html"
      || path === "/ru/"
      || path === "/ru/index.html"
      || /(?:zapchast|запчаст|komplekty-to|комплект|spivpratsya-sto|sotrudnichestvo-sto)/i.test(path);
  }

  function ensureMinimumOrderNotice() {
    if (!isPartsOrderingPage() || document.querySelector("[data-minimum-order-notice]")) return;

    var isRu = document.documentElement.lang.toLowerCase().indexOf("ru") === 0
      || window.location.pathname.indexOf("/ru/") === 0;
    var title = isRu
      ? "Минимальная сумма заказа — $100"
      : "Мінімальна сума замовлення — $100";
    var explanation = isRu
      ? "Недорогие позиции можно объединить с другими запчастями или расходниками в одном заказе."
      : "Недорогі позиції можна об’єднати з іншими запчастинами або витратниками в одному замовленні.";

    if (!document.querySelector("style[data-minimum-order-styles]")) {
      var style = document.createElement("style");
      style.dataset.minimumOrderStyles = "";
      style.textContent = ""
        + ".evline-min-order{background:#14230d;border-top:1px solid rgba(132,204,22,.35);border-bottom:1px solid rgba(132,204,22,.35);color:#fff}"
        + ".evline-min-order__inner{max-width:1200px;margin:0 auto;padding:11px 24px;display:flex;align-items:center;justify-content:center;gap:10px 18px;text-align:center;line-height:1.35}"
        + ".evline-min-order__inner strong{color:#a3e635;font-size:1rem;white-space:nowrap}"
        + ".evline-min-order__inner span{color:rgba(255,255,255,.82);font-size:.92rem}"
        + ".evline-min-order-form-note{margin:10px 0;color:#a3e635;font-size:.9rem;font-weight:700;line-height:1.4}"
        + "@media (max-width:720px){.evline-min-order__inner{padding:10px 16px;display:block}.evline-min-order__inner strong,.evline-min-order__inner span{display:block}.evline-min-order__inner span{margin-top:3px}}";
      document.head.appendChild(style);
    }

    var notice = document.createElement("aside");
    notice.className = "evline-min-order";
    notice.dataset.minimumOrderNotice = "";
    notice.setAttribute("aria-label", title);
    var inner = document.createElement("div");
    inner.className = "evline-min-order__inner";
    var strong = document.createElement("strong");
    strong.textContent = title;
    var span = document.createElement("span");
    span.textContent = explanation;
    inner.appendChild(strong);
    inner.appendChild(span);
    notice.appendChild(inner);

    var header = document.querySelector("header");
    if (header && header.parentNode) header.parentNode.insertBefore(notice, header.nextSibling);
    else document.body.insertBefore(notice, document.body.firstChild);

    Array.prototype.forEach.call(document.querySelectorAll("form"), function (form) {
      var submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (!submit || form.querySelector("[data-minimum-order-form-note]")) return;
      var note = document.createElement("p");
      note.className = "evline-min-order-form-note";
      note.dataset.minimumOrderFormNote = "";
      note.textContent = title;
      submit.parentNode.insertBefore(note, submit);
    });
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "evl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function storageId(store, key) {
    try {
      var value = store.getItem(key);
      if (!value) {
        value = uuid();
        store.setItem(key, value);
      }
      return value;
    } catch (_) {
      return uuid();
    }
  }

  var identity = {
    visitor_id: storageId(window.localStorage, VISITOR_KEY),
    session_id: storageId(window.sessionStorage, SESSION_KEY),
  };

  function readStore(store, key) {
    try {
      return JSON.parse(store.getItem(key) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function writeStore(store, key, value) {
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function captureFreshPaidClick() {
    var params = new URLSearchParams(window.location.search);
    var hasMetaClick = Boolean(params.get("fbclid"));
    var hasGoogleClick = Boolean(params.get("gclid") || params.get("gbraid") || params.get("wbraid"));
    if (!hasMetaClick && !hasGoogleClick) return;

    var source = params.get("utm_source") || "";
    var medium = params.get("utm_medium") || "";
    if (hasMetaClick) {
      if (!source || /^(site|direct|google)$/i.test(source)) source = "meta";
      if (!medium || /^(cpc|ppc|paid|ads?)$/i.test(medium)) medium = "paid_social";
    } else {
      source = source || "google";
      medium = medium || "cpc";
    }

    var now = new Date().toISOString();
    var fresh = {
      utm_source: source,
      utm_medium: medium,
      utm_campaign: params.get("utm_campaign") || "",
      utm_term: params.get("utm_term") || "",
      utm_content: params.get("utm_content") || "",
      gclid: hasMetaClick ? "" : params.get("gclid") || "",
      gbraid: hasMetaClick ? "" : params.get("gbraid") || "",
      wbraid: hasMetaClick ? "" : params.get("wbraid") || "",
      fbclid: hasMetaClick ? params.get("fbclid") || "" : "",
      landing_page: window.location.href,
      page_url: window.location.href,
      referrer: document.referrer || "",
      tracking_captured_at: now,
      expires_at: Date.now() + 90 * 24 * 60 * 60 * 1000,
    };
    writeStore(window.localStorage, ATTRIBUTION_KEY, fresh);
    writeStore(window.sessionStorage, SESSION_ATTRIBUTION_KEY, fresh);
  }

  captureFreshPaidClick();
  ensureMetaTracking();
  ensureMinimumOrderNotice();

  function attribution() {
    var params = new URLSearchParams(window.location.search);
    var saved = readStore(window.localStorage, ATTRIBUTION_KEY);
    if (saved.expires_at && Number(saved.expires_at) < Date.now()) saved = {};
    if (!Object.keys(saved).length) saved = readStore(window.sessionStorage, SESSION_ATTRIBUTION_KEY);
    function pick(name) {
      return params.get(name) || saved[name] || "";
    }
    var result = {
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
      utm_term: pick("utm_term"),
      utm_content: pick("utm_content"),
      gclid: pick("gclid"),
      gbraid: pick("gbraid"),
      wbraid: pick("wbraid"),
      fbclid: pick("fbclid"),
      landing_page: saved.landing_page || window.location.href,
      referrer: saved.referrer || document.referrer || "",
      page_url: window.location.href,
      tracking_captured_at: saved.tracking_captured_at || new Date().toISOString(),
    };
    if (params.get("fbclid")) {
      if (!params.get("utm_source") || /^(site|direct|google)$/i.test(result.utm_source)) result.utm_source = "meta";
      if (!params.get("utm_medium") || /^(cpc|ppc|paid|ads?)$/i.test(result.utm_medium)) result.utm_medium = "paid_social";
      result.gclid = "";
      result.gbraid = "";
      result.wbraid = "";
    } else if (params.get("gclid") || params.get("gbraid") || params.get("wbraid")) {
      result.fbclid = "";
    }
    return result;
  }

  function endpoint() {
    if (window.EVLINE_CONTACT_EVENT_ENDPOINT) return window.EVLINE_CONTACT_EVENT_ENDPOINT;
    if (window.location.hostname === "jv4043245.github.io") {
      return "https://evline.pages.dev/api/contact-events";
    }
    return "/api/contact-events";
  }

  function channelFromHref(href) {
    var value = String(href || "").toLowerCase();
    if (/^(https?:\/\/)?(t\.me\/|telegram\.me\/)|^tg:/.test(value)) return "telegram";
    if (value.indexOf("tel:") === 0) return "phone";
    if (value.indexOf("mailto:") === 0) return "email";
    if (/wa\.me\/|whatsapp:/.test(value)) return "whatsapp";
    if (value.indexOf("viber:") === 0) return "viber";
    return "";
  }

  function intentFromContext(href) {
    var signal = (window.location.pathname + " " + String(href || "")).toLowerCase();
    if (/evline_tech|\/byd|zeekr|program|programuv|програм|оновлен|diagnost|діагност/.test(signal)) return "byd";
    if (/komplekty-to|komplekty_to|комплект.*то/.test(signal)) return "to";
    if (/spivpratsya-sto|sotrudnichestvo-sto|для-сто/.test(signal)) return "sto";
    if (/evline_support|zapchast|запчаст|parts/.test(signal)) return "parts";
    return "general";
  }

  function cleanDestination(href, channel) {
    var value = String(href || "");
    if (channel === "telegram") {
      var match = value.match(/(?:t\.me\/|telegram\.me\/)([^/?#]+)/i);
      return match ? "@" + match[1].replace(/^@/, "") : "telegram";
    }
    return value.split("?")[0].slice(0, 240);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function elementDetails(element, channel) {
    if (!element) return {};
    var text = normalizeText(element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent);
    return {
      cta_id: element.dataset.contactId || element.dataset.ctaId || element.id || channel + ":" + text.toLowerCase().slice(0, 80),
      cta_text: text,
    };
  }

  function send(payload) {
    fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});
  }

  function track(options) {
    options = options || {};
    var channel = options.channel || channelFromHref(options.href || options.destination);
    if (!channel) return;
    var href = options.href || options.destination || "";
    var details = elementDetails(options.element, channel);
    var payload = Object.assign({}, attribution(), identity, details, options, {
      id: options.id || uuid(),
      event_type: "contact_click",
      channel: channel,
      intent_type: options.intent_type || intentFromContext(href),
      destination: options.destination || cleanDestination(href, channel),
      language: document.documentElement.lang || "",
    });
    delete payload.element;
    delete payload.href;

    var duplicateKey = [payload.channel, payload.intent_type, payload.cta_id || payload.cta_text].join("|");
    var now = Date.now();
    if (lastEvent.key === duplicateKey && now - lastEvent.at < 750) return;
    lastEvent = { key: duplicateKey, at: now };

    send(payload);
    if (window.EVLineMetaTracking) {
      window.EVLineMetaTracking.trackContact({
        event_id: payload.id,
        channel: payload.channel,
        intent_type: payload.intent_type,
      });
    } else if (marketingConsentGranted()) {
      window.__EVLINE_PENDING_META_CONTACTS__ = window.__EVLINE_PENDING_META_CONTACTS__ || [];
      window.__EVLINE_PENDING_META_CONTACTS__.push({
        event_id: payload.id,
        channel: payload.channel,
        intent_type: payload.intent_type,
      });
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "evline_contact_click",
      contact_channel: payload.channel,
      contact_intent: payload.intent_type,
      contact_cta: payload.cta_id || payload.cta_text || "",
    });
  }

  function enrich(payload) {
    return Object.assign({}, payload || {}, identity);
  }

  function marketingConsentGranted() {
    try {
      var consent = JSON.parse(window.localStorage.getItem("evline_privacy_consent_v1") || "{}");
      return consent.version === "2026-07-30" && consent.marketing === true;
    } catch (_) {
      return false;
    }
  }

  function prepareMetaLead(payload) {
    var prepared = payload || {};
    if (window.EVLineMetaTracking) return window.EVLineMetaTracking.prepareLeadPayload(prepared);
    if (!prepared.meta_event_id) prepared.meta_event_id = "evline-lead-" + uuid();
    prepared.marketing_consent = marketingConsentGranted() ? 1 : 0;
    prepared.consent_version = "2026-07-30";
    try {
      var consent = JSON.parse(window.localStorage.getItem("evline_privacy_consent_v1") || "{}");
      prepared.marketing_consent_at = consent.decided_at || "";
    } catch (_) {}
    return prepared;
  }

  function trackMetaLead(payload) {
    if (window.EVLineMetaTracking) {
      window.EVLineMetaTracking.trackLead(payload);
      return;
    }
    window.__EVLINE_PENDING_META_LEADS__ = window.__EVLINE_PENDING_META_LEADS__ || [];
    window.__EVLINE_PENDING_META_LEADS__.push(payload);
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!target || target.dataset.contactTrack === "false") return;
    var href = target.getAttribute("href") || "";
    var channel = channelFromHref(href);
    if (!channel) return;
    track({ channel: channel, href: href, element: target });
  }, true);

  if (typeof window.trackingPayload === "function" && !window.trackingPayload.__evlineIdentityWrapped) {
    var originalTrackingPayload = window.trackingPayload;
    var wrappedTrackingPayload = function () {
      return prepareMetaLead(enrich(originalTrackingPayload.apply(this, arguments)));
    };
    wrappedTrackingPayload.__evlineIdentityWrapped = true;
    window.trackingPayload = wrappedTrackingPayload;
  }

  if (typeof window.trackLeadSubmit === "function" && !window.trackLeadSubmit.__evlineMetaWrapped) {
    var originalTrackLeadSubmit = window.trackLeadSubmit;
    var wrappedTrackLeadSubmit = function (payload) {
      var prepared = prepareMetaLead(payload || {});
      var result = originalTrackLeadSubmit.call(this, prepared);
      trackMetaLead(prepared);
      return result;
    };
    wrappedTrackLeadSubmit.__evlineMetaWrapped = true;
    window.trackLeadSubmit = wrappedTrackLeadSubmit;
  }

  if (typeof window.openTelegramMsg === "function" && !window.openTelegramMsg.__evlineContactWrapped) {
    var originalOpenTelegramMsg = window.openTelegramMsg;
    var wrappedOpenTelegramMsg = function () {
      var intent = intentFromContext(window.location.pathname);
      if (intent === "general") intent = "parts";
      track({
        channel: "telegram",
        intent_type: intent,
        destination: intent === "byd" ? "@evline_tech" : "@evline_support",
        cta_id: "programmatic-telegram",
        cta_text: normalizeText(document.activeElement && document.activeElement.textContent),
      });
      return originalOpenTelegramMsg.apply(this, arguments);
    };
    wrappedOpenTelegramMsg.__evlineContactWrapped = true;
    window.openTelegramMsg = wrappedOpenTelegramMsg;
  }

  window.EVLineContactTracking = { track: track, enrich: enrich, identity: identity };
  (window.__EVLINE_PENDING_CONTACT_EVENTS__ || []).splice(0).forEach(track);
})();
