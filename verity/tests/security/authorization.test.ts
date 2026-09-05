import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { Repository } from "../../lib/db/repository";
import {
  requireClientAccess,
  requireSignalAccess,
  ResourceNotFoundError,
} from "../../lib/security/access";

async function testRepository() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const db = new Pool();
  await db.query(`
    CREATE TABLE clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      rm_id TEXT,
      client_since TEXT
    );
    CREATE TABLE signals (
      signal_id TEXT PRIMARY KEY,
      client_id TEXT,
      payload TEXT
    );
  `);
  await db.query("INSERT INTO clients VALUES ($1, $2, $3, $4)", [
    "CL-0001",
    "Client One",
    "RM-ONE",
    "2020-01-01",
  ]);
  await db.query("INSERT INTO signals VALUES ($1, $2, $3)", [
    "SIG-ONE",
    "CL-0001",
    "{}",
  ]);
  return {
    db,
    repository: new Repository(db, { useAdvisoryLock: false }),
  };
}

test("RM-scoped client and signal checks hide out-of-book resources", async () => {
  const { db, repository } = await testRepository();
  await assert.doesNotReject(async () =>
    await requireClientAccess(repository, "RM-ONE", "CL-0001"),
  );
  await assert.doesNotReject(async () =>
    await requireSignalAccess(repository, "RM-ONE", "SIG-ONE"),
  );
  await assert.rejects(
    async () => await requireClientAccess(repository, "RM-TWO", "CL-0001"),
    ResourceNotFoundError,
  );
  await assert.rejects(
    async () => await requireSignalAccess(repository, "RM-TWO", "SIG-ONE"),
    ResourceNotFoundError,
  );
  await db.end();
});
