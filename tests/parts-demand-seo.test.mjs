import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const pairs = [
  ["zapchastyny-byd/song-l/index.html", "ru/zapchasti-byd/song-l/index.html", "zapchastyny-byd/song-l/", "ru/zapchasti-byd/song-l/"],
  ["zapchastyny-byd/kuzovni-detali/index.html", "ru/zapchasti-byd/kuzovnye-detali/index.html", "zapchastyny-byd/kuzovni-detali/", "ru/zapchasti-byd/kuzovnye-detali/"],
  ["zapchastyny-byd/pidviska-kermove/index.html", "ru/zapchasti-byd/podveska-rulevoe/index.html", "zapchastyny-byd/pidviska-kermove/", "ru/zapchasti-byd/podveska-rulevoe/"],
  ["zapchastyny-byd/fary-sklo/index.html", "ru/zapchasti-byd/fary-steklo/index.html", "zapchastyny-byd/fary-sklo/", "ru/zapchasti-byd/fary-steklo/"],
];

function structuredData(html) {
  const source = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, "missing JSON-LD");
  return JSON.parse(source);
}

test("demand-backed BYD pages are substantial bilingual landing pages", async () => {
  for (const [ukFile, ruFile, ukSlug, ruSlug] of pairs) {
    const [uk, ru] = await Promise.all([read(ukFile), read(ruFile)]);

    for (const [html, lang, canonicalSlug] of [[uk, "uk-UA", ukSlug], [ru, "ru-UA", ruSlug]]) {
      assert.ok(html.length > 10000, canonicalSlug + ": page is unexpectedly thin");
      assert.match(html, new RegExp('<html lang="' + lang + '">'));
      assert.match(html, new RegExp('<link rel="canonical" href="https://evline\\.com\\.ua/' + canonicalSlug.replaceAll("/", "\\/") + '">'));
      assert.equal((html.match(/<h1>/g) || []).length, 1, canonicalSlug + ": expected one H1");
      assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large">/);
      assert.doesNotMatch(html, /noindex/i, canonicalSlug);
      assert.match(html, /data-telegram-parts-form/);
      assert.match(html, /https:\/\/t\.me\/evline_support/);
      assert.doesNotMatch(html, /evline_tech/);
      assert.match(html, /Оболон(?:ська|ская) набережн(?:а|ая), 1/);
      assert.match(html, /10:00–18:00/);

      const graph = structuredData(html)["@graph"];
      assert.ok(graph.some((item) => item["@type"] === "Service"));
      assert.ok(graph.some((item) => item["@type"] === "FAQPage"));
      assert.ok(graph.some((item) => item["@type"] === "BreadcrumbList"));
    }

    assert.match(uk, new RegExp('hreflang="ru-UA" href="https://evline\\.com\\.ua/' + ruSlug.replaceAll("/", "\\/") + '"'));
    assert.match(ru, new RegExp('hreflang="uk-UA" href="https://evline\\.com\\.ua/' + ukSlug.replaceAll("/", "\\/") + '"'));
  }
});

test("BYD hubs link to the new model and category pages", async () => {
  const [ukHub, ruHub] = await Promise.all([
    read("zapchastyny-byd/index.html"),
    read("ru/zapchasti-byd/index.html"),
  ]);

  for (const href of ["song-l/", "kuzovni-detali/", "pidviska-kermove/", "fary-sklo/"]) {
    assert.match(ukHub, new RegExp('href="' + href.replaceAll("/", "\\/") + '"'));
  }
  for (const href of ["song-l/", "kuzovnye-detali/", "podveska-rulevoe/", "fary-steklo/"]) {
    assert.match(ruHub, new RegExp('href="' + href.replaceAll("/", "\\/") + '"'));
  }
});

test("sitemap contains every new canonical and bilingual alternate", async () => {
  const sitemap = await read("sitemap.xml");
  for (const [, , ukSlug, ruSlug] of pairs) {
    for (const slug of [ukSlug, ruSlug]) {
      const url = "https://evline.com.ua/" + slug;
      assert.equal((sitemap.match(new RegExp("<loc>" + url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "<\\/loc>", "g")) || []).length, 1, url);
    }
    assert.match(sitemap, new RegExp('hreflang="uk-UA" href="https://evline\\.com\\.ua/' + ukSlug.replaceAll("/", "\\/") + '"'));
    assert.match(sitemap, new RegExp('hreflang="ru-UA" href="https://evline\\.com\\.ua/' + ruSlug.replaceAll("/", "\\/") + '"'));
  }
});

test("general hubs describe cars manufactured in China, including foreign brands", async () => {
  const [uk, ru] = await Promise.all([
    read("zapchastyny-kytajskyh-avto/index.html"),
    read("ru/zapchasti-kitajskih-avto/index.html"),
  ]);

  assert.match(uk, /автомобілів, вироблених у Китаї/i);
  assert.match(ru, /автомобилей, произведенных в Китае/i);
  for (const html of [uk, ru]) {
    assert.match(html, /Volkswagen ID/);
    assert.match(html, /Smart/);
    assert.match(html, /Volvo EX30/);
  }
});
