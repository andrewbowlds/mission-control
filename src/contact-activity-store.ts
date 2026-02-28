import { randomUUID } from "node:crypto";
import { getContactsDb } from "./contacts-db.js";
import type { CommunicationActivity, CommunicationChannel, CommunicationDirection } from "./types.js";

function mapActivityRow(row: any): CommunicationActivity {
  return {
    id: String(row.id),
    personId: String(row.contact_id),
    channel: row.channel as CommunicationChannel,
    direction: row.direction as CommunicationDirection,
    timestamp: Number(row.timestamp),
    status: row.status == null ? undefined : String(row.status),
    summary: row.summary == null ? undefined : String(row.summary),
    taskId: row.task_id == null ? undefined : String(row.task_id),
    sessionId: row.session_id == null ? undefined : String(row.session_id),
    messageId: row.message_id == null ? undefined : String(row.message_id),
    providerId: row.provider_id == null ? undefined : String(row.provider_id),
    providerName: row.provider_name == null ? undefined : String(row.provider_name),
    metadataJson: row.metadata_json == null ? undefined : String(row.metadata_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function listContactActivities(filter: {
  personId: string;
  channel?: CommunicationChannel;
  direction?: CommunicationDirection;
  query?: string;
  limit?: number;
  before?: number;
  after?: number;
}): CommunicationActivity[] {
  const db = getContactsDb();
  const where: string[] = ["contact_id = ?"];
  const params: any[] = [filter.personId];

  if (filter.channel) {
    where.push("channel = ?");
    params.push(filter.channel);
  }
  if (filter.direction) {
    where.push("direction = ?");
    params.push(filter.direction);
  }
  if (typeof filter.before === "number") {
    where.push("timestamp <= ?");
    params.push(filter.before);
  }
  if (typeof filter.after === "number") {
    where.push("timestamp >= ?");
    params.push(filter.after);
  }
  const query = filter.query?.trim().toLowerCase();
  if (query) {
    where.push("(lower(coalesce(summary, '')) LIKE ? OR lower(coalesce(status, '')) LIKE ? OR lower(coalesce(provider_name, '')) LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like, like);
  }

  const rows = db.prepare(`
    SELECT *
    FROM contact_activities
    WHERE ${where.join(" AND ")}
    ORDER BY timestamp DESC, created_at DESC
    LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, filter.limit ?? 100))) as any[];

  return rows.map(mapActivityRow);
}

export function createContactActivity(data: {
  personId: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  timestamp?: number;
  status?: string;
  summary?: string;
  taskId?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  providerName?: string;
  metadataJson?: string;
}): CommunicationActivity {
  const db = getContactsDb();
  const now = Date.now();
  const id = randomUUID();
  const timestamp = data.timestamp ?? now;

  db.prepare(`
    INSERT INTO contact_activities (
      id, contact_id, channel, direction, timestamp, status, summary,
      task_id, session_id, message_id, provider_id, provider_name, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.personId,
    data.channel,
    data.direction,
    timestamp,
    data.status ?? null,
    data.summary ?? null,
    data.taskId ?? null,
    data.sessionId ?? null,
    data.messageId ?? null,
    data.providerId ?? null,
    data.providerName ?? null,
    data.metadataJson ?? null,
    now,
    now,
  );

  const row = db.prepare("SELECT * FROM contact_activities WHERE id = ?").get(id) as any;
  return mapActivityRow(row);
}
