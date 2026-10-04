import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { protectEmailLinks } from "../scripts/lib/email-protection.mjs";
import { publicHtmlFiles } from "../scripts/lib/seller-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const unprotectedMailto = /(?<!<!--email_off-->)<a\b[^>]*\bhref=["']mailto:/i;

test("all public mail links opt out of Cloudflare email rewriting", async () => {
  let links = 0;
  for (const file of await publicHtmlFiles(root)) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(html, unprotectedMailto, file);
    assert.equal(protectEmailLinks(html), html, `Must be idempotent: ${file}`);
    links += (html.match(/<!--email_off--><a\b[^>]*\bhref=["']mailto:/gi) || []).length;
  }
  assert.ok(links > 200, `Expected broad public email coverage, got ${links}`);
});

test("email protection preserves the anchor and is idempotent", () => {
  const anchor = '<a class="contact" href="mailto:hello@example.com">hello@example.com</a>';
  const protectedAnchor = `<!--email_off-->${anchor}<!--/email_off-->`;
  assert.equal(protectEmailLinks(anchor), protectedAnchor);
  assert.equal(protectEmailLinks(protectedAnchor), protectedAnchor);
});
