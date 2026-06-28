import { text } from "./http.js";

export const DEFAULT_TRANSLATION_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const LANGUAGE_LABELS = {
  en: "English",
  ru: "Russian",
  uk: "Ukrainian",
  "zh-CN": "Simplified Chinese",
};

const CYRILLIC_RE = /[\u0400-\u04ff]/;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

function normalizeTranslation(value) {
  return text(value)
    .replace(/^["'«“”]+|["'«“”]+$/g, "")
    .trim();
}

function fallbackTranslation(source) {
  return text(source).slice(0, 2000);
}

function normalizeLanguageCode(value) {
  const lang = text(value).toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("uk")) return "uk";
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("ru")) return "ru";
  return lang || "ru";
}

function isLikelyAlreadyTargetLanguage(input, from, to) {
  if (from === to) return true;
  if (to === "zh-CN" && CJK_RE.test(input) && !CYRILLIC_RE.test(input)) return true;
  if ((to === "ru" || to === "uk") && CYRILLIC_RE.test(input) && !CJK_RE.test(input)) return true;
  return false;
}

function translationGuidance(from, to) {
  if (to === "zh-CN") {
    return "Use natural Simplified Chinese suitable for a business supplier in mainland China.";
  }
  if (to === "ru") {
    return "Use natural Russian for EVLine managers.";
  }
  if (to === "en") {
    return "Use concise business English.";
  }
  return "";
}

export async function translateSupplierText(env, source, { from = "ru", to = "zh-CN" } = {}) {
  const input = fallbackTranslation(source);
  if (!input) return "";
  const sourceLang = normalizeLanguageCode(from);
  const targetLang = normalizeLanguageCode(to);
  if (isLikelyAlreadyTargetLanguage(input, sourceLang, targetLang)) return input;
  if (!env?.AI?.run) return input;

  const model = text(env.SUPPLIER_TRANSLATION_MODEL || env.TRANSLATION_MODEL) || DEFAULT_TRANSLATION_MODEL;
  const fromLabel = LANGUAGE_LABELS[sourceLang] || sourceLang;
  const toLabel = LANGUAGE_LABELS[targetLang] || targetLang;
  const prompt = [
    `Translate from ${fromLabel} to ${toLabel}.`,
    "This is a short business message about car parts between EVLine and a Chinese supplier.",
    translationGuidance(sourceLang, targetLang),
    "Preserve VIN codes, model names, part names, numbers, currency, delivery days, and line breaks.",
    "Do not add explanations, greetings, quotes, markdown, or alternatives.",
    "Return only the translated text.",
    "",
    input,
  ].join("\n");

  try {
    const result = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "You are a precise business translator for automotive parts procurement. Return only the translation.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 800,
    });
    return normalizeTranslation(result?.response || result?.result?.response || result?.text || "") || input;
  } catch (error) {
    console.error("Supplier translation failed", error?.message || error);
    return input;
  }
}

export function supplierTranslationDirections() {
  return {
    managerToSupplier: { from: "ru", to: "zh-CN" },
    supplierToManager: { from: "zh-CN", to: "ru" },
  };
}
