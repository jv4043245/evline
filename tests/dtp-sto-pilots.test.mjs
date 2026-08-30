import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const readPage = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const dtpPages = [
  {
    file: "zapchastyny-pislya-dtp/index.html",
    canonical: "https://evline.com.ua/zapchastyny-pislya-dtp/",
    alternate: "https://evline.com.ua/ru/zapchasti-posle-dtp/",
    h1: "Запчастини після ДТП для китайського авто",
    formName: "ДТП комплект UA",
  },
  {
    file: "ru/zapchasti-posle-dtp/index.html",
    canonical: "https://evline.com.ua/ru/zapchasti-posle-dtp/",
    alternate: "https://evline.com.ua/zapchastyny-pislya-dtp/",
    h1: "Запчасти после ДТП для китайского авто",
    formName: "ДТП комплект RU",
  },
];

test("DTP pilot pages are isolated, bilingual and collect a complete parts request", async () => {
  for (const page of dtpPages) {
    const html = await readPage(page.file);

    assert.match(html, /<meta name="robots" content="noindex, follow">/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${page.canonical}">`));
    assert.match(html, new RegExp(`href="${page.alternate}"`));
    assert.match(html, new RegExp(`<h1>${page.h1}<\/h1>`));
    assert.equal((html.match(/<h1(?:\s[^>]*)?>/gi) || []).length, 1);
    assert.match(html, new RegExp(`data-telegram-parts-form data-form-name="${page.formName}"`));
    assert.match(html, /name="car"[^>]*required/);
    assert.match(html, /name="vin"/);
    assert.match(html, /<textarea name="part"[^>]*required>/);
    assert.match(html, /name="phone"[^>]*required/);
    assert.doesNotMatch(html, /type="file"/);
    assert.match(html, /Telegram[^<]*3–5|3–5[^<]*Telegram/);

    const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(jsonLd, `${page.file}: expected JSON-LD`);
    const schema = JSON.parse(jsonLd);
    assert.match(JSON.stringify(schema), /AutoPartsStore/);
    assert.doesNotMatch(JSON.stringify(schema), /AutoRepair/);
  }
});

test("STO pilot forms preserve the short conversion path and add optional qualification", async () => {
  const pages = [
    "spivpratsya-sto/index.html",
    "ru/sotrudnichestvo-sto/index.html",
  ];

  for (const relativePath of pages) {
    const html = await readPage(relativePath);
    const forms = Array.from(
      html.matchAll(/<form class="brand-seo-form" data-lead-form[\s\S]*?<\/form>/g),
      (match) => match[0],
    );
    assert.equal(forms.length, 2, `${relativePath}: expected two partner forms`);

    assert.match(
      html,
      /\.sto-form-card \.brand-seo-form \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
      `${relativePath}: expected a two-column desktop form grid`,
    );
    assert.match(
      html,
      /\.sto-form-card \.brand-seo-form textarea,[\s\S]*?\.sto-form-card \.brand-seo-form button \{[\s\S]*?grid-column: 1 \/ -1;/,
      `${relativePath}: expected long controls to span the form grid`,
    );
    assert.match(
      html,
      /\.sto-contact-dialog \.brand-seo-form input,[\s\S]*?\.sto-contact-dialog \.brand-seo-form textarea \{/,
      `${relativePath}: expected the modal textarea to use dark-theme controls`,
    );

    for (const form of forms) {
      assert.match(form, /name="name"[^>]*required/);
      assert.match(form, /name="phone"[^>]*required/);
      assert.match(form, /name="car"/);
      assert.match(form, /<textarea name="message"/);
      assert.doesNotMatch(form, /name="car"[^>]*required/);
      assert.doesNotMatch(form, /<textarea name="message"[^>]*required/);
    }
  }
});
