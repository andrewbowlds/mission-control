import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import { getTask, updateTask, transitionTask, addTaskUpdate } from "./task-engine.js";
import { createApprovalRequest } from "./approval-engine.js";
import { recommendAgents } from "./intelligence/router.js";
import { notifyDelegationRequest, notifyDelegationResolved, notifyTaskDelegated } from "./notification-engine.js";
import type { Delegation, DelegationStatus, Task, AgentRecommendation } from "./types.js";

// ── Row Mapping ─────────────────────────────────────────────────────────────

function rowToDelegation(r: any): Delegation {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    fromAgentId: String(r.from_agent_id),
    toAgentId: String(r.to_agent_id),
    reason: r.reason != null ? String(r.reason) : undefined,
    status: String(r.status) as DelegationStatus,
    requiresApproval: Boolean(r.requires_approval),
    approvalId: r.approval_id != null ? String(r.approval_id) : undefined,
    originalAgentId: String(r.original_agent_id),
    createdAt: Number(r.created_at),
    resolvedAt: r.resolved_at != null ? Number(r.resolved_at) : undefined,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function getDelegation(id: string): Delegation | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM delegations WHERE id = ?").get(id) as any;
  return row ? rowToDelegation(row) : undefined;
}

export function listDelegations(opts?: {
  taskId?: string;
  fromAgentId?: string;
  toAgentId?: string;
  status?: DelegationStatus | DelegationStatus[];
  limit?: number;
  offset?: number;
}): Delegation[] {
  const db = getMcDb();
  const clauses: string[] = ["1=1"];
  const params: Record<string, string | number> = {};

  if (opts?.taskId) {
    clauses.push("task_id = :taskId");
    params.taskId = opts.taskId;
  }
  if (opts?.fromAgentId) {
    clauses.push("from_agent_id = :fromAgentId");
    params.fromAgentId = opts.fromAgentId;
  }
  if (opts?.toAgentId) {
    clauses.push("to_agent_id = :toAgentId");
    params.toAgentId = opts.toAgentId;
  }
  if (opts?.status) {
    if (Array.isArray(opts.status)) {
      const placeholders = opts.status.map((_, i) => `:status${i}`).join(", ");
      clauses.push(`status IN (${placeholders})`);
      opts.status.forEach((s, i) => { params[`status${i}`] = s; });
    } else {
      clauses.push("status = :status");
      params.status = opts.status;
    }
  }

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  return (
    db
      .prepare(
        `SELECT * FROM delegations WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      )
      .all(params) as any[]
  ).map(rowToDelegation);
}

// ── Core Delegation Logic ────────────────────────────────────────────────────

/**
 * Request a delegation: agent A wants to hand off a task to agent B.
 * If requiresApproval is true (default for agent-initiated), creates an
 * approval request and waits. Otherwise, executes immediately.
 */
export function requestDelegation(data: {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
  requiresApproval?: boolean;
}): Delegation | undefined {
  const db = getMcDb();
  const task = getTask(data.taskId);
  if (!task) return undefined;

  const requiresApproval = data.requiresApproval ?? true;
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO delegations (id, task_id, from_agent_id, to_agent_id, reason, status, requires_approval, original_agent_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.taskId,
    data.fromAgentId,
    data.toAgentId,
    data.reason ?? null,
    requiresApproval ? "pending" : "approved",
    requiresApproval ? 1 : 0,
    task.agentId,
    now,
  );

  if (requiresApproval) {
    // Create approval request for the operator
    const approval = createApprovalRequest({
      taskId: data.taskId,
      requestType: "custom",
      title: `Delegation: "${task.title}" from ${data.fromAgentId} to ${data.toAgentId}`,
      description: data.reason
        ? `${data.fromAgentId} wants to delegate this task to ${data.toAgentId}. Reason: ${data.reason}`
        : `${data.fromAgentId} wants to delegate this task to ${data.toAgentId}.`,
      requestedBy: data.fromAgentId,
    });

    // Link approval to delegation
    db.prepare("UPDATE delegations SET approval_id = ? WHERE id = ?").run(approval.id, id);

    // Notify
    notifyDelegationRequest(id, task.title, data.fromAgentId, data.toAgentId, data.reason);

    addTaskUpdate(data.taskId, {
      note: `Delegation requested: ${data.fromAgentId} → ${data.toAgentId}${data.reason ? ` (${data.reason})` : ""}`,
      author: data.fromAgentId,
    });
  } else {
    // Execute immediately
    executeDelegation(id);
  }

  return getDelegation(id);
}

/**
 * Resolve a pending delegation (after approval decision).
 */
export function resolveDelegation(
  id: string,
  approved: boolean,
  opts?: { decidedBy?: string; note?: string },
): Delegation | undefined {
  const db = getMcDb();
  const delegation = getDelegation(id);
  if (!delegation || delegation.status !== "pending") return undefined;

  if (approved) {
    executeDelegation(id);
    const task = getTask(delegation.taskId);
    notifyDelegationResolved(
      task?.title ?? "Unknown task",
      delegation.fromAgentId,
      delegation.toAgentId,
      true,
    );
  } else {
    db.prepare("UPDATE delegations SET status = 'rejected', resolved_at = ? WHERE id = ?")
      .run(Date.now(), id);
    const task = getTask(delegation.taskId);
    notifyDelegationResolved(
      task?.title ?? "Unknown task",
      delegation.fromAgentId,
      delegation.toAgentId,
      false,
    );
    if (task) {
      addTaskUpdate(delegation.taskId, {
        note: `Delegation rejected: ${delegation.fromAgentId} → ${delegation.toAgentId}${opts?.note ? ` (${opts.note})` : ""}`,
        author: opts?.decidedBy ?? "operator",
      });
    }
  }

  return getDelegation(id);
}

/**
 * Execute the delegation: reassign the task to the new agent.
 */
function executeDelegation(delegationId: string): void {
  const db = getMcDb();
  const delegation = getDelegation(delegationId);
  if (!delegation) return;

  const task = getTask(delegation.taskId);
  if (!task) return;

  // Update task's agent assignment
  updateTask(delegation.taskId, { agentId: delegation.toAgentId });

  // Mark delegation as completed
  db.prepare("UPDATE delegations SET status = 'completed', resolved_at = ? WHERE id = ?")
    .run(Date.now(), delegationId);

  addTaskUpdate(delegation.taskId, {
    note: `Task delegated: ${delegation.fromAgentId} → ${delegation.toAgentId}${delegation.reason ? ` (${delegation.reason})` : ""}`,
    author: "system",
  });

  notifyTaskDelegated(delegation.taskId, task.title, delegation.fromAgentId, delegation.toAgentId);
}

/**
 * Cancel a pending delegation.
 */
export function cancelDelegation(id: string): Delegation | undefined {
  const db = getMcDb();
  const delegation = getDelegation(id);
  if (!delegation || delegation.status !== "pending") return undefined;

  db.prepare("UPDATE delegations SET status = 'cancelled', resolved_at = ? WHERE id = ?")
    .run(Date.now(), id);

  return getDelegation(id);
}

// ── Smart Delegation ─────────────────────────────────────────────────────────

/**
 * Get delegation suggestions for a task based on the intelligence layer.
 * Returns recommended agents with scores and reasons, excluding the current agent.
 */
export function getDelegationSuggestions(
  taskId: string,
  opts?: { topN?: number },
): AgentRecommendation[] {
  const task = getTask(taskId);
  if (!task) return [];

  const recommendations = recommendAgents(task, { topN: (opts?.topN ?? 5) + 1 });

  // Filter out the current agent
  return recommendations
    .filter((r) => r.agentId !== task.agentId)
    .slice(0, opts?.topN ?? 5);
}

/**
 * Auto-delegate: find the best agent for a task and create a delegation request.
 * Used by agents who determine they aren't the right fit for a task.
 */
export function autoDelegateTask(
  taskId: string,
  fromAgentId: string,
  reason?: string,
): Delegation | undefined {
  const suggestions = getDelegationSuggestions(taskId, { topN: 1 });
  if (suggestions.length === 0) return undefined;

  const best = suggestions[0];
  return requestDelegation({
    taskId,
    fromAgentId,
    toAgentId: best.agentId,
    reason: reason ?? `Auto-delegation based on capability scoring (${best.reason})`,
    requiresApproval: true, // always require approval for auto-delegation
  });
}
