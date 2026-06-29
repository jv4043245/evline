import { json, rangeStart } from "../../_lib/http.js";

function whereForRange(start, field = "created_at") {
  return start ? `WHERE ${field} >= ?` : "";
}

function bindForRange(start) {
  return start ? [start] : [];
}

const orderCostSql = `
  COALESCE(purchase_cost_uah, 0)
  + COALESCE(delivery_cost_uah, 0)
  + COALESCE(customs_cost_uah, 0)
  + COALESCE(processing_cost_uah, 0)
  + COALESCE(ad_cost_uah, 0)
  + COALESCE(other_cost_uah, 0)
`;

function campaignKey(row) {
  return `${row.source || "direct"}::${row.campaign || "без кампанії"}`;
}

function ensureCampaign(map, row = {}) {
  const source = row.source || "direct";
  const campaign = row.campaign || "без кампанії";
  const key = campaignKey({ source, campaign });
  if (!map.has(key)) {
    map.set(key, {
      source,
      campaign,
      leads: 0,
      orders: 0,
      paid_orders: 0,
      completed_orders: 0,
      revenue_uah: 0,
      gross_profit_uah: 0,
      ad_spend_uah: 0,
      clicks: 0,
      impressions: 0,
      cpl_uah: 0,
      cpa_uah: 0,
      roas: 0,
      profit_roas: 0,
      lead_to_paid_rate: 0,
    });
  }
  return map.get(key);
}

function buildCampaignReport({ leads = [], orders = [], costs = [] }) {
  const map = new Map();

  for (const row of leads) {
    const item = ensureCampaign(map, row);
    item.leads += Number(row.leads || 0);
  }

  for (const row of orders) {
    const item = ensureCampaign(map, row);
    item.orders += Number(row.orders || 0);
    item.paid_orders += Number(row.paid_orders || 0);
    item.completed_orders += Number(row.completed_orders || 0);
    item.revenue_uah += Number(row.revenue_uah || 0);
    item.gross_profit_uah += Number(row.gross_profit_uah || 0);
  }

  for (const row of costs) {
    const item = ensureCampaign(map, row);
    item.ad_spend_uah += Number(row.ad_spend_uah || 0);
    item.clicks += Number(row.clicks || 0);
    item.impressions += Number(row.impressions || 0);
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      cpl_uah: item.leads && item.ad_spend_uah ? item.ad_spend_uah / item.leads : 0,
      cpa_uah: item.paid_orders && item.ad_spend_uah ? item.ad_spend_uah / item.paid_orders : 0,
      roas: item.ad_spend_uah ? item.revenue_uah / item.ad_spend_uah : 0,
      profit_roas: item.ad_spend_uah ? item.gross_profit_uah / item.ad_spend_uah : 0,
      lead_to_paid_rate: item.leads ? item.paid_orders / item.leads : 0,
    }))
    .sort((a, b) =>
      (b.ad_spend_uah || 0) - (a.ad_spend_uah || 0) ||
      (b.gross_profit_uah || 0) - (a.gross_profit_uah || 0) ||
      (b.orders || 0) - (a.orders || 0) ||
      (b.leads || 0) - (a.leads || 0)
    )
    .slice(0, 20);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d";
  const start = rangeStart(range);
  const leadWhere = whereForRange(start);
  const orderWhere = whereForRange(start);
  const costWhere = whereForRange(start?.slice(0, 10), "cost_date");

  const leadTotals = await env.DB.prepare(
    `SELECT
      COUNT(*) AS leads,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_leads,
      SUM(CASE WHEN quality = 'high' THEN 1 ELSE 0 END) AS high_quality
    FROM leads ${leadWhere}`
  )
    .bind(...bindForRange(start))
    .first();

  const orderTotals = await env.DB.prepare(
    `SELECT
      COUNT(*) AS orders,
      SUM(CASE WHEN status NOT IN ('completed', 'canceled') THEN 1 ELSE 0 END) AS active_orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
      SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled_orders,
      COALESCE(SUM(revenue_uah), 0) AS revenue_uah,
      COALESCE(SUM(purchase_cost_uah), 0) AS purchase_cost_uah,
      COALESCE(SUM(delivery_cost_uah), 0) AS delivery_cost_uah,
      COALESCE(SUM(customs_cost_uah), 0) AS customs_cost_uah,
      COALESCE(SUM(processing_cost_uah), 0) AS processing_cost_uah,
      COALESCE(SUM(ad_cost_uah), 0) AS attributed_ad_cost_uah,
      COALESCE(SUM(other_cost_uah), 0) AS other_cost_uah,
      COALESCE(SUM(${orderCostSql}), 0) AS total_order_cost_uah,
      COALESCE(SUM(COALESCE(revenue_uah, 0) - (${orderCostSql})), 0) AS gross_profit_uah,
      COALESCE(AVG(CASE WHEN revenue_uah > 0 THEN revenue_uah END), 0) AS avg_order_uah,
      COALESCE(AVG(NULLIF(processing_cost_uah, 0)), 0) AS avg_processing_cost_uah
    FROM orders ${orderWhere}`
  )
    .bind(...bindForRange(start))
    .first();

  const costs = await env.DB.prepare(
    `SELECT
      COALESCE(SUM(spend_uah), 0) AS ad_spend_uah,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(impressions), 0) AS impressions
    FROM ad_costs ${costWhere}`
  )
    .bind(...bindForRange(start?.slice(0, 10)))
    .first();

  const sources = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(source, ''), 'direct') AS source,
      COUNT(*) AS orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
      COALESCE(SUM(revenue_uah), 0) AS revenue_uah,
      COALESCE(SUM(COALESCE(revenue_uah, 0) - (${orderCostSql})), 0) AS gross_profit_uah
    FROM orders ${orderWhere}
    GROUP BY COALESCE(NULLIF(source, ''), 'direct')
    ORDER BY orders DESC
    LIMIT 12`
  )
    .bind(...bindForRange(start))
    .all();

  const campaignOrders = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(campaign, ''), 'без кампанії') AS campaign,
      COALESCE(NULLIF(source, ''), 'direct') AS source,
      COUNT(*) AS orders,
      SUM(CASE WHEN status IN ('paid', 'sourcing_china', 'china_warehouse', 'left_china', 'in_ukraine', 'ready_for_pickup', 'completed') THEN 1 ELSE 0 END) AS paid_orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
      COALESCE(SUM(revenue_uah), 0) AS revenue_uah,
      COALESCE(SUM(COALESCE(revenue_uah, 0) - (${orderCostSql})), 0) AS gross_profit_uah
    FROM orders ${orderWhere}
    GROUP BY COALESCE(NULLIF(campaign, ''), 'без кампанії'), COALESCE(NULLIF(source, ''), 'direct')
    ORDER BY orders DESC
    LIMIT 20`
  )
    .bind(...bindForRange(start))
    .all();

  const campaignLeads = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(campaign, ''), 'без кампанії') AS campaign,
      COALESCE(NULLIF(source, ''), 'direct') AS source,
      COUNT(*) AS leads
    FROM leads ${leadWhere}
    GROUP BY COALESCE(NULLIF(campaign, ''), 'без кампанії'), COALESCE(NULLIF(source, ''), 'direct')`
  )
    .bind(...bindForRange(start))
    .all();

  const campaignCosts = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(campaign, ''), 'без кампанії') AS campaign,
      COALESCE(NULLIF(source, ''), 'direct') AS source,
      COALESCE(SUM(spend_uah), 0) AS ad_spend_uah,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(impressions), 0) AS impressions
    FROM ad_costs ${costWhere}
    GROUP BY COALESCE(NULLIF(campaign, ''), 'без кампанії'), COALESCE(NULLIF(source, ''), 'direct')`
  )
    .bind(...bindForRange(start?.slice(0, 10)))
    .all();

  const daily = await env.DB.prepare(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
      COALESCE(SUM(revenue_uah), 0) AS revenue_uah,
      COALESCE(SUM(COALESCE(revenue_uah, 0) - (${orderCostSql})), 0) AS gross_profit_uah
    FROM orders ${orderWhere}
    GROUP BY substr(created_at, 1, 10)
    ORDER BY day DESC
    LIMIT 30`
  )
    .bind(...bindForRange(start))
    .all();

  const leads = Number(leadTotals.leads || 0);
  const completed = Number(orderTotals.completed_orders || 0);
  const orders = Number(orderTotals.orders || 0);
  const adSpend = Number(costs.ad_spend_uah || 0);
  const revenue = Number(orderTotals.revenue_uah || 0);
  const grossProfit = Number(orderTotals.gross_profit_uah || 0);
  const campaigns = buildCampaignReport({
    leads: campaignLeads.results,
    orders: campaignOrders.results,
    costs: campaignCosts.results,
  });

  return json({
    range,
    totals: {
      ...leadTotals,
      ...orderTotals,
      ...costs,
      close_rate: leads ? completed / leads : 0,
      order_completion_rate: orders ? completed / orders : 0,
      cpl_uah: leads && adSpend ? adSpend / leads : 0,
      cpa_uah: completed && adSpend ? adSpend / completed : 0,
      roas: adSpend ? revenue / adSpend : 0,
      profit_roas: adSpend ? grossProfit / adSpend : 0,
    },
    sources: sources.results,
    campaigns,
    daily: daily.results.reverse(),
  });
}
