import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Owner-confirmed legal name. Keep the Ukrainian spelling in both languages.
export const sellerName = "Ванюшин Євген Анатолійович";
const skippedDirectories = new Set([".git", ".local-data", ".wrangler", "admin", "node_modules", "supplier"]);

export function sellerIdentityMarkup(language = "uk") {
  const ru = language.startsWith("ru");
  const statement = ru
    ? `EVLine — торговое название деятельности ФОП ${sellerName}, владельца сайта и продавца запчастей.`
    : `EVLine — торгове найменування діяльності ФОП ${sellerName}, власника сайту та продавця запчастин.`;
  const href = ru ? "/ru/privacy/#seller" : "/privacy/#seller";
  const label = ru ? "О продавце и контакты" : "Про продавця та контакти";
  return `<div data-seller-identity style="width:min(1140px,calc(100% - 40px));margin:18px auto 0;font-size:13px;line-height:1.6">${statement} <a href="${href}" style="color:inherit;text-decoration:underline">${label}</a></div>`;
}

export function withSellerIdentity(html) {
  if (!/<footer\b/i.test(html)) return html;
  const language = html.match(/<html\b[^>]*\blang=["']([^"']+)/i)?.[1] || "uk";
  const markup = sellerIdentityMarkup(language);
  if (/<div data-seller-identity\b/.test(html)) {
    return html.replace(/<div data-seller-identity\b[^>]*>[\s\S]*?<\/div>/g, markup);
  }
  return html.replace(/<\/footer>/i, `${markup}\n</footer>`);
}

export async function publicHtmlFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !skippedDirectories.has(entry.name)) {
      files.push(...await publicHtmlFiles(path.join(root, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".html") && !entry.name.endsWith("-test.html")) {
      files.push(path.join(root, entry.name));
    }
  }
  return files;
}

export async function syncSellerIdentity(root, { check = false } = {}) {
  const changed = [];
  for (const file of await publicHtmlFiles(root)) {
    const original = await readFile(file, "utf8");
    const updated = withSellerIdentity(original);
    if (original === updated) continue;
    changed.push(path.relative(root, file));
    if (!check) await writeFile(file, updated);
  }
  return changed;
}
