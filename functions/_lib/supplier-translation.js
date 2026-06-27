import { text } from "./http.js";

const DEFAULT_TRANSLATION_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const LANGUAGE_LABELS = {
  ru: "Russian",
  "zh-CN": "Simplified Chinese",
};

function normalizeTranslation(value) {
  return text(value)
    .replace(/^["'«“”]+|["'«“”]+$/g, "")
    .trim();
}

function fallbackTranslation(source) {
  return text(source).slice(0, 2000);
}

export async function translateSupplierText(env, source, { from = "ru", to = "zh-CN" } = {}) {
  const input = fallbackTranslation(source);
  if (!input) return "";
  if (from === to) return input;
  if (!env?.AI?.run) return input;

  const model = text(env.SUPPLIER_TRANSLATION_MODEL || env.TRANSLATION_MODEL) || DEFAULT_TRANSLATION_MODEL;
  const fromLabel = LANGUAGE_LABELS[from] || from;
  const toLabel = LANGUAGE_LABELS[to] || to;
  const prompt = [
    `Translate from ${fromLabel} to ${toLabel}.`,
    "This is a short business message about car parts between EVLine and a Chinese supplier.",
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
