import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { Repository } from "../../lib/db/repository";
import {
  requireClientAccess,
  requireSignalAccess,
  ResourceNotFoundError,
} from "../../lib/security/access";

function testRepository() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      rm_id TEXT
    );
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY,
      client_id TEXT,
      payload TEXT
    );
  `);
  db.prepare("INSERT INTO clients VALUES (?, ?, ?)").run(
    "CL-0001",
    "Client One",
    "RM-ONE",
  );
  db.prepare("INSERT INTO signals VALUES (?, ?, ?)").run(
    "SIG-ONE",
    "CL-0001",
    "{}",
  );
  return { db, repository: new Repository(db) };
}

test("RM-scoped client and signal checks hide out-of-book resources", () => {
  const { db, repository } = testRepository();
  assert.doesNotThrow(() =>
    requireClientAccess(repository, "RM-ONE", "CL-0001"),
  );
  assert.doesNotThrow(() =>
    requireSignalAccess(repository, "RM-ONE", "SIG-ONE"),
  );
  assert.throws(
    () => requireClientAccess(repository, "RM-TWO", "CL-0001"),
    ResourceNotFoundError,
  );
  assert.throws(
    () => requireSignalAccess(repository, "RM-TWO", "SIG-ONE"),
    ResourceNotFoundError,
  );
  db.close();
});
