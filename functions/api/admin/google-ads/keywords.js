import { csv, escapeCsv, integer, json, rangeStart, text } from "../../../_lib/http.js";

const ORDER_COST_SQL = `
  COALESCE(revenue_uah, 0)
  - COALESCE(purchase_cost_uah, 0)
  - COALESCE(delivery_cost_uah, 0)
  - COALESCE(customs_cost_uah, 0)
  - COALESCE(processing_cost_uah, 0)
  - COALESCE(ad_cost_uah, 0)
  - COALESCE(other_cost_uah, 0)
`;

const PAID_STATUSES = new Set([
  "paid",
  "sourcing_china",
  "china_warehouse",
  "left_china",
  "in_ukraine",
  "ready_for_pickup",
  "completed",
]);

function isMissingTableError(error) {
  return /no such table: google_ads_keyword_stats|no such column/i.test(error?.message || String(error));
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function mapKey(campaign, term) {
  return `${normalizeKey(campaign)}::${normalizeKey(term)}`;
}

function emptyMetrics(extra = {}) {
  return {
    source: "google",
    campaign: "",
    term: "",
    leads: 0,
    orders: 0,
    paid_orders: 0,
    completed_orders: 0,
    revenue_uah: 0,
    gross_profit_uah: 0,
    ...extra,
  };
}

function addLead(map, row) {
  const term = text(row.term);
  if (!term) return;
  const campaign = text(row.campaign) || "без кампанії";
  const key = mapKey(campaign, term);
  const item = map.get(key) || emptyMetrics({ source: text(row.source) || "google", campaign, term });
  item.leads += Number(row.leads || 0);
  map.set(key, item);
}

function addOrder(map, row) {
  const term = text(row.term);
  if (!term) return;
  const campaign = text(row.campaign) || "без кампанії";
  const key = mapKey(campaign, term);
  const item = map.get(key) || emptyMetrics({ source: text(row.source) || "google", campaign, term });
  item.orders += Number(row.orders || 0);
  item.paid_orders += Number(row.paid_orders || 0);
  item.completed_orders += Number(row.completed_orders || 0);
  item.revenue_uah += Number(row.revenue_uah || 0);
  item.gross_profit_uah += Number(row.gross_profit_uah || 0);
  map.set(key, item);
}

function termOnlyMap(campaignTermMap) {
  const map = new Map();
  for (const item of campaignTermMap.values()) {
    const key = normalizeKey(item.term);
    const existing = map.get(key) || emptyMetrics({ source: item.source, campaign: "усі кампанії", term: item.term });
    existing.leads += item.leads;
    existing.orders += item.orders;
    existing.paid_orders += item.paid_orders;
    existing.completed_orders += item.completed_orders;
    existing.revenue_uah += item.revenue_uah;
    existing.gross_profit_uah += item.gross_profit_uah;
    map.set(key, existing);
  }
  return map;
}

function crmForStat(stat, campaignTermMap, termMap) {
  const terms = [
    stat.level === "search_term" ? stat.search_term : stat.keyword_text,
    stat.keyword_text,
    stat.search_term,
  ].filter(Boolean);
  const campaigns = [stat.campaign_id, stat.campaign, stat.campaign_name].filter(Boolean);

  for (const campaign of campaigns) {
    for (const term of terms) {
      const exact = campaignTermMap.get(mapKey(campaign, term));
      if (exact) return { ...exact, matched_by: "campaign_term" };
    }
  }

  for (const term of terms) {
    const fallback = termMap.get(normalizeKey(term));
    if (fallback) return { ...fallback, matched_by: "term_only" };
  }

  return emptyMetrics();
}

function recommendationFor(row) {
  const spend = Number(row.spend_uah || 0);
  const clicks = Number(row.clicks || 0);
  const value = Number(row.value_uah || 0);
  const profitRoas = Number(row.profit_roas || 0);

  if (spend > 0 && value > 0 && profitRoas >= 3) {
    return {
      code: "scale",
      label: "Масштабувати",
      reason: "Є маржа і profit ROAS вище 3x.",
    };
  }

  if (spend >= 500 && clicks >= 10 && value <= 0) {
    return {
      code: "negative_candidate",
      label: "Кандидат у мінус-слова",
      reason: "Є витрати та кліки, але немає маржі або оплат.",
    };
  }

  if (spend > 0 && value > 0 && profitRoas < 1) {
    return {
      code: "review",
      label: "Перевірити",
      reason: "Маржа нижча за витрати на рекламу.",
    };
  }

  if (value > 0 && spend <= 0) {
    return {
      code: "missing_cost",
      label: "Немає витрат",
      reason: "CRM бачить маржу, але Google Ads статистика ще не синхронізована.",
    };
  }

  return {
    code: "watch",
    label: "Спостерігати",
    reason: "Даних ще замало для рішення.",
  };
}

function enrichRow(row) {
  const spend = Number(row.spend_uah || 0);
  const leads = Number(row.leads || 0);
  const paidOrders = Number(row.paid_orders || 0);
  const crmProfit = Number(row.gross_profit_uah || 0);
  const googleValue = Number(row.google_conversion_value || 0);
  const value = crmProfit || googleValue;
  const result = {
    ...row,
    value_uah: value,
    cpl_uah: leads && spend ? spend / leads : 0,
    cpa_uah: paidOrders && spend ? spend / paidOrders : 0,
    roas: spend ? Number(row.revenue_uah || 0) / spend : 0,
    profit_roas: spend ? value / spend : 0,
    lead_to_paid_rate: leads ? paidOrders / leads : 0,
  };
  return {
    ...result,
    recommendation: recommendationFor(result),
  };
}

function whereForStats(url) {
  const clauses = [];
  const binds = [];
  const start = rangeStart(url.searchParams.get("range") || "30d")?.slice(0, 10);
  const level = text(url.searchParams.get("level"));
  const q = text(url.searchParams.get("q"));

  if (start) {
    clauses.push("stat_date >= ?");
    binds.push(start);
  }
  if (["keyword", "search_term"].includes(level)) {
    clauses.push("level = ?");
    binds.push(level);
  }
  if (q) {
    clauses.push(`(
      campaign_id LIKE ? OR campaign_name LIKE ? OR ad_group_name LIKE ?
      OR keyword_text LIKE ? OR search_term LIKE ? OR match_type LIKE ?
    )`);
    binds.push(...Array(6).fill(`%${q}%`));
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    binds,
    start,
    q,
  };
}

async function loadCrmMaps(env, start) {
  const campaignTermMap = new Map();
  const leadWhere = start ? "WHERE created_at >= ?" : "";
  const orderWhere = start ? "WHERE created_at >= ?" : "";
  const leadBinds = start ? [new Date(`${start}T00:00:00.000Z`).toISOString()] : [];
  const orderBinds = leadBinds;

  const leads = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(source, ''), 'google') AS source,
      COALESCE(NULLIF(campaign, ''), 'без кампанії') AS campaign,
      term,
      COUNT(*) AS leads
    FROM leads ${leadWhere}
    WHERE_PLACEHOLDER
    GROUP BY COALESCE(NULLIF(source, ''), 'google'), COALESCE(NULLIF(campaign, ''), 'без кампанії'), term`
      .replace("WHERE_PLACEHOLDER", leadWhere ? "AND COALESCE(term, '') <> ''" : "WHERE COALESCE(term, '') <> ''")
  )
    .bind(...leadBinds)
    .all();

  const orders = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(source, ''), 'google') AS source,
      COALESCE(NULLIF(campaign, ''), 'без кампанії') AS campaign,
      term,
      COUNT(*) AS orders,
      SUM(CASE WHEN status IN (${Array.from(PAID_STATUSES).map(() => "?").join(", ")}) THEN 1 ELSE 0 END) AS paid_orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
      COALESCE(SUM(revenue_uah), 0) AS revenue_uah,
      COALESCE(SUM(${ORDER_COST_SQL}), 0) AS gross_profit_uah
    FROM orders ${orderWhere}
    WHERE_PLACEHOLDER
    GROUP BY COALESCE(NULLIF(source, ''), 'google'), COALESCE(NULLIF(campaign, ''), 'без кампанії'), term`
      .replace("WHERE_PLACEHOLDER", orderWhere ? "AND COALESCE(term, '') <> ''" : "WHERE COALESCE(term, '') <> ''")
  )
    .bind(...Array.from(PAID_STATUSES), ...(start ? [new Date(`${start}T00:00:00.000Z`).toISOString()] : []))
    .all();

  for (const row of leads.results || []) addLead(campaignTermMap, row);
  for (const row of orders.results || []) addOrder(campaignTermMap, row);

  return {
    campaignTermMap,
    termMap: termOnlyMap(campaignTermMap),
  };
}

async function loadStats(env, url) {
  const { where, binds, start, q } = whereForStats(url);
  const limit = Math.min(Math.max(integer(url.searchParams.get("limit")) || 100, 1), 500);

  const stats = await env.DB.prepare(
    `SELECT
      level,
      COALESCE(NULLIF(campaign_id, ''), NULLIF(campaign, ''), NULLIF(campaign_name, ''), 'без кампанії') AS campaign,
      campaign_id,
      campaign_name,
      ad_group_id,
      ad_group_name,
      criterion_id,
      keyword_text,
      match_type,
      search_term,
      COALESCE(SUM(spend_uah), 0) AS spend_uah,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(google_conversions), 0) AS google_conversions,
      COALESCE(SUM(google_conversion_value), 0) AS google_conversion_value,
      MAX(currency_code) AS currency_code
    FROM google_ads_keyword_stats ${where}
    GROUP BY
      level, campaign, campaign_id, campaign_name, ad_group_id, ad_group_name,
      criterion_id, keyword_text, match_type, search_term
    ORDER BY spend_uah DESC, clicks DESC
    LIMIT ?`
  )
    .bind(...binds, limit)
    .all();

  return { stats: stats.results || [], start, q, limit };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const wantsCsv = url.searchParams.get("format") === "csv";

  try {
    const { stats, start, q, limit } = await loadStats(env, url);
    const { campaignTermMap, termMap } = await loadCrmMaps(env, start);
    const rows = [];
    const seenCrmKeys = new Set();

    for (const stat of stats) {
      const crm = crmForStat(stat, campaignTermMap, termMap);
      if (crm.term && crm.matched_by === "term_only") {
        for (const [key, item] of campaignTermMap.entries()) {
          if (normalizeKey(item.term) === normalizeKey(crm.term)) seenCrmKeys.add(key);
        }
      } else if (crm.term) {
        seenCrmKeys.add(mapKey(crm.campaign, crm.term));
      }
      rows.push(enrichRow({
        ...stat,
        source: "google",
        term: stat.level === "search_term" ? text(stat.search_term || stat.keyword_text) : text(stat.keyword_text || stat.search_term),
        crm_match: crm.matched_by || "",
        leads: crm.leads,
        orders: crm.orders,
        paid_orders: crm.paid_orders,
        completed_orders: crm.completed_orders,
        revenue_uah: crm.revenue_uah,
        gross_profit_uah: crm.gross_profit_uah,
      }));
    }

    for (const [key, crm] of campaignTermMap.entries()) {
      if (seenCrmKeys.has(key)) continue;
      if (q && !`${crm.campaign} ${crm.term}`.toLowerCase().includes(q.toLowerCase())) continue;
      rows.push(enrichRow({
        level: "utm_term",
        source: crm.source || "google",
        campaign: crm.campaign,
        campaign_id: crm.campaign,
        campaign_name: "",
        ad_group_id: "",
        ad_group_name: "",
        criterion_id: "",
        keyword_text: crm.term,
        match_type: "",
        search_term: "",
        term: crm.term,
        spend_uah: 0,
        clicks: 0,
        impressions: 0,
        google_conversions: 0,
        google_conversion_value: 0,
        currency_code: "UAH",
        crm_match: "utm_term_only",
        leads: crm.leads,
        orders: crm.orders,
        paid_orders: crm.paid_orders,
        completed_orders: crm.completed_orders,
        revenue_uah: crm.revenue_uah,
        gross_profit_uah: crm.gross_profit_uah,
      }));
    }

    rows.sort((a, b) =>
      Number(b.spend_uah || 0) - Number(a.spend_uah || 0) ||
      Number(b.value_uah || 0) - Number(a.value_uah || 0) ||
      Number(b.clicks || 0) - Number(a.clicks || 0)
    );

    const summary = rows.reduce(
      (total, row) => {
        total.rows += 1;
        total.spend_uah += Number(row.spend_uah || 0);
        total.clicks += Number(row.clicks || 0);
        total.impressions += Number(row.impressions || 0);
        total.leads += Number(row.leads || 0);
        total.paid_orders += Number(row.paid_orders || 0);
        total.revenue_uah += Number(row.revenue_uah || 0);
        total.gross_profit_uah += Number(row.gross_profit_uah || 0);
        total.value_uah += Number(row.value_uah || 0);
        if (row.recommendation?.code === "negative_candidate") total.negative_candidates += 1;
        if (row.recommendation?.code === "scale") total.scale_candidates += 1;
        return total;
      },
      {
        rows: 0,
        spend_uah: 0,
        clicks: 0,
        impressions: 0,
        leads: 0,
        paid_orders: 0,
        revenue_uah: 0,
        gross_profit_uah: 0,
        value_uah: 0,
        negative_candidates: 0,
        scale_candidates: 0,
      }
    );
    summary.profit_roas = summary.spend_uah ? summary.value_uah / summary.spend_uah : 0;

    if (wantsCsv) {
      const columns = [
        "level",
        "campaign_id",
        "campaign_name",
        "ad_group_name",
        "keyword_text",
        "match_type",
        "search_term",
        "spend_uah",
        "clicks",
        "impressions",
        "leads",
        "paid_orders",
        "revenue_uah",
        "gross_profit_uah",
        "google_conversion_value",
        "value_uah",
        "profit_roas",
        "recommendation",
        "reason",
      ];
      const body = [
        columns.join(","),
        ...rows.map((row) => columns.map((column) => {
          if (column === "recommendation") return escapeCsv(row.recommendation?.label);
          if (column === "reason") return escapeCsv(row.recommendation?.reason);
          return escapeCsv(row[column]);
        }).join(",")),
      ].join("\n");
      return csv(body, "evline-google-ads-keywords.csv");
    }

    return json({
      migration_required: false,
      range: url.searchParams.get("range") || "30d",
      summary,
      keywords: rows.slice(0, limit),
      limit,
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return json({
        migration_required: true,
        summary: {
          rows: 0,
          spend_uah: 0,
          clicks: 0,
          impressions: 0,
          leads: 0,
          paid_orders: 0,
          revenue_uah: 0,
          gross_profit_uah: 0,
          value_uah: 0,
          profit_roas: 0,
          negative_candidates: 0,
          scale_candidates: 0,
        },
        keywords: [],
        error: "google_ads_keyword_stats_missing",
      });
    }
    throw error;
  }
}
