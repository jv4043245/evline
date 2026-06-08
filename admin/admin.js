const state = {
  range: "30d",
  activeTab: localStorage.getItem("evline_admin_tab") || "orders",
  orders: [],
  selectedOrder: null,
  selectedEvents: [],
  selectedNotifications: [],
};

const statusLabels = {
  new: "Нова заявка",
  accepted: "Прийнято в роботу",
  proposal_sent: "Пропозицію відправлено",
  paid: "Оплачено",
  sourcing_china: "Шукаємо / замовляємо в Китаї",
  china_warehouse: "На складі в Китаї",
  left_china: "Виїхало з Китаю",
  in_ukraine: "В Україні",
  ready_for_pickup: "Готово до видачі",
  completed: "Завершено",
  canceled: "Скасовано",
};

const typeLabels = {
  parts: "Запчастини",
  byd: "BYD",
  other: "Інше",
};

const paymentLabels = {
  unknown: "оплата не вказана",
  unpaid: "не оплачено",
  partial: "часткова оплата",
  paid: "оплачено",
  refunded: "повернення",
};

const money = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 0,
});

const numberFmt = new Intl.NumberFormat("uk-UA");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textOrDash(value) {
  const valueText = String(value ?? "").trim();
  return valueText ? escapeHtml(valueText) : "-";
}

function safeClass(value) {
  return String(value || "new").replace(/[^a-z0-9_-]/gi, "");
}

function adminToken() {
  return localStorage.getItem("evline_admin_token") || "";
}

function headers(extra = {}) {
  const token = adminToken();
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: headers(options.headers || {}),
  });
  if (!response.ok) {
    const message = response.status === 401 ? "Немає доступу. Перевірте Cloudflare Access або ADMIN_TOKEN." : await response.text();
    throw new Error(message);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

function setText(selector, value) {
  document.querySelectorAll(`[data-kpi="${selector}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function setAuthVisible(visible) {
  const panel = document.querySelector("[data-auth-panel]");
  if (panel) panel.hidden = !visible && adminToken();
}

function setActiveTab(tab) {
  const nextTab = tab === "analytics" ? "analytics" : "orders";
  state.activeTab = nextTab;
  localStorage.setItem("evline_admin_tab", nextTab);

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const isActive = button.dataset.adminTab === nextTab;
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-admin-view]").forEach((view) => {
    view.hidden = view.dataset.adminView !== nextTab;
  });
}

function renderSummary(data) {
  const totals = data.totals || {};
  setText("leads", numberFmt.format(totals.leads || 0));
  setText("new_leads", numberFmt.format(totals.new_leads || 0));
  setText("active_orders", numberFmt.format(totals.active_orders || 0));
  setText("completed_orders", numberFmt.format(totals.completed_orders || 0));
  setText("revenue_uah", money.format(totals.revenue_uah || 0));
  setText("avg_order_uah", money.format(totals.avg_order_uah || 0));
  setText("ad_spend_uah", money.format(totals.ad_spend_uah || 0));
  setText("cpl_uah", money.format(totals.cpl_uah || 0));
  setText("gross_profit_uah", money.format(totals.gross_profit_uah || 0));
  setText("profit_roas", `${Number(totals.profit_roas || 0).toFixed(1)}x`);
  setText("roas", `${Number(totals.roas || 0).toFixed(1)}x`);
  setText("close_rate", `${Math.round((totals.close_rate || 0) * 100)}%`);
  renderChart(data.daily || []);
  renderSources(data.sources || []);
  renderInsights(data);
}

function renderChart(days) {
  const chart = document.querySelector("[data-chart]");
  if (!chart) return;
  const max = Math.max(1, ...days.map((day) => day.orders || 0));
  chart.innerHTML = days
    .map((day) => {
      const height = Math.max(3, Math.round(((day.orders || 0) / max) * 180));
      const label = escapeHtml(`${day.day || "-"}: ${day.orders || 0} замовлень`);
      return `<div class="mini-chart__bar" style="height:${height}px" data-label="${label}"></div>`;
    })
    .join("");
}

function renderSources(sources) {
  const root = document.querySelector("[data-sources]");
  if (!root) return;
  const max = Math.max(1, ...sources.map((source) => source.orders || 0));
  root.innerHTML = sources.length
    ? sources
        .map((source) => {
          const width = Math.round(((source.orders || 0) / max) * 100);
          return `
            <div class="source-item">
              <strong>${textOrDash(source.source)}</strong>
              <span>${source.orders || 0} / ${money.format(source.gross_profit_uah || 0)}</span>
              <div class="source-meter"><span style="width:${width}%"></span></div>
            </div>
          `;
        })
        .join("")
    : "<p class=\"muted\">Поки немає джерел.</p>";
}

function renderInsights(data) {
  const root = document.querySelector("[data-insights]");
  if (!root) return;
  const totals = data.totals || {};
  const insights = [];

  if ((totals.orders || 0) === 0) {
    insights.push(["Поки немає замовлень", "Після перших заявок тут з'являться рекомендації щодо реклами, SEO і роботи менеджера."]);
  } else {
    const profit = Number(totals.gross_profit_uah || 0);
    if (profit <= 0 && Number(totals.revenue_uah || 0) > 0) {
      insights.push(["Прибуток ще не видно", "Заповнюйте закупку, доставку, мито, рекламу та інші витрати у картці замовлення."]);
    }
    if ((totals.cpl_uah || 0) > 0 && (totals.avg_order_uah || 0) > 0 && totals.cpl_uah > totals.avg_order_uah * 0.2) {
      insights.push(["CPL зависокий відносно середнього чеку", "Варто розділяти кампанії по брендах і відключати запити з низькою якістю."]);
    }
    if ((totals.active_orders || 0) > 0) {
      insights.push(["Є активні замовлення", "Оновлюйте статуси після кожного етапу: це база для прозорості клієнту і майбутнього Telegram-бота."]);
    }
    if ((totals.ad_spend_uah || 0) === 0) {
      insights.push(["Немає витрат по рекламі", "Додайте витрати Google/Facebook, щоб рахувати CPL, CPA, ROAS і profit ROAS."]);
    }
  }

  root.innerHTML = insights
    .map(([title, body]) => `<div class="insight"><strong>${title}</strong><span>${body}</span></div>`)
    .join("");
}

function badge(status) {
  return `<span class="badge badge--${safeClass(status)}">${escapeHtml(statusLabels[status] || status || "new")}</span>`;
}

function paymentLabel(value) {
  return paymentLabels[value] || value || "оплата не вказана";
}

function shortDate(value) {
  return value ? new Date(value).toLocaleDateString("uk-UA") : "-";
}

function shortDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderOrders() {
  const root = document.querySelector("[data-orders]");
  if (!root) return;
  root.innerHTML = state.orders.length
    ? state.orders
        .map((order) => {
          const request = order.item_name || order.service_name || order.request_text || "";
          const contact = order.customer_phone || order.customer_email || order.customer_telegram || "";
          return `
            <tr data-order-id="${escapeHtml(order.id)}">
              <td>${escapeHtml(shortDateTime(order.created_at))}<br><span class="muted">${escapeHtml(typeLabels[order.type] || order.type || "-")}</span></td>
              <td><strong>${textOrDash(order.customer_name || "Без імені")}</strong><br><span class="muted">${textOrDash(contact)}</span></td>
              <td>${textOrDash(order.car)}<br><span class="muted">${textOrDash(order.vin)}</span><br><span class="muted">${textOrDash(request)}</span></td>
              <td>${textOrDash(order.source || "site")}<br><span class="muted">${textOrDash(order.campaign || "без кампанії")}</span></td>
              <td>${badge(order.status || "new")}<br><span class="muted">Далі: ${textOrDash(order.next_action_at ? shortDate(order.next_action_at) : "")}</span></td>
              <td>${money.format(order.revenue_uah || 0)}<br><span class="muted">${escapeHtml(paymentLabel(order.payment_status))}</span></td>
              <td>${textOrDash(order.tracking_carrier)}<br><span class="muted">${textOrDash(order.tracking_number)}</span></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">Замовлень за обраними фільтрами немає.</td></tr>`;
}

function messagePreview(order, status) {
  const label = statusLabels[status] || statusLabels.new;
  const item = order.item_name || order.service_name || "ваше замовлення";
  const managerContact = order.manager_contact || (order.type === "byd" ? "@evline_tech" : "@evline_support");
  const lines = [
    `Добрий день! Статус EVLine оновлено: ${label}.`,
    `Замовлення: ${item}`,
  ];
  if (order.car) lines.push(`Авто: ${order.car}`);
  if (order.tracking_number) lines.push(`Трек-номер: ${order.tracking_number}`);
  lines.push(`Менеджер EVLine: ${managerContact}`);
  return lines.join("\n");
}

function renderOrderEditor(order) {
  const form = document.querySelector("[data-order-editor]");
  if (!form) return;
  if (!order) {
    form.innerHTML = `<p class="muted">Оберіть замовлення в таблиці.</p>`;
    return;
  }

  const costs =
    Number(order.purchase_cost_uah || 0) +
    Number(order.delivery_cost_uah || 0) +
    Number(order.customs_cost_uah || 0) +
    Number(order.processing_cost_uah || 0) +
    Number(order.ad_cost_uah || 0) +
    Number(order.other_cost_uah || 0);
  const profit = Number(order.revenue_uah || 0) - costs;

  form.innerHTML = `
    <div class="order-editor__meta">
      <p><strong>${textOrDash(order.customer_name || "Без імені")}</strong> · ${textOrDash(order.customer_phone || order.customer_email || order.customer_telegram)}</p>
      <p>${textOrDash(order.car)} · VIN: ${textOrDash(order.vin)}</p>
      <p class="muted">${textOrDash(order.request_text || order.item_name || order.service_name)}</p>
      <p class="muted">Джерело: ${textOrDash(order.source || "site")} / ${textOrDash(order.medium)} / ${textOrDash(order.campaign || "без кампанії")}</p>
      <p class="muted">Менеджер напряму: ${textOrDash(order.manager_contact || (order.type === "byd" ? "@evline_tech" : "@evline_support"))}</p>
    </div>

    <input type="hidden" name="id" value="${escapeHtml(order.id)}">

    <label>
      Статус
      <select name="status" data-status-input>
        ${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label>
      Тип
      <select name="type">
        ${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${order.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label>
      Менеджер напряму
      <input name="manager_contact" value="${escapeHtml(order.manager_contact || (order.type === "byd" ? "@evline_tech" : "@evline_support"))}">
    </label>

    <label>
      Ім'я клієнта
      <input name="customer_name" value="${escapeHtml(order.customer_name || "")}">
    </label>
    <label>
      Телефон
      <input name="customer_phone" value="${escapeHtml(order.customer_phone || "")}">
    </label>
    <label>
      Telegram клієнта
      <input name="customer_telegram" value="${escapeHtml(order.customer_telegram || "")}" placeholder="@username">
    </label>
    <label>
      Telegram chat_id
      <input name="telegram_chat_id" value="${escapeHtml(order.telegram_chat_id || order.customer_telegram_chat_id || "")}" placeholder="з'явиться після прив'язки бота">
    </label>
    <label class="wide">
      Команда клієнту для підключення Telegram-статусів
      <input value="/start order_${escapeHtml(order.id)}" readonly>
    </label>

    <label>
      Авто / модель
      <input name="car" value="${escapeHtml(order.car || "")}">
    </label>
    <label>
      VIN
      <input name="vin" value="${escapeHtml(order.vin || "")}">
    </label>
    <label>
      Запчастина
      <input name="item_name" value="${escapeHtml(order.item_name || "")}" placeholder="крило, бампер, скло...">
    </label>
    <label>
      Послуга
      <input name="service_name" value="${escapeHtml(order.service_name || "")}" placeholder="Програмування BYD">
    </label>
    <label class="wide">
      Запит клієнта
      <textarea name="request_text" rows="3">${escapeHtml(order.request_text || "")}</textarea>
    </label>

    <label>
      Перевізник
      <input name="tracking_carrier" value="${escapeHtml(order.tracking_carrier || "")}" placeholder="MIST China">
    </label>
    <label>
      Трек-номер
      <input name="tracking_number" value="${escapeHtml(order.tracking_number || "")}">
    </label>
    <label class="wide">
      Посилання на трекінг
      <input name="tracking_url" value="${escapeHtml(order.tracking_url || "")}">
    </label>

    <div class="order-editor__section wide">
      <strong>Фінанси</strong>
      <span>Витрати: ${money.format(costs)} · маржа: ${money.format(profit)}</span>
    </div>
    <label>
      Виручка, грн
      <input name="revenue_uah" type="number" step="0.01" min="0" value="${Number(order.revenue_uah || 0)}">
    </label>
    <label>
      Закупка, грн
      <input name="purchase_cost_uah" type="number" step="0.01" min="0" value="${Number(order.purchase_cost_uah || 0)}">
    </label>
    <label>
      Доставка, грн
      <input name="delivery_cost_uah" type="number" step="0.01" min="0" value="${Number(order.delivery_cost_uah || 0)}">
    </label>
    <label>
      Мито / оформлення, грн
      <input name="customs_cost_uah" type="number" step="0.01" min="0" value="${Number(order.customs_cost_uah || 0)}">
    </label>
    <label>
      Обробка, грн
      <input name="processing_cost_uah" type="number" step="0.01" min="0" value="${Number(order.processing_cost_uah || 0)}">
    </label>
    <label>
      Інші витрати, грн
      <input name="other_cost_uah" type="number" step="0.01" min="0" value="${Number(order.other_cost_uah || 0)}">
    </label>
    <label>
      Наступна дія
      <input name="next_action_at" type="date" value="${escapeHtml(order.next_action_at ? String(order.next_action_at).slice(0, 10) : "")}">
    </label>

    <label class="wide order-editor__notify">
      <input name="notify_customer" type="checkbox" value="1" checked>
      <span>Підготувати повідомлення клієнту при зміні статусу</span>
    </label>
    <label class="wide">
      Текст повідомлення клієнту
      <textarea name="customer_message" rows="5" data-message-preview>${escapeHtml(messagePreview(order, order.status || "new"))}</textarea>
    </label>
    <label class="wide">
      Коментар до зміни статусу
      <input name="status_comment" placeholder="коротка внутрішня нотатка для історії">
    </label>
    <label class="wide">
      Коментар менеджера
      <textarea name="manager_notes" rows="4">${escapeHtml(order.manager_notes || "")}</textarea>
    </label>

    <div class="order-editor__history wide">
      <strong>Історія статусів</strong>
      ${renderEvents()}
    </div>
    <div class="order-editor__history wide">
      <strong>Telegram-повідомлення клієнту</strong>
      ${renderNotifications()}
    </div>

    <button class="admin-btn admin-btn--primary wide" type="submit">Зберегти замовлення</button>
  `;

  form.querySelector("[data-status-input]")?.addEventListener("change", (event) => {
    const preview = form.querySelector("[data-message-preview]");
    if (preview) preview.value = messagePreview(order, event.target.value);
  });
}

function renderNotifications() {
  if (!state.selectedNotifications.length) {
    return `<p class="muted">Повідомлень ще немає. Вони з'являться після зміни статусу з увімкненим чекбоксом повідомлення.</p>`;
  }
  return `
    <ol class="event-list notification-list">
      ${state.selectedNotifications
        .map(
          (notification) => `
            <li>
              <strong class="notification-status notification-status--${safeClass(notification.status)}">${escapeHtml(notification.status || "pending")}</strong>
              <span>${escapeHtml(shortDateTime(notification.created_at))} · ${textOrDash(notification.recipient_contact)} · спроб: ${Number(notification.attempts || 0)}</span>
              ${notification.error ? `<p>${escapeHtml(notification.error)}</p>` : ""}
              ${notification.status !== "sent" ? `<button class="admin-btn admin-btn--small" type="button" data-retry-notification="${escapeHtml(notification.id)}">Повторити відправку</button>` : ""}
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

function renderEvents() {
  if (!state.selectedEvents.length) return `<p class="muted">Історія ще порожня.</p>`;
  return `
    <ol class="event-list">
      ${state.selectedEvents
        .map(
          (event) => `
            <li>
              <strong>${escapeHtml(statusLabels[event.status] || event.status)}</strong>
              <span>${escapeHtml(shortDateTime(event.created_at))} · ${textOrDash(event.actor)} · повідомлення: ${textOrDash(event.notification_status)}</span>
              ${event.comment ? `<p>${escapeHtml(event.comment)}</p>` : ""}
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

async function loadSummary() {
  const data = await api(`/api/admin/summary?range=${encodeURIComponent(state.range)}`);
  renderSummary(data);
}

async function loadOrders() {
  const params = new URLSearchParams({
    range: state.range,
    status: document.querySelector("#status-filter")?.value || "all",
    type: document.querySelector("#type-filter")?.value || "all",
    q: document.querySelector("#search")?.value || "",
    limit: "100",
  });
  const data = await api(`/api/admin/orders?${params}`);
  state.orders = data.orders || [];
  renderOrders();
}

async function loadOrder(id) {
  const data = await api(`/api/admin/orders/${encodeURIComponent(id)}`);
  state.selectedOrder = data.order;
  state.selectedEvents = data.events || [];
  state.selectedNotifications = data.notifications || [];
  renderOrderEditor(state.selectedOrder);
}

async function refresh() {
  try {
    state.range = document.querySelector("#range")?.value || "30d";
    const exportLink = document.querySelector("[data-export]");
    if (exportLink) exportLink.href = `/api/admin/orders?format=csv&range=${encodeURIComponent(state.range)}`;
    await Promise.all([loadSummary(), loadOrders()]);
    setAuthVisible(false);
  } catch (error) {
    setAuthVisible(true);
    alert(error.message);
  }
}

document.querySelector("[data-token-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = new FormData(event.currentTarget).get("token");
  if (token) localStorage.setItem("evline_admin_token", token);
  refresh();
});

document.querySelector("[data-clear-token]")?.addEventListener("click", () => {
  localStorage.removeItem("evline_admin_token");
  setAuthVisible(true);
});

document.querySelector("[data-refresh]")?.addEventListener("click", refresh);
document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.adminTab));
});
document.querySelector("[data-export]")?.addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api(`/api/admin/orders?format=csv&range=${encodeURIComponent(state.range)}`, {
      headers: { accept: "text/csv" },
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `evline-orders-${state.range}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
});
document.querySelector("#range")?.addEventListener("change", refresh);
document.querySelector("#status-filter")?.addEventListener("change", loadOrders);
document.querySelector("#type-filter")?.addEventListener("change", loadOrders);
document.querySelector("#search")?.addEventListener("input", () => {
  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(loadOrders, 250);
});

document.querySelector("[data-orders]")?.addEventListener("click", (event) => {
  const row = event.target.closest("[data-order-id]");
  if (!row) return;
  loadOrder(row.dataset.orderId).catch((error) => alert(error.message));
});

document.querySelector("[data-order-editor]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (!data.id) return;
  if (!event.currentTarget.querySelector("[name='notify_customer']")?.checked) data.notify_customer = "0";
  const result = await api(`/api/admin/orders/${encodeURIComponent(data.id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  state.selectedOrder = result.order;
  state.selectedEvents = result.events || [];
  state.selectedNotifications = result.notifications || state.selectedNotifications;
  renderOrderEditor(result.order);
  await refresh();
});

document.querySelector("[data-order-editor]")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-retry-notification]");
  if (!button) return;
  button.disabled = true;
  const notificationId = button.dataset.retryNotification;
  try {
    await api(`/api/admin/notifications/${encodeURIComponent(notificationId)}/retry`, {
      method: "POST",
      body: "{}",
    });
    if (state.selectedOrder?.id) await loadOrder(state.selectedOrder.id);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("[data-cost-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  await api("/api/admin/costs", {
    method: "POST",
    body: JSON.stringify(data),
  });
  event.currentTarget.reset();
  await refresh();
});

setActiveTab(state.activeTab);
refresh();
