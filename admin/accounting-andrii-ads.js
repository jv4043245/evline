const DAY = 86400000;
const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayLabel = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" });
const minor = value => Number.isSafeInteger(value) && value >= 0;
const nullableMinor = value => value === null || minor(value);
const moneyText = value => minor(value) ? money.format(value / 100) : "—";
const dateValue = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
};
const kyivDay = now => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
};

export function andriiAdvertisingRange(month, count = 1, now = new Date()) {
  const today = kyivDay(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") || month < "2020-01" || month > today.slice(0, 7) || ![1, 2, 3].includes(count)) throw new Error("invalid_advertising_month");
  const [year, number] = month.split("-").map(Number);
  const from = new Date(Date.UTC(year, number - count, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  if (from < "2020-01-01") throw new Error("invalid_advertising_range");
  return { from, to: end < today ? end : today };
}

export function validAndriiAdvertisingRange(from, to, now = new Date()) {
  const first = dateValue(from), last = dateValue(to);
  return Boolean(first && last && from >= "2020-01-01" && from <= to && to <= kyivDay(now) && (last - first) / DAY + 1 <= 1827);
}

const markup = `
  <details class="andrii-ads" data-andrii-ads-details>
    <summary>Реклама за період</summary>
    <div class="andrii-ads__body">
      <p class="andrii-ads__anchor" data-andrii-ads-anchor></p>
      <div class="andrii-ads__presets" role="group" aria-label="Кількість місяців"><button type="button" data-andrii-months="1">1 місяць</button><button type="button" data-andrii-months="2">2 місяці</button><button type="button" data-andrii-months="3">3 місяці</button></div>
      <form class="andrii-ads__dates" data-andrii-ads-form novalidate><label>Від<input type="date" data-andrii-from min="2020-01-01" required></label><label>До<input type="date" data-andrii-to min="2020-01-01" required></label><button class="admin-btn" type="submit">Показати</button></form>
      <p class="andrii-ads__scope">Без румунської реклами · дати включно</p>
      <p class="andrii-ads__status" data-andrii-ads-status role="status" aria-live="polite"></p>
      <dl class="andrii-ads__totals"><div><dt>Google Ads</dt><dd data-andrii-ads-total="google_minor">—</dd></div><div><dt>Facebook · Instagram</dt><dd data-andrii-ads-total="meta_minor">—</dd></div><div><dt>Разом</dt><dd data-andrii-ads-total="total_minor">—</dd></div></dl>
      <p class="andrii-ads__known" data-andrii-ads-known hidden></p>
      <div class="andrii-ads__table-wrap" data-andrii-ads-months-wrap hidden><table><caption>За місяцями, грн</caption><thead><tr><th scope="col">Місяць</th><th scope="col">Google</th><th scope="col">Meta</th><th scope="col">Разом</th></tr></thead><tbody data-andrii-ads-months></tbody></table></div>
    </div>
  </details>`;

export function createAndriiAdvertisingView(container, api, { now = () => new Date(), getMonth } = {}) {
  if (!container) return { load: async () => false, isBusy: () => false, destroy() {} };
  container.innerHTML = markup;
  const document = container.ownerDocument;
  const details = container.querySelector("[data-andrii-ads-details]");
  const form = container.querySelector("[data-andrii-ads-form]");
  const fromInput = container.querySelector("[data-andrii-from]"), toInput = container.querySelector("[data-andrii-to]");
  const status = container.querySelector("[data-andrii-ads-status]");
  const known = container.querySelector("[data-andrii-ads-known]");
  const table = container.querySelector("[data-andrii-ads-months]"), tableWrap = container.querySelector("[data-andrii-ads-months-wrap]");
  const totals = [...container.querySelectorAll("[data-andrii-ads-total]")];
  let initialized = false, sequence = 0, pending = null, controller = null, loadedKey = "", pendingKey = "", disposed = false;
  const setStatus = (text = "", error = false) => { status.textContent = text; status.dataset.error = String(error); };
  const clear = () => { totals.forEach(node => { node.textContent = "—"; }); known.textContent = ""; known.hidden = true; table.replaceChildren(); tableWrap.hidden = true; };
  const currentMonth = () => getMonth?.() || kyivDay(now()).slice(0, 7);
  const applyPreset = count => {
    const range = andriiAdvertisingRange(currentMonth(), count, now());
    fromInput.value = range.from; toInput.value = range.to;
    container.querySelectorAll("[data-andrii-months]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.andriiMonths) === count)));
  };
  const initialize = () => {
    fromInput.max = toInput.max = kyivDay(now());
    const month = currentMonth();
    if (!dateValue(`${month}-01`)) throw new Error("invalid_advertising_month");
    container.querySelector("[data-andrii-ads-anchor]").textContent = `Останній місяць: ${monthLabel.format(dateValue(`${month}-01`))}`;
    if (!initialized) { applyPreset(1); initialized = true; }
  };
  const validate = (data, from, to) => {
    const yesterday = new Date(Date.parse(`${kyivDay(now())}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    const cutoff = to < yesterday ? to : yesterday;
    const effectiveTo = from <= cutoff ? cutoff : null;
    if (!data || data.scope !== "andrii" || data.currency !== "UAH" || data.timezone !== "Europe/Kyiv" || data.from !== from || data.to !== to ||
        !["complete", "partial", "missing"].includes(data.coverage) ||
        ["google_minor", "meta_minor", "total_minor", "google_known_minor", "meta_known_minor", "known_total_minor"].some(key => !nullableMinor(data[key])) ||
        (data.coverage === "complete" && (![data.google_minor, data.meta_minor, data.total_minor].every(minor) || data.google_minor + data.meta_minor !== data.total_minor)) ||
        (data.coverage !== "complete" && data.total_minor !== null) ||
        data.effective_to !== effectiveTo || data.is_provisional !== (to > yesterday) ||
        (data.monthly !== undefined && !Array.isArray(data.monthly))) throw new Error("invalid_advertising_response");
    for (const row of data.monthly || []) {
      if (!row || !dateValue(`${row.month}-01`) || !dateValue(row.from) || !dateValue(row.to) || row.from < from || row.to > effectiveTo || row.from > row.to || row.from.slice(0, 7) !== row.month || row.to.slice(0, 7) !== row.month ||
          !["complete", "partial", "missing"].includes(row.coverage) || ["google_minor", "meta_minor", "total_minor"].some(key => !nullableMinor(row[key])) ||
          (row.coverage === "complete" && (![row.google_minor, row.meta_minor, row.total_minor].every(minor) || row.google_minor + row.meta_minor !== row.total_minor)) ||
          (row.coverage !== "complete" && row.total_minor !== null)) throw new Error("invalid_advertising_response");
    }
    return data;
  };
  const render = data => {
    totals.forEach(node => { node.textContent = moneyText(data[node.dataset.andriiAdsTotal]); });
    const range = `${dayLabel.format(dateValue(data.from))} — ${dayLabel.format(dateValue(data.to))}`;
    let text = `${range}${data.coverage === "complete" ? "" : data.coverage === "partial" ? " · Неповні дані" : " · Немає повних даних"}`;
    if (data.is_provisional) text += data.effective_to ? ` · реклама по ${dayLabel.format(dateValue(data.effective_to))}` : " · поточний день ще не завершено";
    if (data.igor_allocation === "incomplete") text += " · Румунські витрати ще не звірені";
    setStatus(text);
    if (data.coverage !== "complete" && minor(data.known_total_minor)) { known.hidden = false; known.textContent = `За наявними даними: ${moneyText(data.known_total_minor)}. Це не повний підсумок.`; }
    const rows = data.monthly || [];
    if (rows.length > 1) {
      tableWrap.hidden = false;
      for (const row of rows) {
        const tr = document.createElement("tr"), th = document.createElement("th");
        const [year, month] = row.month.split("-").map(Number);
        const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
        const partialDates = row.from !== `${row.month}-01` || row.to !== lastDay ? ` · ${dayLabel.format(dateValue(row.from))}–${dayLabel.format(dateValue(row.to))}` : "";
        th.scope = "row"; th.textContent = `${monthLabel.format(dateValue(`${row.month}-01`))}${partialDates}${row.coverage === "complete" ? "" : " *"}`; tr.append(th);
        for (const key of ["google_minor", "meta_minor", "total_minor"]) { const td = document.createElement("td"); td.textContent = minor(row[key]) ? money.format(row[key] / 100).replace(/\s*₴$/, "") : "—"; tr.append(td); }
        table.append(tr);
      }
    }
  };
  const load = (refresh = false) => {
    if (disposed || !details.open) return Promise.resolve(false);
    try { initialize(); } catch { clear(); setStatus("Оберіть коректний місяць розрахунку.", true); return Promise.resolve(false); }
    const from = fromInput.value, to = toInput.value, key = `${from}/${to}`;
    if (!validAndriiAdvertisingRange(from, to, now())) { sequence++; controller?.abort(); pending = null; loadedKey = ""; clear(); details.removeAttribute("aria-busy"); setStatus("Оберіть коректні дати: не в майбутньому, до 5 років.", true); return Promise.resolve(false); }
    if (pending && pendingKey === key && !refresh) return pending;
    if (loadedKey === key && !refresh) return Promise.resolve(true);
    const requestId = ++sequence; controller?.abort(); controller = new AbortController(); const requestController = controller; pendingKey = key; loadedKey = "";
    clear(); details.setAttribute("aria-busy", "true"); setStatus("Завантаження…");
    const task = Promise.resolve().then(() => api(`/api/admin/accounting/andrii?${new URLSearchParams({ from, to })}`, { signal: requestController.signal })).then(data => {
      if (disposed || requestId !== sequence) return false;
      render(validate(data, from, to)); loadedKey = key; return true;
    }).catch(error => {
      if (disposed || requestId !== sequence) return false;
      clear(); setStatus(error.status === 401 ? "Увійдіть, щоб переглянути витрати." : "Не вдалося завантажити. Спробуйте ще раз.", true);
      return false;
    }).finally(() => { if (requestId === sequence) { pending = null; details.removeAttribute("aria-busy"); } });
    pending = task; return task;
  };
  details.addEventListener("toggle", () => { if (details.open) load().catch(() => {}); });
  form.addEventListener("submit", event => { event.preventDefault(); load(true).catch(() => {}); });
  for (const input of [fromInput, toInput]) input.addEventListener("input", () => {
    sequence++; controller?.abort(); pending = null; loadedKey = ""; clear(); details.removeAttribute("aria-busy"); setStatus();
    container.querySelectorAll("[data-andrii-months]").forEach(button => button.setAttribute("aria-pressed", "false"));
  });
  container.querySelectorAll("[data-andrii-months]").forEach(button => button.addEventListener("click", () => {
    try { initialize(); applyPreset(Number(button.dataset.andriiMonths)); load(true).catch(() => {}); }
    catch { clear(); setStatus("Оберіть коректний період.", true); }
  }));
  return { load, isBusy: () => Boolean(pending), destroy() { disposed = true; sequence++; controller?.abort(); pending = null; } };
}
