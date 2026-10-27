import { json } from '../../_lib/http.js';
import { ensureDocuments } from '../../_lib/order-documents.js';
import { allDocumentRows } from '../../_lib/invoice-numbering.js';
import { invoiceAmount } from '../../../admin/documents/model.js';

export async function onRequestGet({ env, request }) {
  const params = new URL(request.url).searchParams;
  const escaped = s => String(s || '').trim().slice(0, 100).replace(/[\\%_]/g, '\\$&');
  if (params.has('customers')) {
    const query = escaped(params.get('customers'));
    if (query.length < 2) return json({ customers: [] });
    const rows = (await env.DB.prepare(`SELECT id,name,phone,email,telegram_username AS telegram FROM customers
      WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8`)
      .bind(`%${query}%`, `%${query}%`).all()).results || [];
    return json({ customers: rows });
  }
  await ensureDocuments(env);
  const q = escaped(params.get('q')), status = ['draft','ready'].includes(params.get('status')) ? params.get('status') : '';
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.get('page'), 10) || 1));
  const rows = (await env.DB.prepare(`WITH documents AS (${allDocumentRows}), ranked AS (
    SELECT *,ROW_NUMBER() OVER (PARTITION BY scope,COALESCE(json_extract(data_json,'$.invoice.number'),''),
      REPLACE(COALESCE(json_extract(data_json,'$.seller.iban'),''),' ','') ORDER BY revision DESC) position
    FROM documents d WHERE json_extract(data_json,'$.invoice.enabled')=1
      AND ((status='draft' AND revision=(SELECT MAX(revision) FROM documents latest WHERE latest.scope=d.scope))
        OR (status='ready' AND output_mode IN ('invoice','all'))))
    SELECT r.*,o.order_number FROM ranked r LEFT JOIN orders o ON r.scope='order:'||o.id WHERE position=1
      AND (?='' OR r.status=?) AND (?='' OR json_extract(data_json,'$.invoice.number') LIKE ? ESCAPE '\\'
        OR json_extract(data_json,'$.buyer.name') LIKE ? ESCAPE '\\' OR json_extract(data_json,'$.buyer.phone') LIKE ? ESCAPE '\\'
        OR o.order_number LIKE ? ESCAPE '\\')
    ORDER BY r.created_at DESC,r.id DESC LIMIT 31 OFFSET ?`)
    .bind(status,status,q,...Array(4).fill(`%${q}%`),(page-1)*30).all()).results || [];
  return json({ page, has_more: rows.length > 30, rows: rows.slice(0,30).map(row => {
    const d = JSON.parse(row.data_json), standalone = row.scope.startsWith('invoice:');
    return { id: row.id, number: d.invoice.number, date: d.invoice.date, status: row.status, revision: row.revision,
      buyer: d.buyer.name, phone: d.buyer.phone, seller: d.seller.name, amount_minor: invoiceAmount(d),
      order_number: row.order_number || '', workspace: standalone ? row.scope.slice(8) : '', order_id: standalone ? '' : row.scope.slice(6) };
  }) });
}
