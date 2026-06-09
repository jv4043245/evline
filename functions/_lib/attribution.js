import { text } from "./http.js";

function paramsFromUrl(value, baseUrl = "https://evline.com.ua/") {
  const raw = text(value);
  if (!raw) return new URLSearchParams();
  try {
    return new URL(raw, baseUrl).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function googleReferrer(value) {
  const referrer = text(value).toLowerCase();
  return /(^|\/\/)(www\.)?google\./.test(referrer);
}

function socialReferrer(value) {
  const referrer = text(value).toLowerCase();
  return /(facebook|instagram|tiktok|youtube|telegram|t\.me)\./.test(referrer);
}

function internalReferrer(value) {
  try {
    const host = new URL(text(value)).hostname.replace(/^www\./, "");
    return host === "evline.com.ua" || host === "evline.pages.dev" || host === "jv4043245.github.io";
  } catch {
    return false;
  }
}

function pickParam(name, ...paramsList) {
  for (const params of paramsList) {
    const value = text(params.get(name));
    if (value) return value;
  }
  return "";
}

export function classifyAttribution(attribution = {}) {
  const source = text(attribution.source).toLowerCase();
  const medium = text(attribution.medium).toLowerCase();
  const referrer = text(attribution.referrer);

  if (
    attribution.gclid ||
    attribution.gbraid ||
    attribution.wbraid ||
    attribution.has_google_click ||
    (source === "google" && /(cpc|ppc|paid|ads?)/.test(medium))
  ) {
    return "google_ads";
  }
  if ((source === "" || source === "site" || source === "direct") && !medium && (!referrer || internalReferrer(referrer))) return "direct";
  if (medium === "organic" || (source === "google" && !medium) || googleReferrer(referrer)) return "organic";
  if (source || medium || attribution.fbclid || socialReferrer(referrer)) {
    return /facebook|instagram|tiktok|youtube|telegram|social/.test(source) || attribution.fbclid || socialReferrer(referrer)
      ? "social"
      : "other";
  }
  if (referrer) return "referral";
  return "direct";
}

export function inferAttribution(payload = {}, request) {
  const requestUrl = request ? new URL(request.url) : new URL("https://evline.com.ua/");
  const pageUrl = text(payload.page_url || payload.current_page) || text(request?.headers?.get?.("referer")) || requestUrl.href;
  const landingPage = text(payload.landing_page) || pageUrl || requestUrl.href;
  const referrer = text(payload.referrer) || text(request?.headers?.get?.("referer"));
  const landingParams = paramsFromUrl(landingPage, requestUrl.origin);
  const pageParams = paramsFromUrl(pageUrl, requestUrl.origin);
  const requestParams = requestUrl.searchParams;

  const gclid = text(payload.gclid) || pickParam("gclid", landingParams, pageParams, requestParams);
  const gbraid = text(payload.gbraid) || pickParam("gbraid", landingParams, pageParams, requestParams);
  const wbraid = text(payload.wbraid) || pickParam("wbraid", landingParams, pageParams, requestParams);
  const gadCampaignId = pickParam("gad_campaignid", landingParams, pageParams, requestParams);
  const hasGoogleClick = Boolean(
    gclid ||
      gbraid ||
      wbraid ||
      gadCampaignId ||
      pickParam("gad_source", landingParams, pageParams, requestParams) ||
      googleReferrer(referrer)
  );

  const attribution = {
    source: text(payload.utm_source || payload.source) || (hasGoogleClick ? "google" : "site"),
    medium: text(payload.utm_medium || payload.medium) || (hasGoogleClick ? "cpc" : ""),
    campaign:
      text(payload.utm_campaign || payload.campaign) ||
      pickParam("utm_campaign", landingParams, pageParams, requestParams) ||
      (hasGoogleClick ? gadCampaignId : ""),
    term: text(payload.utm_term || payload.term) || pickParam("utm_term", landingParams, pageParams, requestParams),
    content: text(payload.utm_content || payload.content) || pickParam("utm_content", landingParams, pageParams, requestParams),
    gclid,
    gbraid,
    wbraid,
    fbclid: text(payload.fbclid) || pickParam("fbclid", landingParams, pageParams, requestParams),
    landing_page: landingPage,
    referrer,
    page_url: pageUrl,
    form_id: text(payload.form_id || payload.formId),
    form_name: text(payload.form_name || payload.formName || payload.form_source || payload.form),
    submitted_at: text(payload.submitted_at) || new Date().toISOString(),
    tracking_captured_at: text(payload.tracking_captured_at),
    has_google_click: hasGoogleClick,
  };
  attribution.attribution_type = classifyAttribution(attribution);
  return attribution;
}
