import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sitemapPath = path.join(root, "sitemap.xml");
const today = process.env.SITEMAP_CHANGED_DATE || new Date().toISOString().slice(0, 10);
const removedUrls = new Set([
  "https://evline.com.ua/komplekty-to/",
  "https://evline.com.ua/ru/komplekty-to/",
]);

function pagePathForUrl(value) {
  const url = new URL(value);
  if (url.hostname !== "evline.com.ua") throw new Error(`Unexpected sitemap host: ${url.hostname}`);

  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") return "index.html";
  if (pathname.endsWith("/")) return path.join(pathname.slice(1), "index.html");
  return `${pathname.slice(1)}.html`;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function lastModified(relativePath) {
  const dirty = git(["status", "--porcelain", "--untracked-files=all", "--", relativePath]);
  if (dirty) return today;
  return git(["log", "-1", "--format=%cs", "--", relativePath]) || today;
}

const source = await readFile(sitemapPath, "utf8");
let updatedCount = 0;
let removedCount = 0;

const blocks = source.replace(/\n?  <url>[\s\S]*?  <\/url>/g, (block) => {
  const location = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
  if (!location) throw new Error("Sitemap URL block has no <loc>");
  if (removedUrls.has(location)) {
    removedCount += 1;
    return "";
  }

  const relativePath = pagePathForUrl(location);
  const absolutePath = path.join(root, relativePath);
  const date = lastModified(relativePath);
  updatedCount += 1;

  return block.replace(/<lastmod>[^<]+<\/lastmod>/, `<lastmod>${date}</lastmod>`);
});

for (const block of blocks.matchAll(/<url>[\s\S]*?<\/url>/g)) {
  const location = block[0].match(/<loc>([^<]+)<\/loc>/)?.[1];
  await access(path.join(root, pagePathForUrl(location)));
}

await writeFile(sitemapPath, blocks.replace(/\n{3,}/g, "\n\n"));
console.log(`Updated ${updatedCount} sitemap URLs; removed ${removedCount}.`);
