import { icon } from '../documents/icons.js';
import { adminApiError } from '../../assets/js/admin-api-errors.js';

const $ = s => document.querySelector(s), form = $('[data-numbering-form]');
let state, busy = false, pending;
$('[data-numbering-toggle]').innerHTML = icon('Pencil');
$('[data-numbering-save]').insertAdjacentHTML('afterbegin', icon('Save'));
const showError = message => { $('[data-numbering-error]').textContent = message; $('[data-numbering-error]').hidden = !message; };
function lock(value) {
  busy = value;
  document.querySelectorAll('[data-numbering-toggle],#numbering-form button,#numbering-form input').forEach(e => { e.disabled = value; });
}
async function api(payload) {
  const token = localStorage.getItem('evline_admin_token');
  const response = await fetch('/api/admin/invoice-numbering', { cache: 'no-store',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) },
    ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}) });
  if (!response.ok) { const error = new Error(await adminApiError(response)); error.status = response.status; throw error; }
  return response.json();
}
function render(value, preserveInput = false) {
  state = value;
  $('[data-numbering-summary]').textContent = `Наступний рахунок № ${state.next_number}`;
  const input = form.elements.next_number;
  input.min = String(state.next_number + 1); input.max = String(state.max_number);
  if (!preserveInput) input.value = '';
  const last = state.last_change, history = $('[data-numbering-history]');
  history.hidden = !last;
  history.textContent = last ? `${new Date(last.created_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })} · ${last.actor} · № ${last.previous_number} → № ${last.next_number}` : '';
}
export async function refreshNumbering() {
  if (busy || !form.hidden) return;
  lock(true); showError('');
  try { render(await api()); } catch (err) { showError(err.message); }
  finally { lock(false); }
}
$('[data-numbering-toggle]').addEventListener('click', async () => {
  if (busy) return;
  if (!form.hidden) { close(); return; }
  lock(true); showError(''); $('[data-numbering-result]').hidden = true;
  try {
    render(await api()); form.hidden = false; pending = null;
    $('[data-numbering-toggle]').setAttribute('aria-expanded', 'true');
  } catch (err) { showError(err.message); }
  finally { lock(false); if (!form.hidden) form.elements.next_number.focus(); }
});
function close() {
  form.hidden = true; pending = null; showError('');
  $('[data-numbering-toggle]').setAttribute('aria-expanded', 'false');
  $('[data-numbering-toggle]').focus();
}
$('[data-numbering-cancel]').addEventListener('click', close);
form.addEventListener('submit', event => {
  event.preventDefault(); if (busy || !state) return;
  const next = form.elements.next_number.valueAsNumber;
  if (!Number.isInteger(next) || next <= state.next_number || next > state.max_number) { showError('Вкажіть цілий номер, більший за поточний наступний номер.'); return; }
  if (!pending || pending.next_number !== next || pending.expected_next_number !== state.next_number) {
    pending = { request_id: crypto.randomUUID(), expected_next_number: state.next_number, next_number: next };
  }
  $('[data-numbering-confirm-text]').textContent = `Продовжити з рахунку № ${next}? Номери ${state.next_number}–${next - 1} більше не видаватимуться. Повернути нумерацію назад не можна.`;
  $('[data-numbering-confirm]').showModal();
});
$('[data-numbering-dismiss]').addEventListener('click', () => $('[data-numbering-confirm]').close());
$('[data-numbering-accept]').addEventListener('click', async () => {
  if (busy || !pending) return;
  $('[data-numbering-confirm]').close();
  lock(true); showError('');
  try {
    render(await api(pending)); close();
    $('[data-numbering-result]').textContent = `Збережено. Наступний рахунок № ${state.next_number}.`;
    $('[data-numbering-result]').hidden = false;
  } catch (err) {
    if (err.status === 409) {
      pending = null;
      try { render(await api(), true); } catch { /* Keep the entered number visible on connection failure. */ }
    }
    showError(err.message);
  } finally { lock(false); if (form.hidden) $('[data-numbering-toggle]').focus(); }
});
