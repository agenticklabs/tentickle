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

export function ensureMemorySchema(db: DatabaseSync): void {
  const current = getSchemaVersion(db, "memory");
  if (current < 1) {
    const sql = readMigration("001_memory.sql");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      setSchemaVersion(db, "memory", 1);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
