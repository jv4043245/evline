import { bankSourceDigest } from './accounting-bank-source-access.js';
import { validAccountingDate } from './accounting.js';

export const MAX_BANK_SOURCE_BYTES = 8 * 1024 * 1024;
// 64KiB becomes at most 87,384 base64 characters: an operator-side SQL import
// remains below D1's 100KB statement limit even without prepared bindings.
export const BANK_SOURCE_CHUNK_BYTES = 64 * 1024;
const MIME = { csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const FIELDS = ['id', 'filename', 'mime', 'bytes', 'sha256', 'date_from', 'date_to', 'created_at'];
const COLUMNS = [...FIELDS, 'created_by', 'chunk_count'];
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const b64 = bytes => {
  const parts = [];
  for (let start = 0; start < bytes.length; start += 12288) parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + 12288))));
  return parts.join('');
};
function unb64(text) {
  if (typeof text !== 'string' || text.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw fail('bank_sources_corrupt', 503);
  let bytes; try { bytes = Uint8Array.from(atob(text), char => char.charCodeAt(0)); } catch { throw fail('bank_sources_corrupt', 503); }
  if (b64(bytes) !== text) throw fail('bank_sources_corrupt', 503);
  return bytes;
}
const metadata = row => Object.fromEntries(FIELDS.map(key => [key, row[key]]));
const sourceFilename = value => typeof value === 'string' && value.length > 0 && value.length <= 180 && value.trim() === value
  && value.includes('.')
  && !/^[.]/.test(value) && !/[\u0000-\u001f\u007f-\u009f/\\:"<>|?*\u202a-\u202e\u2066-\u2069]/u.test(value)
  && Object.hasOwn(MIME, value.split('.').at(-1).toLowerCase());
function sourceFile(bytes, filename) {
  if (!sourceFilename(filename)) throw fail('bank_sources_invalid_filename');
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw fail('bank_sources_invalid_file');
  if (bytes.length > MAX_BANK_SOURCE_BYTES) throw fail('bank_sources_file_too_large', 413);
  const extension = filename.split('.').at(-1).toLowerCase();
  if (extension === 'xlsx') {
    if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw fail('bank_sources_invalid_file');
  } else {
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    let text; try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { throw fail('bank_sources_invalid_file'); }
    if (!text.trim() || /\u0000/.test(text) || /^\s*(?:<!doctype\s+html|<html|<script|<svg)/i.test(text) || !/[,;\t]/.test(text)) throw fail('bank_sources_invalid_file');
  }
  return MIME[extension];
}

/** Called only by a private operator-side import, never an upload endpoint.
 * Never parse or alter spreadsheet contents; the digest identifies exact bytes.
 */
export async function prepareBankSourceImport(files, actorId, { now = new Date() } = {}) {
  if (!Array.isArray(files) || !files.length || files.length > 3 || typeof actorId !== 'string' || !actorId.trim() || actorId.length > 200
      || actorId.trim() !== actorId || /[\u0000-\u0020\u007f-\u009f]/u.test(actorId)) throw fail('bank_sources_invalid_import');
  const seenNames = new Set(), seenIds = new Set(), documents = [];
  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file) || Object.keys(file).some(key => !['filename', 'bytes', 'date_from', 'date_to', 'sha256'].includes(key))
        || !validAccountingDate(file.date_from) || !validAccountingDate(file.date_to) || file.date_from > file.date_to || file.date_from < '2000-01-01' || file.date_to > '2100-12-31') throw fail('bank_sources_invalid_import');
    const mime = sourceFile(file.bytes, file.filename), digest = await bankSourceDigest(file.bytes);
    if (file.sha256 !== undefined && file.sha256 !== digest) throw fail('bank_sources_digest_mismatch');
    if (seenNames.has(file.filename) || seenIds.has(digest)) throw fail('bank_sources_duplicate_file');
    seenNames.add(file.filename); seenIds.add(digest);
    const meta = { id: digest, filename: file.filename, mime, bytes: file.bytes.length, sha256: digest,
      date_from: file.date_from, date_to: file.date_to, created_at: new Date(now).toISOString(), created_by: actorId,
      chunk_count: Math.ceil(file.bytes.length / BANK_SOURCE_CHUNK_BYTES) };
    const chunks = Array.from({ length: meta.chunk_count }, (_, index) => ({ source_id: digest, chunk_index: index,
      data_base64: b64(file.bytes.subarray(index * BANK_SOURCE_CHUNK_BYTES, (index + 1) * BANK_SOURCE_CHUNK_BYTES)) }));
    documents.push({ meta, chunks });
  }
  return documents;
}

export async function persistBankSourceImport(db, files, actorId, options) {
  const documents = await prepareBankSourceImport(files, actorId, options), statements = [];
  for (const { meta, chunks } of documents) {
    statements.push(db.prepare(`INSERT INTO accounting_bank_sources(${COLUMNS.join(',')}) VALUES(${COLUMNS.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`)
      .bind(...COLUMNS.map(key => meta[key])));
    for (const chunk of chunks) statements.push(db.prepare('INSERT INTO accounting_bank_source_chunks(source_id,chunk_index,data_base64) VALUES(?,?,?) ON CONFLICT DO NOTHING')
      .bind(chunk.source_id, chunk.chunk_index, chunk.data_base64));
  }
  try { await db.batch(statements); }
  catch (error) { if (/bank_source_import_conflict/.test(error.message)) throw fail('bank_sources_import_conflict', 409); throw error; }
  const saved = await db.prepare(`SELECT ${FIELDS.join(',')} FROM accounting_bank_sources WHERE id IN (${documents.map(() => '?').join(',')})`)
    .bind(...documents.map(({ meta }) => meta.id)).all();
  const byId = new Map((saved.results || []).map(row => [row.id, row]));
  if (documents.some(({ meta }) => !byId.has(meta.id))) throw fail('bank_sources_unavailable', 503);
  return { files: documents.map(({ meta }) => metadata(byId.get(meta.id))) };
}

const literal = value => typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
export async function buildBankSourceImportSql(files, actorId, options) {
  const documents = await prepareBankSourceImport(files, actorId, options), statements = [];
  for (const { meta, chunks } of documents) {
    statements.push(`INSERT INTO accounting_bank_sources(${COLUMNS.join(',')}) VALUES(${COLUMNS.map(key => literal(meta[key])).join(',')}) ON CONFLICT DO NOTHING;`);
    for (const chunk of chunks) statements.push(`INSERT INTO accounting_bank_source_chunks(source_id,chunk_index,data_base64) VALUES(${[chunk.source_id, chunk.chunk_index, chunk.data_base64].map(literal).join(',')}) ON CONFLICT DO NOTHING;`);
  }
  return { sql: `${statements.join('\n')}\n`, files: documents.map(({ meta }) => metadata(meta)) };
}

export async function listBankSources(db) {
  const result = await db.prepare(`SELECT ${FIELDS.join(',')} FROM accounting_bank_sources ORDER BY date_from,id LIMIT 4`).bind().all();
  if ((result.results || []).length > 3) throw fail('bank_sources_unavailable', 503);
  return (result.results || []).map(metadata);
}
export async function readBankSourceDownload(db, id) {
  if (!hex(id)) throw fail('bank_sources_invalid_id');
  const result = await db.prepare('SELECT * FROM accounting_bank_sources WHERE id=?').bind(id).all(), meta = result.results?.[0];
  if (!meta) throw fail('bank_sources_not_found', 404);
  if (!hex(meta.sha256) || meta.id !== meta.sha256 || !sourceFilename(meta.filename) || MIME[meta.filename.split('.').at(-1).toLowerCase()] !== meta.mime
      || !Number.isSafeInteger(meta.bytes) || meta.bytes < 1 || meta.bytes > MAX_BANK_SOURCE_BYTES || meta.chunk_count !== Math.ceil(meta.bytes / BANK_SOURCE_CHUNK_BYTES)) throw fail('bank_sources_corrupt', 503);
  const resultChunks = await db.prepare('SELECT chunk_index,data_base64 FROM accounting_bank_source_chunks WHERE source_id=? ORDER BY chunk_index LIMIT 129').bind(id).all(), chunks = resultChunks.results || [];
  if (chunks.length !== meta.chunk_count) throw fail('bank_sources_corrupt', 503);
  const bytes = new Uint8Array(meta.bytes); let offset = 0;
  for (const [index, row] of chunks.entries()) {
    const part = unb64(row.data_base64);
    if (row.chunk_index !== index || part.length !== Math.min(BANK_SOURCE_CHUNK_BYTES, meta.bytes - offset)) throw fail('bank_sources_corrupt', 503);
    bytes.set(part, offset); offset += part.length;
  }
  if (offset !== meta.bytes || await bankSourceDigest(bytes) !== meta.sha256) throw fail('bank_sources_corrupt', 503);
  return { meta: metadata(meta), bytes };
}
