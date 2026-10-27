import { escapeHtml as esc, money, dateLabel } from '../documents/model.js?v=20261027-invoices';
import { icon } from '../documents/icons.js';
import { adminApiError } from '../../assets/js/admin-api-errors.js';
import { refreshNumbering } from './numbering.js?v=20261027-numbering';

const $ = s => document.querySelector(s);
let page = 1, loading = false;
$('[data-new]').insertAdjacentHTML('afterbegin', icon('Plus'));
$('[data-reload]').innerHTML = icon('RefreshCw');
async function load() {
  if (loading) return;
  loading = true; $('[data-error]').hidden = true;
  document.querySelectorAll('.register-filters button,.register-pagination button').forEach(b => { b.disabled = true; });
  try {
    const params = new URLSearchParams(new FormData($('[data-filters]'))); params.set('page', page);
    const token = localStorage.getItem('evline_admin_token');
    const response = await fetch(`/api/admin/invoices?${params}`, { cache: 'no-store', headers: token ? { authorization: `Bearer ${token}` } : {} });
    if ([401,403].includes(response.status)) $('[data-auth]').hidden = false;
    if (!response.ok) throw new Error(await adminApiError(response));
    const result = await response.json();
    refreshNumbering();
    $('[data-results]').innerHTML = result.rows.length ? `<table class="invoice-register-table"><thead><tr><th>Рахунок / дата</th><th>Покупець</th><th>Продавець</th><th>Сума</th><th>Стан</th><th><span class="sr-only">Відкрити</span></th></tr></thead><tbody>${result.rows.map(r => {
      const url = `/admin/documents/?${r.workspace ? `invoice=${encodeURIComponent(r.workspace)}` : `order=${encodeURIComponent(r.order_id)}`}&version=${encodeURIComponent(r.id)}`;
      return `<tr><td data-label="Рахунок"><a href="${url}"><strong>${r.number ? `№ ${esc(r.number)}` : 'Без номера'}</strong></a><small>${esc(dateLabel(r.date))}${r.order_number ? ` · ${esc(r.order_number)}` : ''}</small></td><td data-label="Покупець">${esc(r.buyer)}${r.phone ? `<small>${esc(r.phone)}</small>` : ''}</td><td data-label="Продавець">${esc(r.seller)}</td><td data-label="Сума" class="register-amount">${r.amount_minor == null ? '' : `${money(r.amount_minor)} грн`}</td><td data-label="Стан"><span class="state-label${r.status === 'ready' ? ' ready' : ''}">${r.status === 'ready' ? 'Виставлено' : 'Чернетка'}</span></td><td class="register-open"><a class="button icon-button" href="${url}" title="Відкрити рахунок" aria-label="Відкрити рахунок ${esc(r.number || 'без номера')}">${icon('Pencil')}</a></td></tr>`;
    }).join('')}</tbody></table>` : '<p class="register-empty">Рахунків за цим запитом немає.</p>';
    $('[data-page]').textContent = `Сторінка ${page}`;
    $('[data-prev]').disabled = page <= 1; $('[data-next]').disabled = !result.has_more;
  } catch (err) { $('[data-error]').textContent = err.message; $('[data-error]').hidden = false; }
  finally { loading = false; document.querySelectorAll('.register-filters button').forEach(b => { b.disabled = false; }); }
}
$('[data-filters]').addEventListener('submit', e => { e.preventDefault(); if (!loading) { page = 1; load(); } });
$('[data-filters] select').addEventListener('change', () => { if (!loading) { page = 1; load(); } });
$('[data-reload]').addEventListener('click', load);
$('[data-prev]').addEventListener('click', () => { if (!loading && page > 1) { page--; load(); } });
$('[data-next]').addEventListener('click', () => { if (!loading) { page++; load(); } });
load();
