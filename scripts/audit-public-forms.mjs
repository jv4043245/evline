import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([
  ".git",
  ".local-data",
  ".wrangler",
  "admin",
  "node_modules",
  "supplier",
]);

async function htmlFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(absolutePath));
    if (entry.isFile() && entry.name.endsWith(".html") && !entry.name.endsWith("-test.html")) {
      files.push(absolutePath);
    }
  }

  return files;
}

function formHandler(form) {
  if (/onsubmit=["'][^"']*submitLead\(/i.test(form)) return "inline";
  if (/data-telegram-parts-form/i.test(form)) return "parts";
  if (/data-byd-seo-form/i.test(form)) return "byd-seo";
  if (/data-lead-form|data-telegram-form/i.test(form)) return "generic";
  return "missing";
}

const files = await htmlFiles();
const failures = [];
const handlers = new Map();
const mainScriptVersions = new Set();
let formCount = 0;

for (const absolutePath of files) {
  const relativePath = path.relative(root, absolutePath);
  const html = await readFile(absolutePath, "utf8");

  for (const match of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    const form = match[0];
    const handler = formHandler(form);
    formCount += 1;
    handlers.set(handler, (handlers.get(handler) || 0) + 1);

    if (handler === "missing") {
      failures.push(`${relativePath}: public form has no CRM handler`);
    } else if (!/name=["'](?:phone|contact|email|telegram)["']/i.test(form)) {
      failures.push(`${relativePath}: ${handler} form has no contact field`);
    }
  }

  for (const match of html.matchAll(/assets\/js\/main\.js\?v=([^"']+)/g)) {
    mainScriptVersions.add(match[1]);
  }

  for (const line of html.split("\n")) {
    if (line.includes("fetch(leadEndpoint()") && !line.includes("keepalive:true")) {
      failures.push(`${relativePath}: inline CRM request is missing keepalive`);
    }
  }
}

if (mainScriptVersions.size !== 1) {
  failures.push(`assets/js/main.js uses inconsistent cache versions: ${[...mainScriptVersions].join(", ") || "none"}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    html_files: files.length,
    forms: formCount,
    handlers: Object.fromEntries(handlers),
    main_script_version: [...mainScriptVersions][0],
  }, null, 2));
}
