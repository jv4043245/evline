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

function trackingData() {
  const params = new URLSearchParams(window.location.search);
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
  };
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid", "fbclid"];
  let saved = {};
  try {
    saved = JSON.parse(sessionStorage.getItem("evline_tracking") || "{}") || {};
  } catch {
    saved = {};
  }
  const hasTracking = keys.some((key) => current[key]);
  if (hasTracking) {
    saved = { ...saved, ...current, referrer: current.referrer || saved.referrer || "" };
    try {
      sessionStorage.setItem("evline_tracking", JSON.stringify(saved));
    } catch {}
  }
  keys.forEach((key) => {
    if (!current[key] && saved[key]) current[key] = saved[key];
  });
  current.referrer = current.referrer || saved.referrer || "";
  return current;
}

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
  return joined.includes("byd") || joined.includes("програм") || joined.includes("оновлен") || joined.includes("obnovlen")
    ? "byd"
    : "parts";
}

function telegramUsernameForType(type) {
  return type === "byd" ? "evline_tech" : "evline_support";
}

function openTelegramMessage(message, username = "evline_support") {
  const text = String(message || "").trim();
  if (!text) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  window.open(`https://t.me/${username}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function isRussianPage() {
  return document.documentElement.lang.toLowerCase().startsWith("ru");
}

async function sendLeadToCrm(payload) {
  const response = await fetch(leadEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Не вдалося зберегти заявку");
  return response.json().catch(() => ({}));
}

document.querySelectorAll("[data-telegram-parts-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
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
      ...trackingData(),
    };

    sendLeadToCrm(payload)
      .then(() => {
        form.reset();
        setFormMessage(form, ru ? "Telegram открыт с готовым текстом. Менеджер получит ваш запрос." : "Telegram відкрито з готовим текстом. Менеджер отримає ваш запит.");
      })
      .catch(() => {
        setFormMessage(form, ru ? "Telegram открыт с готовым текстом." : "Telegram відкрито з готовим текстом.");
      });

    openTelegramMessage(lines.join("\n"), telegramUsernameForType(type));
  });
});

document.querySelectorAll("[data-lead-form], [data-telegram-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    const originalButtonText = button?.textContent || "";
    const payload = {
      ...Object.fromEntries(new FormData(form)),
      ...trackingData(),
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
      openTelegramMessage(lines.join("\n"), telegramUsernameForType(payload.type));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  });
});
