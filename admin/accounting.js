const KYIV = "Europe/Kyiv";
const DAY = 86_400_000;
const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const axisNumber = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const monthDate = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("uk-UA", { month: "2-digit", year: "2-digit", timeZone: "UTC" });
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

// A single visible selector, with independent accounting and operational periods.
export function createAccountingPeriodState(storage) {
  const valid = value => ["7d", "30d", "90d", "365d", "all"].includes(value);
  let accounting = storage?.getItem("evline_accounting_range") || "all";
  if (!valid(accounting)) accounting = "all";
  let operational = "30d", active = null;
  const remember = (tab, value) => {
    if (!valid(value)) return;
    if (tab === "accounting") {
      accounting = value;
      storage?.setItem("evline_accounting_range", value);
    } else operational = value;
  };
  return {
    enter(tab, current) {
      if (active !== null) remember(active, current);
      active = tab;
      return tab === "accounting" ? accounting : operational;
    },
    remember,
    accounting: () => accounting,
  };
}

const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const partialMonth = row => row.from !== `${row.month}-01` || row.to !== monthEnd(row.month);

// Both channels must be known. Sum integer kopecks and retain partial coverage.
export function accountingSpendTotal(row = {}) {
  const missing = { total_uah: null, total_coverage: "missing" };
  const amounts = [];
  for (const provider of ["google", "meta"]) {
    const value = row[`${provider}_uah`];
    if (!known(value) || value < 0 || !["complete", "partial"].includes(row[`${provider}_coverage`])) return missing;
    const minor = Math.round(value * 100);
    if (!Number.isSafeInteger(minor)) return missing;
    amounts.push(minor);
  }
  const total = amounts[0] + amounts[1];
  if (!Number.isSafeInteger(total)) return missing;
  return { total_uah: total / 100, total_coverage: row.google_coverage === "complete" && row.meta_coverage === "complete" ? "complete" : "partial" };
}

// Compatibility during rolling deploys: aggregate integer kopecks, never round
// each floating-point addition, and do not turn absent days into zero expense.
export function accountingMonths(daily, { from, to } = {}) {
  const rows = (Array.isArray(daily) ? daily : []).filter(row => dateValue(row.date));
  if (!rows.length) return [];
  const byDate = new Map(rows.map(row => [row.date, row]));
  const dates = [...byDate.keys()].sort();
  from = dateValue(from) ? from : dates[0];
  to = dateValue(to) ? to : dates.at(-1);
  if (from > to || (Date.parse(to) - Date.parse(from)) / DAY > 1827) return [];
  const months = new Map();
  for (let time = Date.parse(from); time <= Date.parse(to); time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10), month = date.slice(0, 7);
    const row = byDate.get(date) || {};
    const group = months.get(month) || { month, from: date, to: date, days_expected: 0, orders: 0, orders_present: 0,
      google_minor: 0, google_days_present: 0, google_days_complete: 0,
      meta_minor: 0, meta_days_present: 0, meta_days_complete: 0 };
    group.to = date;
    group.days_expected += 1;
    if (Number.isSafeInteger(row.orders) && row.orders >= 0) { group.orders += row.orders; group.orders_present += 1; }
    for (const key of ["google", "meta"]) {
      const value = row[`${key}_uah`];
      if (!known(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) continue;
      group[`${key}_minor`] += Math.round(value * 100);
      group[`${key}_days_present`] += 1;
      if (row[`${key}_coverage`] === "complete") group[`${key}_days_complete`] += 1;
    }
    months.set(month, group);
  }
  return [...months.values()].map(({ google_minor, meta_minor, orders_present, ...row }) => ({ ...row,
    orders: orders_present === row.days_expected ? row.orders : null,
    google_uah: row.google_days_present ? google_minor / 100 : null,
    meta_uah: row.meta_days_present ? meta_minor / 100 : null,
    google_coverage: row.google_days_complete === row.days_expected ? "complete" : row.google_days_present ? "partial" : "missing",
    meta_coverage: row.meta_days_complete === row.days_expected ? "complete" : row.meta_days_present ? "partial" : "missing",
  }));
}

function granularity(root) {
  return root.querySelector('[data-accounting-granularity="days"][aria-pressed="true"]') ? "days" : "months";
}

function viewRows(data, mode) {
  if (mode === "days") return (Array.isArray(data.daily) ? data.daily : []).filter(row => dateValue(row.date)).slice().sort((a, b) => a.date.localeCompare(b.date));
  const rows = Array.isArray(data.monthly) ? data.monthly : accountingMonths(data.daily, data);
  return rows.filter(row => dateValue(`${row.month}-01`) && dateValue(row.from) && dateValue(row.to)).slice().sort((a, b) => a.month.localeCompare(b.month));
}

function periodLabel(row, mode, short = false) {
  return mode === "months" ? (short ? shortMonth : monthDate).format(dateValue(`${row.month}-01`)) : (short ? shortDate : fullDate).format(dateValue(row.date));
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

// Calendar slots are deliberately empty outside the loaded report period.
export function accountingChartMonths(rows, year) {
  const byMonth = new Map(rows.map(row => [row.month, row]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return byMonth.get(month) || { month, from: `${month}-01`, to: monthEnd(month), google_uah: null, meta_uah: null, orders: null };
  });
}

function chartCeiling(value, whole = false) {
  const roughStep = Math.max(1, value) / 4;
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.max(1, [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(n => n * power >= roughStep) * power);
  return (whole ? Math.ceil(step) : step) * 4;
}

function renderChart(root, inputRows, mode) {
  const panel = root.querySelector("[data-accounting-trend]");
  const mount = root.querySelector("[data-accounting-chart]");
  const yearSelect = root.querySelector("[data-accounting-chart-year]");
  mount.replaceChildren();
  panel.hidden = !inputRows.some(row => known(row.google_uah) || known(row.meta_uah) || known(row.orders));
  if (panel.hidden) return;
  const document = root.ownerDocument || root;
  yearSelect.hidden = mode !== "months";
  let rows = inputRows;
  if (mode === "months") {
    const years = [...new Set(rows.map(row => row.month.slice(0, 4)))].sort().reverse();
    const selected = years.includes(yearSelect.value) ? yearSelect.value : years[0];
    yearSelect.replaceChildren(...years.map(year => {
      const option = document.createElement("option"); option.value = year; option.textContent = year; return option;
    }));
    yearSelect.value = selected;
    rows = accountingChartMonths(rows, selected);
  }
  const padding = mount.clientWidth && document.defaultView ? parseFloat(document.defaultView.getComputedStyle(mount).paddingLeft) + parseFloat(document.defaultView.getComputedStyle(mount).paddingRight) : 0;
  const width = Math.max(280, (mount.clientWidth || 800) - (padding || 0));
  const height = width < 500 ? 270 : 290;
  const svg = svgElement(document, "svg", { viewBox: `0 0 ${width} ${height}`, role: "group", "aria-labelledby": "accounting-chart-title accounting-chart-description" });
  svg.append(svgElement(document, "title", { id: "accounting-chart-title" }, `Витрати на рекламу та замовлення ${mode === "months" ? "за місяцями" : "за днями"}`));
  svg.append(svgElement(document, "desc", { id: "accounting-chart-description" }, "Три лінії. Ліва шкала — Google Ads і Facebook / Instagram у гривнях; права — створені замовлення CRM з усіх джерел, у штуках. Шкали різні, обидві починаються з нуля. Порожні місяці не означають нуль. Пунктир і зірочка — неповний період або дані. Стрілки перемикають дати; точні значення доступні при наведенні, натисканні або фокусі."));
  const left = width < 500 ? 52 : 62, right = width - (width < 500 ? 31 : 45), top = 28, bottom = height - 35;
  const x = index => left + (rows.length === 1 ? .5 : index / (rows.length - 1)) * (right - left);
  const costMax = chartCeiling(Math.max(0, ...rows.flatMap(row => [row.google_uah, row.meta_uah]).filter(known)));
  const ordersMax = chartCeiling(Math.max(0, ...rows.map(row => row.orders).filter(known)), true);
  const seriesConfig = [["google_uah", "google", "Google Ads", costMax], ["meta_uah", "meta", "Facebook / Instagram", costMax], ["orders", "orders", "Замовлення CRM", ordersMax]];
  const isPartial = (row, series) => (mode === "months" && partialMonth(row)) || (series !== "orders" && row[`${series}_coverage`] !== "complete");
  svg.append(svgElement(document, "text", { x: left, y: 13, class: "accounting-chart__label", "data-chart-axis": "spend" }, "Реклама, грн"));
  svg.append(svgElement(document, "text", { x: right, y: 13, "text-anchor": "end", class: "accounting-chart__label", "data-chart-axis": "orders" }, "Замовлення, шт."));
  for (let tick = 0; tick <= 4; tick++) {
    const y = bottom - tick / 4 * (bottom - top), cost = costMax * tick / 4;
    svg.append(svgElement(document, "line", { x1: left, x2: right, y1: y, y2: y, class: "accounting-chart__grid" }));
    const costLabel = width < 500 && cost >= 1000 ? `${axisNumber.format(cost / 1000)} тис.` : axisNumber.format(cost);
    svg.append(svgElement(document, "text", { x: left - 8, y: y + 4, "text-anchor": "end", "data-chart-tick": "spend" }, costLabel));
    svg.append(svgElement(document, "text", { x: right + 8, y: y + 4, "data-chart-tick": "orders" }, integer.format(ordersMax * tick / 4)));
  }
  for (const [key, series, , max] of seriesConfig) {
    let points = [], previousPartial = false, strokePartial = false;
    const flush = () => {
      if (!points.length) return;
      svg.append(svgElement(document, "polyline", { points: points.map(point => point.join(",")).join(" "), class: `accounting-chart__${series}`, style: "fill:none", "stroke-width": "2", "vector-effect": "non-scaling-stroke", "stroke-linecap": "round", "stroke-linejoin": "round", ...(strokePartial ? { "stroke-dasharray": "4 4" } : {}) }));
      if (points.length === 1) svg.append(svgElement(document, "circle", { cx: points[0][0], cy: points[0][1], r: 2.5, class: `accounting-chart__${series}` }));
      points = [];
    };
    rows.forEach((row, index) => {
      if (!known(row[key])) return flush();
      const partial = isPartial(row, series);
      const point = [x(index), bottom - Math.max(0, row[key]) / max * (bottom - top)];
      const nextStrokePartial = points.length ? partial || previousPartial : partial;
      if (points.length > 1 && nextStrokePartial !== strokePartial) {
        const previousPoint = points.at(-1);
        flush();
        points.push(previousPoint);
      }
      strokePartial = nextStrokePartial;
      previousPartial = partial;
      points.push(point);
      if (mode === "months" || partial || rows.length <= 31) {
        const marker = svgElement(document, series === "meta" ? "rect" : "circle", { ...(series === "meta" ? { x: point[0] - 3, y: point[1] - 3, width: 6, height: 6 } : { cx: point[0], cy: point[1], r: series === "orders" ? 2.5 : 4 }), class: `accounting-chart__${series}`, "data-chart-point": `${series}:${row.month || row.date}`, style: partial || series === "google" ? "fill:white" : "", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke" });
        marker.append(svgElement(document, "title", {}, `${periodLabel(row, mode)}${partial ? " · Неповні дані" : ""}`));
        svg.append(marker);
      }
    });
    flush();
  }
  const months = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"];
  const tickCount = Math.min(rows.length, width < 500 ? 3 : 7);
  const tickIndices = mode === "months" ? rows.map((_, i) => i) : [...new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i * (rows.length - 1) / Math.max(1, tickCount - 1))))];
  for (const index of tickIndices) {
    const row = rows[index], partial = mode === "months" && seriesConfig.some(([key, series]) => known(row[key]) && isPartial(row, series));
    const label = mode === "months" ? width < 500 ? String(index + 1).padStart(2, "0") : months[index] : periodLabel(row, mode, true);
    svg.append(svgElement(document, "text", { x: x(index), y: height - 12, "text-anchor": "middle", "data-chart-month": row.month || "" }, `${label}${partial ? "*" : ""}`));
  }
  const tooltip = document.createElement("div"); tooltip.className = "accounting-chart-tooltip"; tooltip.hidden = true;
  tooltip.setAttribute("role", "tooltip"); tooltip.id = "accounting-chart-tooltip";
  const cursor = svgElement(document, "line", { y1: top, y2: bottom, class: "accounting-chart__cursor", visibility: "hidden" });
  svg.append(cursor);
  const valueLabel = (row, key, series) => known(row[key]) ? `${key === "orders" ? integer.format(row[key]) : money.format(row[key])}${isPartial(row, series) ? " *" : ""}` : "Немає даних";
  const hide = () => { tooltip.hidden = true; cursor.setAttribute("visibility", "hidden"); };
  const show = index => {
    const row = rows[index]; tooltip.replaceChildren();
    const heading = document.createElement("strong"); heading.textContent = periodLabel(row, mode); tooltip.append(heading);
    for (const [key, series, label] of seriesConfig) {
      const line = document.createElement("div"), name = document.createElement("span"), amount = document.createElement("span");
      name.textContent = label; amount.textContent = valueLabel(row, key, series); line.append(name, amount); tooltip.append(line);
    }
    const partial = seriesConfig.some(([key, series]) => known(row[key]) && isPartial(row, series));
    if (partial) {
      const note = document.createElement("small");
      note.textContent = mode === "months" ? `${shortDate.format(dateValue(row.from))}–${shortDate.format(dateValue(row.to))} · неповний місяць або дані` : "* Неповні дані";
      tooltip.append(note);
    }
    const pointX = x(index) + (padding || 0) / 2;
    tooltip.style.left = `${Math.max(12, Math.min(width - 247, pointX > width / 2 ? pointX - 247 : pointX + 12))}px`;
    tooltip.hidden = false;
    cursor.setAttribute("x1", x(index)); cursor.setAttribute("x2", x(index)); cursor.setAttribute("visibility", "visible");
  };
  const targets = [], latest = rows.findLastIndex(row => seriesConfig.some(([key]) => known(row[key])));
  rows.forEach((row, index) => {
    const edgeLeft = index ? (x(index - 1) + x(index)) / 2 : left - 7;
    const edgeRight = index < rows.length - 1 ? (x(index) + x(index + 1)) / 2 : right + 7;
    const target = svgElement(document, "rect", { x: edgeLeft, y: top, width: edgeRight - edgeLeft, height: height - top, class: "accounting-chart__hit", role: "button", tabindex: index === latest ? "0" : "-1", "data-chart-date": row.month || row.date, "aria-label": `${periodLabel(row, mode)}. ${seriesConfig.map(([key, series, label]) => `${label}: ${valueLabel(row, key, series)}`).join(". ")}. Замовлення з усіх джерел.`, "aria-describedby": "accounting-chart-tooltip" });
    for (const event of ["pointerenter", "focus", "click"]) target.addEventListener(event, () => show(index));
    target.addEventListener("blur", hide);
    target.addEventListener("keydown", event => {
      if (event.key === "Escape") { hide(); return; }
      if (["Enter", " "].includes(event.key)) { event.preventDefault(); show(index); return; }
      const next = { ArrowLeft: Math.max(0, index - 1), ArrowRight: Math.min(rows.length - 1, index + 1), Home: 0, End: rows.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault(); targets.forEach((item, i) => item.setAttribute("tabindex", i === next ? "0" : "-1")); targets[next].focus();
    });
    targets.push(target); svg.append(target);
  });
  svg.addEventListener("pointerleave", event => { if (event.pointerType !== "touch") hide(); });
  const partial = rows.some(row => seriesConfig.some(([key, series]) => known(row[key]) && isPartial(row, series)));
  root.querySelector("[data-accounting-chart-note]").textContent = `Замовлення CRM — усі джерела.${partial ? " * Пунктир — неповний період або дані." : ""}`;
  mount.append(svg, tooltip);
}

export function renderAccounting(root, data = {}) {
  const document = root.ownerDocument || root;
  const mode = granularity(root), rows = viewRows(data, mode);
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
  root.querySelector("#accounting-history-title").textContent = mode === "months" ? "За місяцями" : "За днями";
  root.querySelector("[data-accounting-date-heading]").textContent = mode === "months" ? "Місяць" : "Дата";
  root.querySelector("[data-accounting-table-region]").setAttribute("aria-label", mode === "months" ? "Щомісячні витрати та замовлення" : "Щоденні витрати та замовлення");
  tbody.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 5; cell.className = "muted accounting-empty"; cell.textContent = "За цей період даних немає.";
    row.append(cell); tbody.append(row);
  }
  for (const item of rows.slice().reverse()) {
    const row = document.createElement("tr"), date = document.createElement("th");
    date.scope = "row"; date.textContent = periodLabel(item, mode); row.append(date);
    if (mode === "months" && partialMonth(item)) {
      const note = document.createElement("small");
      note.className = "accounting-period-note";
      note.textContent = `${shortDate.format(dateValue(item.from))}–${shortDate.format(dateValue(item.to))}`;
      date.append(note);
    }
    const values = { ...item, ...accountingSpendTotal(item) };
    for (const key of ["google_uah", "meta_uah", "total_uah", "orders"]) {
      const cell = document.createElement("td");
      cell.dataset.accountingCell = key;
      cell.textContent = known(values[key]) ? (key === "orders" ? integer : decimal).format(values[key]) : "—";
      if (!known(values[key])) cell.setAttribute("aria-label", "Немає даних");
      if (known(values[key]) && key !== "orders" && values[`${key.replace("_uah", "")}_coverage`] !== "complete") {
        const provider = key.replace("_uah", ""), note = document.createElement("small");
        note.className = "accounting-coverage-note";
        note.textContent = "Неповні дані";
        if (mode === "months" && Number.isSafeInteger(item[`${provider}_days_present`]) && Number.isSafeInteger(item.days_expected)) note.title = `${item[`${provider}_days_present`]}/${item.days_expected} днів з даними`;
        cell.append(note);
      }
      row.append(cell);
    }
    tbody.append(row);
  }
  renderChart(root, rows, mode);
}

export function createAccountingView(root, api, now = () => new Date()) {
  let sequence = 0, pending, displayedData, observedWidth = 0;
  const message = root.querySelector("[data-accounting-message]");
  const content = root.querySelector("[data-accounting-content]");
  root.querySelectorAll("[data-accounting-granularity]").forEach(button => {
    button.addEventListener("click", () => {
      root.querySelectorAll("[data-accounting-granularity]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      renderAccounting(root, displayedData || {});
    });
  });
  root.querySelector("[data-accounting-chart-year]")?.addEventListener("change", () => {
    if (displayedData) renderChart(root, viewRows(displayedData, "months"), "months");
  });
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
