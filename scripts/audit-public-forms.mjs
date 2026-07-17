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
const contactLinks = new Map();
const mainScriptVersions = new Set();
let formCount = 0;
let pagesWithContactLinks = 0;

const allowedContacts = {
  email: new Set(["evlineukraine@gmail.com"]),
  phone: new Set(["+380935251024"]),
  telegram: new Set(["evline_support", "evline_tech"]),
};

function contactLink(href) {
  const normalized = href.trim().replaceAll("&amp;", "&");

  if (normalized.startsWith("tel:")) {
    return { channel: "phone", destination: normalized.slice(4).replace(/[\s()-]/g, "") };
  }

  if (normalized.startsWith("mailto:")) {
    return { channel: "email", destination: normalized.slice(7).split("?")[0].toLowerCase() };
  }

  if (/^https?:\/\/(?:www\.)?t\.me\//i.test(normalized)) {
    const url = new URL(normalized);
    return { channel: "telegram", destination: url.pathname.split("/").filter(Boolean)[0] || "" };
  }

  if (/^https?:\/\/(?:wa\.me|api\.whatsapp\.com)\//i.test(normalized)) {
    return { channel: "whatsapp", destination: normalized };
  }

  if (/^(?:viber:|https?:\/\/invite\.viber\.com\/)/i.test(normalized)) {
    return { channel: "viber", destination: normalized };
  }

  return null;
}

for (const absolutePath of files) {
  const relativePath = path.relative(root, absolutePath);
  const html = await readFile(absolutePath, "utf8");
  const pageHandlers = [];
  const formIds = new Set();
  let pageContactLinkCount = 0;

  for (const match of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    const form = match[0];
    const handler = formHandler(form);
    formCount += 1;
    pageHandlers.push(handler);
    handlers.set(handler, (handlers.get(handler) || 0) + 1);

    const id = form.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (id && formIds.has(id)) failures.push(`${relativePath}: duplicate form id ${id}`);
    if (id) formIds.add(id);

    if (handler === "missing") {
      failures.push(`${relativePath}: public form has no CRM handler`);
    } else if (!/name=["'](?:phone|contact|email|telegram)["']/i.test(form)) {
      failures.push(`${relativePath}: ${handler} form has no contact field`);
    }
  }

  const loadsMainScript = /assets\/js\/main\.js(?:\?[^"']*)?["']/i.test(html);
  if (pageHandlers.some((handler) => handler !== "inline") && !loadsMainScript) {
    failures.push(`${relativePath}: CRM form depends on assets/js/main.js but the script is missing`);
  }
  if (pageHandlers.includes("inline") && !/\bsubmitLead\s*=|\bfunction\s+submitLead\b/i.test(html)) {
    failures.push(`${relativePath}: inline form references submitLead but the function is missing`);
  }

  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const parsed = contactLink(match[1]);
    if (!parsed) continue;
    pageContactLinkCount += 1;
    contactLinks.set(parsed.channel, (contactLinks.get(parsed.channel) || 0) + 1);

    const allowed = allowedContacts[parsed.channel];
    if (allowed && !allowed.has(parsed.destination)) {
      failures.push(`${relativePath}: unexpected ${parsed.channel} destination ${parsed.destination || "(empty)"}`);
    }
  }

  if (pageContactLinkCount) {
    pagesWithContactLinks += 1;
    const loadsContactTracker = loadsMainScript || /assets\/js\/contact-tracking\.js(?:\?[^"']*)?["']/i.test(html);
    if (!loadsContactTracker) {
      failures.push(`${relativePath}: contact CTA exists without contact tracking script`);
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
    contact_links: Object.fromEntries(contactLinks),
    pages_with_contact_links: pagesWithContactLinks,
    main_script_version: [...mainScriptVersions][0],
  }, null, 2));
}
