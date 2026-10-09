// Deliberately independent of accounting.js: persistAdSpendSnapshot can compose
// these statements into its existing atomic batch without a circular import.
export const MAX_ACCOUNTING_REPORT_BYTES = 8 * 1024 * 1024;
export const ACCOUNTING_REPORT_CHUNK_BYTES = 256 * 1024;
const POLICIES = Object.freeze({
  google: Object.freeze({ account_id: '4028488894', scope: 'account', source_ref: '' }),
  meta: Object.freeze({ account_id: '1354524650161143', scope: 'campaign', source_ref: 'evline_campaign_120251518463770454' }),
});
const MIMES = Object.freeze({ csv: 'text/csv', json: 'application/json', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
const PUBLIC_FIELDS = 'id,provider,account_id,date_from,date_to,source_kind,filename,mime,bytes,sha256,source_fetched_at,created_at,scope,source_ref,run_id';
const PUBLIC_KEYS = PUBLIC_FIELDS.split(',');
const DAY_MS = 86400000;
const encoder = new TextEncoder();
function fail(code, status = 400) { throw Object.assign(new Error(code), { status }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function policy(provider) { const value = Object.hasOwn(POLICIES, provider || '') && POLICIES[provider]; if (!value) fail('invalid_report_provider'); return value; }
function hex(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function publicMeta(row) { return Object.fromEntries(PUBLIC_KEYS.map(key => [key, row[key]])); }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function period(from, to) { if (!date(from) || !date(to) || from > to || from < '2000-01-01' || to > '2100-12-31') fail('invalid_report_period'); }
function timestamp(value, nullable = false) {
  if (nullable && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_report_timestamp');
  return value;
}
async function digest(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function base64(bytes) {
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += 12288) pieces.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 12288))));
  return pieces.join('');
}
function unbase64(value) {
  if (typeof value !== 'string' || value.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('accounting_report_corrupt', 503);
  try { const raw = atob(value); const bytes = Uint8Array.from(raw, char => char.charCodeAt(0)); if (base64(bytes) !== value) fail('accounting_report_corrupt', 503); return bytes; }
  catch { fail('accounting_report_corrupt', 503); }
}
function scoped(row) {
  const expected = Object.hasOwn(POLICIES, row?.provider || '') && POLICIES[row.provider];
  return expected && row.account_id === expected.account_id && row.scope === expected.scope && row.source_ref === expected.source_ref;
}

/** Bound actual bytes, including a dishonest/missing Content-Length. */
export async function readBoundedReportBody(request, limit = MAX_ACCOUNTING_REPORT_BYTES + 65536) {
  const declared = request.headers?.get('content-length');
  if (declared !== null && declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) fail('report_too_large', 413);
  if (!request.body?.getReader) fail('invalid_report_body');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail('report_too_large', 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function filename(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180 || value !== value.trim() || /^[.]/.test(value) || /[\u0000-\u001f\u007f-\u009f/\\:"<>|?*\u202a-\u202e\u2066-\u2069]/.test(value)) fail('invalid_report_filename');
  const extension = value.split('.').at(-1).toLowerCase();
  if (!Object.hasOwn(MIMES, extension) || !value.includes('.')) fail('invalid_report_type');
  return extension;
}

function checkXlsx(bytes) {
  // Inspect ZIP central directory only: never extract/execute uploaded workbook
  // content. Bounds exclude encrypted archives, ZIP64, macros and zip bombs.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) fail('invalid_report_file');
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50 && index + 22 + view.getUint16(index + 20, true) === bytes.length) { end = index; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('invalid_report_file');
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true); let offset = view.getUint32(end + 16, true);
  if (count < 2 || count > 1000 || view.getUint16(end + 8, true) !== count || offset + centralSize !== end) fail('invalid_report_file');
  const names = new Set(); let inflated = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50 || (view.getUint16(offset + 8, true) & 1)) fail('invalid_report_file');
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    inflated += view.getUint32(offset + 24, true);
    if (inflated > 32 * 1024 * 1024 || offset + 46 + nameLength + extra + comment > end) fail('invalid_report_file');
    let name; try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { fail('invalid_report_file'); }
    if (names.has(name) || /(^\/|\\|(?:^|\/)\.\.(?:\/|$)|vbaProject|externalLinks)/i.test(name)) fail('invalid_report_file');
    names.add(name); offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) fail('invalid_report_file');
}

function checkTextSecrets(text, provider) {
  // Reject recognizable credentials and the known foreign campaign, rather
  // than silently redacting/changing an alleged original. Scope confirmation
  // remains an explicit human assertion; arbitrary documents are not certified.
  if (/(?:authorization\s*[:=]|bearer\s+[A-Za-z0-9._-]{12,}|["']?(?:access_token|refresh_token|appsecret_proof|client_secret|api_key|password)["']?\s*[:=])/i.test(text)) fail('invalid_report_sensitive_content');
  if (provider === 'meta' && /120252865188010454|(?:^|[\n\r,"'])\s*BB\s*\||Bolotov|Болотов/i.test(text)) fail('invalid_report_meta_scope');
}

function checkJson(value, provider) {
  const pending = [{ value, depth: 0 }]; let visited = 0;
  while (pending.length) {
    const item = pending.pop(); if (++visited > 200000 || item.depth > 50) fail('invalid_report_file');
    // JSON escapes must not hide a forbidden campaign or credentials in string
    // values/keys. Inspect decoded text as well as the original serialized file.
    if (typeof item.value === 'string') { checkTextSecrets(item.value, provider); continue; }
    if (!item.value || typeof item.value !== 'object') continue;
    for (const [key, child] of Object.entries(item.value)) {
      checkTextSecrets(key, provider);
      if (/^(?:authorization|access[_-]?token|refresh[_-]?token|token|appsecret[_-]?proof|client[_-]?secret|api[_-]?key|password|x[_-]admin[_-]token)$/i.test(key)) fail('invalid_report_sensitive_content');
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}

function validateFile(bytes, name, suppliedMime, provider) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail('invalid_report_file');
  if (bytes.length > MAX_ACCOUNTING_REPORT_BYTES) fail('report_too_large', 413);
  const extension = filename(name), mime = MIMES[extension];
  if (suppliedMime && ![mime, 'application/octet-stream', ...(['csv','json'].includes(extension) ? ['text/plain'] : [])].includes(suppliedMime.toLowerCase())) fail('invalid_report_mime');
  if (extension === 'xlsx') { checkXlsx(bytes); return mime; }
  if (extension === 'pdf') {
    if (!new TextDecoder().decode(bytes.subarray(0, 8)).startsWith('%PDF-') || !new TextDecoder().decode(bytes.subarray(-2048)).includes('%%EOF')) fail('invalid_report_file');
    return mime;
  }
  // Google native CSV exports may use UTF-16 with an explicit BOM. Decode only
  // for validation: archive bytes and SHA256 always remain byte-for-byte original.
  let encoding = 'utf-8';
  if (extension === 'csv' && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (extension === 'csv' && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text; try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { fail('invalid_report_file'); }
  if (/^\s*(?:<!doctype\s+html|<html|<script|<svg)/i.test(text) || /\u0000/.test(text)) fail('invalid_report_file');
  checkTextSecrets(text, provider);
  if (extension === 'json') { let parsed; try { parsed = JSON.parse(text); } catch { fail('invalid_report_file'); }
    if (!object(parsed) && !Array.isArray(parsed)) fail('invalid_report_file'); checkJson(parsed, provider); }
  else if (!/[,;\t]/.test(text) || !text.trim()) fail('invalid_report_file');
  return mime;
}

function manualMetadata(input) {
  const allowed = ['provider','date_from','date_to','source_kind','source_fetched_at','scope_confirmed'];
  if (!object(input) || Object.keys(input).some(key => !allowed.includes(key)) || input.scope_confirmed !== true || !['native_export','derived'].includes(input.source_kind)) fail('invalid_report_metadata');
  const expected = policy(input.provider); period(input.date_from, input.date_to);
  return { provider: input.provider, ...expected, date_from: input.date_from, date_to: input.date_to, source_kind: input.source_kind,
    source_fetched_at: timestamp(input.source_fetched_at, true), run_id: null };
}

async function buildStatements(db, metadata, bytes, name, mime, actorId, now) {
  if (typeof actorId !== 'string' || !actorId || actorId.length > 200) fail('invalid_report_actor');
  const sha256 = await digest(bytes);
  const id = await digest(encoder.encode(JSON.stringify([metadata.provider, metadata.account_id, metadata.scope, metadata.source_ref,
    metadata.date_from, metadata.date_to, metadata.source_kind, metadata.run_id, sha256])));
  const meta = { id, ...metadata, filename: name, mime, bytes: bytes.length, sha256, created_at: new Date(now).toISOString() };
  const chunkCount = Math.ceil(bytes.length / ACCOUNTING_REPORT_CHUNK_BYTES);
  const statements = [db.prepare(`INSERT INTO accounting_reports (${PUBLIC_FIELDS},created_by,chunk_count)
    VALUES (${Array(PUBLIC_KEYS.length + 2).fill('?').join(',')}) ON CONFLICT(id) DO NOTHING`)
    .bind(...PUBLIC_KEYS.map(key => meta[key]), actorId, chunkCount)];
  for (let index = 0; index < chunkCount; index++) statements.push(db.prepare(`INSERT INTO accounting_report_chunks(report_id,chunk_index,data_base64)
    VALUES (?,?,?) ON CONFLICT(report_id,chunk_index) DO NOTHING`).bind(id, index,
      base64(bytes.subarray(index * ACCOUNTING_REPORT_CHUNK_BYTES, (index + 1) * ACCOUNTING_REPORT_CHUNK_BYTES))));
  return { statements, meta: publicMeta(meta) };
}

export async function archiveAccountingReport(db, { metadata, fileBytes, filename: name, mime: suppliedMime }, actorId, { now = new Date() } = {}) {
  const normalized = manualMetadata(metadata);
  const mime = validateFile(fileBytes, name, suppliedMime, normalized.provider);
  const prepared = await buildStatements(db, normalized, fileBytes, name, mime, actorId, now);
  await db.batch(prepared.statements);
  const saved = await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM accounting_reports WHERE id=?`).bind(prepared.meta.id).all();
  const row = saved.results?.[0]; if (!row || !scoped(row)) fail('accounting_report_unavailable', 503);
  return publicMeta(row);
}

/** Sync archives ONLY this freshly constructed, allowlisted canonical object.
 * No original request body, Graph paging links, credentials, headers, env, or
 * unknown keys can leak into the archive. A sync payload is not a native export.
 */
export async function buildAccountingReportStatements(db, input, runId, { now = new Date() } = {}) {
  if (!object(input) || !hex(runId)) fail('invalid_report_snapshot');
  const expected = policy(input.provider);
  const sourceRef = input.source_ref ?? '';
  // Google's validated source_ref may identify a historical backfill. Preserve
  // that provenance inside the payload, while archive access scope stays fixed.
  if (typeof sourceRef !== 'string' || !/^[a-zA-Z0-9_.:-]{0,120}$/.test(sourceRef) ||
      input.account_id !== expected.account_id || input.scope !== expected.scope || (input.provider === 'meta' && sourceRef !== expected.source_ref) ||
      input.currency !== 'UAH' || input.timezone !== 'Europe/Kyiv' || !['complete','partial'].includes(input.coverage) ||
      !(input.provider === 'google' ? input.source === 'google_ads_script' : ['meta_insights','meta_ads_manager_csv'].includes(input.source))) fail('invalid_report_snapshot');
  period(input.from, input.to); timestamp(input.fetched_at);
  const count = Math.round((Date.parse(input.to) - Date.parse(input.from)) / DAY_MS) + 1;
  if (count > 366 || !Array.isArray(input.days) || input.days.length < 1 || input.days.length > count || (input.coverage === 'complete' && input.days.length !== count)) fail('invalid_report_snapshot');
  const seen = new Set();
  const days = input.days.map(day => {
    if (!object(day) || !date(day.date) || day.date < input.from || day.date > input.to || seen.has(day.date) || !Number.isSafeInteger(day.spend_minor) || day.spend_minor < 0 || day.spend_minor > 100000000000 || typeof day.is_final !== 'boolean') fail('invalid_report_snapshot');
    seen.add(day.date); return { date: day.date, spend_minor: day.spend_minor, is_final: day.is_final };
  }).sort((a,b) => a.date.localeCompare(b.date));
  const snapshot = { provider: input.provider, account_id: expected.account_id, currency: 'UAH', timezone: 'Europe/Kyiv',
    from: input.from, to: input.to, fetched_at: input.fetched_at, scope: expected.scope, coverage: input.coverage,
    source: input.source, source_ref: sourceRef, days };
  const bytes = encoder.encode(JSON.stringify(snapshot));
  return buildStatements(db, { provider: input.provider, ...expected, date_from: input.from, date_to: input.to,
    source_kind: 'sync_payload', source_fetched_at: input.fetched_at, run_id: runId }, bytes,
    `${input.provider}-${input.from}_${input.to}-${runId.slice(0, 12)}.json`, MIMES.json, 'system:accounting-sync', now);
}

export async function listAccountingReports(db, { provider, from, to, cursor = null }) {
  const expected = policy(provider); period(from, to);
  let after = null;
  if (cursor) {
    if (typeof cursor !== 'string' || cursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail('invalid_report_cursor');
    try { after = JSON.parse(atob(cursor.replace(/-/g,'+').replace(/_/g,'/'))); } catch { fail('invalid_report_cursor'); }
    if (!object(after) || Object.keys(after).length !== 5 || after.provider !== provider || after.from !== from || after.to !== to || !hex(after.id)) fail('invalid_report_cursor');
    timestamp(after.created_at);
  }
  const rows = await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM accounting_reports WHERE provider=? AND account_id=? AND scope=? AND source_ref=?
    AND date_from<=? AND date_to>=? ${after ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''}
    ORDER BY created_at DESC,id DESC LIMIT 51`).bind(provider, expected.account_id, expected.scope, expected.source_ref, to, from,
      ...(after ? [after.created_at, after.created_at, after.id] : [])).all();
  const values = rows.results || []; const files = values.slice(0,50).map(publicMeta); let next_cursor = null;
  if (values.length > 50) { const last = files.at(-1); next_cursor = btoa(JSON.stringify({ provider, from, to, id: last.id, created_at: last.created_at })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  return { files, next_cursor };
}

export async function readAccountingReportDownload(db, id) {
  if (!hex(id)) fail('invalid_report_id');
  const rows = await db.prepare('SELECT * FROM accounting_reports WHERE id=?').bind(id).all();
  const meta = rows.results?.[0]; if (!meta || !scoped(meta)) fail('accounting_report_not_found', 404);
  if (!Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > MAX_ACCOUNTING_REPORT_BYTES || meta.chunk_count !== Math.ceil(meta.bytes / ACCOUNTING_REPORT_CHUNK_BYTES)) fail('accounting_report_corrupt',503);
  const parts = await db.prepare('SELECT chunk_index,data_base64 FROM accounting_report_chunks WHERE report_id=? ORDER BY chunk_index LIMIT 33').bind(id).all();
  if (parts.results?.length !== meta.chunk_count) fail('accounting_report_corrupt',503);
  const bytes = new Uint8Array(meta.bytes); let offset = 0;
  for (let index = 0; index < parts.results.length; index++) {
    const row = parts.results[index]; const chunk = unbase64(row.data_base64);
    if (row.chunk_index !== index || chunk.length !== Math.min(ACCOUNTING_REPORT_CHUNK_BYTES, meta.bytes - offset)) fail('accounting_report_corrupt',503);
    bytes.set(chunk, offset); offset += chunk.length;
  }
  if (offset !== meta.bytes || await digest(bytes) !== meta.sha256) fail('accounting_report_corrupt',503);
  return { meta: publicMeta(meta), bytes };
}
