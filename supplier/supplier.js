const root = document.querySelector("[data-app]");
const query = new URLSearchParams(location.search);
const pathParts = location.pathname.split("/").filter(Boolean);
const tokenFromPath = pathParts[0] === "supplier" && ["request", "dashboard"].includes(pathParts[1]) ? pathParts[2] || "" : "";
const token = document.body.dataset.token || query.get("token") || tokenFromPath || "";
const page = document.body.dataset.supplierPage || query.get("page") || (pathParts[1] === "dashboard" ? "dashboard" : "request");
let requestPollTimer = null;
let dashboardData = null;
let requestDataCache = null;
let dashboardTab = "work";
let dashboardSelectedRequestId = "";

const SUPPLIER_LANG_KEY = "evline_supplier_lang_v1";
const supplierLanguages = {
  zh: { label: "中文", locale: "zh-CN", html: "zh-CN" },
  en: { label: "EN", locale: "en-US", html: "en" },
  ru: { label: "RU", locale: "ru-RU", html: "ru" },
};

const supplierI18n = {
  ru: {
    page: {
      requestTitle: "EVLine · Запрос",
      dashboardTitle: "EVLine · Кабинет поставщика",
      requestFallback: "Запрос по детали",
      supplierFallback: "Поставщик",
      dashboardRequestsTitle: "EVLine · Запросы поставщику",
    },
    status: {
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
    },
    paymentLabel: {
      paid: "Оплачено",
      partial: "Частично оплачено",
      requested: "Ждёт оплаты",
      needs_review: "Скрин на проверке",
      canceled: "Отменено",
      fallback: "Оплата",
    },
    errors: {
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
      fallback: "Ошибка запроса",
    },
    ui: {
      send: "Отправить",
      sending: "Отправляем...",
      attachFile: "Прикрепить файл",
      noSupply: "Нет поставки",
      noSupplyTitle: "Отметить, что по позиции нет поставки",
      self: "Я",
      evline: "EVLine",
      logistics: "Логистика",
      requestData: "Данные запроса",
      dialog: "Диалог по заказу",
      quoteAnswer: "Ответ по запросу",
      payment: "Оплата",
      account: "Счёт",
      paid: "Оплачено",
      date: "Дата",
      receipts: "Скрины",
      receiptOpen: "посмотреть скрин",
      paymentConfirmed: "Оплата подтверждена",
      receiptAttached: "Скрин оплаты прикреплён",
      paymentMarkedNoReceipt: "Оплата отмечена, скрин пока не прикреплён.",
      paymentReceiptPending: "После оплаты здесь появится подтверждение.",
      price: "Цена, CNY",
      delivery: "Доставка, CNY",
      deliveryShort: "Доставка",
      days: "Срок поставки, дней",
      commentClarify: "Комментарий / уточнение",
      chinaShipping: "Отправка по Китаю",
      nextTrack: "Следующий шаг: внесите трек",
      trackAfterPayment: "Трек после оплаты",
      trackingNumber: "Трек-номер",
      save: "Сохранить",
      comment: "Комментарий",
      request: "Запрос",
      detail: "Деталь",
      back: "Назад",
      file: "Файл",
      language: "Язык",
    },
    data: {
      vin: "VIN",
      car: "Авто",
      year: "Год",
      detail: "Деталь",
      quantity: "Количество",
      description: "Описание",
      photoAlt: "Фото детали",
      noCar: "Авто не указано",
    },
    meta: {
      clarification: "Уточнение",
      quote: "Предложение",
      message: "Сообщение",
      needsInfo: "Нужно уточнение",
      reply: "Ответ",
      noSupply: "Нет поставки",
      problem: "Проблема",
      chinaTracking: "Отправлено, ждём доставку",
      chinaWarehouse: "На складе в Китае",
      tracking: "Трек: {value}",
      purchaseDays: "Срок поставки: {days} дн.",
    },
    placeholder: {
      price: "например 1200",
      delivery: "0",
      quoteComment: "цена, нюансы, условия или что нужно уточнить",
      message: "Написать сообщение по этому запросу",
      tracking: "номер отправки",
      chinaTracking: "номер отправки по Китаю",
      trackingComment: "служба, упаковка, детали",
    },
    paymentStatus: {
      paid: "оплачено EVLine",
      partial: "частично оплачено EVLine",
      receipt: "скрин оплаты прикреплён",
      pending: "ожидает оплаты EVLine",
      overpaid: "Оплачено больше счёта на +{amount} {currency}.",
      underpaid: "Оплачено меньше счёта на {amount} {currency}.",
    },
    dashboard: {
      needAnswer: "Нужно ответить",
      waitingPayment: "Ждёт оплату",
      needTrack: "Нужен трек",
      paid30: "Оплачено за 30 дней",
      work: "Работа",
      money: "Деньги",
      activeCount: "{count} активных",
      emptyWorkTitle: "Пока нет активных запросов",
      emptyWorkText: "Новые запросы EVLine появятся здесь.",
      paidOrders: "{count} оплаченных заказов",
      paidTotal: "Оплачено всего",
      waitingPaymentAmount: "Ждёт оплаты",
      ordersCount: "{count} заказов",
      noPaymentsTitle: "Оплат пока нет",
      noPaymentsText: "Когда EVLine оплатит заказ, он появится здесь.",
      sectionLabel: "Раздел кабинета",
      panelLabel: "Карточка запроса",
      receiptPresent: "скрин есть",
      requestEvline: "Запрос EVLine",
      track: "Трек",
    },
    empty: {
      supplierCabinet: "Кабинет поставщика",
      openSupplierLink: "Откройте ссылку на запрос, которую отправил менеджер EVLine.",
      openFailed: "Не удалось открыть ссылку",
    },
    validation: {
      fileReadFailed: "Не удалось прочитать файл.",
      imageOpenFailed: "Не удалось открыть изображение.",
      imageTooLargeCompress: "Файл слишком большой. Выберите изображение поменьше.",
      fileType: "Можно прикрепить PNG, JPG, WEBP или PDF.",
      pdfTooLarge: "PDF слишком большой. Максимум 5 МБ.",
      imageTooLarge: "Изображение слишком большое. Максимум 16 МБ.",
      quoteRequiredWithDelivery: "Укажите цену, доставку или комментарий.",
      quoteRequired: "Укажите цену или комментарий.",
      messageRequiredWithDelivery: "Напишите сообщение или укажите доставку.",
      messageRequired: "Напишите сообщение.",
      noSupplyConfirm: "Отметить, что по этой позиции нет поставки?",
    },
  },
  en: {
    page: {
      requestTitle: "EVLine · Request",
      dashboardTitle: "EVLine · Supplier dashboard",
      requestFallback: "Part request",
      supplierFallback: "Supplier",
      dashboardRequestsTitle: "EVLine · Supplier requests",
    },
    status: {
      draft: "Draft",
      sent: "New request",
      viewed: "Viewed",
      quoted: "Offer sent",
      needs_info: "Needs clarification",
      no_stock: "No supply",
      accepted: "Approved by EVLine",
      purchased: "Paid",
      china_tracking: "Shipped in China",
      china_warehouse: "At China warehouse",
      problem: "Issue",
      closed: "Closed",
      canceled: "Canceled",
    },
    paymentLabel: {
      paid: "Paid",
      partial: "Partially paid",
      requested: "Waiting for payment",
      needs_review: "Receipt under review",
      canceled: "Canceled",
      fallback: "Payment",
    },
    errors: {
      "price_cny is required": "Enter the price.",
      "Supplier quote is required before payment": "Please send a price first.",
      "Client approval is required before payment": "EVLine must approve the client agreement before payment.",
      "Payment receipt is required before supplier tracking": "Tracking can be added only after payment is confirmed.",
      "Logistics status is available only after manager accepts a quote": "Tracking is available only after EVLine selects the offer.",
      "Supplier request is closed": "This request is already closed.",
      "Supplier request not found": "Request not found or the link has expired.",
      "Unsupported supplier status": "This status is not available now.",
      "Supplier event limit reached": "The update limit for this request has been reached.",
      "Tracking number is required": "Enter the tracking number.",
      "Clarification text is required": "Write what needs clarification.",
      "Message text is required": "Write a message.",
      "Supplier message is available only after quote": "Messages are available after the first offer.",
      "Delivery cost is not available for this supplier request": "Delivery cost is not available now.",
      "D1 migration 0015_supplier_delivery_cost.sql is required": "The delivery migration has not been applied on the server yet.",
      "CRM already has another tracking number": "CRM already has another tracking number. Contact EVLine.",
      "Supplier request does not belong to this order": "The supplier request does not belong to this order.",
      "Supplier quote does not belong to this order": "The supplier offer does not belong to this order.",
      "Supplier quote does not belong to this supplier request": "The offer does not belong to this request.",
      fallback: "Request error",
    },
    ui: {
      send: "Send",
      sending: "Sending...",
      attachFile: "Attach file",
      noSupply: "No supply",
      noSupplyTitle: "Mark that this item cannot be supplied",
      self: "Me",
      evline: "EVLine",
      logistics: "Logistics",
      requestData: "Request details",
      dialog: "Order dialog",
      quoteAnswer: "Reply to request",
      payment: "Payment",
      account: "Invoice",
      paid: "Paid",
      date: "Date",
      receipts: "Receipts",
      receiptOpen: "view receipt",
      paymentConfirmed: "Payment confirmed",
      receiptAttached: "Payment receipt attached",
      paymentMarkedNoReceipt: "Payment is marked, receipt is not attached yet.",
      paymentReceiptPending: "Payment confirmation will appear here after payment.",
      price: "Price, CNY",
      delivery: "Delivery, CNY",
      deliveryShort: "Delivery",
      days: "Lead time, days",
      commentClarify: "Comment / clarification",
      chinaShipping: "Shipping in China",
      nextTrack: "Next step: enter tracking",
      trackAfterPayment: "Tracking after payment",
      trackingNumber: "Tracking number",
      save: "Save",
      comment: "Comment",
      request: "Request",
      detail: "Part",
      back: "Back",
      file: "File",
      language: "Language",
    },
    data: {
      vin: "VIN",
      car: "Car",
      year: "Year",
      detail: "Part",
      quantity: "Quantity",
      description: "Description",
      photoAlt: "Part photo",
      noCar: "Car not specified",
    },
    meta: {
      clarification: "Clarification",
      quote: "Offer",
      message: "Message",
      needsInfo: "Needs clarification",
      reply: "Reply",
      noSupply: "No supply",
      problem: "Issue",
      chinaTracking: "Shipped in China",
      chinaWarehouse: "At China warehouse",
      tracking: "Tracking: {value}",
      purchaseDays: "Lead time: {days} days",
    },
    placeholder: {
      price: "for example 1200",
      delivery: "0",
      quoteComment: "price, details, terms or what needs clarification",
      message: "Write a message about this request",
      tracking: "tracking number",
      chinaTracking: "domestic China tracking number",
      trackingComment: "carrier, packaging, details",
    },
    paymentStatus: {
      paid: "paid by EVLine",
      partial: "partially paid by EVLine",
      receipt: "payment receipt attached",
      pending: "waiting for EVLine payment",
      overpaid: "Paid above invoice by +{amount} {currency}.",
      underpaid: "Paid below invoice by {amount} {currency}.",
    },
    dashboard: {
      needAnswer: "Need reply",
      waitingPayment: "Waiting payment",
      needTrack: "Need tracking",
      paid30: "Paid in 30 days",
      work: "Work",
      money: "Money",
      activeCount: "{count} active",
      emptyWorkTitle: "No active requests yet",
      emptyWorkText: "New EVLine requests will appear here.",
      paidOrders: "{count} paid orders",
      paidTotal: "Paid total",
      waitingPaymentAmount: "Waiting payment",
      ordersCount: "{count} orders",
      noPaymentsTitle: "No payments yet",
      noPaymentsText: "When EVLine pays an order, it will appear here.",
      sectionLabel: "Dashboard section",
      panelLabel: "Request card",
      receiptPresent: "receipt attached",
      requestEvline: "EVLine request",
      track: "Tracking",
    },
    empty: {
      supplierCabinet: "Supplier dashboard",
      openSupplierLink: "Open the request link sent by the EVLine manager.",
      openFailed: "Could not open the link",
    },
    validation: {
      fileReadFailed: "Could not read the file.",
      imageOpenFailed: "Could not open the image.",
      imageTooLargeCompress: "The file is too large. Choose a smaller image.",
      fileType: "You can attach PNG, JPG, WEBP or PDF.",
      pdfTooLarge: "The PDF is too large. Maximum 5 MB.",
      imageTooLarge: "The image is too large. Maximum 16 MB.",
      quoteRequiredWithDelivery: "Enter price, delivery cost or comment.",
      quoteRequired: "Enter price or comment.",
      messageRequiredWithDelivery: "Write a message or enter delivery cost.",
      messageRequired: "Write a message.",
      noSupplyConfirm: "Mark that this item cannot be supplied?",
    },
  },
  zh: {
    page: {
      requestTitle: "EVLine · 询价",
      dashboardTitle: "EVLine · 供应商后台",
      requestFallback: "配件询价",
      supplierFallback: "供应商",
      dashboardRequestsTitle: "EVLine · 供应商询价",
    },
    status: {
      draft: "草稿",
      sent: "新询价",
      viewed: "已查看",
      quoted: "已报价",
      needs_info: "需要补充信息",
      no_stock: "无法供货",
      accepted: "EVLine 已确认",
      purchased: "已付款",
      china_tracking: "中国境内已发货",
      china_warehouse: "已到中国仓库",
      problem: "问题",
      closed: "已关闭",
      canceled: "已取消",
    },
    paymentLabel: {
      paid: "已付款",
      partial: "部分付款",
      requested: "等待付款",
      needs_review: "付款截图待确认",
      canceled: "已取消",
      fallback: "付款",
    },
    errors: {
      "price_cny is required": "请填写价格。",
      "Supplier quote is required before payment": "请先发送报价。",
      "Client approval is required before payment": "付款前需要 EVLine 确认客户已同意。",
      "Payment receipt is required before supplier tracking": "确认付款后才能填写运单号。",
      "Logistics status is available only after manager accepts a quote": "EVLine 选择报价后才能填写运单号。",
      "Supplier request is closed": "此询价已关闭。",
      "Supplier request not found": "未找到询价，或链接已失效。",
      "Unsupported supplier status": "当前不能使用此状态。",
      "Supplier event limit reached": "此询价的更新次数已达上限。",
      "Tracking number is required": "请填写运单号。",
      "Clarification text is required": "请填写需要补充的信息。",
      "Message text is required": "请填写消息内容。",
      "Supplier message is available only after quote": "首次报价后才能发送消息。",
      "Delivery cost is not available for this supplier request": "当前不能填写运费。",
      "D1 migration 0015_supplier_delivery_cost.sql is required": "服务器尚未应用运费迁移。",
      "CRM already has another tracking number": "CRM 中已有其他运单号，请联系 EVLine。",
      "Supplier request does not belong to this order": "此供应商询价不属于该订单。",
      "Supplier quote does not belong to this order": "此报价不属于该订单。",
      "Supplier quote does not belong to this supplier request": "此报价不属于该询价。",
      fallback: "请求错误",
    },
    ui: {
      send: "发送",
      sending: "发送中...",
      attachFile: "添加附件",
      noSupply: "无法供货",
      noSupplyTitle: "标记此配件无法供货",
      self: "我",
      evline: "EVLine",
      logistics: "物流",
      requestData: "询价信息",
      dialog: "订单沟通",
      quoteAnswer: "回复询价",
      payment: "付款",
      account: "账单",
      paid: "已付",
      date: "日期",
      receipts: "截图",
      receiptOpen: "查看截图",
      paymentConfirmed: "付款已确认",
      receiptAttached: "付款截图已上传",
      paymentMarkedNoReceipt: "已标记付款，截图暂未上传。",
      paymentReceiptPending: "付款后这里会显示确认信息。",
      price: "价格，CNY",
      delivery: "运费，CNY",
      deliveryShort: "运费",
      days: "备货周期，天",
      commentClarify: "备注 / 需要补充的信息",
      chinaShipping: "中国境内发货",
      nextTrack: "下一步：填写运单号",
      trackAfterPayment: "付款后填写运单号",
      trackingNumber: "运单号",
      save: "保存",
      comment: "备注",
      request: "询价",
      detail: "配件",
      back: "返回",
      file: "文件",
      language: "语言",
    },
    data: {
      vin: "VIN",
      car: "车型",
      year: "年份",
      detail: "配件",
      quantity: "数量",
      description: "说明",
      photoAlt: "配件照片",
      noCar: "未填写车型",
    },
    meta: {
      clarification: "补充信息",
      quote: "报价",
      message: "消息",
      needsInfo: "需要补充信息",
      reply: "回复",
      noSupply: "无法供货",
      problem: "问题",
      chinaTracking: "中国境内已发货",
      chinaWarehouse: "已到中国仓库",
      tracking: "运单号：{value}",
      purchaseDays: "备货周期：{days} 天",
    },
    placeholder: {
      price: "例如 1200",
      delivery: "0",
      quoteComment: "价格、细节、条件，或需要补充的信息",
      message: "输入此询价的消息",
      tracking: "运单号",
      chinaTracking: "中国境内运单号",
      trackingComment: "快递、包装、细节",
    },
    paymentStatus: {
      paid: "EVLine 已付款",
      partial: "EVLine 已部分付款",
      receipt: "付款截图已上传",
      pending: "等待 EVLine 付款",
      overpaid: "付款比账单多 +{amount} {currency}。",
      underpaid: "付款比账单少 {amount} {currency}。",
    },
    dashboard: {
      needAnswer: "待回复",
      waitingPayment: "待付款",
      needTrack: "待填运单号",
      paid30: "30 天已付款",
      work: "工作",
      money: "资金",
      activeCount: "{count} 个进行中",
      emptyWorkTitle: "暂无进行中的询价",
      emptyWorkText: "EVLine 的新询价会显示在这里。",
      paidOrders: "{count} 个已付款订单",
      paidTotal: "累计已付款",
      waitingPaymentAmount: "待付款",
      ordersCount: "{count} 个订单",
      noPaymentsTitle: "暂无付款",
      noPaymentsText: "EVLine 付款后，订单会显示在这里。",
      sectionLabel: "后台分区",
      panelLabel: "询价卡片",
      receiptPresent: "有截图",
      requestEvline: "EVLine 询价",
      track: "运单号",
    },
    empty: {
      supplierCabinet: "供应商后台",
      openSupplierLink: "请打开 EVLine 经理发送的询价链接。",
      openFailed: "无法打开链接",
    },
    validation: {
      fileReadFailed: "无法读取文件。",
      imageOpenFailed: "无法打开图片。",
      imageTooLargeCompress: "文件太大，请选择较小的图片。",
      fileType: "可以上传 PNG、JPG、WEBP 或 PDF。",
      pdfTooLarge: "PDF 文件太大，最大 5 MB。",
      imageTooLarge: "图片太大，最大 16 MB。",
      quoteRequiredWithDelivery: "请填写价格、运费或备注。",
      quoteRequired: "请填写价格或备注。",
      messageRequiredWithDelivery: "请填写消息或运费。",
      messageRequired: "请填写消息。",
      noSupplyConfirm: "确认标记此配件无法供货吗？",
    },
  },
};

function normalizeLanguage(value) {
  const lang = String(value || "").toLowerCase().slice(0, 2);
  return supplierLanguages[lang] ? lang : "";
}

let supplierLang = normalizeLanguage(query.get("lang"))
  || normalizeLanguage(localStorage.getItem(SUPPLIER_LANG_KEY))
  || "zh";

function supplierLocale() {
  return supplierLanguages[supplierLang]?.locale || supplierLanguages.zh.locale;
}

function t(key, replacements = {}) {
  const read = (lang) => key.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), supplierI18n[lang]);
  let value = read(supplierLang);
  if (value === undefined) value = read("ru");
  if (value === undefined) value = key;
  return String(value).replace(/\{(\w+)\}/g, (_, name) => replacements[name] ?? "");
}

function languageSwitcher() {
  return `
    <div class="supplier-language" role="group" aria-label="${escapeHtml(t("ui.language"))}">
      ${Object.entries(supplierLanguages).map(([lang, item]) => `
        <button type="button" class="${supplierLang === lang ? "is-active" : ""}" data-supplier-lang="${lang}" aria-pressed="${supplierLang === lang ? "true" : "false"}">
          ${escapeHtml(item.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function syncLanguageMeta(titleKey) {
  document.documentElement.lang = supplierLanguages[supplierLang]?.html || "zh-CN";
  document.title = t(titleKey || (page === "dashboard" ? "page.dashboardTitle" : "page.requestTitle"));
}

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
  return new Date(value).toLocaleString(supplierLocale(), {
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
    <button class="supplier-button supplier-button--primary supplier-button--send ${escapeHtml(extraClass)}" type="submit" aria-label="${escapeHtml(t("ui.send"))}" title="${escapeHtml(t("ui.send"))}">
      ${sendIcon()}
      <span>${escapeHtml(t("ui.send"))}</span>
    </button>
  `;
}

function paperclipIcon() {
  return `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
    </svg>
  `;
}

function supplierFileButton() {
  return `
    <label class="supplier-file-button" aria-label="${escapeHtml(t("ui.attachFile"))}" title="${escapeHtml(t("ui.attachFile"))}">
      <input name="attachment" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" data-supplier-chat-file>
      ${paperclipIcon()}
      <span data-supplier-file-name></span>
    </label>
  `;
}

function noSupplyButton(extraClass = "") {
  return `<button class="supplier-button supplier-button--quiet-danger supplier-button--no-supply ${escapeHtml(extraClass)}" type="button" data-action="no_stock" aria-label="${escapeHtml(t("ui.noSupplyTitle"))}" title="${escapeHtml(t("ui.noSupply"))}">${escapeHtml(t("ui.noSupply"))}</button>`;
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
  return supplierI18n[supplierLang]?.errors?.[value] || supplierI18n.ru.errors[value] || value || t("errors.fallback");
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

const CHAT_ATTACHMENT_MAX_DATA_URL = 7_000_000;
const CHAT_ATTACHMENT_MAX_PDF_BYTES = 5 * 1024 * 1024;
const CHAT_ATTACHMENT_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const CHAT_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(t("validation.fileReadFailed")));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("validation.imageOpenFailed")));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

function normalizedAttachmentMime(file) {
  return String(file?.type || "").toLowerCase().replace("image/jpg", "image/jpeg");
}

function chatAttachmentName(file, mime) {
  const fallback = mime === "application/pdf" ? "document.pdf" : "attachment.jpg";
  return plainText(file?.name).slice(0, 120) || fallback;
}

async function compressChatImage(file) {
  const source = await readFileDataUrl(file);
  if (source.length <= CHAT_ATTACHMENT_MAX_DATA_URL) return source;
  const image = await loadImage(source);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
    const blob = await canvasToBlob(canvas, quality);
    if (!blob) continue;
    const dataUrl = await readFileDataUrl(blob);
    if (dataUrl.length <= CHAT_ATTACHMENT_MAX_DATA_URL) return dataUrl;
  }
  throw new Error(t("validation.imageTooLargeCompress"));
}

async function prepareChatAttachment(input) {
  const file = input?.files?.[0];
  if (!file) return null;
  const mime = normalizedAttachmentMime(file);
  if (!CHAT_ATTACHMENT_TYPES.has(mime)) {
    throw new Error(t("validation.fileType"));
  }
  if (mime === "application/pdf") {
    if (file.size > CHAT_ATTACHMENT_MAX_PDF_BYTES) {
      throw new Error(t("validation.pdfTooLarge"));
    }
    return {
      attachment_name: chatAttachmentName(file, mime),
      attachment_mime: mime,
      attachment_data_url: await readFileDataUrl(file),
    };
  }
  if (file.size > CHAT_ATTACHMENT_MAX_IMAGE_BYTES) {
    throw new Error(t("validation.imageTooLarge"));
  }
  return {
    attachment_name: chatAttachmentName(file, mime),
    attachment_mime: "image/jpeg",
    attachment_data_url: await compressChatImage(file),
  };
}

async function appendChatAttachmentPayload(form, payload) {
  delete payload.attachment;
  const attachment = await prepareChatAttachment(form?.querySelector("[data-supplier-chat-file]"));
  if (!attachment) return false;
  Object.assign(payload, attachment);
  return true;
}

function statusBadge(status) {
  const safe = String(status || "sent").replace(/[^a-z0-9_-]/gi, "");
  return `<span class="supplier-status supplier-status--${safe}">${escapeHtml(t(`status.${status || "sent"}`) || status || t("status.sent"))}</span>`;
}

function requestImages(images = []) {
  if (!images.length) return "";
  return `
    <div class="supplier-images">
      ${images.map((image) => `
        <a href="${escapeHtml(image.image_url)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(image.image_url)}" alt="${escapeHtml(t("data.photoAlt"))}" loading="lazy">
        </a>
      `).join("")}
    </div>
  `;
}

function chatAttachmentLabel(attachment = {}) {
  return plainText(attachment.name) || (attachment.kind === "pdf" ? "document.pdf" : t("ui.file"));
}

function chatAttachments(attachments = []) {
  const visible = attachments.filter((attachment) => plainText(attachment.url));
  if (!visible.length) return "";
  return `
    <div class="supplier-chat__attachments">
      ${visible.map((attachment) => {
        const label = chatAttachmentLabel(attachment);
        if (attachment.kind === "image" || String(attachment.mime || "").startsWith("image/")) {
          return `
            <a class="supplier-chat__attachment supplier-chat__attachment--image" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener" title="${escapeHtml(label)}">
              <img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(label)}" loading="lazy">
            </a>
          `;
        }
        return `
          <a class="supplier-chat__attachment supplier-chat__attachment--file" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener">
            ${paperclipIcon()}
            <span>${escapeHtml(label)}</span>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

function requestData(request = {}) {
  const description = localizedRequestText(request);
  return `
    <div class="supplier-data supplier-data--request">
      <div><span>${escapeHtml(t("data.vin"))}</span><strong>${escapeHtml(request.vin || "-")}</strong></div>
      <div><span>${escapeHtml(t("data.car"))}</span><strong>${escapeHtml(request.car || "-")}</strong></div>
      <div><span>${escapeHtml(t("data.year"))}</span><strong>${escapeHtml(request.car_year || "-")}</strong></div>
      <div><span>${escapeHtml(t("data.detail"))}</span><strong>${escapeHtml(request.item_name || "-")}</strong></div>
      <div><span>${escapeHtml(t("data.quantity"))}</span><strong>${Number(request.quantity || 1).toLocaleString(supplierLocale())}</strong></div>
      <div class="supplier-data--wide"><span>${escapeHtml(t("data.description"))}</span><strong>${escapeHtml(description || "-")}</strong></div>
    </div>
  `;
}

function localizedRequestText(request = {}) {
  if (supplierLang === "zh") {
    return plainText(request.request_text_cn || request.manager_comment_cn || request.request_text || request.request_text_ru);
  }
  if (supplierLang === "en") {
    return plainText(request.request_text_en || request.request_text_cn || request.request_text_ru || request.request_text);
  }
  return plainText(request.request_text_ru || request.request_text || request.request_text_cn);
}

function localizedSupplierNote(request = {}) {
  if (supplierLang === "zh") return plainText(request.supplier_note_cn || request.supplier_note || request.supplier_note_ru);
  if (supplierLang === "en") return plainText(request.supplier_note_en || request.supplier_note_cn || request.supplier_note_ru || request.supplier_note);
  return plainText(request.supplier_note_ru || request.supplier_note || request.supplier_note_cn);
}

function paymentStatusText(payment = {}) {
  if (payment.status === "paid") return t("paymentStatus.paid");
  if (payment.status === "partial") return t("paymentStatus.partial");
  if (payment.receipt_present) return t("paymentStatus.receipt");
  return t("paymentStatus.pending");
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
  const receiptAttached = Boolean(payment.receipt_url || payment.receipt_present);
  const receiptVersion = encodeURIComponent(payment.updated_at || payment.paid_at || "");
  const receiptUrl = `/api/supplier/request/${encodeURIComponent(tokenValue)}/payment-receipt${receiptVersion ? `?v=${receiptVersion}` : ""}`;
  const delta = paymentDelta(payment);
  const receiptCount = Number(payment.receipt_count || 0);
  return `
    <section class="supplier-card supplier-payment supplier-payment--compact">
      <div class="supplier-card__head">
        <h2>${escapeHtml(t("ui.payment"))}</h2>
        <span class="supplier-muted">${escapeHtml(paymentStatusText(payment))}</span>
      </div>
      <div class="supplier-data">
        <div><span>${escapeHtml(t("ui.account"))}</span><strong>${Number(payment.requested_amount || 0).toLocaleString(supplierLocale())} ${escapeHtml(payment.requested_currency || "CNY")}</strong></div>
        ${payment.paid_amount ? `<div><span>${escapeHtml(t("ui.paid"))}</span><strong>${Number(payment.paid_amount || 0).toLocaleString(supplierLocale())} ${escapeHtml(payment.paid_currency || payment.requested_currency || "CNY")}</strong></div>` : ""}
        ${payment.paid_at ? `<div><span>${escapeHtml(t("ui.date"))}</span><strong>${escapeHtml(shortDateTime(payment.paid_at))}</strong></div>` : ""}
        ${receiptCount > 1 ? `<div><span>${escapeHtml(t("ui.receipts"))}</span><strong>${receiptCount.toLocaleString(supplierLocale())}</strong></div>` : ""}
      </div>
      ${delta.amount ? `
        <p class="supplier-payment-note ${delta.significant ? "supplier-payment-note--warning" : ""}">
          ${delta.amount > 0
            ? t("paymentStatus.overpaid", { amount: Number(delta.amount).toLocaleString(supplierLocale()), currency: escapeHtml(delta.currency) })
            : t("paymentStatus.underpaid", { amount: Number(Math.abs(delta.amount)).toLocaleString(supplierLocale()), currency: escapeHtml(delta.currency) })}
        </p>
      ` : ""}
      ${receiptAttached ? `
        <div class="supplier-receipt">
          <strong>${escapeHtml(paid ? t("ui.paymentConfirmed") : t("ui.receiptAttached"))}</strong>
          <a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener">${escapeHtml(t("ui.receiptOpen"))}</a>
        </div>
      ` : `<p class="supplier-muted">${escapeHtml(paid ? t("ui.paymentMarkedNoReceipt") : t("ui.paymentReceiptPending"))}</p>`}
    </section>
  `;
}

function quoteChatText(quote = {}) {
  return [
    quote.price_cny ? `${Number(quote.price_cny || 0).toLocaleString(supplierLocale())} CNY` : "",
    quote.purchase_days ? t("meta.purchaseDays", { days: Number(quote.purchase_days).toLocaleString(supplierLocale()) }) : "",
    localizedQuoteComment(quote),
  ].filter(Boolean).join("\n");
}

function localizedQuoteComment(quote = {}) {
  if (supplierLang === "zh") return plainText(quote.comment_cn || quote.comment_translated || quote.comment_ru);
  if (supplierLang === "en") return plainText(quote.comment_en || quote.comment_translated || quote.comment_cn || quote.comment_ru);
  return plainText(quote.comment_ru || quote.comment_translated || quote.comment_cn);
}

function localizedEventComment(event = {}) {
  if (supplierLang === "zh") return plainText(event.comment_cn || event.comment_translated);
  if (supplierLang === "en") return plainText(event.comment_en || event.comment_translated || event.comment_cn);
  return plainText(event.comment_translated || event.comment_cn);
}

function isDuplicateQuoteEvent(event = {}, quotes = []) {
  const eventComment = localizedEventComment(event);
  return quotes.some((quote) => {
    const quoteComment = localizedQuoteComment(quote);
    const commentsMatch = eventComment === quoteComment;
    const timeGap = Math.abs(dateMs(event.created_at) - dateMs(quote.created_at));
    return commentsMatch && timeGap <= 2000;
  });
}

function supplierSelfTitle() {
  return t("ui.self");
}

function supplierChatMessages(data = {}) {
  const request = data.request || {};
  const events = data.tracking_events || [];
  const quotes = data.quotes || [];
  const messages = [];

  const supplierNote = localizedSupplierNote(request);
  const hasNoteEvent = events.some((event) => event.status === "sent" && plainText(event.comment_cn) === supplierNote);
  if (supplierNote && !hasNoteEvent) {
    messages.push({
      actor: "evline",
      title: t("ui.evline"),
      meta: t("meta.clarification"),
      text: supplierNote,
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
      meta: t("meta.quote"),
      text: textValue,
      created_at: quote.created_at,
      order: 2,
    });
  }

  for (const event of events) {
    const status = plainText(event.status);
    const comment = localizedEventComment(event);
    const attachments = event.attachments || [];
    const hasAttachments = attachments.length > 0;
    if (status === "quoted") {
      if ((comment || hasAttachments) && (!comment || !isDuplicateQuoteEvent(event, quotes) || hasAttachments)) {
        messages.push({
          actor: "supplier",
          title: supplierSelfTitle(),
          meta: t("meta.message"),
          text: comment,
          attachments,
          created_at: event.created_at,
          order: 3,
        });
      }
      continue;
    }
    if (status === "needs_info" && (comment || hasAttachments)) {
      messages.push({
        actor: "supplier",
        title: supplierSelfTitle(),
        meta: t("meta.needsInfo"),
        text: comment,
        attachments,
        created_at: event.created_at,
        order: 3,
      });
    } else if (status === "sent" && (comment || hasAttachments)) {
      messages.push({
        actor: "evline",
        title: t("ui.evline"),
        meta: t("meta.reply"),
        text: comment,
        attachments,
        created_at: event.created_at,
        order: 4,
      });
    } else if (status === "no_stock") {
      messages.push({
        actor: "supplier",
        title: supplierSelfTitle(),
        meta: t("meta.noSupply"),
        text: comment || t("ui.noSupplyTitle"),
        attachments,
        created_at: event.created_at,
        order: 5,
      });
    } else if (status === "problem" && (comment || hasAttachments)) {
      messages.push({
        actor: "supplier",
        title: supplierSelfTitle(),
        meta: t("meta.problem"),
        text: comment,
        attachments,
        created_at: event.created_at,
        order: 6,
      });
    } else if (["china_tracking", "china_warehouse"].includes(status) && (comment || plainText(event.tracking_number) || hasAttachments)) {
      messages.push({
        actor: "system",
        title: t("ui.logistics"),
        meta: status === "china_tracking" ? t("meta.chinaTracking") : t("meta.chinaWarehouse"),
        text: [plainText(event.tracking_number) ? t("meta.tracking", { value: plainText(event.tracking_number) }) : "", comment].filter(Boolean).join("\n"),
        attachments,
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
    <h2>${escapeHtml(t("ui.dialog"))}</h2>
    <div class="supplier-chat">
      ${messages.map((message) => `
        <article class="supplier-chat__message supplier-chat__message--${escapeHtml(message.actor)}">
          <div class="supplier-chat__bubble">
            <div class="supplier-chat__meta">
              <strong>${escapeHtml(message.title)}</strong>
              <span>${escapeHtml(message.meta)} · ${escapeHtml(shortDateTime(message.created_at))}</span>
            </div>
            ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
            ${chatAttachments(message.attachments || [])}
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
      <h2>${escapeHtml(t("ui.quoteAnswer"))}</h2>
      <div class="supplier-form__grid">
        <input name="quote_type" type="hidden" value="original">
        <input name="availability" type="hidden" value="in_stock">
        <input name="quantity" type="hidden" value="${Number(request.quantity || 1)}">
        <label>
          ${escapeHtml(t("ui.price"))}
          <input name="price_cny" type="number" min="0" step="0.01" placeholder="${escapeHtml(t("placeholder.price"))}">
        </label>
        ${showDeliveryField ? `<label>
          ${escapeHtml(t("ui.delivery"))}
          <input name="delivery_cost_cny" type="number" min="0" step="0.01" placeholder="${escapeHtml(t("placeholder.delivery"))}">
        </label>` : ""}
        <label>
          ${escapeHtml(t("ui.days"))}
          <input name="purchase_days" type="number" min="0" step="1" placeholder="${escapeHtml(t("placeholder.delivery"))}">
        </label>
        <label class="supplier-wide">
          ${escapeHtml(t("ui.commentClarify"))}
          <textarea name="comment_cn" rows="3" placeholder="${escapeHtml(t("placeholder.quoteComment"))}"></textarea>
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
    <form class="supplier-message-form ${showDeliveryField ? "" : "supplier-message-form--no-delivery"}" data-message-form aria-label="${escapeHtml(t("meta.message"))}">
      <textarea name="comment_cn" rows="2" placeholder="${escapeHtml(t("placeholder.message"))}"></textarea>
      ${showDeliveryField ? `<label class="supplier-message-form__delivery">
        ${escapeHtml(t("ui.delivery"))}
        <input name="delivery_cost_cny" type="number" min="0" step="0.01" placeholder="${escapeHtml(t("placeholder.delivery"))}">
      </label>` : ""}
      <div class="supplier-message-form__actions">
        ${supplierFileButton()}
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
        <span>${escapeHtml(t("ui.chinaShipping"))}</span>
        <strong>${escapeHtml(trackingEvent.status === "china_warehouse" ? t("meta.chinaWarehouse") : t("meta.chinaTracking"))}</strong>
        <b>${escapeHtml(trackingEvent.tracking_number)}</b>
      </div>
    `;
  }
  return `
    <form class="supplier-passport-tracking ${active ? "supplier-passport-tracking--active" : "supplier-passport-tracking--disabled"}" data-tracking-form>
      <input name="status" type="hidden" value="china_tracking">
      <label>
        <span>${escapeHtml(t("ui.chinaShipping"))}</span>
        <strong>${escapeHtml(active ? t("ui.nextTrack") : t("ui.trackAfterPayment"))}</strong>
        <input name="tracking_number" placeholder="${escapeHtml(t("placeholder.tracking"))}" ${active ? "required" : "disabled"}>
      </label>
      <button class="supplier-button supplier-button--primary supplier-button--small" type="submit" ${active ? "" : "disabled"}>${escapeHtml(t("ui.save"))}</button>
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
      <form class="supplier-form supplier-tracking-form supplier-tracking-form--compact" data-tracking-form>
        <div class="supplier-form__inline-head">
          <h2>${escapeHtml(t("ui.chinaShipping"))}</h2>
          <button class="supplier-button supplier-button--primary supplier-button--small" type="submit">${escapeHtml(t("ui.save"))}</button>
        </div>
        <div class="supplier-tracking-form__grid">
          <input name="status" type="hidden" value="china_tracking">
          <label>
            ${escapeHtml(t("ui.trackingNumber"))}
            <input name="tracking_number" placeholder="${escapeHtml(t("placeholder.chinaTracking"))}" required>
          </label>
          <label>
            ${escapeHtml(t("ui.comment"))}
            <textarea name="comment_cn" rows="1" placeholder="${escapeHtml(t("placeholder.trackingComment"))}"></textarea>
          </label>
        </div>
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
          <h2>${escapeHtml(t("ui.requestData"))}</h2>
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
  requestDataCache = data;
  syncLanguageMeta("page.requestTitle");
  const request = data.request || {};
  root.innerHTML = `
    <header class="supplier-topbar supplier-topbar--request">
      <div class="supplier-brand">
        <strong>${escapeHtml(t("page.requestTitle"))}</strong>
        <span>${escapeHtml(request.public_number || "")}</span>
      </div>
      <div class="supplier-topbar__aside">
        ${languageSwitcher()}
        <span class="supplier-kicker">${escapeHtml(request.supplier_name || t("page.supplierFallback"))}</span>
        ${statusBadge(request.status)}
      </div>
    </header>

    <section class="supplier-hero supplier-hero--compact">
      <h1>${escapeHtml(request.item_name || t("page.requestFallback"))}</h1>
    </section>

    ${renderRequestDetail(data, token)}
  `;
}

function supplierAmount(value, currency = "CNY") {
  return `${Number(value || 0).toLocaleString(supplierLocale())} ${escapeHtml(currency || "CNY")}`;
}

function paymentLabel(status) {
  const key = `paymentLabel.${status || "fallback"}`;
  const value = t(key);
  return value === key ? (status || t("paymentLabel.fallback")) : value;
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
      ${dashboardSummaryCard(t("dashboard.needAnswer"), Number(summary.need_answer || 0).toLocaleString(supplierLocale()))}
      ${dashboardSummaryCard(t("dashboard.waitingPayment"), Number(summary.waiting_payment || 0).toLocaleString(supplierLocale()))}
      ${dashboardSummaryCard(t("dashboard.needTrack"), Number(summary.paid_needs_tracking || 0).toLocaleString(supplierLocale()))}
      ${dashboardSummaryCard(t("dashboard.paid30"), supplierAmount(summary.paid_30_amount, summary.currency), t("dashboard.ordersCount", { count: Number(summary.paid_30_count || 0).toLocaleString(supplierLocale()) }))}
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
        <span>${escapeHtml(t("dashboard.track"))}</span>
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
        <span>${escapeHtml(t("dashboard.needTrack"))}</span>
        <input name="tracking_number" placeholder="${escapeHtml(t("placeholder.tracking"))}" required>
      </label>
      <button class="supplier-button supplier-button--primary supplier-button--small" type="submit">${escapeHtml(t("ui.save"))}</button>
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
          <strong>${escapeHtml(request.public_number || t("ui.request"))}</strong>
          ${statusBadge(request.status)}
        </div>
        <div class="supplier-dashboard-card__title">${escapeHtml(request.item_name || t("ui.detail"))}</div>
        <div class="supplier-dashboard-card__meta">
          <span>${escapeHtml(request.car || t("data.noCar"))}${request.car_year ? ` · ${escapeHtml(request.car_year)}` : ""}</span>
          ${payment ? `<span>${escapeHtml(paymentLabel(payment.status))}${payment.requested_amount ? ` · ${supplierAmount(payment.paid_amount || payment.requested_amount, payment.paid_currency || payment.requested_currency)}` : ""}</span>` : ""}
          ${request.delivery_cost_cny !== null && request.delivery_cost_cny !== undefined ? `<span>${escapeHtml(t("ui.deliveryShort"))}: ${supplierAmount(request.delivery_cost_cny, "CNY")}</span>` : ""}
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
        <h2>${escapeHtml(t("dashboard.work"))}</h2>
        <span class="supplier-muted">${escapeHtml(t("dashboard.activeCount", { count: Number(requests.length || 0).toLocaleString(supplierLocale()) }))}</span>
      </div>
      <div class="supplier-dashboard">
        ${sorted.length ? sorted.map(renderDashboardRequestCard).join("") : `<div class="supplier-empty"><strong>${escapeHtml(t("dashboard.emptyWorkTitle"))}</strong><span class="supplier-muted">${escapeHtml(t("dashboard.emptyWorkText"))}</span></div>`}
      </div>
    </section>
  `;
}

function renderDashboardPaymentCard(payment = {}) {
  return `
    <a class="supplier-dashboard-payment" href="${escapeHtml(payment.supplier_link || "#")}">
      <div>
        <strong>${escapeHtml(payment.request_public_number || payment.payment_number || t("ui.payment"))}</strong>
        <span>${escapeHtml(payment.item_name || t("dashboard.requestEvline"))}</span>
      </div>
      <div>
        <b>${supplierAmount(payment.amount, payment.currency)}</b>
        <span>${escapeHtml(paymentLabel(payment.status))}${payment.receipt_present ? ` · ${escapeHtml(t("dashboard.receiptPresent"))}` : ""}</span>
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
        <h2>${escapeHtml(t("dashboard.money"))}</h2>
        <span class="supplier-muted">${escapeHtml(t("dashboard.paidOrders", { count: Number(summary.paid_total_count || 0).toLocaleString(supplierLocale()) }))}</span>
      </div>
      <div class="supplier-money-summary">
        ${dashboardSummaryCard(t("dashboard.paidTotal"), supplierAmount(summary.paid_total_amount, summary.currency))}
        ${dashboardSummaryCard(t("dashboard.waitingPaymentAmount"), supplierAmount(summary.waiting_amount, summary.currency), t("dashboard.ordersCount", { count: Number(summary.waiting_count || 0).toLocaleString(supplierLocale()) }))}
      </div>
      <div class="supplier-dashboard-payments">
        ${payments.length ? payments.map(renderDashboardPaymentCard).join("") : `<div class="supplier-empty"><strong>${escapeHtml(t("dashboard.noPaymentsTitle"))}</strong><span class="supplier-muted">${escapeHtml(t("dashboard.noPaymentsText"))}</span></div>`}
      </div>
    </section>
  `;
}

function renderDashboardTabs() {
  return `
    <div class="supplier-dashboard-tabs" role="tablist" aria-label="${escapeHtml(t("dashboard.sectionLabel"))}">
      <button type="button" class="${dashboardTab === "work" ? "is-active" : ""}" data-dashboard-tab="work">${escapeHtml(t("dashboard.work"))}</button>
      <button type="button" class="${dashboardTab === "money" ? "is-active" : ""}" data-dashboard-tab="money">${escapeHtml(t("dashboard.money"))}</button>
    </div>
  `;
}

function renderDashboardRequestPanel() {
  const request = selectedDashboardRequest();
  if (!request) return "";
  const requestToken = requestTokenFromLink(request.supplier_link);
  return `
    <div class="supplier-request-panel-backdrop" data-dashboard-close-request></div>
    <aside class="supplier-request-panel" data-request-token="${escapeHtml(requestToken)}" aria-label="${escapeHtml(t("dashboard.panelLabel"))}">
      <div class="supplier-request-panel__head">
        <div>
          <strong>${escapeHtml(request.public_number || t("ui.request"))}</strong>
          <span>${escapeHtml(request.item_name || t("ui.detail"))}${request.car ? ` · ${escapeHtml(request.car)}` : ""}</span>
        </div>
        <button class="supplier-button supplier-button--small" type="button" data-dashboard-close-request>${escapeHtml(t("ui.back"))}</button>
      </div>
      <div class="supplier-request-panel__body">
        ${renderRequestDetail(dashboardRequestAsData(request), requestToken)}
      </div>
    </aside>
  `;
}

function renderDashboardPage(data) {
  syncLanguageMeta("page.dashboardTitle");
  dashboardData = data;
  const requests = data.requests || [];
  if (dashboardSelectedRequestId && !requests.some((request) => dashboardRequestKey(request) === dashboardSelectedRequestId)) {
    dashboardSelectedRequestId = "";
  }
  root.innerHTML = `
    <header class="supplier-topbar">
      <div class="supplier-brand">
        <strong>${escapeHtml(t("page.dashboardTitle"))}</strong>
        <span>${escapeHtml(data.supplier?.name || t("page.supplierFallback"))}</span>
      </div>
      ${languageSwitcher()}
    </header>
    <section class="supplier-hero">
      <h1>${escapeHtml(data.supplier?.name || t("page.supplierFallback"))}</h1>
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
    button.textContent = text || t("ui.sending");
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

root?.addEventListener("change", (event) => {
  const input = event.target.closest("[data-supplier-chat-file]");
  if (!input) return;
  const label = input.closest(".supplier-file-button");
  const file = input.files?.[0];
  const name = label?.querySelector("[data-supplier-file-name]");
  label?.classList.toggle("has-file", Boolean(file));
  if (label) label.title = file?.name || t("ui.attachFile");
  if (name) name.textContent = file?.name ? file.name.slice(0, 32) : "";
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
        throw new Error(form.elements.namedItem("delivery_cost_cny") ? t("validation.quoteRequiredWithDelivery") : t("validation.quoteRequired"));
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
      const hasAttachment = Boolean(form.querySelector("[data-supplier-chat-file]")?.files?.[0]);
      if (!hasComment && !hasDelivery && !hasAttachment) {
        throw new Error(form.elements.namedItem("delivery_cost_cny") ? t("validation.messageRequiredWithDelivery") : t("validation.messageRequired"));
      }
      await appendChatAttachmentPayload(form, payload);
      payload.action = hasComment || hasAttachment ? "message" : "delivery_cost";
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
  const langButton = event.target.closest("[data-supplier-lang]");
  if (langButton) {
    supplierLang = normalizeLanguage(langButton.dataset.supplierLang) || supplierLang;
    localStorage.setItem(SUPPLIER_LANG_KEY, supplierLang);
    if (page === "dashboard") {
      renderDashboardPage(dashboardData || {});
    } else if (requestDataCache) {
      renderRequestPage(requestDataCache);
    } else {
      loadRequest().catch(() => null);
    }
    return;
  }

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
  if (!confirm(t("validation.noSupplyConfirm"))) return;
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
  syncLanguageMeta(page === "dashboard" ? "page.dashboardTitle" : "page.requestTitle");
  root.innerHTML = `
    <section class="supplier-empty">
      <strong>${escapeHtml(t("empty.supplierCabinet"))}</strong>
      <span class="supplier-muted">${escapeHtml(t("empty.openSupplierLink"))}</span>
    </section>
  `;
} else {
  (page === "dashboard" ? loadDashboard() : loadRequest()).catch((error) => {
  if (!root) return;
  root.innerHTML = `
    <section class="supplier-empty">
      <strong>${escapeHtml(t("empty.openFailed"))}</strong>
      <span class="supplier-muted">${escapeHtml(error.message)}</span>
    </section>
  `;
  });
}
