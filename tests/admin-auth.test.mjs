import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { adminUser, isAdminRequest } from "../functions/_lib/auth.js";
import { auditActor, listAuditEvents } from "../functions/_lib/audit-log.js";
import { onRequest } from "../functions/api/admin/_middleware.js";
import { onRequestGet, onRequestPost } from "../functions/api/admin/session.js";

const accounts = [
  { id: "andrii", name: "Андрій", token: "test-existing-token" },
  { id: "igor", name: "Ігор", token: "test-igor-token" },
  { id: "owner", name: "Власник", token: "test-owner-token" },
];
const env = { ADMIN_TOKEN: accounts[0].token, ADMIN_USERS_JSON: JSON.stringify(accounts.slice(1)) };
const requestFor = (token, headers = {}) => new Request("https://evline.example/api/admin/session", {
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
});

test("legacy and personal tokens identify three users with equal admin rights", async () => {
  for (const { id, name, token } of accounts) {
    const request = requestFor(token);
    assert.equal(isAdminRequest(request, env), true);
    assert.deepEqual(adminUser(request, env), { id, name, role: "admin" });
    const response = await onRequest({ request, env, next: async () => new Response("allowed", { status: 201 }) });
    assert.equal(response.status, 201);
    assert.equal(await response.text(), "allowed");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(decodeURIComponent(response.headers.get("x-evline-admin-name")), name);
    assert.deepEqual(await onRequestGet({ request, env }).json(), { ok: true, user: { id, name, role: "admin" } });
  }
});

test("missing, unknown, and conflicting credentials never reach an admin handler", async () => {
  for (const request of [
    requestFor(""),
    requestFor("unknown"),
    requestFor(accounts[0].token, { "x-admin-token": accounts[1].token }),
    requestFor("", { "x-admin-actor": "owner", "cf-access-authenticated-user-email": "owner@example.com" }),
    new Request(`https://evline.example/api/admin/session?token=${accounts[0].token}`),
  ]) {
    const response = await onRequest({ request, env, next: () => assert.fail("unauthenticated handler") });
    assert.equal(response.status, 401);
    assert.equal(adminUser(request, env), null);
  }
  assert.equal(isAdminRequest(requestFor("anything"), {}), false);
});

test("header-token clients work and audit identity cannot be changed using actor headers", () => {
  for (const { token, name } of accounts) {
    const request = requestFor("", {
      "x-admin-token": token,
      "x-admin-actor": "forged-owner",
      "cf-access-authenticated-user-email": "forged@example.com",
      "x-forwarded-email": "forged@example.com",
    });
    assert.equal(isAdminRequest(request, env), true);
    assert.equal(auditActor(request, env), name);
  }
});

test("malformed extra users keep the existing token usable; ambiguous users fail closed", () => {
  for (const config of ["invalid", "null", "{}", '[null,{}, {"id":"empty","name":"Empty","token":""}]']) {
    assert.equal(adminUser(requestFor(accounts[0].token), { ...env, ADMIN_USERS_JSON: config }).name, "Андрій");
    assert.equal(adminUser(requestFor(accounts[1].token), { ...env, ADMIN_USERS_JSON: config }), null);
  }
  const duplicateToken = JSON.stringify([{ id: "other", name: "Other", token: accounts[0].token }]);
  assert.equal(adminUser(requestFor(accounts[0].token), { ...env, ADMIN_USERS_JSON: duplicateToken }), null);
  const duplicateId = JSON.stringify([accounts[1], { ...accounts[2], id: accounts[1].id }]);
  assert.equal(adminUser(requestFor(accounts[1].token), { ...env, ADMIN_USERS_JSON: duplicateId }), null);
});

test("removing or rotating a personal token revokes it without changing the other users", () => {
  const rotated = { ...env, ADMIN_USERS_JSON: JSON.stringify([{ ...accounts[1], token: "new-igor-token" }, accounts[2]]) };
  assert.equal(isAdminRequest(requestFor(accounts[1].token), rotated), false);
  assert.equal(adminUser(requestFor("new-igor-token"), rotated).name, "Ігор");
  assert.equal(isAdminRequest(requestFor(accounts[0].token), rotated), true);
  assert.equal(isAdminRequest(requestFor(accounts[2].token), rotated), true);
});

test("real audit storage records each sign-in under its token owner without storing credentials", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const testEnv = {
    ...env,
    DB: {
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        let values = [];
        return {
          bind(...args) { values = args; return this; },
          async run() { return statement.run(...values); },
          async all() { return { results: statement.all(...values) }; },
        };
      },
    },
  };
  try {
    for (const account of accounts) {
      const request = requestFor(account.token, { "x-admin-actor": "forged" });
      const response = await onRequest({ request, env: testEnv, next: () => onRequestPost({ request, env: testEnv }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).user.name, account.name);
    }
    const events = await listAuditEvents(testEnv);
    assert.equal(events.length, 3);
    assert.deepEqual(events.map((event) => event.actor).sort(), accounts.map((account) => account.name).sort());
    for (const account of accounts) {
      assert.equal(JSON.stringify(events).includes(account.token), false);
      const filtered = await listAuditEvents(testEnv, { q: account.name });
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].entity_id, account.id);
      assert.equal(filtered[0].action, "admin.sign_in");
    }
    assert.equal((await onRequestPost({ request: requestFor("unknown"), env: testEnv })).status, 401);
    assert.equal((await listAuditEvents(testEnv)).length, 3);
  } finally {
    sqlite.close();
  }
});
