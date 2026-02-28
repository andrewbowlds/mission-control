-- Communication activity timeline for People detail
-- Applied programmatically in src/contacts-db.ts

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
