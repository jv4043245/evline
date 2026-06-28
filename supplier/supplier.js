const root = document.querySelector("[data-app]");
const query = new URLSearchParams(location.search);
const pathParts = location.pathname.split("/").filter(Boolean);
const tokenFromPath = pathParts[0] === "supplier" && ["request", "dashboard"].includes(pathParts[1]) ? pathParts[2] || "" : "";
const token = document.body.dataset.token || query.get("token") || tokenFromPath || "";
const page = document.body.dataset.supplierPage || query.get("page") || (pathParts[1] === "dashboard" ? "dashboard" : "request");
let requestPollTimer = null;
let dashboardData = null;
let dashboardTab = "work";
let dashboardSelectedRequestId = "";

const requestStatusLabels = {
  draft: "Черновик",
  sent: "Новый запрос",
  viewed: "Просмотрено",
  quoted: "Предложение отправлено",
  needs_info: "Нужно уточнение",
  no_stock: "Нет поставки",
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

function sendIcon() {
  return `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m22 2-7 20-4-9-9-4 20-7Z"></path>
      <path d="M22 2 11 13"></path>
    </svg>
  `;
}

function sendButton(extraClass = "") {
  return `
    <button class="supplier-button supplier-button--primary supplier-button--send ${escapeHtml(extraClass)}" type="submit" aria-label="Отправить" title="Отправить">
      ${sendIcon()}
      <span>Отправить</span>
    </button>
  `;
}

function noSupplyButton(extraClass = "") {
  return `<button class="supplier-button supplier-button--quiet-danger supplier-button--no-supply ${escapeHtml(extraClass)}" type="button" data-action="no_stock" aria-label="Отметить, что по позиции нет поставки" title="无法供货">Нет поставки</button>`;
}

function canMarkNoSupply(data = {}) {
  const request = data.request || {};
  const hasQuote = (data.quotes || []).length > 0;
  const status = plainText(request.status || "sent");
  if (["sent", "viewed", "needs_info"].includes(status)) return true;
  return hasQuote && ["quoted", "accepted", "purchased", "problem"].includes(status);
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
    "Delivery cost is not available for this supplier request": "Стоимость доставки сейчас недоступна.",
    "D1 migration 0015_supplier_delivery_cost.sql is required": "На сервере ещё не применена миграция доставки.",
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
    <div class="supplier-data supplier-data--request">
      <div><span>VIN</span><strong>${escapeHtml(request.vin || "-")}</strong></div>
      <div><span>Авто</span><strong>${escapeHtml(request.car || "-")}</strong></div>
      <div><span>Год</span><strong>${escapeHtml(request.car_year || "-")}</strong></div>
      <div><span>Деталь</span><strong>${escapeHtml(request.item_name || "-")}</strong></div>
      <div><span>Количество</span><strong>${Number(request.quantity || 1)}</strong></div>
      <div class="supplier-data--wide"><span>Описание</span><strong>${escapeHtml(request.request_text || "-")}</strong></div>
    </div>
  `;
}

function paymentStatusText(payment = {}) {
  if (payment.status === "paid") return "оплачено EVLine";
  if (payment.receipt_present) return "скрин оплаты прикреплён";
  return "ожидает оплаты EVLine";
}

function paymentDelta(payment = {}) {
  const requested = Number(payment.requested_amount || 0);
  const paid = Number(payment.paid_amount || 0);
  const requestedCurrency = payment.requested_currency || "CNY";
  const paidCurrency = payment.paid_currency || requestedCurrency;
  if (!requested || !paid || requestedCurrency !== paidCurrency) return { amount: 0, significant: false, currency: paidCurrency };
  const amount = Math.round((paid - requested) * 100) / 100;
  return {
    amount,
    currency: paidCurrency,
    significant: Math.abs(amount) > Math.max(5, requested * 0.05),
  };
}

function renderPayment(payment = {}, tokenValue = token) {
  if (!payment) return "";
  const paid = payment.status === "paid";
  const receiptAttached = Boolean(payment.receipt_present);
  const receiptVersion = encodeURIComponent(payment.updated_at || payment.paid_at || "");
  const receiptUrl = `/api/supplier/request/${encodeURIComponent(tokenValue)}/payment-receipt${receiptVersion ? `?v=${receiptVersion}` : ""}`;
  const delta = paymentDelta(payment);
  return `
    <section class="supplier-card supplier-payment supplier-payment--compact">
      <div class="supplier-card__head">
        <h2>Оплата</h2>
        <span class="supplier-muted">${escapeHtml(paymentStatusText(payment))}</span>
      </div>
      <div class="supplier-data">
        <div><span>Счёт</span><strong>${Number(payment.requested_amount || 0).toLocaleString("ru-RU")} ${escapeHtml(payment.requested_currency || "CNY")}</strong></div>
        ${payment.paid_amount ? `<div><span>Оплачено</span><strong>${Number(payment.paid_amount || 0).toLocaleString("ru-RU")} ${escapeHtml(payment.paid_currency || payment.requested_currency || "CNY")}</strong></div>` : ""}
        ${payment.paid_at ? `<div><span>Дата</span><strong>${escapeHtml(shortDateTime(payment.paid_at))}</strong></div>` : ""}
      </div>
      ${delta.amount ? `
        <p class="supplier-payment-note ${delta.significant ? "supplier-payment-note--warning" : ""}">
          ${delta.amount > 0
            ? `Оплачено больше счёта на +${Number(delta.amount).toLocaleString("ru-RU")} ${escapeHtml(delta.currency)}.`
            : `Оплачено меньше счёта на ${Number(Math.abs(delta.amount)).toLocaleString("ru-RU")} ${escapeHtml(delta.currency)}.`}
        </p>
      ` : ""}
      ${receiptAttached ? `
        <div class="supplier-receipt">
          <strong>${paid ? "Оплата подтверждена" : "Скрин оплаты прикреплён"}</strong>
          <a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener">посмотреть скрин</a>
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

function supplierSelfTitle() {
  return "Я";
}

function supplierChatMessages(data = {}) {
  const request = data.request || {};
  const events = data.tracking_events || [];
  const quotes = data.quotes || [];
  const messages = [];

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
      title: supplierSelfTitle(),
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
          title: supplierSelfTitle(),
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
        title: supplierSelfTitle(),
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
        title: supplierSelfTitle(),
        meta: "Нет поставки",
        text: comment || "Вы отметили, что по позиции нет поставки.",
        created_at: event.created_at,
        order: 5,
      });
    } else if (status === "problem" && comment) {
      messages.push({
        actor: "supplier",
        title: supplierSelfTitle(),
        meta: "Проблема",
        text: comment,
        created_at: event.created_at,
        order: 6,
      });
    } else if (["china_tracking", "china_warehouse"].includes(status) && (comment || plainText(event.tracking_number))) {
      messages.push({
        actor: "system",
        title: "Логистика",
        meta: status === "china_tracking" ? "Отправлено, ждём доставку" : "На складе в Китае",
        text: [plainText(event.tracking_number) ? `Трек: ${plainText(event.tracking_number)}` : "", comment].filter(Boolean).join("\n"),
        created_at: event.created_at,
        order: 7,
      });
    }
  }

  return messages.sort((a, b) => (dateMs(a.created_at) - dateMs(b.created_at)) || (a.order - b.order));
}

function renderSupplierChat(data = {}) {
  const messages = supplierChatMessages(data);
  if (!messages.length) return "";
  return `
    <h2>Диалог по заказу</h2>
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
  const showDeliveryField = !supplierHasDeliveryCost(request);
  return `
    <form class="supplier-form supplier-form--compact supplier-answer-form" data-answer-form>
      <h2>Ответ по запросу</h2>
      <div class="supplier-form__grid">
        <input name="quote_type" type="hidden" value="original">
        <input name="availability" type="hidden" value="in_stock">
        <input name="quantity" type="hidden" value="${Number(request.quantity || 1)}">
        <label>
          Цена, CNY
          <input name="price_cny" type="number" min="0" step="0.01" placeholder="например 1200">
        </label>
        ${showDeliveryField ? `<label>
          Доставка, CNY
          <input name="delivery_cost_cny" type="number" min="0" step="0.01" placeholder="0">
        </label>` : ""}
        <label>
          Срок поставки, дней
          <input name="purchase_days" type="number" min="0" step="1" placeholder="0">
        </label>
        <label class="supplier-wide">
          Комментарий / уточнение
          <textarea name="comment_cn" rows="3" placeholder="цена, нюансы, условия или что нужно уточнить"></textarea>
        </label>
      </div>
      <div class="supplier-answer-form__actions">
        ${sendButton()}
      </div>
    </form>
  `;
}

function renderMessageForm(data = {}) {
  const request = data.request || {};
  const hasQuote = (data.quotes || []).length > 0;
  const canMessage = hasQuote && ["quoted", "accepted", "purchased", "needs_info", "no_stock", "problem", "china_tracking", "china_warehouse"].includes(request.status);
  if (!canMessage) return "";
  const showDeliveryField = !supplierHasDeliveryCost(request);
  return `
    <form class="supplier-message-form ${showDeliveryField ? "" : "supplier-message-form--no-delivery"}" data-message-form aria-label="Сообщение по запросу">
      <textarea name="comment_cn" rows="2" placeholder="Написать сообщение по этому запросу"></textarea>
      ${showDeliveryField ? `<label class="supplier-message-form__delivery">
        Доставка, CNY
        <input name="delivery_cost_cny" type="number" min="0" step="0.01" placeholder="0">
      </label>` : ""}
      <div class="supplier-message-form__actions">
        ${sendButton("supplier-button--small")}
      </div>
    </form>
  `;
}

function supplierHasDeliveryCost(request = {}) {
  return request.delivery_cost_cny !== null && request.delivery_cost_cny !== undefined && String(request.delivery_cost_cny) !== "";
}

function formHasDeliveryCost(payload = {}) {
  return Object.prototype.hasOwnProperty.call(payload, "delivery_cost_cny") && plainText(payload.delivery_cost_cny);
}

function formPositiveNumber(value) {
  return Number(String(value || "").replace(",", ".")) > 0;
}

function latestLogisticsEvent(data = {}) {
  return (data.tracking_events || [])
    .filter((event) => ["china_tracking", "china_warehouse"].includes(plainText(event.status)) && plainText(event.tracking_number))
    .sort((a, b) => dateMs(b.created_at) - dateMs(a.created_at))[0] || null;
}

function renderPassportTrackingWidget(data = {}) {
  const request = data.request || {};
  const payment = data.payment || null;
  const trackingEvent = latestLogisticsEvent(data);
  const paid = payment?.status === "paid";
  const trackingSourceReady = ["accepted", "purchased", "china_tracking", "china_warehouse", "problem"].includes(request.status);
  const active = paid && trackingSourceReady;
  const relevant = Boolean(payment) || trackingSourceReady;
  if (!trackingEvent && !relevant) return "";
  if (trackingEvent) {
    return `
      <div class="supplier-passport-tracking supplier-passport-tracking--done">
        <span>Отправка по Китаю</span>
        <strong>${escapeHtml(trackingEvent.status === "china_warehouse" ? "На складе в Китае" : "Отправлено, ждём доставку")}</strong>
        <b>${escapeHtml(trackingEvent.tracking_number)}</b>
      </div>
    `;
  }
  return `
    <form class="supplier-passport-tracking ${active ? "supplier-passport-tracking--active" : "supplier-passport-tracking--disabled"}" data-tracking-form>
      <input name="status" type="hidden" value="china_tracking">
      <label>
        <span>Отправка по Китаю</span>
        <strong>${active ? "Следующий шаг: внесите трек" : "Трек после оплаты"}</strong>
        <input name="tracking_number" placeholder="номер отправки" ${active ? "required" : "disabled"}>
      </label>
      <button class="supplier-button supplier-button--primary supplier-button--small" type="submit" ${active ? "" : "disabled"}>Сохранить</button>
    </form>
  `;
}

function renderBottomTrackingForm(data = {}) {
  const request = data.request || {};
  const payment = data.payment || null;
  const trackingEvent = latestLogisticsEvent(data);
  const paid = payment?.status === "paid";
  const active = paid && ["accepted", "purchased", "problem"].includes(request.status) && !trackingEvent;
  if (!active) return "";
  return `
    <section class="supplier-section supplier-section--tracking">
      <form class="supplier-form supplier-tracking-form" data-tracking-form>
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
    </section>
  `;
}

function renderRequestDetail(data = {}, tokenValue = token) {
  const request = data.request || {};
  return `
    <section class="supplier-card supplier-card--request-passport">
      <div class="supplier-card__head supplier-card__head--request">
        <div class="supplier-card__title">
          <h2>Данные запроса</h2>
          <span class="supplier-muted">${escapeHtml(shortDateTime(request.created_at))}</span>
        </div>
        <div class="supplier-passport-actions">
          ${renderPassportTrackingWidget(data)}
          ${canMarkNoSupply(data) ? noSupplyButton("supplier-button--passport-action") : ""}
        </div>
      </div>
      ${requestImages(data.request_images || [])}
      ${requestData(request)}
    </section>

    <section class="supplier-section supplier-section--dialog">
      ${renderSupplierChat(data)}
      ${renderQuoteForm(data)}
    </section>

    ${renderPayment(data.payment, tokenValue)}
    ${renderBottomTrackingForm(data)}
    ${renderMessageForm(data)}
  `;
}

function renderRequestPage(data) {
  const request = data.request || {};
  root.innerHTML = `
    <header class="supplier-topbar supplier-topbar--request">
      <div class="supplier-brand">
        <strong>EVLine · Запрос</strong>
        <span>${escapeHtml(request.public_number || "")}</span>
      </div>
      <div class="supplier-topbar__aside">
        <span class="supplier-kicker">${escapeHtml(request.supplier_name || "Поставщик")}</span>
        ${statusBadge(request.status)}
      </div>
    </header>

    <section class="supplier-hero supplier-hero--compact">
      <h1>${escapeHtml(request.item_name || "Запрос по детали")}</h1>
    </section>

    ${renderRequestDetail(data, token)}
  `;
}

function supplierAmount(value, currency = "CNY") {
  return `${Number(value || 0).toLocaleString("ru-RU")} ${escapeHtml(currency || "CNY")}`;
}

function paymentLabel(status) {
  const labels = {
    paid: "Оплачено",
    requested: "Ждёт оплаты",
    needs_review: "Скрин на проверке",
    canceled: "Отменено",
  };
  return labels[status] || status || "Оплата";
}

function dashboardSummaryCard(label, value, hint = "") {
  return `
    <article class="supplier-dashboard-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </article>
  `;
}

function renderDashboardSummary(summary = {}) {
  return `
    <section class="supplier-dashboard-stats">
      ${dashboardSummaryCard("Нужно ответить", Number(summary.need_answer || 0).toLocaleString("ru-RU"))}
      ${dashboardSummaryCard("Ждёт оплату", Number(summary.waiting_payment || 0).toLocaleString("ru-RU"))}
      ${dashboardSummaryCard("Нужен трек", Number(summary.paid_needs_tracking || 0).toLocaleString("ru-RU"))}
      ${dashboardSummaryCard("Оплачено за 30 дней", supplierAmount(summary.paid_30_amount, summary.currency), `${Number(summary.paid_30_count || 0)} заказов`)}
    </section>
  `;
}

function dashboardRequestKey(request = {}) {
  return request.supplier_link || request.public_number || `${request.item_name || ""}-${request.created_at || ""}`;
}

function requestTokenFromLink(link = "") {
  const match = String(link || "").match(/\/supplier\/request\/([^/?#]+)/);
  return match ? match[1] : "";
}

function dashboardRequestAsData(request = {}) {
  return {
    request,
    request_images: request.request_images || [],
    quotes: request.quotes || [],
    tracking_events: request.tracking_events || [],
    payment: request.payment || null,
  };
}

function selectedDashboardRequest() {
  if (!dashboardSelectedRequestId) return null;
  return (dashboardData?.requests || []).find((request) => dashboardRequestKey(request) === dashboardSelectedRequestId) || null;
}

function dashboardRequestTrackingLine(request = {}) {
  const data = dashboardRequestAsData(request);
  const trackingEvent = latestLogisticsEvent(data);
  if (trackingEvent) {
    return `
      <div class="supplier-dashboard-tracking supplier-dashboard-tracking--done">
        <span>Трек</span>
        <strong>${escapeHtml(trackingEvent.tracking_number)}</strong>
      </div>
    `;
  }
  const canAddTracking = request.payment?.status === "paid" && ["accepted", "purchased", "problem"].includes(request.status);
  if (!canAddTracking) return "";
  return `
    <form class="supplier-dashboard-tracking supplier-dashboard-tracking--active" data-tracking-form data-request-token="${escapeHtml(requestTokenFromLink(request.supplier_link))}">
      <input name="status" type="hidden" value="china_tracking">
      <label>
        <span>Нужен трек</span>
        <input name="tracking_number" placeholder="номер отправки" required>
      </label>
      <button class="supplier-button supplier-button--primary supplier-button--small" type="submit">Сохранить</button>
    </form>
  `;
}

function renderDashboardRequestCard(request = {}) {
  const payment = request.payment || null;
  const key = dashboardRequestKey(request);
  const selected = dashboardSelectedRequestId === key;
  const statusClass = String(request.status || "sent").replace(/[^a-z0-9_-]/gi, "");
  return `
    <article class="supplier-dashboard-card supplier-dashboard-card--status-${escapeHtml(statusClass)} ${selected ? "is-selected" : ""}">
      <button class="supplier-dashboard-card__open" type="button" data-dashboard-open-request="${escapeHtml(key)}">
        <div class="supplier-card__head">
          <strong>${escapeHtml(request.public_number || "Запрос")}</strong>
          ${statusBadge(request.status)}
        </div>
        <div class="supplier-dashboard-card__title">${escapeHtml(request.item_name || "Деталь")}</div>
        <div class="supplier-dashboard-card__meta">
          <span>${escapeHtml(request.car || "Авто не указано")}${request.car_year ? ` · ${escapeHtml(request.car_year)}` : ""}</span>
          ${payment ? `<span>${escapeHtml(paymentLabel(payment.status))}${payment.requested_amount ? ` · ${supplierAmount(payment.paid_amount || payment.requested_amount, payment.paid_currency || payment.requested_currency)}` : ""}</span>` : ""}
          ${request.delivery_cost_cny !== null && request.delivery_cost_cny !== undefined ? `<span>Доставка: ${supplierAmount(request.delivery_cost_cny, "CNY")}</span>` : ""}
        </div>
      </button>
      ${dashboardRequestTrackingLine(request)}
    </article>
  `;
}

function renderDashboardWork(requests = []) {
  const sorted = [...requests].sort((a, b) => (dateMs(b.created_at) - dateMs(a.created_at)) || (dateMs(b.updated_at) - dateMs(a.updated_at)));
  return `
    <section class="supplier-dashboard-panel">
      <div class="supplier-dashboard-panel__head">
        <h2>Работа</h2>
        <span class="supplier-muted">${Number(requests.length || 0)} активных</span>
      </div>
      <div class="supplier-dashboard">
        ${sorted.length ? sorted.map(renderDashboardRequestCard).join("") : `<div class="supplier-empty"><strong>Пока нет активных запросов</strong><span class="supplier-muted">Новые запросы EVLine появятся здесь.</span></div>`}
      </div>
    </section>
  `;
}

function renderDashboardPaymentCard(payment = {}) {
  return `
    <a class="supplier-dashboard-payment" href="${escapeHtml(payment.supplier_link || "#")}">
      <div>
        <strong>${escapeHtml(payment.request_public_number || payment.payment_number || "Оплата")}</strong>
        <span>${escapeHtml(payment.item_name || "Запрос EVLine")}</span>
      </div>
      <div>
        <b>${supplierAmount(payment.amount, payment.currency)}</b>
        <span>${escapeHtml(paymentLabel(payment.status))}${payment.receipt_present ? " · скрин есть" : ""}</span>
      </div>
    </a>
  `;
}

function renderDashboardMoney(data = {}) {
  const summary = data.summary || {};
  const payments = data.payments || [];
  return `
    <section class="supplier-dashboard-panel">
      <div class="supplier-dashboard-panel__head">
        <h2>Деньги</h2>
        <span class="supplier-muted">${Number(summary.paid_total_count || 0)} оплаченных заказов</span>
      </div>
      <div class="supplier-money-summary">
        ${dashboardSummaryCard("Оплачено всего", supplierAmount(summary.paid_total_amount, summary.currency))}
        ${dashboardSummaryCard("Ждёт оплаты", supplierAmount(summary.waiting_amount, summary.currency), `${Number(summary.waiting_count || 0)} заказов`)}
      </div>
      <div class="supplier-dashboard-payments">
        ${payments.length ? payments.map(renderDashboardPaymentCard).join("") : `<div class="supplier-empty"><strong>Оплат пока нет</strong><span class="supplier-muted">Когда EVLine оплатит заказ, он появится здесь.</span></div>`}
      </div>
    </section>
  `;
}

function renderDashboardTabs() {
  return `
    <div class="supplier-dashboard-tabs" role="tablist" aria-label="Раздел кабинета">
      <button type="button" class="${dashboardTab === "work" ? "is-active" : ""}" data-dashboard-tab="work">Работа</button>
      <button type="button" class="${dashboardTab === "money" ? "is-active" : ""}" data-dashboard-tab="money">Деньги</button>
    </div>
  `;
}

function renderDashboardRequestPanel() {
  const request = selectedDashboardRequest();
  if (!request) return "";
  const requestToken = requestTokenFromLink(request.supplier_link);
  return `
    <div class="supplier-request-panel-backdrop" data-dashboard-close-request></div>
    <aside class="supplier-request-panel" data-request-token="${escapeHtml(requestToken)}" aria-label="Карточка запроса">
      <div class="supplier-request-panel__head">
        <div>
          <strong>${escapeHtml(request.public_number || "Запрос")}</strong>
          <span>${escapeHtml(request.item_name || "Деталь")}${request.car ? ` · ${escapeHtml(request.car)}` : ""}</span>
        </div>
        <button class="supplier-button supplier-button--small" type="button" data-dashboard-close-request>Назад</button>
      </div>
      <div class="supplier-request-panel__body">
        ${renderRequestDetail(dashboardRequestAsData(request), requestToken)}
      </div>
    </aside>
  `;
}

function renderDashboardPage(data) {
  dashboardData = data;
  const requests = data.requests || [];
  if (dashboardSelectedRequestId && !requests.some((request) => dashboardRequestKey(request) === dashboardSelectedRequestId)) {
    dashboardSelectedRequestId = "";
  }
  root.innerHTML = `
    <header class="supplier-topbar">
      <div class="supplier-brand">
        <strong>EVLine · Кабинет поставщика</strong>
        <span>${escapeHtml(data.supplier?.name || "Поставщик")}</span>
      </div>
    </header>
    <section class="supplier-hero">
      <h1>${escapeHtml(data.supplier?.name || "Поставщик")}</h1>
      ${renderDashboardSummary(data.summary || {})}
    </section>
    ${renderDashboardTabs()}
    ${dashboardTab === "money" ? renderDashboardMoney(data) : renderDashboardWork(requests)}
    ${renderDashboardRequestPanel()}
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

function supplierTokenForElement(element) {
  return element?.closest?.("[data-request-token]")?.dataset.requestToken || token;
}

async function renderAfterSupplierMutation(data) {
  if (page === "dashboard") {
    await loadDashboard();
    return;
  }
  renderRequestPage(data);
}

function supplierHasActiveEditor() {
  const element = document.activeElement;
  if (!element || !root?.contains(element)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

async function loadRequest() {
  const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(token)}`);
  if (supplierHasActiveEditor()) return;
  renderRequestPage(data);
  startRequestPolling();
}

async function loadDashboard() {
  const data = await supplierApi(`/api/supplier/dashboard/${encodeURIComponent(token)}`);
  renderDashboardPage(data);
}

function startRequestPolling() {
  if (requestPollTimer || page !== "request") return;
  requestPollTimer = setInterval(() => {
    if (document.hidden || supplierHasActiveEditor()) return;
    loadRequest().catch(() => null);
  }, 15000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && page === "request" && token) {
    loadRequest().catch(() => null);
  }
});

root?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button[type='submit']");
  const requestToken = supplierTokenForElement(form);
  setButtonBusy(button, true);
  try {
    if (form.matches("[data-answer-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      const hasPrice = formPositiveNumber(payload.price_cny);
      const hasComment = Boolean(plainText(payload.comment_cn));
      const hasDelivery = Boolean(formHasDeliveryCost(payload));
      if (!hasPrice && !hasComment && !hasDelivery) {
        throw new Error(form.elements.namedItem("delivery_cost_cny") ? "Укажите цену, доставку или комментарий." : "Укажите цену или комментарий.");
      }
      payload.action = hasPrice ? "quote" : hasComment ? "needs_info" : "delivery_cost";
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(requestToken)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await renderAfterSupplierMutation(data);
      return;
    }
    if (form.matches("[data-tracking-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(requestToken)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await renderAfterSupplierMutation(data);
      return;
    }
    if (form.matches("[data-message-form]")) {
      const payload = Object.fromEntries(new FormData(form));
      const hasComment = Boolean(plainText(payload.comment_cn));
      const hasDelivery = Boolean(formHasDeliveryCost(payload));
      if (!hasComment && !hasDelivery) {
        throw new Error(form.elements.namedItem("delivery_cost_cny") ? "Напишите сообщение или укажите доставку." : "Напишите сообщение.");
      }
      payload.action = hasComment ? "message" : "delivery_cost";
      const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(requestToken)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await renderAfterSupplierMutation(data);
      return;
    }
  } catch (error) {
    alert(error.message);
    setButtonBusy(button, false);
  }
});

root?.addEventListener("click", async (event) => {
  const openRequestButton = event.target.closest("[data-dashboard-open-request]");
  if (openRequestButton) {
    dashboardSelectedRequestId = openRequestButton.dataset.dashboardOpenRequest || "";
    renderDashboardPage(dashboardData || {});
    return;
  }

  if (event.target.closest("[data-dashboard-close-request]")) {
    dashboardSelectedRequestId = "";
    renderDashboardPage(dashboardData || {});
    return;
  }

  const tabButton = event.target.closest("[data-dashboard-tab]");
  if (tabButton) {
    dashboardTab = tabButton.dataset.dashboardTab || "work";
    renderDashboardPage(dashboardData || {});
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action !== "no_stock") return;
  if (!confirm("Отметить, что по этой позиции нет поставки?")) return;
  setButtonBusy(button, true);
  try {
    const requestToken = supplierTokenForElement(button);
    const data = await supplierApi(`/api/supplier/request/${encodeURIComponent(requestToken)}`, {
      method: "POST",
      body: JSON.stringify({ action, comment_cn: "" }),
    });
    await renderAfterSupplierMutation(data);
  } catch (error) {
    alert(error.message);
    setButtonBusy(button, false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || page !== "dashboard" || !dashboardSelectedRequestId) return;
  dashboardSelectedRequestId = "";
  renderDashboardPage(dashboardData || {});
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
