import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type SyncRun = {
  id: string;
  provider: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "success" | "failed";
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errorSummary?: string;
};

function getStoreDir(): string {
  const dir = path.join(os.homedir(), ".openclaw", "workspace", "mission-control");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbPath(): string {
  return path.join(getStoreDir(), "contacts.sqlite");
}

let db: DatabaseSync | null = null;

function ensureDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(getDbPath());
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  runMigrations(db);
  return db;
}

function runMigrations(conn: DatabaseSync): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const migrations: Array<{ id: string; sql: string }> = [
    {
      id: "20260224_01_contacts_domain",
      sql: `
        CREATE TABLE IF NOT EXISTS contacts (
          id TEXT PRIMARY KEY,
          display_name TEXT,
          given_name TEXT,
          family_name TEXT,
          crm_notes TEXT,
          google_notes_raw TEXT,
          status TEXT,
          tags_json TEXT,
          last_contacted_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_synced_at INTEGER,
          source_primary TEXT NOT NULL DEFAULT 'manual'
        );

        CREATE TABLE IF NOT EXISTS contact_external_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT NOT NULL,
          etag TEXT,
          deleted_flag INTEGER NOT NULL DEFAULT 0,
          raw_payload_json TEXT,
          last_seen_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(provider, external_id),
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_emails (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT,
          primary_flag INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_phones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT,
          primary_flag INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_addresses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          type TEXT,
          formatted_value TEXT,
          street TEXT,
          city TEXT,
          region TEXT,
          postal_code TEXT,
          country TEXT,
          primary_flag INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          name TEXT,
          title TEXT,
          department TEXT,
          start_date TEXT,
          end_date TEXT,
          primary_flag INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_urls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          type TEXT,
          date_json TEXT,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_relations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          type TEXT,
          person TEXT,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_memberships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          name TEXT,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_user_defined (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          key TEXT,
          value TEXT,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_photos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          url TEXT,
          default_flag INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS contact_im_clients (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id TEXT NOT NULL,
          username TEXT,
          protocol TEXT,
          type TEXT,
          formatted_type TEXT,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          status TEXT NOT NULL,
          imported_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          error_summary TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_contacts_updated_at ON contacts(updated_at);
        CREATE INDEX IF NOT EXISTS idx_contacts_source_primary ON contacts(source_primary);
        CREATE INDEX IF NOT EXISTS idx_links_contact_provider ON contact_external_links(contact_id, provider);
      `,
    },
    {
      id: "20260228_01_contact_activities",
      sql: `
        CREATE TABLE IF NOT EXISTS contact_activities (
          id TEXT PRIMARY KEY,
          contact_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          direction TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          status TEXT,
          summary TEXT,
          task_id TEXT,
          session_id TEXT,
          message_id TEXT,
          provider_id TEXT,
          provider_name TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(contact_id) REFERENCES contacts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_contact_activities_contact_time ON contact_activities(contact_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_contact_activities_channel ON contact_activities(channel);
        CREATE INDEX IF NOT EXISTS idx_contact_activities_direction ON contact_activities(direction);
      `,
    },
  ];

  const hasMigration = conn.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const insertMigration = conn.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  for (const migration of migrations) {
    const found = hasMigration.get(migration.id) as { 1: number } | undefined;
    if (found) continue;
    conn.exec("BEGIN");
    try {
      conn.exec(migration.sql);
      insertMigration.run(migration.id, Date.now());
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  }
}

export function getContactsDb(): DatabaseSync {
  return ensureDb();
}

export function beginSyncRun(provider: string): string {
  const id = randomUUID();
  const now = Date.now();
  const conn = ensureDb();
  conn.prepare(
    `INSERT INTO sync_runs (id, provider, started_at, status, imported_count, updated_count, skipped_count, error_count)
     VALUES (?, ?, ?, 'running', 0, 0, 0, 0)`,
  ).run(id, provider, now);
  return id;
}

export function finishSyncRun(id: string, patch: Omit<SyncRun, "id" | "provider" | "startedAt">): void {
  const conn = ensureDb();
  conn.prepare(
    `UPDATE sync_runs
     SET ended_at = ?, status = ?, imported_count = ?, updated_count = ?, skipped_count = ?, error_count = ?, error_summary = ?
     WHERE id = ?`,
  ).run(
    Date.now(),
    patch.status,
    patch.importedCount,
    patch.updatedCount,
    patch.skippedCount,
    patch.errorCount,
    patch.errorSummary ?? null,
    id,
  );
}

export function getLatestSyncRun(provider: string): SyncRun | null {
  const conn = ensureDb();
  const row = conn.prepare(
    `SELECT id, provider, started_at, ended_at, status, imported_count, updated_count, skipped_count, error_count, error_summary
     FROM sync_runs
     WHERE provider = ?
     ORDER BY started_at DESC
     LIMIT 1`,
  ).get(provider) as any;
  if (!row) return null;
  return {
    id: String(row.id),
    provider: String(row.provider),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? undefined : Number(row.ended_at),
    status: row.status,
    importedCount: Number(row.imported_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
    errorSummary: row.error_summary == null ? undefined : String(row.error_summary),
  };
}
