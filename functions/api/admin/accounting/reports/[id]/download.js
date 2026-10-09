import { adminUser, unauthorized } from '../../../../../_lib/auth.js';
import { json } from '../../../../../_lib/http.js';
import { readAccountingReportDownload } from '../../../../../_lib/accounting-reports.js';

export async function onRequestGet({ request, env, params }) {
  if (!adminUser(request, env)) return unauthorized();
  if (new URL(request.url).search) return json({ error: 'invalid_report_parameters' }, { status: 400 });
  try {
    const { meta, bytes } = await readAccountingReportDownload(env.DB, params.id);
    return new Response(bytes, { headers: { 'content-type': meta.mime, 'content-length': String(bytes.length),
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none';",
      'content-disposition': `attachment; filename="report"; filename*=UTF-8''${encodeURIComponent(meta.filename)}` } });
  } catch (error) {
    const status = [400,404].includes(error.status) ? error.status : 503;
    return json({ error: status === 503 ? 'accounting_report_unavailable' : error.message }, { status });
  }
}
export function onRequestPost() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
