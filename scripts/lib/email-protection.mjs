import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicHtmlFiles } from "./seller-identity.mjs";

const EMAIL_OFF = "<!--email_off-->";
const EMAIL_ON = "<!--/email_off-->";
const MAILTO_ANCHOR = /<a\b[^>]*\bhref=["']mailto:[^"']+["'][^>]*>[\s\S]*?<\/a>/gi;
const PROTECTED_MAILTO = /<!--email_off-->\s*(<a\b[^>]*\bhref=["']mailto:[^"']+["'][^>]*>[\s\S]*?<\/a>)\s*<!--\/email_off-->/gi;

// Cloudflare Email Address Obfuscation otherwise rewrites public mail links to
// /cdn-cgi/l/email-protection. Search bots can follow that technical URL and
// report an avoidable 404, so opt these explicit business contacts out.
export function protectEmailLinks(source) {
  const normalized = source.replace(PROTECTED_MAILTO, "$1");
  return normalized.replace(MAILTO_ANCHOR, (anchor) => `${EMAIL_OFF}${anchor}${EMAIL_ON}`);
}

export async function syncEmailProtection(root, { check = false } = {}) {
  const changed = [];
  for (const file of await publicHtmlFiles(root)) {
    const original = await readFile(file, "utf8");
    const updated = protectEmailLinks(original);
    if (updated === original) continue;
    changed.push(path.relative(root, file));
    if (!check) await writeFile(file, updated);
  }
  return changed;
}
