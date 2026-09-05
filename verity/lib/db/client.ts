import Database from "better-sqlite3";
import path from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const configuredPath = process.env.VERITY_DB_PATH;
    if (
      process.env.NODE_ENV === "production" &&
      (!configuredPath ||
        process.env.VERITY_DB_ENCRYPTION_AT_REST_ACKNOWLEDGED !== "true")
    ) {
      throw new Error(
        "Production database path and encryption-at-rest acknowledgement are required",
      );
    }
    const dbPath = configuredPath
      ? path.resolve(configuredPath)
      : path.join(process.cwd(), "verity.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("secure_delete = ON");
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
