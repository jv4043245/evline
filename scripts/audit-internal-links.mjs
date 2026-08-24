import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const skippedDirectories = new Set([".git", "node_modules"]);
const skippedRoutes = ["/api/", "/cdn-cgi/"];

async function collectHtmlFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectHtmlFiles(absolutePath, files);
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolutePath);
  }
  return files;
}

function publicPathForFile(absolutePath) {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  if (relativePath === "index.html") return "/";
  if (relativePath.endsWith("/index.html")) return `/${relativePath.slice(0, -"index.html".length)}`;
  return `/${relativePath.slice(0, -".html".length)}`;
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function resolvesLocally(pathname) {
  const decodedPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!decodedPath) return exists("index.html");

  const candidates = [];
  if (pathname.endsWith("/")) {
    candidates.push(path.join(decodedPath, "index.html"));
  } else if (path.extname(decodedPath)) {
    candidates.push(decodedPath);
  } else {
    candidates.push(`${decodedPath}.html`, path.join(decodedPath, "index.html"));
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) return true;
  }
  return false;
}

const failures = [];
const htmlFiles = await collectHtmlFiles(root);
let checkedReferences = 0;

for (const absolutePath of htmlFiles) {
  const html = await readFile(absolutePath, "utf8");
  const pageUrl = new URL(publicPathForFile(absolutePath), "https://evline.com.ua");
  const references = Array.from(html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi), (match) => match[1]);

  for (const reference of references) {
    if (!reference || reference.startsWith("#") || /^(?:data|mailto|tel|javascript):/i.test(reference)) continue;

    let target;
    try {
      target = new URL(reference, pageUrl);
    } catch {
      failures.push(`${path.relative(root, absolutePath)} -> invalid URL: ${reference}`);
      continue;
    }

    if (target.hostname !== "evline.com.ua") continue;
    if (skippedRoutes.some((route) => target.pathname.startsWith(route))) continue;

    checkedReferences += 1;
    if (!(await resolvesLocally(target.pathname))) {
      failures.push(`${path.relative(root, absolutePath)} -> ${reference}`);
    }
  }
}

if (failures.length) {
  console.error(`Broken internal references (${failures.length}):`);
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${checkedReferences} internal references across ${htmlFiles.length} HTML files; all targets exist.`);
}
