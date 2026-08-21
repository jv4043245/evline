import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const expectedDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const expectedStreets = new Set([
  "Оболонська набережна, 1",
  "Оболонская набережная, 1",
]);

async function listHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listHtml(absolutePath)));
    if (entry.isFile() && entry.name.endsWith(".html")) files.push(absolutePath);
  }

  return files;
}

function businessNodes(document) {
  const nodes = document["@graph"] || [document];
  return nodes.filter((node) => {
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return types.includes("AutoPartsStore") || types.includes("AutoRepair");
  });
}

test("public business schema uses the confirmed address and weekday hours", async () => {
  const files = await listHtml(root);
  let businesses = 0;

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const blocks = Array.from(
      html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
      (match) => JSON.parse(match[1]),
    );

    for (const block of blocks) {
      for (const business of businessNodes(block)) {
        businesses += 1;
        assert.ok(expectedStreets.has(business.address?.streetAddress), file);
        assert.deepEqual(business.openingHoursSpecification, [
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: expectedDays,
            opens: "10:00",
            closes: "18:00",
          },
        ], file);
      }
    }
  }

  assert.ok(businesses > 100, `Expected business schema on more than 100 pages, found ${businesses}`);
});
