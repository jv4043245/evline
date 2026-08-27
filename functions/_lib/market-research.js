import { text } from "./http.js";

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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanText(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

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
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(compact)) return false;
    return true;
  }))].slice(0, 8);
}

function cleanItemLabel(value) {
  return text(value)
    .replace(/^(?:запчастина|запчасть|деталь|послуга|услуга|запчастина\s*\/\s*послуга)\s*:\s*/iu, "")
    .replace(/^[-–—•\d.)\s]+/, "")
    .trim();
}

function stripVinIdentifiers(value, knownVin = "") {
  const known = text(knownVin).trim();
  let result = String(value || "");
  if (known) result = result.replaceAll(known, " ");
  return result.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/giu, " ").replace(/\s+/g, " ").trim();
}

export function splitRequestedItems(order = {}, overrides = {}) {
  const manualQuery = stripVinIdentifiers(cleanItemLabel(overrides.query || ""), order.vin);
  const source = manualQuery || stripVinIdentifiers(cleanItemLabel(order.item_name || order.service_name || order.request_text || ""), order.vin);
  if (!source) return [];
  let parts = source.split(/[\n;•]+/).map(cleanItemLabel).filter(Boolean);
  if (parts.length === 1 && (source.match(/,/g) || []).length > 0 && (source.match(/,/g) || []).length <= 5) {
    parts = source.split(/,/).map(cleanItemLabel).filter(Boolean);
  }
  const fullContext = [order.item_name, order.request_text, overrides.part_number].filter(Boolean).join(" ");
  const allPartNumbers = extractPartNumbers(fullContext, order.vin);
  const car = text(order.car);
  return [...new Set(parts)].map((label, index) => {
    const safeLabel = stripVinIdentifiers(label, order.vin);
    const localPartNumbers = extractPartNumbers(`${label} ${overrides.part_number || ""}`, order.vin);
    const partNumbers = localPartNumbers.length ? localPartNumbers : (parts.length === 1 ? allPartNumbers : []);
    const query = partNumbers[0] || [car, safeLabel].filter(Boolean).join(" ");
    return {
      key: `item-${index + 1}`,
      label: safeLabel,
      query: text(query).slice(0, 180),
      part_numbers: partNumbers,
      item_tokens: meaningfulTokens(safeLabel),
      car_tokens: meaningfulTokens(car),
    };
  });
}

function numericPrice(value) {
  const normalized = String(value || "").replace(/[^\d.,]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/\.(?=.*\.)/g, "");
  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 10 && parsed <= 10000000 ? parsed : 0;
}

function extractPrice(value) {
  const content = cleanText(value);
  const currencyMatch = content.match(/(?:₴|грн|UAH)\s*([\d\s.,]{2,16})|([\d][\d\s.,]{1,15})\s*(?:₴|грн|UAH)/iu);
  return numericPrice(currencyMatch?.[1] || currencyMatch?.[2] || "");
}

function firstMatch(value, pattern) {
  return cleanText(String(value || "").match(pattern)?.[1] || "");
}

function segments(html, marker) {
  return String(html || "").split(marker).slice(1).map((part) => marker + part);
}

function candidateFromSegment(segment, baseUrl, selectors = {}) {
  const hrefMatch = segment.match(selectors.href || /<a[^>]+href=["']([^"']+)["'][^>]*>/i);
  const title = firstMatch(segment, selectors.title || /<a[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  const article = firstMatch(segment, selectors.article || /(?:Арт\.?|Артикул|Код|SKU|vendor-code)[^<:]*:?\s*(?:<[^>]+>)*\s*([^<\n]{4,40})/iu);
  const availabilityText = firstMatch(segment, selectors.availability || /(?:status|наявност|налич)[^>]*>([\s\S]*?)<\//iu);
  const price = extractPrice(selectors.price ? (segment.match(selectors.price)?.[1] || "") : segment);
  if (!title || !price) return null;
  return {
    title,
    article,
    price_uah: price,
    product_url: absoluteUrl(hrefMatch?.[1] || baseUrl, baseUrl),
    availability_text: availabilityText,
    context: cleanText(segment).slice(0, 900),
  };
}

function parseHoroshop(html, baseUrl) {
  const marker = "var products = [";
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const arrayStart = start + marker.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = arrayStart; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (!depth) {
        end = index + 1;
        break;
      }
    }
  }
  if (end < 0) return [];
  try {
    const rows = JSON.parse(html.slice(arrayStart, end));
    return rows.map((row) => ({
      title: text(row.title),
      article: text(row.article_for_display || row.article),
      price_uah: numericPrice(row.price),
      product_url: absoluteUrl(row.url || baseUrl, baseUrl),
      availability_text: row.in_stock ? "В наявності" : "Під замовлення",
      context: [row.title, row.article_for_display, row.brand_title].filter(Boolean).join(" "),
    })).filter((row) => row.title && row.price_uah);
  } catch {
    return [];
  }
}

function parseNcars(html, baseUrl) {
  return segments(html, '<div class="listChargers_item')
    .slice(0, 80)
    .map((segment) => {
      const block = segment.slice(0, 7000);
      const title = decodeHtml(block.match(/data-item-name=["']([^"']+)["']/i)?.[1] || "");
      const price = numericPrice(block.match(/data-item-price=["']([^"']+)["']/i)?.[1] || "") || extractPrice(block);
      const href = block.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*(?:listChargers_thumb|listChargers_title)/i)?.[1];
      return {
        title: cleanText(title),
        article: firstMatch(block, /class=["']label__sku["'][^>]*>([\s\S]*?)<\//i),
        price_uah: price,
        product_url: absoluteUrl(href || baseUrl, baseUrl),
        availability_text: firstMatch(block, /class=["']label__stock[^"']*["'][^>]*>([\s\S]*?)<\//i),
        context: cleanText(block).slice(0, 900),
      };
    })
    .filter((row) => row.title && row.price_uah);
}

function parseKitaec(html, baseUrl) {
  return segments(html, '<div class="kc__card"')
    .slice(0, 80)
    .map((segment) => candidateFromSegment(segment.slice(0, 16000), baseUrl, {
      href: /<a[^>]+href=["']([^"']+)["'][^>]*(?:aria-label|title)=/i,
      title: /<div class=["']kc__name["'][^>]*>([\s\S]*?)<\/div>/i,
      article: /<div class=["']kc__code["'][^>]*>[\s\S]*?<span[^>]*>[^<]*<\/span>\s*([^<]+)/i,
      availability: /<div class=["']item[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      price: /<div class=["']base["'][^>]*>([\s\S]*?)<\/div>/i,
    }))
    .filter(Boolean);
}

function parseMahina(html, baseUrl) {
  return segments(html, '<div class="product-card">')
    .slice(0, 100)
    .map((segment) => candidateFromSegment(segment.slice(0, 24000), baseUrl, {
      href: /<a class=["'][^"']*product-card__name[^"']*["'][^>]*[\s\S]*?href=["']([^"']+)["']/i,
      title: /<a class=["'][^"']*product-card__name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      article: /class=["'][^"']*product-card__vendor-code[^"']*["'][^>]*[^>]*>([\s\S]*?)<\/div>/i,
      availability: /class=["'][^"']*site-status__txt[^"']*["'][^>]*>([\s\S]*?)<\//i,
      price: /class=["'][^"']*site-price__item[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    }))
    .filter(Boolean);
}

function parsePanda(html, baseUrl) {
  return segments(html, '<div class="catalog__product')
    .slice(0, 100)
    .map((segment) => candidateFromSegment(segment.slice(0, 18000), baseUrl, {
      href: /<div class=["']product__title["'][^>]*>[\s\S]*?<a href=["']([^"']+)["']/i,
      title: /<div class=["']product__title["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      article: /class=["']product__vendor-code["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      availability: /class=["'][^"']*product__status[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
      price: /class=["'][^"']*product__prices-numbers[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    }))
    .filter(Boolean);
}

function collectObjects(value, output = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (value.name && (value.price || value.discountedPrice || value.offers?.price)) output.push(value);
  if (Array.isArray(value)) value.forEach((entry) => collectObjects(entry, output, seen));
  else Object.values(value).forEach((entry) => collectObjects(entry, output, seen));
  return output;
}

function parseJsonProducts(html, baseUrl) {
  const output = [];
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      for (const row of collectObjects(JSON.parse(match[1]))) {
        const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers || {};
        output.push({
          title: text(row.name),
          article: text(row.sku || row.mpn),
          price_uah: numericPrice(row.price || row.discountedPrice || offer.price),
          product_url: absoluteUrl(row.url || offer.url || baseUrl, baseUrl),
          availability_text: text(offer.availability || row.availability),
          context: [row.name, row.sku, row.mpn, row.brand?.name || row.brand].filter(Boolean).join(" "),
        });
      }
    } catch {
      // A malformed optional JSON-LD block should not fail the source.
    }
  }
  const apollo = html.match(/window\.ApolloCacheState\s*=\s*([\s\S]*?);\s*<\/script>/i)?.[1];
  if (apollo) {
    try {
      for (const row of collectObjects(JSON.parse(apollo))) {
        const id = text(row.id);
        const slug = text(row.urlText);
        output.push({
          title: text(row.name),
          article: text(row.sku),
          price_uah: numericPrice(row.price || row.discountedPrice),
          product_url: id && slug ? `https://prom.ua/ua/p${id}-${slug}.html` : baseUrl,
          availability_text: text(row.catalogPresence?.title || row.presence?.presence),
          context: [row.name, row.sku, row.company?.name].filter(Boolean).join(" "),
        });
      }
    } catch {
      // Prom can change the embedded state independently of the visible page.
    }
  }
  return output.filter((row) => row.title && row.price_uah);
}

function parseGenericAnchors(html, baseUrl) {
  const rows = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) && rows.length < 160) {
    const title = cleanText(match[2]);
    if (title.length < 4 || title.length > 220) continue;
    const context = html.slice(Math.max(0, match.index - 250), Math.min(html.length, anchorPattern.lastIndex + 1600));
    const price = extractPrice(context);
    if (!price) continue;
    rows.push({
      title,
      article: firstMatch(context, /(?:Арт\.?|Артикул|Код|SKU)[^<:]*:?\s*(?:<[^>]+>)*\s*([^<\n]{4,40})/iu),
      price_uah: price,
      product_url: absoluteUrl(match[1], baseUrl),
      availability_text: firstMatch(context, /(В наявності|В наличии|Готово до відправки|Під замовлення|Передзамовлення|Очікування[^<]{0,30}|Немає в наявності|Нет в наличии)/iu),
      context: cleanText(context).slice(0, 900),
    });
  }
  return rows;
}

export function parseSourceHtml(sourceKey, html, baseUrl) {
  const parsers = {
    mahina: parseMahina,
    ncars: parseNcars,
    evox: parseHoroshop,
    auto_china: parseHoroshop,
    kitaec: parseKitaec,
    panda: parsePanda,
  };
  const candidates = [
    ...(parsers[sourceKey]?.(html, baseUrl) || []),
    ...parseJsonProducts(html, baseUrl),
    ...parseGenericAnchors(html, baseUrl),
  ];
  const seen = new Set();
  return candidates.filter((row) => {
    const key = `${normalizeCompact(row.product_url)}|${normalizeCompact(row.title)}|${row.price_uah}`;
    if (!row.price_uah || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  const haystack = normalizeCompact([candidate.title, candidate.article, candidate.context].join(" "));
  const exact = item.part_numbers.some((partNumber) => haystack.includes(normalizeCompact(partNumber)));
  if (exact) return "exact";
  const candidateTokens = new Set(meaningfulTokens([candidate.title, candidate.article, candidate.context].join(" ")));
  const itemMatches = item.item_tokens.filter((token) => candidateTokens.has(token)).length;
  const carMatches = item.car_tokens.filter((token) => candidateTokens.has(token)).length;
  if (itemMatches >= 1 && (carMatches >= 1 || item.item_tokens.length === 1)) return "probable";
  return "irrelevant";
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeOffers(items, offers) {
  const summaries = items.map((item) => {
    const rows = offers.filter((offer) => offer.item_key === item.key);
    const exact = rows.filter((offer) => offer.match_type === "exact");
    const priced = exact.length >= 3 ? exact : rows;
    const prices = priced.map((offer) => Number(offer.price_uah)).filter((price) => price > 0);
    return {
      key: item.key,
      label: item.label,
      query: item.query,
      part_numbers: item.part_numbers,
      offer_count: rows.length,
      exact_offer_count: exact.length,
      confidence: exact.length >= 3 ? "high" : "low",
      min_uah: prices.length ? Math.min(...prices) : 0,
      median_uah: median(prices),
      average_uah: prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0,
      max_uah: prices.length ? Math.max(...prices) : 0,
    };
  });
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
  const summary = parseJson(run.summary_json, { items: [] });
  const updatedAt = Date.parse(run.updated_at || run.created_at || 0);
  const stale = !updatedAt || Date.now() - updatedAt > MARKET_RESEARCH_TTL_MS;
  return {
    run: { ...run, summary, source_status: parseJson(run.source_status_json, []) },
    offers: rows.results || [],
    summary,
    sources: parseJson(run.source_status_json, []),
    can_search: Boolean(items.length),
    should_refresh: Boolean(items.length) && (run.status !== "complete" || stale || (!summary.manual_query && run.fingerprint !== fingerprint)),
    item_limit: MAX_RESEARCH_ITEMS,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSource(source, query) {
  const searchUrl = source.search(query);
  const headers = {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "uk-UA,uk;q=0.9,ru;q=0.7,en;q=0.5",
    "user-agent": "Mozilla/5.0 (compatible; EVLineMarketResearch/1.0; +https://evline.com.ua/)",
  };
  let response = await fetchWithTimeout(searchUrl, { headers, redirect: "follow" });
  let body = await response.text();
  const challengeHash = body.match(/const\s+defaultHash\s*=\s*["']([^"']+)["']/i)?.[1];
  if (challengeHash && body.includes("challenge_passed")) {
    response = await fetchWithTimeout(searchUrl, { headers: { ...headers, cookie: `challenge_passed=${challengeHash}` }, redirect: "follow" });
    body = await response.text();
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { body, searchUrl, finalUrl: response.url || searchUrl };
}

async function researchItem(item) {
  const tasks = COMPETITOR_SOURCES.map(async (source) => {
    try {
      const fetched = await fetchSource(source, item.query);
      const candidates = parseSourceHtml(source.key, fetched.body, fetched.finalUrl);
      const offers = candidates.map((candidate) => {
        const matchType = classifyMatch(candidate, item);
        if (matchType === "irrelevant") return null;
        const availabilityText = candidate.availability_text || candidate.context;
        const [leadTimeMin, leadTimeMax] = extractLeadTime(availabilityText);
        return {
          item_key: item.key,
          item_label: item.label,
          source_key: source.key,
          source_name: source.name,
          source_url: fetched.searchUrl,
          product_url: candidate.product_url || fetched.searchUrl,
          title: candidate.title,
          price_uah: candidate.price_uah,
          availability: classifyAvailability(availabilityText),
          availability_text: text(candidate.availability_text).slice(0, 120),
          lead_time_min: leadTimeMin,
          lead_time_max: leadTimeMax,
          part_type: classifyPartType([candidate.title, candidate.article, candidate.context].join(" ")),
          match_type: matchType,
          part_number: text(candidate.article).slice(0, 80),
          snippet: text(candidate.context).slice(0, 260),
        };
      }).filter(Boolean).sort((left, right) => (left.match_type === right.match_type ? left.price_uah - right.price_uah : left.match_type === "exact" ? -1 : 1)).slice(0, 6);
      return {
        offers,
        source: { key: source.key, name: source.name, url: fetched.searchUrl, status: "ok", count: offers.length, parsed_count: candidates.length, error: "" },
      };
    } catch (error) {
      return {
        offers: [],
        source: { key: source.key, name: source.name, url: source.home, status: "failed", count: 0, parsed_count: 0, error: text(error?.message || error).slice(0, 180) },
      };
    }
  });
  const results = await Promise.all(tasks);
  const offers = results.flatMap((result) => result.offers)
    .sort((left, right) => (left.match_type === right.match_type ? left.price_uah - right.price_uah : left.match_type === "exact" ? -1 : 1))
    .slice(0, 40);
  return {
    offers,
    sources: results.map((result) => ({ ...result.source, item_key: item.key, item_label: item.label })),
  };
}

export async function runMarketResearch(env, order, overrides = {}) {
  await ensureMarketResearchTables(env);
  const allItems = splitRequestedItems(order, overrides);
  const items = allItems.slice(0, MAX_RESEARCH_ITEMS);
  if (!items.length) {
    const error = new Error("Вкажіть запчастину або пошуковий запит.");
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const fingerprint = fingerprintFor(order, allItems);
  await env.DB.prepare(
    `INSERT INTO market_research_runs (
      id, order_id, created_at, updated_at, status, fingerprint, query, item_count
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(runId, order.id, now, now, fingerprint, items.map((item) => item.query).join(" | "), items.length).run();

  try {
    const results = await Promise.all(items.map(researchItem));
    const offers = results.flatMap((result) => result.offers);
    const sources = results.flatMap((result) => result.sources);
    const summary = {
      ...summarizeOffers(items, offers),
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
