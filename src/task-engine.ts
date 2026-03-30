import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  ExecutionMode,
  TaskUpdate,
  TaskRun,
} from "./types.js";

// ── Row Mapping ─────────────────────────────────────────────────────────────

function mapRowToTask(row: any): Task {
  return {
    id: String(row.id),
    parentId: row.parent_id == null ? undefined : String(row.parent_id),
    title: String(row.title),
    description: row.description == null ? undefined : String(row.description),
    agentId: String(row.agent_id),
    sessionKey: row.session_key == null ? undefined : String(row.session_key),
    status: String(row.status) as TaskStatus,
    priority: String(row.priority) as TaskPriority,
    taskType: String(row.task_type) as TaskType,
    executionMode: String(row.execution_mode ?? "agent") as ExecutionMode,
    maxRetries: Number(row.max_retries ?? 2),
    retryCount: Number(row.retry_count ?? 0),
    timeoutMs: row.timeout_ms == null ? undefined : Number(row.timeout_ms),
    requiresApproval: Boolean(row.requires_approval),
    approvalStatus: row.approval_status == null ? undefined : row.approval_status,
    approvedBy: row.approved_by == null ? undefined : String(row.approved_by),
    approvedAt: row.approved_at == null ? undefined : Number(row.approved_at),
    scheduledAt: row.scheduled_at == null ? undefined : Number(row.scheduled_at),
    deadlineAt: row.deadline_at == null ? undefined : Number(row.deadline_at),
    tags: row.tags_json ? JSON.parse(String(row.tags_json)) : [],
    contextJson: String(row.context_json ?? "{}"),
    resultJson: row.result_json == null ? undefined : String(row.result_json),
    errorMessage: row.error_message == null ? undefined : String(row.error_message),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
  };
}

function mapRowToUpdate(row: any): TaskUpdate {
  const metadataJson = row.metadata_json == null ? undefined : String(row.metadata_json);
  let metadata: TaskUpdate["metadata"] | undefined;
  if (metadataJson) {
    try {
      metadata = JSON.parse(metadataJson);
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: String(row.id),
    taskId: String(row.task_id),
    author: String(row.author),
    note: String(row.note),
    status: row.status == null ? undefined : (String(row.status) as TaskStatus),
    link: row.link == null ? undefined : String(row.link),
    metadataJson,
    metadata,
    createdAt: Number(row.created_at),
  };
}

function mapRowToRun(row: any): TaskRun {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    agentId: String(row.agent_id),
    sessionKey: row.session_key == null ? undefined : String(row.session_key),
    runNumber: Number(row.run_number ?? 1),
    status: String(row.status) as TaskRun["status"],
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? undefined : Number(row.ended_at),
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    error: row.error == null ? undefined : String(row.error),
    resultJson: row.result_json == null ? undefined : String(row.result_json),
  };
}

// ── Task CRUD ───────────────────────────────────────────────────────────────

export function listTasks(filter?: {
  status?: TaskStatus | TaskStatus[];
  parentId?: string | null;
  agentId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Task[] {
  const db = getMcDb();
  let sql = "SELECT * FROM tasks WHERE 1=1";
  const params: unknown[] = [];

  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    sql += ` AND status IN (${statuses.map(() => "?").join(",")})`;
    params.push(...statuses);
  }
  if (filter?.parentId !== undefined) {
    if (filter.parentId === null) {
      sql += " AND parent_id IS NULL";
    } else {
      sql += " AND parent_id = ?";
      params.push(filter.parentId);
    }
  }
  if (filter?.agentId) {
    sql += " AND agent_id = ?";
    params.push(filter.agentId);
  }
  if (filter?.search) {
    sql += " AND (title LIKE ? OR description LIKE ?)";
    const q = `%${filter.search}%`;
    params.push(q, q);
  }

  sql += " ORDER BY sort_order ASC, updated_at DESC";

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
    if (filter.offset) {
      sql += " OFFSET ?";
      params.push(filter.offset);
    }
  }

  const rows = db.prepare(sql).all(...(params as (string | number | null)[])) as any[];
  return rows.map(mapRowToTask);
}

export function getTask(id: string): Task | null {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!row) return null;

  const task = mapRowToTask(row);

  // Populate children
  const children = db.prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY sort_order ASC, created_at ASC").all(id) as any[];
  task.children = children.map(mapRowToTask);

  // Populate dependencies
  const deps = db.prepare("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?").all(id) as any[];
  task.dependencies = deps.map((d: any) => String(d.depends_on_task_id));

  // Populate updates
  const updates = db.prepare("SELECT * FROM task_updates WHERE task_id = ? ORDER BY created_at ASC").all(id) as any[];
  task.updates = updates.map(mapRowToUpdate);

  // Populate runs
  const runs = db.prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC").all(id) as any[];
  task.runs = runs.map(mapRowToRun);

  return task;
}

export function createTask(data: {
  title: string;
  agentId: string;
  description?: string;
  priority?: TaskPriority;
  parentId?: string;
  taskType?: TaskType;
  executionMode?: ExecutionMode;
  requiresApproval?: boolean;
  scheduledAt?: number;
  deadlineAt?: number;
  timeoutMs?: number;
  maxRetries?: number;
  tags?: string[];
  contextJson?: string;
  dependencies?: string[];
}): Task {
  const db = getMcDb();
  const now = Date.now();
  const id = randomUUID();

  // Determine initial status
  const hasDeps = data.dependencies && data.dependencies.length > 0;
  const isScheduled = data.scheduledAt && data.scheduledAt > now;
  const initialStatus: TaskStatus = hasDeps ? "blocked" : isScheduled ? "pending" : "queued";

  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO tasks (
        id, parent_id, title, description, agent_id, status, priority,
        task_type, execution_mode, max_retries, timeout_ms,
        requires_approval, scheduled_at, deadline_at,
        tags_json, context_json, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.parentId ?? null,
      data.title,
      data.description ?? null,
      data.agentId,
      initialStatus,
      data.priority ?? "normal",
      data.taskType ?? "manual",
      data.executionMode ?? "agent",
      data.maxRetries ?? 2,
      data.timeoutMs ?? null,
      data.requiresApproval ? 1 : 0,
      data.scheduledAt ?? null,
      data.deadlineAt ?? null,
      JSON.stringify(data.tags ?? []),
      data.contextJson ?? "{}",
      0,
      now,
      now,
    );

    // Add dependencies
    if (data.dependencies) {
      const depStmt = db.prepare(
        "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
      );
      for (const depId of data.dependencies) {
        depStmt.run(id, depId);
      }
    }

    // Add creation update
    db.prepare(
      "INSERT INTO task_updates (id, task_id, author, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), id, "system", "Task created", initialStatus, now);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getTask(id)!;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<
      Task,
      | "title"
      | "description"
      | "agentId"
      | "priority"
      | "tags"
      | "contextJson"
      | "scheduledAt"
      | "deadlineAt"
      | "timeoutMs"
      | "maxRetries"
      | "requiresApproval"
      | "executionMode"
      | "sortOrder"
    >
  >,
): Task | null {
  const db = getMcDb();
  const existing = db.prepare("SELECT id FROM tasks WHERE id = ?").get(id) as any;
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.title !== undefined) { sets.push("title = ?"); params.push(patch.title); }
  if (patch.description !== undefined) { sets.push("description = ?"); params.push(patch.description); }
  if (patch.agentId !== undefined) { sets.push("agent_id = ?"); params.push(patch.agentId); }
  if (patch.priority !== undefined) { sets.push("priority = ?"); params.push(patch.priority); }
  if (patch.tags !== undefined) { sets.push("tags_json = ?"); params.push(JSON.stringify(patch.tags)); }
  if (patch.contextJson !== undefined) { sets.push("context_json = ?"); params.push(patch.contextJson); }
  if (patch.scheduledAt !== undefined) { sets.push("scheduled_at = ?"); params.push(patch.scheduledAt); }
  if (patch.deadlineAt !== undefined) { sets.push("deadline_at = ?"); params.push(patch.deadlineAt); }
  if (patch.timeoutMs !== undefined) { sets.push("timeout_ms = ?"); params.push(patch.timeoutMs); }
  if (patch.maxRetries !== undefined) { sets.push("max_retries = ?"); params.push(patch.maxRetries); }
  if (patch.requiresApproval !== undefined) { sets.push("requires_approval = ?"); params.push(patch.requiresApproval ? 1 : 0); }
  if (patch.executionMode !== undefined) { sets.push("execution_mode = ?"); params.push(patch.executionMode); }
  if (patch.sortOrder !== undefined) { sets.push("sort_order = ?"); params.push(patch.sortOrder); }

  if (sets.length === 0) return getTask(id);

  sets.push("updated_at = ?");
  params.push(Date.now());
  params.push(id);

  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...(params as (string | number | null)[]));
  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id) as any;
  return Number(result.changes ?? 0) > 0;
}

// ── Status Transitions ──────────────────────────────────────────────────────

export function transitionTask(id: string, newStatus: TaskStatus, note?: string): Task | null {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!row) return null;

  const now = Date.now();
  const updates: string[] = ["status = ?", "updated_at = ?"];
  const params: unknown[] = [newStatus, now];

  if (newStatus === "running" && !row.started_at) {
    updates.push("started_at = ?");
    params.push(now);
  }
  if (newStatus === "done" || newStatus === "failed" || newStatus === "cancelled") {
    updates.push("completed_at = ?");
    params.push(now);
    // Reconcile: close any running task_runs so they don't become ghost slots
    db.prepare(
      "UPDATE task_runs SET status = 'cancelled', ended_at = ?, duration_ms = (? - started_at) WHERE task_id = ? AND status = 'running'"
    ).run(now, now, id);
  }

  params.push(id);
  db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...(params as (string | number | null)[]));

  // Log the transition
  addTaskUpdate(id, {
    author: "system",
    note: note ?? `Status changed to ${newStatus}`,
    status: newStatus,
  });

  return getTask(id);
}

export function queueTask(id: string): Task | null {
  const db = getMcDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!task) return null;

  const status = String(task.status);
  if (status !== "pending" && status !== "blocked") return getTask(id);

  // Check if all dependencies are done
  const unmetDeps = db.prepare(`
    SELECT td.depends_on_task_id
    FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_task_id
    WHERE td.task_id = ? AND t.status != 'done'
  `).all(id) as any[];

  if (unmetDeps.length > 0) {
    if (status !== "blocked") {
      transitionTask(id, "blocked", "Waiting on dependencies");
    }
    return getTask(id);
  }

  return transitionTask(id, "queued", "Dependencies satisfied, task queued");
}

export function cancelTask(id: string, reason?: string): Task | null {
  return transitionTask(id, "cancelled", reason ?? "Task cancelled");
}

export function retryTask(id: string): Task | null {
  const db = getMcDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!task || String(task.status) !== "failed") return null;

  db.prepare("UPDATE tasks SET retry_count = retry_count + 1, error_message = NULL, completed_at = NULL, updated_at = ? WHERE id = ?")
    .run(Date.now(), id);

  return transitionTask(id, "queued", "Task retried");
}

/** Re-evaluate all blocked tasks -- move to queued if deps are now satisfied */
export function checkBlockedTasks(): string[] {
  const db = getMcDb();
  const blocked = db.prepare("SELECT id FROM tasks WHERE status = 'blocked'").all() as any[];
  const promoted: string[] = [];

  for (const row of blocked) {
    const taskId = String(row.id);
    const unmet = db.prepare(`
      SELECT 1 FROM task_dependencies td
      JOIN tasks t ON t.id = td.depends_on_task_id
      WHERE td.task_id = ? AND t.status != 'done'
      LIMIT 1
    `).get(taskId);

    if (!unmet) {
      transitionTask(taskId, "queued", "Dependencies satisfied");
      promoted.push(taskId);
    }
  }

  return promoted;
}

/** Get queued tasks ready for execution, ordered by priority */
export function getQueuedTasks(limit: number): Task[] {
  const db = getMcDb();
  const priorityOrder = "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END";
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'queued'
      AND (scheduled_at IS NULL OR scheduled_at <= ?)
    ORDER BY ${priorityOrder} ASC, sort_order ASC, created_at ASC
    LIMIT ?
  `).all(Date.now(), limit) as any[];

  return rows.map(mapRowToTask);
}

// ── Task Updates ────────────────────────────────────────────────────────────

export function addTaskUpdate(taskId: string, data: {
  author?: string;
  note: string;
  status?: TaskStatus;
  link?: string;
  metadataJson?: string;
  metadata?: TaskUpdate["metadata"];
}): TaskUpdate {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();

  const metadataJson = data.metadataJson ?? (data.metadata ? JSON.stringify(data.metadata) : null);

  db.prepare(`
    INSERT INTO task_updates (id, task_id, author, note, status, link, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    taskId,
    data.author ?? "system",
    data.note,
    data.status ?? null,
    data.link ?? null,
    metadataJson,
    now,
  );

  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(now, taskId);

  return {
    id,
    taskId,
    author: data.author ?? "system",
    note: data.note,
    status: data.status,
    link: data.link,
    metadataJson: metadataJson ?? undefined,
    metadata: data.metadata,
    createdAt: now,
  };
}

// ── Task Runs ───────────────────────────────────────────────────────────────

export function createTaskRun(taskId: string, agentId: string): TaskRun {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();

  // Determine run number
  const lastRun = db.prepare(
    "SELECT MAX(run_number) as max_run FROM task_runs WHERE task_id = ?",
  ).get(taskId) as any;
  const runNumber = (lastRun?.max_run ?? 0) + 1;

  db.prepare(`
    INSERT INTO task_runs (id, task_id, agent_id, run_number, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).run(id, taskId, agentId, runNumber, now);

  return {
    id,
    taskId,
    agentId,
    runNumber,
    status: "running",
    startedAt: now,
  };
}

export function completeTaskRun(
  runId: string,
  result: { status: "completed" | "failed" | "timeout" | "cancelled"; error?: string; resultJson?: string },
): void {
  const db = getMcDb();
  const now = Date.now();
  const run = db.prepare("SELECT started_at FROM task_runs WHERE id = ?").get(runId) as any;
  const durationMs = run ? now - Number(run.started_at) : 0;

  db.prepare(`
    UPDATE task_runs
    SET status = ?, ended_at = ?, duration_ms = ?, error = ?, result_json = ?
    WHERE id = ?
  `).run(result.status, now, durationMs, result.error ?? null, result.resultJson ?? null, runId);
}

export function updateTaskRunSession(runId: string, sessionKey: string): void {
  const db = getMcDb();
  db.prepare("UPDATE task_runs SET session_key = ? WHERE id = ?").run(sessionKey, runId);
}

export function findEquivalentOpenWatchdogTask(params: {
  title: string;
  agentId: string;
  parentId?: string;
  tags?: string[];
}): Task | null {
  const tags = new Set((params.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean));
  const isWatchdogIncident = tags.has("mission-control-watchdog") || tags.has("watchdog") || tags.has("incident");
  if (!isWatchdogIncident) return null;

  const db = getMcDb();
  const rows = db.prepare(`
    SELECT * FROM tasks
    WHERE title = ?
      AND agent_id = ?
      AND status IN ('queued', 'running')
      AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)
    ORDER BY updated_at DESC
  `).all(params.title, params.agentId, params.parentId ?? null, params.parentId ?? null) as any[];

  for (const row of rows) {
    const taskTags = new Set(row.tags_json ? JSON.parse(String(row.tags_json)) : []);
    const sameTags = tags.size === taskTags.size && [...tags].every((tag) => taskTags.has(tag));
    if (sameTags) return mapRowToTask(row);
  }

  return null;
}

export function reconcileOpenTaskRuns(): {
  closedTerminalRuns: number;
  closedDuplicateRuns: number;
} {
  const db = getMcDb();
  const now = Date.now();

  const closedTerminal = db.prepare(`
    UPDATE task_runs
    SET status = 'cancelled', ended_at = ?, duration_ms = (? - started_at)
    WHERE status = 'running'
      AND task_id IN (
        SELECT id FROM tasks WHERE status IN ('done', 'failed', 'cancelled')
      )
  `).run(now, now) as any;

  // If multiple running rows exist for the same task, keep only the newest running row.
  const closedDuplicate = db.prepare(`
    UPDATE task_runs
    SET status = 'cancelled', ended_at = ?, duration_ms = (? - started_at),
        error = COALESCE(error, 'Reconciled duplicate running row')
    WHERE status = 'running'
      AND id NOT IN (
        SELECT tr.id
        FROM task_runs tr
        JOIN (
          SELECT task_id, MAX(started_at) AS max_started_at
          FROM task_runs
          WHERE status = 'running'
          GROUP BY task_id
        ) latest
          ON latest.task_id = tr.task_id
         AND latest.max_started_at = tr.started_at
        WHERE tr.status = 'running'
      )
      AND task_id IN (
        SELECT task_id
        FROM task_runs
        WHERE status = 'running'
        GROUP BY task_id
        HAVING COUNT(*) > 1
      )
  `).run(now, now) as any;

  return {
    closedTerminalRuns: Number(closedTerminal.changes ?? 0),
    closedDuplicateRuns: Number(closedDuplicate.changes ?? 0),
  };
}

export function getRunningTaskRuns(): TaskRun[] {
  const db = getMcDb();
  // Defense-in-depth: exclude runs whose parent task is already in a terminal state.
  // transitionTask() should close these, but this JOIN guards against any gap.
  const rows = db.prepare(`
    SELECT tr.* FROM task_runs tr
    JOIN tasks t ON t.id = tr.task_id
    WHERE tr.status = 'running'
      AND t.status NOT IN ('done', 'failed', 'cancelled')
  `).all() as any[];
  return rows.map(mapRowToRun);
}

export function incrementRetryCount(id: string): void {
  getMcDb().prepare("UPDATE tasks SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?").run(Date.now(), id);
}

/** Returns the active (running) task_run for a given task, if any. */
export function getRunningTaskRunForTask(taskId: string): TaskRun | null {
  const db = getMcDb();
  const row = db.prepare(
    "SELECT * FROM task_runs WHERE task_id = ? AND status = 'running' LIMIT 1",
  ).get(taskId) as any;
  return row ? mapRowToRun(row) : null;
}

export function findTaskRunBySession(sessionKey: string): TaskRun | null {
  const db = getMcDb();
  const row = db.prepare(
    "SELECT * FROM task_runs WHERE session_key = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
  ).get(sessionKey) as any;
  return row ? mapRowToRun(row) : null;
}

// ── Dependencies ────────────────────────────────────────────────────────────

export function addDependency(taskId: string, dependsOnTaskId: string): boolean {
  const db = getMcDb();
  try {
    db.prepare("INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)").run(taskId, dependsOnTaskId);
    // Re-evaluate task status
    const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as any;
    if (task && (String(task.status) === "pending" || String(task.status) === "queued")) {
      queueTask(taskId); // This will block it if the dep isn't done
    }
    return true;
  } catch {
    return false; // Already exists or invalid FK
  }
}

export function removeDependency(taskId: string, dependsOnTaskId: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?").run(taskId, dependsOnTaskId) as any;
  if (Number(result.changes ?? 0) > 0) {
    // Re-evaluate -- may unblock the task
    const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as any;
    if (task && String(task.status) === "blocked") {
      queueTask(taskId);
    }
    return true;
  }
  return false;
}

// ── Reorder ─────────────────────────────────────────────────────────────────

export function reorderTask(id: string, sortOrder: number): boolean {
  const db = getMcDb();
  const result = db.prepare("UPDATE tasks SET sort_order = ?, updated_at = ? WHERE id = ?").run(sortOrder, Date.now(), id) as any;
  return Number(result.changes ?? 0) > 0;
}

// ── Promote Scheduled Tasks ─────────────────────────────────────────────────

export function promoteScheduledTasks(): string[] {
  const db = getMcDb();
  const now = Date.now();
  const ready = db.prepare(`
    SELECT id FROM tasks
    WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
  `).all(now) as any[];

  const promoted: string[] = [];
  for (const row of ready) {
    const taskId = String(row.id);
    queueTask(taskId);
    promoted.push(taskId);
  }
  return promoted;
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getTaskStats(): {
  pending: number;
  queued: number;
  running: number;
  blocked: number;
  waitingApproval: number;
  done: number;
  failed: number;
} {
  const db = getMcDb();
  const rows = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all() as any[];
  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[String(row.status)] = Number(row.count);
  }
  return {
    pending: stats["pending"] ?? 0,
    queued: stats["queued"] ?? 0,
    running: stats["running"] ?? 0,
    blocked: stats["blocked"] ?? 0,
    waitingApproval: stats["waiting_approval"] ?? 0,
    done: stats["done"] ?? 0,
    failed: stats["failed"] ?? 0,
  };
}
