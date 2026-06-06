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

  const campaigns = await env.DB.prepare(
    `SELECT
      COALESCE(NULLIF(campaign, ''), 'без кампанії') AS campaign,
      COALESCE(NULLIF(source, ''), 'direct') AS source,
      COUNT(*) AS orders,
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
    campaigns: campaigns.results,
    daily: daily.results.reverse(),
  });
}
