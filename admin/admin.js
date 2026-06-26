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
  selectedSupplierRequests: [],
  chinaPreorders: [],
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
  awaiting_payment: "Очікує оплати",
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
  awaiting_payment: "Очікує",
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

const supplierRequestStatusLabels = {
  draft: "Чернетка",
  sent: "Надіслано",
  viewed: "Переглянуто",
  quoted: "Є пропозиція",
  needs_info: "Потрібно уточнення",
  no_stock: "Немає в наявності",
  accepted: "Варіант обрано",
  purchased: "Викуплено",
  china_tracking: "Доставка по Китаю",
  china_warehouse: "На складі в Китаї",
  problem: "Проблема",
  closed: "Закрито",
  canceled: "Скасовано",
};

const supplierQuoteTypeLabels = {
  original: "Original",
  oem: "OEM",
  aftermarket: "Аналог",
  used: "б/у",
};

const supplierAvailabilityLabels = {
  in_stock: "є в наявності",
  order_needed: "під замовлення",
  no_stock: "немає",
};

const supplierDirectory = ["Zeekr", "BYD", "Buble"];

const defaultShippingCarriers = [
  {
    id: "mist-china",
    name: "Meest",
    code: "meest",
    active: 1,
    tracking_url_template: "https://cab.meest.cn/",
    notes: "Основний перевізник для доставок з Китаю.",
  },
  {
    id: "brock-bridge",
    name: "Brock Bridge",
    code: "brock-bridge",
    active: 1,
    tracking_url_template: "",
    notes: "Додатковий перевізник. Тариф і строки менеджер уточнює під вантаж.",
  },
  {
    id: "ukr-china",
    name: "Ukr China",
    code: "ukr-china",
    active: 1,
    tracking_url_template: "https://ukr-china.com",
    notes: "Додатковий перевізник для доставок з Китаю.",
  },
  {
    id: "meest-commerce",
    name: "Meest Commerce",
    code: "meest-commerce",
    active: 1,
    tracking_url_template: "",
    notes: "Додатковий канал Meest для комерційних відправлень.",
  },
];

const defaultShippingRates = [
  {
    id: "mist-china-air",
    carrier_id: "mist-china",
    mode: "air",
    currency: "USD",
    rate: 11.3,
    unit: "kg",
    min_charge: 0,
    min_weight_kg: 30,
    min_volume_m3: 0,
    exchange_rate_uah: 42,
    estimated_days_min: 12,
    estimated_days_max: 15,
    active: 1,
  },
  {
    id: "mist-china-sea",
    carrier_id: "mist-china",
    mode: "sea",
    currency: "USD",
    rate: 2.5,
    unit: "kg",
    min_charge: 0,
    min_weight_kg: 0,
    min_volume_m3: 0,
    exchange_rate_uah: 42,
    estimated_days_min: 60,
    estimated_days_max: 65,
    active: 1,
  },
  {
    id: "ukr-china-air",
    carrier_id: "ukr-china",
    mode: "air",
    currency: "UAH",
    rate: 0,
    unit: "kg",
    min_charge: 0,
    min_weight_kg: 0,
    min_volume_m3: 0,
    exchange_rate_uah: 0,
    estimated_days_min: 14,
    estimated_days_max: 14,
    active: 1,
  },
  {
    id: "ukr-china-sea",
    carrier_id: "ukr-china",
    mode: "sea",
    currency: "UAH",
    rate: 0,
    unit: "kg",
    min_charge: 0,
    min_weight_kg: 0,
    min_volume_m3: 0,
    exchange_rate_uah: 0,
    estimated_days_min: 55,
    estimated_days_max: 60,
    active: 1,
  },
  ...["brock-bridge", "meest-commerce"].flatMap((carrierId) => ["air", "sea"].map((mode) => ({
    id: `${carrierId}-${mode}`,
    carrier_id: carrierId,
    mode,
    currency: "UAH",
    rate: 0,
    unit: "kg",
    min_charge: 0,
    min_weight_kg: 0,
    min_volume_m3: 0,
    exchange_rate_uah: 0,
    estimated_days_min: 0,
    estimated_days_max: 0,
    active: 1,
  }))),
];

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

const adminTabs = new Set(["orders", "china", "analytics", "delivery"]);
const orderEditorTabs = new Set(["main", "suppliers", "delivery", "payment", "messages", "history"]);

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
  if (panel) panel.hidden = !visible;
}

function setActiveTab(tab) {
  const nextTab = adminTabs.has(tab) ? tab : "orders";
  state.activeTab = nextTab;
  localStorage.setItem("evline_admin_tab", nextTab);
  document.body.dataset.adminTab = nextTab;

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
  const carriers = allCarriers();
  root.innerHTML = carriers.length
    ? carriers
        .map((carrier) => {
          const rates = ratesForCarrier(carrier.id);
          const isPersisted = Boolean(persistedCarrierById(carrier.id));
          return `
            <article class="shipping-card ${Number(carrier.active) === 0 ? "shipping-card--inactive" : ""}">
              <div class="shipping-card__head">
                <div>
                  <strong>${textOrDash(carrier.name)}</strong>
                  <span class="muted">${textOrDash(carrier.code)}${carrierTrackingLabel(carrier)}${Number(carrier.active) === 0 ? " · вимкнено" : ""}${isPersisted ? "" : " · шаблон"}</span>
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
    : `<p class="muted">Перевізників ще немає. Додайте першого, наприклад Meest.</p>`;

  if (!document.querySelector("[data-shipping-form]")?.elements.namedItem("id")?.value && carriers[0]) {
    fillShippingForm(carriers[0].id);
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

function allCarriers() {
  const carriers = new Map(defaultShippingCarriers.map((carrier) => [carrier.id, carrier]));
  for (const carrier of state.shipping.carriers) {
    const defaults = carriers.get(carrier.id);
    carriers.set(carrier.id, defaults ? { ...carrier, name: defaults.name, code: defaults.code || carrier.code } : carrier);
  }
  return Array.from(carriers.values()).sort((a, b) => {
    const activeDiff = Number(b.active !== 0) - Number(a.active !== 0);
    return activeDiff || String(a.name || "").localeCompare(String(b.name || ""), "uk");
  });
}

function activeCarriers() {
  return allCarriers().filter((carrier) => Number(carrier.active) !== 0);
}

function carrierById(id) {
  return allCarriers().find((carrier) => carrier.id === id) || null;
}

function normalizeCarrierName(value) {
  return plainText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function carrierByName(name) {
  const normalized = normalizeCarrierName(name);
  if (!normalized) return null;
  const aliases = {
    "meest china": "mist-china",
    "mist china": "mist-china",
    "meest": "mist-china",
    "mist": "mist-china",
    "ukr-china": "ukr-china",
    "ukr china": "ukr-china",
    "ukrchina": "ukr-china",
  };
  const aliasId = aliases[normalized];
  return allCarriers().find((carrier) => carrier.id === aliasId || normalizeCarrierName(carrier.name) === normalized || normalizeCarrierName(carrier.code) === normalized) || null;
}

function persistedCarrierById(id) {
  return state.shipping.carriers.find((carrier) => carrier.id === id) || null;
}

function allRates() {
  const rates = new Map(defaultShippingRates.map((rate) => [rate.id, rate]));
  for (const rate of state.shipping.rates) {
    rates.set(rate.id, rate);
  }
  return Array.from(rates.values());
}

function ratesForCarrier(carrierId) {
  return allRates().filter((rate) => rate.carrier_id === carrierId);
}

function rateById(id) {
  return allRates().find((rate) => rate.id === id) || null;
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

function dateMs(value) {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (!contact) return "";
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
  const clientLine = revenue > 0 ? `
    <div class="orders-table__finance-main">
      <span>Клієнту</span>
      <strong>${escapeHtml(money.format(revenue))}</strong>
      ${clientBadge}
    </div>
  ` : "";
  const chips = [
    supplierRequestChip(order),
    supplierPaymentChip(order),
    deliveryChip(order),
    marginChip(order),
  ].filter(Boolean).join("");

  if (!clientLine && !chips) return "";

  return `
    <div class="orders-table__finance">
      ${clientLine}
      ${chips ? `<div class="orders-table__finance-chips">${chips}</div>` : ""}
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

function supplierRequestChip(order) {
  const count = Number(order.supplier_request_count || 0);
  if (!count) return "";

  const quoted = Number(order.supplier_request_quoted_count || 0);
  const accepted = Number(order.supplier_request_accepted_count || 0);
  const problem = Number(order.supplier_request_problem_count || 0);
  if (accepted > 0) return financeChip("Запити CN", `${accepted}/${count} обрано`, "paid");
  if (quoted > 0) return financeChip("Запити CN", `${quoted}/${count} ціна`, "partial");
  if (problem > 0) return financeChip("Запити CN", `${problem}/${count} уточн.`, "review");
  return financeChip("Запити CN", `${count} очікує`, "neutral");
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

function supplierRequestBadge(status) {
  const value = status || "sent";
  return `<span class="supplier-request-status supplier-request-status--${safeClass(value)}">${escapeHtml(supplierRequestStatusLabels[value] || value)}</span>`;
}

function supplierDirectoryOptions(selectedName = "") {
  const normalized = plainText(selectedName);
  const hasDirectoryMatch = supplierDirectory.some((name) => name === normalized);
  return [
    `<option value="">Оберіть постачальника</option>`,
    ...supplierDirectory.map((name) => `<option value="${escapeHtml(name)}" ${normalized === name ? "selected" : ""}>${escapeHtml(name)}</option>`),
    `<option value="__custom__" ${normalized && !hasDirectoryMatch ? "selected" : ""}>Інший / додати вручну</option>`,
  ].join("");
}

function syncSupplierCustomField(root) {
  const select = root.querySelector("[data-supplier-payment-supplier]");
  const customLabel = root.querySelector("[data-supplier-payment-custom]");
  if (!select || !customLabel) return;
  customLabel.hidden = select.value !== "__custom__";
  if (!customLabel.hidden) customLabel.querySelector("input")?.focus();
}

function syncSupplierRequestCustomField(root) {
  const select = root.querySelector("[data-supplier-request-supplier]");
  const customLabel = root.querySelector("[data-supplier-request-custom]");
  if (!select || !customLabel) return;
  customLabel.hidden = select.value !== "__custom__";
  if (!customLabel.hidden) customLabel.querySelector("input")?.focus();
}

function supplierUrl(pathOrUrl) {
  const raw = plainText(pathOrUrl);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${window.location.origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function supplierImageList(images = []) {
  const urls = images.map((image) => plainText(image.image_url)).filter(Boolean);
  if (!urls.length) return "";
  return `
    <div class="supplier-request-images">
      ${urls.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="Фото постачальника" loading="lazy"></a>`).join("")}
    </div>
  `;
}

function hideChinaCreatedLink(form = document) {
  const root = form.querySelector?.("[data-china-created-link]") || document.querySelector("[data-china-created-link]");
  if (!root) return;
  root.hidden = true;
  root.innerHTML = "";
}

function showChinaCreatedLink(form, rawLink) {
  const root = form.querySelector("[data-china-created-link]");
  const link = supplierUrl(rawLink);
  if (!root || !link) return;
  root.hidden = false;
  root.innerHTML = `
    <div>
      <strong>Ссылка для поставщика</strong>
      <a class="china-created-link__url" href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>
    </div>
    <a class="admin-btn admin-btn--small" href="${escapeHtml(link)}" target="_blank" rel="noopener">Открыть</a>
    <button class="admin-btn admin-btn--small" type="button" data-copy-supplier-link="${escapeHtml(link)}">Скопировать</button>
  `;
}

function selectedSupplierQuote(bundle = {}) {
  const quotes = bundle.quotes || [];
  return quotes.find((quote) => quote.status === "selected")
    || quotes.find((quote) => quote.status === "new" && quote.availability !== "no_stock" && Number(quote.price_cny || 0) > 0)
    || null;
}

function chinaPreorderStage(bundle = {}) {
  const request = bundle.request || {};
  const quote = selectedSupplierQuote(bundle);
  const payment = bundle.payment || {};
  if (request.status === "china_tracking" || request.status === "china_warehouse") return "Трек получен";
  if (payment.status === "paid") return "Оплачено";
  if (payment.status === "requested" || payment.status === "needs_review") return "Ждём оплату";
  if (request.status === "accepted") return "Согласовано";
  if (quote) return "Цена получена";
  if (request.status === "no_stock") return "Нет в наличии";
  if (request.status === "needs_info") return "Нужно уточнение";
  return "Ждём ответ";
}

function chinaQuoteChatText(quote = {}) {
  return [
    quote.price_cny ? `${supplierAmount(quote.price_cny, "CNY")}` : "",
    quote.purchase_days ? `Срок поставки: ${Number(quote.purchase_days)} дн.` : "",
    plainText(quote.comment_ru || quote.comment_translated || quote.comment_cn),
  ].filter(Boolean).join("\n");
}

function isDuplicateChinaQuoteEvent(event = {}, quotes = []) {
  const eventComment = plainText(event.comment_translated || event.comment_cn);
  return quotes.some((quote) => {
    const comments = [
      plainText(quote.comment_ru),
      plainText(quote.comment_translated),
      plainText(quote.comment_cn),
    ].filter(Boolean);
    const commentsMatch = eventComment && comments.includes(eventComment);
    const timeGap = Math.abs(dateMs(event.created_at) - dateMs(quote.created_at));
    return commentsMatch && timeGap <= 2000;
  });
}

function chinaChatMessages(bundle = {}) {
  const request = bundle.request || {};
  const events = bundle.tracking_events || [];
  const quotes = bundle.quotes || [];
  const messages = [];
  const initialText = plainText(request.request_text_ru || request.request_text);
  if (initialText) {
    messages.push({
      actor: "evline",
      title: "EVLine",
      meta: "Запрос",
      text: initialText,
      created_at: request.created_at,
      order: 0,
      status: "request",
    });
  }

  const hasNoteEvent = events.some((event) => event.status === "sent" && plainText(event.comment_translated || event.comment_cn) === plainText(request.manager_comment));
  if (plainText(request.manager_comment) && !hasNoteEvent) {
    messages.push({
      actor: "evline",
      title: "EVLine",
      meta: "Уточнение",
      text: plainText(request.manager_comment),
      created_at: request.updated_at || request.created_at,
      order: 1,
      status: "sent",
    });
  }

  for (const quote of quotes) {
    const textValue = chinaQuoteChatText(quote);
    if (!textValue) continue;
    messages.push({
      actor: "supplier",
      title: request.supplier_name || "Поставщик",
      meta: "Предложение",
      text: textValue,
      created_at: quote.created_at,
      order: 2,
      status: "quoted",
    });
  }

  for (const event of events) {
    const status = plainText(event.status);
    const comment = plainText(event.comment_translated || event.comment_cn);
    if (status === "quoted") {
      if (comment && !isDuplicateChinaQuoteEvent(event, quotes)) {
        messages.push({
          actor: "supplier",
          title: request.supplier_name || "Поставщик",
          meta: "Сообщение",
          text: comment,
          created_at: event.created_at,
          order: 3,
          status,
        });
      }
      continue;
    }
    if (status === "needs_info" && comment) {
      messages.push({
        actor: "supplier",
        title: request.supplier_name || "Поставщик",
        meta: "Нужно уточнение",
        text: comment,
        created_at: event.created_at,
        order: 3,
        status,
      });
    } else if (status === "sent" && comment) {
      messages.push({
        actor: "evline",
        title: "EVLine",
        meta: "Ответ",
        text: comment,
        created_at: event.created_at,
        order: 4,
        status,
      });
    } else if (status === "no_stock") {
      messages.push({
        actor: "supplier",
        title: request.supplier_name || "Поставщик",
        meta: "Не можем привезти",
        text: comment || "Поставщик отметил, что не может привезти позицию.",
        created_at: event.created_at,
        order: 5,
        status,
      });
    } else if (status === "problem" && comment) {
      messages.push({
        actor: "supplier",
        title: request.supplier_name || "Поставщик",
        meta: "Проблема",
        text: comment,
        created_at: event.created_at,
        order: 6,
        status,
      });
    } else if (["china_tracking", "china_warehouse"].includes(status) && (comment || plainText(event.tracking_number))) {
      messages.push({
        actor: "supplier",
        title: request.supplier_name || "Поставщик",
        meta: status === "china_tracking" ? "Трек" : "Склад в Китае",
        text: [plainText(event.tracking_number), comment].filter(Boolean).join("\n"),
        created_at: event.created_at,
        order: 7,
        status,
      });
    }
  }

  return messages.sort((a, b) => (dateMs(a.created_at) - dateMs(b.created_at)) || (a.order - b.order));
}

function renderChinaThread(bundle = {}) {
  const request = bundle.request || {};
  const messages = chinaChatMessages(bundle);
  if (!messages.length) return "";
  const lastMessage = messages[messages.length - 1] || {};
  const canReply = lastMessage.status === "needs_info" && ["sent", "viewed", "quoted", "needs_info", "no_stock"].includes(request.status);
  return `
    <div class="china-preorder-card__thread">
      <strong>Чат по запчасти</strong>
      <div class="china-chat">
        ${messages.map((message) => `
          <article class="china-chat__message china-chat__message--${escapeHtml(message.actor)}">
            <div class="china-chat__bubble">
              <div class="china-chat__meta">
                <b>${escapeHtml(message.title)}</b>
                <span>${escapeHtml(message.meta)} · ${escapeHtml(shortDateTime(message.created_at))}</span>
              </div>
              <p>${escapeHtml(message.text)}</p>
            </div>
          </article>
        `).join("")}
      </div>
      ${canReply ? `
        <label>
          <span>Ответ поставщику</span>
          <textarea rows="2" placeholder="Добавьте недостающую информацию: размер, цвет, сторону, фото..." data-china-reply-text></textarea>
        </label>
        <div class="china-preorder-card__thread-actions">
          <button class="admin-btn admin-btn--small" type="button" data-china-reply="${escapeHtml(request.id)}">Отправить ответ</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderChinaPreorders() {
  const root = document.querySelector("[data-china-preorders]");
  if (!root) return;
  const rows = state.chinaPreorders || [];
  if (!rows.length) {
    root.innerHTML = `<p class="muted china-preorders__empty">Активных запросов пока нет.</p>`;
    return;
  }

  root.innerHTML = rows.map((bundle) => {
    const request = bundle.request || {};
    const order = bundle.order || {};
    const quote = selectedSupplierQuote(bundle);
    const payment = bundle.payment || null;
    const link = supplierUrl(bundle.supplier_url || bundle.supplier_link);
    const receiptLink = payment?.receipt_telegram_file_id && request.access_token
      ? `/api/supplier/request/${encodeURIComponent(request.access_token)}/payment-receipt`
      : "";
    const trackingEvent = (bundle.tracking_events || []).find((event) => plainText(event.tracking_number));
    const canSendPayment = quote && !payment && !["closed", "canceled"].includes(request.status);
    return `
      <article class="china-preorder-card" data-china-preorder="${escapeHtml(request.id)}">
        <div class="china-preorder-card__head">
          <div>
            <strong>${escapeHtml(request.public_number || request.id || "Запрос")}</strong>
            <span>${escapeHtml(chinaPreorderStage(bundle))} · ${escapeHtml(request.supplier_name || "поставщик")}</span>
          </div>
          ${supplierRequestBadge(request.status)}
        </div>
        <div class="china-preorder-card__grid">
          <div>
            <span>Заказ CRM</span>
            <button class="admin-link-button" type="button" data-open-order="${escapeHtml(request.order_id)}">${escapeHtml(order.order_number || request.order_id || "-")}</button>
          </div>
          <div><span>Авто</span><strong>${escapeHtml(request.car || order.car || "-")}</strong></div>
          <div><span>Год</span><strong>${escapeHtml(request.car_year || "-")}</strong></div>
          <div><span>VIN</span><strong class="orders-table__mono">${escapeHtml(request.vin || order.vin || "-")}</strong></div>
          <div class="wide"><span>Деталь</span><strong>${escapeHtml(request.item_name || order.item_name || "-")}</strong></div>
          <div><span>Количество</span><strong>${Number(request.quantity || 1)}</strong></div>
        </div>
        ${supplierImageList(bundle.request_images || [])}
        ${renderChinaThread(bundle)}
        <div class="china-preorder-card__quote">
          <strong>Итоговое предложение</strong>
          ${quote ? `
            <div class="china-preorder-card__quote-line">
              <b>${supplierAmount(quote.price_cny, "CNY")}</b>
              <span>${quote.purchase_days ? `${Number(quote.purchase_days)} дн.` : "срок не указан"}</span>
              <span>${escapeHtml(quote.status || "new")}</span>
            </div>
            ${quote.comment_cn ? `<p>${escapeHtml(quote.comment_ru || quote.comment_translated || quote.comment_cn)}</p>` : ""}
          ` : `<p class="muted">Предложения по цене пока нет.</p>`}
        </div>
        <div class="china-preorder-card__payment">
          <strong>Оплата</strong>
          ${payment ? `
            <div class="china-preorder-card__quote-line">
              ${supplierPaymentBadge(payment.status)}
              <b>${supplierAmount(payment.requested_amount, payment.requested_currency)}</b>
              ${receiptLink ? `<a href="${escapeHtml(receiptLink)}" target="_blank" rel="noopener">открыть скрин оплаты</a>` : `<span>скрина ещё нет</span>`}
            </div>
          ` : `<p class="muted">Запрос на оплату ещё не отправляли.</p>`}
        </div>
        ${trackingEvent ? `
          <div class="china-preorder-card__tracking">
            <strong>Трек</strong>
            <span class="orders-table__mono">${escapeHtml(trackingEvent.tracking_number)}</span>
          </div>
        ` : ""}
        <div class="china-preorder-card__actions">
          <a class="admin-btn admin-btn--small" href="${escapeHtml(link)}" target="_blank" rel="noopener">Открыть карточку</a>
          <button class="admin-btn admin-btn--small" type="button" data-copy-supplier-link="${escapeHtml(link)}">Скопировать ссылку</button>
          ${canSendPayment ? `
            <button class="admin-btn admin-btn--primary admin-btn--small" type="button" data-china-send-payment="${escapeHtml(request.id)}" data-china-quote-id="${escapeHtml(quote.id)}">
              Отправить на оплату
            </button>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderSupplierTrackingEvents(events = []) {
  if (!events.length) return `<p class="muted">Китайський трек і статуси ще не вносилися.</p>`;
  return `
    <ol class="event-list supplier-tracking-events">
      ${events.map((event) => `
        <li>
          <strong>${escapeHtml(supplierRequestStatusLabels[event.status] || event.status || "Статус")}</strong>
          <span>${escapeHtml(shortDateTime(event.created_at))}${event.tracking_number ? ` · ${escapeHtml(event.tracking_number)}` : ""}</span>
          ${event.comment_cn ? `<p lang="zh-CN">${escapeHtml(event.comment_cn)}</p>` : ""}
          ${event.comment_translated ? `<p>${escapeHtml(event.comment_translated)}</p>` : ""}
        </li>
      `).join("")}
    </ol>
  `;
}

function renderSupplierQuoteCard(quote, request) {
  const selected = quote.status === "selected";
  const rejected = quote.status === "rejected";
  const canSelect = quote.status === "new" && quote.availability !== "no_stock" && Number(quote.price_cny || 0) > 0 && !["canceled", "closed"].includes(request.status);
  return `
    <article class="supplier-quote-card ${selected ? "supplier-quote-card--selected" : ""} ${rejected ? "supplier-quote-card--rejected" : ""}">
      <div class="supplier-quote-card__head">
        <div>
          <strong>${escapeHtml(supplierQuoteTypeLabels[quote.quote_type] || quote.quote_type || "Original")}</strong>
          <span>${escapeHtml(supplierAvailabilityLabels[quote.availability] || quote.availability || "-")} · ${escapeHtml(shortDateTime(quote.created_at))}</span>
        </div>
        <b>${supplierAmount(quote.price_cny, "CNY")}</b>
      </div>
      <div class="supplier-quote-card__meta">
        ${quote.part_number ? `<span>№ ${escapeHtml(quote.part_number)}</span>` : ""}
        ${quote.quantity ? `<span>К-сть: ${Number(quote.quantity)}</span>` : ""}
        ${quote.purchase_days ? `<span>Викуп: ${Number(quote.purchase_days)} дн.</span>` : ""}
        ${quote.china_delivery_days ? `<span>Китай: ${Number(quote.china_delivery_days)} дн.</span>` : ""}
        <span>${escapeHtml(quote.status || "new")}</span>
      </div>
      ${quote.comment_cn ? `<p lang="zh-CN">${escapeHtml(quote.comment_cn)}</p>` : ""}
      ${quote.comment_translated ? `<p>${escapeHtml(quote.comment_translated)}</p>` : ""}
      ${supplierImageList(quote.images || [])}
      ${selected ? `<strong class="supplier-quote-card__selected">Обрано для роботи</strong>` : canSelect ? `
        <button class="admin-btn admin-btn--small" type="button" data-select-supplier-quote="${escapeHtml(quote.id)}" data-supplier-request-id="${escapeHtml(quote.supplier_request_id)}">
          Відправити на оплату
        </button>
      ` : `<span class="muted">Цей варіант не можна обрати.</span>`}
    </article>
  `;
}

function renderSupplierRequests(order) {
  const rows = state.selectedSupplierRequests || [];
  return `
    <section class="supplier-requests wide">
      <div class="supplier-requests__head">
        <div>
          <strong>Запити постачальникам</strong>
          <span>Magic-link для WeChat/WhatsApp і відповіді з китайського інтерфейсу.</span>
        </div>
      </div>

      <div class="supplier-requests__create">
        <label>
          Постачальник
          <select data-supplier-request-input="supplier_name" data-supplier-request-supplier>
            ${supplierDirectoryOptions()}
          </select>
        </label>
        <label data-supplier-request-custom hidden>
          Інший постачальник
          <input data-supplier-request-input="supplier_name_custom" placeholder="Назва постачальника">
        </label>
        <label>
          Запчастина
          <input data-supplier-request-input="item_name" value="${escapeHtml(order.item_name || order.service_name || "")}" placeholder="що шукаємо">
        </label>
        <label>
          Рік
          <input data-supplier-request-input="car_year" inputmode="numeric" maxlength="4" placeholder="2023">
        </label>
        <label>
          Кількість
          <input data-supplier-request-input="quantity" type="number" min="1" step="1" value="1">
        </label>
        <label class="wide">
          Фото, URL
          <input data-supplier-request-input="image_url" type="url" placeholder="https://...">
        </label>
        <label class="wide">
          Опис для постачальника
          <textarea data-supplier-request-input="request_text" rows="3" placeholder="Китайською або простим текстом без імені клієнта, телефону, адреси, маржі чи внутрішніх фінансів"></textarea>
        </label>
        <label class="wide">
          Уточнення для постачальника
          <textarea data-supplier-request-input="manager_comment" rows="2" placeholder="сторона, колір, комплектація, OEM номер, нова/б/у, пакування"></textarea>
        </label>
        <p class="supplier-request-warning wide">
          Перед копіюванням посилання перевірте: VIN підтверджено, фото/сторона/колір вказані, у тексті немає контактів клієнта або внутрішніх сум EVLine.
        </p>
        <button class="admin-btn admin-btn--primary wide" type="button" data-create-supplier-request="${escapeHtml(order.id)}">
          Створити запит і посилання
        </button>
      </div>

      ${rows.length ? `
        <div class="supplier-requests__list">
          ${rows.map((bundle) => {
            const request = bundle.request || {};
            const link = supplierUrl(bundle.supplier_url || bundle.supplier_link);
            const dashboardLink = supplierUrl(bundle.dashboard_url || bundle.dashboard_link);
            return `
              <article class="supplier-request-card" data-supplier-request-card="${escapeHtml(request.id)}">
                <div class="supplier-request-card__head">
                  <div>
                    <strong>${textOrDash(request.public_number || request.id)}</strong>
                    ${supplierRequestBadge(request.status)}
                    <span>${textOrDash(request.supplier_name)} · ${escapeHtml(shortDateTime(request.created_at))}</span>
                  </div>
                  <a class="admin-btn admin-btn--small" href="${escapeHtml(link)}" target="_blank" rel="noopener">Відкрити CN</a>
                </div>
                <div class="supplier-request-card__body">
                  <div class="supplier-request-card__info">
                    <span>Авто: <b>${textOrDash(request.car)}</b></span>
                    <span>VIN: <b class="orders-table__mono">${textOrDash(request.vin)}</b></span>
                    <span>Позиція: <b>${textOrDash(request.item_name)}</b></span>
                    <span>К-сть: <b>${Number(request.quantity || 1)}</b></span>
                  </div>
                  ${supplierImageList(bundle.request_images || [])}
                  <label class="supplier-link-field">
                    Посилання для постачальника
                    <input value="${escapeHtml(link)}" readonly>
                  </label>
                  <div class="supplier-request-card__actions">
                    <button class="admin-btn admin-btn--small" type="button" data-copy-supplier-link="${escapeHtml(link)}">Скопіювати посилання</button>
                    ${dashboardLink ? `<button class="admin-btn admin-btn--small" type="button" data-copy-supplier-link="${escapeHtml(dashboardLink)}">Скопіювати список</button>` : ""}
                  </div>
                </div>
                <div class="supplier-request-card__quotes">
                  <strong>Пропозиції</strong>
                  ${bundle.quotes?.length
                    ? bundle.quotes.map((quote) => renderSupplierQuoteCard(quote, request)).join("")
                    : `<p class="muted">Постачальник ще не відповів.</p>`}
                </div>
                <details class="supplier-request-card__events">
                  <summary>Китайський трек і події</summary>
                  ${renderSupplierTrackingEvents(bundle.tracking_events || [])}
                </details>
              </article>
            `;
          }).join("")}
        </div>
      ` : `<p class="muted supplier-requests__empty">Запитів постачальникам ще немає.</p>`}
    </section>
  `;
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
          <select data-supplier-payment-input="supplier_name" data-supplier-payment-supplier>
            ${supplierDirectoryOptions()}
          </select>
        </label>
        <label data-supplier-payment-custom hidden>
          Інший постачальник
          <input data-supplier-payment-input="supplier_name_custom" placeholder="${escapeHtml(requestedPlaceholder)}">
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
          const customerName = plainText(order.customer_name);
          const carName = plainText(order.car);
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
            : "";
          return `
            <tr data-order-id="${escapeHtml(order.id)}">
              <td class="orders-table__number-cell" data-label="№ / дата"><strong class="order-number">${textOrDash(publicNumber)}</strong><span class="orders-table__date">${escapeHtml(shortDateTime(order.created_at))}</span>${orderTypePill(order.type)}</td>
              <td data-label="Клієнт">${customerName ? `<strong class="orders-table__primary">${escapeHtml(customerName)}</strong>` : ""}${contactLine(order)}</td>
              <td class="orders-table__request-cell" data-label="Авто / запит">${carName ? `<strong class="orders-table__primary">${escapeHtml(carName)}</strong>` : ""}${mutedLine(order.vin, "orders-table__mono")}${mutedLine(request, "orders-table__request")}</td>
              <td data-label="Статус">${badge(order.status || "new", true)}${mutedLine(nextAction)}</td>
              <td data-label="Сума">${moneyCell(order)}</td>
              <td class="orders-table__track-cell" data-label="Трек">${trackCell}</td>
              <td data-label="Дії">
                <div class="orders-table__actions">
                  <button class="admin-btn admin-btn--small orders-table__china" type="button" data-order-to-china="${escapeHtml(order.id)}" aria-label="Запрос в Китай для ${escapeHtml(publicNumber)}" title="Запрос в Китай">
                    В Китай
                  </button>
                  <button class="admin-btn admin-btn--icon orders-table__open" type="button" data-open-order="${escapeHtml(order.id)}" aria-label="Відкрити картку ${escapeHtml(publicNumber)}" title="Відкрити картку">
                    <span aria-hidden="true">✎</span>
                  </button>
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
    state.selectedSupplierRequests = [];
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
    `<option value="__custom__" ${selectedId === "__custom__" ? "selected" : ""}>Інший / додати вручну</option>`,
  ].join("");
}

function shippingModeOptions(selectedMode) {
  return Object.entries(shippingModeLabels)
    .map(([value, label]) => `<option value="${value}" ${selectedMode === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function applyShippingSelection(form, options = {}) {
  const carrierChoice = form.elements.shipping_carrier_choice?.value || form.elements.shipping_carrier_id?.value || "";
  const customCarrier = form.querySelector("[data-shipping-carrier-custom]");
  if (carrierChoice === "__custom__") {
    if (form.elements.shipping_carrier_id) form.elements.shipping_carrier_id.value = "";
    if (customCarrier) customCarrier.hidden = false;
    const customName = plainText(form.querySelector("[data-shipping-carrier-custom-input]")?.value);
    if (form.elements.tracking_carrier) form.elements.tracking_carrier.value = customName;
    if (form.querySelector("[data-shipping-rate-display]")) {
      form.querySelector("[data-shipping-rate-display]").value = "Внесіть перевізника вручну або додайте його в тарифах";
    }
    if (form.querySelector("[data-shipping-hint]")) {
      form.querySelector("[data-shipping-hint]").textContent = "Внесіть перевізника вручну або додайте його в тарифах";
    }
    form.querySelector("[data-shipping-carrier-custom-input]")?.focus();
    return;
  }
  if (form.elements.shipping_carrier_id) form.elements.shipping_carrier_id.value = carrierChoice;
  if (customCarrier) customCarrier.hidden = true;
  const carrierId = carrierChoice;
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

  if (carrier && form.elements.tracking_carrier) {
    form.elements.tracking_carrier.value = carrier.name || "";
  } else if (form.elements.tracking_carrier) {
    form.elements.tracking_carrier.value = "";
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
  const matchedCarrier = carrierByName(order.tracking_carrier);
  const selectedCarrierId = order.shipping_carrier_id || matchedCarrier?.id || "";
  const selectedMode = order.shipping_mode || "air";
  const selectedRate = selectRate(selectedCarrierId, selectedMode, order.shipping_rate_id);
  const currentRateLabel = selectedRate ? rateLabel(selectedRate) : "Оберіть перевізника і тип доставки";
  const selectedCarrier = carrierById(selectedCarrierId) || matchedCarrier || null;
  const customCarrierName = order.tracking_carrier && !matchedCarrier ? order.tracking_carrier : "";
  const autoTrackingAvailable = Number(selectedCarrier?.tracking_auto_enabled) === 1 || /meest|mist/i.test(`${order.tracking_carrier || ""} ${order.tracking_number || ""}`);
  const trackingStatus = order.tracking_status_text
    ? `${order.tracking_status_text}${order.tracking_status_location ? ` (${order.tracking_status_location})` : ""}`
    : "Статус перевізника ще не перевірявся";
  const orderNumber = order.order_number || "без номера";
  const customerNumber = order.customer_number || "без номера";
  const leadNumber = order.lead_number || "";
  const managerContact = order.manager_contact || (order.type === "byd" ? "@evline_tech" : "@evline_support");
  const customerContact = order.customer_phone || order.customer_email || order.customer_telegram;
  const customerName = plainText(order.customer_name);
  const carName = plainText(order.car);
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
          ${customerName ? `<strong class="order-editor__meta-title">${escapeHtml(customerName)}</strong>` : ""}
          <div class="order-editor__meta-contact">${customerContact ? contactLine(order) : `<span class="muted">контакт не вказано</span>`}</div>
        </div>
        <span class="order-editor__meta-manager" title="Менеджер">
          <span>Менеджер</span>
          <strong>${textOrDash(managerContact)}</strong>
        </span>
      </div>
      <div class="order-editor__meta-grid">
        <div class="order-editor__meta-field">
          <span>VIN</span>
          <strong class="orders-table__mono">${textOrDash(order.vin)}</strong>
        </div>
        <div class="order-editor__meta-field">
          <span>Авто</span>
          ${carName ? `<strong>${escapeHtml(carName)}</strong>` : ""}
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
      <button class="order-editor__tab ${activeOrderEditorTab() === "suppliers" ? "is-active" : ""}" type="button" data-order-tab="suppliers" role="tab" aria-selected="${activeOrderEditorTab() === "suppliers" ? "true" : "false"}">Постачальники</button>
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

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "suppliers" ? "is-active" : ""}" data-order-pane="suppliers" ${activeOrderEditorTab() === "suppliers" ? "" : "hidden"}>
      <div class="order-editor__grid">

    ${renderSupplierRequests(order)}

      </div>
    </section>

    <section class="order-editor__pane wide ${activeOrderEditorTab() === "delivery" ? "is-active" : ""}" data-order-pane="delivery" ${activeOrderEditorTab() === "delivery" ? "" : "hidden"}>
      <div class="order-editor__grid">

    <label>
      Перевізник
      <select name="shipping_carrier_choice" data-shipping-carrier>
        ${shippingCarrierOptions(customCarrierName ? "__custom__" : selectedCarrierId)}
      </select>
    </label>
    <label data-shipping-carrier-custom ${customCarrierName ? "" : "hidden"}>
      Інший перевізник
      <input name="tracking_carrier_custom" value="${escapeHtml(customCarrierName)}" placeholder="Назва перевізника" data-shipping-carrier-custom-input>
    </label>
    <input type="hidden" name="shipping_carrier_id" value="${escapeHtml(selectedCarrierId)}">
    <input type="hidden" name="tracking_carrier" value="${escapeHtml(order.tracking_carrier || selectedCarrier?.name || "")}">
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
  state.selectedSupplierRequests = data.supplier_requests || [];
  renderOrderEditor(state.selectedOrder);
}

async function loadChinaPreorders() {
  const params = new URLSearchParams({
    status: document.querySelector("[data-china-status]")?.value || "active",
    q: document.querySelector("[data-china-search]")?.value || "",
    limit: "120",
  });
  const data = await api(`/api/admin/supplier-requests?${params}`);
  state.chinaPreorders = data.preorders || [];
  renderChinaPreorders();
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
    state.selectedSupplierRequests = [];
    renderOrderEditor(null);
    closeOrderDetail();
  }
  await refresh();
  alert("Заявку видалено.");
  return true;
}

function collectSupplierPaymentCreatePayload(form) {
  const value = (name) => form.querySelector(`[data-supplier-payment-input="${name}"]`)?.value || "";
  const supplierChoice = value("supplier_name");
  return {
    supplier_name: supplierChoice === "__custom__" ? value("supplier_name_custom") : supplierChoice,
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
    await Promise.all([loadSummary(), loadOrders(), loadChinaPreorders(), loadShipping(), loadGoogleAds()]);
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

function setManualOrderFormOpen(open) {
  const form = document.querySelector("[data-manual-order-form]");
  const button = document.querySelector("[data-manual-order-toggle]");
  if (!form) return;
  form.hidden = !open;
  if (button) button.textContent = open ? "Закрити форму" : "+ Додати заявку";
  if (open) {
    form.querySelector("input[name='customer_phone']")?.focus();
  }
}

function manualOrderPayload(form) {
  const payload = Object.fromEntries(new FormData(form));
  const channel = plainText(payload.medium) || "phone";
  const topic = plainText(payload.item_name);
  payload.source = "manual";
  payload.medium = channel;
  payload.campaign = `manual-${channel}`;
  payload.status = "new";
  payload.payment_status = "unknown";
  payload.manager_notes = plainText(payload.manager_notes);
  if (payload.type === "byd") {
    payload.service_name = topic;
    payload.item_name = "";
  }
  return payload;
}

function manualOrderHasUsefulData(payload) {
  return [
    payload.customer_name,
    payload.customer_phone,
    payload.customer_email,
    payload.customer_telegram,
    payload.car,
    payload.vin,
    payload.item_name,
    payload.service_name,
    payload.request_text,
  ].some((value) => plainText(value));
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать фото."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось открыть фото."));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

async function compressChinaPhoto(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Выберите файл изображения.");

  const source = await readFileDataUrl(file);
  const image = await loadImage(source);
  const maxSide = 1200;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const blob = await canvasToBlob(canvas, quality);
    if (!blob) continue;
    const dataUrl = await readFileDataUrl(blob);
    if (dataUrl.length <= 1_200_000) return dataUrl;
  }

  throw new Error("Фото слишком большое. Выберите изображение поменьше.");
}

function renderChinaPhotoPreview(form, dataUrl, fileName = "") {
  if (!form) return;
  const preview = form.querySelector("[data-china-photo-preview]");
  if (!preview) return;
  if (!dataUrl) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  preview.hidden = false;
  preview.innerHTML = `
    <img src="${escapeHtml(dataUrl)}" alt="Фото детали">
    <span>${escapeHtml(fileName || "Фото добавлено")}</span>
    <button class="admin-btn admin-btn--icon admin-btn--subtle-danger china-photo-remove" type="button" data-china-photo-remove aria-label="Удалить фото" title="Удалить фото">
      <span aria-hidden="true">🗑</span>
    </button>
  `;
}

function clearChinaPhoto(form) {
  if (!form) return;
  const input = form.querySelector("[data-china-photo-input]");
  const hidden = form.querySelector("[data-china-photo-data]");
  if (input) input.value = "";
  if (hidden) hidden.value = "";
  renderChinaPhotoPreview(form, "", "");
}

async function prepareChinaPhoto(form) {
  const input = form.querySelector("[data-china-photo-input]");
  const hidden = form.querySelector("[data-china-photo-data]");
  const file = input?.files?.[0];
  if (!hidden || !file) return hidden?.value || "";
  const dataUrl = await compressChinaPhoto(file);
  hidden.value = dataUrl;
  renderChinaPhotoPreview(form, dataUrl, file.name);
  return dataUrl;
}

function chinaPreorderPayload(form) {
  const payload = Object.fromEntries(new FormData(form));
  const supplierName = plainText(payload.supplier_name) === "__custom__"
    ? plainText(payload.supplier_name_custom)
    : plainText(payload.supplier_name);
  return {
    order_id: plainText(payload.order_id),
    supplier_name: supplierName,
    car: plainText(payload.car),
    car_year: plainText(payload.car_year).replace(/[^\d]/g, "").slice(0, 4),
    vin: plainText(payload.vin).toUpperCase(),
    item_name: plainText(payload.item_name),
    quantity: plainText(payload.quantity) || "1",
    image_url: plainText(payload.image_url),
    request_text: plainText(payload.request_text),
  };
}

async function createChinaPreorder(payload) {
  let orderId = payload.order_id;
  if (!orderId) {
    const orderResult = await api("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify({
        type: "parts",
        status: "new",
        source: "manual",
        medium: "china-preorder",
        campaign: "manual-china-preorder",
        car: payload.car,
        vin: payload.vin,
        item_name: payload.item_name,
        request_text: payload.request_text,
        manager_notes: "Создано из мини-CRM Запросы в Китай",
      }),
    });
    orderId = orderResult.order?.id || "";
  }
  if (!orderId) throw new Error("Не удалось определить заказ CRM для запроса.");

  return api(`/api/admin/orders/${encodeURIComponent(orderId)}/supplier-requests`, {
    method: "POST",
    body: JSON.stringify({
      supplier_name: payload.supplier_name,
      car: payload.car,
      car_year: payload.car_year,
      vin: payload.vin,
      item_name: payload.item_name,
      quantity: payload.quantity,
      image_url: payload.image_url,
      request_text: payload.request_text,
    }),
  });
}

function startChinaPreorderFromOrder(orderId) {
  const order = (state.orders || []).find((item) => item.id === orderId);
  if (!order) {
    alert("Заказ не найден в текущем списке.");
    return;
  }

  setActiveTab("china");
  const form = document.querySelector("[data-china-preorder-form]");
  if (!form) return;
  form.reset();
  clearChinaPhoto(form);
  hideChinaCreatedLink(form);
  const customSupplier = document.querySelector("[data-china-custom-supplier]");
  if (customSupplier) customSupplier.hidden = true;
  const setValue = (name, value) => {
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.value = value || "";
  };

  setValue("order_id", order.id);
  setValue("car", order.car || "");
  setValue("car_year", order.car_year || "");
  setValue("vin", order.vin || "");
  setValue("item_name", order.item_name || order.service_name || "");

  const quantity = form.querySelector("[name='quantity']");
  if (quantity && !quantity.value) quantity.value = "1";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.querySelector("[name='supplier_name']")?.focus();
}

function collectSupplierRequestCreatePayload(form) {
  const value = (name) => form.querySelector(`[data-supplier-request-input="${name}"]`)?.value || "";
  const supplierChoice = value("supplier_name");
  return {
    supplier_name: supplierChoice === "__custom__" ? value("supplier_name_custom") : supplierChoice,
    item_name: value("item_name"),
    car_year: value("car_year").replace(/[^\d]/g, "").slice(0, 4),
    quantity: value("quantity") || "1",
    image_url: value("image_url"),
    request_text: value("request_text"),
    manager_comment: value("manager_comment"),
  };
}

document.querySelector("[data-token-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = new FormData(event.currentTarget).get("token");
  if (token) localStorage.setItem("evline_admin_token", token);
  setAuthVisible(false);
  refresh();
});

document.querySelector("[data-clear-token]")?.addEventListener("click", () => {
  localStorage.removeItem("evline_admin_token");
  setAuthVisible(true);
});

document.querySelector("[data-manual-order-toggle]")?.addEventListener("click", () => {
  const form = document.querySelector("[data-manual-order-form]");
  setManualOrderFormOpen(Boolean(form?.hidden));
});

document.querySelector("[data-manual-order-cancel]")?.addEventListener("click", () => {
  const form = document.querySelector("[data-manual-order-form]");
  form?.reset();
  setManualOrderFormOpen(false);
});

document.querySelector("[data-manual-order-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const payload = manualOrderPayload(form);
  if (!manualOrderHasUsefulData(payload)) {
    alert("Заповніть хоча б контакт, авто, VIN або запит клієнта.");
    return;
  }
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Створюю...";
  try {
    const result = await api("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    form.reset();
    setManualOrderFormOpen(false);
    await refresh();
    if (result.order?.id) await openOrder(result.order.id, { scroll: false });
  } catch (error) {
    alert(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = "Створити заявку";
  }
});

document.querySelector("[data-refresh]")?.addEventListener("click", refresh);
document.querySelector("[data-refresh-china]")?.addEventListener("click", loadChinaPreorders);
document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.adminTab));
});

document.querySelector("[data-china-supplier]")?.addEventListener("change", (event) => {
  const custom = document.querySelector("[data-china-custom-supplier]");
  if (!custom) return;
  custom.hidden = event.currentTarget.value !== "__custom__";
  if (!custom.hidden) custom.querySelector("input")?.focus();
});

document.querySelector("[data-china-status]")?.addEventListener("change", loadChinaPreorders);
document.querySelector("[data-china-search]")?.addEventListener("input", () => {
  clearTimeout(window.__chinaSearchTimer);
  window.__chinaSearchTimer = setTimeout(loadChinaPreorders, 250);
});

document.querySelector("[data-china-photo-input]")?.addEventListener("change", async (event) => {
  const form = event.currentTarget.closest("form");
  const hidden = form?.querySelector("[data-china-photo-data]");
  if (hidden) hidden.value = "";
  renderChinaPhotoPreview(form, "", "");
  const file = event.currentTarget.files?.[0];
  if (!file || !form) return;
  try {
    await prepareChinaPhoto(form);
  } catch (error) {
    event.currentTarget.value = "";
    if (hidden) hidden.value = "";
    renderChinaPhotoPreview(form, "", "");
    alert(error.message);
  }
});

document.querySelector("[data-china-preorder-form]")?.addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-copy-supplier-link]");
  if (copyButton) {
    const value = copyButton.dataset.copySupplierLink || "";
    navigator.clipboard?.writeText(value).then(() => {
      const original = copyButton.textContent;
      copyButton.textContent = "Скопировано";
      setTimeout(() => { copyButton.textContent = original; }, 1500);
    });
    return;
  }

  const removeButton = event.target.closest("[data-china-photo-remove]");
  if (!removeButton) return;
  clearChinaPhoto(removeButton.closest("form"));
});

document.querySelector("[data-china-preorder-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  try {
    await prepareChinaPhoto(form);
  } catch (error) {
    alert(error.message);
    return;
  }
  const payload = chinaPreorderPayload(form);
  if (!plainText(payload.supplier_name)) {
    alert("Выберите поставщика.");
    return;
  }
  if (!plainText(payload.item_name) && !plainText(payload.request_text)) {
    alert("Укажите деталь или текст запроса.");
    return;
  }
  hideChinaCreatedLink(form);
  button.disabled = true;
  button.textContent = "Создаю...";
  try {
    const result = await createChinaPreorder(payload);
    form.reset();
    clearChinaPhoto(form);
    const custom = document.querySelector("[data-china-custom-supplier]");
    if (custom) custom.hidden = true;
    await Promise.all([loadChinaPreorders(), loadOrders()]);
    const link = result.supplier_request?.supplier_url || result.supplier_request?.supplier_link || "";
    if (link) {
      navigator.clipboard?.writeText(link).catch(() => null);
      showChinaCreatedLink(form, link);
    } else {
      alert("Запрос в Китай создан.");
    }
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Запрос в Китай";
  }
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
  const chinaButton = event.target.closest("[data-order-to-china]");
  if (chinaButton) {
    startChinaPreorderFromOrder(chinaButton.dataset.orderToChina);
    return;
  }

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

document.querySelector("[data-china-preorders]")?.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-order]");
  if (openButton) {
    state.orderEditorTab = "suppliers";
    setActiveTab("orders");
    openOrder(openButton.dataset.openOrder).catch((error) => alert(error.message));
    return;
  }

  const copyButton = event.target.closest("[data-copy-supplier-link]");
  if (copyButton) {
    const value = copyButton.dataset.copySupplierLink || "";
    navigator.clipboard?.writeText(value).then(() => {
      const original = copyButton.textContent;
      copyButton.textContent = "Скопировано";
      setTimeout(() => { copyButton.textContent = original; }, 1500);
    });
    return;
  }

  const replyButton = event.target.closest("[data-china-reply]");
  if (replyButton) {
    const requestId = replyButton.dataset.chinaReply || "";
    const card = replyButton.closest("[data-china-preorder]");
    const textarea = card?.querySelector("[data-china-reply-text]");
    const managerComment = plainText(textarea?.value);
    if (!managerComment) {
      alert("Добавьте ответ поставщику.");
      textarea?.focus();
      return;
    }
    replyButton.disabled = true;
    replyButton.textContent = "Отправляю...";
    try {
      const result = await api(`/api/admin/supplier-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        body: JSON.stringify({ manager_comment: managerComment }),
      });
      state.chinaPreorders = result.preorders || state.chinaPreorders;
      renderChinaPreorders();
      await loadOrders();
    } catch (error) {
      alert(error.message);
      replyButton.disabled = false;
      replyButton.textContent = "Отправить ответ";
    }
    return;
  }

  const paymentButton = event.target.closest("[data-china-send-payment]");
  if (!paymentButton) return;
  const requestId = paymentButton.dataset.chinaSendPayment || "";
  const bundle = (state.chinaPreorders || []).find((item) => item.request?.id === requestId) || {};
  const quote = selectedSupplierQuote(bundle) || {};
  const request = bundle.request || {};
  const confirmText = [
    "Клиент согласовал цену?",
    "",
    `Поставщик: ${request.supplier_name || "-"}`,
    `Сумма: ${supplierAmount(quote.price_cny, "CNY")}`,
    "После подтверждения запрос на оплату уйдёт в Telegram.",
  ].join("\n");
  if (!confirm(confirmText)) return;
  paymentButton.disabled = true;
  paymentButton.textContent = "Отправляю...";
  try {
    const result = await api(`/api/admin/supplier-requests/${encodeURIComponent(requestId)}/send-payment`, {
      method: "POST",
      body: JSON.stringify({ quote_id: paymentButton.dataset.chinaQuoteId || "", client_approved: true }),
    });
    state.chinaPreorders = result.preorders || state.chinaPreorders;
    renderChinaPreorders();
    await loadOrders();
    alert("Запрос на оплату отправлен в Telegram.");
  } catch (error) {
    alert(error.message);
    paymentButton.disabled = false;
    paymentButton.textContent = "Отправить на оплату";
  }
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
  state.selectedSupplierRequests = result.supplier_requests || state.selectedSupplierRequests;
  renderOrderEditor(result.order);
  await refresh();
});

document.querySelector("[data-order-editor]")?.addEventListener("input", (event) => {
  if (event.target.matches("[data-shipping-carrier-custom-input]")) {
    applyShippingSelection(event.currentTarget, { overwriteCost: false });
  }
  if (event.target.matches("[data-shipping-weight], [data-shipping-volume]")) {
    applyShippingSelection(event.currentTarget, { overwriteCost: true });
  }
});

document.querySelector("[data-order-editor]")?.addEventListener("change", (event) => {
  if (event.target.matches("[data-supplier-payment-supplier]")) {
    syncSupplierCustomField(event.currentTarget);
  }
  if (event.target.matches("[data-supplier-request-supplier]")) {
    syncSupplierRequestCustomField(event.currentTarget);
  }
  if (event.target.matches("[data-shipping-carrier], [data-shipping-mode], [name='tracking_number'], [data-shipping-carrier-custom-input]")) {
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

  const copySupplierLinkButton = event.target.closest("[data-copy-supplier-link]");
  if (copySupplierLinkButton) {
    const value = copySupplierLinkButton.dataset.copySupplierLink || "";
    navigator.clipboard?.writeText(value).then(() => {
      const original = copySupplierLinkButton.textContent;
      copySupplierLinkButton.textContent = "Скопійовано";
      setTimeout(() => { copySupplierLinkButton.textContent = original; }, 1500);
    });
    return;
  }

  const createSupplierRequestButton = event.target.closest("[data-create-supplier-request]");
  if (createSupplierRequestButton) {
    const payload = collectSupplierRequestCreatePayload(event.currentTarget);
    if (!plainText(payload.supplier_name)) {
      alert("Оберіть постачальника.");
      return;
    }
    if (!plainText(payload.item_name) && !plainText(payload.request_text)) {
      alert("Вкажіть запчастину або опис запиту.");
      return;
    }
    createSupplierRequestButton.disabled = true;
    createSupplierRequestButton.textContent = "Створюю...";
    try {
      const result = await api(`/api/admin/orders/${encodeURIComponent(createSupplierRequestButton.dataset.createSupplierRequest)}/supplier-requests`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.selectedOrder = result.order || state.selectedOrder;
      state.selectedSupplierRequests = result.supplier_requests || state.selectedSupplierRequests;
      state.orderEditorTab = "suppliers";
      renderOrderEditor(state.selectedOrder);
      await loadOrders();
      const link = result.supplier_request?.supplier_url || result.supplier_request?.supplier_link || "";
      if (link) {
        navigator.clipboard?.writeText(link).catch(() => null);
        alert("Запит створено. Посилання для постачальника скопійовано.");
      } else {
        alert("Запит створено.");
      }
    } catch (error) {
      alert(error.message);
      createSupplierRequestButton.disabled = false;
      createSupplierRequestButton.textContent = "Створити запит і посилання";
    }
    return;
  }

  const selectSupplierQuoteButton = event.target.closest("[data-select-supplier-quote]");
  if (selectSupplierQuoteButton) {
    const quoteId = selectSupplierQuoteButton.dataset.selectSupplierQuote || "";
    const requestId = selectSupplierQuoteButton.dataset.supplierRequestId || "";
    const supplierRequest = (state.selectedSupplierRequests || []).find((bundle) => bundle.request?.id === requestId) || {};
    const quote = (supplierRequest.quotes || []).find((item) => item.id === quoteId) || {};
    const request = supplierRequest.request || {};
    const confirmText = [
      "Клієнт погодив ціну?",
      "",
      `Постачальник: ${request.supplier_name || "-"}`,
      `Сума: ${supplierAmount(quote.price_cny, "CNY")}`,
      "Після підтвердження запит на оплату піде в Telegram.",
    ].join("\n");
    if (!confirm(confirmText)) return;
    selectSupplierQuoteButton.disabled = true;
    selectSupplierQuoteButton.textContent = "Відправляю...";
    try {
      const result = await api(`/api/admin/supplier-quotes/${encodeURIComponent(selectSupplierQuoteButton.dataset.selectSupplierQuote)}/select`, {
        method: "POST",
        body: JSON.stringify({ client_approved: true }),
      });
      state.selectedOrder = result.order || state.selectedOrder;
      state.selectedSupplierRequests = result.supplier_requests || state.selectedSupplierRequests;
      state.selectedSupplierPayments = result.supplier_payments || state.selectedSupplierPayments;
      state.orderEditorTab = "suppliers";
      renderOrderEditor(state.selectedOrder);
      await loadOrders();
      alert("Запит на оплату відправлено в Telegram.");
    } catch (error) {
      alert(error.message);
      selectSupplierQuoteButton.disabled = false;
      selectSupplierQuoteButton.textContent = "Відправити на оплату";
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
  const method = payload.id && persistedCarrierById(payload.id) ? "PATCH" : "POST";
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
setAuthVisible(!adminToken());
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
