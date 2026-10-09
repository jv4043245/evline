import { adminUser, unauthorized } from '../../../_lib/auth.js';
import { json } from '../../../_lib/http.js';
import { archiveAccountingReport, listAccountingReports, readBoundedReportBody } from '../../../_lib/accounting-reports.js';

function errorResponse(error) {
  const status = [400,404,409,413].includes(error.status) ? error.status : 503;
  return json({ error: status === 503 ? 'accounting_report_unavailable' : error.message }, { status });
}
export async function onRequestGet({ request, env }) {
  if (!adminUser(request, env)) return unauthorized();
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => !['provider','from','to','cursor'].includes(key)) || ['provider','from','to','cursor'].some(key => params.getAll(key).length > 1)) return json({ error: 'invalid_report_parameters' }, { status: 400 });
  try { return json(await listAccountingReports(env.DB, Object.fromEntries(params))); } catch (error) { return errorResponse(error); }
}
export async function onRequestPost({ request, env, now }) {
  const user = adminUser(request, env); if (!user) return unauthorized();
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'invalid_report_origin' }, { status: 403 });
  if (new URL(request.url).search) return json({ error: 'invalid_report_parameters' }, { status: 400 });
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) return json({ error: 'invalid_report_body' }, { status: 400 });
  try {
    const body = await readBoundedReportBody(request);
    let form; try { form = await new Response(body, { headers: { 'content-type': contentType } }).formData(); } catch { return json({ error: 'invalid_report_body' }, { status: 400 }); }
    if ([...form.keys()].length !== 2 || form.getAll('file').length !== 1 || form.getAll('metadata').length !== 1) return json({ error: 'invalid_report_body' }, { status: 400 });
    const file = form.get('file'); const raw = form.get('metadata');
    if (!file || typeof file.arrayBuffer !== 'function' || typeof raw !== 'string' || raw.length > 4096) return json({ error: 'invalid_report_body' }, { status: 400 });
    let metadata; try { metadata = JSON.parse(raw); } catch { return json({ error: 'invalid_report_metadata' }, { status: 400 }); }
    const saved = await archiveAccountingReport(env.DB, { metadata, fileBytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mime: file.type }, user.id, { now: now || new Date() });
    return json({ file: saved });
  } catch (error) { return errorResponse(error); }
}
export function onRequestPut() { return json({ error: 'method_not_allowed' }, { status: 405 }); }
export const onRequestPatch = onRequestPut;
export const onRequestDelete = onRequestPut;
