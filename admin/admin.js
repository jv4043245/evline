const state = {
  range: "30d",
  activeTab: localStorage.getItem("evline_admin_tab") || "orders",
  orders: [],
  selectedOrder: null,
  orderEditorTab: "main",
  selectedEvents: [],
  selectedNotifications: [],
  selectedTrackingEvents: [],
  selectedSupplierPayments: [],
  shipping: {
    carriers: [],
    rates: [],
    migrationRequired: false,
  },
  googleAds: {
    conversions: [],
    summary: {},
    byEventType: [],
    settings: {},
    migrationRequired: false,
    apiReady: false,
    apiMissing: [],
    apiVersion: "",
  },
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

const compactStatusLabels = {
  new: "Нова",
  accepted: "В роботі",
  proposal_sent: "КП",
  paid: "Оплачено",
  sourcing_china: "Пошук CN",
  china_warehouse: "Склад CN",
  left_china: "Виїхало CN",
  in_ukraine: "В Україні",
  ready_for_pickup: "Готово",
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

const supplierPaymentStatusLabels = {
  requested: "Очікує оплати",
  needs_review: "Перевірити",
  paid: "Оплачено",
  canceled: "Скасовано",
};

const shippingModeLabels = {
  air: "Авіа",
  sea: "Море",
};

const rateUnitLabels = {
  kg: "кг",
  m3: "м3",
  item: "замовлення",
};

const googleAdsEventLabels = {
  lead: "Лід",
  paid: "Оплата",
  completed: "Завершення",
};

const googleAdsStatusLabels = {
  queued: "готово",
  skipped: "пропущено",
  uploaded: "відправлено",
  failed: "помилка",
};

const adminTabs = new Set(["orders", "analytics", "delivery"]);
const orderEditorTabs = new Set(["main", "delivery", "payment", "messages", "history"]);

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
  const nextTab = adminTabs.has(tab) ? tab : "orders";
  state.activeTab = nextTab;
  localStorage.setItem("evline_admin_tab", nextTab);

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const isActive = button.dataset.adminTab === nextTab;
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-admin-view]").forEach((view) => {
    view.hidden = view.dataset.adminView !== nextTab;
  });

  if (nextTab !== "orders") setOrderDetailOpen(false);
  if (nextTab === "delivery") renderShippingDirectory();
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

function googleAdsIdentifierLabel(row) {
  if (row.gclid) return "gclid";
  if (row.gbraid) return "gbraid";
  if (row.wbraid) return "wbraid";
  if (Number(row.has_customer_identifier) === 1) return "enhanced";
  return "немає";
}

const attributionLabels = {
  google_ads: "Google Ads",
  organic: "Organic",
  direct: "Direct",
  referral: "Referral",
  social: "Social",
  other: "Інше",
};

function attributionType(row = {}) {
  const source = plainText(row.source).toLowerCase();
  const medium = plainText(row.medium).toLowerCase();
  const referrer = plainText(row.referrer).toLowerCase();
  const internalReferrer = /\/\/(www\.)?(evline\.com\.ua|evline\.pages\.dev|jv4043245\.github\.io)/.test(referrer);
  if (row.attribution_type) return row.attribution_type;
  if (row.gclid || row.gbraid || row.wbraid || (source === "google" && /(cpc|ppc|paid|ads?)/.test(medium))) return "google_ads";
  if (medium === "organic" || (source === "google" && !medium) || /\/\/(www\.)?google\./.test(referrer)) return "organic";
  if ((!source || source === "site" || source === "direct") && !medium && (!referrer || internalReferrer)) return "direct";
  if (/facebook|instagram|tiktok|youtube|telegram|social/.test(source) || row.fbclid) return "social";
  if (referrer) return "referral";
  return "other";
}

function clickIdentifier(row = {}) {
  if (row.gclid) return "gclid";
  if (row.gbraid) return "gbraid";
  if (row.wbraid) return "wbraid";
  return "";
}

function attributionCell(row = {}) {
  const type = attributionType(row);
  const campaign = row.campaign || "без кампанії";
  const click = clickIdentifier(row);
  const term = row.term || "";
  return `
    <span class="source-badge source-badge--${safeClass(type)}">${escapeHtml(attributionLabels[type] || type)}</span>
    <br><span class="muted">${textOrDash(row.source || "site")} / ${textOrDash(row.medium)}</span>
    <br><span class="muted">${textOrDash(campaign)}</span>
    ${term ? `<br><span class="muted">term: ${escapeHtml(term)}</span>` : ""}
    ${click ? `<br><span class="click-badge">${escapeHtml(click)} є</span>` : ""}
  `;
}

function shortUrl(value) {
  const raw = plainText(value);
  if (!raw) return "-";
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}${url.search ? "?" : ""}${url.search ? url.search.slice(1, 42) : ""}`;
  } catch {
    return raw.length > 64 ? `${raw.slice(0, 61)}...` : raw;
  }
}

function attributionDetails(order = {}) {
  const click = clickIdentifier(order);
  return `
    <details class="attribution-details">
      <summary>Атрибуція: ${escapeHtml(attributionLabels[attributionType(order)] || attributionType(order))}${click ? ` · ${escapeHtml(click)}` : ""}</summary>
      <dl>
        <div><dt>Source / medium</dt><dd>${textOrDash(order.source || "site")} / ${textOrDash(order.medium)}</dd></div>
        <div><dt>Campaign</dt><dd>${textOrDash(order.campaign || "без кампанії")}</dd></div>
        <div><dt>Keyword / term</dt><dd>${textOrDash(order.term)}</dd></div>
        <div><dt>Content</dt><dd>${textOrDash(order.content)}</dd></div>
        <div><dt>Click ID</dt><dd>${textOrDash(click)}${click ? " збережено" : ""}</dd></div>
        <div><dt>Landing page</dt><dd>${order.landing_page ? `<a href="${escapeHtml(order.landing_page)}" target="_blank" rel="noopener">${escapeHtml(shortUrl(order.landing_page))}</a>` : "-"}</dd></div>
        <div><dt>Page URL</dt><dd>${order.page_url ? `<a href="${escapeHtml(order.page_url)}" target="_blank" rel="noopener">${escapeHtml(shortUrl(order.page_url))}</a>` : "-"}</dd></div>
        <div><dt>Form</dt><dd>${textOrDash(order.form_name || order.form_id)}</dd></div>
        <div><dt>Submitted</dt><dd>${textOrDash(shortDateTime(order.submitted_at || order.created_at))}</dd></div>
        <div><dt>Referrer</dt><dd>${order.referrer ? `<span title="${escapeHtml(order.referrer)}">${escapeHtml(shortUrl(order.referrer))}</span>` : "-"}</dd></div>
      </dl>
    </details>
  `;
}

function renderGoogleAds(data = state.googleAds) {
  const statusNode = document.querySelector("[data-google-ads-status]");
  const summaryRoot = document.querySelector("[data-google-ads-summary]");
  const tableRoot = document.querySelector("[data-google-ads-conversions]");
  if (!statusNode || !summaryRoot || !tableRoot) return;

  if (data.migrationRequired) {
    statusNode.textContent = "Потрібно застосувати D1-міграцію Google Ads перед використанням черги.";
    summaryRoot.innerHTML = "";
    tableRoot.innerHTML = `<tr><td colspan="7" class="muted">Міграція ще не застосована.</td></tr>`;
    return;
  }

  if (data.error) {
    statusNode.textContent = `Google Ads черга: ${data.error}`;
  }

  const summary = data.summary || {};
  const settings = data.settings || {};
  if (!data.error) {
    const missing = (data.apiMissing || []).map((item) => item.name || item).filter(Boolean);
    statusNode.textContent = `Customer ID: ${settings.customer_id || "4028488894"} · API ${
      data.apiVersion || "v22"
    }: ${data.apiReady ? "готовий до відправки" : `поки CSV/черга · бракує ${missing.length || "ключів"}`}`;
  }

  const eventBreakdown = (data.byEventType || [])
    .map((item) => `${googleAdsEventLabels[item.event_type] || item.event_type}: ${item.total || 0}`)
    .join(" · ");

  summaryRoot.innerHTML = `
    <div class="google-ads-summary__item">
      <span>Усього</span>
      <strong>${numberFmt.format(summary.total || 0)}</strong>
    </div>
    <div class="google-ads-summary__item">
      <span>Готово</span>
      <strong>${numberFmt.format(summary.queued || 0)}</strong>
    </div>
    <div class="google-ads-summary__item">
      <span>Відправлено</span>
      <strong>${numberFmt.format(summary.uploaded || 0)}</strong>
    </div>
    <div class="google-ads-summary__item">
      <span>Пропущено</span>
      <strong>${numberFmt.format(summary.skipped || 0)}</strong>
    </div>
    <div class="google-ads-summary__item">
      <span>Помилки</span>
      <strong>${numberFmt.format(summary.failed || 0)}</strong>
    </div>
    <p class="muted">${escapeHtml(eventBreakdown || "Події ще не підготовлені.")}</p>
    ${
      data.apiReady
        ? ""
        : `<p class="muted">Для прямої відправки додайте в Cloudflare: ${escapeHtml(
            (data.apiMissing || []).map((item) => item.name || item).join(", ") || "Google Ads secrets"
          )}</p>`
    }
  `;

  tableRoot.innerHTML = data.conversions?.length
    ? data.conversions
        .map((row) => {
          const orderText = row.item_name || row.service_name || row.car || row.vin || row.order_id;
          const clickLabel = googleAdsIdentifierLabel(row);
          const status = row.status || "queued";
          return `
            <tr>
              <td>${escapeHtml(shortDateTime(row.conversion_time || row.created_at))}<br><span class="muted">черга ${escapeHtml(shortDateTime(row.created_at))}</span></td>
              <td><strong>${escapeHtml(googleAdsEventLabels[row.event_type] || row.event_type)}</strong><br><span class="muted">${textOrDash(row.conversion_action_name)}</span></td>
              <td>${textOrDash(orderText)}<br><span class="muted">${textOrDash(row.customer_phone || row.customer_telegram)}</span></td>
              <td>${textOrDash(row.source || "site")}<br><span class="muted">${textOrDash(row.campaign || "без кампанії")}</span></td>
              <td>${escapeHtml(clickLabel)}<br><span class="muted">${row.has_click_id ? "click id є" : "через контакт клієнта"}</span></td>
              <td>${money.format(row.conversion_value || 0)}<br><span class="muted">маржа ${money.format(row.gross_profit_uah || 0)}</span></td>
              <td><span class="conversion-status conversion-status--${safeClass(status)}">${escapeHtml(googleAdsStatusLabels[status] || status)}</span>${row.skip_reason ? `<br><span class="muted">${escapeHtml(row.skip_reason)}</span>` : ""}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">Поки немає підготовлених конверсій.</td></tr>`;
}

function rateFromMode(carrierId, mode) {
  return ratesForCarrier(carrierId).find((rate) => rate.mode === mode) || {};
}

function fillShippingForm(carrierId = "") {
  const form = document.querySelector("[data-shipping-form]");
  if (!form) return;
  const field = (name) => form.elements.namedItem(name);
  const carrier = carrierById(carrierId) || {};
  const air = rateFromMode(carrier.id, "air");
  const sea = rateFromMode(carrier.id, "sea");
  form.reset();
  field("id").value = carrier.id || "";
  field("name").value = carrier.name || "";
  field("code").value = carrier.code || "";
  field("active").value = carrier.active === 0 ? "0" : "1";
  field("tracking_url_template").value = carrier.tracking_url_template || "";
  field("notes").value = carrier.notes || "";

  for (const [mode, rate] of Object.entries({ air, sea })) {
    field(`${mode}_id`).value = rate.id || "";
    field(`${mode}_rate`).value = rate.rate ?? "";
    field(`${mode}_currency`).value = rate.currency || "USD";
    field(`${mode}_unit`).value = rate.unit || (mode === "sea" ? "m3" : "kg");
    field(`${mode}_exchange_rate_uah`).value = rate.exchange_rate_uah ?? "";
    field(`${mode}_min_charge`).value = rate.min_charge ?? "";
    field(`${mode}_estimated_days_min`).value = rate.estimated_days_min ?? "";
    field(`${mode}_estimated_days_max`).value = rate.estimated_days_max ?? "";
  }
  field("air_min_weight_kg").value = air.min_weight_kg ?? "";
  field("sea_min_volume_m3").value = sea.min_volume_m3 ?? "";
}

function renderShippingDirectory() {
  const root = document.querySelector("[data-shipping-list]");
  if (!root) return;
  if (state.shipping.migrationRequired) {
    root.innerHTML = `<p class="muted">Потрібно застосувати міграцію D1 для довідника доставки.</p>`;
    return;
  }
  root.innerHTML = state.shipping.carriers.length
    ? state.shipping.carriers
        .map((carrier) => {
          const rates = ratesForCarrier(carrier.id);
          return `
            <article class="shipping-card ${Number(carrier.active) === 0 ? "shipping-card--inactive" : ""}">
              <div class="shipping-card__head">
                <div>
                  <strong>${textOrDash(carrier.name)}</strong>
                  <span class="muted">${textOrDash(carrier.code)}${carrierTrackingLabel(carrier)}${Number(carrier.active) === 0 ? " · вимкнено" : ""}</span>
                </div>
                <button class="admin-btn admin-btn--small" type="button" data-edit-shipping-carrier="${escapeHtml(carrier.id)}">Редагувати</button>
              </div>
              <div class="shipping-rate-row">
                ${
                  rates.length
                    ? rates
                        .map((rate) => `<span class="shipping-pill ${Number(rate.active) === 0 ? "shipping-pill--muted" : ""}">${escapeHtml(rateLabel(rate))}</span>`)
                        .join("")
                    : `<span class="shipping-pill shipping-pill--muted">Тарифи не задані</span>`
                }
              </div>
              ${carrier.notes ? `<p class="muted">${escapeHtml(carrier.notes)}</p>` : ""}
            </article>
          `;
        })
        .join("")
    : `<p class="muted">Перевізників ще немає. Додайте першого, наприклад Meest China.</p>`;

  if (!document.querySelector("[data-shipping-form]")?.elements.namedItem("id")?.value && state.shipping.carriers[0]) {
    fillShippingForm(state.shipping.carriers[0].id);
  }
}

function badge(status, compact = false) {
  const labels = compact ? compactStatusLabels : statusLabels;
  return `<span class="badge ${compact ? "badge--compact" : ""} badge--${safeClass(status)}">${escapeHtml(labels[status] || statusLabels[status] || status || "new")}</span>`;
}

function paymentLabel(value) {
  return paymentLabels[value] || value || "оплата не вказана";
}

function plainText(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeCarriers() {
  return state.shipping.carriers.filter((carrier) => Number(carrier.active) !== 0);
}

function carrierById(id) {
  return state.shipping.carriers.find((carrier) => carrier.id === id) || null;
}

function ratesForCarrier(carrierId) {
  return state.shipping.rates.filter((rate) => rate.carrier_id === carrierId);
}

function rateById(id) {
  return state.shipping.rates.find((rate) => rate.id === id) || null;
}

function selectRate(carrierId, mode, preferredRateId = "") {
  const preferred = preferredRateId ? rateById(preferredRateId) : null;
  if (preferred && preferred.carrier_id === carrierId && (!mode || preferred.mode === mode)) return preferred;
  return (
    ratesForCarrier(carrierId).find((rate) => Number(rate.active) !== 0 && rate.mode === mode) ||
    ratesForCarrier(carrierId).find((rate) => Number(rate.active) !== 0) ||
    null
  );
}

function rateLabel(rate) {
  if (!rate) return "Тариф не вибрано";
  const unit = rateUnitLabels[rate.unit] || rate.unit || "-";
  const rateValue = numeric(rate.rate);
  const exchange = rate.currency === "UAH" || rateValue <= 0 ? "" : ` · курс ${numeric(rate.exchange_rate_uah) || "-"}`;
  const days = rate.estimated_days_min || rate.estimated_days_max
    ? ` · ${numeric(rate.estimated_days_min) || "?"}-${numeric(rate.estimated_days_max) || "?"} днів`
    : "";
  if (rateValue <= 0) return `${shippingModeLabels[rate.mode] || rate.mode}: індивідуально${days}`;
  return `${shippingModeLabels[rate.mode] || rate.mode}: ${numeric(rate.rate)} ${rate.currency}/${unit}${exchange}${days}`;
}

function carrierTrackingLabel(carrier) {
  if (!carrier) return "";
  if (Number(carrier.tracking_auto_enabled) === 1) return " · авто-трекінг";
  if (carrier.tracking_provider === "manual") return " · ручний статус";
  return "";
}

function calculateDeliveryCost(rate, weightKg, volumeM3) {
  if (!rate) return 0;
  if (numeric(rate.rate) <= 0) return 0;
  let base = 0;
  if (rate.unit === "m3") {
    base = Math.max(numeric(volumeM3), numeric(rate.min_volume_m3));
  } else if (rate.unit === "item") {
    base = 1;
  } else {
    base = Math.max(numeric(weightKg), numeric(rate.min_weight_kg));
  }
  const subtotal = Math.max(base * numeric(rate.rate), numeric(rate.min_charge));
  const exchange = rate.currency === "UAH" ? 1 : numeric(rate.exchange_rate_uah);
  return exchange > 0 ? Math.round(subtotal * exchange) : Math.round(subtotal);
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

function mutedLine(value, className = "") {
  const text = plainText(value);
  if (!text) return "";
  return `<br><span class="muted ${className}">${escapeHtml(text)}</span>`;
}

function orderTypePill(type) {
  const label = typeLabels[type] || type || "-";
  return `<span class="order-type-pill order-type-pill--${safeClass(type || "other")}">${escapeHtml(label)}</span>`;
}

function contactLine(order) {
  const contact = plainText(order.customer_phone || order.customer_email || order.customer_telegram);
  if (!contact) return `<span class="muted">контакт не вказано</span>`;
  if (/^\+?[\d\s().-]{7,}$/.test(contact)) {
    const href = contact.replace(/[^\d+]/g, "");
    return `<a class="orders-table__contact" href="tel:${escapeHtml(href)}">${escapeHtml(contact)}</a>`;
  }
  return `<span class="orders-table__contact">${escapeHtml(contact)}</span>`;
}

function moneyCell(order) {
  const revenue = Number(order.revenue_uah || 0);
  const payment = paymentLabel(order.payment_status);
  const paymentState = order.payment_status || "unknown";
  const clientBadge = paymentState === "unknown"
    ? ""
    : `<span class="orders-table__finance-badge orders-table__finance-badge--${safeClass(paymentState)}">${escapeHtml(payment)}</span>`;
  const revenueText = revenue > 0 ? money.format(revenue) : "не вказано";
  const chips = [
    supplierPaymentChip(order),
    deliveryChip(order),
    marginChip(order),
  ].filter(Boolean).join("");

  return `
    <div class="orders-table__finance">
      <div class="orders-table__finance-main">
        <span>Клієнт</span>
        <strong>${escapeHtml(revenueText)}</strong>
        ${clientBadge}
      </div>
      ${chips ? `<div class="orders-table__finance-chips">${chips}</div>` : `<span class="orders-table__finance-note">оплата не вказана</span>`}
    </div>
  `;
}

function supplierAmount(amount, currency = "CNY") {
  const value = Number(amount || 0);
  const formatted = new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: value % 1 ? 2 : 0,
  }).format(value);
  return `${formatted} ${escapeHtml(currency || "CNY")}`;
}

function supplierPaymentChip(order) {
  const count = Number(order.supplier_payment_count || 0);
  if (!count) return "";

  const paid = Number(order.supplier_payment_paid_count || 0);
  const open = Number(order.supplier_payment_open_count || 0);
  const review = Number(order.supplier_payment_review_count || 0);
  const paidAmount = Number(order.supplier_payment_paid_amount || 0);
  const currency = order.supplier_payment_currency || "CNY";
  let stateName = "pending";
  let label = "Постач. очікує";

  if (review > 0) {
    stateName = "review";
    label = "Постач. перевірити";
  } else if (paid > 0 && paid === count) {
    stateName = "paid";
    label = "Постач. оплачено";
  } else if (paid > 0) {
    stateName = "partial";
    label = "Постач. частково";
  } else if (open > 0) {
    stateName = "pending";
    label = "Постач. очікує";
  }

  const amount = paidAmount > 0 ? supplierAmount(paidAmount, currency) : "";
  const value = amount
    ? `${stateName === "partial" ? "частк." : "опл."} ${amount}`
    : label.replace("Постач. ", "");
  return financeChip("Постач.", value, stateName);
}

function deliveryChip(order) {
  const delivery = Number(order.delivery_cost_uah || 0);
  if (delivery <= 0) return "";
  return financeChip("Дост.", money.format(delivery), "neutral");
}

function marginChip(order) {
  const revenue = Number(order.revenue_uah || 0);
  const costs =
    Number(order.purchase_cost_uah || 0) +
    Number(order.delivery_cost_uah || 0) +
    Number(order.customs_cost_uah || 0) +
    Number(order.processing_cost_uah || 0) +
    Number(order.ad_cost_uah || 0) +
    Number(order.other_cost_uah || 0);
  if (revenue <= 0 || costs <= 0) return "";

  const profit = Number(order.gross_profit_uah || 0);
  return financeChip("Маржа", money.format(profit), profit >= 0 ? "paid" : "review");
}

function financeChip(label, value, stateName = "neutral") {
  return `
    <span class="orders-table__finance-chip orders-table__finance-chip--${safeClass(stateName)}">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
    </span>
  `;
}

function supplierPaymentBadge(status) {
  const value = status || "requested";
  return `<span class="supplier-payment-status supplier-payment-status--${safeClass(value)}">${escapeHtml(supplierPaymentStatusLabels[value] || value)}</span>`;
}

function renderSupplierPayments(order) {
  const rows = state.selectedSupplierPayments || [];
  const requestedPlaceholder = order.type === "byd" ? "VDS / програмування" : "постачальник / Taobao / склад";
  return `
    <section class="supplier-payments wide">
      <div class="supplier-payments__head">
        <div>
          <strong>Оплата постачальнику</strong>
          <span>Запит у Telegram-групу оплат і фіксація скрина після оплати.</span>
        </div>
      </div>

      <div class="supplier-payments__create">
        <label>
          Постачальник
          <input data-supplier-payment-input="supplier_name" placeholder="${escapeHtml(requestedPlaceholder)}">
        </label>
        <label>
          Сума
          <input data-supplier-payment-input="requested_amount" type="number" step="0.01" min="0" placeholder="1000">
        </label>
        <label>
          Валюта
          <select data-supplier-payment-input="requested_currency">
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
            <option value="UAH">UAH</option>
          </select>
        </label>
        <label class="wide">
          Коментар до оплати
          <textarea data-supplier-payment-input="notes" rows="2" placeholder="Що саме оплачуємо, посилання, примітка по QR або постачальнику"></textarea>
        </label>
        <button class="admin-btn admin-btn--primary wide" type="button" data-create-supplier-payment="${escapeHtml(order.id)}">
          Надіслати запит на оплату в Telegram
        </button>
      </div>

      ${rows.length ? `
        <div class="supplier-payments__list">
          ${rows.map((payment) => `
            <article class="supplier-payment-card" data-supplier-payment-card="${escapeHtml(payment.id)}">
              <div class="supplier-payment-card__main">
                <div>
                  <strong>${textOrDash(payment.payment_number || payment.id)}</strong>
                  ${supplierPaymentBadge(payment.status)}
                  <span>${escapeHtml(shortDateTime(payment.created_at))}</span>
                </div>
                <div>
                  <b>${supplierAmount(payment.requested_amount, payment.requested_currency)}</b>
                  <span>${payment.supplier_name ? escapeHtml(payment.supplier_name) : "постачальник не вказаний"}</span>
                </div>
              </div>
              <div class="supplier-payment-card__telegram">
                <span>Запит: ${payment.request_message_id ? `msg ${escapeHtml(payment.request_message_id)}` : "не відправлено"}</span>
                <span>Скрин: ${payment.receipt_message_id ? `msg ${escapeHtml(payment.receipt_message_id)}` : "ще немає"}</span>
                ${payment.matched_by ? `<span>Збіг: ${escapeHtml(payment.matched_by)} · ${escapeHtml(payment.match_confidence || "-")}</span>` : ""}
              </div>
              <div class="supplier-payment-card__edit">
                <label>
                  Статус
                  <select data-supplier-payment-field="status">
                    ${Object.entries(supplierPaymentStatusLabels).map(([value, label]) => `<option value="${value}" ${payment.status === value ? "selected" : ""}>${label}</option>`).join("")}
                  </select>
                </label>
                <label>
                  Сплачено з комісією
                  <input data-supplier-payment-field="paid_amount" type="number" step="0.01" min="0" value="${Number(payment.paid_amount || 0)}">
                </label>
                <label>
                  Валюта
                  <select data-supplier-payment-field="paid_currency">
                    ${["CNY", "USD", "UAH"].map((currency) => `<option value="${currency}" ${(payment.paid_currency || payment.requested_currency || "CNY") === currency ? "selected" : ""}>${currency}</option>`).join("")}
                  </select>
                </label>
                <label class="wide">
                  Коментар
                  <textarea data-supplier-payment-field="notes" rows="2">${escapeHtml(payment.notes || "")}</textarea>
                </label>
                <button class="admin-btn admin-btn--small wide" type="button" data-update-supplier-payment="${escapeHtml(payment.id)}">
                  Оновити оплату
                </button>
              </div>
              ${Number(payment.paid_amount || 0) > 0 ? `
                <p class="supplier-payment-card__summary">
                  Сплачено: ${supplierAmount(payment.paid_amount, payment.paid_currency)}
                </p>
              ` : `<p class="muted">Після оплати надішліть скрин відповіддю на повідомлення бота. Якщо суму не буде розпізнано, її можна внести тут вручну.</p>`}
            </article>
          `).join("")}
        </div>
      ` : `<p class="muted supplier-payments__empty">Запитів на оплату постачальнику ще немає.</p>`}
    </section>
  `;
}

function renderOrders() {
  const root = document.querySelector("[data-orders]");
  if (!root) return;
  root.innerHTML = state.orders.length
    ? state.orders
        .map((order) => {
          const request = order.item_name || order.service_name || order.request_text || "";
          const deliveryMode = shippingModeLabels[order.shipping_mode] || "";
          const deliveryLine = deliveryMode ? `${deliveryMode} · ${money.format(order.delivery_cost_uah || 0)}` : "";
          const publicNumber = order.order_number || "без номера";
          const trackingStatus = order.tracking_status_text
            ? `${order.tracking_status_text}${order.tracking_status_location ? ` · ${order.tracking_status_location}` : ""}`
            : "";
          const nextAction = order.next_action_at ? `Далі: ${shortDate(order.next_action_at)}` : "";
          const trackMain = order.tracking_carrier || order.tracking_number || trackingStatus || deliveryLine;
          const trackCell = trackMain
            ? `${textOrDash(trackMain)}${order.tracking_carrier ? mutedLine(order.tracking_number, "orders-table__mono") : ""}${trackMain !== trackingStatus ? mutedLine(trackingStatus) : ""}${trackMain !== deliveryLine ? mutedLine(deliveryLine) : ""}`
            : `<span class="orders-table__empty">трек не вказано</span>`;
          return `
            <tr data-order-id="${escapeHtml(order.id)}">
              <td class="orders-table__number-cell"><strong class="order-number">${textOrDash(publicNumber)}</strong><span class="orders-table__date">${escapeHtml(shortDateTime(order.created_at))}</span>${orderTypePill(order.type)}</td>
              <td><strong class="orders-table__primary">${textOrDash(order.customer_name || "Без імені")}</strong>${contactLine(order)}</td>
              <td class="orders-table__request-cell"><strong class="orders-table__primary">${textOrDash(order.car || "Авто не вказано")}</strong>${mutedLine(order.vin, "orders-table__mono")}${mutedLine(request, "orders-table__request")}</td>
              <td>${badge(order.status || "new", true)}${mutedLine(nextAction)}</td>
              <td>${moneyCell(order)}</td>
              <td class="orders-table__track-cell">${trackCell}</td>
              <td>
                <div class="orders-table__actions">
                  <button class="admin-btn admin-btn--small orders-table__open" type="button" data-open-order="${escapeHtml(order.id)}">Відкрити</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">Замовлень за обраними фільтрами немає.</td></tr>`;
  highlightSelectedOrder();
}

function updateOrderDetailSubtitle(order) {
  const node = document.querySelector("[data-order-detail-subtitle]");
  if (!node) return;
  if (!order) {
    node.textContent = "Оберіть замовлення в таблиці.";
    return;
  }
  const publicNumber = order.order_number || "без номера";
  const request = order.item_name || order.service_name || order.car || order.customer_phone || "";
  node.textContent = `${publicNumber}${request ? ` · ${request}` : ""}`;
}

function setOrderDetailOpen(open) {
  const panel = document.querySelector("[data-order-detail-panel]");
  document.body.classList.toggle("order-detail-open", Boolean(open));
  if (panel) panel.setAttribute("aria-hidden", open ? "false" : "true");
}

function highlightSelectedOrder() {
  const selectedId = state.selectedOrder?.id || "";
  document.querySelectorAll("[data-order-id]").forEach((row) => {
    row.classList.toggle("orders-table__row--selected", row.dataset.orderId === selectedId);
  });
}

function closeOrderDetail(options = {}) {
  setOrderDetailOpen(false);
  if (options.clearSelection) {
    state.selectedOrder = null;
    state.orderEditorTab = "main";
    state.selectedEvents = [];
    state.selectedNotifications = [];
    state.selectedTrackingEvents = [];
    state.selectedSupplierPayments = [];
    renderOrderEditor(null);
    highlightSelectedOrder();
  }
}

function activeOrderEditorTab() {
  return orderEditorTabs.has(state.orderEditorTab) ? state.orderEditorTab : "main";
}

function setOrderEditorTab(tab) {
  state.orderEditorTab = orderEditorTabs.has(tab) ? tab : "main";
  const active = activeOrderEditorTab();
  document.querySelectorAll("[data-order-tab]").forEach((button) => {
    const selected = button.dataset.orderTab === active;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
  document.querySelectorAll("[data-order-pane]").forEach((pane) => {
    const selected = pane.dataset.orderPane === active;
    pane.classList.toggle("is-active", selected);
    pane.hidden = !selected;
  });
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

function shippingCarrierOptions(selectedId) {
  const carriers = activeCarriers();
  return [
    `<option value="">Не вибрано</option>`,
    ...carriers.map((carrier) => `<option value="${escapeHtml(carrier.id)}" ${selectedId === carrier.id ? "selected" : ""}>${escapeHtml(carrier.name)}</option>`),
  ].join("");
}

function shippingModeOptions(selectedMode) {
  return Object.entries(shippingModeLabels)
    .map(([value, label]) => `<option value="${value}" ${selectedMode === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function applyShippingSelection(form, options = {}) {
  const carrierId = form.elements.shipping_carrier_id?.value || "";
  const mode = form.elements.shipping_mode?.value || "air";
  const rate = selectRate(carrierId, mode, form.elements.shipping_rate_id?.value || "");
  const carrier = carrierById(carrierId);
  const display = form.querySelector("[data-shipping-rate-display]");
  const hint = form.querySelector("[data-shipping-hint]");
  const label = rate ? rateLabel(rate) : "Оберіть перевізника і тип доставки";

  if (display) display.value = label;
  if (hint) hint.textContent = label;
  if (form.elements.shipping_rate_id) form.elements.shipping_rate_id.value = rate?.id || "";
  if (form.elements.shipping_rate) form.elements.shipping_rate.value = rate?.rate || 0;
  if (form.elements.shipping_rate_currency) form.elements.shipping_rate_currency.value = rate?.currency || "";
  if (form.elements.shipping_rate_unit) form.elements.shipping_rate_unit.value = rate?.unit || "";
  if (form.elements.shipping_exchange_rate_uah) form.elements.shipping_exchange_rate_uah.value = rate?.exchange_rate_uah || 0;

  if (carrier && form.elements.tracking_carrier && !plainText(form.elements.tracking_carrier.value)) {
    form.elements.tracking_carrier.value = carrier.name || "";
  }
  if (carrier?.tracking_url_template && form.elements.tracking_url && !plainText(form.elements.tracking_url.value) && plainText(form.elements.tracking_number?.value)) {
    form.elements.tracking_url.value = carrier.tracking_url_template.replace("{tracking}", plainText(form.elements.tracking_number.value));
  }

  const cost = calculateDeliveryCost(rate, form.elements.shipping_weight_kg?.value, form.elements.shipping_volume_m3?.value);
  const costInput = form.querySelector("[data-delivery-cost]");
  if (costInput && (options.overwriteCost || !numeric(costInput.value))) {
    costInput.value = cost || 0;
  }
}

function renderOrderEditor(order) {
  const form = document.querySelector("[data-order-editor]");
  if (!form) return;
  updateOrderDetailSubtitle(order);
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
  const matchedCarrier = state.shipping.carriers.find((carrier) => carrier.name === order.tracking_carrier);
  const selectedCarrierId = order.shipping_carrier_id || matchedCarrier?.id || "";
  const selectedMode = order.shipping_mode || "air";
  const selectedRate = selectRate(selectedCarrierId, selectedMode, order.shipping_rate_id);
  const currentRateLabel = selectedRate ? rateLabel(selectedRate) : "Оберіть перевізника і тип доставки";
  const selectedCarrier = carrierById(selectedCarrierId) || matchedCarrier || null;
  const autoTrackingAvailable = Number(selectedCarrier?.tracking_auto_enabled) === 1 || /meest|mist/i.test(`${order.tracking_carrier || ""} ${order.tracking_number || ""}`);
  const trackingStatus = order.tracking_status_text
    ? `${order.tracking_status_text}${order.tracking_status_location ? ` (${order.tracking_status_location})` : ""}`
    : "Статус перевізника ще не перевірявся";
  const orderNumber = order.order_number || "без номера";
  const customerNumber = order.customer_number || "без номера";
  const leadNumber = order.lead_number || "";
  const managerContact = order.manager_contact || (order.type === "byd" ? "@evline_tech" : "@evline_support");
  const customerContact = order.customer_phone || order.customer_email || order.customer_telegram;
  const primaryRequest = order.item_name || order.service_name || order.request_text || "";
  const serviceIds = [
    plainText(orderNumber) || "без номера",
    customerNumber && customerNumber !== "без номера" ? customerNumber : "",
    leadNumber || "",
  ].filter(Boolean).join(" · ");

  form.innerHTML = `
    <div class="order-editor__meta">
      <div class="order-editor__meta-head">
        <div>
          <span class="order-editor__meta-kicker">Клієнт</span>
          <strong class="order-editor__meta-title">${textOrDash(order.customer_name || "Без імені")}</strong>
          <div class="order-editor__meta-contact">${customerContact ? contactLine(order) : `<span class="muted">контакт не вказано</span>`}</div>
        </div>
        <span class="order-editor__meta-manager">${textOrDash(managerContact)}</span>
      </div>
      <div class="order-editor__meta-grid">
        <div class="order-editor__meta-field">
          <span>VIN</span>
          <strong class="orders-table__mono">${textOrDash(order.vin)}</strong>
        </div>
        <div class="order-editor__meta-field">
          <span>Авто</span>
          <strong>${textOrDash(order.car || "Авто не вказано")}</strong>
        </div>
        <div class="order-editor__meta-field order-editor__meta-field--wide">
          <span>Запчастина / послуга</span>
          <strong>${textOrDash(primaryRequest)}</strong>
        </div>
      </div>
      <div class="order-editor__actions">
        <button class="admin-btn" type="button" data-notify-manager="${escapeHtml(order.id)}">Надіслати менеджеру в Telegram</button>
        <button class="admin-btn admin-btn--icon admin-btn--subtle-danger order-editor__delete" type="button" data-delete-order="${escapeHtml(order.id)}" data-delete-order-number="${escapeHtml(orderNumber)}" aria-label="Видалити заявку ${escapeHtml(orderNumber)}" title="Видалити заявку">
          <span aria-hidden="true">🗑</span>
        </button>
      </div>
      <p class="order-editor__meta-ids">${escapeHtml(serviceIds)}</p>
    </div>

    <input type="hidden" name="id" value="${escapeHtml(order.id)}">

    <div class="order-editor__tabs wide" role="tablist" aria-label="Розділи картки замовлення">
      <button class="order-editor__tab ${activeOrderEditorTab() === "main" ? "is-active" : ""}" type="button" data-order-tab="main" role="tab" aria-selected="${activeOrderEditorTab() === "main" ? "true" : "false"}">Заявка</button>
      <button class="order-editor__tab ${activeOrderEditorTab() === "delivery" ? "is-active" : ""}" type="button" data-order-tab="delivery" role="tab" aria-selected="${activeOrderEditorTab() === "delivery" ? "true" : "false"}">Доставка</button>
      <button class="order-editor__tab ${activeOrderEditorTab() === "payment" ? "is-active" : ""}" type="button" data-order-tab="payment" role="tab" aria-selected="${activeOrderEditorTab() === "payment" ? "true" : "false"}">Оплата</button>
      <button class="order-editor__tab ${activeOrderEditorTab() === "messages" ? "is-active" : ""}" type="button" data-order-tab="messages" role="tab" aria-selected="${activeOrderEditorTab() === "messages" ? "true" : "false"}">Повідомлення</button>
      <button class="order-editor__tab ${activeOrderEditorTab() === "history" ? "is-active" : ""}" type="button" data-order-tab="history" role="tab" aria-selected="${activeOrderEditorTab() === "history" ? "true" : "false"}">Історія</button>
    </div>

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "main" ? "is-active" : ""}" data-order-pane="main" ${activeOrderEditorTab() === "main" ? "" : "hidden"}>
      <div class="order-editor__grid">

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
    <div class="wide tg-connect ${order.telegram_chat_id || order.customer_telegram_chat_id ? "tg-connect--done" : (["paid","sourcing_china","china_warehouse","left_china","in_ukraine","ready_for_pickup"].includes(order.status) ? "tg-connect--due" : "")}">
      <strong>${order.telegram_chat_id || order.customer_telegram_chat_id ? "✅ Клієнт підключений до Telegram-статусів" : "⏳ Клієнт ще не підключений до Telegram-статусів"}</strong>
      ${order.telegram_chat_id || order.customer_telegram_chat_id ? "" : `
      <p class="muted">Після фіксації оплати надішліть клієнту це повідомлення у ваш чат із ним:</p>
      <textarea rows="4" readonly data-tg-invite-text>Дякуємо за оплату! Підключіть автоматичні статуси вашого замовлення EVLine: натисніть посилання і кнопку Start — бот надсилатиме оновлення на кожному етапі доставки.
https://t.me/evline_crm_bot?start=order_${escapeHtml(order.id)}</textarea>
      <div class="tg-connect__actions">
        <button type="button" class="ghost" data-copy-tg-invite>Скопіювати повідомлення</button>
        <button type="button" class="ghost" data-copy-tg-link>Скопіювати лише посилання</button>
      </div>`}
    </div>

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

      </div>
    </section>

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "delivery" ? "is-active" : ""}" data-order-pane="delivery" ${activeOrderEditorTab() === "delivery" ? "" : "hidden"}>
      <div class="order-editor__grid">

    <label>
      Перевізник
      <input name="tracking_carrier" value="${escapeHtml(order.tracking_carrier || "")}" placeholder="Meest China">
    </label>
    <label>
      Трек-номер
      <input name="tracking_number" value="${escapeHtml(order.tracking_number || "")}">
    </label>
    <label class="wide">
      Посилання на трекінг
      <input name="tracking_url" value="${escapeHtml(order.tracking_url || "")}">
    </label>
    <div class="tracking-sync-card wide ${order.tracking_sync_error ? "tracking-sync-card--error" : ""}">
      <div>
        <strong>${escapeHtml(trackingStatus)}</strong>
        <span>
          ${order.tracking_status_at ? `Статус від ${escapeHtml(shortDateTime(order.tracking_status_at))}` : "Після першої перевірки тут буде статус Meest"}
          ${order.tracking_last_checked_at ? ` · перевірено ${escapeHtml(shortDateTime(order.tracking_last_checked_at))}` : ""}
        </span>
        ${order.carrier_estimated_delivery_at ? `<span>Орієнтовна доставка: ${escapeHtml(shortDate(order.carrier_estimated_delivery_at))}</span>` : ""}
        ${order.tracking_sync_error ? `<span class="tracking-sync-card__error">${escapeHtml(order.tracking_sync_error)}</span>` : ""}
      </div>
      <button class="admin-btn" type="button" data-sync-tracking="${escapeHtml(order.id)}" ${autoTrackingAvailable && order.tracking_number ? "" : "disabled"}>
        Оновити трекінг
      </button>
    </div>

    <div class="order-editor__section order-editor__section--delivery wide">
      <div>
        <strong>Доставка з Китаю</strong>
        <span data-shipping-hint>${escapeHtml(currentRateLabel)}</span>
      </div>
      <button class="admin-btn" type="button" data-open-shipping-settings>Керувати тарифами</button>
    </div>
    <input type="hidden" name="shipping_rate_id" value="${escapeHtml(order.shipping_rate_id || selectedRate?.id || "")}" data-shipping-rate-id>
    <input type="hidden" name="shipping_rate" value="${Number(order.shipping_rate || selectedRate?.rate || 0)}" data-shipping-rate>
    <input type="hidden" name="shipping_rate_currency" value="${escapeHtml(order.shipping_rate_currency || selectedRate?.currency || "")}" data-shipping-currency>
    <input type="hidden" name="shipping_rate_unit" value="${escapeHtml(order.shipping_rate_unit || selectedRate?.unit || "")}" data-shipping-unit>
    <input type="hidden" name="shipping_exchange_rate_uah" value="${Number(order.shipping_exchange_rate_uah || selectedRate?.exchange_rate_uah || 0)}" data-shipping-exchange>
    <label>
      Перевізник доставки
      <select name="shipping_carrier_id" data-shipping-carrier>
        ${shippingCarrierOptions(selectedCarrierId)}
      </select>
    </label>
    <label>
      Тип доставки
      <select name="shipping_mode" data-shipping-mode>
        ${shippingModeOptions(selectedMode)}
      </select>
    </label>
    <label>
      Вага, кг
      <input name="shipping_weight_kg" type="number" step="0.01" min="0" value="${Number(order.shipping_weight_kg || 0)}" data-shipping-weight>
    </label>
    <label>
      Об'єм, м3
      <input name="shipping_volume_m3" type="number" step="0.01" min="0" value="${Number(order.shipping_volume_m3 || 0)}" data-shipping-volume>
    </label>
    <label class="wide">
      Ставка для розрахунку
      <input value="${escapeHtml(currentRateLabel)}" readonly data-shipping-rate-display>
    </label>

      </div>
    </section>

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "payment" ? "is-active" : ""}" data-order-pane="payment" ${activeOrderEditorTab() === "payment" ? "" : "hidden"}>
      <div class="order-editor__grid">

    ${renderSupplierPayments(order)}

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
      <input name="delivery_cost_uah" type="number" step="0.01" min="0" value="${Number(order.delivery_cost_uah || 0)}" data-delivery-cost>
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

      </div>
    </section>

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "messages" ? "is-active" : ""}" data-order-pane="messages" ${activeOrderEditorTab() === "messages" ? "" : "hidden"}>
      <div class="order-editor__grid">

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

      </div>
    </section>

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "history" ? "is-active" : ""}" data-order-pane="history" ${activeOrderEditorTab() === "history" ? "" : "hidden"}>
      <div class="order-editor__grid">

    <div class="order-editor__history wide">
      <strong>Історія доставки</strong>
      ${renderTrackingEvents()}
    </div>
    <div class="order-editor__history wide">
      <strong>Історія статусів</strong>
      ${renderEvents()}
    </div>
    <div class="order-editor__history wide">
      <strong>Telegram-повідомлення клієнту</strong>
      ${renderNotifications()}
    </div>

      </div>
    </section>

    <button class="admin-btn admin-btn--primary wide order-editor__save" type="submit">Зберегти замовлення</button>
  `;

  form.querySelector("[data-status-input]")?.addEventListener("change", (event) => {
    const preview = form.querySelector("[data-message-preview]");
    if (preview) preview.value = messagePreview(order, event.target.value);
  });

  applyShippingSelection(form, { overwriteCost: !Number(order.delivery_cost_uah || 0) });
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

function renderTrackingEvents() {
  if (!state.selectedTrackingEvents.length) {
    return `<p class="muted">Подій доставки ще немає. Натисніть “Оновити трекінг” після внесення трек-номера Meest.</p>`;
  }
  return `
    <ol class="event-list">
      ${state.selectedTrackingEvents
        .map(
          (event) => `
            <li>
              <strong>${escapeHtml(event.status_text || event.status_code || "Статус перевізника")}</strong>
              <span>${escapeHtml(shortDateTime(event.occurred_at))} · ${textOrDash([event.city, event.country].filter(Boolean).join(", "))} · ${textOrDash(event.tracking_number)}</span>
              ${event.status_description ? `<p>${escapeHtml(event.status_description.replace(/^\*/, ""))}</p>` : ""}
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
  state.selectedTrackingEvents = data.tracking_events || [];
  state.selectedSupplierPayments = data.supplier_payments || [];
  renderOrderEditor(state.selectedOrder);
}

async function openOrder(id, options = {}) {
  if (state.selectedOrder?.id !== id) state.orderEditorTab = "main";
  await loadOrder(id);
  highlightSelectedOrder();
  setOrderDetailOpen(true);
  if (options.scroll !== false) {
    document.querySelector("[data-order-editor]")?.scrollTo({ top: 0, behavior: "smooth" });
  }
}

async function deleteOrder(id, orderNumber = "це замовлення") {
  if (!confirm(`Видалити ${orderNumber}?\n\nБуде видалено замовлення, пов'язаний лід і технічну історію. Дію не можна скасувати.`)) return false;
  await api(`/api/admin/orders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (state.selectedOrder?.id === id) {
    state.selectedOrder = null;
    state.selectedEvents = [];
    state.selectedNotifications = [];
    state.selectedTrackingEvents = [];
    state.selectedSupplierPayments = [];
    renderOrderEditor(null);
    closeOrderDetail();
  }
  await refresh();
  alert("Заявку видалено.");
  return true;
}

function collectSupplierPaymentCreatePayload(form) {
  const value = (name) => form.querySelector(`[data-supplier-payment-input="${name}"]`)?.value || "";
  return {
    supplier_name: value("supplier_name"),
    requested_amount: value("requested_amount"),
    requested_currency: value("requested_currency") || "CNY",
    notes: value("notes"),
  };
}

function collectSupplierPaymentUpdatePayload(card) {
  const value = (name) => card.querySelector(`[data-supplier-payment-field="${name}"]`)?.value || "";
  return {
    status: value("status") || "requested",
    paid_amount: value("paid_amount"),
    paid_currency: value("paid_currency") || "CNY",
    notes: value("notes"),
  };
}

async function loadShipping() {
  const data = await api("/api/admin/shipping");
  state.shipping = {
    carriers: data.carriers || [],
    rates: data.rates || [],
    migrationRequired: Boolean(data.migration_required),
  };
  renderShippingDirectory();
}

async function loadGoogleAds() {
  try {
    const data = await api(`/api/admin/google-ads/conversions?range=${encodeURIComponent(state.range)}&limit=80`);
    state.googleAds = {
      conversions: data.conversions || [],
      summary: data.summary || {},
      byEventType: data.by_event_type || [],
      settings: data.settings || {},
      migrationRequired: Boolean(data.migration_required),
      apiReady: Boolean(data.api_ready),
      apiMissing: data.api_missing || [],
      apiVersion: data.api_version || "",
    };
  } catch (error) {
    state.googleAds = {
      conversions: [],
      summary: {},
      byEventType: [],
      settings: {},
      migrationRequired: /migration|google_ads_conversion_events_missing/i.test(error.message),
      apiReady: false,
      apiMissing: [],
      apiVersion: "",
      error: error.message,
    };
  }
  renderGoogleAds(state.googleAds);
}

async function refresh() {
  try {
    state.range = document.querySelector("#range")?.value || "30d";
    const exportLink = document.querySelector("[data-export]");
    if (exportLink) exportLink.href = `/api/admin/orders?format=csv&range=${encodeURIComponent(state.range)}`;
    const googleAdsExport = document.querySelector("[data-google-ads-export]");
    if (googleAdsExport) googleAdsExport.href = `/api/admin/google-ads/conversions?format=csv&range=${encodeURIComponent(state.range)}`;
    await Promise.all([loadSummary(), loadOrders(), loadShipping(), loadGoogleAds()]);
    if (state.selectedOrder?.id) renderOrderEditor(state.selectedOrder);
    setAuthVisible(false);
  } catch (error) {
    setAuthVisible(true);
    alert(error.message);
  }
}

function shippingRatePayload(form, mode) {
  const field = (name) => form.elements.namedItem(name);
  const rawRate = plainText(field(`${mode}_rate`)?.value);
  const rate = numeric(rawRate);
  return {
    id: plainText(field(`${mode}_id`)?.value),
    mode,
    currency: plainText(field(`${mode}_currency`)?.value) || "USD",
    unit: plainText(field(`${mode}_unit`)?.value) || (mode === "sea" ? "m3" : "kg"),
    rate,
    min_charge: numeric(field(`${mode}_min_charge`)?.value),
    min_weight_kg: mode === "air" ? numeric(field("air_min_weight_kg")?.value) : 0,
    min_volume_m3: mode === "sea" ? numeric(field("sea_min_volume_m3")?.value) : 0,
    exchange_rate_uah: numeric(field(`${mode}_exchange_rate_uah`)?.value),
    estimated_days_min: numeric(field(`${mode}_estimated_days_min`)?.value),
    estimated_days_max: numeric(field(`${mode}_estimated_days_max`)?.value),
    active: rawRate ? 1 : 0,
  };
}

function shippingFormPayload(form) {
  const field = (name) => form.elements.namedItem(name);
  return {
    id: plainText(field("id").value),
    name: plainText(field("name").value),
    code: plainText(field("code").value),
    active: plainText(field("active").value),
    tracking_url_template: plainText(field("tracking_url_template").value),
    notes: plainText(field("notes").value),
    rates: [shippingRatePayload(form, "air"), shippingRatePayload(form, "sea")],
  };
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
document.querySelector("[data-google-ads-export]")?.addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    const csv = await api(`/api/admin/google-ads/conversions?format=csv&range=${encodeURIComponent(state.range)}`, {
      headers: { accept: "text/csv" },
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `evline-google-ads-conversions-${state.range}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
});
document.querySelector("[data-google-ads-backfill]")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Готую...";
  try {
    const result = await api("/api/admin/google-ads/conversions", {
      method: "POST",
      body: JSON.stringify({ action: "backfill", range: state.range, limit: 500 }),
    });
    await loadGoogleAds();
    alert(`Підготовлено: ${result.queued || 0}. Перевірено замовлень: ${result.processed || 0}.`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Підготувати з CRM";
  }
});

async function runGoogleAdsApiAction(action, button) {
  const defaultText = button.textContent;
  button.disabled = true;
  button.textContent = action === "validate" ? "Перевіряю..." : "Відправляю...";
  try {
    const result = await api("/api/admin/google-ads/conversions", {
      method: "POST",
      body: JSON.stringify({ action, limit: 100 }),
    });
    await loadGoogleAds();
    if (result.missing_config?.length) {
      alert(`Не вистачає налаштувань Google Ads: ${result.missing_config.map((item) => item.name).join(", ")}`);
      return;
    }
    const checked = result.validated || 0;
    const uploaded = result.uploaded || 0;
    const failed = result.failed || 0;
    alert(
      action === "validate"
        ? `Перевірка Google Ads API: валідно ${checked}, помилок ${failed}.`
        : `Відправка Google Ads: відправлено ${uploaded}, помилок ${failed}.`
    );
  } catch (error) {
    let message = error.message;
    try {
      const parsed = JSON.parse(message);
      if (parsed.missing_config?.length) {
        message = `Не вистачає налаштувань Google Ads: ${parsed.missing_config.map((item) => item.name).join(", ")}`;
      } else if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Keep the original fetch error text.
    }
    alert(message);
  } finally {
    button.disabled = false;
    button.textContent = defaultText;
  }
}

document.querySelector("[data-google-ads-validate]")?.addEventListener("click", (event) => {
  runGoogleAdsApiAction("validate", event.currentTarget);
});

document.querySelector("[data-google-ads-upload]")?.addEventListener("click", (event) => {
  if (!confirm("Відправити готові конверсії у Google Ads?")) return;
  runGoogleAdsApiAction("upload", event.currentTarget);
});
document.querySelector("#range")?.addEventListener("change", refresh);
document.querySelector("#status-filter")?.addEventListener("change", loadOrders);
document.querySelector("#type-filter")?.addEventListener("change", loadOrders);
document.querySelector("#search")?.addEventListener("input", () => {
  clearTimeout(window.__searchTimer);
  window.__searchTimer = setTimeout(loadOrders, 250);
});

document.querySelector("[data-orders]")?.addEventListener("click", (event) => {
  const openButton = event.target.closest("[data-open-order]");
  if (openButton) {
    openOrder(openButton.dataset.openOrder).catch((error) => alert(error.message));
    return;
  }

  if (event.target.closest("a")) return;

  const row = event.target.closest("[data-order-id]");
  if (!row) return;
  openOrder(row.dataset.orderId).catch((error) => alert(error.message));
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-close-order]")) return;
  closeOrderDetail({ clearSelection: true });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !document.body.classList.contains("order-detail-open")) return;
  closeOrderDetail({ clearSelection: true });
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
  state.selectedTrackingEvents = result.tracking_events || state.selectedTrackingEvents;
  state.selectedSupplierPayments = result.supplier_payments || state.selectedSupplierPayments;
  renderOrderEditor(result.order);
  await refresh();
});

document.querySelector("[data-order-editor]")?.addEventListener("input", (event) => {
  if (event.target.matches("[data-shipping-weight], [data-shipping-volume]")) {
    applyShippingSelection(event.currentTarget, { overwriteCost: true });
  }
});

document.querySelector("[data-order-editor]")?.addEventListener("change", (event) => {
  if (event.target.matches("[data-shipping-carrier], [data-shipping-mode], [name='tracking_number']")) {
    applyShippingSelection(event.currentTarget, { overwriteCost: true });
  }
});

document.querySelector("[data-order-editor]")?.addEventListener("click", async (event) => {
  const tabButton = event.target.closest("[data-order-tab]");
  if (tabButton) {
    setOrderEditorTab(tabButton.dataset.orderTab);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-order]");
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.setAttribute("aria-busy", "true");
    try {
      const deleted = await deleteOrder(deleteButton.dataset.deleteOrder, deleteButton.dataset.deleteOrderNumber || "це замовлення");
      if (!deleted) {
        deleteButton.disabled = false;
        deleteButton.removeAttribute("aria-busy");
      }
    } catch (error) {
      alert(error.message);
      deleteButton.disabled = false;
      deleteButton.removeAttribute("aria-busy");
    }
    return;
  }

  const notifyManagerButton = event.target.closest("[data-notify-manager]");
  if (notifyManagerButton) {
    notifyManagerButton.disabled = true;
    notifyManagerButton.textContent = "Надсилаю...";
    try {
      const result = await api(`/api/admin/orders/${encodeURIComponent(notifyManagerButton.dataset.notifyManager)}/notify-manager`, {
        method: "POST",
        body: "{}",
      });
      state.selectedEvents = result.events || state.selectedEvents;
      if (state.selectedOrder?.id) await loadOrder(state.selectedOrder.id);
      await loadOrders();
      alert("Заявку надіслано менеджеру в Telegram.");
    } catch (error) {
      alert(error.message);
    } finally {
      notifyManagerButton.disabled = false;
      notifyManagerButton.textContent = "Надіслати менеджеру в Telegram";
    }
    return;
  }

  const createSupplierPaymentButton = event.target.closest("[data-create-supplier-payment]");
  if (createSupplierPaymentButton) {
    const payload = collectSupplierPaymentCreatePayload(event.currentTarget);
    if (!Number(payload.requested_amount || 0)) {
      alert("Вкажіть суму оплати постачальнику.");
      return;
    }
    createSupplierPaymentButton.disabled = true;
    createSupplierPaymentButton.textContent = "Надсилаю в Telegram...";
    try {
      const result = await api(`/api/admin/orders/${encodeURIComponent(createSupplierPaymentButton.dataset.createSupplierPayment)}/supplier-payments`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.selectedOrder = result.order || state.selectedOrder;
      state.selectedSupplierPayments = result.supplier_payments || state.selectedSupplierPayments;
      renderOrderEditor(state.selectedOrder);
      await loadOrders();
      if (result.supplier_payment?.migrated_from_chat_id && result.supplier_payment?.request_chat_id) {
        alert(`Запит на оплату надіслано в Telegram.\n\nTelegram змінив ID групи оплат. Оновіть TELEGRAM_PAYMENTS_CHAT_ID у Cloudflare на:\n${result.supplier_payment.request_chat_id}`);
      } else {
        alert("Запит на оплату надіслано в Telegram.");
      }
    } catch (error) {
      alert(error.message);
      createSupplierPaymentButton.disabled = false;
      createSupplierPaymentButton.textContent = "Надіслати запит на оплату в Telegram";
    }
    return;
  }

  const updateSupplierPaymentButton = event.target.closest("[data-update-supplier-payment]");
  if (updateSupplierPaymentButton) {
    const card = updateSupplierPaymentButton.closest("[data-supplier-payment-card]");
    if (!card) return;
    updateSupplierPaymentButton.disabled = true;
    updateSupplierPaymentButton.textContent = "Оновлюю...";
    try {
      const result = await api(`/api/admin/supplier-payments/${encodeURIComponent(updateSupplierPaymentButton.dataset.updateSupplierPayment)}`, {
        method: "PATCH",
        body: JSON.stringify(collectSupplierPaymentUpdatePayload(card)),
      });
      state.selectedOrder = result.order || state.selectedOrder;
      state.selectedSupplierPayments = result.supplier_payments || state.selectedSupplierPayments;
      renderOrderEditor(state.selectedOrder);
      await loadOrders();
      alert("Оплату оновлено.");
    } catch (error) {
      alert(error.message);
      updateSupplierPaymentButton.disabled = false;
      updateSupplierPaymentButton.textContent = "Оновити оплату";
    }
    return;
  }

  const syncButton = event.target.closest("[data-sync-tracking]");
  if (syncButton) {
    syncButton.disabled = true;
    syncButton.textContent = "Перевіряю...";
    try {
      const result = await api(`/api/admin/tracking/${encodeURIComponent(syncButton.dataset.syncTracking)}`, {
        method: "POST",
        body: "{}",
      });
      if (!result.ok) throw new Error(result.error || "Не вдалося оновити трекінг");
      if (state.selectedOrder?.id) await loadOrder(state.selectedOrder.id);
      await loadOrders();
      alert(result.status === "updated" ? "Трекінг оновлено." : "Нових статусів у перевізника немає.");
    } catch (error) {
      alert(error.message);
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = "Оновити трекінг";
    }
    return;
  }

  const settingsButton = event.target.closest("[data-open-shipping-settings]");
  if (settingsButton) {
    setActiveTab("delivery");
    return;
  }
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

document.querySelector("[data-new-shipping-carrier]")?.addEventListener("click", () => {
  fillShippingForm("");
});

document.querySelector("[data-shipping-list]")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-shipping-carrier]");
  if (!button) return;
  fillShippingForm(button.dataset.editShippingCarrier);
});

document.querySelector("[data-shipping-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = shippingFormPayload(event.currentTarget);
  const method = payload.id && carrierById(payload.id) ? "PATCH" : "POST";
  const data = await api("/api/admin/shipping", {
    method,
    body: JSON.stringify(payload),
  });
  state.shipping = {
    carriers: data.carriers || [],
    rates: data.rates || [],
    migrationRequired: Boolean(data.migration_required),
  };
  renderShippingDirectory();
  fillShippingForm(payload.id || data.carriers?.[0]?.id || "");
  if (state.selectedOrder) renderOrderEditor(state.selectedOrder);
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

document.addEventListener("click", (event) => {
  const inviteButton = event.target.closest("[data-copy-tg-invite], [data-copy-tg-link]");
  if (!inviteButton) return;
  const wrap = inviteButton.closest(".tg-connect");
  const textarea = wrap?.querySelector("[data-tg-invite-text]");
  if (!textarea) return;
  const full = textarea.value;
  const link = (full.match(/https:\/\/t\.me\/\S+/) || [full])[0];
  const value = inviteButton.hasAttribute("data-copy-tg-invite") ? full : link;
  navigator.clipboard?.writeText(value).then(() => {
    const original = inviteButton.textContent;
    inviteButton.textContent = "Скопійовано ✓";
    setTimeout(() => { inviteButton.textContent = original; }, 1500);
  });
});
