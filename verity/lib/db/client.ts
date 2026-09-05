import { attachDatabasePool } from "@vercel/functions";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export interface ReleasableQueryable extends Queryable {
  release?: () => void;
}

export interface TransactionCapable extends Queryable {
  connect?: () => Promise<ReleasableQueryable>;
}

let db: Pool | null = null;

export function getMigrationConnectionString(): string {
  const connectionString =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required");
  }
  return connectionString;
}

export function getDb(): Pool {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required");
    }
    db = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 5_000,
    });
    if (process.env.VERCEL) {
      attachDatabasePool(db);
    }
  }
  return db;
}

export function createAdminDb(): Pool {
  return new Pool({
    connectionString: getMigrationConnectionString(),
    max: 1,
    idleTimeoutMillis: 5_000,
  });
}

export async function withTransaction<T>(
  database: TransactionCapable,
  operation: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = database.connect
    ? await database.connect()
    : (database as ReleasableQueryable);
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the error raised by the transaction body.
    }
    throw error;
  } finally {
    client.release?.();
  }
}

export async function closeDb(): Promise<void> {
  if (!db) return;
  const pool = db;
  db = null;
  await pool.end();
}

export type { PoolClient };
