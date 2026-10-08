import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { publicHtmlFiles, sellerName, withSellerIdentity } from "../scripts/lib/seller-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("public footers identify the parts seller except the explicitly separate Zeekr service pages", async () => {
  let checked = 0;
  const separateOperatorPages = new Set(["zeekr-9x-8x/index.html", "ru/zeekr-9x-8x/index.html", "ro/zeekr-9x-8x/index.html"]);
  for (const file of await publicHtmlFiles(root)) {
    const html = await readFile(file, "utf8");
    if (!/<footer\b/i.test(html)) continue;
    const matches = [...html.matchAll(/<div data-seller-identity\b[^>]*>([\s\S]*?)<\/div>/g)];
    if (separateOperatorPages.has(path.relative(root, file))) {
      assert.match(html, /<footer\b[^>]*data-seller-identity-policy="omit"/);
      assert.equal(matches.length, 0, file);
      assert.ok(!html.includes(sellerName), file);
      assert.equal(withSellerIdentity(html), html, `Must not restore the seller: ${file}`);
      continue;
    }
    assert.equal(matches.length, 1, file);
    assert.ok(matches[0][1].includes(`ФОП ${sellerName}`), file);
    const expectedLink = /<html\b[^>]*lang="ru/i.test(html) ? "/ru/privacy/#seller" : "/privacy/#seller";
    assert.ok(matches[0][1].includes(`href="${expectedLink}"`), file);
    assert.equal(withSellerIdentity(html), html, `Not idempotent: ${file}`);
    assert.ok(!/Ванюшин Евгений|Кухарчук/.test(html), file);
    checked += 1;
  }
  assert.ok(checked > 100, `Expected coverage across public landing pages, got ${checked}`);
});

test("explicit footer opt-out removes stale seller markup and stays idempotent", () => {
  const original = '<html lang="ru"><body><footer><nav>Existing links</nav></footer></body></html>';
  const optedOut = original.replace("<footer>", '<footer data-seller-identity-policy="omit">');
  assert.equal(withSellerIdentity(optedOut), optedOut);
  const stale = withSellerIdentity(original).replace("<footer>", '<footer data-seller-identity-policy="omit">');
  const cleaned = withSellerIdentity(stale);
  assert.ok(!cleaned.includes(sellerName));
  assert.ok(cleaned.includes("<nav>Existing links</nav>"));
  assert.equal(withSellerIdentity(cleaned), cleaned);
  assert.ok(withSellerIdentity(original).includes(sellerName));
});

test("seller sections state the business relationship, independence and existing email", async () => {
  for (const file of ["privacy/index.html", "ru/privacy/index.html"]) {
    const html = await readFile(path.join(root, file), "utf8");
    assert.match(html, /id="seller"/);
    assert.ok(html.includes(sellerName));
    assert.match(html, /EVLine не (?:є окремою юридичною особою|является отдельным юридическим лицом)/);
    assert.match(html, /незалежним продавцем|независимым продавцом/);
    assert.match(html, /href="mailto:evlineukraine@gmail.com"/);
    assert.ok(!/\b\d{10}\b/.test(html), "Do not publish tax identifiers");
  }
});

test("static footer insertion preserves page content and supports all public languages", () => {
  for (const lang of ["uk-UA", "ru-UA", "ro"]) {
    const original = `<html lang="${lang}"><body><form action="/api/leads"><input name="phone"></form><footer><nav>Existing links</nav></footer><script>existingBehavior()</script></body></html>`;
    const updated = withSellerIdentity(original);
    assert.equal(updated.replace(/<div data-seller-identity\b[^>]*>[\s\S]*?<\/div>\n/, ""), original);
    assert.equal(withSellerIdentity(updated), updated);
  }
  assert.equal(withSellerIdentity("google-site-verification: token"), "google-site-verification: token");
});
