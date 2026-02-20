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

export interface OpenDatabaseOptions {
  allowExtension?: boolean;
}

export async function openDatabase(
  dbPath: string,
  options?: OpenDatabaseOptions,
): Promise<InstanceType<typeof import("node:sqlite").DatabaseSync>> {
  const sqlite = await loadSqlite();
  const db = new sqlite.DatabaseSync(dbPath, {
    allowExtension: options?.allowExtension ?? false,
  });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  return db;
}
