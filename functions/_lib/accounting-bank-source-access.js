import { adminUser } from './auth.js';
import { json } from './http.js';

export const BANK_SOURCE_SESSION_HEADER = 'x-bank-source-session';
export const BANK_SOURCE_SESSION_SECONDS = 900;
const encoder = new TextEncoder();
const fail = (code, status = 400, retryAfter = null) => Object.assign(new Error(code), { status, retryAfter });
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const epoch = now => Math.floor(new Date(now).getTime() / 1000);
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
function unb64(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1024) throw fail('bank_sources_unavailable', 503);
  let bytes; try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)); } catch { throw fail('bank_sources_unavailable', 503); }
  if (size !== undefined && bytes.length !== size || b64(bytes) !== value) throw fail('bank_sources_unavailable', 503);
  return bytes;
}
export const bankSourceDigest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function constantTime(a, b) {
  let different = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) different |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return different === 0;
}

/** PBKDF2 WebCrypto in Workers supports at most 100,000 iterations. The
 * separately generated password is 32 random bytes, rather than human text.
 * Never return this configuration or the derived signing key to a client.
 */
export function bankSourceConfiguration(env) {
  const owner = env?.BANK_SOURCE_OWNER_ID, raw = env?.BANK_SOURCE_PASSWORD_HASH;
  if (!safeId(owner) || typeof raw !== 'string') throw fail('bank_sources_unavailable', 503);
  const fields = raw.split('$');
  if (fields.length !== 4 || fields[0] !== 'pbkdf2-sha256' || fields[1] !== '100000') throw fail('bank_sources_unavailable', 503);
  return { owner, raw, salt: unb64(fields[2], 16), expected: unb64(fields[3], 32), iterations: 100000 };
}

export function bankSourceUser(request, env) {
  const user = adminUser(request, env);
  if (!user) throw fail('Unauthorized', 401);
  if (!safeId(env?.BANK_SOURCE_OWNER_ID)) throw fail('bank_sources_unavailable', 503);
  return { user, allowed: user.id === env.BANK_SOURCE_OWNER_ID };
}
export function requireBankSourceOwner(request, env) {
  const access = bankSourceUser(request, env);
  if (!access.allowed) throw fail('bank_sources_owner_only', 403);
  return bankSourceConfiguration(env);
}
export function validateBankSourceRequest(request, { mutation = false } = {}) {
  if (new URL(request.url).search) throw fail('bank_sources_invalid_parameters');
  const origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if (origin && origin !== new URL(request.url).origin || site && !['same-origin', 'none'].includes(site)) throw fail('bank_sources_invalid_origin', 403);
  if (mutation && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) throw fail('bank_sources_invalid_body');
}
export async function readBankSourceJson(request, expectedKeys) {
  const limit = 1024, length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw fail('bank_sources_body_too_large', 413);
  if (!request.body?.getReader) throw fail('bank_sources_invalid_body');
  const reader = request.body.getReader(), pieces = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) { await reader.cancel(); throw fail('bank_sources_body_too_large', 413); }
      pieces.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const piece of pieces) { bytes.set(piece, offset); offset += piece.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail('bank_sources_invalid_body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(body, key))) throw fail('bank_sources_invalid_body');
  return body;
}

async function authBinding(request) {
  // Credential binding makes a second owner's admin credential require its
  // own unlock too. Never persist the raw credential in D1 or the session token.
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return bankSourceDigest(encoder.encode(bearer || (request.headers.get('x-admin-token') || '').trim()));
}
async function signingKey(config) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`evline-bank-source-session-v1\0${config.owner}\0${config.raw}`));
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function signature(config, text) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(config), encoder.encode(text)));
}

export async function bankSourceSession(db, request, config, { now = new Date() } = {}) {
  const token = request.headers.get(BANK_SOURCE_SESSION_HEADER);
  if (!token || token.length > 1200) return null;
  try {
    const parts = token.split('.'); if (parts.length !== 2) return null;
    if (!constantTime(unb64(parts[1], 32), await signature(config, parts[0]))) return null;
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unb64(parts[0]))), current = epoch(now);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 7
        || value.v !== 1 || value.scope !== 'bank_sources' || value.owner !== config.owner || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)
        || value.iat > current || value.exp <= current || value.exp - value.iat !== BANK_SOURCE_SESSION_SECONDS
        || !hex(value.auth) || !constantTime(encoder.encode(value.auth), encoder.encode(await authBinding(request)))) return null;
    const nonce = unb64(value.nonce, 32), id = await bankSourceDigest(nonce);
    const found = await db.prepare('SELECT owner_id,auth_binding,token_hash,expires_at FROM accounting_bank_source_sessions WHERE session_id=? AND revoked_at IS NULL').bind(id).all();
    const saved = found.results?.[0];
    if (!saved || saved.owner_id !== config.owner || saved.expires_at !== value.exp || saved.expires_at <= current
        || !constantTime(encoder.encode(saved.auth_binding), encoder.encode(value.auth))
        || !constantTime(encoder.encode(saved.token_hash), encoder.encode(await bankSourceDigest(encoder.encode(token))))) return null;
    return { id, expires_at: new Date(value.exp * 1000).toISOString() };
  } catch (error) {
    // Parsing/signature failures are locked, but an unavailable D1 must not be
    // mistaken for successful authentication or silently hidden as valid data.
    if (error.status === 503 || error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

export async function unlockBankSources(db, request, config, password, { now = new Date() } = {}) {
  if (typeof password !== 'string' || !password.length || encoder.encode(password).length > 256) throw fail('bank_sources_invalid_body');
  const current = epoch(now);
  const consumed = await db.prepare(`INSERT INTO accounting_bank_source_unlock_limits(owner_id,window_start,attempts) VALUES(?,?,1)
    ON CONFLICT(owner_id) DO UPDATE SET attempts=CASE WHEN window_start<=? THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END
    WHERE window_start<=? OR attempts<5 RETURNING attempts,window_start`)
    .bind(config.owner, current, current - 900, current - 900, current - 900).all();
  if (!consumed.results?.length) {
    const existing = await db.prepare('SELECT window_start FROM accounting_bank_source_unlock_limits WHERE owner_id=?').bind(config.owner).all();
    throw fail('bank_sources_rate_limited', 429, Math.max(1, 900 - (current - Number(existing.results?.[0]?.window_start ?? current))));
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: config.salt, iterations: config.iterations }, key, 256));
  if (!constantTime(actual, config.expected)) throw fail('bank_sources_invalid_password', 403);
  const nonce = crypto.getRandomValues(new Uint8Array(32)), value = { v: 1, scope: 'bank_sources', owner: config.owner,
    iat: current, exp: current + BANK_SOURCE_SESSION_SECONDS, nonce: b64(nonce), auth: await authBinding(request) };
  const payload = b64(encoder.encode(JSON.stringify(value))), token = `${payload}.${b64(await signature(config, payload))}`;
  const id = await bankSourceDigest(nonce), tokenHash = await bankSourceDigest(encoder.encode(token));
  await db.batch([
    db.prepare('DELETE FROM accounting_bank_source_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL').bind(current),
    db.prepare('INSERT INTO accounting_bank_source_sessions(session_id,owner_id,auth_binding,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(id, config.owner, value.auth, tokenHash, current, value.exp),
  ]);
  return { session_token: token, expires_at: new Date(value.exp * 1000).toISOString() };
}
export async function lockBankSources(db, request, config, { now = new Date() } = {}) {
  const session = await bankSourceSession(db, request, config, { now });
  if (session) await db.batch([db.prepare('UPDATE accounting_bank_source_sessions SET revoked_at=? WHERE session_id=? AND owner_id=?').bind(epoch(now), session.id, config.owner)]);
}
export const bankSourcesLockedState = allowed => ({ allowed, locked: true, files: [], expires_at: null });
export function bankSourceError(error) {
  const status = [400,401,403,404,409,413,423,429].includes(error.status) ? error.status : 503;
  return json({ error: status === 503 ? 'bank_sources_unavailable' : error.message }, { status,
    headers: { 'cache-control': 'private, no-store', ...(status === 429 ? { 'retry-after': String(error.retryAfter || 900) } : {}) } });
}
