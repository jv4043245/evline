import { integer, json, number, readPayload, text } from "../../_lib/http.js";

const SHIPPING_MODES = new Set(["air", "sea"]);
const RATE_UNITS = new Set(["kg", "m3", "item"]);
const CURRENCIES = new Set(["UAH", "USD", "EUR"]);

function isMissingShippingTable(error) {
  return /no such table: shipping_/i.test(error?.message || String(error));
}

function slug(value) {
  const cleaned = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґ_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return cleaned || crypto.randomUUID();
}

function activeFlag(value, fallback = 1) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  return ["0", "false", "no", "off"].includes(String(value).toLowerCase()) ? 0 : 1;
}

function normalizeRate(rate, carrierId, now) {
  const mode = text(rate.mode).toLowerCase();
  const unit = text(rate.unit).toLowerCase();
  const currency = text(rate.currency).toUpperCase();
  return {
    id: text(rate.id) || `${carrierId}-${mode || crypto.randomUUID()}`,
    created_at: now,
    updated_at: now,
    carrier_id: carrierId,
    mode: SHIPPING_MODES.has(mode) ? mode : "air",
    currency: CURRENCIES.has(currency) ? currency : "UAH",
    rate: number(rate.rate),
    unit: RATE_UNITS.has(unit) ? unit : "kg",
    min_charge: number(rate.min_charge),
    min_weight_kg: number(rate.min_weight_kg),
    min_volume_m3: number(rate.min_volume_m3),
    exchange_rate_uah: number(rate.exchange_rate_uah),
    estimated_days_min: integer(rate.estimated_days_min),
    estimated_days_max: integer(rate.estimated_days_max),
    active: activeFlag(rate.active, 1),
    notes: text(rate.notes),
  };
}

function normalizeCarrier(payload) {
  const now = new Date().toISOString();
  const name = text(payload.name);
  const id = text(payload.id) || slug(payload.code || name);
  return {
    carrier: {
      id,
      created_at: now,
      updated_at: now,
      name,
      code: text(payload.code) || id,
      active: activeFlag(payload.active, 1),
      tracking_url_template: text(payload.tracking_url_template),
      notes: text(payload.notes),
    },
    rates: Array.isArray(payload.rates) ? payload.rates.map((rate) => normalizeRate(rate, id, now)) : [],
  };
}

async function loadShipping(env) {
  const carriers = await env.DB.prepare("SELECT * FROM shipping_carriers ORDER BY active DESC, name ASC").all();
  const rates = await env.DB.prepare(
    `SELECT * FROM shipping_rates
    ORDER BY active DESC,
      CASE mode WHEN 'air' THEN 1 WHEN 'sea' THEN 2 ELSE 3 END,
      rate ASC`
  ).all();
  return { carriers: carriers.results || [], rates: rates.results || [] };
}

async function insertRates(env, rates) {
  for (const rate of rates) {
    await env.DB.prepare(
      `INSERT INTO shipping_rates (
        id, created_at, updated_at, carrier_id, mode, currency, rate, unit, min_charge,
        min_weight_kg, min_volume_m3, exchange_rate_uah, estimated_days_min,
        estimated_days_max, active, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        rate.id,
        rate.created_at,
        rate.updated_at,
        rate.carrier_id,
        rate.mode,
        rate.currency,
        rate.rate,
        rate.unit,
        rate.min_charge,
        rate.min_weight_kg,
        rate.min_volume_m3,
        rate.exchange_rate_uah,
        rate.estimated_days_min,
        rate.estimated_days_max,
        rate.active,
        rate.notes
      )
      .run();
  }
}

export async function onRequestGet({ env }) {
  try {
    return json(await loadShipping(env));
  } catch (error) {
    if (isMissingShippingTable(error)) return json({ carriers: [], rates: [], migration_required: true });
    throw error;
  }
}

export async function onRequestPost({ request, env }) {
  const payload = await readPayload(request);
  const { carrier, rates } = normalizeCarrier(payload);

  if (!carrier.name) return json({ error: "Carrier name is required" }, { status: 400 });

  await env.DB.prepare(
    `INSERT INTO shipping_carriers (
      id, created_at, updated_at, name, code, active, tracking_url_template, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      carrier.id,
      carrier.created_at,
      carrier.updated_at,
      carrier.name,
      carrier.code,
      carrier.active,
      carrier.tracking_url_template,
      carrier.notes
    )
    .run();

  await insertRates(env, rates);

  return json({ ok: true, ...(await loadShipping(env)) });
}

export async function onRequestPatch({ request, env }) {
  const payload = await readPayload(request);
  const { carrier, rates } = normalizeCarrier(payload);

  if (!text(payload.id)) return json({ error: "Carrier id is required" }, { status: 400 });
  if (!carrier.name) return json({ error: "Carrier name is required" }, { status: 400 });

  await env.DB.prepare(
    `UPDATE shipping_carriers SET
      updated_at = ?,
      name = ?,
      code = ?,
      active = ?,
      tracking_url_template = ?,
      notes = ?
    WHERE id = ?`
  )
    .bind(
      carrier.updated_at,
      carrier.name,
      carrier.code,
      carrier.active,
      carrier.tracking_url_template,
      carrier.notes,
      text(payload.id)
    )
    .run();

  await env.DB.prepare("DELETE FROM shipping_rates WHERE carrier_id = ?").bind(text(payload.id)).run();
  await insertRates(env, rates.map((rate) => ({ ...rate, carrier_id: text(payload.id) })));

  return json({ ok: true, ...(await loadShipping(env)) });
}
