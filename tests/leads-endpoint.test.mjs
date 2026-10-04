import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequestGet, onRequestHead } from "../functions/api/leads.js";

test("GET /api/leads is a harmless noindex endpoint description", async () => {
  const response = onRequestGet();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, endpoint: "/api/leads", accepts: ["POST"] });
});

test("HEAD /api/leads exposes the same indexability policy without a body", async () => {
  const response = onRequestHead();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(await response.text(), "");
});
