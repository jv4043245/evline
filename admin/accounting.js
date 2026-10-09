const KYIV = "Europe/Kyiv";
const DAY = 86_400_000;
const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const updatedDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: KYIV });
const known = value => typeof value === "number" && Number.isFinite(value);
const dateValue = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};

// Shift calendar dates, not timestamps in Kyiv: DST must never skip or repeat a day.
export function accountingPeriod(range = "30d", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KYIV, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const field = type => parts.find(part => part.type === type).value;
  const today = Date.parse(`${field("year")}-${field("month")}-${field("day")}T00:00:00Z`);
  const days = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[range] || 30;
  const to = new Date(today - DAY).toISOString().slice(0, 10);
  return range === "all" ? { range: "all", to } : { from: new Date(today - days * DAY).toISOString().slice(0, 10), to };
}

function sourceText(source = {}) {
  if (source.last_error || source.status === "error") return "Не вдалося оновити";
  if (source.status === "missing" || !source.status) return "Немає даних";
  const present = Number(source.days_present), expected = Number(source.days_expected);
  if (source.status === "partial") return `Неповні дані${Number.isFinite(present) && Number.isFinite(expected) ? ` · ${present}/${expected} днів` : ""}`;
  const updated = source.updated_at && new Date(source.updated_at);
  return updated && Number.isFinite(updated.getTime()) ? `Оновлено ${updatedDate.format(updated)}` : "Дані повні";
}

function svgElement(document, tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderChart(root, rows) {
  const panel = root.querySelector("[data-accounting-trend]");
  const mount = root.querySelector("[data-accounting-chart]");
  mount.replaceChildren();
  panel.hidden = rows.length < 2 || !rows.some(row => known(row.google_uah) || known(row.meta_uah));
  if (panel.hidden) return;
  const document = root.ownerDocument || root;
  const width = Math.max(280, mount.clientWidth || 800);
  const svg = svgElement(document, "svg", { viewBox: `0 0 ${width} 260`, role: "img", "aria-labelledby": "accounting-chart-title accounting-chart-description" });
  svg.append(svgElement(document, "title", { id: "accounting-chart-title" }, "Витрати на рекламу та замовлення за днями"));
  svg.append(svgElement(document, "desc", { id: "accounting-chart-description" }, "Два окремі графіки зі спільними датами. Вгорі — Google синім і Meta фіолетовим у гривнях; унизу — усі замовлення CRM зеленим. Пропуски означають відсутні дані. Точні значення наведено в таблиці нижче."));
  const left = 57, right = width - 12, x = index => left + index * (right - left) / Math.max(1, rows.length - 1);
  const costMax = Math.max(1, ...rows.flatMap(row => [row.google_uah, row.meta_uah]).filter(known));
  const ordersMax = Math.max(1, ...rows.map(row => row.orders).filter(known));
  const costLabels = [["google_uah", "Google"], ["meta_uah", "Meta"]].filter(([key]) => rows.some(row => known(row[key]))).map(([, label]) => label).join(" · ");
  for (const [top, bottom, max, label] of [[24, 132, costMax, `${costLabels}, грн`], [175, 229, ordersMax, "Замовлення"]]) {
    svg.append(svgElement(document, "text", { x: left, y: top - 11, class: "accounting-chart__label" }, label));
    for (const [y, value] of [[top, max], [bottom, 0]]) {
      svg.append(svgElement(document, "line", { x1: left, x2: right, y1: y, y2: y, class: "accounting-chart__grid" }));
      svg.append(svgElement(document, "text", { x: left - 10, y: y + 4, "text-anchor": "end" }, integer.format(value)));
    }
  }
  for (const [key, series, top, bottom, max] of [["google_uah", "google", 24, 132, costMax], ["meta_uah", "meta", 24, 132, costMax], ["orders", "orders", 175, 229, ordersMax]]) {
    let points = [];
    const flush = () => {
      if (!points.length) return;
      svg.append(svgElement(document, "polyline", { points: points.map(point => point.join(",")).join(" "), class: `accounting-chart__${series}`, style: "fill:none", "stroke-width": "2", "vector-effect": "non-scaling-stroke", "stroke-linecap": "round", "stroke-linejoin": "round" }));
      if (points.length === 1) svg.append(svgElement(document, "circle", { cx: points[0][0], cy: points[0][1], r: 2.5, class: `accounting-chart__${series}` }));
      points = [];
    };
    rows.forEach((row, index) => {
      if (!known(row[key])) return flush();
      points.push([x(index), bottom - Math.max(0, row[key]) / max * (bottom - top)]);
    });
    flush();
  }
  for (const index of new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])) {
    svg.append(svgElement(document, "text", { x: x(index), y: 251, "text-anchor": index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle" }, shortDate.format(dateValue(rows[index].date))));
  }
  mount.append(svg);
}

export function renderAccounting(root, data = {}) {
  const document = root.ownerDocument || root;
  const rows = (Array.isArray(data.daily) ? data.daily : []).filter(row => dateValue(row.date)).slice().sort((a, b) => a.date.localeCompare(b.date));
  for (const key of ["google", "meta"]) {
    const source = data.sources?.[key] || {};
    const amount = data.totals?.[`${key}_uah`];
    root.querySelector(`[data-accounting-total="${key}"]`).textContent = ["complete", "partial"].includes(source.status) && known(amount) ? money.format(amount) : "—";
    const status = root.querySelector(`[data-accounting-source="${key}"]`);
    status.textContent = sourceText(source);
    status.dataset.status = source.last_error ? "error" : source.status || "missing";
    if (source.updated_at) status.title = `Останні отримані дані: ${source.updated_at}`;
    else status.removeAttribute("title");
  }
  root.querySelector('[data-accounting-total="orders"]').textContent = known(data.totals?.orders) ? integer.format(data.totals.orders) : "—";
  const tbody = root.querySelector("[data-accounting-daily]");
  tbody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 4; cell.className = "muted accounting-empty"; cell.textContent = "За цей період даних немає.";
    row.append(cell); tbody.append(row);
  }
  for (const item of rows.slice().reverse()) {
    const row = document.createElement("tr"), date = document.createElement("th");
    date.scope = "row"; date.textContent = fullDate.format(dateValue(item.date)); row.append(date);
    for (const key of ["google_uah", "meta_uah", "orders"]) {
      const cell = document.createElement("td");
      cell.textContent = known(item[key]) ? (key === "orders" ? integer : decimal).format(item[key]) : "—";
      if (!known(item[key])) cell.setAttribute("aria-label", "Немає даних");
      row.append(cell);
    }
    tbody.append(row);
  }
  renderChart(root, rows);
}

export function createAccountingView(root, api, now = () => new Date()) {
  let sequence = 0, pending, displayedData, observedWidth = 0;
  const message = root.querySelector("[data-accounting-message]");
  const content = root.querySelector("[data-accounting-content]");
  const Resize = (root.ownerDocument || root).defaultView?.ResizeObserver;
  if (content && Resize) {
    new Resize(entries => {
      const width = entries[0]?.contentRect.width;
      if (!width || width === observedWidth) return;
      observedWidth = width;
      if (displayedData) renderAccounting(root, displayedData);
    }).observe(content);
  }
  return {
    load(range = "30d") {
      if (!content) return Promise.resolve();
      const period = accountingPeriod(range, now());
      const key = `${period.from || "all"}/${period.to}`;
      if (pending?.key === key) return pending.promise;
      const request = ++sequence;
      const periodNode = root.querySelector("[data-accounting-period]");
      periodNode.textContent = period.from ? `${fullDate.format(dateValue(period.from))} — ${fullDate.format(dateValue(period.to))} · Київ` : `Весь час — ${fullDate.format(dateValue(period.to))} · Київ`;
      displayedData = null;
      renderAccounting(root);
      content.setAttribute("aria-busy", "true");
      message.textContent = "Завантаження…"; message.dataset.state = "loading"; message.hidden = false;
      const promise = Promise.resolve().then(() => api(`/api/admin/accounting?${new URLSearchParams(period)}`)).then(data => {
        if (request !== sequence) return;
        displayedData = data;
        renderAccounting(root, data);
        if (dateValue(data.from) && dateValue(data.to)) periodNode.textContent = `${fullDate.format(dateValue(data.from))} — ${fullDate.format(dateValue(data.to))} · Київ${data.range_limited ? " · Останні 5 років" : ""}`;
        message.textContent = ""; message.hidden = true;
      }).catch(error => {
        if (request !== sequence) return;
        renderAccounting(root);
        message.textContent = error.status === 401 ? "Увійдіть, щоб переглянути бухгалтерію." : "Не вдалося завантажити витрати. Натисніть «Оновити».";
        message.dataset.state = "error"; message.hidden = false;
        if (error.status === 401) throw error;
      }).finally(() => {
        if (request !== sequence) return;
        content.setAttribute("aria-busy", "false"); pending = null;
      });
      pending = { key, promise };
      return promise;
    },
  };
}
