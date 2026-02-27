import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import type { ApprovalRequest } from "./types.js";

// ── Row Mapping ─────────────────────────────────────────────────────────────

function mapRow(row: any): ApprovalRequest {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    requestType: String(row.request_type) as ApprovalRequest["requestType"],
    title: String(row.title),
    description: row.description == null ? undefined : String(row.description),
    contextJson: row.context_json == null ? undefined : String(row.context_json),
    status: String(row.status) as ApprovalRequest["status"],
    requestedBy: row.requested_by == null ? undefined : String(row.requested_by),
    decidedBy: row.decided_by == null ? undefined : String(row.decided_by),
    decidedAt: row.decided_at == null ? undefined : Number(row.decided_at),
    decisionNote: row.decision_note == null ? undefined : String(row.decision_note),
    expiresAt: row.expires_at == null ? undefined : Number(row.expires_at),
    createdAt: Number(row.created_at),
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function createApprovalRequest(data: {
  taskId: string;
  requestType: ApprovalRequest["requestType"];
  title: string;
  description?: string;
  contextJson?: string;
  requestedBy?: string;
  expiresAt?: number;
}): ApprovalRequest {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO approval_requests (id, task_id, request_type, title, description, context_json, status, requested_by, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    id,
    data.taskId,
    data.requestType,
    data.title,
    data.description ?? null,
    data.contextJson ?? null,
    data.requestedBy ?? null,
    data.expiresAt ?? null,
    now,
  );

  // Also update the task's approval_status
  db.prepare("UPDATE tasks SET approval_status = 'pending', updated_at = ? WHERE id = ?").run(now, data.taskId);

  return getApprovalRequest(id)!;
}

export function getApprovalRequest(id: string): ApprovalRequest | null {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as any;
  return row ? mapRow(row) : null;
}

export function listApprovalRequests(filter?: {
  status?: ApprovalRequest["status"] | ApprovalRequest["status"][];
  taskId?: string;
  limit?: number;
  offset?: number;
}): ApprovalRequest[] {
  const db = getMcDb();
  let sql = "SELECT * FROM approval_requests WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    sql += ` AND status IN (${statuses.map(() => "?").join(",")})`;
    params.push(...statuses);
  }
  if (filter?.taskId) {
    sql += " AND task_id = ?";
    params.push(filter.taskId);
  }

  sql += " ORDER BY created_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
    if (filter.offset) {
      sql += " OFFSET ?";
      params.push(filter.offset);
    }
  }

  const rows = db.prepare(sql).all(...(params as (string | number | null)[])) as any[];
  return rows.map(mapRow);
}

export function resolveApproval(
  id: string,
  decision: "approved" | "rejected",
  opts?: { decidedBy?: string; note?: string },
): ApprovalRequest | null {
  const db = getMcDb();
  const existing = db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as any;
  if (!existing || String(existing.status) !== "pending") return null;

  const now = Date.now();

  db.prepare(`
    UPDATE approval_requests
    SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?
    WHERE id = ?
  `).run(decision, opts?.decidedBy ?? "operator", now, opts?.note ?? null, id);

  // Update task approval_status
  db.prepare("UPDATE tasks SET approval_status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?")
    .run(decision, opts?.decidedBy ?? "operator", now, now, String(existing.task_id));

  return getApprovalRequest(id);
}

export function getApprovalStats(): { pending: number; approved: number; rejected: number } {
  const db = getMcDb();
  const rows = db.prepare(
    "SELECT status, COUNT(*) as count FROM approval_requests GROUP BY status",
  ).all() as any[];
  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[String(row.status)] = Number(row.count);
  }
  return {
    pending: stats["pending"] ?? 0,
    approved: stats["approved"] ?? 0,
    rejected: stats["rejected"] ?? 0,
  };
}

/** Expire approval requests that have passed their expires_at */
export function expireApprovals(): string[] {
  const db = getMcDb();
  const now = Date.now();
  const expired = db.prepare(
    "SELECT id, task_id FROM approval_requests WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
  ).all(now) as any[];

  const expiredIds: string[] = [];
  for (const row of expired) {
    db.prepare("UPDATE approval_requests SET status = 'expired' WHERE id = ?").run(String(row.id));
    db.prepare("UPDATE tasks SET approval_status = NULL, status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(now, String(row.task_id));
    expiredIds.push(String(row.id));
  }
  return expiredIds;
}
