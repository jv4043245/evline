import { adminApiError } from '../../assets/js/admin-api-errors.js';
import { openSupplierInvoice } from '../supplier-invoice.js?v=20261122-invoice-menu';

const auth = document.querySelector('[data-inv-auth]');

async function request(action, { data } = {}) {
  const token = localStorage.getItem('evline_admin_token');
  const response = await fetch('/api/admin/supplier-documents?' + new URLSearchParams({ action }), {
    cache: 'no-store',
    method: data ? 'POST' : 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'content-type': 'application/json' } : {})
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  auth.hidden = ![401, 403].includes(response.status);
  if (!response.ok) throw new Error(await adminApiError(response));
  return response.json();
}

function download(file, name) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

openSupplierInvoice({ host: document.querySelector('[data-inv-host]'), request, download });
