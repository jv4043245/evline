import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");

function pagePathForUrl(value) {
  const url = new URL(value);
  if (url.pathname === "/") return "index.html";
  if (url.pathname.endsWith("/")) return path.join(decodeURIComponent(url.pathname.slice(1)), "index.html");
  return `${decodeURIComponent(url.pathname.slice(1))}.html`;
}

test("every sitemap page has a self canonical, one H1 and valid JSON-LD", async () => {
  const urlBlocks = Array.from(sitemap.matchAll(/<url>[\s\S]*?<\/url>/g), (match) => match[0]);
  const titles = new Map();
  const descriptions = new Map();

  for (const block of urlBlocks) {
    const location = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    const html = await readFile(path.join(root, pagePathForUrl(location)), "utf8");
    const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
    const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim();
    const h1Count = (html.match(/<h1(?:\s[^>]*)?>/gi) || []).length;
    const jsonLdBlocks = Array.from(
      html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
      (match) => match[1],
    );
    const pageAlternates = Array.from(
      html.matchAll(/<link\s+rel=["']alternate["']\s+hreflang=["']([^"']+)["']\s+href=["']([^"']+)["']/gi),
      (match) => `${match[1]}=${match[2]}`,
    ).sort();
    const sitemapAlternates = Array.from(
      block.matchAll(/<xhtml:link\s+rel=["']alternate["']\s+hreflang=["']([^"']+)["']\s+href=["']([^"']+)["']/gi),
      (match) => `${match[1]}=${match[2]}`,
    ).sort();

    assert.equal(canonical, location, `${location}: canonical must match the sitemap URL`);
    assert.deepEqual(pageAlternates, sitemapAlternates, `${location}: page and sitemap hreflang must agree`);
    assert.ok(title, `${location}: expected a title`);
    assert.ok(description, `${location}: expected a meta description`);
    assert.equal(h1Count, 1, `${location}: expected exactly one H1`);
    assert.ok(jsonLdBlocks.length > 0, `${location}: expected JSON-LD`);

    assert.equal(titles.get(title), undefined, `${location}: duplicate title also used by ${titles.get(title)}`);
    assert.equal(descriptions.get(description), undefined, `${location}: duplicate description also used by ${descriptions.get(description)}`);
    titles.set(title, location);
    descriptions.set(description, location);

    for (const source of jsonLdBlocks) {
      assert.doesNotThrow(() => JSON.parse(source), `${location}: invalid JSON-LD`);
    }
  }
});
