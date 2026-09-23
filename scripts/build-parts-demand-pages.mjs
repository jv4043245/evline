import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const siteUrl = "https://evline.com.ua";
const template = await readFile(path.join(root, "scripts/templates/parts-demand-page.tmpl"), "utf8");
const config = JSON.parse(await readFile(path.join(root, "scripts/parts-demand-pages.json"), "utf8"));

const common = {
  uk: {
    htmlLang: "uk-UA",
    inLanguage: "uk-UA",
    ogLocale: "uk_UA",
    skipLink: "До змісту",
    homeUrl: "/",
    navAria: "Основна навігація",
    navParts: "Запчастини з Китаю",
    navProgramming: "Програмування BYD",
    programmingUrl: "/byd",
    navSto: "Для СТО",
    stoUrl: "/spivpratsya-sto/",
    languageAria: "Змінити мову",
    menuAria: "Відкрити меню",
    telegramCta: "Telegram-чат з менеджером",
    breadcrumbAria: "Хлібні крихти",
    bydHubPath: "/zapchastyny-byd/",
    bydHubLabel: "Запчастини BYD",
    vinPlaceholder: "VIN-код (за можливості)",
    phonePlaceholder: "Телефон +380...",
    formButton: "Надіслати запит у Telegram",
    callLabel: "Або подзвонити:",
    processLabel: "Як працюємо",
    processTitle: "Від запиту до отримання деталі",
    processCards: [
      ["Надсилаєте VIN і запит", "Модель, VIN, фото пошкодження або назва потрібної деталі."],
      ["Звіряємо сумісність", "Перевіряємо артикул, рік, комплектацію та ринок автомобіля."],
      ["Погоджуємо варіант", "Пояснюємо різницю між оригіналом та OEM, фіксуємо ціну і маршрут."],
      ["Перевіряємо і доставляємо", "Спеціаліст у Китаї оглядає деталь, після чого відправляємо її в Україну."],
    ],
    relatedTitle: "Корисні сторінки про запчастини BYD",
    contactButton: "Написати в Telegram",
    address: "м. Київ, Оболонська набережна, 1",
    hours: "Пн–Пт: 10:00–18:00",
    footerManager: "Менеджер із запчастин",
    rights: "Усі права захищено",
    footerAria: "Нижня навігація",
    brandsUrl: "/zapchastyny-kytajskyh-avto/",
    brandsLabel: "Марки авто",
    privacyUrl: "/privacy/",
    sellerText: "EVLine — торгове найменування діяльності ФОП Ванюшин Євген Анатолійович, власника сайту та продавця запчастин.",
    sellerLink: "Про продавця та контакти",
  },
  ru: {
    htmlLang: "ru-UA",
    inLanguage: "ru-UA",
    ogLocale: "ru_UA",
    skipLink: "К содержанию",
    homeUrl: "/ru/",
    navAria: "Основная навигация",
    navParts: "Запчасти из Китая",
    navProgramming: "Программирование BYD",
    programmingUrl: "/ru/byd",
    navSto: "Для СТО",
    stoUrl: "/ru/sotrudnichestvo-sto/",
    languageAria: "Изменить язык",
    menuAria: "Открыть меню",
    telegramCta: "Telegram-чат с менеджером",
    breadcrumbAria: "Хлебные крошки",
    bydHubPath: "/ru/zapchasti-byd/",
    bydHubLabel: "Запчасти BYD",
    vinPlaceholder: "VIN-код (по возможности)",
    phonePlaceholder: "Телефон +380...",
    formButton: "Отправить запрос в Telegram",
    callLabel: "Или позвонить:",
    processLabel: "Как работаем",
    processTitle: "От запроса до получения детали",
    processCards: [
      ["Присылаете VIN и запрос", "Модель, VIN, фото повреждения или название нужной детали."],
      ["Сверяем совместимость", "Проверяем артикул, год, комплектацию и рынок автомобиля."],
      ["Согласовываем вариант", "Объясняем разницу между оригиналом и OEM, фиксируем цену и маршрут."],
      ["Проверяем и доставляем", "Специалист в Китае осматривает деталь, после чего отправляем ее в Украину."],
    ],
    relatedTitle: "Полезные страницы о запчастях BYD",
    contactButton: "Написать в Telegram",
    address: "г. Киев, Оболонская набережная, 1",
    hours: "Пн–Пт: 10:00–18:00",
    footerManager: "Менеджер по запчастям",
    rights: "Все права защищены",
    footerAria: "Нижняя навигация",
    brandsUrl: "/ru/zapchasti-kitajskih-avto/",
    brandsLabel: "Марки авто",
    privacyUrl: "/ru/privacy/",
    sellerText: "EVLine — торговое наименование деятельности ФЛП Ванюшин Евгений Анатольевич, владельца сайта и продавца запчастей.",
    sellerLink: "О продавце и контактах",
  },
};

const relatedPages = {
  uk: [
    ["hub", "/zapchastyny-byd/", "Усі запчастини BYD"],
    ["song-plus", "/zapchastyny-byd/song-plus/", "Запчастини BYD Song Plus"],
    ["song-l", "/zapchastyny-byd/song-l/", "Запчастини BYD Song L"],
    ["body", "/zapchastyny-byd/kuzovni-detali/", "Кузовні деталі BYD"],
    ["suspension", "/zapchastyny-byd/pidviska-kermove/", "Підвіска та кермове BYD"],
    ["optics", "/zapchastyny-byd/fary-sklo/", "Фари, ліхтарі та скло BYD"],
    ["dtp", "/zapchastyny-pislya-dtp/", "Запчастини після ДТП"],
  ],
  ru: [
    ["hub", "/ru/zapchasti-byd/", "Все запчасти BYD"],
    ["song-plus", "/ru/zapchasti-byd/song-plus/", "Запчасти BYD Song Plus"],
    ["song-l", "/ru/zapchasti-byd/song-l/", "Запчасти BYD Song L"],
    ["body", "/ru/zapchasti-byd/kuzovnye-detali/", "Кузовные детали BYD"],
    ["suspension", "/ru/zapchasti-byd/podveska-rulevoe/", "Подвеска и рулевое BYD"],
    ["optics", "/ru/zapchasti-byd/fary-steklo/", "Фары, фонари и стекло BYD"],
    ["dtp", "/ru/zapchasti-posle-dtp/", "Запчасти после ДТП"],
  ],
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cards(items) {
  return items.map((item) => "<article><span>" + escapeHtml(item.badge) + "</span><h3>" + escapeHtml(item.title) + "</h3><p>" + escapeHtml(item.text) + "</p></article>").join("\n            ");
}

function listItems(items) {
  return items.map((item) => "<li>" + escapeHtml(item) + "</li>").join("\n              ");
}

function faqCards(items) {
  return items.map((item) => "<article><h3>" + escapeHtml(item.question) + "</h3><p>" + escapeHtml(item.answer) + "</p></article>").join("\n            ");
}

function processCards(items) {
  return items.map((item, index) => "<article><strong>" + (index + 1) + "</strong><h3>" + escapeHtml(item[0]) + "</h3><p>" + escapeHtml(item[1]) + "</p></article>").join("\n            ");
}

function structuredData(page, language, copy, canonical) {
  const isUk = language === "uk";
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["AutoPartsStore", "AutoRepair"],
        "@id": siteUrl + "/#business",
        name: "EVLine Ukraine",
        url: siteUrl,
        logo: siteUrl + "/assets/images/logo.png",
        image: siteUrl + "/assets/images/logo.png",
        telephone: "+380935251024",
        email: "evlineukraine@gmail.com",
        priceRange: "$$",
        openingHoursSpecification: [{
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          opens: "10:00",
          closes: "18:00",
        }],
        address: {
          "@type": "PostalAddress",
          streetAddress: isUk ? "Оболонська набережна, 1" : "Оболонская набережная, 1",
          addressLocality: isUk ? "Київ" : "Киев",
          addressCountry: "UA",
        },
        areaServed: { "@type": "Country", name: isUk ? "Україна" : "Украина" },
        sameAs: ["https://t.me/evline_support"],
      },
      {
        "@type": "BreadcrumbList",
        "@id": canonical + "#breadcrumb",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "EVLine", item: siteUrl + copy.homeUrl },
          { "@type": "ListItem", position: 2, name: copy.bydHubLabel, item: siteUrl + copy.bydHubPath },
          { "@type": "ListItem", position: 3, name: page.pageLabel, item: canonical },
        ],
      },
      {
        "@type": "Service",
        "@id": canonical + "#service",
        name: page.h1,
        serviceType: "Auto parts sourcing and delivery from China",
        provider: { "@id": siteUrl + "/#business" },
        areaServed: { "@type": "Country", name: isUk ? "Україна" : "Украина" },
        description: page.description,
        url: canonical,
      },
      {
        "@type": "FAQPage",
        "@id": canonical + "#faq",
        inLanguage: copy.inLanguage,
        mainEntity: page.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
      {
        "@type": "WebPage",
        "@id": canonical + "#webpage",
        url: canonical,
        name: page.title,
        inLanguage: copy.inLanguage,
        isPartOf: { "@id": siteUrl + "/#website" },
        primaryImageOfPage: { "@type": "ImageObject", url: siteUrl + page.image },
      },
    ],
  });
}

function renderPage(topic, language) {
  const page = topic[language];
  const copy = common[language];
  const uaPath = "/" + topic.uaPath + "/";
  const ruPath = "/" + topic.ruPath + "/";
  const uaUrl = siteUrl + uaPath;
  const ruUrl = siteUrl + ruPath;
  const canonical = language === "uk" ? uaUrl : ruUrl;
  const currentPath = language === "uk" ? topic.uaPath : topic.ruPath;
  const related = relatedPages[language]
    .filter((item) => item[0] !== topic.key)
    .map((item) => '<a href="' + item[1] + '">' + escapeHtml(item[2]) + "</a>")
    .join("\n              ");
  const carInput = page.carValue
    ? '<input name="car" value="' + escapeHtml(page.carValue) + '" required>'
    : '<input name="car" placeholder="' + escapeHtml(page.carPlaceholder) + '" required>';

  const replacements = {
    HTML_LANG: copy.htmlLang,
    TITLE: page.title,
    DESCRIPTION: page.description,
    CANONICAL: canonical,
    UA_URL: uaUrl,
    RU_URL: ruUrl,
    UA_PATH: uaPath,
    RU_PATH: ruPath,
    OG_LOCALE: copy.ogLocale,
    ABSOLUTE_IMAGE: siteUrl + page.image,
    JSON_LD: structuredData(page, language, copy, canonical),
    SKIP_LINK: copy.skipLink,
    HOME_URL: copy.homeUrl,
    NAV_ARIA: copy.navAria,
    NAV_PARTS: copy.navParts,
    NAV_PROGRAMMING: copy.navProgramming,
    PROGRAMMING_URL: copy.programmingUrl,
    NAV_STO: copy.navSto,
    STO_URL: copy.stoUrl,
    LANGUAGE_ARIA: copy.languageAria,
    MENU_ARIA: copy.menuAria,
    TELEGRAM_CTA: copy.telegramCta,
    BREADCRUMB_ARIA: copy.breadcrumbAria,
    BYD_HUB_PATH: copy.bydHubPath,
    BYD_HUB_LABEL: copy.bydHubLabel,
    PAGE_LABEL: page.pageLabel,
    KICKER: page.kicker,
    H1: page.h1,
    LEAD: page.lead,
    TAG_ITEMS: page.tags.map((item) => "<span>" + escapeHtml(item) + "</span>").join("\n              "),
    FORM_TITLE: page.formTitle,
    CAR_INPUT: carInput,
    VIN_PLACEHOLDER: copy.vinPlaceholder,
    PART_PLACEHOLDER: page.partPlaceholder,
    PHONE_PLACEHOLDER: copy.phonePlaceholder,
    FORM_BUTTON: copy.formButton,
    CALL_LABEL: copy.callLabel,
    PROOF_LABEL: page.proofLabel,
    PROOF_TITLE: page.proofTitle,
    PROOF_TEXT: page.proofText,
    PROOF_ITEMS: listItems(page.proofItems),
    IMAGE: page.image,
    IMAGE_ALT: page.imageAlt,
    PRIMARY_LABEL: page.primaryLabel,
    PRIMARY_TITLE: page.primaryTitle,
    PRIMARY_INTRO: page.primaryIntro,
    PRIMARY_CARDS: cards(page.primaryCards),
    SECONDARY_LABEL: page.secondaryLabel,
    SECONDARY_TITLE: page.secondaryTitle,
    SECONDARY_INTRO: page.secondaryIntro,
    SECONDARY_CARDS: cards(page.secondaryCards),
    PROCESS_LABEL: copy.processLabel,
    PROCESS_TITLE: copy.processTitle,
    PROCESS_CARDS: processCards(copy.processCards),
    FAQ_TITLE: page.faqTitle,
    FAQ_CARDS: faqCards(page.faq),
    RELATED_TITLE: copy.relatedTitle,
    RELATED_LINKS: related,
    CONTACT_PROMPT: page.contactPrompt,
    CONTACT_BUTTON: copy.contactButton,
    ADDRESS: copy.address,
    HOURS: copy.hours,
    FOOTER_MANAGER: copy.footerManager,
    RIGHTS: copy.rights,
    FOOTER_ARIA: copy.footerAria,
    BRANDS_URL: copy.brandsUrl,
    BRANDS_LABEL: copy.brandsLabel,
    SELLER_TEXT: copy.sellerText,
    PRIVACY_URL: copy.privacyUrl,
    SELLER_LINK: copy.sellerLink,
    UK_CURRENT: language === "uk" ? ' aria-current="true"' : "",
    RU_CURRENT: language === "ru" ? ' aria-current="true"' : "",
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll("{{" + token + "}}", () => String(value));
  }
  const unresolved = html.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolved) throw new Error(currentPath + ": unresolved tokens: " + unresolved.join(", "));
  return html;
}

let generated = 0;
for (const topic of config.pages) {
  for (const language of ["uk", "ru"]) {
    const relativePath = language === "uk" ? topic.uaPath : topic.ruPath;
    const destination = path.join(root, relativePath, "index.html");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, renderPage(topic, language));
    generated += 1;
  }
}

console.log("Generated " + generated + " demand-backed BYD SEO pages.");
