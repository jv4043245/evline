const root = document.querySelector("[data-app]");
const token = document.body.dataset.token || location.pathname.split("/").filter(Boolean).pop() || "";
const page = document.body.dataset.supplierPage || "request";

const requestStatusLabels = {
  draft: "Черновик",
  sent: "Новый предзаказ",
  viewed: "Просмотрено",
  quoted: "Предложение отправлено",
  needs_info: "Нужно уточнение",
  no_stock: "Нет в наличии",
  accepted: "Согласовано EVLine",
  purchased: "Оплачено",
  china_tracking: "Отправлено по Китаю",
  china_warehouse: "На складе в Китае",
  problem: "Проблема",
  closed: "Закрыто",
  canceled: "Отменено",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainText(value) {
  return String(value ?? "").trim();
}

function shortDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ru-RU", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function supplierErrorMessage(message) {
  const value = plainText(message);
  const dictionary = {
    "price_cny is required": "Укажите цену.",
    "Supplier quote is required before payment": "Сначала поставщик должен отправить цену.",
    "Client approval is required before payment": "Перед оплатой менеджер должен подтвердить согласование с клиентом.",
    "Payment receipt is required before supplier tracking": "Трек можно внести только после подтверждения оплаты.",
    "Logistics status is available only after manager accepts a quote": "Трек можно внести только после того, как EVLine выберет предложение.",
    "Supplier request is closed": "Этот предзаказ уже закрыт.",
    "Supplier request not found": "Предзаказ не найден или ссылка устарела.",
    "Unsupported supplier status": "Этот статус сейчас недоступен.",
    "Supplier event limit reached": "Достигнут лимит обновлений по этому предзаказу.",
    "Tracking number is required": "Укажите трек-номер.",
    "CRM already has another tracking number": "В CRM уже указан другой трек-номер. Свяжитесь с EVLine.",
    "Supplier request does not belong to this order": "Запрос поставщику не относится к этому заказу.",
    "Supplier quote does not belong to this order": "Предложение поставщика не относится к этому заказу.",
    "Supplier quote does not belong to this supplier request": "Предложение не относится к этому предзаказу.",
  };
  return dictionary[value] || value || "Ошибка запроса";
}

async function supplierApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(supplierErrorMessage(typeof body === "string" ? body : body.error));
  }
  return body;
}

function statusBadge(status) {
  const safe = String(status || "sent").replace(/[^a-z0-9_-]/gi, "");
  return `<span class="supplier-status supplier-status--${safe}">${escapeHtml(requestStatusLabels[status] || status || "Новый предзаказ")}</span>`;
}

function requestImages(images = []) {
  if (!images.length) return "";
  return `
    <div class="supplier-images">
      ${images.map((image) => `<img src="${escapeHtml(image.image_url)}" alt="Фото детали" loading="lazy">`).join("")}
    </div>
  `;
}

function requestData(request = {}) {
  return `
    <div class="supplier-data">
      <div><span>VIN</span><strong>${escapeHtml(request.vin || "-")}</strong></div>
      <div><span>Авто</span><strong>${escapeHtml(request.car || "-")}</strong></div>
      <div><span>Деталь</span><strong>${escapeHtml(request.item_name || "-")}</strong></div>
      <div><span>Количество</span><strong>${Number(request.quantity || 1)}</strong></div>
      <div class="supplier-data--wide"><span>Описание</span><strong>${escapeHtml(request.request_text || "-")}</strong></div>
      ${request.supplier_note ? `<div class="supplier-data--wide"><span>Уточнение</span><strong>${escapeHtml(request.supplier_note)}</strong></div>` : ""}
    </div>
  `;
}

function renderPayment(payment = {}, tokenValue = token) {
  if (!payment) return "";
  const paid = payment.status === "paid";
  return `
    <section class="supplier-card supplier-payment">
      <div class="supplier-card__head">
        <h2>Оплата</h2>
        <span class="supplier-muted">${paid ? "оплачено" : "ожидает оплаты EVLine"}</span>
      </div>
      <div class="supplier-data">
        <div><span>Сумма</span><strong>${Number(payment.requested_amount || 0).toLocaleString("ru-RU")} ${escapeHtml(payment.requested_currency || "CNY")}</strong></div>
        ${payment.paid_amount ? `<div><span>Оплачено</span><strong>${Number(payment.paid_amount || 0).toLocaleString("ru-RU")} ${escapeHtml(payment.paid_currency || payment.requested_currency || "CNY")}</strong></div>` : ""}
        ${payment.paid_at ? `<div><span>Дата</span><strong>${escapeHtml(shortDateTime(payment.paid_at))}</strong></div>` : ""}
      </div>
      ${paid && payment.receipt_present ? `
        <div class="supplier-receipt">
          <strong>Скрин оплаты прикреплён</strong>
          <img src="/api/supplier/request/${encodeURIComponent(tokenValue)}/payment-receipt" alt="Скрин оплаты" loading="lazy">
        </div>
      ` : `<p class="supplier-muted">${paid ? "Оплата отмечена, скрин пока не прикреплён." : "После оплаты здесь появится подтверждение."}</p>`}
    </section>
  `;
}

function renderQuotes(quotes = []) {
  if (!quotes.length) return `<p class="supplier-muted">Предложений пока нет.</p>`;
  return `
    <div class="supplier-quotes">
      ${quotes.map((quote) => `
        <article class="supplier-quote ${quote.status === "selected" ? "supplier-quote--selected" : ""}">
          <div class="supplier-quote__price">${Number(quote.price_cny || 0).toLocaleString("ru-RU")} CNY</div>
          <div class="supplier-muted">
            ${quote.purchase_days ? `Срок ${Number(quote.purchase_days)} дн.` : ""}
          </div>
          ${quote.part_number ? `<div><strong>Номер:</strong> ${escapeHtml(quote.part_number)}</div>` : ""}
          ${quote.comment_cn ? `<p>${escapeHtml(quote.comment_cn)}</p>` : ""}
          ${quote.comment_translated && quote.comment_translated !== quote.comment_cn ? `<p>${escapeHtml(quote.comment_translated)}</p>` : ""}
          ${requestImages(quote.images || [])}
          ${quote.status === "selected" ? `<strong>EVLine выбрал это предложение.</strong>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

function renderEvents(events = []) {
  if (!events.length) return `<p class="supplier-muted">Истории пока нет.</p>`;
  return `
    <ul class="supplier-events">
      ${events.map((event) => `
        <li>
          <strong>${escapeHtml(requestStatusLabels[event.status] || event.status)}</strong>
          <div class="supplier-muted">${escapeHtml(shortDateTime(event.created_at))}${event.tracking_number ? ` · ${escapeHtml(event.tracking_number)}` : ""}</div>
          ${event.comment_cn ? `<p>${escapeHtml(event.comment_cn)}</p>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderQuoteForm(request = {}) {
  const quotable = ["sent", "viewed", "quoted", "needs_info", "no_stock"].includes(request.status);
  const disabled = !quotable;
  return `
    <form class="supplier-form" data-quote-form>
      <h2>Ответ поставщика</h2>
      <div class="supplier-form__grid">
        <input name="quote_type" type="hidden" value="original">
        <input name="availability" type="hidden" value="in_stock">
        <input name="quantity" type="hidden" value="${Number(request.quantity || 1)}">
        <label>
          Цена, CNY
          <input name="price_cny" type="number" min="0" step="0.01" placeholder="например 1200" required ${disabled ? "disabled" : ""}>
        </label>
        <label>
          Срок, дней
          <input name="purchase_days" type="number" min="0" step="1" placeholder="0" required ${disabled ? "disabled" : ""}>
        </label>
        <label class="supplier-wide">
          Комментарий
          <textarea name="comment_cn" rows="3" placeholder="наличие, нюансы, упаковка, условия" ${disabled ? "disabled" : ""}></textarea>
        </label>
      </div>
      <button class="supplier-button supplier-button--primary" type="submit" ${disabled ? "disabled" : ""}>Отправить предложение</button>
    </form>
  `;
}

function renderTrackingForm(request = {}, payment = null) {
  const paid = payment?.status === "paid";
  const allowed = paid && ["accepted", "purchased", "china_tracking", "china_warehouse", "problem"].includes(request.status);
  if (!allowed) {
    if (["accepted", "purchased"].includes(request.status) && !paid) {
      return `<section class="supplier-card"><h2>Отправка</h2><p class="supplier-muted">Трек-номер можно будет внести после подтверждения оплаты.</p></section>`;
    }
    return "";
  }
  return `
    <form class="supplier-form" data-tracking-form>
      <h2>Отправка по Китаю</h2>
      <div class="supplier-form__grid">
        <input name="status" type="hidden" value="china_tracking">
        <label>
          Трек-номер
          <input name="tracking_number" placeholder="номер отправки по Китаю" required>
        </label>
        <label class="supplier-wide">
          Комментарий
          <textarea name="comment_cn" rows="3" placeholder="служба доставки, упаковка, детали отправки"></textarea>
        </label>
      </div>
      <button class="supplier-button supplier-button--primary" type="submit">Сохранить трек</button>
    </form>
  `;
}

function renderQuickActions(request = {}) {
  const allowed = ["sent", "viewed", "quoted", "needs_info", "no_stock"].includes(request.status);
  if (!allowed) return "";
  return `
    <div class="supplier-actions">
      <button class="supplier-button supplier-button--danger" type="button" data-action="no_stock">Нет в наличии</button>
      <button class="supplier-button" type="button" data-action="needs_info">Нужно уточнение</button>
    </div>
  `;
}

function renderRequestPage(data) {
  const request = data.request || {};
  root.innerHTML = `
    <header class="supplier-topbar">
      <div class="supplier-brand">
        <strong>EVLine · Предзаказ</strong>
        <span>${escapeHtml(request.public_number || "")}</span>
      </div>
    </header>

    <section class="supplier-hero">
      <span class="supplier-kicker">${escapeHtml(request.supplier_name || "Поставщик")}</span>
      <h1>${escapeHtml(request.item_name || "Запрос по детали")}</h1>
      ${statusBadge(request.status)}
      <p>Укажите цену, срок и комментарий. EVLine увидит ответ в CRM.</p>
    </section>

    <section class="supplier-card">
      <div class="supplier-card__head">
        <h2>Данные запроса</h2>
        <span class="supplier-muted">${escapeHtml(shortDateTime(request.created_at))}</span>
      </div>
      ${requestImages(data.request_images || [])}
      ${requestData(request)}
      ${renderQuickActions(request)}
    </section>

      ${renderPayment(data.payment, token)}

    <section class="supplier-section">
      ${renderQuoteForm(request)}
    </section>

    <section class="supplier-section">
      <h2>Предложения</h2>
      ${renderQuotes(data.quotes || [])}
    </section>

    <section class="supplier-section">
      ${renderTrackingForm(request, data.payment)}
    </section>

    <section class="supplier-section">
      <h2>История</h2>
      ${renderEvents(data.tracking_events || [])}
    </section>
  `;
}

function renderDashboardPage(data) {
  const requests = data.requests || [];
  root.innerHTML = `
    <header class="supplier-topbar">
      <div class="supplier-brand">
        <strong>EVLine · Список запросов</strong>
        <span>${escapeHtml(data.supplier?.name || "Поставщик")}</span>
      </div>
    </header>
    <section class="supplier-hero">
      <h1>Активные запросы EVLine</h1>
      <p>Здесь видны только ваши предзаказы.</p>
    </section>
    <section class="supplier-dashboard">
      ${requests.length ? requests.map((request) => `
        <a class="supplier-dashboard-card" href="${escapeHtml(request.supplier_link || "#")}">
          <div class="supplier-card__head">
            <strong>${escapeHtml(request.public_number || request.id)}</strong>
            ${statusBadge(request.status)}
          </div>
          <div>${escapeHtml(request.item_name || "Деталь")}</div>
          <div class="supplier-muted">${escapeHtml(request.car || "-")} · VIN ${escapeHtml(request.vin || "-")}</div>
        </a>
      `).join("") : `<div class="supplier-empty"><strong>Пока нет запросов</strong><span class="supplier-muted">Новые ссылки EVLine появятся здесь.</span></div>`}
    </section>
  `;
}

function setButtonBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text || "Отправляем...";
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

async function loadRequest() {
  const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`);
  renderRequestPage(data);
}

async function loadDashboard() {
  const data = await supplierApi(`/api/supplier/dashboard/${encodeURIComponent(token)}`);
  renderDashboardPage(data);
}

root?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  setButtonBusy(button, true);
  try {
    if (form.matches("[data-quote-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      payload.action = "quote";
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderRequestPage(data);
    }
    if (form.matches("[data-tracking-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      renderRequestPage(data);
    }
  } catch (error) {
    alert(error.message);
    setButtonBusy(button, false);
  }
});

root?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const comment = action === "needs_info" ? prompt("Что нужно уточнить?") : "";
  if (action === "needs_info" && comment === null) return;
  setButtonBusy(button, true);
  try {
    const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify({ action, comment_cn: comment || "" }),
    });
    renderRequestPage(data);
  } catch (error) {
    alert(error.message);
    setButtonBusy(button, false);
  }
});

(page === "dashboard" ? loadDashboard() : loadRequest()).catch((error) => {
  if (!root) return;
  root.innerHTML = `
    <section class="supplier-empty">
      <strong>Не удалось открыть ссылку</strong>
      <span class="supplier-muted">${escapeHtml(error.message)}</span>
    </section>
  `;
});
