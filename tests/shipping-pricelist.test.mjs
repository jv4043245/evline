import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const adminHtml = await readFile(path.join(root, "admin/index.html"), "utf8");
const pageHtml = await readFile(path.join(root, "admin/shipping-pricelist/index.html"), "utf8");
const pageCss = await readFile(path.join(root, "admin/shipping-pricelist/pricelist.css"), "utf8");
const data = JSON.parse(await readFile(path.join(root, "admin/shipping-pricelist/pricelist.json"), "utf8"));

test("admin delivery section links to the shipping price list", () => {
  assert.match(adminHtml, /href="\/admin\/shipping-pricelist\/"/);
  assert.ok(
    adminHtml.indexOf("shipping-pricelist-entry") > adminHtml.indexOf("data-shipping-list"),
    "price list entry should appear below the two-column delivery directory",
  );
  assert.match(pageHtml, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(pageHtml, /data-shipping-calculator/);
  assert.match(pageHtml, /data-pricelist-rows/);
  assert.match(pageHtml, /Не включено: доставка по Китаю/);
});

test("shipping calculator and tariff source cards keep padded content bodies", () => {
  assert.equal(pageHtml.match(/class="shipping-pricelist-card-body"/g)?.length, 2);
  assert.match(pageCss, /\.shipping-pricelist-card-body\s*\{[^}]*padding:\s*18px;/s);
});

test("shipping price list keeps the confirmed shipment math consistent", () => {
  const effectiveRate = data.source.freight_usd / data.source.packed_volume_m3;
  assert.ok(Math.abs(effectiveRate - data.base_rate_per_m3) < 0.1);
  assert.equal(data.quote_rate_per_m3, Math.round(data.base_rate_per_m3 * (1 + data.quote_reserve_percent / 100)));
  assert.equal(data.source.china_local_delivery_cny + data.source.wooden_crate_cny, 240);
});

test("shipping profiles have unique ids and reproducible estimates", () => {
  assert.ok(data.profiles.length >= 7);
  assert.equal(new Set(data.profiles.map((profile) => profile.id)).size, data.profiles.length);

  for (const profile of data.profiles) {
    assert.ok(Array.isArray(profile.keywords) && profile.keywords.length > 0, `${profile.id}: missing automatic match keywords`);
    assert.ok(profile.packed_volume_m3 > 0, `${profile.id}: expected a positive volume`);
    assert.ok(profile.working_range_usd[0] <= profile.working_quote_usd, `${profile.id}: quote below range`);
    assert.ok(profile.working_quote_usd <= profile.working_range_usd[1], `${profile.id}: quote above range`);
    assert.ok(
      Math.abs(profile.calculated_cost_usd - profile.packed_volume_m3 * data.base_rate_per_m3) <= 1,
      `${profile.id}: calculated cost does not match the base rate`,
    );
    assert.ok(
      Math.abs(profile.working_quote_usd - profile.packed_volume_m3 * data.quote_rate_per_m3) <= 5,
      `${profile.id}: working quote does not match the reserve rate`,
    );
  }
});
