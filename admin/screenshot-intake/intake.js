const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const labels = { customer_name: "Ім'я клієнта", customer_phone: "Телефон клієнта", car: "Авто / модель / рік", vin: "VIN", item_name: "Запчастини / кількість / артикул", request_text: "Деталі запиту" };
const limits = { customer_name: 160, customer_phone: 48, car: 240, vin: 17, item_name: 2000, request_text: 4000 };
const statuses = { collecting: "Збір матеріалів", ready: "На перевірці", applied: "Внесено до CRM", canceled: "Скасовано", expired: "Термін минув" };
const channels = { viber: "Viber", whatsapp: "WhatsApp", telegram: "Telegram", instagram: "Instagram", facebook: "Facebook", phone: "Телефон", email: "Email", other: "Інший канал", unknown: "Не визначено" };
const managerStatuses = { pending: "Очікує підтвердження", approved: "Доступ активний", paused: "Доступ призупинено" };
let drafts = [], managers = [], current = null, targets = [], dirty = false, busy = false, aiAvailable = false;
let overviewVersion = 0, detailVersion = 0, lookupVersion = 0, sessionVersion = 0, disposed = false, confirmation = null;
const channelLabel = value => channels[String(value || "").toLowerCase()] || "Інший канал";
const date = value => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }); };
const editable = () => current && ["collecting", "ready"].includes(current.draft.status);
const token = () => { try { return localStorage.getItem("evline_admin_token") || ""; } catch { return ""; } };
const silentError = () => Object.assign(new Error("Запит більше не актуальний"), { silent: true });

function clearPrivate() {
  sessionVersion++; overviewVersion++; detailVersion++; lookupVersion++;
  drafts = []; managers = []; current = null; targets = []; confirmation = null; dirty = false;
  $("[data-private]").hidden = true;
  $("[data-drafts]").replaceChildren(); $("[data-managers]").replaceChildren(); $("[data-detail]").replaceChildren();
  $("[data-setup]").textContent = "";
  $("[data-ai-test-result]").textContent = "";
  $("[data-bot-link]").hidden = true; $("[data-bot-link]").removeAttribute("href");
  $("[data-status]").hidden = true;
}

async function api(suffix = "", body) {
  const auth = token(), session = sessionVersion;
  if (!auth) { clearPrivate(); $("[data-auth]").hidden = false; throw silentError(); }
  const response = await fetch(`/api/admin/screenshot-intake${suffix}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (disposed || session !== sessionVersion) throw silentError();
  if (auth !== token()) { clearPrivate(); $("[data-auth]").hidden = false; throw silentError(); }
  const result = await response.json().catch(() => ({}));
  if (disposed || session !== sessionVersion) throw silentError();
  if (auth !== token()) { clearPrivate(); $("[data-auth]").hidden = false; throw silentError(); }
  if (response.status === 401 || response.status === 403) {
    clearPrivate(); $("[data-auth]").hidden = false;
    throw Object.assign(new Error("Немає доступу до цього розділу. Увійдіть до адмінки з чинним токеном."), { status: response.status });
  }
  if (!response.ok) throw Object.assign(new Error(response.status === 409
    ? "Чернетка або замовлення вже змінилися. Оновіть дані та перевірте їх знову. Незбережений текст залишено у формі."
    : response.status >= 500 ? "Сервіс тимчасово недоступний. Спробуйте ще раз."
      : String(result.error || "Не вдалося виконати запит.").slice(0, 500)), { status: response.status });
  $("[data-auth]").hidden = true;
  return result;
}

function report(error) {
  if (error?.silent || disposed) return;
  $("[data-error]").textContent = error.message || "Не вдалося виконати запит.";
  $("[data-error]").hidden = false;
}
function notice(message) { $("[data-status]").textContent = message; $("[data-status]").hidden = !message; }
function discard() { return !dirty || window.confirm("Залишити незбережені зміни чернетки?"); }
function hideConfirmation() { confirmation = null; const panel = $("[data-confirm-panel]"); if (panel) { panel.hidden = true; panel.replaceChildren(); } }
function readFields() {
  const form = $("[data-fields]");
  return Object.fromEntries(Object.keys(labels).map(key => [key, String(form?.elements.namedItem(key)?.value || "").trim()]));
}
function fieldIssues(fields, required = false) {
  const issues = [];
  if (required && !fields.item_name) issues.push("Для нової заявки вкажіть запчастину або перелік запчастин.");
  if (required && !fields.customer_phone) issues.push("Для нової заявки обов'язковий телефон клієнта.");
  if (fields.customer_phone && !/^\+?[\d\s().-]+$/.test(fields.customer_phone)) issues.push("Телефон містить неприпустимі символи.");
  if (fields.customer_phone && !/^\d{7,15}$/.test(fields.customer_phone.replace(/\D/g, ""))) issues.push("Перевірте телефон: потрібно від 7 до 15 цифр.");
  if (fields.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(fields.vin)) issues.push("VIN має містити рівно 17 латинських літер і цифр, без I, O, Q.");
  for (const [key, limit] of Object.entries(limits)) if (String(fields[key] || "").length > limit) issues.push(`${labels[key]}: не більше ${limit} символів.`);
  return issues;
}
function updateValidation() {
  const root = $("[data-validation]");
  if (!root || !current) return;
  const issues = fieldIssues(readFields(), true);
  root.hidden = !issues.length;
  root.innerHTML = issues.length ? `<strong>Перед створенням заявки</strong><ul>${issues.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
  const status = $("[data-saved-state]");
  if (status) { status.textContent = dirty ? "Є незбережені зміни. Збережіть перевірені поля перед внесенням у CRM." : "Показані збережені поля чернетки."; status.classList.toggle("is-dirty", dirty); }
}
function setDisabled() {
  for (const control of document.querySelectorAll("button, input, textarea, select")) {
    control.disabled = busy || control.dataset.unavailable === "true";
    if (control.closest("[data-fields], [data-draft-actions]")) control.disabled ||= !editable();
  }
  const analyze = $("[data-analyze]"); if (analyze) analyze.disabled ||= !aiAvailable || dirty;
  const save = $("[data-save]"); if (save && current?.draft.blocking) save.disabled ||= !dirty || !$("[data-reviewed]")?.checked;
  for (const button of document.querySelectorAll("[data-review-create], [data-review-append]")) button.disabled ||= dirty || !!current?.draft.blocking || current?.draft.status !== "ready";
  const finalButton = $("[data-confirm-final]");
  if (finalButton) finalButton.disabled ||= !!$("[data-allow-duplicate]") && !$("[data-allow-duplicate]").checked;
  $("[data-detail]").setAttribute("aria-busy", String(busy));
}
function renderDrafts() {
  const query = $("[data-search]").value.trim().toLocaleLowerCase();
  $("[data-drafts]").innerHTML = drafts.filter(d => `${d.fields?.customer_name || ""} ${d.fields?.car || ""} ${d.fields?.item_name || ""} ${d.order_number || ""} ${channelLabel(d.channel)}`.toLocaleLowerCase().includes(query)).map(d => `
    <button class="chat" type="button" role="listitem" data-draft="${esc(d.id)}" aria-current="${d.id === current?.draft.id}">
      <strong>${esc(d.fields?.car || d.fields?.customer_name || "Нова чернетка")}</strong>
      <span class="badge badge--${Object.hasOwn(statuses, d.status) ? d.status : "collecting"}">${esc(statuses[d.status] || "Невідомий стан")}</span>
      <small>${esc(channelLabel(d.channel))} · ${esc(date(d.updated_at))}</small>
      <small>${esc(d.order_number || d.fields?.item_name || "Запчастини ще не вказані")}</small>
    </button>`).join("") || '<p class="empty">Чернеток не знайдено. Почніть із /intake у приватному чаті з ботом.</p>';
  setDisabled();
}
function renderManagers() {
  $("[data-manager-count]").textContent = `· активних: ${managers.filter(m => m.status === "approved").length}`;
  $("[data-managers]").innerHTML = managers.map((m, index) => {
    const allowed = String(m.username || "").replace(/^@/, "").toLowerCase() === "evline_support";
    const mayPause = m.status === "approved", numericId = /^\d+$/.test(String(m.telegram_id));
    return `<div class="connection"><div><strong>${esc(m.display_name || "Менеджер")} ${m.username ? `@${esc(String(m.username).replace(/^@/, ""))}` : "(без username)"}</strong>
      <p>Telegram ID: <strong>${esc(m.telegram_id)}</strong> · ${esc(managerStatuses[m.status] || "Невідомий стан")}</p>
      ${!allowed && !mayPause ? '<small class="muted">Початкова активація дозволена лише для @evline_support.</small>' : ""}</div>
      <button type="button" data-manager="${index}" data-unavailable="${!numericId || (!allowed && !mayPause)}">${mayPause ? "Призупинити" : "Активувати"}</button></div>`;
  }).join("") || '<p class="empty">Очікуємо /intake від @evline_support. Числовий Telegram ID з’явиться після самореєстрації.</p>';
  setDisabled();
}
async function loadOverview() {
  const version = ++overviewVersion;
  try {
    const data = await api();
    if (version !== overviewVersion || disposed) return;
    drafts = Array.isArray(data.drafts) ? data.drafts : []; managers = Array.isArray(data.managers) ? data.managers : [];
    aiAvailable = data.ai_available === true;
    $("[data-private]").hidden = false; $("[data-ai-warning]").hidden = aiAvailable;
    renderManagers(); renderDrafts();
  } catch (error) { if (version === overviewVersion) report(error); }
}
function sourceHtml(source) {
  const kind = ["photo", "image", "document", "screenshot"].includes(source.kind) ? "Зображення" : "Текст";
  return `<article class="message"><small class="source-meta">${kind} · #${esc(source.message_id ?? "—")} · ${esc(date(source.created_at))}</small>
    ${source.text ? `<p class="source-text">${esc(source.text)}</p>` : ""}
    ${source.extracted_text ? `<p class="source-text"><strong>Розпізнаний текст (перевірте):</strong>\n${esc(source.extracted_text)}</p>` : ""}
    ${kind === "Зображення" ? '<small>Оригінал — у приватному чаті з ботом.</small>' : ""}</article>`;
}
function renderDetail() {
  const { draft, duplicates } = current, fields = draft.fields || {}, warnings = Array.isArray(draft.warnings) ? draft.warnings : [];
  targets = Array.isArray(duplicates) ? duplicates.slice() : [];
  const evidence = draft.evidence && typeof draft.evidence === "object" ? draft.evidence : {};
  $("[data-detail]").innerHTML = `<div class="detail-head"><div><h2>${esc(fields.car || "Чернетка заявки")}</h2><p><strong>${esc(channelLabel(draft.channel))}</strong> · ${esc(statuses[draft.status] || "Невідомий стан")} · версія ${esc(draft.revision)}</p></div>
    ${draft.order_id ? `<a class="button" href="/admin/?order=${encodeURIComponent(draft.order_id)}">${esc(draft.order_number || "Відкрити замовлення")}</a>` : ""}</div>
    <p class="muted">Джерело заявки — ${esc(channelLabel(draft.channel))}. Пересилання через бота не означає Google-рекламу та не змінює справжній канал клієнта.</p>
    ${!editable() ? '<p class="notice">Цю чернетку вже закрито або строк її зберігання минув. Повторне внесення недоступне.</p>' : ""}
    ${warnings.length ? `<div class="notice"><strong>Потрібна перевірка</strong><ul>${warnings.map(w => `<li>${esc(typeof w === "string" ? w : w.message || w.code || "Перевірте вихідні матеріали")}</li>`).join("")}</ul></div>` : ""}
    ${draft.blocking ? '<p class="notice error">Розбір виявив суперечливі дані або кількох клієнтів. Виправте поля лише для одного клієнта, звірте їх з матеріалами та підтвердьте перевірку перед збереженням.</p>' : ""}
    <form data-fields novalidate><div class="fields">${Object.entries(labels).map(([key, label]) => `<label class="${["item_name", "request_text"].includes(key) ? "wide" : ""}">${label}${["item_name", "request_text"].includes(key)
      ? `<textarea name="${key}" maxlength="${limits[key]}" rows="${key === "item_name" ? 3 : 4}">${esc(fields[key])}</textarea>`
      : `<input name="${key}" value="${esc(fields[key])}" maxlength="${limits[key]}" ${key === "customer_phone" ? 'type="tel" autocomplete="off"' : 'autocomplete="off"'} ${key === "vin" ? 'autocapitalize="characters" spellcheck="false"' : ""}>`}${key === "customer_phone" ? '<small>Обов’язковий для створення нової заявки.</small>' : key === "vin" ? '<small>Необов’язковий; якщо є — рівно 17 символів.</small>' : ""}</label>`).join("")}</div>
      ${draft.blocking ? '<label class="checkbox-label notice"><input type="checkbox" data-reviewed>Я виправив дані та звірив усі поля з матеріалами одного клієнта.</label>' : ""}
      <p data-saved-state class="saved-state" role="status"></p>
      <div data-validation class="validation" role="status" hidden></div>
      <div class="toolbar"><button class="primary" type="submit" data-save>Зберегти перевірені поля</button><button type="button" data-analyze>Розібрати матеріали AI</button></div>
    </form>
    <div data-draft-actions>
      <section class="actions-panel"><h3>Внести до CRM</h3>
        <p>Спочатку збережіть перевірені поля. Створення нової заявки або доповнення наявної потребує окремого підтвердження.</p>
        ${targets.length ? `<p class="notice" data-duplicate-warning>Знайдено схожих замовлень: ${targets.length}. Перевірте їх перед створенням ще однієї заявки.</p>` : '<p class="muted">Автоматично знайдених збігів немає. Це не гарантія відсутності дубля.</p>'}
        <button type="button" data-review-create>Перевірити створення нової заявки</button>
        <h3>Або доповнити наявне замовлення</h3>
        <p class="muted">Додасться лише текстовий підсумок до нотаток менеджера. Дані клієнта, запчастини, фінанси й етап замовлення не перезаписуються.</p>
        <label>Схожі замовлення<select data-target aria-label="Замовлення для доповнення"><option value="">Оберіть замовлення</option>${targets.map((target, index) => `<option value="${index}">${esc(target.order_number || target.id)} · ${esc(target.car || "Авто не вказане")} · ${esc(target.item_name || "")}</option>`).join("")}</select></label>
        <div class="lookup"><label>Або знайдіть за номером<input data-order-number placeholder="O-000123" autocomplete="off" maxlength="30"></label><button type="button" data-order-lookup>Знайти</button></div>
        <div data-target-summary class="target-summary" hidden></div>
        <div class="toolbar"><button type="button" data-review-append>Перевірити доповнення замовлення</button></div>
        <section data-confirm-panel class="confirm-panel" aria-label="Остаточне підтвердження" hidden></section>
        <div class="toolbar"><button class="danger" type="button" data-cancel>Скасувати чернетку</button></div>
      </section>
    </div>
    <details class="history"><summary>Підстави розбору</summary>${Object.entries(evidence).filter(([key]) => Object.hasOwn(labels, key)).map(([key, items]) => `<strong class="evidence-label">${labels[key]}</strong>${(Array.isArray(items) ? items : [items]).map(item => `<blockquote>${esc(typeof item === "string" ? item : `#${item?.message_id ?? item?.source_id ?? "—"}: ${item?.quote || item?.text || ""}`)}</blockquote>`).join("")}`).join("") || '<p class="muted">Структуровані підстави ще не додані. Звірте поля з матеріалами.</p>'}</details>
    <details class="history" open><summary>Вихідні матеріали · ${draft.sources?.length || 0}</summary><div class="transcript">${(Array.isArray(draft.sources) ? draft.sources : []).map(sourceHtml).join("") || '<p class="empty">Матеріалів немає або строк зберігання минув.</p>'}</div></details>`;
  updateValidation(); setDisabled(); renderDrafts();
}
async function openDraft(id, checkDirty = true) {
  if (busy || (checkDirty && !discard())) return;
  const version = ++detailVersion; lookupVersion++; dirty = false; current = null; targets = []; confirmation = null;
  $("[data-detail]").innerHTML = '<p class="empty" role="status">Завантаження чернетки…</p>';
  try {
    const data = await api(`?id=${encodeURIComponent(id)}`);
    if (version !== detailVersion || disposed) return;
    if (!data.draft || data.draft.id !== id) throw new Error("Чернетку не знайдено.");
    current = { draft: data.draft, duplicates: Array.isArray(data.duplicates) ? data.duplicates : [] };
    renderDetail();
    const url = new URL(window.location.href); url.searchParams.set("draft", id); window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    if (version !== detailVersion || disposed) return;
    $("[data-detail]").innerHTML = '<p class="empty">Чернетку не завантажено. Оберіть її ще раз або оновіть сторінку.</p>';
    report(error);
  }
}
function selectedTarget() { const value = $("[data-target]")?.value; return value !== "" && value !== undefined ? targets[Number(value)] : null; }
function showTarget() {
  hideConfirmation();
  const target = selectedTarget(), root = $("[data-target-summary]");
  root.hidden = !target;
  root.innerHTML = target ? `<strong>Буде доповнено: ${esc(target.order_number || target.id)}</strong><p>${esc(target.car || "Авто не вказане")}</p><p>${esc(target.item_name || "Запчастини не вказані")}</p><small>Оновлено: ${esc(date(target.updated_at))}</small><p><a href="/admin/?order=${encodeURIComponent(target.id)}" target="_blank" rel="noopener">Відкрити картку для перевірки</a></p>` : "";
}
function review(mode) {
  if (!editable() || dirty || current.draft.blocking || current.draft.status !== "ready") throw new Error("Спочатку збережіть перевірені поля чернетки.");
  const fields = current.draft.fields || {}, issues = fieldIssues(fields, mode === "create");
  if (issues.length) throw new Error(issues.join(" "));
  const target = mode === "append" ? selectedTarget() : null;
  if (mode === "append" && (!target?.id || !target?.updated_at)) throw new Error("Оберіть і перевірте замовлення, яке потрібно доповнити.");
  confirmation = { mode, id: current.draft.id, revision: current.draft.revision, target: target ? { ...target } : null };
  const panel = $("[data-confirm-panel]"); panel.hidden = false;
  panel.innerHTML = `<h3>${mode === "create" ? "Створити нову заявку на запчастини?" : `Доповнити ${esc(target.order_number || target.id)}?`}</h3>
    ${target ? `<p><strong>${esc(target.car || "Авто не вказане")}</strong> · ${esc(target.item_name || "Запчастини не вказані")}</p><p>Лише допис у нотатки менеджера. Етап, фінанси та чинні поля цього замовлення не зміняться.</p>` : ""}
    <p><strong>Канал клієнта: ${esc(channelLabel(current.draft.channel))}</strong></p>
    <dl>${Object.entries(labels).map(([key, label]) => `<dt>${label}</dt><dd>${esc(fields[key] || "Не вказано")}</dd>`).join("")}</dl>
    ${mode === "create" && current.duplicates.length ? '<label class="checkbox-label notice"><input type="checkbox" data-allow-duplicate>Я перевірив схожі замовлення. Це окрема заявка; свідомо створюю нову попри можливий дубль.</label>' : ""}
    <div class="toolbar"><button class="primary" type="button" data-confirm-final>${mode === "create" ? "Підтвердити створення" : "Підтвердити доповнення"}</button><button type="button" data-confirm-back>Повернутися до перевірки</button></div>`;
  setDisabled();
}
async function mutate(task, message) {
  if (busy) return;
  busy = true; setDisabled();
  try { await task(); if (!disposed) notice(message); }
  catch (error) { hideConfirmation(); report(error); }
  finally { busy = false; if (!disposed) setDisabled(); }
}
async function reloadAfterWrite(id) {
  // Mutations are serialized. Refresh with the new revision before another write.
  dirty = false; current = null; confirmation = null;
  const version = ++detailVersion; lookupVersion++;
  const data = await api(`?id=${encodeURIComponent(id)}`);
  if (version !== detailVersion || disposed) throw silentError();
  if (!data.draft || data.draft.id !== id) throw new Error("Оновлену чернетку не знайдено.");
  current = { draft: data.draft, duplicates: Array.isArray(data.duplicates) ? data.duplicates : [] };
  renderDetail(); await loadOverview();
}
async function save() {
  if (!editable() || busy) return;
  if (current.draft.blocking && (!dirty || !$("[data-reviewed]")?.checked)) throw new Error("Виправте суперечливі поля та підтвердьте перевірку одного клієнта.");
  const fields = readFields(); fields.vin = fields.vin.toUpperCase();
  const issues = fieldIssues(fields); if (issues.length) throw new Error(issues.join(" "));
  const { id, revision } = current.draft;
  await mutate(async () => { await api("", { action: "save", id, revision, fields }); await reloadAfterWrite(id); }, "Перевірені поля збережено. Створення або доповнення CRM ще не виконано.");
}
async function confirmDraft() {
  if (!confirmation || busy) return;
  const expected = confirmation;
  if (!current || dirty || current.draft.id !== expected.id || current.draft.revision !== expected.revision) throw new Error("Дані змінилися. Перевірте підсумок ще раз.");
  const duplicateConsent = $("[data-allow-duplicate]");
  if (duplicateConsent && !duplicateConsent.checked) throw new Error("Окремо підтвердьте створення попри можливий дубль.");
  const payload = { action: "confirm", id: expected.id, revision: expected.revision, mode: expected.mode, allow_duplicate: expected.mode === "create" && !!duplicateConsent?.checked };
  if (expected.mode === "append") { payload.order_id = expected.target.id; payload.order_updated_at = expected.target.updated_at; }
  await mutate(async () => { await api("", payload); await reloadAfterWrite(expected.id); }, expected.mode === "create" ? "Заявку внесено до CRM." : "Підсумок додано до нотаток обраного замовлення.");
}

document.addEventListener("input", event => {
  if (event.target.closest("[data-fields]") && event.target.matches("input[name], textarea[name]")) {
    dirty = true; hideConfirmation(); if ($("[data-reviewed]")) $("[data-reviewed]").checked = false; updateValidation(); setDisabled();
  }
});
document.addEventListener("change", event => {
  if (event.target.matches("[data-target]")) { lookupVersion++; showTarget(); }
  if (event.target.matches("[data-reviewed], [data-allow-duplicate]")) setDisabled();
});
$("[data-search]").addEventListener("input", renderDrafts);
window.addEventListener("beforeunload", event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("pagehide", () => { disposed = true; sessionVersion++; detailVersion++; overviewVersion++; lookupVersion++; });
window.addEventListener("pageshow", event => { if (event.persisted) { disposed = false; busy = false; clearPrivate(); initialize().catch(report); } });
window.addEventListener("storage", event => { if (event.key === "evline_admin_token") { clearPrivate(); $("[data-auth]").hidden = false; } });
document.addEventListener("submit", event => {
  if (event.target.matches("[data-fields]")) { event.preventDefault(); $("[data-error]").hidden = true; save().catch(report); }
});
document.addEventListener("click", async event => {
  const button = event.target.closest("button"); if (!button || busy || button.disabled) return;
  $("[data-error]").hidden = true;
  try {
    if (button.hasAttribute("data-refresh")) {
      if (!discard()) return;
      const id = current?.draft.id || new URL(window.location.href).searchParams.get("draft");
      await Promise.all([loadOverview(), ...(id ? [openDraft(id, false)] : [])]);
    } else if (button.dataset.draft) await openDraft(button.dataset.draft);
    else if (button.hasAttribute("data-check-setup")) {
      const result = await api("?setup=1");
      $("[data-setup]").textContent = `${result.username ? `@${result.username}` : "Бот не визначений"} · Webhook: ${result.webhook_matches ? "готовий" : "потребує налаштування"}. Менеджер: @evline_support.`;
      const username = String(result.username || "").replace(/^@/, "");
      const link = $("[data-bot-link]"); link.hidden = !/^[A-Za-z0-9_]{5,32}$/.test(username);
      if (!link.hidden) link.href = `https://t.me/${encodeURIComponent(username)}?start=intake`;
      else link.removeAttribute("href");
    } else if (button.hasAttribute("data-test-analysis") || button.hasAttribute("data-test-vision")) {
      const vision = button.hasAttribute("data-test-vision");
      await mutate(async () => {
        $("[data-ai-test-result]").textContent = vision ? "Розпізнавання синтетичного скриншота — без створення заявки…" : "Перевірка на синтетичному тексті — без створення заявки…";
        const result = await api("", { action: "test_analysis", ...(vision ? { vision: true } : {}) });
        const checkLabels = { phone: "Телефон", parts: "Запчастини", car: "Авто" };
        $("[data-ai-test-result]").textContent = Object.entries(checkLabels).map(([key, label]) => `${label}: ${result.checks?.[key] === true ? "OK" : "потрібна перевірка"}`).join(" · ");
        if (result.result?.fields) {
          const fields = result.result.fields;
          $("[data-ai-test-result]").textContent += ` | Розпізнано: ${fields.car || "авто не визначено"}; ${fields.item_name || "деталі не визначено"}; ${fields.customer_phone || "телефон не визначено"}. ${result.result.blocking ? "Є неоднозначні дані — потрібна ручна перевірка." : "Блокуючих попереджень немає."}`;
        }
      }, `Тест AI завершено на синтетичному ${vision ? "скриншоті" : "тексті"}. Заявку до CRM не створено.`);
    } else if (button.hasAttribute("data-manager")) {
      const manager = managers[Number(button.dataset.manager)]; if (!manager) return;
      const status = manager.status === "approved" ? "paused" : "approved";
      if (status === "approved" && String(manager.username || "").replace(/^@/, "").toLowerCase() !== "evline_support") throw new Error("Початкова активація дозволена лише для @evline_support.");
      const username = manager.username ? `@${String(manager.username).replace(/^@/, "")}` : "без username";
      if (!window.confirm(`${status === "approved" ? "Активувати" : "Призупинити"} доступ менеджера?\n\n${manager.display_name || "Менеджер"}\nUsername: ${username}\nTelegram ID: ${manager.telegram_id}\n\nЗвірте саме цей числовий ID і username з менеджером. Ім'я саме по собі не підтверджує особу.`)) return;
      await mutate(async () => { await api("", { action: "manager_status", telegram_id: manager.telegram_id, status }); await loadOverview(); }, "Доступ менеджера оновлено.");
    } else if (button.hasAttribute("data-analyze")) {
      if (!editable() || dirty || !aiAvailable) return;
      const { id, revision } = current.draft;
      await mutate(async () => { await api("", { action: "analyze", id, revision }); await reloadAfterWrite(id); }, "Матеріали розібрано. Перевірте поля й попередження перед внесенням до CRM.");
    } else if (button.hasAttribute("data-order-lookup")) {
      const number = $("[data-order-number]").value.trim().toUpperCase();
      if (!/^O-\d{1,12}$/.test(number)) throw new Error("Вкажіть публічний номер замовлення, наприклад O-000123.");
      const version = ++lookupVersion, selectedDraft = current?.draft.id;
      let result;
      try { result = await api(`?order=${encodeURIComponent(number)}`); }
      catch (error) { if (version !== lookupVersion || selectedDraft !== current?.draft.id) return; throw error; }
      if (version !== lookupVersion || selectedDraft !== current?.draft.id) return;
      if (!result.order?.id || !result.order.updated_at) throw new Error("Замовлення не знайдено або його версія недоступна.");
      const existing = targets.findIndex(target => target.id === result.order.id);
      const index = existing < 0 ? targets.push(result.order) - 1 : existing;
      if (existing >= 0) targets[existing] = result.order;
      const select = $("[data-target]");
      let option = Array.from(select.options).find(item => item.value === String(index));
      if (!option) { option = document.createElement("option"); option.value = String(index); select.append(option); }
      option.textContent = `${result.order.order_number || number} · ${result.order.car || "Авто не вказане"} · ${result.order.item_name || ""}`;
      select.value = String(index); showTarget();
    } else if (button.hasAttribute("data-review-create")) review("create");
    else if (button.hasAttribute("data-review-append")) review("append");
    else if (button.hasAttribute("data-confirm-back")) hideConfirmation();
    else if (button.hasAttribute("data-confirm-final")) await confirmDraft();
    else if (button.hasAttribute("data-cancel")) {
      if (!editable() || !discard() || !window.confirm("Скасувати цю чернетку? Нове замовлення з неї створено не буде.")) return;
      const { id, revision } = current.draft;
      await mutate(async () => { await api("", { action: "cancel", id, revision }); await reloadAfterWrite(id); }, "Чернетку скасовано.");
    }
  } catch (error) { report(error); }
});

async function initialize() {
  if (!token()) { $("[data-auth]").hidden = false; return; }
  await loadOverview();
  const id = new URL(window.location.href).searchParams.get("draft");
  if (id && !$("[data-private]").hidden) await openDraft(id, false);
}
initialize().catch(report);
