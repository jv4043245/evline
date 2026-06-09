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

export function inferAttribution(payload = {}, request) {
  const requestUrl = request ? new URL(request.url) : new URL("https://evline.com.ua/");
  const landingPage = text(payload.landing_page) || requestUrl.href;
  const referrer = text(payload.referrer) || text(request?.headers?.get?.("referer"));
  const params = paramsFromUrl(landingPage, requestUrl.origin);

  const gclid = text(payload.gclid) || text(params.get("gclid"));
  const gbraid = text(payload.gbraid) || text(params.get("gbraid"));
  const wbraid = text(payload.wbraid) || text(params.get("wbraid"));
  const gadCampaignId = text(params.get("gad_campaignid"));
  const hasGoogleClick = Boolean(
    gclid ||
      gbraid ||
      wbraid ||
      gadCampaignId ||
      text(params.get("gad_source")) ||
      googleReferrer(referrer)
  );

  return {
    source: text(payload.utm_source || payload.source) || (hasGoogleClick ? "google" : "site"),
    medium: text(payload.utm_medium || payload.medium) || (hasGoogleClick ? "cpc" : ""),
    campaign:
      text(payload.utm_campaign || payload.campaign) ||
      text(params.get("utm_campaign")) ||
      (hasGoogleClick ? gadCampaignId : ""),
    term: text(payload.utm_term || payload.term) || text(params.get("utm_term")),
    content: text(payload.utm_content || payload.content) || text(params.get("utm_content")),
    gclid,
    gbraid,
    wbraid,
    fbclid: text(payload.fbclid) || text(params.get("fbclid")),
    landing_page: landingPage,
    referrer,
    has_google_click: hasGoogleClick,
  };
}
