import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const contactTracking = await readFile(path.join(root, "assets/js/contact-tracking.js"), "utf8");

async function htmlFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await htmlFiles(absolutePath)));
    else if (entry.name.endsWith(".html")) result.push(absolutePath);
  }
  return result;
}

test("minimum-order banners and notices are absent from the public site", async () => {
  assert.doesNotMatch(contactTracking, /Мінімальна сума замовлення|Минимальная сумма заказа|\$100/);
  assert.doesNotMatch(contactTracking, /data-minimum-order-form-note/);
  assert.doesNotMatch(contactTracking, /data-minimum-order-notice/);
  assert.doesNotMatch(contactTracking, /evline-min-order/);

  const publicMinimumOrderPattern = /(?:Мінімальна сума замовлення|Минимальная сумма заказа)[^<\n]{0,80}\$100/i;
  const files = await htmlFiles(root);
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (publicMinimumOrderPattern.test(source)) offenders.push(path.relative(root, file));
  }
  assert.deepEqual(offenders, []);
});
