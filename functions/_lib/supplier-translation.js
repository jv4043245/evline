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
const RU_TO_ZH_TERMS = [
  ["панорамная крыша", "全景天窗"],
  ["лобовое стекло", "挡风玻璃"],
  ["задняя ступица", "后轮毂轴承"],
  ["передняя ступица", "前轮毂轴承"],
  ["передний бампер", "前保险杠"],
  ["задний бампер", "后保险杠"],
  ["передняя фара", "前大灯"],
  ["задний фонарь", "后尾灯"],
  ["крыша", "车顶"],
  ["панорамная", "全景"],
  ["капот", "引擎盖"],
  ["бампер", "保险杠"],
  ["фара", "大灯"],
  ["фонарь", "尾灯"],
  ["стекло", "玻璃"],
  ["дверь", "车门"],
  ["крыло", "翼子板"],
  ["зеркало", "后视镜"],
  ["решетка", "中网"],
  ["багажник", "后备箱"],
  ["крышка", "盖板"],
  ["диск", "轮毂"],
  ["колесо", "车轮"],
  ["ручка", "门把手"],
  ["радиатор", "散热器"],
  ["насос", "泵"],
  ["мотор", "电机"],
  ["двигатель", "发动机"],
  ["аккумулятор", "电池"],
  ["батарея", "电池"],
  ["блок", "模块"],
  ["датчик", "传感器"],
  ["камера", "摄像头"],
  ["проводка", "线束"],
  ["сиденье", "座椅"],
  ["руль", "方向盘"],
  ["рычаг", "摆臂"],
  ["стойка", "支柱"],
  ["ступица", "轮毂轴承"],
  ["замок", "锁"],
  ["левый", "左"],
  ["левая", "左"],
  ["левое", "左"],
  ["правый", "右"],
  ["правая", "右"],
  ["правое", "右"],
  ["передний", "前"],
  ["передняя", "前"],
  ["переднее", "前"],
  ["задний", "后"],
  ["задняя", "后"],
  ["заднее", "后"],
];

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dictionaryRuToZh(input) {
  const source = text(input);
  const lower = source.toLowerCase().trim();
  if (!CYRILLIC_RE.test(source)) return "";
  for (const [ru, zh] of RU_TO_ZH_TERMS) {
    if (lower === ru) return zh;
  }
  let translated = source;
  for (const [ru, zh] of RU_TO_ZH_TERMS) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(ru)}(?=$|[^\\p{L}\\p{N}])`, "giu");
    translated = translated.replace(pattern, `$1${zh}`);
  }
  return translated !== source ? translated : "";
}

function dictionaryTranslation(input, from, to) {
  if (to === "zh-CN" && (from === "ru" || from === "uk")) {
    return dictionaryRuToZh(input);
  }
  return "";
}

export function supplierTranslationLooksMissing(source, translated, { to = "zh-CN" } = {}) {
  const sourceText = fallbackTranslation(source);
  const translatedText = fallbackTranslation(translated);
  const targetLang = normalizeLanguageCode(to);
  if (!sourceText) return false;
  if (!translatedText) return true;
  if (targetLang === "zh-CN") return CYRILLIC_RE.test(translatedText) && !CJK_RE.test(translatedText);
  if (targetLang === "ru" || targetLang === "uk") return CJK_RE.test(translatedText) && !CYRILLIC_RE.test(translatedText);
  return translatedText === sourceText;
}

export async function translateSupplierText(env, source, { from = "ru", to = "zh-CN" } = {}) {
  const input = fallbackTranslation(source);
  if (!input) return "";
  const sourceLang = normalizeLanguageCode(from);
  const targetLang = normalizeLanguageCode(to);
  if (isLikelyAlreadyTargetLanguage(input, sourceLang, targetLang)) return input;
  const dictionaryFallback = dictionaryTranslation(input, sourceLang, targetLang);
  if (!env?.AI?.run) return dictionaryFallback || input;

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
    const candidate = normalizeTranslation(result?.response || result?.result?.response || result?.text || "");
    if (candidate && !supplierTranslationLooksMissing(input, candidate, { to: targetLang })) return candidate;
    return dictionaryFallback || candidate || input;
  } catch (error) {
    console.error("Supplier translation failed", error?.message || error);
    return dictionaryFallback || input;
  }
}

export function supplierTranslationDirections() {
  return {
    managerToSupplier: { from: "ru", to: "zh-CN" },
    supplierToManager: { from: "zh-CN", to: "ru" },
  };
}
