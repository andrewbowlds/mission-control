import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import { instantiateTemplate } from "./template-store.js";
import { startWorkflow } from "./workflow-engine.js";
import type {
  AutomationRule,
  AutomationEventType,
  AutomationActionType,
  Task,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(json: string | null | undefined, fallback: any = {}): any {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function rowToRule(row: any): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: Boolean(row.enabled),
    eventType: row.event_type as AutomationEventType,
    eventFilterJson: row.event_filter_json ?? "{}",
    actionType: row.action_type as AutomationActionType,
    actionConfigJson: row.action_config_json ?? "{}",
    cooldownMs: row.cooldown_ms ?? 0,
    lastFiredAt: row.last_fired_at ?? undefined,
    fireCount: row.fire_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listRules(): AutomationRule[] {
  const db = getMcDb();
  const rows = db.prepare("SELECT * FROM automation_rules ORDER BY name ASC").all() as any[];
  return rows.map(rowToRule);
}

export function getRule(id: string): AutomationRule | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id) as any;
  return row ? rowToRule(row) : undefined;
}

export function createRule(data: {
  name: string;
  description?: string;
  eventType: AutomationEventType;
  eventFilterJson?: string;
  actionType: AutomationActionType;
  actionConfigJson: string;
  cooldownMs?: number;
  enabled?: boolean;
}): AutomationRule {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO automation_rules (id, name, description, enabled, event_type, event_filter_json,
      action_type, action_config_json, cooldown_ms, fire_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    data.name,
    data.description ?? null,
    data.enabled !== false ? 1 : 0,
    data.eventType,
    data.eventFilterJson ?? "{}",
    data.actionType,
    data.actionConfigJson,
    data.cooldownMs ?? 0,
    now,
    now,
  );
  return getRule(id)!;
}

export function updateRule(
  id: string,
  patch: {
    name?: string;
    description?: string;
    enabled?: boolean;
    eventType?: AutomationEventType;
    eventFilterJson?: string;
    actionType?: AutomationActionType;
    actionConfigJson?: string;
    cooldownMs?: number;
  },
): AutomationRule | undefined {
  const db = getMcDb();
  const existing = getRule(id);
  if (!existing) return undefined;

  const name = patch.name ?? existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const enabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;
  const eventType = patch.eventType ?? existing.eventType;
  const eventFilterJson = patch.eventFilterJson ?? existing.eventFilterJson;
  const actionType = patch.actionType ?? existing.actionType;
  const actionConfigJson = patch.actionConfigJson ?? existing.actionConfigJson;
  const cooldownMs = patch.cooldownMs ?? existing.cooldownMs;

  db.prepare(`
    UPDATE automation_rules SET name = ?, description = ?, enabled = ?, event_type = ?,
      event_filter_json = ?, action_type = ?, action_config_json = ?, cooldown_ms = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name, description ?? null, enabled ? 1 : 0, eventType,
    eventFilterJson, actionType, actionConfigJson, cooldownMs, Date.now(), id,
  );
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM automation_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Event Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate automation rules against an event.
 * Called from the agent_end hook when tasks complete or fail.
 */
export function evaluateEvent(
  eventType: AutomationEventType,
  eventData: { task?: Task; agentId?: string; tags?: string[] },
  broadcastFn?: (event: string, payload: any) => void,
): void {
  const db = getMcDb();
  const rules = db.prepare(
    "SELECT * FROM automation_rules WHERE enabled = 1 AND event_type = ?",
  ).all(eventType) as any[];

  const now = Date.now();

  for (const row of rules) {
    const rule = rowToRule(row);

    // Check cooldown
    if (rule.cooldownMs > 0 && rule.lastFiredAt) {
      if (now - rule.lastFiredAt < rule.cooldownMs) continue;
    }

    // Check filter
    if (!matchesFilter(rule, eventData)) continue;

    // Fire the action
    executeAction(rule, eventData, broadcastFn);

    // Update last fired timestamp and count
    db.prepare(
      "UPDATE automation_rules SET last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?",
    ).run(now, rule.id);
  }
}

function matchesFilter(rule: AutomationRule, eventData: { task?: Task; agentId?: string; tags?: string[] }): boolean {
  const filter = parseJson(rule.eventFilterJson);
  if (!filter || Object.keys(filter).length === 0) return true;

  // Filter by agentId
  if (filter.agentId && eventData.agentId !== filter.agentId) return false;

  // Filter by tags (all specified tags must be present)
  if (Array.isArray(filter.tags) && filter.tags.length > 0) {
    const taskTags = eventData.tags ?? eventData.task?.tags ?? [];
    if (!filter.tags.every((t: string) => taskTags.includes(t))) return false;
  }

  // Filter by task priority
  if (filter.priority && eventData.task?.priority !== filter.priority) return false;

  // Filter by task type
  if (filter.taskType && eventData.task?.taskType !== filter.taskType) return false;

  return true;
}

function executeAction(
  rule: AutomationRule,
  eventData: { task?: Task; agentId?: string; tags?: string[] },
  broadcastFn?: (event: string, payload: any) => void,
): void {
  const config = parseJson(rule.actionConfigJson);

  switch (rule.actionType) {
    case "create_task": {
      if (config.templateId) {
        const task = instantiateTemplate(config.templateId, {
          title: config.title,
          contextJson: config.contextJson,
        });
        if (task && broadcastFn) {
          broadcastFn("mc.task", { type: "created", task });
        }
      }
      break;
    }
    case "start_workflow": {
      if (config.workflowId) {
        const run = startWorkflow(config.workflowId, {
          triggerSource: `automation:${rule.id}`,
          contextJson: config.contextJson,
        });
        if (run && broadcastFn) {
          broadcastFn("mc.workflow", { type: "run_started", run });
        }
      }
      break;
    }
    case "send_message": {
      if (broadcastFn) {
        broadcastFn("mc.automation", {
          type: "fired",
          rule: { id: rule.id, name: rule.name },
          message: config.message ?? `Automation "${rule.name}" fired`,
          eventData: { taskId: eventData.task?.id, agentId: eventData.agentId },
        });
      }
      break;
    }
  }
}
