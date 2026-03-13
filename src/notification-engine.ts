import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import type {
  Notification,
  NotificationType,
  NotificationSeverity,
} from "./types.js";
// ── Config ───────────────────────────────────────────────────────────────────

let slackWebhookUrl: string | undefined;
let discordWebhookUrl: string | undefined;

export function setWebhookConfig(config?: { slack?: string; discord?: string }): void {
  if (config?.slack) slackWebhookUrl = config.slack;
  if (config?.discord) discordWebhookUrl = config.discord;
}

// ── Webhook Dispatch ────────────────────────────────────────────────────────

async function dispatchWebhook(notification: Notification): Promise<void> {
  if (notification.severity !== "warning" && notification.severity !== "error") return;
  if (!slackWebhookUrl && !discordWebhookUrl) return;

  const title = notification.title;
  let body = notification.body ? `\n> ${notification.body}` : "";
  if (notification.severity === "error") body = `🚨 **ERROR**: ${title}${body}`;
  else if (notification.severity === "warning") body = `⚠️ **WARNING**: ${title}${body}`;
  else body = `${title}${body}`;

  if (slackWebhookUrl) {
    try {
      await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body }),
      });
    } catch (e) {
      console.error("[mission-control] Failed to send Slack webhook:", e);
    }
  }

  if (discordWebhookUrl) {
    try {
      await fetch(discordWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body }),
      });
    } catch (e) {
      console.error("[mission-control] Failed to send Discord webhook:", e);
    }
  }
}

// ── Row Mapping ─────────────────────────────────────────────────────────────

function rowToNotification(r: any): Notification {
  return {
    id: String(r.id),
    type: String(r.type) as NotificationType,
    title: String(r.title),
    body: r.body != null ? String(r.body) : undefined,
    severity: String(r.severity) as NotificationSeverity,
    sourceType: r.source_type != null ? String(r.source_type) : undefined,
    sourceId: r.source_id != null ? String(r.source_id) : undefined,
    actorId: r.actor_id != null ? String(r.actor_id) : undefined,
    read: Boolean(r.read),
    dismissed: Boolean(r.dismissed),
    actionType: r.action_type != null ? String(r.action_type) : undefined,
    actionPayloadJson: r.action_payload_json != null ? String(r.action_payload_json) : undefined,
    createdAt: Number(r.created_at),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function createNotification(data: {
  type: NotificationType;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  sourceType?: string;
  sourceId?: string;
  actorId?: string;
  actionType?: string;
  actionPayloadJson?: string;
}): Notification {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO notifications (id, type, title, body, severity, source_type, source_id, actor_id, action_type, action_payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.type,
    data.title,
    data.body ?? null,
    data.severity ?? "info",
    data.sourceType ?? null,
    data.sourceId ?? null,
    data.actorId ?? null,
    data.actionType ?? null,
    data.actionPayloadJson ?? null,
    now,
  );

  const created = getNotification(id)!;

  // Fire and forget webhook
  dispatchWebhook(created).catch(() => { });

  return created;
}

export function getNotification(id: string): Notification | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as any;
  return row ? rowToNotification(row) : undefined;
}

export function listNotifications(opts?: {
  read?: boolean;
  dismissed?: boolean;
  type?: NotificationType | NotificationType[];
  limit?: number;
  offset?: number;
}): Notification[] {
  const db = getMcDb();
  const clauses: string[] = ["1=1"];
  const params: Record<string, string | number> = {};

  if (opts?.read !== undefined) {
    clauses.push("read = :read");
    params.read = opts.read ? 1 : 0;
  }

  if (opts?.dismissed !== undefined) {
    clauses.push("dismissed = :dismissed");
    params.dismissed = opts.dismissed ? 1 : 0;
  }

  if (opts?.type !== undefined) {
    if (Array.isArray(opts.type)) {
      const placeholders = opts.type.map((_, i) => `:type${i}`).join(", ");
      clauses.push(`type IN (${placeholders})`);
      opts.type.forEach((t, i) => { params[`type${i}`] = t; });
    } else {
      clauses.push("type = :type");
      params.type = opts.type;
    }
  }

  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  return (
    db
      .prepare(
        `SELECT * FROM notifications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      )
      .all(params) as any[]
  ).map(rowToNotification);
}

export function getUnreadCount(): number {
  const db = getMcDb();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM notifications WHERE read = 0 AND dismissed = 0").get() as any;
  return Number(row?.cnt ?? 0);
}

export function markRead(id: string): Notification | undefined {
  const db = getMcDb();
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id);
  return getNotification(id);
}

export function markAllRead(): number {
  const db = getMcDb();
  const result = db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run();
  return Number(result.changes);
}

export function dismissNotification(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("UPDATE notifications SET dismissed = 1 WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function dismissAll(): number {
  const db = getMcDb();
  const result = db.prepare("UPDATE notifications SET dismissed = 1 WHERE dismissed = 0").run();
  return Number(result.changes);
}

// ── Convenience Creators ─────────────────────────────────────────────────────

export function notifyApprovalNeeded(taskId: string, taskTitle: string, requestedBy?: string): Notification {
  return createNotification({
    type: "approval_needed",
    title: `Approval needed: ${taskTitle}`,
    body: `Task "${taskTitle}" requires approval before execution.`,
    severity: "warning",
    sourceType: "task",
    sourceId: taskId,
    actorId: requestedBy,
    actionType: "navigate",
    actionPayloadJson: JSON.stringify({ tab: "approvals" }),
  });
}

export function notifyTaskCompleted(taskId: string, taskTitle: string, agentId: string): Notification {
  return createNotification({
    type: "task_completed",
    title: `Task completed: ${taskTitle}`,
    body: `Agent "${agentId}" successfully completed "${taskTitle}".`,
    severity: "success",
    sourceType: "task",
    sourceId: taskId,
    actorId: agentId,
  });
}

export function notifyTaskFailed(taskId: string, taskTitle: string, agentId: string, error?: string): Notification {
  return createNotification({
    type: "task_failed",
    title: `Task failed: ${taskTitle}`,
    body: error ? `Agent "${agentId}" failed: ${error}` : `Agent "${agentId}" failed to complete "${taskTitle}".`,
    severity: "error",
    sourceType: "task",
    sourceId: taskId,
    actorId: agentId,
  });
}

export function notifyDelegationRequest(delegationId: string, taskTitle: string, fromAgent: string, toAgent: string, reason?: string): Notification {
  return createNotification({
    type: "delegation_request",
    title: `Delegation request: ${taskTitle}`,
    body: `Agent "${fromAgent}" wants to delegate "${taskTitle}" to "${toAgent}".${reason ? ` Reason: ${reason}` : ""}`,
    severity: "warning",
    sourceType: "delegation",
    sourceId: delegationId,
    actionType: "navigate",
    actionPayloadJson: JSON.stringify({ tab: "tasks" }),
  });
}

export function notifyDelegationResolved(taskTitle: string, fromAgent: string, toAgent: string, approved: boolean): Notification {
  return createNotification({
    type: approved ? "delegation_approved" : "delegation_rejected",
    title: `Delegation ${approved ? "approved" : "rejected"}: ${taskTitle}`,
    body: `Delegation of "${taskTitle}" from "${fromAgent}" to "${toAgent}" was ${approved ? "approved" : "rejected"}.`,
    severity: approved ? "success" : "info",
    sourceType: "task",
  });
}

export function notifyDeadlineApproaching(taskId: string, taskTitle: string, deadlineAt: number): Notification {
  const hoursLeft = Math.round((deadlineAt - Date.now()) / 3600000);
  return createNotification({
    type: "deadline_approaching",
    title: `Deadline approaching: ${taskTitle}`,
    body: `Task "${taskTitle}" has a deadline in ~${hoursLeft}h.`,
    severity: hoursLeft <= 2 ? "error" : "warning",
    sourceType: "task",
    sourceId: taskId,
  });
}

export function notifyWorkflowCompleted(workflowId: string, workflowName: string): Notification {
  return createNotification({
    type: "workflow_completed",
    title: `Workflow completed: ${workflowName}`,
    severity: "success",
    sourceType: "workflow",
    sourceId: workflowId,
  });
}

export function notifyWorkflowFailed(workflowId: string, workflowName: string, error?: string): Notification {
  return createNotification({
    type: "workflow_failed",
    title: `Workflow failed: ${workflowName}`,
    body: error ?? undefined,
    severity: "error",
    sourceType: "workflow",
    sourceId: workflowId,
  });
}

export function notifyTaskDelegated(taskId: string, taskTitle: string, fromAgent: string, toAgent: string): Notification {
  return createNotification({
    type: "task_delegated",
    title: `Task delegated: ${taskTitle}`,
    body: `"${taskTitle}" has been delegated from "${fromAgent}" to "${toAgent}".`,
    severity: "info",
    sourceType: "task",
    sourceId: taskId,
  });
}

// ── Deadline Checker ─────────────────────────────────────────────────────────

/**
 * Check for tasks approaching their deadline within the given horizon (ms).
 * Returns task IDs that had notifications created. Avoids duplicate notifications
 * by checking if one already exists for the same task.
 */
export function checkDeadlines(horizonMs = 4 * 3600000): string[] {
  const db = getMcDb();
  const now = Date.now();
  const horizon = now + horizonMs;

  // Find tasks with upcoming deadlines that aren't done/cancelled/failed
  const tasks = db.prepare(`
    SELECT id, title, deadline_at FROM tasks
    WHERE deadline_at IS NOT NULL
      AND deadline_at > ?
      AND deadline_at <= ?
      AND status NOT IN ('done', 'failed', 'cancelled')
  `).all(now, horizon) as any[];

  const notified: string[] = [];
  for (const task of tasks) {
    // Check if we already notified for this task's deadline
    const existing = db.prepare(
      "SELECT 1 FROM notifications WHERE type = 'deadline_approaching' AND source_type = 'task' AND source_id = ? AND created_at > ?",
    ).get(task.id, now - horizonMs) as any;

    if (!existing) {
      notifyDeadlineApproaching(task.id, task.title, Number(task.deadline_at));
      notified.push(String(task.id));
    }
  }

  return notified;
}
