const INPUT_KEYS = ["revenue_minor", "purchase_minor", "shipping_minor", "other_minor"];
const MAX_MINOR = 100000000000;
const formatter = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const validMinor = value => Number.isSafeInteger(value) && value >= 0;
const nullableMinor = value => value === null || validMinor(value);
const moneyText = value => Number.isSafeInteger(value) ? formatter.format(value / 100) : "—";
const blankInputs = () => Object.fromEntries([...INPUT_KEYS.map(key => [key, null]), ["other_note", ""]]);

export function validProfitMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2020;
}

function currentKyivMonth(now) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}`;
}

export function defaultProfitMonth(now = new Date()) {
  const current = currentKyivMonth(now);
  return new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
}

// Accept ordinary UA input without floating-point multiplication ("1 234,56").
// An empty value stays unknown; no implicit zero or scientific notation.
export function parseProfitAmount(value) {
  const normalized = String(value ?? "").trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!normalized) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) throw new Error("invalid_amount");
  const [whole, fraction = ""] = normalized.split(/[.,]/);
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) throw new Error("invalid_amount");
  return minor;
}

export function calculateProfitPreview(inputs = {}, advertising = {}) {
  const missing = INPUT_KEYS.filter(key => !validMinor(inputs[key]) || inputs[key] > MAX_MINOR);
  const note = String(inputs.other_note || "").trim();
  if ((inputs.other_minor > 0 && !note) || note.length > 500) missing.push("other_note");
  if (advertising.coverage !== "complete" || !validMinor(advertising.total_minor)) missing.push("advertising");
  if (missing.length) return { status: "incomplete", rate_basis_points: 1500, profit_before_manager_minor: null, manager_minor: null, owner_remaining_minor: null, missing_keys: missing };
  const profit = inputs.revenue_minor - inputs.purchase_minor - inputs.shipping_minor - inputs.other_minor - advertising.total_minor;
  if (!Number.isSafeInteger(profit) || !Number.isSafeInteger(Math.max(0, profit) * 15 + 50)) {
    return { status: "incomplete", rate_basis_points: 1500, profit_before_manager_minor: null, manager_minor: null, owner_remaining_minor: null, missing_keys: ["calculation"] };
  }
  const manager = Math.floor((Math.max(0, profit) * 15 + 50) / 100);
  return { status: "draft", rate_basis_points: 1500, profit_before_manager_minor: profit, manager_minor: manager, owner_remaining_minor: profit - manager, missing_keys: [] };
}

function inputText(value) {
  if (!validMinor(value)) return "";
  return `${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")}`;
}

const markup = `
  <div class="accounting-profit__heading">
    <div><h1>Розрахунок менеджера</h1><p>Лише повністю оплачені й видані замовлення.</p></div>
    <label class="accounting-profit__month">Місяць<input type="month" data-profit-month min="2020-01" required aria-label="Місяць розрахунку"></label>
  </div>
  <form class="accounting-profit__panel" data-profit-form novalidate>
    <div class="accounting-profit__panel-heading"><h2>Суми за місяць, грн</h2><span class="accounting-profit__badge">Чернетка</span></div>
    <div class="accounting-profit__inputs">
      <label>Виручка<input name="revenue_minor" type="text" inputmode="decimal" autocomplete="off" placeholder="—" aria-describedby="profit-input-help"></label>
      <label>Закупівля<input name="purchase_minor" type="text" inputmode="decimal" autocomplete="off" placeholder="—" aria-describedby="profit-input-help"></label>
      <label>Доставка<input name="shipping_minor" type="text" inputmode="decimal" autocomplete="off" placeholder="—" aria-describedby="profit-input-help"></label>
      <label>Інші витрати<input name="other_minor" type="text" inputmode="decimal" autocomplete="off" placeholder="—" aria-describedby="profit-input-help"></label>
      <label class="accounting-profit__other-note" data-profit-note-wrap hidden>Розшифровка<textarea name="other_note" rows="2" maxlength="500"></textarea></label>
    </div>
    <p class="accounting-profit__hint" id="profit-input-help">Якщо витрат немає, вкажіть 0.</p>
    <section class="accounting-profit__advertising" aria-label="Реклама за вибраний місяць">
      <div><h3>Реклама</h3><small>Автоматично</small></div>
      <dl><div><dt>Google Ads</dt><dd data-profit-ad="google_minor">—</dd></div><div><dt>Facebook · Instagram</dt><dd data-profit-ad="meta_minor">—</dd></div><div class="accounting-profit__ad-total"><dt>Разом</dt><dd data-profit-ad="total_minor">—</dd></div></dl>
      <p class="accounting-profit__ad-status" data-profit-ad-status></p>
    </section>
    <section class="accounting-profit__results" aria-labelledby="profit-results-title">
      <h3 id="profit-results-title">Попередній розрахунок</h3>
      <dl><div><dt>Прибуток до винагороди</dt><dd data-profit-result="profit_before_manager_minor">—</dd></div><div class="accounting-profit__manager"><dt>Менеджеру · 15%</dt><dd data-profit-result="manager_minor">—</dd></div><div><dt>Залишок</dt><dd data-profit-result="owner_remaining_minor">—</dd></div></dl>
    </section>
    <div class="accounting-profit__footer"><p data-profit-message role="status" aria-live="polite"></p><button class="admin-btn admin-btn--primary" type="submit" data-profit-save disabled>Зберегти</button></div>
  </form>`;

export function createAccountingProfitView(container, api, { now = () => new Date(), confirmDiscard } = {}) {
  if (!container) return { load: async () => {}, hasChanges: () => false, isDirty: () => false, isBusy: () => false, canLeave: () => true, getMonth: () => defaultProfitMonth(now()) };
  container.classList.add("accounting-profit");
  container.innerHTML = markup;
  const document = container.ownerDocument, window = document.defaultView;
  const ask = confirmDiscard || (text => window.confirm(text));
  const form = container.querySelector("[data-profit-form]"), monthInput = container.querySelector("[data-profit-month]");
  const message = container.querySelector("[data-profit-message]"), saveButton = container.querySelector("[data-profit-save]");
  let month = defaultProfitMonth(now()), revision = 0, baseline = "", savedInputs = blankInputs();
  let advertising = {}, currentMonth = false, loaded = false, busy = false, conflicted = false, pending = null, sequence = 0;
  monthInput.value = month; monthInput.max = currentKyivMonth(now());

  const raw = () => ({ ...Object.fromEntries(INPUT_KEYS.map(key => [key, form.elements.namedItem(key).value])), other_note: form.elements.namedItem("other_note").value });
  const hasChanges = () => loaded && JSON.stringify(raw()) !== baseline;
  const setMessage = (text = "", error = false) => { message.textContent = text; message.dataset.state = error ? "error" : "normal"; };
  const setBusy = value => {
    busy = value; form.setAttribute("aria-busy", String(value));
    monthInput.disabled = value;
    for (const element of [...form.elements]) element.disabled = value || !loaded;
    saveButton.disabled = value || !loaded || conflicted || !hasChanges();
  };
  const readInputs = () => {
    const values = blankInputs(), errors = [];
    for (const key of INPUT_KEYS) {
      try { values[key] = parseProfitAmount(form.elements.namedItem(key).value); }
      catch { errors.push(key); }
    }
    values.other_note = form.elements.namedItem("other_note").value.trim();
    if (values.other_note.length > 500 || (values.other_minor > 0 && !values.other_note)) errors.push("other_note");
    return { values, errors };
  };
  const renderCalculation = calculation => {
    for (const key of ["profit_before_manager_minor", "manager_minor", "owner_remaining_minor"]) {
      const target = container.querySelector(`[data-profit-result="${key}"]`);
      target.textContent = moneyText(calculation[key]);
      target.dataset.negative = String(Number.isSafeInteger(calculation[key]) && calculation[key] < 0);
    }
  };
  const render = () => {
    const { values, errors } = readInputs();
    container.querySelector("[data-profit-note-wrap]").hidden = !(values.other_minor > 0 || form.elements.namedItem("other_note").value);
    form.elements.namedItem("other_note").required = values.other_minor > 0;
    renderCalculation(errors.length ? {} : calculateProfitPreview(values, advertising));
    for (const key of ["google_minor", "meta_minor", "total_minor"]) container.querySelector(`[data-profit-ad="${key}"]`).textContent = moneyText(advertising[key]);
    const adStatus = container.querySelector("[data-profit-ad-status]");
    let coverageText = !loaded ? "" : advertising.coverage === "complete" ? "" : advertising.coverage === "partial" ? "Неповні дані за місяць" : "Немає даних за місяць";
    if (loaded && currentMonth) {
      const through = typeof advertising.through === "string" && /^\d{4}-\d{2}-\d{2}$/.test(advertising.through) ? new Date(`${advertising.through}T00:00:00Z`) : null;
      const throughText = through && Number.isFinite(through.getTime()) && through.toISOString().slice(0, 10) === advertising.through ? ` · реклама по ${shortDate.format(through)}` : "";
      coverageText = `${coverageText || "Попередньо"}${throughText}`;
    }
    adStatus.textContent = coverageText;
    saveButton.disabled = busy || !loaded || conflicted || !hasChanges();
  };
  const applyInputs = inputs => {
    for (const key of INPUT_KEYS) form.elements.namedItem(key).value = inputText(inputs[key]);
    form.elements.namedItem("other_note").value = inputs.other_note || "";
    baseline = JSON.stringify(raw());
    for (const element of form.elements) element.removeAttribute("aria-invalid");
  };
  const validateResponse = (data, expectedMonth) => {
    if (!data || data.month !== expectedMonth || !validProfitMonth(data.month) || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
        !data.inputs || INPUT_KEYS.some(key => !nullableMinor(data.inputs[key]) || data.inputs[key] > MAX_MINOR) ||
        typeof data.inputs.other_note !== "string" || data.inputs.other_note.length > 500 ||
        !data.advertising || !["complete", "partial", "missing"].includes(data.advertising.coverage) ||
        ["google_minor", "meta_minor", "total_minor"].some(key => !nullableMinor(data.advertising[key])) ||
        (data.advertising.coverage === "complete" && (!["google_minor", "meta_minor", "total_minor"].every(key => validMinor(data.advertising[key])) || data.advertising.google_minor + data.advertising.meta_minor !== data.advertising.total_minor)) ||
        data.currency !== "UAH" || data.basis !== "paid_and_delivered") throw new Error("invalid_profit_response");
    return data;
  };
  const accept = data => {
    month = data.month; revision = data.revision; savedInputs = { ...data.inputs }; advertising = { ...data.advertising }; currentMonth = data.current_month === true || month === currentKyivMonth(now()); loaded = true;
    monthInput.value = month; applyInputs(savedInputs); render();
    // Server result is authoritative after reads/writes; edits are a local preview.
    if (calculateProfitPreview(data.inputs, data.advertising).status === "draft" && data.calculation?.status === "draft") renderCalculation(data.calculation);
  };
  const canLeave = () => {
    if (busy) return false;
    if (!hasChanges()) return true;
    if (!ask("Незбережені зміни буде втрачено. Продовжити?")) return false;
    applyInputs(savedInputs); render(); setMessage(); return true;
  };
  const load = async (requestedMonth = month) => {
    if (pending && requestedMonth === month) return pending;
    if (busy || !canLeave()) { monthInput.value = month; return false; }
    if (!validProfitMonth(requestedMonth) || requestedMonth > currentKyivMonth(now())) { monthInput.value = month; setMessage("Оберіть коректний місяць.", true); return false; }
    const requestId = ++sequence;
    month = requestedMonth; monthInput.value = month; loaded = false; conflicted = false; advertising = {}; savedInputs = blankInputs(); applyInputs(savedInputs); render(); setBusy(true); setMessage("Завантаження…");
    const task = Promise.resolve().then(() => api(`/api/admin/accounting/profit?${new URLSearchParams({ month: requestedMonth })}`)).then(data => {
      if (requestId !== sequence) return false;
      accept(validateResponse(data, requestedMonth)); setMessage(); return true;
    }).catch(error => {
      if (requestId !== sequence) return false;
      setMessage(error.status === 401 ? "Увійдіть, щоб відкрити розрахунок." : "Не вдалося завантажити. Натисніть «Оновити».", true);
      if (error.status === 401) throw error;
      return false;
    }).finally(() => {
      if (requestId !== sequence) return;
      pending = null; setBusy(false);
    });
    pending = task; return task;
  };

  form.addEventListener("input", event => {
    if (busy || !loaded) return;
    event.target.removeAttribute("aria-invalid");
    if (!conflicted) setMessage();
    render();
  });
  monthInput.addEventListener("change", () => { load(monthInput.value).catch(() => {}); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !loaded || conflicted || !hasChanges()) return;
    const { values, errors } = readInputs();
    if (errors.length) {
      for (const key of errors) form.elements.namedItem(key).setAttribute("aria-invalid", "true");
      setMessage(errors.includes("other_note") ? "Додайте розшифровку інших витрат (до 500 знаків)." : "Перевірте суму: гривні, не більше двох знаків після коми.", true);
      form.elements.namedItem(errors[0]).focus(); return;
    }
    setBusy(true); setMessage("Зберігаємо…");
    try {
      const data = await api(`/api/admin/accounting/profit?${new URLSearchParams({ month })}`, { method: "PUT", body: JSON.stringify({ month, expected_revision: revision, inputs: values }) });
      accept(validateResponse(data, month)); setMessage("Збережено");
    } catch (error) {
      if (error.status === 409) conflicted = true;
      setMessage(error.status === 409 ? "Розрахунок змінили в іншому вікні. Оновіть дані перед збереженням." : error.status === 401 ? "Увійдіть знову. Незбережені суми залишилися тут." : "Не вдалося зберегти. Спробуйте ще раз.", true);
    } finally { setBusy(false); }
  });
  window?.addEventListener("beforeunload", event => {
    if (!hasChanges() && !busy) return;
    event.preventDefault(); event.returnValue = "";
  });
  applyInputs(savedInputs); setBusy(false);
  return { load, hasChanges, isDirty: hasChanges, isBusy: () => busy, canLeave, getMonth: () => month };
}
