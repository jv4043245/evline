import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { publicHtmlFiles, sellerName, withSellerIdentity } from "../scripts/lib/seller-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("every public footer identifies the same owner without translating the legal name", async () => {
  let checked = 0;
  for (const file of await publicHtmlFiles(root)) {
    const html = await readFile(file, "utf8");
    if (!/<footer\b/i.test(html)) continue;
    const matches = [...html.matchAll(/<div data-seller-identity\b[^>]*>([\s\S]*?)<\/div>/g)];
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

test("static footer insertion preserves page content and supports both languages", () => {
  for (const lang of ["uk-UA", "ru-UA"]) {
    const original = `<html lang="${lang}"><body><form action="/api/leads"><input name="phone"></form><footer><nav>Existing links</nav></footer><script>existingBehavior()</script></body></html>`;
    const updated = withSellerIdentity(original);
    assert.equal(updated.replace(/<div data-seller-identity\b[^>]*>[\s\S]*?<\/div>\n/, ""), original);
    assert.equal(withSellerIdentity(updated), updated);
  }
  assert.equal(withSellerIdentity("google-site-verification: token"), "google-site-verification: token");
});
