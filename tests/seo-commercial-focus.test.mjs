import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const readPage = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const commercialBrandPages = [
  "zapchastyny-byd/index.html",
  "zapchastyny-zeekr/index.html",
  "zapchastyny-xiaomi/index.html",
  "zapchastyny-lynk-co/index.html",
  "zapchastyny-leapmotor/index.html",
  "ru/zapchasti-byd/index.html",
  "ru/zapchasti-zeekr/index.html",
  "ru/zapchasti-xiaomi/index.html",
  "ru/zapchasti-lynk-co/index.html",
  "ru/zapchasti-leapmotor/index.html",
];

test("organic home pages target the generic Chinese-parts intent", async () => {
  const [uk, ru] = await Promise.all([readPage("index.html"), readPage("ru/index.html")]);

  assert.match(uk, /<title>Запчастини для китайських авто з Китаю \| EVLine Україна<\/title>/);
  assert.match(ru, /<title>Запчасти для китайских авто из Китая \| EVLine Украина<\/title>/);
  assert.match(uk, /підбір по VIN, перевірка в Китаї, доставка в Україну/i);
  assert.match(ru, /подбор по VIN, проверка в Китае, доставка в Украину/i);
});

test("brand hubs expose priority model pages and real sourcing proof", async () => {
  const pages = [
    ["zapchastyny-kytajskyh-avto/index.html", "Запчастини для китайських авто з Китаю"],
    ["ru/zapchasti-kitajskih-avto/index.html", "Запчасти для китайских авто из Китая"],
  ];

  for (const [relativePath, heading] of pages) {
    const html = await readPage(relativePath);
    assert.match(html, new RegExp(`<h1>${heading}<\\/h1>`));
    assert.match(html, /пяти логистических партнеров|п'яти логістичних партнерів/i);
    assert.match(html, /проверяем ее до отправки|перевіряємо її до відправки/i);

    const priorityModelLinks = html.match(/href="\.\.\/zapchast(?:i|yny)-(?:byd|zeekr|xiaomi|avatr)\/[^"]+\/"/g) || [];
    assert.ok(priorityModelLinks.length >= 8, `${relativePath}: expected at least 8 priority model links`);
  }
});

test("Zeekr 001 pages use exact commercial titles and headings", async () => {
  const [uk, ru] = await Promise.all([
    readPage("zapchastyny-zeekr/001/index.html"),
    readPage("ru/zapchasti-zeekr/001/index.html"),
  ]);

  assert.match(uk, /<title>Запчастини на Zeekr 001 з Китаю/);
  assert.match(uk, /<h1>Запчастини на Zeekr 001 з Китаю<\/h1>/);
  assert.match(ru, /<title>Запчасти на Zeekr 001 из Китая/);
  assert.match(ru, /<h1>Запчасти на Zeekr 001 из Китая<\/h1>/);
});

test("organic brand pages do not promote the abandoned low-margin service branch", async () => {
  const lowMarginIntent = /ТО и расходники|расходные материалы|фильтры, колодки|ТО та витратники|витратні матеріали|фільтри, колодки/i;

  for (const relativePath of commercialBrandPages) {
    const html = await readPage(relativePath);
    assert.doesNotMatch(html, lowMarginIntent, relativePath);
  }
});

test("Russian generator cannot overwrite the authoritative sitemap by default", async () => {
  const source = await readPage("scripts/build-ru-version.mjs");

  assert.doesNotMatch(source, /writeFile\(path\.join\(root, "sitemap\.xml"\)/);
  assert.match(source, /process\.argv\.includes\("--standalone"\)/);
  assert.match(source, /электронные блоки и зарядные модули/);
});

