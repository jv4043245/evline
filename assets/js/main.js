function ensureCoreNavItems() {
  document.querySelectorAll(".nav").forEach((nav) => {
    const links = Array.from(nav.querySelectorAll("a"));
    if (links.length < 2) return;

    const text = document.documentElement.lang.toLowerCase();
    const isRu = text.startsWith("ru") || window.location.pathname.startsWith("/ru/");
    const hasStoItem = links.some((link) => {
      const value = `${link.textContent || ""} ${link.getAttribute("href") || ""}`;
      return /spivpratsya-sto|sotrudnichestvo-sto|для сто/i.test(value);
    });

    if (!hasStoItem) {
      const item = document.createElement("a");
      item.href = isRu ? "/ru/sotrudnichestvo-sto/" : "/spivpratsya-sto/";
      item.textContent = "Для СТО";
      links[1].after(item);
    }
  });
}

function ensureContactTracking() {
  if (window.__EVLINE_CONTACT_TRACKING_LOADED__ || document.querySelector('script[data-evline-contact-tracking]')) return;
  const script = document.createElement("script");
  script.src = "/assets/js/contact-tracking.js?v=20260715-contact-events";
  script.defer = true;
  script.dataset.evlineContactTracking = "";
  document.head.append(script);
}

ensureContactTracking();

ensureCoreNavItems();

const navToggle = document.querySelector("[data-nav-toggle]");
const siteNav = document.querySelector("#site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("nav-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });

  siteNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      document.body.classList.remove("nav-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

function closeLanguageSwitches(except) {
  document.querySelectorAll(".language-switch[open]").forEach((switcher) => {
    if (switcher !== except) switcher.removeAttribute("open");
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  const currentSwitch = target instanceof Element ? target.closest(".language-switch") : null;
  closeLanguageSwitches(currentSwitch);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLanguageSwitches();
});

function readTrackingStore(store, key) {
  try {
    return JSON.parse(store.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

function writeTrackingStore(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {}
}

function trackingData(form) {
  const params = new URLSearchParams(window.location.search);
  const now = new Date().toISOString();
  const storageKey = "evline_attribution_v1";
  const sessionKey = "evline_tracking";
  const ttlMs = 90 * 24 * 60 * 60 * 1000;
  const current = {
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_term: params.get("utm_term") || "",
    utm_content: params.get("utm_content") || "",
    gclid: params.get("gclid") || "",
    gbraid: params.get("gbraid") || "",
    wbraid: params.get("wbraid") || "",
    fbclid: params.get("fbclid") || "",
    landing_page: window.location.href,
    referrer: document.referrer,
    page_url: window.location.href,
    submitted_at: now,
    visitor_id: readOrCreateTrackingId(localStorage, "evline_visitor_id_v1"),
    session_id: readOrCreateTrackingId(sessionStorage, "evline_session_id_v1"),
  };
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid"];
  let saved = readTrackingStore(localStorage, storageKey);
  if (saved.expires_at && Number(saved.expires_at) < Date.now()) {
    saved = {};
  }
  if (!Object.keys(saved).length) saved = readTrackingStore(sessionStorage, sessionKey);

  const hasTracking = keys.some((key) => current[key]);
  if (hasTracking) {
    saved = {
      ...saved,
      ...current,
      landing_page: saved.landing_page || current.landing_page,
      referrer: saved.referrer || current.referrer || "",
      tracking_captured_at: saved.tracking_captured_at || now,
      expires_at: Date.now() + ttlMs,
    };
    writeTrackingStore(localStorage, storageKey, saved);
    writeTrackingStore(sessionStorage, sessionKey, saved);
  }
  keys.forEach((key) => {
    if (!current[key] && saved[key]) current[key] = saved[key];
  });
  current.landing_page = saved.landing_page || current.landing_page;
  current.referrer = saved.referrer || current.referrer || "";
  current.tracking_captured_at = saved.tracking_captured_at || now;
  current.page_url = window.location.href;
  current.submitted_at = now;
  if (form) {
    current.form_id = form.id || form.getAttribute("name") || "";
    current.form_name = form.dataset.formName || form.getAttribute("aria-label") || form.id || "";
  }
  return current;
}

function readOrCreateTrackingId(store, key) {
  try {
    let value = store.getItem(key);
    if (!value) {
      value = window.crypto?.randomUUID?.() || `evl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      store.setItem(key, value);
    }
    return value;
  } catch {
    return `evl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

trackingData();

function leadEndpoint() {
  if (window.EVLINE_LEAD_ENDPOINT) return window.EVLINE_LEAD_ENDPOINT;
  if (window.location.hostname === "jv4043245.github.io") {
    return "https://evline.pages.dev/api/leads";
  }
  return "/api/leads";
}

function setFormMessage(form, message, isError = false) {
  let node = form.querySelector("[data-form-message]");
  if (!node) {
    node = document.createElement("div");
    node.dataset.formMessage = "";
    node.className = "form__note";
    (form.querySelector(".form__actions") || form).append(node);
  }
  node.textContent = message;
  node.style.color = isError ? "#fecaca" : "rgba(255, 255, 255, 0.78)";
}

function detectLeadType(payload = {}) {
  const joined = [
    payload.type,
    payload.topic,
    payload.service,
    payload.form_type,
    window.location.pathname,
  ].join(" ").toLowerCase();
  return joined.includes("byd") || joined.includes("zeekr") || joined.includes("зикр") || joined.includes("зікр") || joined.includes("програм") || joined.includes("оновлен") || joined.includes("obnovlen")
    ? "byd"
    : "parts";
}

function telegramUsernameForType(type) {
  return type === "byd" ? "evline_tech" : "evline_support";
}

function openTelegramMessage(message, username = "evline_support", ctaText = "") {
  const text = String(message || "").trim();
  if (!text) return;
  const activeControl = document.activeElement?.matches?.("button, a, input[type='submit']")
    ? document.activeElement
    : null;
  const activeText = activeControl?.textContent || activeControl?.value || "";
  const contactEvent = {
    channel: "telegram",
    intent_type: username === "evline_tech" ? "byd" : "parts",
    destination: `@${username}`,
    cta_id: "programmatic-telegram",
    cta_text: String(ctaText || activeText || "Telegram").replace(/\s+/g, " ").trim().slice(0, 240),
  };
  if (window.EVLineContactTracking) {
    window.EVLineContactTracking.track(contactEvent);
  } else {
    window.__EVLINE_PENDING_CONTACT_EVENTS__ = window.__EVLINE_PENDING_CONTACT_EVENTS__ || [];
    window.__EVLINE_PENDING_CONTACT_EVENTS__.push(contactEvent);
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  window.open(`https://t.me/${username}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function isRussianPage() {
  return document.documentElement.lang.toLowerCase().startsWith("ru");
}

async function sendLeadToCrm(payload) {
  const eventPayload = {
    event: "evline_lead_submit",
    lead_type: payload.type || detectLeadType(payload),
    form_id: payload.form_id || "",
    form_name: payload.form_name || "",
    source: payload.utm_source || payload.source || "",
    medium: payload.utm_medium || payload.medium || "",
    campaign: payload.utm_campaign || payload.campaign || "",
    term: payload.utm_term || payload.term || "",
    has_gclid: Boolean(payload.gclid),
    has_gbraid: Boolean(payload.gbraid),
    has_wbraid: Boolean(payload.wbraid),
  };
  const response = await fetch(leadEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  });
  if (!response.ok) throw new Error("Не вдалося зберегти заявку");
  if (window.dataLayer) window.dataLayer.push(eventPayload);
  if (typeof window.gtag === "function") window.gtag("event", "generate_lead", eventPayload);
  return response.json().catch(() => ({}));
}

document.querySelectorAll("[data-telegram-parts-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitText = event.submitter?.textContent || form.querySelector("button[type='submit']")?.textContent || "";
    const data = Object.fromEntries(new FormData(form));
    const car = String(data.car || "").trim();
    const vin = String(data.vin || "").trim().toUpperCase();
    const part = String(data.part || "").trim();
    const phone = String(data.phone || data.contact || data.tel || "").trim();
    const ru = isRussianPage();
    const type = "parts";

    const lines = ru
      ? [
          "Добрый день! Хочу подобрать запчасть.",
          `Модель авто: ${car || "-"}`,
          `VIN-код: ${vin || "-"}`,
          `Что нужно: ${part || "-"}`,
          `Телефон: ${phone || "-"}`,
          "Подскажите, пожалуйста, цену и срок доставки.",
        ]
      : [
          "Добрий день! Хочу підібрати запчастину.",
          `Модель авто: ${car || "-"}`,
          `VIN-код: ${vin || "-"}`,
          `Що потрібно: ${part || "-"}`,
          `Телефон: ${phone || "-"}`,
          "Підкажіть, будь ласка, ціну та строк доставки.",
        ];

    const payload = {
      ...data,
      car,
      vin,
      part,
      phone,
      type,
      message: part,
      ...trackingData(form),
    };

    sendLeadToCrm(payload)
      .then(() => {
        form.reset();
        setFormMessage(form, ru ? "Telegram открыт с готовым текстом. Менеджер получит ваш запрос." : "Telegram відкрито з готовим текстом. Менеджер отримає ваш запит.");
      })
      .catch(() => {
        setFormMessage(form, ru ? "Telegram открыт с готовым текстом." : "Telegram відкрито з готовим текстом.");
      });

    openTelegramMessage(lines.join("\n"), telegramUsernameForType(type), submitText);
  });
});

document.querySelectorAll("[data-byd-seo-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const car = String(data.car || "").trim();
    const vin = String(data.vin || "").trim().toUpperCase();
    const issue = String(data.issue || "").trim();
    const contact = String(data.contact || data.phone || "").trim();
    const topic = String(form.dataset.topic || data.topic || "Програмування BYD").trim();
    const ru = form.dataset.lang === "ru" || isRussianPage();
    const type = "byd";
    const button = form.querySelector("button[type='submit']");
    const originalButtonText = button?.textContent || "";

    const lines = ru
      ? [
          "Добрый день! Нужна консультация по BYD.",
          `Тема: ${topic}`,
          `Модель: ${car || "-"}`,
          `VIN-код: ${vin || "-"}`,
          `Что беспокоит: ${issue || "-"}`,
          `Телефон: ${contact || "-"}`,
          "Подскажите, пожалуйста, что можно проверить и какая стоимость.",
        ]
      : [
          "Добрий день! Потрібна консультація по BYD.",
          `Тема: ${topic}`,
          `Модель: ${car || "-"}`,
          `VIN-код: ${vin || "-"}`,
          `Що турбує: ${issue || "-"}`,
          `Телефон: ${contact || "-"}`,
          "Підкажіть, будь ласка, що можна перевірити та яка вартість.",
        ];

    const payload = {
      ...data,
      type,
      topic,
      car,
      vin,
      phone: contact,
      contact,
      part: issue || topic,
      item_name: issue || topic,
      message: issue,
      ...trackingData(form),
    };
    if (!payload.form_name) {
      payload.form_name = `SEO-форма BYD: ${topic}`;
    }

    if (button) {
      button.disabled = true;
      button.textContent = ru ? "Сохраняем..." : "Зберігаємо...";
    }

    sendLeadToCrm(payload)
      .then(() => {
        form.reset();
        setFormMessage(
          form,
          ru
            ? "Заявка сохранена в CRM. Telegram открыт с готовым текстом."
            : "Заявку збережено в CRM. Telegram відкрито з готовим текстом.",
        );
      })
      .catch(() => {
        setFormMessage(
          form,
          ru
            ? "Telegram открыт, но заявку не удалось сохранить в CRM."
            : "Telegram відкрито, але заявку не вдалося зберегти в CRM.",
          true,
        );
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.textContent = originalButtonText;
        }
      });

    openTelegramMessage(lines.join("\n"), telegramUsernameForType(type), originalButtonText);
  });
});

document.querySelectorAll("[data-lead-form], [data-telegram-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    const originalButtonText = button?.textContent || "";
    const payload = {
      ...Object.fromEntries(new FormData(form)),
      ...trackingData(form),
    };
    payload.type = detectLeadType(payload);

    const ru = isRussianPage();

    if (button) {
      button.disabled = true;
      button.textContent = ru ? "Отправляем..." : "Відправляємо...";
    }

    try {
      await sendLeadToCrm(payload);

      form.reset();
      setFormMessage(form, ru ? "Заявка сохранена. Менеджер EVLine свяжется с вами." : "Заявку збережено. Менеджер EVLine зв'яжеться з вами.");
    } catch (error) {
      const topic = payload.topic || "Запит EVLine";
      const lines = ru
        ? [
            `Запрос: ${topic}`,
            `Имя: ${payload.name || "-"}`,
            `Телефон: ${payload.phone || "-"}`,
            `Модель авто: ${payload.car || "-"}`,
            `VIN: ${payload.vin || "-"}`,
          ]
        : [
            `Запит: ${topic}`,
            `Ім'я: ${payload.name || "-"}`,
            `Телефон: ${payload.phone || "-"}`,
            `Модель авто: ${payload.car || "-"}`,
            `VIN: ${payload.vin || "-"}`,
          ];
      if (payload.part) lines.push(ru ? `Запчасть: ${payload.part}` : `Запчастина: ${payload.part}`);
      lines.push(ru ? `Что нужно: ${payload.message || "-"}` : `Що потрібно: ${payload.message || "-"}`);
      setFormMessage(form, ru ? "Telegram открыт с готовым текстом." : "Telegram відкрито з готовим текстом.");
      openTelegramMessage(lines.join("\n"), telegramUsernameForType(payload.type), originalButtonText);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  });
});
