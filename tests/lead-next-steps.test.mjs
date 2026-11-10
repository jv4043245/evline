import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/js/lead-next-steps.js", import.meta.url), "utf8");

function load() {
  const window = {};
  vm.runInNewContext(source, { window, document: { documentElement: { lang: "uk" } }, Intl });
  return window.EVLineLeadNextSteps;
}

// Kyiv is UTC+2 in November.
const at = (iso) => new Date(iso);

test("working hours promise a reply within 30 minutes", () => {
  const steps = load();
  assert.match(steps.text("uk", at("2026-11-10T10:00:00Z")), /протягом 30 хвилин/);
  assert.match(steps.text("ru", at("2026-11-10T10:00:00Z")), /в течение 30 минут/);
});

test("evenings promise the next working day without a fixed 30-minute claim", () => {
  const steps = load();
  const text = steps.text("uk", at("2026-11-10T18:30:00Z")); // Tue 20:30 Kyiv
  assert.match(text, /неробочий час/);
  assert.match(text, /завтра після 10:00/);
  assert.doesNotMatch(text, /30 хвилин/);
});

test("Friday evening and Saturday point to Monday, Sunday to tomorrow", () => {
  const steps = load();
  assert.match(steps.text("uk", at("2026-11-13T17:00:00Z")), /у понеділок/); // Fri 19:00
  assert.match(steps.text("ru", at("2026-11-14T09:00:00Z")), /в понедельник/); // Sat 11:00
  assert.match(steps.text("uk", at("2026-11-15T09:00:00Z")), /завтра після 10:00/); // Sun 11:00
});

test("early morning on a working day points to today", () => {
  const steps = load();
  assert.match(steps.text("uk", at("2026-11-11T05:00:00Z")), /сьогодні після 10:00/); // Wed 07:00
});

test("pages and main.js load the next-steps script with the current version", async () => {
  const main = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
  assert.match(main, /lead-next-steps\.js\?v=/);
  assert.match(main, /showLeadSaved\(form, payload\.type\)/);
  for (const page of ["index.html", "ru/index.html", "byd.html", "запчастини-з-китаю/index.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /lead-next-steps\.js\?v=/, page);
    assert.match(html, /EVLineLeadNextSteps\.render/, page);
  }
});
