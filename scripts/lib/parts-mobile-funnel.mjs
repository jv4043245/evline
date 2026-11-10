import { parse } from "node-html-parser";

const brandPairs = [
  ["zapchastyny-byd", "zapchasti-byd"],
  ["zapchastyny-zeekr", "zapchasti-zeekr"],
  ["zapchastyny-mg", "zapchasti-mg"],
  ["zapchastyny-polestar", "zapchasti-polestar"],
  ["zapchastyny-volkswagen-id", "zapchasti-volkswagen-id"],
];
const modelPairs = [
  ...["atto-3", "dolphin", "han", "seal", "song-plus", "tang"].map(model =>
    [`zapchastyny-byd/${model}`, `zapchasti-byd/${model}`]),
  ...["001", "7x", "x"].map(model =>
    [`zapchastyny-zeekr/${model}`, `zapchasti-zeekr/${model}`]),
];

export const partsMobilePages = [...brandPairs, ...modelPairs]
  .flatMap(([uk, ru]) => [`/${uk}/`, `/ru/${ru}/`]);
export const partsMobileStylesheet = "/assets/css/parts-brand-mobile.css?v=20261110-brand-mobile-1";

export function withPartsMobileFunnel(html) {
  const doc = parse(html);
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (!canonical || !partsMobilePages.includes(new URL(canonical).pathname)) return html;
  let output = html;
  if (!doc.querySelector("[data-parts-mobile-style]")) {
    output = output.replace("</head>", `<link rel="stylesheet" href="${partsMobileStylesheet}" data-parts-mobile-style>\n</head>`);
  }
  if (!doc.querySelector("[data-parts-mobile-contactbar]")) {
    const ru = doc.querySelector("html")?.getAttribute("lang")?.startsWith("ru");
    const label = ru ? "Связь с менеджером по запчастям" : "Зв’язок з менеджером із запчастин";
    const call = ru ? "Позвонить" : "Подзвонити";
    const bar = `<nav class="parts-brand-contactbar" aria-label="${label}" data-parts-mobile-contactbar>\n  <a href="tel:+380935251024" data-contact-intent="parts" data-contact-id="brand-mobile-call">${call}</a>\n  <a href="https://t.me/evline_support" target="_blank" rel="noopener noreferrer" data-contact-intent="parts" data-contact-id="brand-mobile-telegram">Telegram</a>\n</nav>`;
    output = output.replace(/([ \t]*)<\/body>/, `${bar}\n$1</body>`);
  }
  return output;
}
