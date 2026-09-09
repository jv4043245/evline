import { text } from "./http.js";
import { compareMarketCandidate, summarizeMarketItem, MARKET_MATCH_VERSION } from "../../assets/js/market-comparison.js";
import { parseMarketProducts } from "./market-products.js";
import { redactMarketText, splitMarketLabels, enrichMarketItems, reviewMarketCandidates } from "./market-query.js";
import { researchMarketItems } from "./market-fetch.js";
import { hydrateMarketResult, offerIdentity } from "./market-feedback.js";

export const MARKET_RESEARCH_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RESEARCH_ITEMS = 3;

export const COMPETITOR_SOURCES = [
  {
    key: "mahina",
    name: "MAHINA",
    home: "https://mahina.in.ua/catalog/byd/",
    search: (query) => `https://mahina.in.ua/search/?query=${encodeURIComponent(query)}`,
  },
  {
    key: "ncars",
    name: "NCARS",
    home: "https://ncars.com.ua/zapchastyny/",
    search: (query) => `https://ncars.com.ua/search/?search=${encodeURIComponent(query)}`,
  },
  {
    key: "evox",
    name: "EVOX",
    home: "https://evox.com.ua/katalog/zapchastyny/",
    search: (query) => `https://evox.com.ua/katalog/search/?q=${encodeURIComponent(query)}`,
  },
  {
    key: "kitaec",
    name: "Kitaec",
    home: "https://kitaec.ua/ua/",
    search: (query) => `https://kitaec.ua/ua/search/?q=${encodeURIComponent(query)}`,
  },
  {
    key: "auto_china",
    name: "Auto-China",
    home: "https://auto-china.in.ua/",
    search: (query) => `https://auto-china.in.ua/katalog/search/?q=${encodeURIComponent(query)}`,
  },
  {
    key: "autoasia",
    name: "AutoAsia",
    home: "https://autoasia.ua/uk/zapchasti-byd/",
    search: (query) => `https://autoasia.ua/uk/search/?node=1&string=${encodeURIComponent(query)}`,
  },
  {
    key: "evparts",
    name: "EVparts",
    home: "https://evparts.kiev.ua/ua/",
    search: (query) => `https://evparts.kiev.ua/ua/site_search?search_term=${encodeURIComponent(query)}`,
  },
  {
    key: "panda",
    name: "Panda Auto Parts",
    home: "https://panda-auto.com.ua/ua/",
    search: (query) => `https://panda-auto.com.ua/ua/search/all_${encodeURIComponent(query)}`,
  },
  {
    key: "asiaparts",
    name: "AsiaParts",
    home: "https://asiaparts.com.ua/ua/brand/byd",
    search: (query) => `https://asiaparts.com.ua/ua?q=${encodeURIComponent(query)}`,
  },
  {
    key: "emobil",
    name: "EMOBIL",
    home: "https://emobil.kyiv.ua/",
    search: (query) => `https://emobil.kyiv.ua/search-result?search_form=1&search_query=${encodeURIComponent(query)}`,
  },
  {
    key: "zevs",
    name: "ZEVS PARTS",
    home: "https://prom.ua/ua/c4149823-zevs-parts-sklad%3B15.html",
    search: (query) => `https://prom.ua/ua/search?company_id=4149823&search_term=${encodeURIComponent(query)}`,
  },
];

const STOP_WORDS = new Set([
  "авто", "автомобіль", "автомобиль", "для", "на", "до", "з", "из", "та", "і", "и", "в", "у",
  "правий", "правый", "права", "правое", "лівий", "левый", "ліва", "левое", "передній", "передний",
  "задній", "задний", "задня", "задняя", "оригінал", "оригинал", "деталь", "запчастина", "запчасть",
]);

const TOKEN_ALIASES = new Map([
  ["бампер", "bumper"], ["bumper", "bumper"],
  ["крило", "fender"], ["крыло", "fender"], ["fender", "fender"],
  ["фара", "lamp"], ["ліхтар", "lamp"], ["фонарь", "lamp"], ["lamp", "lamp"],
  ["скло", "glass"], ["стекло", "glass"], ["glass", "glass"],
  ["двері", "door"], ["дверь", "door"], ["дверка", "door"], ["door", "door"],
  ["капот", "hood"], ["hood", "hood"],
  ["решітка", "grille"], ["решетка", "grille"], ["grille", "grille"],
  ["підсилювач", "reinforcement"], ["усилитель", "reinforcement"],
  ["накладка", "trim"], ["молдинг", "trim"], ["кронштейн", "bracket"],
  ["дзеркало", "mirror"], ["зеркало", "mirror"], ["mirror", "mirror"],
  ["амортизатор", "shock"], ["стійка", "shock"], ["стойка", "shock"],
]);

function normalizeCompact(value) {
  return String(value || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]/giu, "");
}

function canonicalToken(value) {
  const token = String(value || "").toLowerCase();
  return TOKEN_ALIASES.get(token) || token;
}

export function meaningfulTokens(value) {
  return [...new Set(String(value || "")
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .split(/\s+/)
    .map(canonicalToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !/^20\d{2}$/.test(token)))];
}

export function extractPartNumbers(value, excludedVin = "") {
  const excluded = normalizeCompact(excludedVin);
  const matches = String(value || "").toUpperCase().match(/[A-ZА-ЯІЇЄҐ0-9][A-ZА-ЯІЇЄҐ0-9._/-]{5,29}/gu) || [];
  return [...new Set(matches.filter((candidate) => {
    const compact = normalizeCompact(candidate);
    const digits = (compact.match(/\d/g) || []).length;
    if (digits < 3 || compact.length < 6 || compact === excluded) return false;
    if (/^\+?\d{9,15}$/.test(candidate.replace(/\s/g, ""))) return false;
    if (/^[A-Z0-9]{17}$/i.test(compact)) return false;
    return true;
  }))].slice(0, 8);
}

function cleanItemLabel(value) {
  return text(value)
    .replace(/^(?:запчастина|запчасть|деталь|послуга|услуга|запчастина\s*\/\s*послуга)\s*:\s*/iu, "")
    .replace(/^(?:[-–—•]\s*|\d+[.)]\s+)/u, "")
    .trim();
}

function stripVinIdentifiers(value, knownVin = "") {
  const known = text(knownVin).trim();
  let result = String(value || "");
  if (known) result = result.replaceAll(known, " ");
  return redactMarketText(result, known).trim();
}

export function splitRequestedItems(order = {}, overrides = {}) {
  const manualQuery = stripVinIdentifiers(cleanItemLabel(overrides.query || ""), order.vin);
  const source = manualQuery || stripVinIdentifiers(cleanItemLabel(order.item_name || order.service_name || order.request_text || ""), order.vin);
  if (!source) return [];
  const parts = splitMarketLabels(source).map(cleanItemLabel).filter(Boolean);
  const fullContext = redactMarketText([order.item_name, order.request_text, overrides.part_number].filter(Boolean).join(" "), order.vin);
  const allPartNumbers = extractPartNumbers(fullContext, order.vin);
  const car = redactMarketText(text(order.car), order.vin);
  return [...new Set(parts)].map((label, index) => {
    const safeLabel = stripVinIdentifiers(label, order.vin);
    const localPartNumbers = extractPartNumbers(`${label} ${overrides.part_number || ""}`, order.vin);
    const partNumbers = localPartNumbers.length ? localPartNumbers : (parts.length === 1 ? allPartNumbers : []);
    const query = partNumbers[0] || [car, safeLabel].filter(Boolean).join(" ");
    return {
      key: `item-${index + 1}`,
      label: safeLabel,
      car,
      query: text(query).slice(0, 180),
      part_numbers: partNumbers,
      item_tokens: meaningfulTokens(safeLabel),
      car_tokens: meaningfulTokens(car),
    };
  });
}

export function parseSourceHtml(sourceKey, html, baseUrl) {
  return parseMarketProducts(sourceKey, html, baseUrl);
}

export function classifyAvailability(value) {
  const normalized = String(value || "").toLowerCase();
  if (/немає|нет в наличии|недоступ|out.of.stock|notavailable/u.test(normalized)) return "out_of_stock";
  if (/під замовлення|под заказ|передзамов|очікуван|ожидани|\bwait\b|90\s*(?:д|day)|delivery/u.test(normalized)) return "order_needed";
  if (/в наявності|в наличии|готово до відправки|\bavail\b|in.stock/u.test(normalized)) return "in_stock";
  return "unknown";
}

export function extractLeadTime(value) {
  const normalized = String(value || "").toLowerCase().replace(/міс\.?|месяц(?:а|ев)?/gu, " міс ");
  const range = normalized.match(/(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*(?:дн|днів|дней|day)/u);
  if (range) return [Number(range[1]), Number(range[2])];
  const months = normalized.match(/(\d{1,2})\s*міс/u);
  if (months) return [Number(months[1]) * 30, Number(months[1]) * 30];
  const days = normalized.match(/(\d{1,3})\s*(?:дн|днів|дней|day)/u);
  return days ? [Number(days[1]), Number(days[1])] : [null, null];
}

export function classifyPartType(value) {
  const normalized = String(value || "").toLowerCase();
  if (/\bб\s*\/\s*у\b|вживан|бывш|used/u.test(normalized)) return "used";
  if (/aftermarket|аналог|замінник|заменитель/u.test(normalized)) return "aftermarket";
  if (/\boem\b/u.test(normalized)) return "oem";
  if (/original|оригінал|оригинал|genuine/u.test(normalized)) return "original";
  return "unknown";
}

export function classifyMatch(candidate, item) {
  return compareMarketCandidate(candidate, item);
}

export function summarizeOffers(items, offers) {
  const summaries = items.map((item) => summarizeMarketItem(item, offers));
  return {
    items: summaries,
    item_count: summaries.length,
    offer_count: offers.length,
    exact_offer_count: offers.filter((offer) => offer.match_type === "exact").length,
    confidence: summaries.length && summaries.every((item) => item.confidence === "high") ? "high" : "low",
  };
}

function fingerprintFor(order, items) {
  return JSON.stringify({
    matching_version: MARKET_MATCH_VERSION,
    car: text(order.car).toLowerCase(),
    vin_prefix: text(order.vin).slice(0, 3).toUpperCase(),
    items: items.map((item) => ({ label: item.label.toLowerCase(), part_numbers: item.part_numbers })),
  });
}

async function ensureMarketResearchTables(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS market_research_runs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      fingerprint TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      item_count INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'low',
      exact_offer_count INTEGER NOT NULL DEFAULT 0,
      offer_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      source_status_json TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS market_research_offers (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      item_key TEXT NOT NULL,
      item_label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      product_url TEXT NOT NULL,
      title TEXT NOT NULL,
      price_uah REAL NOT NULL,
      availability TEXT NOT NULL DEFAULT 'unknown',
      availability_text TEXT NOT NULL DEFAULT '',
      lead_time_min INTEGER,
      lead_time_max INTEGER,
      part_type TEXT NOT NULL DEFAULT 'unknown',
      match_type TEXT NOT NULL DEFAULT 'probable',
      part_number TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES market_research_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_market_research_runs_order ON market_research_runs(order_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_market_research_offers_run ON market_research_offers(run_id, item_key)",
  ];

  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

export async function getLatestMarketResearch(env, order, overrides = {}) {
  await ensureMarketResearchTables(env);
  const items = splitRequestedItems(order, overrides);
  const fingerprint = fingerprintFor(order, items);
  const run = await env.DB.prepare(
    "SELECT * FROM market_research_runs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(order.id).first();
  if (!run) {
    return { run: null, offers: [], summary: { items: [] }, sources: [], can_search: Boolean(items.length), should_refresh: Boolean(items.length), item_limit: MAX_RESEARCH_ITEMS };
  }
  const rows = await env.DB.prepare(
    "SELECT * FROM market_research_offers WHERE run_id = ? ORDER BY item_key, match_type, price_uah"
  ).bind(run.id).all();
  const { summary, offers } = await hydrateMarketResult(env, parseJson(run.summary_json, { items: [] }), rows.results || []);
  const updatedAt = Date.parse(run.updated_at || run.created_at || 0);
  const stale = !updatedAt || Date.now() - updatedAt > MARKET_RESEARCH_TTL_MS;
  return {
    run: { ...run, summary, source_status: parseJson(run.source_status_json, []) },
    offers,
    summary,
    sources: parseJson(run.source_status_json, []),
    can_search: Boolean(items.length),
    should_refresh: Boolean(items.length) && (run.status !== "complete" || stale || summary.matching_version !== MARKET_MATCH_VERSION || (!summary.manual_query && run.fingerprint !== fingerprint)),
    item_limit: MAX_RESEARCH_ITEMS,
  };
}

export async function runMarketResearch(env, order, overrides = {}) {
  await ensureMarketResearchTables(env);
  const inputItems = splitRequestedItems(order, overrides);
  const parsed = await enrichMarketItems(env, inputItems);
  const allItems = parsed.items;
  const items = allItems.slice(0, MAX_RESEARCH_ITEMS);
  if (!items.length) {
    const error = new Error("Вкажіть запчастину або пошуковий запит.");
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const fingerprint = fingerprintFor(order, inputItems);
  await env.DB.prepare(
    `INSERT INTO market_research_runs (
      id, order_id, created_at, updated_at, status, fingerprint, query, item_count
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(runId, order.id, now, now, fingerprint, items.map((item) => item.query).join(" | "), items.length).run();

  try {
    const { offers: candidates, sources } = await researchMarketItems(items, COMPETITOR_SOURCES);
    const offers = await reviewMarketCandidates(env, items, candidates);
    const summary = {
      ...summarizeOffers(items, offers),
      matching_version: MARKET_MATCH_VERSION,
      ai_status: parsed.ai_status,
      offer_details: Object.fromEntries(offers.map(offer => [offerIdentity(offer), offer])),
      requested_item_count: allItems.length,
      ignored_item_count: Math.max(0, allItems.length - items.length),
      manual_query: Boolean(text(overrides.query) || text(overrides.part_number)),
    };
    if (offers.length) {
      const statements = offers.map((offer) => env.DB.prepare(
        `INSERT INTO market_research_offers (
          id, run_id, order_id, item_key, item_label, created_at, source_key, source_name, source_url,
          product_url, title, price_uah, availability, availability_text, lead_time_min, lead_time_max,
          part_type, match_type, part_number, snippet
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), runId, order.id, offer.item_key, offer.item_label, now, offer.source_key,
        offer.source_name, offer.source_url, offer.product_url, offer.title, offer.price_uah,
        offer.availability, offer.availability_text, offer.lead_time_min, offer.lead_time_max,
        offer.part_type, offer.match_type, offer.part_number, offer.snippet
      ));
      for (let index = 0; index < statements.length; index += 50) {
        await env.DB.batch(statements.slice(index, index + 50));
      }
    }
    await env.DB.prepare(
      `UPDATE market_research_runs SET
        updated_at = ?, status = 'complete', confidence = ?, exact_offer_count = ?, offer_count = ?,
        summary_json = ?, source_status_json = ?, error = ''
      WHERE id = ?`
    ).bind(now, summary.confidence, summary.exact_offer_count, summary.offer_count, JSON.stringify(summary), JSON.stringify(sources), runId).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE market_research_runs SET updated_at = ?, status = 'failed', error = ? WHERE id = ?"
    ).bind(new Date().toISOString(), text(error?.message || error).slice(0, 500), runId).run();
    throw error;
  }
  return getLatestMarketResearch(env, order, overrides);
}

async function ensureMarketLookupTables(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS market_lookup_runs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      car TEXT NOT NULL DEFAULT '',
      vin TEXT NOT NULL DEFAULT '',
      query TEXT NOT NULL DEFAULT '',
      part_number TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      item_count INTEGER NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'low',
      exact_offer_count INTEGER NOT NULL DEFAULT 0,
      offer_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      source_status_json TEXT NOT NULL DEFAULT '[]',
      offers_json TEXT NOT NULL DEFAULT '[]',
      linked_order_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT ''
    )`,
    "CREATE INDEX IF NOT EXISTS idx_market_lookup_runs_created ON market_lookup_runs(created_at DESC)",
  ];
  for (const statement of statements) await env.DB.prepare(statement).run();
}

async function lookupResult(env, row) {
  if (!row) return null;
  const { summary, offers } = await hydrateMarketResult(env, parseJson(row.summary_json, { items: [] }), parseJson(row.offers_json, []));
  const sources = parseJson(row.source_status_json, []);
  return {
    run: { ...row, summary, source_status: sources },
    offers,
    summary,
    sources,
    can_search: Boolean(text(row.query) || text(row.part_number)),
    should_refresh: false,
    item_limit: MAX_RESEARCH_ITEMS,
  };
}

export async function listMarketLookups(env, limit = 12) {
  await ensureMarketLookupTables(env);
  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const rows = await env.DB.prepare(
    `SELECT id, created_at, updated_at, status, car, vin, query, part_number,
      confidence, exact_offer_count, offer_count, summary_json, linked_order_id, error
    FROM market_lookup_runs ORDER BY created_at DESC LIMIT ?`
  ).bind(safeLimit).all();
  return (rows.results || []).map((row) => ({
    ...row,
    summary: parseJson(row.summary_json, { items: [] }),
  }));
}

export async function getMarketLookup(env, id) {
  await ensureMarketLookupTables(env);
  const row = await env.DB.prepare("SELECT * FROM market_lookup_runs WHERE id = ?").bind(text(id)).first();
  return lookupResult(env, row);
}

export async function runMarketLookup(env, input = {}) {
  await ensureMarketLookupTables(env);
  const lookup = {
    car: text(input.car).slice(0, 180),
    vin: text(input.vin).toUpperCase().slice(0, 40),
    query: text(input.query).slice(0, 300),
    part_number: text(input.part_number).slice(0, 100),
  };
  const virtualOrder = {
    id: "market-lookup",
    car: lookup.car,
    vin: lookup.vin,
    item_name: lookup.query || lookup.part_number,
    request_text: "",
  };
  const overrides = { query: lookup.query || lookup.part_number, part_number: lookup.part_number };
  const parsed = await enrichMarketItems(env, splitRequestedItems(virtualOrder, overrides));
  const allItems = parsed.items;
  const items = allItems.slice(0, MAX_RESEARCH_ITEMS);
  if (!items.length) {
    const error = new Error("Вкажіть запчастину або артикул.");
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const fingerprint = fingerprintFor(virtualOrder, allItems);
  await env.DB.prepare(
    `INSERT INTO market_lookup_runs (
      id, created_at, updated_at, status, car, vin, query, part_number, fingerprint, item_count
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  ).bind(runId, now, now, lookup.car, lookup.vin, lookup.query, lookup.part_number, fingerprint, items.length).run();

  try {
    const { offers: candidates, sources } = await researchMarketItems(items, COMPETITOR_SOURCES);
    const offers = await reviewMarketCandidates(env, items, candidates);
    const summary = {
      ...summarizeOffers(items, offers),
      matching_version: MARKET_MATCH_VERSION,
      ai_status: parsed.ai_status,
      offer_details: Object.fromEntries(offers.map(offer => [offerIdentity(offer), offer])),
      requested_item_count: allItems.length,
      ignored_item_count: Math.max(0, allItems.length - items.length),
      manual_query: true,
    };
    await env.DB.prepare(
      `UPDATE market_lookup_runs SET
        updated_at = ?, status = 'complete', confidence = ?, exact_offer_count = ?, offer_count = ?,
        summary_json = ?, source_status_json = ?, offers_json = ?, error = ''
      WHERE id = ?`
    ).bind(
      now,
      summary.confidence,
      summary.exact_offer_count,
      summary.offer_count,
      JSON.stringify(summary),
      JSON.stringify(sources),
      JSON.stringify(offers),
      runId,
    ).run();
    await env.DB.prepare(
      "DELETE FROM market_lookup_runs WHERE id NOT IN (SELECT id FROM market_lookup_runs ORDER BY created_at DESC LIMIT 100)"
    ).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE market_lookup_runs SET updated_at = ?, status = 'failed', error = ? WHERE id = ?"
    ).bind(new Date().toISOString(), text(error?.message || error).slice(0, 500), runId).run();
    throw error;
  }
  return getMarketLookup(env, runId);
}

export async function attachMarketLookupToOrder(env, lookupId, order) {
  await ensureMarketResearchTables(env);
  const lookup = await getMarketLookup(env, lookupId);
  if (!lookup || lookup.run.status !== "complete") {
    const error = new Error("Результат пошуку не знайдено або він ще не готовий.");
    error.status = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const summary = lookup.summary || { items: [] };
  const sources = lookup.sources || [];
  await env.DB.prepare(
    `INSERT INTO market_research_runs (
      id, order_id, created_at, updated_at, status, fingerprint, query, item_count,
      confidence, exact_offer_count, offer_count, summary_json, source_status_json, error
    ) VALUES (?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, '')`
  ).bind(
    runId,
    order.id,
    now,
    now,
    lookup.run.fingerprint || fingerprintFor(order, summary.items || []),
    lookup.run.query || "",
    Number(lookup.run.item_count || summary.item_count || 0),
    summary.confidence || "low",
    Number(summary.exact_offer_count || 0),
    Number(summary.offer_count || 0),
    JSON.stringify(summary),
    JSON.stringify(sources),
  ).run();

  const statements = (lookup.offers || []).map((offer) => env.DB.prepare(
    `INSERT INTO market_research_offers (
      id, run_id, order_id, item_key, item_label, created_at, source_key, source_name, source_url,
      product_url, title, price_uah, availability, availability_text, lead_time_min, lead_time_max,
      part_type, match_type, part_number, snippet
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), runId, order.id, offer.item_key || "item-1", offer.item_label || lookup.run.query || "Запчастина",
    now, offer.source_key || "", offer.source_name || "", offer.source_url || "", offer.product_url || "",
    offer.title || "", Number(offer.price_uah || 0), offer.availability || "unknown", offer.availability_text || "",
    offer.lead_time_min ?? null, offer.lead_time_max ?? null, offer.part_type || "unknown", offer.match_type || "probable",
    offer.part_number || "", offer.snippet || "",
  ));
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
  await env.DB.prepare("UPDATE market_lookup_runs SET linked_order_id = ?, updated_at = ? WHERE id = ?")
    .bind(order.id, now, lookup.run.id).run();
  return getLatestMarketResearch(env, order);
}
