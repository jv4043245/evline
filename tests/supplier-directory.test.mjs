import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteSupplierDirectoryEntry,
  listSupplierDirectory,
  registerSupplier,
} from "../functions/_lib/supplier-portal.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql.startsWith("SELECT 1 FROM suppliers")) return null;
    if (this.sql.includes("FROM suppliers WHERE display_name = ?")) {
      const name = String(this.args[0] || "").toLocaleLowerCase();
      return Array.from(this.db.suppliers.values()).find((row) => row.display_name.toLocaleLowerCase() === name) || null;
    }
    if (this.sql.includes("FROM suppliers WHERE id = ?")) return this.db.suppliers.get(this.args[0]) || null;
    if (this.sql.startsWith("SELECT COUNT(*) AS count FROM supplier_requests")) {
      return { count: this.db.requestCounts.get(this.args[0]) || 0 };
    }
    throw new Error(`Unsupported first query: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith("SELECT id, display_name, created_at, updated_at FROM suppliers ORDER BY")) {
      return { results: Array.from(this.db.suppliers.values()) };
    }
    throw new Error(`Unsupported all query: ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO suppliers")) {
      const [id, displayName, dashboardAccessToken, createdAt, updatedAt] = this.args;
      const current = this.db.suppliers.get(id);
      this.db.suppliers.set(id, {
        id,
        display_name: displayName,
        dashboard_access_token: current?.dashboard_access_token || dashboardAccessToken,
        created_at: current?.created_at || createdAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM suppliers WHERE id = ?")) {
      this.db.suppliers.delete(this.args[0]);
      return { success: true };
    }
    throw new Error(`Unsupported run query: ${this.sql}`);
  }
}

class FakeD1 {
  constructor() {
    this.suppliers = new Map();
    this.requestCounts = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

test("supplier directory includes defaults and persists a custom supplier", async () => {
  const DB = new FakeD1();
  const env = { DB };

  const defaults = await listSupplierDirectory(env);
  assert.deepEqual(defaults.filter((row) => row.is_default).map((row) => row.display_name), ["Buble", "BYD", "Toyota", "Zeekr"]);

  const created = await registerSupplier(env, "  Test China Parts  ");
  const repeated = await registerSupplier(env, "test china parts");
  assert.equal(created.id, repeated.id);
  assert.equal(created.display_name, "Test China Parts");

  const suppliers = await listSupplierDirectory(env);
  assert.equal(suppliers.filter((row) => row.display_name === "Test China Parts").length, 1);
});

test("custom supplier can be deleted only when it is unused", async () => {
  const DB = new FakeD1();
  const env = { DB };
  const supplier = await registerSupplier(env, "Temporary QA Supplier");

  DB.requestCounts.set(supplier.id, 1);
  await assert.rejects(
    deleteSupplierDirectoryEntry(env, supplier.id),
    (error) => error.status === 409 && /existing requests/i.test(error.message)
  );

  DB.requestCounts.set(supplier.id, 0);
  const deleted = await deleteSupplierDirectoryEntry(env, supplier.id);
  assert.equal(deleted.display_name, "Temporary QA Supplier");
  assert.equal((await listSupplierDirectory(env)).some((row) => row.id === supplier.id), false);
});

test("default suppliers cannot be deleted", async () => {
  const env = { DB: new FakeD1() };
  await assert.rejects(
    deleteSupplierDirectoryEntry(env, "supplier_toyota"),
    (error) => error.status === 400 && /cannot be deleted/i.test(error.message)
  );
});
