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

document.querySelectorAll("[data-telegram-parts-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const car = String(data.car || "").trim();
    const vin = String(data.vin || "").trim().toUpperCase();
    const part = String(data.part || "").trim();

    const lines = ["Запит на підбір запчастини:"];
    lines.push(`Модель авто: ${car || "-"}`);
    if (vin) lines.push(`VIN: ${vin}`);
    lines.push(`Запчастина: ${part || "-"}`);

    window.open(`https://t.me/evline_support?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
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

    if (button) {
      button.disabled = true;
      button.textContent = "Відправляємо...";
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error("Не вдалося зберегти заявку");

      form.reset();
      setFormMessage(form, "Заявку збережено. Менеджер EVLine зв'яжеться з вами.");
    } catch (error) {
      const topic = payload.topic || "Запит EVLine";
      const lines = [
        `Запит: ${topic}`,
        `Ім'я: ${payload.name || "-"}`,
        `Телефон: ${payload.phone || "-"}`,
        `Модель авто: ${payload.car || "-"}`,
        `VIN: ${payload.vin || "-"}`,
      ];
      if (payload.part) lines.push(`Запчастина: ${payload.part}`);
      lines.push(`Що потрібно: ${payload.message || "-"}`);
      const text = encodeURIComponent(lines.join("\n"));
      setFormMessage(form, "Зараз не вдалося зберегти заявку в CRM. Відкриваю Telegram як резервний канал.", true);
      window.open(`https://t.me/evline_support?text=${text}`, "_blank", "noopener");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalButtonText;
      }
    }
  });
});
