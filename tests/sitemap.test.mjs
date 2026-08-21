import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(path.join(root, "sitemap.xml"), "utf8");

function pagePathForUrl(value) {
  const url = new URL(value);
  if (url.pathname === "/") return "index.html";
  if (url.pathname.endsWith("/")) return path.join(decodeURIComponent(url.pathname.slice(1)), "index.html");
  return `${decodeURIComponent(url.pathname.slice(1))}.html`;
}

test("sitemap contains unique, existing and indexable pages", async () => {
  const blocks = Array.from(source.matchAll(/<url>[\s\S]*?<\/url>/g), (match) => match[0]);
  const locations = blocks.map((block) => block.match(/<loc>([^<]+)<\/loc>/)?.[1]);

  assert.equal(new Set(locations).size, locations.length);
  assert.equal(locations.some((location) => /komplekty-to/.test(location)), false);

  for (const [index, location] of locations.entries()) {
    const relativePath = pagePathForUrl(location);
    const absolutePath = path.join(root, relativePath);
    await access(absolutePath);

    const html = await readFile(absolutePath, "utf8");
    assert.doesNotMatch(html, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i, location);

    const lastmod = blocks[index].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
    assert.match(lastmod || "", /^\d{4}-\d{2}-\d{2}$/, location);
  }
});
