import { hasMarketIdentity, vehicleTraits } from '../../assets/js/market-comparison.js';
import { redactMarketText } from './market-query.js';

export const normalizeVin = value => String(value || '').trim().toUpperCase();
export const validVin = value => /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(value));
export const vinLookupConfigured = env => env.VIN_LOOKUP_ENABLED === 'true' && Boolean(env.VIN17_API_USER && env.VIN17_API_PASSWORD);

export function planVinLookup(env, order, items) {
  if (!items.length || items.every(hasMarketIdentity)) return { status: 'not_needed' };
  const requested_car = redactMarketText(order.car, order.vin).slice(0, 150);
  if (!order.vin) return { status: 'missing_vin', requested_car };
  if (!validVin(order.vin)) return { status: 'invalid_vin', requested_car };
  return { status: vinLookupConfigured(env) ? 'pending' : 'not_configured', requested_car };
}

const clean = value => typeof value === 'string' ? redactMarketText(value).replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) : '';
const key = value => vehicleTraits(value).text;

// Only a unanimous model from an exact full-VIN response may drive automatic search.
export function parseVin17Result(payload) {
  if (Number(payload?.code) !== 1) return { status: 'provider_error', source: '17VIN' };
  const data = payload.data;
  const rows = data?.model_list;
  if (!Array.isArray(rows) || !rows.length) return { status: 'not_found', source: '17VIN' };
  if (rows.length > 100) return { status: 'ambiguous', source: '17VIN' };
  const models = rows.map(row => {
    const brand = clean(row?.Brand_en);
    const model = clean(row?.Series_en || row?.Model_en);
    return brand && model ? (key(model).startsWith(key(brand) + ' ') ? model : `${brand} ${model}`) : '';
  });
  const unique = [...new Map(models.filter(Boolean).map(car => [key(car), car])).values()];
  if (data.matching_mode !== 'exact_match' || models.some(model => !model) || unique.length !== 1 || !hasMarketIdentity({ car: unique[0] })) return { status: 'ambiguous', source: '17VIN', candidates: unique.slice(0, 5) };
  const year = /^20\d{2}$/.test(String(data.model_year_from_vin)) ? String(data.model_year_from_vin) : '';
  return { status: 'resolved', source: '17VIN', model: unique[0], car: [unique[0], year].filter(Boolean).join(' '), year };
}

async function digest(algorithm, value) {
  return [...new Uint8Array(await crypto.subtle.digest(algorithm, new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const marketVinKey = vin => digest('SHA-256', `17vin-v1:${normalizeVin(vin)}`);

export function applyVinModel(items, result) {
  if (result.status !== 'resolved') return items;
  return items.map(item => hasMarketIdentity(item) ? item : {
    ...item, car: result.car, car_tokens: vehicleTraits(result.car).text.split(' '),
    query: (item.part_numbers?.[0] || `${result.model} ${item.label}`).slice(0, 180),
  });
}

export async function requestVin17(env, vin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    // MD5 is required by 17VIN's legacy signing protocol; HTTPS protects transport.
    const token = await digest('MD5', await digest('MD5', env.VIN17_API_USER) + await digest('MD5', env.VIN17_API_PASSWORD) + `/?vin=${vin}`);
    const response = await fetch('https://api.17vin.com:8443/', { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ vin, user: env.VIN17_API_USER, token }).toString() });
    if (!response.ok) { await response.body?.cancel(); return { status: 'provider_error', source: '17VIN' }; }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let body = '', size = 0;
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1000000) { await reader.cancel(); return { status: 'provider_error', source: '17VIN' }; }
      body += decoder.decode(value, { stream: true });
    }
    return parseVin17Result(JSON.parse(body + decoder.decode()));
  } catch { return { status: 'provider_error', source: '17VIN' }; }
  finally { clearTimeout(timer); }
}

export async function resolveMarketVin(env, vinValue, requestedCar = '') {
  const vin = normalizeVin(vinValue);
  if (!validVin(vin)) return { status: 'invalid_vin' };
  if (!vinLookupConfigured(env)) return { status: 'not_configured' };
  try {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS market_vin_cache (vin_key TEXT PRIMARY KEY, result_json TEXT NOT NULL DEFAULT \'{}\', expires_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, lease_id TEXT NOT NULL DEFAULT \'\')').run();
    const vinKey = await marketVinKey(vin);
    const now = Date.now();
    const row = await env.DB.prepare('SELECT * FROM market_vin_cache WHERE vin_key = ?').bind(vinKey).first();
    let result;
    if (row?.expires_at > now) result = { ...JSON.parse(row.result_json), cached: true };
    else {
      const lease = crypto.randomUUID();
      const claimed = await env.DB.prepare(`INSERT INTO market_vin_cache (vin_key, lease_until, lease_id) VALUES (?, ?, ?) ON CONFLICT(vin_key) DO UPDATE SET lease_until = excluded.lease_until, lease_id = excluded.lease_id WHERE market_vin_cache.expires_at <= ? AND market_vin_cache.lease_until <= ?`)
        .bind(vinKey, now + 30000, lease, now, now).run();
      if (Number(claimed.meta?.changes ?? claimed.changes) !== 1) return { status: 'pending' };
      result = { ...await requestVin17(env, vin), checked_at: new Date().toISOString() };
      const ttl = result.status === 'resolved' ? 30 * 86400000 : result.status === 'provider_error' ? 300000 : 86400000;
      await env.DB.prepare('UPDATE market_vin_cache SET result_json = ?, expires_at = ?, lease_until = 0, lease_id = \'\' WHERE vin_key = ? AND lease_id = ?')
        .bind(JSON.stringify(result), now + ttl, vinKey, lease).run();
    }
    const wanted = vehicleTraits(requestedCar).brands;
    const found = vehicleTraits(result.model).brands;
    if (result.status === 'resolved' && wanted.length && !wanted.some(brand => found.includes(brand))) return { status: 'conflict', source: '17VIN', candidates: [result.car] };
    return result;
  } catch { return { status: 'provider_error', source: '17VIN' }; }
}
