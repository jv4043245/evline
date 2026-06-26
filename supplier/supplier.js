const root = document.querySelector("[data-app]");
const query = new URLSearchParams(location.search);
const pathParts = location.pathname.split("/").filter(Boolean);
const tokenFromPath = pathParts[0] === "supplier" && ["request", "dashboard"].includes(pathParts[1]) ? pathParts[2] || "" : "";
const token = document.body.dataset.token || query.get("token") || tokenFromPath || "";
const page = document.body.dataset.supplierPage || query.get("page") || (pathParts[1] === "dashboard" ? "dashboard" : "request");

const requestStatusLabels = {
  draft: "Черновик",
  sent: "Новый запрос",
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

function dateMs(value) {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function supplierErrorMessage(message) {
  const value = plainText(message);
  const dictionary = {
    "price_cny is required": "Укажите цену.",
    "Supplier quote is required before payment": "Сначала поставщик должен отправить цену.",
    "Client approval is required before payment": "Перед оплатой менеджер должен подтвердить согласование с клиентом.",
    "Payment receipt is required before supplier tracking": "Трек можно внести только после подтверждения оплаты.",
    "Logistics status is available only after manager accepts a quote": "Трек можно внести только после того, как EVLine выберет предложение.",
    "Supplier request is closed": "Этот запрос уже закрыт.",
    "Supplier request not found": "Запрос не найден или ссылка устарела.",
    "Unsupported supplier status": "Этот статус сейчас недоступен.",
    "Supplier event limit reached": "Достигнут лимит обновлений по этому запросу.",
    "Tracking number is required": "Укажите трек-номер.",
    "Clarification text is required": "Напишите, что нужно уточнить.",
    "Message text is required": "Напишите сообщение.",
    "Supplier message is available only after quote": "Сообщение доступно после первого предложения.",
    "CRM already has another tracking number": "В CRM уже указан другой трек-номер. Свяжитесь с EVLine.",
    "Supplier request does not belong to this order": "Запрос поставщику не относится к этому заказу.",
    "Supplier quote does not belong to this order": "Предложение поставщика не относится к этому заказу.",
    "Supplier quote does not belong to this supplier request": "Предложение не относится к этому запросу.",
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
  return `<span class="supplier-status supplier-status--${safe}">${escapeHtml(requestStatusLabels[status] || status || "Новый запрос")}</span>`;
}

function requestImages(images = []) {
  if (!images.length) return "";
  return `
    <div class="supplier-images">
      ${images.map((image) => `
        <a href="${escapeHtml(image.image_url)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(image.image_url)}" alt="Фото детали" loading="lazy">
        </a>
      `).join("")}
    </div>
  `;
}

function requestData(request = {}) {
  return `
    <div class="supplier-data">
      <div><span>VIN</span><strong>${escapeHtml(request.vin || "-")}</strong></div>
      <div><span>Авто</span><strong>${escapeHtml(request.car || "-")}</strong></div>
      <div><span>Год</span><strong>${escapeHtml(request.car_year || "-")}</strong></div>
      <div><span>Деталь</span><strong>${escapeHtml(request.item_name || "-")}</strong></div>
      <div><span>Количество</span><strong>${Number(request.quantity || 1)}</strong></div>
      <div class="supplier-data--wide"><span>Описание</span><strong>${escapeHtml(request.request_text || "-")}</strong></div>
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

function quoteChatText(quote = {}) {
  return [
    quote.price_cny ? `${Number(quote.price_cny || 0).toLocaleString("ru-RU")} CNY` : "",
    quote.purchase_days ? `Срок поставки: ${Number(quote.purchase_days)} дн.` : "",
    plainText(quote.comment_cn),
  ].filter(Boolean).join("\n");
}

function isDuplicateQuoteEvent(event = {}, quotes = []) {
  const eventComment = plainText(event.comment_cn || event.comment_translated);
  return quotes.some((quote) => {
    const quoteComment = plainText(quote.comment_cn || quote.comment_translated || quote.comment_ru);
    const commentsMatch = eventComment === quoteComment;
    const timeGap = Math.abs(dateMs(event.created_at) - dateMs(quote.created_at));
    return commentsMatch && timeGap <= 2000;
  });
}

function supplierChatMessages(data = {}) {
  const request = data.request || {};
  const events = data.tracking_events || [];
  const quotes = data.quotes || [];
  const messages = [];
  const initialText = plainText(request.request_text);
  if (initialText) {
    messages.push({
      actor: "evline",
      title: "EVLine",
      meta: "Запрос",
      text: initialText,
      created_at: request.created_at,
      order: 0,
    });
  }

  const hasNoteEvent = events.some((event) => event.status === "sent" && plainText(event.comment_cn) === plainText(request.supplier_note));
  if (plainText(request.supplier_note) && !hasNoteEvent) {
    messages.push({
      actor: "evline",
      title: "EVLine",
      meta: "Уточнение",
      text: plainText(request.supplier_note),
      created_at: request.updated_at || request.created_at,
      order: 1,
    });
  }

  for (const quote of quotes) {
    const textValue = quoteChatText(quote);
    if (!textValue) continue;
    messages.push({
      actor: "supplier",
      title: "Поставщик",
      meta: "Предложение",
      text: textValue,
      created_at: quote.created_at,
      order: 2,
    });
  }

  for (const event of events) {
    const status = plainText(event.status);
    const comment = plainText(event.comment_cn || event.comment_translated);
    if (status === "quoted") {
      if (comment && !isDuplicateQuoteEvent(event, quotes)) {
        messages.push({
          actor: "supplier",
          title: "Поставщик",
          meta: "Сообщение",
          text: comment,
          created_at: event.created_at,
          order: 3,
        });
      }
      continue;
    }
    if (status === "needs_info" && comment) {
      messages.push({
        actor: "supplier",
        title: "Поставщик",
        meta: "Нужно уточнение",
        text: comment,
        created_at: event.created_at,
        order: 3,
      });
    } else if (status === "sent" && comment) {
      messages.push({
        actor: "evline",
        title: "EVLine",
        meta: "Ответ",
        text: comment,
        created_at: event.created_at,
        order: 4,
      });
    } else if (status === "no_stock") {
      messages.push({
        actor: "supplier",
        title: "Поставщик",
        meta: "Не можем привезти",
        text: comment || "Поставщик отметил, что не может привезти позицию.",
        created_at: event.created_at,
        order: 5,
      });
    } else if (status === "problem" && comment) {
      messages.push({
        actor: "supplier",
        title: "Поставщик",
        meta: "Проблема",
        text: comment,
        created_at: event.created_at,
        order: 6,
      });
    } else if (["china_tracking", "china_warehouse"].includes(status) && (comment || plainText(event.tracking_number))) {
      messages.push({
        actor: "supplier",
        title: "Поставщик",
        meta: status === "china_tracking" ? "Трек" : "Склад в Китае",
        text: [plainText(event.tracking_number), comment].filter(Boolean).join("\n"),
        created_at: event.created_at,
        order: 7,
      });
    }
  }

  return messages.sort((a, b) => (dateMs(a.created_at) - dateMs(b.created_at)) || (a.order - b.order));
}

function renderSupplierChat(data = {}) {
  const messages = supplierChatMessages(data);
  if (!messages.length) return `<p class="supplier-muted">Сообщений пока нет.</p>`;
  return `
    <div class="supplier-chat">
      ${messages.map((message) => `
        <article class="supplier-chat__message supplier-chat__message--${escapeHtml(message.actor)}">
          <div class="supplier-chat__bubble">
            <div class="supplier-chat__meta">
              <strong>${escapeHtml(message.title)}</strong>
              <span>${escapeHtml(message.meta)} · ${escapeHtml(shortDateTime(message.created_at))}</span>
            </div>
            <p>${escapeHtml(message.text)}</p>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderQuoteForm(data = {}) {
  const request = data.request || {};
  const hasQuote = (data.quotes || []).length > 0;
  const quotable = !hasQuote && ["sent", "viewed", "needs_info"].includes(request.status);
  if (!quotable) return "";
  return `
    <form class="supplier-form supplier-form--compact" data-quote-form>
      <h2>Ответ по цене</h2>
      <div class="supplier-form__grid">
        <input name="quote_type" type="hidden" value="original">
        <input name="availability" type="hidden" value="in_stock">
        <input name="quantity" type="hidden" value="${Number(request.quantity || 1)}">
        <label>
          Цена, CNY
          <input name="price_cny" type="number" min="0" step="0.01" placeholder="например 1200" required>
        </label>
        <label>
          Срок поставки, дней
          <input name="purchase_days" type="number" min="0" step="1" placeholder="0" required>
        </label>
        <label class="supplier-wide">
          Комментарий
          <textarea name="comment_cn" rows="3" placeholder="наличие, нюансы, упаковка, условия"></textarea>
        </label>
      </div>
      <button class="supplier-button supplier-button--primary" type="submit">Отправить предложение</button>
    </form>
  `;
}

function renderMessageForm(data = {}) {
  const request = data.request || {};
  const hasQuote = (data.quotes || []).length > 0;
  const canMessage = hasQuote && request.status === "quoted";
  if (!canMessage) return "";
  return `
    <form class="supplier-message-form" data-message-form aria-label="Сообщение по запросу">
      <textarea name="comment_cn" rows="2" placeholder="Написать сообщение по этому запросу" required></textarea>
      <button class="supplier-button supplier-button--primary supplier-button--small" type="submit">Отправить</button>
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

function renderClarificationForm(data = {}) {
  const request = data.request || {};
  const hasQuote = (data.quotes || []).length > 0;
  const allowed = !hasQuote && ["sent", "viewed", "needs_info"].includes(request.status);
  if (!allowed) return "";
  return `
    <form class="supplier-clarification" data-clarification-form>
      <div class="supplier-clarification__head">
        <strong>Нужно уточнение?</strong>
        <span class="supplier-muted">Напишите, какой информации не хватает по этой детали.</span>
      </div>
      <textarea name="comment_cn" rows="3" placeholder="Например: нужен размер, цвет, сторона или фото крепления" required></textarea>
      <div class="supplier-clarification__actions">
        <button class="supplier-button supplier-button--small" type="submit">Отправить уточнение</button>
        <button class="supplier-button supplier-button--quiet-danger" type="button" data-action="no_stock">Не можем привезти</button>
      </div>
    </form>
  `;
}

function renderRequestPage(data) {
  const request = data.request || {};
  root.innerHTML = `
    <header class="supplier-topbar">
      <div class="supplier-brand">
        <strong>EVLine · Запрос</strong>
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
    </section>

    <section class="supplier-section">
      <h2>Чат по запчасти</h2>
      ${renderSupplierChat(data)}
      ${renderQuoteForm(data)}
      ${renderMessageForm(data)}
      ${renderClarificationForm(data)}
    </section>

    ${renderPayment(data.payment, token)}

    <section class="supplier-section">
      ${renderTrackingForm(request, data.payment)}
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
      <p>Здесь видны только ваши запросы.</p>
    </section>
    <section class="supplier-dashboard">
      ${requests.length ? requests.map((request) => `
        <a class="supplier-dashboard-card" href="${escapeHtml(request.supplier_link || "#")}">
          <div class="supplier-card__head">
            <strong>${escapeHtml(request.public_number || request.id)}</strong>
            ${statusBadge(request.status)}
          </div>
          <div>${escapeHtml(request.item_name || "Деталь")}</div>
          <div class="supplier-muted">${escapeHtml(request.car || "-")}${request.car_year ? ` · ${escapeHtml(request.car_year)}` : ""} · VIN ${escapeHtml(request.vin || "-")}</div>
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
      return;
    }
    if (form.matches("[data-tracking-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      renderRequestPage(data);
      return;
    }
    if (form.matches("[data-clarification-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      payload.action = "needs_info";
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      renderRequestPage(data);
      return;
    }
    if (form.matches("[data-message-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      payload.action = "message";
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
        method: "POST",
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
  if (action !== "no_stock") return;
  if (!confirm("Отметить, что эту позицию невозможно привезти?")) return;
  setButtonBusy(button, true);
  try {
    const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify({ action, comment_cn: "" }),
    });
    renderRequestPage(data);
  } catch (error) {
    alert(error.message);
    setButtonBusy(button, false);
  }
});

if (!token && root) {
  root.innerHTML = `
    <section class="supplier-empty">
      <strong>Кабинет поставщика</strong>
      <span class="supplier-muted">Откройте ссылку на запрос, которую отправил менеджер EVLine.</span>
    </section>
  `;
} else {
  (page === "dashboard" ? loadDashboard() : loadRequest()).catch((error) => {
  if (!root) return;
  root.innerHTML = `
    <section class="supplier-empty">
      <strong>Не удалось открыть ссылку</strong>
      <span class="supplier-muted">${escapeHtml(error.message)}</span>
    </section>
  `;
  });
}
