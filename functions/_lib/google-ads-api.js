import { number, text } from "./http.js";

const DEFAULT_API_VERSION = "v22";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

const EVENT_ACTION_ENV = {
  lead: "GOOGLE_ADS_LEAD_CONVERSION_ACTION",
  paid: "GOOGLE_ADS_PAID_CONVERSION_ACTION",
  completed: "GOOGLE_ADS_COMPLETED_CONVERSION_ACTION",
};

const REQUIRED_SECRET_LABELS = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "developer token",
  GOOGLE_ADS_CLIENT_ID: "OAuth client ID",
  GOOGLE_ADS_CLIENT_SECRET: "OAuth client secret",
  GOOGLE_ADS_REFRESH_TOKEN: "OAuth refresh token",
  GOOGLE_ADS_LEAD_CONVERSION_ACTION: "Lead conversion action",
  GOOGLE_ADS_PAID_CONVERSION_ACTION: "Paid conversion action",
  GOOGLE_ADS_COMPLETED_CONVERSION_ACTION: "Completed conversion action",
};

function googleAdsCustomerId(env, row) {
  return text(row?.google_ads_customer_id) || text(env.GOOGLE_ADS_CUSTOMER_ID) || "4028488894";
}

function normalizeConversionAction(value, customerId) {
  const raw = text(value);
  if (!raw) return "";
  if (raw.startsWith("customers/")) return raw;
  if (/^\d+$/.test(raw)) return `customers/${customerId}/conversionActions/${raw}`;
  return raw;
}

function actionForRow(env, row) {
  const customerId = googleAdsCustomerId(env, row);
  const stored = normalizeConversionAction(row?.conversion_action, customerId);
  if (stored) return stored;
  const envName = EVENT_ACTION_ENV[text(row?.event_type)];
  return normalizeConversionAction(envName ? env[envName] : "", customerId);
}

function clickIdForRow(row) {
  if (text(row.gclid)) return ["gclid", text(row.gclid)];
  if (text(row.gbraid)) return ["gbraid", text(row.gbraid)];
  if (text(row.wbraid)) return ["wbraid", text(row.wbraid)];
  return ["", ""];
}

function normalizePhone(value) {
  const raw = text(value);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && digits.startsWith("0")) return `+38${digits}`;
  if (digits.length === 12 && digits.startsWith("380")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return "";
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function userIdentifiersForRow(row) {
  const identifiers = [];
  const email = text(row.customer_email || row.email).toLowerCase();
  const phone = normalizePhone(row.customer_phone || row.phone);
  if (email && email.includes("@")) {
    identifiers.push({ hashedEmail: await sha256Hex(email) });
  }
  if (phone) {
    identifiers.push({ hashedPhoneNumber: await sha256Hex(phone) });
  }
  return identifiers;
}

function compactGoogleError(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 1000);
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}

function partialFailureErrorsByIndex(response) {
  const errors = new Map();
  const details = response?.partialFailureError?.details || [];
  for (const detail of details) {
    for (const error of detail.errors || []) {
      const elements = error.location?.fieldPathElements || [];
      const indexed = elements.find((element) => Number.isInteger(element.index));
      if (!indexed) continue;
      const message = error.message || compactGoogleError(error);
      errors.set(indexed.index, message);
    }
  }
  return errors;
}

export function googleAdsApiConfigStatus(env) {
  const missing = [];
  for (const [name, label] of Object.entries(REQUIRED_SECRET_LABELS)) {
    if (!text(env[name])) missing.push({ name, label });
  }
  return {
    ready: missing.length === 0,
    missing,
    api_version: text(env.GOOGLE_ADS_API_VERSION) || DEFAULT_API_VERSION,
    customer_id: text(env.GOOGLE_ADS_CUSTOMER_ID) || "4028488894",
    login_customer_id: text(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
  };
}

async function googleAdsAccessToken(env) {
  const body = new URLSearchParams({
    client_id: text(env.GOOGLE_ADS_CLIENT_ID),
    client_secret: text(env.GOOGLE_ADS_CLIENT_SECRET),
    refresh_token: text(env.GOOGLE_ADS_REFRESH_TOKEN),
    grant_type: "refresh_token",
  });

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth token failed: ${compactGoogleError(data) || response.statusText}`);
  }
  return data.access_token;
}

export async function buildGoogleAdsClickConversion(env, row) {
  const conversionAction = actionForRow(env, row);
  const [clickIdKey, clickIdValue] = clickIdForRow(row);
  const userIdentifiers = await userIdentifiersForRow(row);
  const errors = [];

  if (!conversionAction) errors.push(`Не задано conversion action для ${row.event_type || "події"}.`);
  if (!clickIdValue && !userIdentifiers.length) {
    errors.push("Немає gclid/gbraid/wbraid або email/телефону для enhanced conversion.");
  }

  if (errors.length) {
    return { row, errors };
  }

  const conversion = {
    conversionAction,
    conversionDateTime: text(row.conversion_time),
    conversionValue: number(row.conversion_value),
    currencyCode: text(row.currency_code) || text(env.GOOGLE_ADS_CURRENCY_CODE) || "UAH",
    orderId: text(row.order_id_for_google || `${row.order_id}_${row.event_type}`),
  };

  if (clickIdKey) conversion[clickIdKey] = clickIdValue;
  if (userIdentifiers.length) conversion.userIdentifiers = userIdentifiers;

  const adUserData = text(env.GOOGLE_ADS_AD_USER_DATA_CONSENT).toUpperCase();
  if (adUserData === "GRANTED" || adUserData === "DENIED") {
    conversion.consent = { adUserData };
  }

  return { row, conversion };
}

export async function uploadGoogleAdsConversions(env, rows, { validateOnly = false } = {}) {
  const config = googleAdsApiConfigStatus(env);
  if (!config.ready) {
    return { ok: false, missing_config: config.missing, validate_only: validateOnly, rows: [] };
  }

  const built = await Promise.all(rows.map((row) => buildGoogleAdsClickConversion(env, row)));
  const rowErrors = built
    .filter((item) => item.errors?.length)
    .map((item) => ({
      id: item.row.id,
      order_id: item.row.order_id,
      event_type: item.row.event_type,
      status: "failed",
      error: item.errors.join(" "),
    }));
  const uploadItems = built.filter((item) => item.conversion);

  if (!uploadItems.length) {
    return {
      ok: rowErrors.length === 0,
      validate_only: validateOnly,
      uploaded: 0,
      failed: rowErrors.length,
      rows: rowErrors,
    };
  }

  const customerId = googleAdsCustomerId(env, uploadItems[0].row);
  const version = config.api_version;
  const accessToken = await googleAdsAccessToken(env);
  const endpoint = `https://googleads.googleapis.com/${version}/customers/${customerId}:uploadClickConversions`;
  const headers = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": text(env.GOOGLE_ADS_DEVELOPER_TOKEN),
    "content-type": "application/json",
  };
  if (config.login_customer_id) headers["login-customer-id"] = config.login_customer_id;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversions: uploadItems.map((item) => item.conversion),
      partialFailure: true,
      validateOnly: Boolean(validateOnly),
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = compactGoogleError(data) || response.statusText;
    return {
      ok: false,
      validate_only: validateOnly,
      google_response: data,
      rows: [
        ...rowErrors,
        ...uploadItems.map((item) => ({
          id: item.row.id,
          order_id: item.row.order_id,
          event_type: item.row.event_type,
          status: "failed",
          error,
        })),
      ],
    };
  }

  const partialErrors = partialFailureErrorsByIndex(data);
  const rowResults = uploadItems.map((item, index) => {
    const error = partialErrors.get(index);
    const result = data.results?.[index] || {};
    if (error) {
      return {
        id: item.row.id,
        order_id: item.row.order_id,
        event_type: item.row.event_type,
        status: "failed",
        error,
        result,
      };
    }
    return {
      id: item.row.id,
      order_id: item.row.order_id,
      event_type: item.row.event_type,
      status: validateOnly ? "validated" : "uploaded",
      result,
    };
  });

  return {
    ok: rowResults.every((item) => item.status !== "failed") && rowErrors.length === 0,
    validate_only: validateOnly,
    google_response: data,
    uploaded: validateOnly ? 0 : rowResults.filter((item) => item.status === "uploaded").length,
    validated: validateOnly ? rowResults.filter((item) => item.status === "validated").length : 0,
    failed: rowErrors.length + rowResults.filter((item) => item.status === "failed").length,
    rows: [...rowErrors, ...rowResults],
  };
}
