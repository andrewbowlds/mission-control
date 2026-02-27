import { randomUUID } from "node:crypto";
import { getMcDb } from "../mc-db.js";
import type { Integration, IntegrationType, IntegrationStatus } from "../types.js";

// ── Row Mapping ──────────────────────────────────────────────────────────────

function rowToIntegration(row: any): Integration {
  return {
    id: row.id,
    type: row.type as IntegrationType,
    label: row.label,
    configJson: row.config_json ?? "{}",
    status: row.status as IntegrationStatus,
    errorMessage: row.error_message ?? undefined,
    lastSyncAt: row.last_sync_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listIntegrations(): Integration[] {
  const db = getMcDb();
  const rows = db.prepare("SELECT * FROM integrations ORDER BY created_at ASC").all() as any[];
  return rows.map(rowToIntegration);
}

export function getIntegration(id: string): Integration | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM integrations WHERE id = ?").get(id) as any;
  return row ? rowToIntegration(row) : undefined;
}

export function getIntegrationByType(type: IntegrationType): Integration | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM integrations WHERE type = ? LIMIT 1").get(type) as any;
  return row ? rowToIntegration(row) : undefined;
}

export function createIntegration(data: {
  type: IntegrationType;
  label: string;
  configJson?: string;
}): Integration {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO integrations (id, type, label, config_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'disconnected', ?, ?)
  `).run(id, data.type, data.label, data.configJson ?? "{}", now, now);
  return getIntegration(id)!;
}

export function updateIntegration(
  id: string,
  patch: {
    label?: string;
    configJson?: string;
    status?: IntegrationStatus;
    errorMessage?: string | null;
    lastSyncAt?: number;
  },
): Integration | undefined {
  const db = getMcDb();
  const existing = getIntegration(id);
  if (!existing) return undefined;

  const label = patch.label ?? existing.label;
  const configJson = patch.configJson ?? existing.configJson;
  const status = patch.status ?? existing.status;
  const errorMessage = patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage;
  const lastSyncAt = patch.lastSyncAt ?? existing.lastSyncAt;

  db.prepare(`
    UPDATE integrations SET label = ?, config_json = ?, status = ?, error_message = ?,
      last_sync_at = ?, updated_at = ?
    WHERE id = ?
  `).run(label, configJson, status, errorMessage ?? null, lastSyncAt ?? null, Date.now(), id);
  return getIntegration(id);
}

export function deleteIntegration(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM integrations WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Status Helpers ───────────────────────────────────────────────────────────

export function markConnected(id: string): void {
  const db = getMcDb();
  db.prepare("UPDATE integrations SET status = 'connected', error_message = NULL, updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function markError(id: string, msg: string): void {
  const db = getMcDb();
  db.prepare("UPDATE integrations SET status = 'error', error_message = ?, updated_at = ? WHERE id = ?")
    .run(msg, Date.now(), id);
}

export function markSynced(id: string): void {
  const db = getMcDb();
  db.prepare("UPDATE integrations SET last_sync_at = ?, updated_at = ? WHERE id = ?")
    .run(Date.now(), Date.now(), id);
}
