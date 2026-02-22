import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>;

function ensureVersionTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _schema_versions (
    package TEXT PRIMARY KEY, version INTEGER NOT NULL
  )`);
}

function getSchemaVersion(db: DatabaseSync, pkg: string): number {
  ensureVersionTable(db);
  const r = db.prepare("SELECT version FROM _schema_versions WHERE package = ?").get(pkg) as
    | { version: number }
    | undefined;
  return r ? r.version : 0;
}

function setSchemaVersion(db: DatabaseSync, pkg: string, version: number): void {
  db.prepare("INSERT OR REPLACE INTO _schema_versions (package, version) VALUES (?, ?)").run(
    pkg,
    version,
  );
}

function readMigration(filename: string): string {
  const thisFile = fileURLToPath(import.meta.url);
  return readFileSync(join(thisFile, "..", "migrations", filename), "utf-8");
}

export function ensureStorageSchema(db: DatabaseSync): void {
  const current = getSchemaVersion(db, "storage");
  if (current < 1) {
    // Clean up legacy tables from original monolithic schema
    db.exec("DROP TABLE IF EXISTS entity_relationships");
    db.exec("DROP TABLE IF EXISTS knowledge");

    const sql = readMigration("001_initial.sql");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      setSchemaVersion(db, "storage", 1);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (current < 2) {
    // Migration 002 recreates the sessions table (DROP + RENAME).
    // PRAGMA foreign_keys must be OFF to prevent cascade-deletes on DROP.
    // PRAGMA foreign_keys is a no-op inside transactions, so we disable
    // it before BEGIN and re-enable after COMMIT.
    db.exec("PRAGMA foreign_keys = OFF");
    const sql = readMigration("002_delegation_types.sql");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      setSchemaVersion(db, "storage", 2);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    // Verify no FK violations were introduced
    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(
        `Migration 002 introduced FK violations: ${JSON.stringify(violations.slice(0, 5))}`,
      );
    }
  }
}
