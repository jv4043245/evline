// Isolated browser QA: synthetic data, in-memory SQLite, no external API calls.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fromOrder, normalizeDocument } from '../admin/documents/model.js';
import { onRequest as middleware } from '../functions/api/admin/_middleware.js';
import * as orderDocuments from '../functions/api/admin/orders/[id]/documents.js';
import * as invoices from '../functions/api/admin/invoices/[id].js';
import { onRequestGet as register } from '../functions/api/admin/invoices.js';
import { onRequestPost as seller } from '../functions/api/admin/document-settings.js';
import * as orders from '../functions/api/admin/orders.js';
import { onRequestGet as orderDetail } from '../functions/api/admin/orders/[id].js';
import { onRequestGet as summary } from '../functions/api/admin/summary.js';
import * as numbering from '../functions/api/admin/invoice-numbering.js';

const root = path.resolve(import.meta.dirname, '..'), db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
for (const file of (await readdir(path.join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()) db.exec(await readFile(path.join(root, 'migrations', file), 'utf8'));
const env = { ADMIN_TOKEN: 'synthetic-admin', DB: { prepare(sql) {
  const s = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, _run() { return { meta: { changes: Number(s.run(...args).changes) } }; },
    async run() { return this._run(); }, async first() { return s.get(...args) || null; }, async all() { return { results: s.all(...args) }; },
  };
}, async batch(statements) { db.exec('BEGIN'); try { const results = statements.map(s => s._run()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } } };
const order = { id: 'test-invoice-order', order_number: 'O-TEST', type: 'parts', customer_name: 'Тестовий покупець', customer_phone: '+380000000001', car: 'BYD Yuan Plus 2023', vin: 'TESTVIN00000000001', item_name: 'Задній бампер', revenue_uah: 27420 };
const d = fromOrder(order), body = '3000010000000000000000000';
Object.assign(d.seller, { name: 'ФОП Тестовий Продавець', tax_id: '0000000000', address: 'Тестова адреса, Київ', iban: `UA${String(98 - Number(BigInt(body + '301000') % 97n)).padStart(2,'0')}${body}`, bank: 'Тестовий банк', phone: '+380000000002', email: 'test@example.invalid' });
d.tax = 'Без ПДВ'; d.seller_profile_id = 'primary'; d.invoice.number = ''; d.invoice.automatic = true;
d.items[0].sku = 'TEST-OEM-123';
db.prepare('INSERT INTO document_seller_settings(id,revision,updated_at,actor,data_json) VALUES(1,1,?,?,?)').run('2026-10-27', 'Тест', JSON.stringify(d.seller));
db.prepare('INSERT INTO customers(id,created_at,updated_at,name,phone,email) VALUES(?,?,?,?,?,?)').run('test-customer','2026-10-27','2026-10-27','Тестовий покупець','+380000000001','test@example.invalid');
db.prepare('INSERT INTO orders(id,created_at,updated_at,order_number,customer_name,customer_phone,car,vin,item_name,revenue_uah,type) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(order.id,'2026-10-27','2026-10-27',order.order_number,order.customer_name,order.customer_phone,order.car,order.vin,order.item_name,order.revenue_uah,order.type);
db.prepare('INSERT INTO order_documents(id,order_id,revision,created_at,actor,status,data_json,output_mode) VALUES(?,?,1,?,?,?, ?,?)').run('test-version',order.id,'2026-10-27T12:00:00Z','Тестовий менеджер','draft',JSON.stringify(normalizeDocument(d)),'invoice');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers(req.headers); headers.set('authorization', 'Bearer synthetic-admin');
      const request = new Request(url, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const standalone = /^\/api\/admin\/invoices\/([a-f0-9-]+)$/.exec(url.pathname), ordered = /^\/api\/admin\/orders\/([^/]+)\/documents$/.exec(url.pathname);
      const next = () => {
        if (url.pathname === '/api/admin/invoice-numbering') return numbering[req.method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request });
        const routes = standalone ? invoices : orderDocuments, id = (standalone || ordered)?.[1];
        if (id) return routes[req.method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env, request, params: { id } });
        if (url.pathname === '/api/admin/invoices') return register({ env, request });
        if (url.pathname === '/api/admin/document-settings') return seller({ env, request });
        if (url.pathname === '/api/admin/session') return Response.json({user:{id:'andrii',name:'Тестовий менеджер'}});
        if (url.pathname === '/api/admin/orders') return orders[req.method === 'GET' ? 'onRequestGet' : 'onRequestPost']({env,request});
        const detail = /^\/api\/admin\/orders\/([^/]+)$/.exec(url.pathname);
        if (detail && req.method === 'GET') return orderDetail({env,request,params:{id:detail[1]}});
        if (url.pathname === '/api/admin/summary') return summary({env,request});
        if (req.method === 'GET' && /^\/api\/admin\/(?:shipping|contact-events|supplier-requests|suppliers|supplier-documents|google-ads|bank-notifications)/.test(url.pathname)) return Response.json({});
        return Response.json({ error: 'Preview only: route unavailable' }, { status: 404 });
      };
      const response = await middleware({ env, request, next }); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname), ...(url.pathname.endsWith('/') ? ['index.html'] : []));
    if (!file.startsWith(root + path.sep)) throw new Error('outside root');
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' })[path.extname(file)] || 'application/octet-stream', 'cache-control':'no-store' }); res.end(content);
  } catch (e) { res.writeHead(500, { 'content-type':'application/json' }); res.end(JSON.stringify({ error:e.message })); }
});
server.listen(Number(process.env.PORT || 8796), '127.0.0.1', () => console.log(`Synthetic invoice preview: http://127.0.0.1:${server.address().port}/admin/invoices/`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
