import { mkdir, readFile, writeFile } from "node:fs/promises";
import { withFooterContacts } from "./lib/footer-contacts.mjs";
import { withSellerIdentity } from "./lib/seller-identity.mjs";

const catalog = "/v-nayavnosti/";
const site = "https://evline.com.ua";
const stock = JSON.parse(await readFile(new URL("./stock-catalog.json", import.meta.url), "utf8"));
const root = new URL("../", import.meta.url);
const phone = "+380935251024";
const termsPath = "/v-nayavnosti/umovy/";
// Owner-confirmed terms (19.11.2026): Nova Poshta at carrier rates paid by the
// buyer, dispatch next working day, 1–3 days in transit; 14-day returns of
// unfitted parts, return shipping paid by the buyer unless the error is ours.
const terms = { returnDays: 14, handlingDays: [0, 1], transitDays: [1, 3] };
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);
const modelName = ({ brand, model }) => `${brand} ${model}`;
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const productPath = (item) => `${catalog}${slug(item.brand)}/${slug(item.model)}/${slug(item.sku)}/`;
const priceLabel = (price) => `${new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(price)} грн`;
const availability = ({ inStock }) => inStock ? "В наявності" : "Немає в наявності";
const badge = (item) => `<span class="stock-badge${item.inStock ? "" : " stock-badge--unavailable"}">${availability(item)}</span>`;
const attributeBadge = (text) => `<span class="stock-badge stock-badge--attribute">${text}</span>`;
const vehiclePhotos = {
  // JustAnotherCarDesigner, Wikimedia Commons, CC0 1.0.
  // https://commons.wikimedia.org/wiki/File:Denza_N7_facelift_011.jpg
  "Denza N7": "/assets/images/stock/denza-n7-model.png",
};

function productThumbnail({ image, thumbnail, name, sku }) {
  return image
    ? `          <img class="stock-thumb" src="${escape(thumbnail || image)}" alt="${escape(`${name} ${sku}`)}" width="440" height="146" decoding="async">\n`
    : "";
}

// Simple line icons (Lucide style), drawn with currentColor.
const iconPaths = {
  genuine: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  new: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  buyers: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.26a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/>',
  telegram: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
};
const icon = (name, size = 20) => `<svg class="stock-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]}</svg>`;

// Top view of a car, front up; highlights the wheels where the part is fitted.
function placementDiagram({ axle, side } = {}) {
  const wheels = [
    ["front", "left", 4, 16], ["front", "right", 44, 16],
    ["rear", "left", 4, 64], ["rear", "right", 44, 64],
  ];
  const active = ([a, s]) => a === axle && (side === "both" || s === side);
  return `<svg class="stock-placement-car" width="56" height="96" viewBox="0 0 56 96" aria-hidden="true">
            <rect x="10" y="4" width="36" height="88" rx="14" class="car-body"/>
            <rect x="15" y="22" width="26" height="14" rx="4" class="car-glass"/>
            <rect x="15" y="62" width="26" height="10" rx="4" class="car-glass"/>
${wheels.map((wheel) => `            <rect x="${wheel[2]}" y="${wheel[3]}" width="8" height="16" rx="3" class="car-wheel${active(wheel) ? " is-active" : ""}"/>`).join("\n")}
          </svg>`;
}

function productGallery(item) {
  if (!item.image) return "";
  const vehicle = vehiclePhotos[modelName(item)];
  const marking = item.marking;
  const srcset = item.thumbnail ? ` srcset="${escape(item.thumbnail)} 440w, ${escape(item.image)} 1440w" sizes="(max-width: 670px) calc(100vw - 54px), min(66vw, 710px)"` : "";
  return `      <div class="stock-gallery">
        <figure class="stock-stage">
          <a href="${escape(item.image)}" aria-label="Збільшити фото деталі" data-lightbox data-caption="${escape(`${item.name} ${modelName(item)} · ${item.sku}`)}">
            <img class="stock-image" src="${escape(item.image)}"${srcset} alt="${escape(`${item.name} ${item.sku}`)}" width="1440" height="480" fetchpriority="high">
          </a>
        </figure>
        <div class="stock-tiles">
${vehicle ? `          <div class="stock-tile stock-vehicle">
            <img src="${escape(vehicle)}" alt="" width="320" height="180" decoding="async">
            <div><span>Для авто</span><strong>${escape(modelName(item))}</strong></div>
          </div>\n` : ""}${marking ? `          <a class="stock-tile stock-marking${marking.tightCrop ? " stock-marking-crop" : ""}" href="${escape(marking.src)}" aria-label="Відкрити фото маркування" data-lightbox data-caption="${escape(marking.alt)}">
            <img src="${escape(marking.src)}" alt="${escape(marking.alt)}" width="${marking.width}" height="${marking.height}" loading="lazy" decoding="async">
            <div><span>Реальне фото</span><strong>Маркування</strong></div>
          </a>\n` : ""}        </div>
      </div>\n`;
}

// Spellings people type into search: without dashes and with the maker prefix.
function numberAliases({ sku, cross, partBrand }) {
  const plain = (value) => value.replace(/[^0-9A-Za-z]/g, "");
  return [...new Set([plain(sku), plain(cross), partBrand ? `${partBrand} ${sku}` : ""].filter(Boolean))];
}

function numberRow(label, value) {
  return `<div><dt>${label}</dt><dd><strong>${escape(value)}</strong><button type="button" class="stock-copy" data-copy="${escape(value)}" aria-label="Скопіювати: ${escape(value)}" title="Скопіювати">${icon("copy", 16)}</button></dd></div>`;
}

function fitmentBlock(item) {
  const vinText = `Добрий день! Хочу перевірити сумісність ${item.sku} (${modelName(item)}). Мій VIN: `;
  return `<section class="stock-fit" aria-labelledby="fit-title">
          <h2 id="fit-title">Сумісність</h2>
          <ul>
            <li class="is-yes">${icon("check")}<span><strong>${escape(modelName(item))}</strong></span></li>
${(item.alsoListedFor || []).map((car) => `            <li class="is-check">${icon("search")}<span><strong>${escape(car)}</strong> — є в каталогах, перевіримо за VIN</span></li>`).join("\n")}
          </ul>
          <p class="stock-muted">${escape(item.fitmentCheck || item.fitment)}</p>
          <a class="stock-vin-link" href="https://t.me/evline_support?text=${encodeURIComponent(vinText)}" target="_blank" rel="noopener" data-contact-intent="parts" data-contact-id="stock-fitment-telegram">${icon("telegram", 18)}Перевірити за VIN у Telegram</a>
        </section>`;
}

function breadcrumbs(entries) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: entries.map(([name, path], index) => ({
      "@type": "ListItem", position: index + 1, name, item: site + path,
    })),
  };
}

function page({ path, title, description, schema, content, item }) {
  const fullTitle = `${title} | EVLine`;
  const url = site + path;
  return withFooterContacts(withSellerIdentity(`<!DOCTYPE html>
<!-- Generated by scripts/build-stock-catalog.mjs -->
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(fullTitle)}</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="${url}">
  <link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/css/stock-catalog.css?v=20261119-card-7">
  <meta property="og:locale" content="uk_UA">
  <meta property="og:type" content="${item ? "product" : "website"}">
  <meta property="og:title" content="${escape(fullTitle)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${url}">
${item?.image ? `  <meta property="og:image" content="${escape(new URL(item.image, site).href)}">\n` : ""}  <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": schema }).replace(/</g, "\\u003c")}</script>
  <script src="/assets/js/${item?.inStock ? "main" : "contact-tracking"}.js" defer></script>
  <script src="/assets/js/stock-card.js?v=20261119-card-4" defer></script>
</head>
<body>
  <header class="stock-header">
    <div class="stock-wrap stock-header-inner">
      <a href="/"><img src="/assets/logo.svg" alt="EVLine" width="128" height="52"></a>
      <nav aria-label="Розділи сайту">
        <a href="${catalog}"${item ? "" : ' aria-current="page"'}>В наявності</a>
        <a href="/">Підбір з Китаю</a>
      </nav>
    </div>
  </header>
  <main class="stock-wrap stock-main">
${content}
  </main>
  <footer class="stock-footer"><div class="stock-wrap">
    <span>EVLine Україна</span>
    <a href="tel:${phone}">+38 (093) 525-10-24</a>
    <a href="${termsPath}">Доставка, оплата та повернення</a>
    <a href="/privacy/">Конфіденційність</a>
  </div></footer>
</body>
</html>
`));
}

const catalogName = "Запчастини в наявності";
const home = ["EVLine", "/"];
const catalogCrumb = [catalogName, catalog];
const groups = Map.groupBy(stock, modelName);
const groupId = (name) => slug(name);

const models = [...groups.keys()];
const brandIcon = (item) => item.isGenuine ? `<span class="stock-card-fact">${icon("genuine", 16)}Оригінал</span>` : "";
const newIcon = (item) => item.isNew ? `<span class="stock-card-fact">${icon("new", 16)}Нова</span>` : "";

function catalogCard(item) {
  const searchText = [item.name, item.design, item.sku, item.cross, modelName(item), ...numberAliases(item)].join(" ").toLowerCase();
  return `        <li class="stock-row stock-card" data-search="${escape(searchText)}">
          <a class="stock-card-media" href="${productPath(item)}" tabindex="-1" aria-hidden="true">
${productThumbnail(item).replace(/^ +/, "            ")}          </a>
          <div class="stock-card-body">
            <p class="stock-code">${escape(item.sku)} <span>· ${escape(item.cross)}</span></p>
            <h3><a href="${productPath(item)}">${escape(item.name)}</a></h3>
            <p class="stock-card-place">${placementDiagram(item.placement).replace('width="56" height="96"', 'width="14" height="24"')}${escape(item.position)}</p>
            <p class="stock-card-facts">${brandIcon(item)}${newIcon(item)}</p>
          </div>
          <div class="stock-row-price">${badge(item)}<strong>${priceLabel(item.price)}</strong><a class="stock-card-buy" href="${productPath(item)}#buy">${item.inStock ? "Купити" : "Детальніше"}</a></div>
        </li>`;
}

const list = page({
  path: catalog,
  title: `Запчастини ${models.join(", ")} в наявності — оригінал зі складу`,
  description: `Оригінальні нові запчастини ${models.join(", ")} зі складу EVLine: ${stock.slice(0, 3).map((item) => `${item.name.toLowerCase()} ${item.sku}`).join(", ")}. Відправлення наступного робочого дня Новою поштою, повернення 14 днів.`,
  schema: [breadcrumbs([home, catalogCrumb]), {
    "@type": "ItemList",
    itemListElement: stock.map((item, index) => ({
      "@type": "ListItem", position: index + 1, name: `${item.name} ${modelName(item)}`, url: site + productPath(item),
    })),
  }],
  content: `    <section class="stock-hero">
      <h1>${catalogName}</h1>
      <p class="stock-intro">Оригінальні нові деталі зі складу — без очікування доставки з Китаю.</p>
      <ul class="stock-perks">
        <li>${icon("clock")}<span><strong>Відправлення наступного робочого дня</strong></span></li>
        <li>${icon("truck")}<span><strong>Нова пошта, 1–3 дні</strong></span></li>
        <li>${icon("genuine")}<span><strong>Повернення 14 днів</strong></span></li>
        <li>${icon("buyers")}<span><strong>Рахунок або накладений платіж</strong></span></li>
      </ul>
      <a class="stock-perks-link" href="${termsPath}">Умови доставки, оплати та повернення</a>
    </section>
    <div class="stock-search">
      ${icon("search", 18)}
      <input type="search" placeholder="Пошук за назвою або артикулом" aria-label="Пошук за назвою або артикулом" data-stock-search>
    </div>
    <p class="stock-search-empty" data-stock-empty hidden>Нічого не знайшли на складі. <a href="/#vin-form">Підберемо й привеземо з Китаю</a></p>
${[...groups].map(([name, items]) => `    <section class="stock-group" id="${groupId(name)}">
      <h2>${escape(name)} <span>${items.length}</span></h2>
      <ul class="stock-list stock-grid">
${items.map(catalogCard).join("\n")}
      </ul>
    </section>`).join("\n")}
    <section class="stock-cta">
      <div>
        <h2>Немає потрібної деталі?</h2>
        <p>Підберемо за VIN і привеземо з Китаю — авіа від 20 днів. Оригінал або якісний OEM, ціна «під ключ» до оплати.</p>
      </div>
      <div class="stock-cta-actions">
        <a class="stock-cta-main" href="/#vin-form">Підібрати за VIN</a>
        <a class="stock-cta-tg" href="https://t.me/evline_support" target="_blank" rel="noopener" data-contact-intent="parts" data-contact-id="stock-catalog-telegram">${icon("telegram", 18)}Telegram</a>
      </div>
    </section>`,
});

function productPage(item) {
  const path = productPath(item);
  const name = `${item.name} ${modelName(item)}`;
  const title = `${name} ${item.sku}`;
  return page({
    path, title: item.searchTitle || title, item,
    description: `${item.searchDescription || item.description} ${availability(item)}: ${priceLabel(item.price)}. Доставка по Україні.`,
    schema: [breadcrumbs([home, catalogCrumb, [title, path]]), {
      "@type": "Product",
      "@id": site + path + "#product",
      name: title,
      description: item.description,
      sku: item.sku,
      mpn: item.sku,
      ...(item.partBrand ? { brand: { "@type": "Brand", name: item.partBrand } } : {}),
      isAccessoryOrSparePartFor: { "@type": "Car", name: modelName(item), brand: { "@type": "Brand", name: item.brand } },
      additionalProperty: [{ "@type": "PropertyValue", name: "Крос-номер", value: item.cross }],
      ...(item.image ? { image: new URL(item.image, site).href } : {}),
      url: site + path,
      offers: {
        "@type": "Offer",
        url: site + path,
        priceCurrency: "UAH",
        price: item.price.toFixed(2),
        availability: `https://schema.org/${item.inStock ? "InStock" : "OutOfStock"}`,
        ...(item.isNew ? { itemCondition: "https://schema.org/NewCondition" } : {}),
        seller: { "@type": "Organization", name: "EVLine Україна" },
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "UA",
          returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
          merchantReturnDays: terms.returnDays,
          returnMethod: "https://schema.org/ReturnByMail",
          returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
          merchantReturnLink: site + termsPath,
        },
      },
    }],
    content: `    <nav class="stock-crumb" aria-label="Навігаційний шлях">
      <a href="${catalog}">Запчастини в наявності</a><span aria-hidden="true">/</span>
      <a href="${catalog}#${groupId(modelName(item))}">${escape(modelName(item))}</a>
    </nav>
    <h1>${escape(name)}</h1>
    <p class="stock-h1-code">${escape(item.sku)} <span>· ${escape(item.cross)}</span></p>
    <div class="stock-detail${item.image ? " stock-detail--media" : ""}">
${productGallery(item)}      <div class="stock-specs">
        <div class="stock-placement">
          ${placementDiagram(item.placement)}
          <div>
            <span>Місце встановлення</span>
            <strong>${escape(item.position)}</strong>
            <p>${escape(item.design)}</p>
          </div>
        </div>
        <dl class="stock-numbers">
          ${numberRow("Артикул", item.sku)}
          ${numberRow("Крос-номер", item.cross)}
        </dl>
        ${fitmentBlock(item)}
        <section class="stock-about" aria-labelledby="about-title">
          <h2 id="about-title">Про деталь</h2>
          <p>${escape(item.description)}</p>
          <p class="stock-aliases">Інші варіанти номера: ${escape(numberAliases(item).join(", "))}</p>
        </section>
      </div>
      <section class="stock-order" id="buy" aria-label="Замовлення">
        <div class="stock-price-row">
          <p class="stock-total">${priceLabel(item.price)}</p>
          ${badge(item)}
        </div>
        <ul class="stock-badges" aria-label="Стан деталі">
${item.isGenuine ? `          <li class="stock-fact">${icon("genuine", 22)}<span>${attributeBadge("Оригінал")}<small>заводська деталь</small></span></li>\n` : ""}${item.isNew ? `          <li class="stock-fact">${icon("new", 22)}<span>${attributeBadge("Нова")}<small>без пробігу</small></span></li>\n` : ""}        </ul>
        ${item.inStock ? `<details class="stock-checkout">
          <summary>Купити</summary>
          <form class="stock-form" action="/api/leads" method="post" aria-label="Оформлення замовлення" data-lead-form data-light-form data-form-name="${escape(`Склад: ${item.sku}`)}" data-lead-success="Замовлення прийнято. Менеджер зв’яжеться з вами, щоб підтвердити доставку.">
            <input type="hidden" name="type" value="parts">
            <input type="hidden" name="topic" value="Замовлення зі складу">
            <input type="hidden" name="car" value="${escape(modelName(item))}">
            <input type="hidden" name="part" value="${escape(`${item.name} · ${item.sku}`)}">
            <label>Ім’я <input name="name" autocomplete="given-name" maxlength="100" required></label>
            <label>Телефон <input name="phone" type="tel" autocomplete="tel" placeholder="+380" maxlength="28" required></label>
            <label>Місто та відділення <span class="stock-muted">(необов’язково)</span><input name="message" placeholder="Напр.: Львів, відділення № 12" maxlength="220"></label>
            <button type="submit">Підтвердити замовлення</button>
            <p class="form__note" data-form-message role="status"></p>
          </form>
        </details>` : ""}
        <div class="stock-terms">
          <ul>
            <li>${icon("truck")}<span>Доставка по всій Україні</span></li>
${item.inStock ? `            <li>${icon("clock")}<span>Відправлення завтра</span></li>\n` : ""}            <li>${icon("buyers")}<span>Працюємо з фізичними та юридичними особами</span></li>
            <li class="stock-terms-link"><a href="${termsPath}">Умови доставки й повернення</a></li>
          </ul>
          <a class="stock-call" href="tel:${phone}" data-contact-intent="parts" data-contact-id="stock-product-call" aria-label="Зателефонувати: +38 (093) 525-10-24" title="Зателефонувати">${icon("phone")}</a>
        </div>
      </section>
    </div>
${item.inStock ? `    <div class="stock-sticky" hidden>
      <div><strong>${priceLabel(item.price)}</strong><span>В наявності</span></div>
      <a href="#buy" data-open-checkout>Купити</a>
    </div>` : ""}`,
  });
}

const termsPage = page({
  path: termsPath,
  title: "Доставка, оплата та повернення",
  description: "Умови для запчастин зі складу EVLine: доставка Новою поштою по Україні, оплата рахунком або накладеним платежем, повернення протягом 14 днів.",
  schema: [breadcrumbs([home, catalogCrumb, ["Доставка, оплата та повернення", termsPath]])],
  content: `    <nav class="stock-crumb" aria-label="Навігаційний шлях">
      <a href="${catalog}">Запчастини в наявності</a>
    </nav>
    <h1>Доставка, оплата та повернення</h1>
    <p class="stock-intro">Умови для запчастин, які є в наявності на складі EVLine.</p>
    <div class="stock-policy">
      <section>
        <h2>${icon("truck", 22)}Доставка</h2>
        <ul>
          <li>Новою поштою по всій Україні — у відділення, поштомат або кур’єром.</li>
          <li>Відправляємо наступного робочого дня після підтвердження замовлення.</li>
          <li>У дорозі зазвичай 1–3 дні.</li>
          <li>Вартість доставки — за тарифами Нової пошти, сплачує покупець при отриманні.</li>
        </ul>
      </section>
      <section>
        <h2>${icon("buyers", 22)}Оплата</h2>
        <ul>
          <li>Рахунок на ФОП — для фізичних і юридичних осіб.</li>
          <li>Накладений платіж — оплата при отриманні у Новій пошті.</li>
        </ul>
      </section>
      <section>
        <h2>${icon("genuine", 22)}Повернення</h2>
        <ul>
          <li>Повернути деталь можна протягом ${terms.returnDays} днів з дня отримання.</li>
          <li>Деталь не встановлювалась на авто, без слідів монтажу, з цілими упаковкою та маркуванням.</li>
          <li>Зворотну доставку сплачує покупець. Якщо ми помилились із деталлю — повернення за наш рахунок.</li>
          <li>Щоб оформити повернення, напишіть або зателефонуйте менеджеру: <a href="tel:${phone}">+38 (093) 525-10-24</a>.</li>
        </ul>
      </section>
    </div>
    <p class="stock-more"><a href="${catalog}">← Запчастини в наявності</a></p>`,
});

// Product feed for Google Merchant Center (RSS 2.0 with the g: namespace).
const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[c]);
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/build-stock-catalog.mjs -->
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>EVLine — запчастини в наявності</title>
    <link>${site}${catalog}</link>
    <description>Запчастини зі складу EVLine з доставкою по Україні</description>
${stock.map((item) => `    <item>
      <g:id>${xml(item.sku)}</g:id>
      <g:title>${xml(`${item.name} ${modelName(item)} ${item.sku}`)}</g:title>
      <g:description>${xml(`${item.description} Крос-номер: ${item.cross}. ${item.fitmentCheck || ""}`.trim())}</g:description>
      <g:link>${site}${productPath(item)}</g:link>
${item.image ? `      <g:image_link>${site}${xml(item.image)}</g:image_link>
` : ""}${item.marking ? `      <g:additional_image_link>${site}${xml(item.marking.src)}</g:additional_image_link>
` : ""}      <g:availability>${item.inStock ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${item.price.toFixed(2)} UAH</g:price>
      <g:condition>${item.isNew ? "new" : "used"}</g:condition>
${item.partBrand ? `      <g:brand>${xml(item.partBrand)}</g:brand>
` : ""}      <g:mpn>${xml(item.sku)}</g:mpn>
      <g:google_product_category>Vehicles &amp; Parts &gt; Vehicle Parts &amp; Accessories &gt; Motor Vehicle Parts</g:google_product_category>
      <g:product_type>${xml(`Запчастини > ${modelName(item)} > ${item.design}`)}</g:product_type>
    </item>`).join("\n")}
  </channel>
</rss>
`;

async function writePage(path, html) {
  const folder = new URL(`.${path}`, root);
  await mkdir(folder, { recursive: true });
  await writeFile(new URL("index.html", folder), html);
}

await Promise.all([
  writePage(catalog, list),
  writePage(termsPath, termsPage),
  writeFile(new URL("merchant-feed.xml", root), feed),
  ...stock.map((item) => writePage(productPath(item), productPage(item))),
]);
