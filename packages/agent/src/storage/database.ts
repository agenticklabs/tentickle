import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let sqliteModule: typeof import("node:sqlite") | null = null;

async function loadSqlite() {
  if (sqliteModule) return sqliteModule;
  try {
    sqliteModule = await import("node:sqlite");
    return sqliteModule;
  } catch (error) {
    throw new Error(
      `Tentickle storage requires Node.js v22.5.0+ with native SQLite support. ` +
        `Current: ${process.version}.`,
      { cause: error },
    );
  }
}

function getMigrationsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // Works in both src/ (dev) and dist/ (built)
  return join(thisFile, "..", "migrations");
}

function discoverMigrations(dir: string): { version: number; sql: string }[] {
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();

  return files.map((f) => ({
    version: parseInt(f.slice(0, 3), 10),
    sql: readFileSync(join(dir, f), "utf-8"),
  }));
}

export function runMigrations(db: InstanceType<typeof import("node:sqlite").DatabaseSync>): void {
  const currentVersion = (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
  const migrations = discoverMigrations(getMigrationsDir());

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    // Each migration is a transaction. If it fails, version stays.
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export async function openDatabase(
  dbPath: string,
): Promise<InstanceType<typeof import("node:sqlite").DatabaseSync>> {
  const sqlite = await loadSqlite();
  const db = new sqlite.DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  return db;
}
