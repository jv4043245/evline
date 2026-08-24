(function () {
  if (window.__EVLINE_META_TRACKING_LOADED__) return;
  window.__EVLINE_META_TRACKING_LOADED__ = true;

  var PIXEL_ID = "1331659882333207";
  var CONSENT_KEY = "evline_privacy_consent_v1";
  var CONSENT_VERSION = "2026-07-30";
  var ATTRIBUTION_KEY = "evline_attribution_v1";
  var PRODUCTION_HOSTS = new Set(["evline.com.ua", "www.evline.com.ua"]);
  var sentEvents = new Set();
  var pixelStarted = false;
  var pageEventsStarted = false;

  function safeJson(value, fallback) {
    try {
      return JSON.parse(value) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readConsent() {
    try {
      var record = safeJson(window.localStorage.getItem(CONSENT_KEY), {});
      return record.version === CONSENT_VERSION ? record : {};
    } catch (_) {
      return {};
    }
  }

  function marketingConsentGranted() {
    return readConsent().marketing === true;
  }

  function consentFields() {
    var record = readConsent();
    return {
      marketing_consent: record.marketing === true ? 1 : 0,
      marketing_consent_at: record.decided_at || "",
      consent_version: record.version || CONSENT_VERSION,
    };
  }

  function saveConsent(marketing) {
    var record = {
      necessary: true,
      marketing: Boolean(marketing),
      decided_at: new Date().toISOString(),
      version: CONSENT_VERSION,
    };
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
    } catch (_) {}
    return record;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function eventId(eventName) {
    return "evline-" + String(eventName || "event").toLowerCase() + "-" + uuid();
  }

  function cookie(name) {
    var prefix = name + "=";
    var values = String(document.cookie || "").split(";");
    for (var index = 0; index < values.length; index += 1) {
      var item = values[index].trim();
      if (item.indexOf(prefix) === 0) return decodeURIComponent(item.slice(prefix.length));
    }
    return "";
  }

  function savedAttribution() {
    try {
      return safeJson(window.localStorage.getItem(ATTRIBUTION_KEY), {});
    } catch (_) {
      return {};
    }
  }

  function facebookClickId() {
    var params = new URLSearchParams(window.location.search);
    return params.get("fbclid") || savedAttribution().fbclid || "";
  }

  function fbcValue() {
    var value = cookie("_fbc");
    if (value) return value;
    var fbclid = facebookClickId();
    if (!fbclid) return "";
    var captured = Date.parse(savedAttribution().tracking_captured_at || "");
    var createdAt = Number.isFinite(captured) ? captured : Date.now();
    return "fb.1." + createdAt + "." + fbclid;
  }

  function attributionFields() {
    if (!marketingConsentGranted()) {
      return Object.assign({ fbp: "", fbc: "" }, consentFields());
    }
    return Object.assign(
      {
        fbp: cookie("_fbp"),
        fbc: fbcValue(),
      },
      consentFields()
    );
  }

  function prepareLeadPayload(payload) {
    var prepared = payload || {};
    if (!prepared.meta_event_id) prepared.meta_event_id = eventId("lead");
    return Object.assign(prepared, attributionFields());
  }

  function isProductionHost() {
    return PRODUCTION_HOSTS.has(window.location.hostname) || window.EVLINE_META_ALLOW_NON_PRODUCTION === true;
  }

  function installFbq() {
    if (typeof window.fbq === "function") return;
    var fbq = function () {
      fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
  }

  function startPixel() {
    if (pixelStarted || !marketingConsentGranted() || !isProductionHost()) return false;
    pixelStarted = true;
    installFbq();

    var script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    document.head.appendChild(script);

    window.fbq("init", PIXEL_ID);
    trackPageEvents();
    return true;
  }

  function cleanToken(value, fallback) {
    var normalized = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    return normalized || fallback || "general";
  }

  function track(eventName, params, options) {
    options = options || {};
    if (!marketingConsentGranted() || !isProductionHost()) return false;
    startPixel();
    if (typeof window.fbq !== "function") return false;

    var id = options.eventID || eventId(eventName);
    var dedupeKey = eventName + "|" + id;
    if (sentEvents.has(dedupeKey)) return false;
    sentEvents.add(dedupeKey);
    window.fbq("track", eventName, params || {}, { eventID: id });
    return id;
  }

  function pageCategory() {
    var path = window.location.pathname.toLowerCase();
    if (/byd|zeekr|program|diagnost|kalibr|onovl|obnovl|multimedia|мультим|програм/.test(path)) return "vehicle_software";
    if (/komplekty-to/.test(path)) return "maintenance_parts";
    if (/spivpratsya-sto|sotrudnichestvo-sto/.test(path)) return "sto";
    if (/zapchast|запчаст|parts/.test(path) || path === "/" || path === "/ru/") return "vehicle_parts";
    return "general";
  }

  function shouldTrackViewContent() {
    var path = window.location.pathname.toLowerCase();
    return !/^\/(?:admin|supplier|test)(?:\/|$)/.test(path) &&
      !/404|hero-(?:photo-sets|visual)-test|програмування-byd/.test(path) &&
      !/^\/(?:ru\/)?privacy(?:\/|$)/.test(path);
  }

  function trackPageEvents() {
    if (pageEventsStarted || document.readyState === "loading") return;
    pageEventsStarted = true;
    track("PageView", {}, { eventID: eventId("pageview") });
    if (shouldTrackViewContent()) {
      track(
        "ViewContent",
        {
          content_category: pageCategory(),
          content_name: "evline_" + pageCategory(),
        },
        { eventID: eventId("viewcontent") }
      );
    }
  }

  function trackContact(options) {
    options = options || {};
    return track(
      "Contact",
      {
        content_category: cleanToken(options.intent_type, "general"),
        contact_method: cleanToken(options.channel, "contact"),
      },
      { eventID: options.event_id || eventId("contact") }
    );
  }

  function trackLead(payload) {
    payload = payload || {};
    if (!payload.meta_event_id) payload.meta_event_id = eventId("lead");
    return track(
      "Lead",
      {
        content_category: cleanToken(payload.type || payload.lead_type, "general"),
        content_name: cleanToken(payload.form_id, "website_lead"),
      },
      { eventID: payload.meta_event_id }
    );
  }

  function clearCookie(name) {
    var expires = "Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = name + "=; expires=" + expires + "; path=/; SameSite=Lax";
    if (window.location.hostname) {
      document.cookie = name + "=; expires=" + expires + "; path=/; domain=." + window.location.hostname.replace(/^www\./, "") + "; SameSite=Lax";
    }
  }

  function clearMetaCookies() {
    clearCookie("_fbp");
    clearCookie("_fbc");
  }

  function copy() {
    var isRu = (document.documentElement.lang || "").toLowerCase().startsWith("ru");
    return isRu
      ? {
          title: "Настройки конфиденциальности",
          body: "Meta Pixel загружается только с вашего разрешения. Он помогает измерять эффективность рекламы без передачи VIN или текста обращения.",
          accept: "Разрешить маркетинг",
          necessary: "Только необходимые",
          policy: "Политика конфиденциальности",
          settings: "Настройки cookies",
          policyHref: "/ru/privacy/",
        }
      : {
          title: "Налаштування конфіденційності",
          body: "Meta Pixel завантажується лише з вашого дозволу. Він допомагає вимірювати ефективність реклами без передачі VIN або тексту звернення.",
          accept: "Дозволити маркетинг",
          necessary: "Лише необхідні",
          policy: "Політика конфіденційності",
          settings: "Налаштування cookies",
          policyHref: "/privacy/",
        };
  }

  function injectConsentStyles() {
    if (document.getElementById("evline-consent-styles")) return;
    var style = document.createElement("style");
    style.id = "evline-consent-styles";
    style.textContent =
      ".evline-consent{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:720px;margin:auto;padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:#111513;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.35);font:14px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}" +
      ".evline-consent h2{margin:0 0 7px;font-size:18px}.evline-consent p{margin:0;color:#ced7d2}.evline-consent a{color:#8ee2b0}" +
      ".evline-consent__actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.evline-consent button{min-height:42px;padding:0 16px;border:1px solid #3fa66a;border-radius:999px;background:#3fa66a;color:#fff;font-weight:750;cursor:pointer}" +
      ".evline-consent button[data-consent=\"necessary\"]{background:transparent;color:#fff;border-color:#6f7c75}" +
      ".evline-consent-settings{position:fixed;z-index:2147482000;right:112px;bottom:16px;padding:8px 12px;border:1px solid #68746e;border-radius:999px;background:#111513;color:#fff;font:12px/1.2 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;cursor:pointer}" +
      "@media(max-width:560px){.evline-consent{left:10px;right:10px;bottom:10px}.evline-consent__actions{display:grid}.evline-consent button{width:100%}.evline-consent-settings{right:88px;bottom:18px}}";
    document.head.appendChild(style);
  }

  function settingsButton() {
    var existing = document.querySelector("[data-evline-consent-settings]");
    if (existing) return existing;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "evline-consent-settings";
    button.dataset.evlineConsentSettings = "";
    button.textContent = copy().settings;
    document.body.appendChild(button);
    return button;
  }

  function hideBanner() {
    var banner = document.getElementById("evline-consent");
    if (banner) banner.remove();
  }

  function decideConsent(marketing) {
    var previouslyGranted = marketingConsentGranted();
    saveConsent(marketing);
    hideBanner();
    settingsButton();
    if (marketing) {
      startPixel();
    } else {
      clearMetaCookies();
      if (previouslyGranted) window.location.reload();
    }
  }

  function showBanner() {
    hideBanner();
    injectConsentStyles();
    var labels = copy();
    var banner = document.createElement("section");
    banner.id = "evline-consent";
    banner.className = "evline-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-modal", "false");
    banner.setAttribute("aria-labelledby", "evline-consent-title");

    var title = document.createElement("h2");
    title.id = "evline-consent-title";
    title.textContent = labels.title;
    var body = document.createElement("p");
    body.textContent = labels.body + " ";
    var policy = document.createElement("a");
    policy.href = labels.policyHref;
    policy.textContent = labels.policy;
    body.appendChild(policy);

    var actions = document.createElement("div");
    actions.className = "evline-consent__actions";
    var accept = document.createElement("button");
    accept.type = "button";
    accept.dataset.consent = "marketing";
    accept.textContent = labels.accept;
    var necessary = document.createElement("button");
    necessary.type = "button";
    necessary.dataset.consent = "necessary";
    necessary.textContent = labels.necessary;
    actions.append(accept, necessary);
    banner.append(title, body, actions);
    document.body.appendChild(banner);
    accept.focus({ preventScroll: true });
  }

  function initConsentUi() {
    injectConsentStyles();
    var record = readConsent();
    if (typeof record.marketing !== "boolean") {
      showBanner();
    } else {
      settingsButton();
      if (record.marketing) startPixel();
    }
  }

  document.addEventListener("click", function (event) {
    var settings = event.target && event.target.closest ? event.target.closest("[data-evline-consent-settings]") : null;
    if (settings) {
      event.preventDefault();
      showBanner();
      return;
    }
    var choice = event.target && event.target.closest ? event.target.closest("[data-consent]") : null;
    if (!choice || !choice.closest("#evline-consent")) return;
    decideConsent(choice.dataset.consent === "marketing");
  });

  function onReady() {
    initConsentUi();
    if (marketingConsentGranted()) {
      startPixel();
      trackPageEvents();
    }
  }

  window.EVLineMetaTracking = {
    pixelId: PIXEL_ID,
    consentVersion: CONSENT_VERSION,
    consentFields: consentFields,
    hasMarketingConsent: marketingConsentGranted,
    prepareLeadPayload: prepareLeadPayload,
    track: track,
    trackContact: trackContact,
    trackLead: trackLead,
    showConsentSettings: showBanner,
  };

  (window.__EVLINE_PENDING_META_CONTACTS__ || []).splice(0).forEach(trackContact);
  (window.__EVLINE_PENDING_META_LEADS__ || []).splice(0).forEach(trackLead);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  } else {
    onReady();
  }
})();
