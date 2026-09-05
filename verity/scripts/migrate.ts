import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { getMigrationConnectionString } from "../lib/db/client";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const migrationPath = path.join(
    process.cwd(),
    "migrations",
    "001_initial.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");
  const client = new Client({
    connectionString: getMigrationConnectionString(),
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log("Applied migrations/001_initial.sql");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Migration failed", error);
  process.exitCode = 1;
});
