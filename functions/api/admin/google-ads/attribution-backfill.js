import { inferAttribution } from "../../../_lib/attribution.js";
import { json, text } from "../../../_lib/http.js";

function shouldUpdate(row, attribution) {
  if (!attribution.has_google_click) return false;
  return (
    text(row.source) !== "google" ||
    text(row.medium) !== "cpc" ||
    (!text(row.campaign) && text(attribution.campaign)) ||
    (!text(row.term) && text(attribution.term)) ||
    (!text(row.content) && text(attribution.content)) ||
    (!text(row.gclid) && text(attribution.gclid)) ||
    (!text(row.gbraid) && text(attribution.gbraid)) ||
    (!text(row.wbraid) && text(attribution.wbraid))
  );
}

async function backfillTable(env, table) {
  const rows = await env.DB.prepare(
    `SELECT id, source, medium, campaign, term, content, gclid, gbraid, wbraid, fbclid, landing_page, referrer
     FROM ${table}
     WHERE (
       COALESCE(landing_page, '') LIKE '%gclid=%'
       OR COALESCE(landing_page, '') LIKE '%gbraid=%'
       OR COALESCE(landing_page, '') LIKE '%wbraid=%'
       OR COALESCE(landing_page, '') LIKE '%gad_campaignid=%'
       OR COALESCE(referrer, '') LIKE '%google.%'
     )
     ORDER BY created_at DESC
     LIMIT 500`
  ).all();

  let scanned = 0;
  let updated = 0;
  const examples = [];
  const now = new Date().toISOString();

  for (const row of rows.results || []) {
    scanned += 1;
    const attribution = inferAttribution({
      ...row,
      source: row.source === "site" ? "" : row.source,
      medium: row.medium,
      campaign: row.campaign,
      term: row.term,
      content: row.content,
      landing_page: row.landing_page,
      referrer: row.referrer,
    });
    if (!shouldUpdate(row, attribution)) continue;

    await env.DB.prepare(
      `UPDATE ${table} SET
        updated_at = ?,
        source = ?,
        medium = ?,
        campaign = COALESCE(NULLIF(?, ''), campaign),
        term = COALESCE(NULLIF(?, ''), term),
        content = COALESCE(NULLIF(?, ''), content),
        gclid = COALESCE(NULLIF(gclid, ''), NULLIF(?, '')),
        gbraid = COALESCE(NULLIF(gbraid, ''), NULLIF(?, '')),
        wbraid = COALESCE(NULLIF(wbraid, ''), NULLIF(?, '')),
        fbclid = COALESCE(NULLIF(fbclid, ''), NULLIF(?, ''))
       WHERE id = ?`
    )
      .bind(
        now,
        "google",
        "cpc",
        attribution.campaign,
        attribution.term,
        attribution.content,
        attribution.gclid,
        attribution.gbraid,
        attribution.wbraid,
        attribution.fbclid,
        row.id
      )
      .run();

    updated += 1;
    if (examples.length < 10) {
      examples.push({
        id: row.id,
        source: "google",
        medium: "cpc",
        campaign: attribution.campaign,
        term: attribution.term,
        content: attribution.content,
      });
    }
  }

  return { scanned, updated, examples };
}

export async function onRequestPost({ env }) {
  const leads = await backfillTable(env, "leads");
  const orders = await backfillTable(env, "orders");
  return json({ ok: true, leads, orders });
}
