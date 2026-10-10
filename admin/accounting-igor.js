const MAX_MINOR = 100000000000;
const formatter = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const validMinor = value => Number.isSafeInteger(value) && value >= 0;
const nullableMinor = value => value === null || validMinor(value);
const moneyText = value => validMinor(value) ? formatter.format(value / 100) : "—";
const blankInputs = () => ({ fees_minor: null, fees_note: "" });

export function validIgorMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2020;
}

export function defaultIgorMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find(part => part.type === "year").value}-${parts.find(part => part.type === "month").value}`;
}

export function parseIgorAmount(value) {
  const normalized = String(value ?? "").trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!normalized) return null;
  if (normalized.length > 40 || !/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) throw new Error("invalid_amount");
  const [whole, fraction = ""] = normalized.split(/[.,]/);
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(MAX_MINOR)) throw new Error("invalid_amount");
  return Number(minor);
}

export function calculateIgorPreview(inputs = {}, advertising = {}) {
  const missing = [];
  if (!validMinor(inputs.fees_minor) || inputs.fees_minor > MAX_MINOR) missing.push("fees_minor");
  const note = String(inputs.fees_note || "").trim();
  if (note.length > 500 || (inputs.fees_minor > 0 && !note)) missing.push("fees_note");
  if (advertising.coverage !== "complete" || !validMinor(advertising.total_minor)) missing.push("advertising");
  if (missing.length) return { status: advertising.coverage === "not_configured" ? "not_configured" : "incomplete", reimbursement_minor: null, missing_keys: missing };
  const reimbursement = advertising.total_minor + inputs.fees_minor;
  if (!Number.isSafeInteger(reimbursement)) return { status: "incomplete", reimbursement_minor: null, missing_keys: ["calculation"] };
  return { status: "draft", reimbursement_minor: reimbursement, missing_keys: [] };
}

function inputText(value) {
  return validMinor(value) ? `${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")}` : "";
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const markup = `
  <div class="accounting-igor__heading">
    <div><h1>Розрахунок Ігоря</h1><p>Румунія · компенсація реклами 100%</p></div>
    <label class="accounting-igor__month">Місяць<input type="month" data-igor-month min="2020-01" required aria-label="Місяць розрахунку Ігоря"></label>
  </div>
  <form class="accounting-igor__panel" data-igor-form novalidate>
    <div class="accounting-igor__panel-heading"><h2>Витрати за місяць</h2><span class="accounting-igor__badge">Чернетка</span></div>
    <section class="accounting-igor__advertising" aria-label="Реклама румунської сторінки">
      <dl><div><dt>Google Ads</dt><dd data-igor-ad="google_minor">—</dd></div><div><dt>Facebook · Instagram</dt><dd data-igor-ad="meta_minor">—</dd></div></dl>
      <p class="accounting-igor__ad-status" data-igor-ad-status></p>
    </section>
    <div class="accounting-igor__inputs">
      <label class="accounting-igor__fees">Комісії та доплати, грн<input name="fees_minor" type="text" inputmode="decimal" autocomplete="off" placeholder="—" aria-describedby="igor-fees-help"></label>
      <label class="accounting-igor__note" data-igor-note-wrap hidden>Розшифровка<textarea name="fees_note" rows="2" maxlength="500" placeholder="Дата та призначення доплати"></textarea></label>
    </div>
    <p class="accounting-igor__hint" id="igor-fees-help">Банк, конвертація, податки — лише фактична частка Ігоря, ще не врахована в рекламі. Якщо доплат немає — 0.</p>
    <section class="accounting-igor__result" aria-label="Попередня сума компенсації">
      <dl><div><dt>До компенсації</dt><dd data-igor-result>—</dd></div></dl>
    </section>
    <div class="accounting-igor__footer"><p data-igor-message role="status" aria-live="polite"></p><button class="admin-btn admin-btn--primary" type="submit" data-igor-save disabled>Зберегти</button></div>
  </form>`;

export function createAccountingIgorView(container, api, { now = () => new Date(), confirmDiscard } = {}) {
  if (!container) return { load: async () => {}, hasChanges: () => false, isDirty: () => false, isBusy: () => false, canLeave: () => true, getMonth: () => defaultIgorMonth(now()) };
  container.classList.add("accounting-igor");
  container.innerHTML = markup;
  const document = container.ownerDocument, window = document.defaultView;
  const ask = confirmDiscard || (text => window.confirm(text));
  const form = container.querySelector("[data-igor-form]"), monthInput = container.querySelector("[data-igor-month]");
  const message = container.querySelector("[data-igor-message]"), saveButton = container.querySelector("[data-igor-save]");
  let month = defaultIgorMonth(now()), revision = 0, baseline = "", savedInputs = blankInputs();
  let advertising = {}, currentMonth = false, loaded = false, busy = false, conflicted = false, pending = null, sequence = 0;
  monthInput.value = month; monthInput.max = defaultIgorMonth(now());

  const raw = () => ({ fees_minor: form.elements.namedItem("fees_minor").value, fees_note: form.elements.namedItem("fees_note").value });
  const hasChanges = () => loaded && JSON.stringify(raw()) !== baseline;
  const setMessage = (text = "", error = false) => { message.textContent = text; message.dataset.state = error ? "error" : "normal"; };
  const setBusy = value => {
    busy = value; form.setAttribute("aria-busy", String(value)); monthInput.disabled = value;
    for (const element of [...form.elements]) element.disabled = value || !loaded;
    saveButton.disabled = value || !loaded || conflicted || !hasChanges();
  };
  const readInputs = () => {
    const values = blankInputs(), errors = [];
    try { values.fees_minor = parseIgorAmount(form.elements.namedItem("fees_minor").value); }
    catch { errors.push("fees_minor"); }
    values.fees_note = form.elements.namedItem("fees_note").value.trim();
    if (values.fees_note.length > 500 || (values.fees_minor > 0 && !values.fees_note)) errors.push("fees_note");
    return { values, errors };
  };
  const render = () => {
    const { values, errors } = readInputs();
    container.querySelector("[data-igor-note-wrap]").hidden = !(values.fees_minor > 0 || form.elements.namedItem("fees_note").value);
    form.elements.namedItem("fees_note").required = values.fees_minor > 0;
    const calculation = errors.length ? {} : calculateIgorPreview(values, advertising);
    container.querySelector("[data-igor-result]").textContent = moneyText(calculation.reimbursement_minor);
    for (const key of ["google_minor", "meta_minor"]) container.querySelector(`[data-igor-ad="${key}"]`).textContent = moneyText(advertising[key]);
    let coverageText = !loaded ? "" : advertising.coverage === "not_configured" ? "Кампанії ще не підключені" : advertising.coverage === "complete" ? "" : advertising.coverage === "partial" ? "Неповні дані за місяць" : "Немає даних за місяць";
    if (loaded && currentMonth && advertising.coverage !== "not_configured") {
      const throughText = validDate(advertising.through) ? ` · реклама по ${shortDate.format(new Date(`${advertising.through}T00:00:00Z`))}` : "";
      coverageText = `${coverageText || "Попередньо"}${throughText}`;
    }
    container.querySelector("[data-igor-ad-status]").textContent = coverageText;
    saveButton.disabled = busy || !loaded || conflicted || !hasChanges();
  };
  const applyInputs = inputs => {
    form.elements.namedItem("fees_minor").value = inputText(inputs.fees_minor);
    form.elements.namedItem("fees_note").value = inputs.fees_note;
    baseline = JSON.stringify(raw());
    for (const element of form.elements) element.removeAttribute("aria-invalid");
  };
  const validateResponse = (data, expectedMonth) => {
    if (!data || data.month !== expectedMonth || !validIgorMonth(data.month) || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
        data.currency !== "UAH" || data.timezone !== "Europe/Kyiv" || data.basis !== "advertising_reimbursement" ||
        !data.inputs || !nullableMinor(data.inputs.fees_minor) || data.inputs.fees_minor > MAX_MINOR ||
        typeof data.inputs.fees_note !== "string" || data.inputs.fees_note.length > 500 || (data.inputs.fees_minor > 0 && !data.inputs.fees_note.trim()) ||
        !data.advertising || !["complete", "partial", "missing", "not_configured"].includes(data.advertising.coverage) ||
        ["google_minor", "meta_minor", "total_minor"].some(key => !nullableMinor(data.advertising[key])) ||
        (data.advertising.through !== null && !validDate(data.advertising.through)) ||
        (data.advertising.coverage === "complete" && (!["google_minor", "meta_minor", "total_minor"].every(key => validMinor(data.advertising[key])) || data.advertising.google_minor + data.advertising.meta_minor !== data.advertising.total_minor)) ||
        (data.advertising.coverage !== "complete" && data.advertising.total_minor !== null) ||
        (data.advertising.coverage === "not_configured" && ["google_minor", "meta_minor"].some(key => data.advertising[key] !== null)) ||
        !Array.isArray(data.campaigns)) throw new Error("invalid_igor_response");
    const expected = calculateIgorPreview(data.inputs, data.advertising);
    if (!data.calculation || data.calculation.status !== expected.status || data.calculation.reimbursement_minor !== expected.reimbursement_minor) throw new Error("invalid_igor_calculation");
    return data;
  };
  const accept = data => {
    month = data.month; revision = data.revision; savedInputs = { ...data.inputs }; advertising = { ...data.advertising };
    currentMonth = data.current_month === true || month === defaultIgorMonth(now()); loaded = true;
    monthInput.value = month; applyInputs(savedInputs); render();
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
    if (!validIgorMonth(requestedMonth) || requestedMonth > defaultIgorMonth(now())) { monthInput.value = month; setMessage("Оберіть коректний місяць.", true); return false; }
    const requestId = ++sequence;
    month = requestedMonth; monthInput.value = month; monthInput.max = defaultIgorMonth(now()); loaded = false; conflicted = false; advertising = {}; savedInputs = blankInputs();
    applyInputs(savedInputs); render(); setBusy(true); setMessage("Завантаження…");
    const task = Promise.resolve().then(() => api(`/api/admin/accounting/igor?${new URLSearchParams({ month: requestedMonth })}`)).then(data => {
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
      setMessage(errors.includes("fees_note") ? "Додайте розшифровку доплат (до 500 знаків)." : "Перевірте суму: гривні, не більше двох знаків після коми.", true);
      form.elements.namedItem(errors[0]).focus(); return;
    }
    setBusy(true); setMessage("Зберігаємо…");
    try {
      const data = await api(`/api/admin/accounting/igor?${new URLSearchParams({ month })}`, { method: "PUT", body: JSON.stringify({ month, expected_revision: revision, inputs: values }) });
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
