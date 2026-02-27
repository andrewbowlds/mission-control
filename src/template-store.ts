import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import { createTask } from "./task-engine.js";
import type {
  TaskTemplate,
  TaskPriority,
  TaskType,
  ExecutionMode,
  Task,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonArray<T>(json: string | null | undefined, fallback: T[] = []): T[] {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function rowToTemplate(row: any): TaskTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    agentId: row.agent_id,
    priority: row.priority as TaskPriority,
    taskType: row.task_type as TaskType,
    executionMode: row.execution_mode as ExecutionMode,
    maxRetries: row.max_retries,
    timeoutMs: row.timeout_ms ?? undefined,
    requiresApproval: Boolean(row.requires_approval),
    tags: parseJsonArray<string>(row.tags_json),
    contextJson: row.context_json ?? "{}",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listTemplates(): TaskTemplate[] {
  const db = getMcDb();
  const rows = db.prepare("SELECT * FROM task_templates ORDER BY name ASC").all() as any[];
  return rows.map(rowToTemplate);
}

export function getTemplate(id: string): TaskTemplate | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM task_templates WHERE id = ?").get(id) as any;
  return row ? rowToTemplate(row) : undefined;
}

export function createTemplate(data: {
  name: string;
  agentId: string;
  description?: string;
  priority?: TaskPriority;
  taskType?: TaskType;
  executionMode?: ExecutionMode;
  maxRetries?: number;
  timeoutMs?: number;
  requiresApproval?: boolean;
  tags?: string[];
  contextJson?: string;
}): TaskTemplate {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO task_templates (id, name, description, agent_id, priority, task_type, execution_mode,
      max_retries, timeout_ms, requires_approval, tags_json, context_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description ?? null,
    data.agentId,
    data.priority ?? "normal",
    data.taskType ?? "automated",
    data.executionMode ?? "agent",
    data.maxRetries ?? 2,
    data.timeoutMs ?? null,
    data.requiresApproval ? 1 : 0,
    JSON.stringify(data.tags ?? []),
    data.contextJson ?? "{}",
    now,
    now,
  );
  return getTemplate(id)!;
}

export function updateTemplate(
  id: string,
  patch: {
    name?: string;
    description?: string;
    agentId?: string;
    priority?: TaskPriority;
    taskType?: TaskType;
    executionMode?: ExecutionMode;
    maxRetries?: number;
    timeoutMs?: number | null;
    requiresApproval?: boolean;
    tags?: string[];
    contextJson?: string;
  },
): TaskTemplate | undefined {
  const db = getMcDb();
  const existing = getTemplate(id);
  if (!existing) return undefined;

  const name = patch.name ?? existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const agentId = patch.agentId ?? existing.agentId;
  const priority = patch.priority ?? existing.priority;
  const taskType = patch.taskType ?? existing.taskType;
  const executionMode = patch.executionMode ?? existing.executionMode;
  const maxRetries = patch.maxRetries ?? existing.maxRetries;
  const timeoutMs = patch.timeoutMs !== undefined ? patch.timeoutMs : existing.timeoutMs;
  const requiresApproval = patch.requiresApproval !== undefined ? patch.requiresApproval : existing.requiresApproval;
  const tags = patch.tags ?? existing.tags;
  const contextJson = patch.contextJson ?? existing.contextJson;

  db.prepare(`
    UPDATE task_templates SET name = ?, description = ?, agent_id = ?, priority = ?, task_type = ?,
      execution_mode = ?, max_retries = ?, timeout_ms = ?, requires_approval = ?,
      tags_json = ?, context_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    description ?? null,
    agentId,
    priority,
    taskType,
    executionMode,
    maxRetries,
    timeoutMs ?? null,
    requiresApproval ? 1 : 0,
    JSON.stringify(tags),
    contextJson,
    Date.now(),
    id,
  );
  return getTemplate(id);
}

export function deleteTemplate(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM task_templates WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Instantiation ────────────────────────────────────────────────────────────

/**
 * Create a concrete Task from a template, with optional overrides.
 * The task goes through the normal task engine pipeline.
 */
export function instantiateTemplate(
  templateId: string,
  overrides?: {
    title?: string;
    description?: string;
    contextJson?: string;
    parentId?: string;
    scheduledAt?: number;
    deadlineAt?: number;
    agentId?: string;
  },
): Task | undefined {
  const template = getTemplate(templateId);
  if (!template) return undefined;

  // Merge context: template context as base, overrides merged on top
  let mergedContext = template.contextJson;
  if (overrides?.contextJson) {
    try {
      const base = JSON.parse(template.contextJson);
      const over = JSON.parse(overrides.contextJson);
      mergedContext = JSON.stringify({ ...base, ...over });
    } catch {
      mergedContext = overrides.contextJson;
    }
  }

  return createTask({
    title: overrides?.title ?? `[${template.name}]`,
    description: overrides?.description ?? template.description,
    agentId: overrides?.agentId ?? template.agentId,
    priority: template.priority,
    taskType: template.taskType,
    executionMode: template.executionMode,
    maxRetries: template.maxRetries,
    timeoutMs: template.timeoutMs,
    requiresApproval: template.requiresApproval,
    tags: template.tags,
    contextJson: mergedContext,
    parentId: overrides?.parentId,
    scheduledAt: overrides?.scheduledAt,
    deadlineAt: overrides?.deadlineAt,
  });
}
