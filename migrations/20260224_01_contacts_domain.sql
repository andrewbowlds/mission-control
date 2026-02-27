-- Mission Control Contacts Phase 2 schema
-- Applied programmatically in src/contacts-db.ts

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
