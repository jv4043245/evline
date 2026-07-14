(function () {
  if (window.__EVLINE_CONTACT_TRACKING_LOADED__) return;
  window.__EVLINE_CONTACT_TRACKING_LOADED__ = true;

  var VISITOR_KEY = "evline_visitor_id_v1";
  var SESSION_KEY = "evline_session_id_v1";
  var ATTRIBUTION_KEY = "evline_attribution_v1";
  var SESSION_ATTRIBUTION_KEY = "evline_tracking";
  var lastEvent = { key: "", at: 0 };

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

  function attribution() {
    var params = new URLSearchParams(window.location.search);
    var saved = readStore(window.localStorage, ATTRIBUTION_KEY);
    if (saved.expires_at && Number(saved.expires_at) < Date.now()) saved = {};
    if (!Object.keys(saved).length) saved = readStore(window.sessionStorage, SESSION_ATTRIBUTION_KEY);
    function pick(name) {
      return params.get(name) || saved[name] || "";
    }
    return {
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
      return enrich(originalTrackingPayload.apply(this, arguments));
    };
    wrappedTrackingPayload.__evlineIdentityWrapped = true;
    window.trackingPayload = wrappedTrackingPayload;
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
