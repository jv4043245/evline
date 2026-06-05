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

function trackingData() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || "",
    utm_medium: params.get("utm_medium") || "",
    utm_campaign: params.get("utm_campaign") || "",
    utm_term: params.get("utm_term") || "",
    utm_content: params.get("utm_content") || "",
    gclid: params.get("gclid") || "",
    fbclid: params.get("fbclid") || "",
    landing_page: window.location.href,
    referrer: document.referrer,
  };
}

function setFormMessage(form, message, isError = false) {
  let node = form.querySelector("[data-form-message]");
  if (!node) {
    node = document.createElement("div");
    node.dataset.formMessage = "";
    node.className = "form__note";
    form.querySelector(".form__actions")?.append(node);
  }
  node.textContent = message;
  node.style.color = isError ? "#fecaca" : "rgba(255, 255, 255, 0.78)";
}

function openTelegramMessage(message) {
  const text = String(message || "").trim();
  if (!text) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
  window.open(`https://t.me/evline_support?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function isRussianPage() {
  return document.documentElement.lang.toLowerCase().startsWith("ru");
}

document.querySelectorAll("[data-telegram-parts-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const car = String(data.car || "").trim();
    const vin = String(data.vin || "").trim().toUpperCase();
    const part = String(data.part || "").trim();
    const ru = isRussianPage();

    const lines = ru
      ? [
          "Добрый день! Хочу подобрать запчасть.",
          `Модель авто: ${car || "-"}`,
          `VIN-код: ${vin || "-"}`,
          `Что нужно: ${part || "-"}`,
          "Подскажите, пожалуйста, цену и срок доставки.",
        ]
      : [
          "Добрий день! Хочу підібрати запчастину.",
          `Модель авто: ${car || "-"}`,
          `VIN-код: ${vin || "-"}`,
          `Що потрібно: ${part || "-"}`,
          "Підкажіть, будь ласка, ціну та строк доставки.",
        ];

    openTelegramMessage(lines.join("\n"));
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

    const ru = isRussianPage();

    if (button) {
      button.disabled = true;
      button.textContent = ru ? "Отправляем..." : "Відправляємо...";
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Не вдалося зберегти заявку");

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
      setFormMessage(form, ru ? "Сейчас не удалось сохранить заявку в CRM. Открываю Telegram как резервный канал." : "Зараз не вдалося зберегти заявку в CRM. Відкриваю Telegram як резервний канал.", true);
      openTelegramMessage(lines.join("\n"));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  });
});
