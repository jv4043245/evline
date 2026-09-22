const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const decode = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const labels = { customer_name: "Ім'я", customer_phone: 'Телефон', car: 'Авто / модель / рік', vin: 'VIN', item_name: 'Запчастини / кількість / артикул' };
const states = { waiting: 'Очікує запиту', pending: 'Обробляється', applied: 'У CRM', review: 'Потрібна перевірка', error: 'Помилка розбору' };
const modes = { auto: 'Автозаповнення чернетки', review: 'Лише пропозиції', paused: 'На паузі' };
const errors = { ai_timeout: 'Час розбору вичерпано. Спробуйте повторити.', ai_unavailable: 'Workers AI не підключений.', analysis_failed: 'Розбір не завершився. Повідомлення збережено.', message_deleted: 'У Telegram видалено повідомлення. Перевірте дані заявки.' };
let chats = [], current = null, dirty = false;
const date = value => new Date(value).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
async function api(suffix = '', body) {
  const token = localStorage.getItem('evline_admin_token');
  const response = await fetch(`/api/admin/telegram-intake${suffix}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) $('[data-auth]').hidden = false;
  const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(result.error || 'Не вдалося виконати запит. Спробуйте ще раз.');
  $('[data-auth]').hidden = true;
  return result;
}
function report(error) { $('[data-error]').textContent = error.message; $('[data-error]').hidden = false; }
function discard() { return !dirty || confirm('Залишити незбережені зміни?'); }
function renderChats() {
  const query = $('[data-search]').value.toLocaleLowerCase();
  $('[data-chats]').innerHTML = chats.filter(c => `${c.display_name} ${c.username} ${c.order_number || ''}`.toLocaleLowerCase().includes(query)).map(c => `
    <button class="chat" type="button" data-chat="${esc(c.id)}" aria-current="${c.id === current?.chat.id}">
      <strong>${esc(c.display_name || c.username || 'Діалог')}</strong>
      <span class="badge badge--${esc(c.state)}">${esc(states[c.state] || c.state)}</span>
      <small>${esc(c.order_number || modes[c.mode])} · ${esc(date(c.updated_at))}</small>
    </button>`).join('') || '<p class="empty">Діалогів поки немає</p>';
}
async function refresh() {
  const data = await api();
  chats = data.chats;
  $('[data-connection-count]').textContent = data.connections.some(c => c.approved && c.enabled) ? '· увімкнено' : '· не активовано';
  $('[data-connections]').innerHTML = data.connections.map(c => `<div class="connection"><div><strong>${esc(c.display_name)} ${c.username ? `@${esc(c.username)}` : ''}</strong>
    <p>Telegram ID: ${esc(c.owner_id)} · ${!c.enabled ? 'Відключено в Telegram' : c.approved ? 'Активне' : 'Очікує активації'}</p></div>
    <button type="button" data-connection="${esc(c.id)}" data-owner="${esc(c.owner_id)}" data-action="${c.approved ? 'pause_connection' : 'approve_connection'}" ${!c.enabled ? 'disabled' : ''}>${c.approved ? 'Призупинити' : 'Активувати'}</button></div>`).join('') || '<p class="empty">Немає підключених акаунтів</p>';
  if (!data.ai_available) report(new Error('Workers AI не підключений. Автоматичний розбір недоступний.'));
  renderChats();
}
async function openChat(id) {
  current = await api(`?chat=${encodeURIComponent(id)}`);
  dirty = false;
  const { chat, messages, changes } = current;
  const proposal = decode(chat.proposal_json), fields = { ...decode(chat.snapshot_json), ...current.fields, ...proposal.fields };
  $('[data-detail]').innerHTML = `<div class="detail-head"><div><h2>${esc(chat.display_name || chat.username || 'Діалог')}</h2><p>${esc(modes[chat.mode])}</p></div>
    ${chat.order_number ? `<a class="button" href="/admin/?order=${encodeURIComponent(chat.order_id)}">${esc(chat.order_number)}</a>` : ''}</div>
    ${chat.error_code ? `<p class="notice error">${esc(errors[chat.error_code] || 'Потрібна перевірка')}</p>` : ''}
    ${proposal.new_request ? '<p class="notice">Можливе окреме замовлення. Поточне не змінено.</p>' : ''}
    ${current.order_protected ? '<p class="notice">Замовлення вже опрацьовується. Зміни доступні в його картці.</p>' : ''}
    ${chat.order_id && !chat.order_number ? '<p class="notice">Замовлення видалене. Автоматичне повторне створення вимкнене.</p>' : ''}
    <form data-fields><div class="fields">${Object.entries(labels).map(([key, label]) => `<label>${label}${key === 'item_name'
      ? `<textarea name="${key}" maxlength="900">${esc(fields[key])}</textarea>`
      : `<input name="${key}" value="${esc(fields[key])}" maxlength="${key === 'vin' ? 17 : key === 'customer_phone' ? 32 : key === 'car' ? 180 : 100}" ${key === 'customer_phone' ? 'type="tel"' : ''}>`}</label>`).join('')}</div>
      <div class="toolbar"><button class="primary" type="submit" ${chat.mode === 'paused' || current.order_protected ? 'disabled' : ''}>${chat.order_id ? 'Підтвердити зміни' : 'Створити заявку'}</button><button type="button" data-action="retry" ${chat.mode === 'paused' ? 'disabled' : ''}>Повторити розбір</button></div></form>
    ${Object.values(proposal.evidence || {}).length ? `<details class="history"><summary>Підстави запропонованих змін</summary>${Object.entries(proposal.evidence).map(([key, items]) => `<strong>${esc(labels[key])}</strong>${items.map(e => `<blockquote>#${esc(e.message_id)}: ${esc(e.quote)}</blockquote>`).join('')}`).join('')}</details>` : ''}
    <details class="history" open><summary>Переписка · ${messages.length}</summary><div class="transcript">${messages.map(m => `<article class="message message--${esc(m.role)}"><small>${m.role === 'manager' ? 'Менеджер' : 'Клієнт'} · ${esc(date(m.sent_at))} · #${m.message_id}</small>
      <p>${esc(m.deleted ? 'Повідомлення видалене' : m.body)}</p>${m.has_media && !m.deleted ? '<small>Медіа в Telegram · вміст не розпізнавався</small>' : ''}</article>`).join('')}</div></details>
    <details class="history"><summary>Історія змін · ${changes.length}</summary>${changes.map(c => {
      const before = decode(c.before_json), after = decode(c.after_json);
      return `<div class="change"><strong>${esc(c.actor)}</strong> · ${esc(date(c.created_at))}${c.undone ? ' · скасовано' : ''}<dl>${Object.keys(labels).filter(k => (before[k] || '') !== (after[k] || '')).map(k => `<dt>${labels[k]}</dt><dd>${esc(before[k] || '∅')} → ${esc(after[k] || '∅')}</dd>`).join('')}</dl><details><summary>Джерела</summary>${Object.values(decode(c.evidence_json)).flat().map(e => `<blockquote>#${esc(e.message_id)}: ${esc(e.quote)}</blockquote>`).join('')}</details></div>`;
    }).join('')}<div class="toolbar"><button type="button" data-action="undo" ${!changes.some(c => !c.undone) ? 'disabled' : ''}>Скасувати останню зміну</button></div></details>
    <details class="history"><summary>Керування діалогом</summary><div class="toolbar"><button type="button" data-action="${chat.mode === 'paused' ? 'review' : 'pause'}">${chat.mode === 'paused' ? 'Відновити з перевіркою' : 'Призупинити збір'}</button><button type="button" data-action="new_request">Новий запит з наступного повідомлення</button></div></details>`;
  renderChats();
}
document.addEventListener('input', e => { if (e.target.closest('[data-fields]')) dirty = true; });
window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });
$('[data-search]').addEventListener('input', renderChats);
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  $('[data-error]').hidden = true;
  b.disabled = true;
  try {
    if (b.hasAttribute('data-refresh')) { if (!discard()) return; await refresh(); if (current) await openChat(current.chat.id); }
    else if (b.dataset.chat) { if (discard()) await openChat(b.dataset.chat); }
    else if (b.hasAttribute('data-ai-test')) {
      $('[data-setup]').textContent = 'Перевірка AI на тестовому діалозі…';
      const result = await api('', { action: 'test_analysis' });
      $('[data-setup]').textContent = result.checks.map(c => `${c.name}: ${c.passed ? 'OK' : 'потрібна перевірка'}`).join(' · ');
    } else if (b.hasAttribute('data-check') || b.hasAttribute('data-prepare')) {
      if (b.hasAttribute('data-prepare')) await api('', { action: 'prepare_webhook' });
      const s = await api('?setup=1');
      $('[data-setup]').textContent = `@${s.username} · Secretary Mode: ${s.business_capable ? 'увімкнено' : 'вимкнено'} · Webhook: ${s.webhook_matches && s.business_updates_enabled ? 'готовий' : 'потребує налаштування'} · У черзі: ${s.pending_updates}`;
    } else if (b.dataset.action) {
      if (!discard()) return;
      const action = b.dataset.action;
      if (action === 'approve_connection' && !confirm(`Активувати обробку робочих діалогів акаунта Telegram ID ${b.dataset.owner}?\n\nПереконайтеся, що в Telegram обрані тільки робочі чати, а клієнти повідомлені про обробку листування.`)) return;
      if (action === 'new_request' && !confirm('Наступні повідомлення будуть окремою заявкою. Попереднє замовлення залишиться у CRM. Продовжити?')) return;
      if (action === 'undo' && !confirm('Скасувати останню зміну помічника? Подальші зміни перевірятиме менеджер.')) return;
      await api('', { action, id: b.dataset.connection || current.chat.id, owner_id: b.dataset.owner });
      await refresh();
      if (current) await openChat(current.chat.id);
    }
  } catch (error) { report(error); } finally { b.disabled = false; }
});
document.addEventListener('submit', async e => {
  if (!e.target.matches('[data-fields]')) return;
  e.preventDefault();
  const button = e.target.querySelector('[type="submit"]'); button.disabled = true;
  try {
    await api('', { action: 'apply', id: current.chat.id, generation: current.chat.generation, fields: Object.fromEntries(new FormData(e.target)) });
    dirty = false; await refresh(); await openChat(current.chat.id);
  } catch (error) { report(error); } finally { button.disabled = false; }
});
refresh().catch(report);
