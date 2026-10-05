import { text } from "./http.js";

function hostFromUrl(value) {
  try {
    const url = new URL(text(value));
    return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function isDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function platform(value) {
  const host = hostFromUrl(value) || value;
  if (["fb", "facebook"].includes(value) || isDomain(host, "facebook.com") || isDomain(host, "fb.com")) return "Facebook";
  if (["ig", "instagram"].includes(value) || isDomain(host, "instagram.com")) return "Instagram";
  if (["tg", "telegram"].includes(value) || isDomain(host, "t.me") || isDomain(host, "telegram.org")) return "Telegram";
  if (value === "tiktok" || isDomain(host, "tiktok.com")) return "TikTok";
  if (value === "youtube" || isDomain(host, "youtube.com") || isDomain(host, "youtu.be")) return "YouTube";
  if (value === "bing" || isDomain(host, "bing.com")) return "Bing";
  // Deliberately limited to known Google search domains, not arbitrary google.* hosts.
  if (value === "google" || ["google.com", "google.com.ua", "google.pl", "google.de", "google.co.uk", "google.ro", "google.bg", "google.hu"].some(domain => isDomain(host, domain))) return "Google";
  return "";
}

// Display only: never rewrites CRM attribution or conversion tracking.
export function notificationSource(record = {}) {
  const source = text(record.source || record.utm_source).toLowerCase();
  const medium = text(record.medium || record.utm_medium).toLowerCase();
  const kind = text(record.attribution_type).toLowerCase();
  const refHost = hostFromUrl(record.referrer);
  const explicit = platform(source);
  const referred = platform(refHost);
  const paid = /^(cpc|ppc|paid|paid_search|paid-search|paid_social|paid-social|social_ads|cpm|display|ads?|adwords)$/.test(medium);
  const neutralSource = !source || ["site", "direct", "(direct)", "(not set)"].includes(source);

  // fbclid does not prove a paid click or distinguish Facebook from Instagram.
  // Respect existing CRM Meta precedence without exposing click IDs or raw UTM text.
  if (explicit === "Facebook" || explicit === "Instagram") return explicit;
  if (text(record.fbclid) || source === "meta") {
    return ["Facebook", "Instagram"].includes(referred) ? referred : "Meta (Facebook / Instagram)";
  }
  if (text(record.gclid) || text(record.gbraid) || text(record.wbraid) || record.has_google_click === true || kind === "google_ads" || (explicit === "Google" && paid)) {
    return "Google — реклама";
  }
  if (explicit) {
    if (["Google", "Bing"].includes(explicit)) {
      if (paid) return `${explicit} — реклама`;
      if (medium === "organic" || referred === explicit) return `${explicit} — пошук`;
    }
    return explicit;
  }
  if (source === "manual") return "Внесено вручну";
  if (["email", "e-mail", "newsletter"].includes(source) || medium === "email") return "Email";
  if (["phone", "call", "telephone"].includes(source)) return "Телефон";
  if (!neutralSource) return paid ? "Реклама (джерело невідоме)" : "Інше джерело";
  if (referred) {
    if (["Google", "Bing"].includes(referred)) return paid ? "Реклама (джерело невідоме)" : `${referred} — пошук`;
    return referred;
  }
  if (paid) return "Реклама (джерело невідоме)";
  if (medium === "organic" || kind === "organic") return "Пошук (система невідома)";
  if (kind === "social") return "Соцмережі";
  if (kind === "manual") return "Внесено вручну";
  if (refHost && !["evline.com.ua", "evline.pages.dev", "jv4043245.github.io"].some(domain => isDomain(refHost, domain))) return "Перехід з іншого сайту";
  if (source || kind === "direct" || refHost) return "Прямий / невідомий";
  return "Невідомо";
}
