import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import { createTask, getTask, transitionTask } from "./task-engine.js";
import { instantiateTemplate, getTemplate } from "./template-store.js";
import type {
  Workflow,
  WorkflowStep,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowTriggerType,
  WorkflowStepFailureAction,
  WorkflowRunStatus,
  Task,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(json: string | null | undefined, fallback: any = {}): any {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function rowToWorkflow(row: any, steps: WorkflowStep[] = []): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    triggerType: row.trigger_type as WorkflowTriggerType,
    triggerConfigJson: row.trigger_config_json ?? "{}",
    enabled: Boolean(row.enabled),
    cronJobId: row.cron_job_id ?? undefined,
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToStep(row: any): WorkflowStep {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    stepOrder: row.step_order,
    name: row.name,
    templateId: row.template_id ?? undefined,
    inlineConfigJson: row.inline_config_json ?? undefined,
    conditionJson: row.condition_json ?? undefined,
    onFailure: row.on_failure as WorkflowStepFailureAction,
    retryCount: row.retry_count,
    timeoutMs: row.timeout_ms ?? undefined,
    contextOverridesJson: row.context_overrides_json ?? "{}",
    createdAt: row.created_at,
  };
}

function rowToRun(row: any, steps: WorkflowRunStep[] = []): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowRunStatus,
    triggerSource: row.trigger_source ?? undefined,
    contextJson: row.context_json ?? "{}",
    currentStep: row.current_step,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    error: row.error ?? undefined,
    steps,
  };
}

function rowToRunStep(row: any): WorkflowRunStep {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    taskId: row.task_id ?? undefined,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    error: row.error ?? undefined,
    resultJson: row.result_json ?? undefined,
  };
}

function getStepsForWorkflow(workflowId: string): WorkflowStep[] {
  const db = getMcDb();
  const rows = db.prepare(
    "SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC",
  ).all(workflowId) as any[];
  return rows.map(rowToStep);
}

function getRunSteps(runId: string): WorkflowRunStep[] {
  const db = getMcDb();
  const rows = db.prepare(
    "SELECT * FROM workflow_run_steps WHERE run_id = ? ORDER BY rowid ASC",
  ).all(runId) as any[];
  return rows.map(rowToRunStep);
}

// ── Workflow CRUD ────────────────────────────────────────────────────────────

export function listWorkflows(): Workflow[] {
  const db = getMcDb();
  const rows = db.prepare("SELECT * FROM workflows ORDER BY name ASC").all() as any[];
  return rows.map((r) => rowToWorkflow(r, getStepsForWorkflow(r.id)));
}

export function getWorkflow(id: string): Workflow | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return rowToWorkflow(row, getStepsForWorkflow(id));
}

export function createWorkflow(data: {
  name: string;
  description?: string;
  triggerType?: WorkflowTriggerType;
  triggerConfigJson?: string;
  enabled?: boolean;
}): Workflow {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO workflows (id, name, description, trigger_type, trigger_config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.description ?? null,
    data.triggerType ?? "manual",
    data.triggerConfigJson ?? "{}",
    data.enabled !== false ? 1 : 0,
    now,
    now,
  );
  return getWorkflow(id)!;
}

export function updateWorkflow(
  id: string,
  patch: {
    name?: string;
    description?: string;
    triggerType?: WorkflowTriggerType;
    triggerConfigJson?: string;
    enabled?: boolean;
    cronJobId?: string | null;
  },
): Workflow | undefined {
  const db = getMcDb();
  const existing = getWorkflow(id);
  if (!existing) return undefined;

  const name = patch.name ?? existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const triggerType = patch.triggerType ?? existing.triggerType;
  const triggerConfigJson = patch.triggerConfigJson ?? existing.triggerConfigJson;
  const enabled = patch.enabled !== undefined ? patch.enabled : existing.enabled;
  const cronJobId = patch.cronJobId !== undefined ? patch.cronJobId : existing.cronJobId;

  db.prepare(`
    UPDATE workflows SET name = ?, description = ?, trigger_type = ?, trigger_config_json = ?,
      enabled = ?, cron_job_id = ?, updated_at = ?
    WHERE id = ?
  `).run(name, description ?? null, triggerType, triggerConfigJson, enabled ? 1 : 0, cronJobId ?? null, Date.now(), id);
  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Step CRUD ────────────────────────────────────────────────────────────────

export function addStep(workflowId: string, data: {
  name: string;
  templateId?: string;
  inlineConfigJson?: string;
  conditionJson?: string;
  onFailure?: WorkflowStepFailureAction;
  retryCount?: number;
  timeoutMs?: number;
  contextOverridesJson?: string;
}): WorkflowStep | undefined {
  const db = getMcDb();
  const wf = getWorkflow(workflowId);
  if (!wf) return undefined;

  const id = randomUUID();
  const maxOrder = db.prepare(
    "SELECT COALESCE(MAX(step_order), -1) as mo FROM workflow_steps WHERE workflow_id = ?",
  ).get(workflowId) as any;
  const stepOrder = (maxOrder?.mo ?? -1) + 1;

  db.prepare(`
    INSERT INTO workflow_steps (id, workflow_id, step_order, name, template_id, inline_config_json,
      condition_json, on_failure, retry_count, timeout_ms, context_overrides_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workflowId, stepOrder, data.name,
    data.templateId ?? null, data.inlineConfigJson ?? null,
    data.conditionJson ?? null, data.onFailure ?? "stop",
    data.retryCount ?? 0, data.timeoutMs ?? null,
    data.contextOverridesJson ?? "{}", Date.now(),
  );
  return rowToStep(db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(id) as any);
}

export function updateStep(stepId: string, patch: {
  name?: string;
  templateId?: string | null;
  inlineConfigJson?: string | null;
  conditionJson?: string | null;
  onFailure?: WorkflowStepFailureAction;
  retryCount?: number;
  timeoutMs?: number | null;
  contextOverridesJson?: string;
}): WorkflowStep | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(stepId) as any;
  if (!row) return undefined;
  const existing = rowToStep(row);

  db.prepare(`
    UPDATE workflow_steps SET name = ?, template_id = ?, inline_config_json = ?,
      condition_json = ?, on_failure = ?, retry_count = ?, timeout_ms = ?, context_overrides_json = ?
    WHERE id = ?
  `).run(
    patch.name ?? existing.name,
    patch.templateId !== undefined ? patch.templateId : existing.templateId ?? null,
    patch.inlineConfigJson !== undefined ? patch.inlineConfigJson : existing.inlineConfigJson ?? null,
    patch.conditionJson !== undefined ? patch.conditionJson : existing.conditionJson ?? null,
    patch.onFailure ?? existing.onFailure,
    patch.retryCount ?? existing.retryCount,
    patch.timeoutMs !== undefined ? patch.timeoutMs : existing.timeoutMs ?? null,
    patch.contextOverridesJson ?? existing.contextOverridesJson,
    stepId,
  );
  return rowToStep(db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(stepId) as any);
}

export function removeStep(stepId: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM workflow_steps WHERE id = ?").run(stepId);
  return result.changes > 0;
}

export function reorderSteps(workflowId: string, stepIds: string[]): boolean {
  const db = getMcDb();
  const update = db.prepare("UPDATE workflow_steps SET step_order = ? WHERE id = ? AND workflow_id = ?");
  for (let i = 0; i < stepIds.length; i++) {
    update.run(i, stepIds[i], workflowId);
  }
  return true;
}

// ── Run CRUD ─────────────────────────────────────────────────────────────────

export function listRuns(filter?: { workflowId?: string; status?: string; limit?: number }): WorkflowRun[] {
  const db = getMcDb();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.workflowId) { clauses.push("workflow_id = ?"); params.push(filter.workflowId); }
  if (filter?.status) { clauses.push("status = ?"); params.push(filter.status); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter?.limit ?? 50;
  const rows = db.prepare(
    `SELECT * FROM workflow_runs ${where} ORDER BY started_at DESC LIMIT ?`,
  ).all(...(params as (string | number | null)[]), limit) as any[];
  return rows.map((r) => rowToRun(r, getRunSteps(r.id)));
}

export function getRun(id: string): WorkflowRun | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  return rowToRun(row, getRunSteps(id));
}

export function cancelRun(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare(
    "UPDATE workflow_runs SET status = 'cancelled', ended_at = ? WHERE id = ? AND status = 'running'",
  ).run(Date.now(), id);
  return result.changes > 0;
}

// ── Workflow Execution ───────────────────────────────────────────────────────

/**
 * Start a new workflow run. Creates the run record and kicks off step 0.
 */
export function startWorkflow(
  workflowId: string,
  opts?: { triggerSource?: string; contextJson?: string },
): WorkflowRun | undefined {
  const db = getMcDb();
  const workflow = getWorkflow(workflowId);
  if (!workflow || !workflow.enabled) return undefined;
  if (workflow.steps.length === 0) return undefined;

  const runId = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, status, trigger_source, context_json, current_step, started_at)
    VALUES (?, ?, 'running', ?, ?, 0, ?)
  `).run(runId, workflowId, opts?.triggerSource ?? "manual", opts?.contextJson ?? "{}", now);

  // Create run step records for all steps
  for (const step of workflow.steps) {
    db.prepare(`
      INSERT INTO workflow_run_steps (id, run_id, step_id, status)
      VALUES (?, ?, ?, 'pending')
    `).run(randomUUID(), runId, step.id);
  }

  // Execute the first step
  const run = getRun(runId)!;
  executeNextStep(run, workflow);
  return getRun(runId);
}

/**
 * Advance a workflow run after a task completes or fails.
 * Called from the agent_end hook when a workflow-linked task finishes.
 */
export function advanceWorkflowRun(runId: string): void {
  const db = getMcDb();
  const run = getRun(runId);
  if (!run || run.status !== "running") return;

  const workflow = getWorkflow(run.workflowId);
  if (!workflow) return;

  // Find the current running step
  const currentRunStep = run.steps.find((s) => s.status === "running");
  if (!currentRunStep) return;

  // Get the linked task to check its status
  if (currentRunStep.taskId) {
    const task = getTask(currentRunStep.taskId);
    if (!task) return;

    if (task.status === "done") {
      // Step succeeded -- merge result into run context
      const runContext = parseJson(run.contextJson);
      if (task.resultJson) {
        try { runContext[`step_${run.currentStep}`] = JSON.parse(task.resultJson); } catch {}
      }
      db.prepare(
        "UPDATE workflow_run_steps SET status = 'completed', ended_at = ? WHERE id = ?",
      ).run(Date.now(), currentRunStep.id);
      db.prepare(
        "UPDATE workflow_runs SET context_json = ?, current_step = ? WHERE id = ?",
      ).run(JSON.stringify(runContext), run.currentStep + 1, runId);

      // Execute next step
      const updatedRun = getRun(runId)!;
      executeNextStep(updatedRun, workflow);
    } else if (task.status === "failed" || task.status === "cancelled") {
      const stepDef = workflow.steps.find((s) => s.id === currentRunStep.stepId);
      const onFailure = stepDef?.onFailure ?? "stop";

      db.prepare(
        "UPDATE workflow_run_steps SET status = 'failed', error = ?, ended_at = ? WHERE id = ?",
      ).run(task.errorMessage ?? "Task failed", Date.now(), currentRunStep.id);

      if (onFailure === "stop") {
        db.prepare(
          "UPDATE workflow_runs SET status = 'failed', error = ?, ended_at = ? WHERE id = ?",
        ).run(`Step "${stepDef?.name}" failed: ${task.errorMessage ?? "unknown"}`, Date.now(), runId);
      } else if (onFailure === "skip") {
        db.prepare(
          "UPDATE workflow_runs SET current_step = ? WHERE id = ?",
        ).run(run.currentStep + 1, runId);
        const updatedRun = getRun(runId)!;
        executeNextStep(updatedRun, workflow);
      } else if (onFailure === "retry" && stepDef) {
        // Retry by re-executing the same step
        const retryRunStep = db.prepare(
          "SELECT COUNT(*) as c FROM workflow_run_steps WHERE run_id = ? AND step_id = ? AND status = 'failed'",
        ).get(runId, currentRunStep.stepId) as any;
        if ((retryRunStep?.c ?? 0) <= stepDef.retryCount) {
          const updatedRun = getRun(runId)!;
          executeStepAtIndex(updatedRun, workflow, run.currentStep);
        } else {
          db.prepare(
            "UPDATE workflow_runs SET status = 'failed', error = ?, ended_at = ? WHERE id = ?",
          ).run(`Step "${stepDef.name}" failed after ${stepDef.retryCount} retries`, Date.now(), runId);
        }
      }
    }
    // If task is still running, do nothing -- wait for next advanceWorkflowRun call
  }
}

/**
 * Find the workflow run that a task belongs to (if any).
 * Returns the run ID or undefined.
 */
export function findRunForTask(taskId: string): string | undefined {
  const db = getMcDb();
  const row = db.prepare(
    "SELECT run_id FROM workflow_run_steps WHERE task_id = ? AND status = 'running' LIMIT 1",
  ).get(taskId) as any;
  return row?.run_id;
}

/**
 * Get the last run start time for a workflow (used for cron trigger dedup).
 */
export function getLastRunStartTime(workflowId: string): number | undefined {
  const db = getMcDb();
  const row = db.prepare(
    "SELECT MAX(started_at) as last FROM workflow_runs WHERE workflow_id = ?",
  ).get(workflowId) as any;
  return row?.last ?? undefined;
}

/**
 * List workflows that have cron triggers (for tick polling).
 */
export function getCronTriggeredWorkflows(): Workflow[] {
  const db = getMcDb();
  const rows = db.prepare(
    "SELECT * FROM workflows WHERE trigger_type = 'cron' AND enabled = 1 AND cron_job_id IS NOT NULL",
  ).all() as any[];
  return rows.map((r) => rowToWorkflow(r, getStepsForWorkflow(r.id)));
}

// ── Internal Step Execution ──────────────────────────────────────────────────

function executeNextStep(run: WorkflowRun, workflow: Workflow): void {
  if (run.currentStep >= workflow.steps.length) {
    // All steps complete
    const db = getMcDb();
    db.prepare(
      "UPDATE workflow_runs SET status = 'completed', ended_at = ? WHERE id = ?",
    ).run(Date.now(), run.id);
    return;
  }

  executeStepAtIndex(run, workflow, run.currentStep);
}

function executeStepAtIndex(run: WorkflowRun, workflow: Workflow, stepIndex: number): void {
  const db = getMcDb();
  const stepDef = workflow.steps[stepIndex];
  if (!stepDef) {
    db.prepare(
      "UPDATE workflow_runs SET status = 'completed', ended_at = ? WHERE id = ?",
    ).run(Date.now(), run.id);
    return;
  }

  // Evaluate condition
  if (stepDef.conditionJson) {
    const runContext = parseJson(run.contextJson);
    if (!evaluateCondition(parseJson(stepDef.conditionJson), runContext)) {
      // Skip this step
      const runStep = run.steps.find((s) => s.stepId === stepDef.id && s.status === "pending");
      if (runStep) {
        db.prepare(
          "UPDATE workflow_run_steps SET status = 'skipped', ended_at = ? WHERE id = ?",
        ).run(Date.now(), runStep.id);
      }
      db.prepare("UPDATE workflow_runs SET current_step = ? WHERE id = ?").run(stepIndex + 1, run.id);
      const updatedRun = getRun(run.id)!;
      executeNextStep(updatedRun, workflow);
      return;
    }
  }

  // Create task from template or inline config
  let task: Task | undefined;
  const overrides = parseJson(stepDef.contextOverridesJson);

  if (stepDef.templateId) {
    task = instantiateTemplate(stepDef.templateId, {
      title: `[${workflow.name}] ${stepDef.name}`,
      contextJson: Object.keys(overrides).length > 0 ? JSON.stringify(overrides) : undefined,
    });
  } else if (stepDef.inlineConfigJson) {
    const config = parseJson(stepDef.inlineConfigJson);
    task = createTask({
      title: `[${workflow.name}] ${stepDef.name}`,
      agentId: config.agentId ?? "default",
      description: config.description,
      priority: config.priority ?? "normal",
      taskType: "automated",
      executionMode: config.executionMode ?? "agent",
      maxRetries: config.maxRetries ?? 2,
      timeoutMs: stepDef.timeoutMs ?? config.timeoutMs,
      requiresApproval: config.requiresApproval ?? false,
      tags: config.tags ?? [],
      contextJson: JSON.stringify({ ...parseJson(config.contextJson), ...overrides }),
    });
  }

  if (!task) {
    // Can't create task -- fail the step
    const runStep = run.steps.find((s) => s.stepId === stepDef.id && s.status === "pending");
    if (runStep) {
      db.prepare(
        "UPDATE workflow_run_steps SET status = 'failed', error = ?, ended_at = ? WHERE id = ?",
      ).run("Failed to create task (missing template or config)", Date.now(), runStep.id);
    }
    db.prepare(
      "UPDATE workflow_runs SET status = 'failed', error = ?, ended_at = ? WHERE id = ?",
    ).run(`Step "${stepDef.name}": failed to create task`, Date.now(), run.id);
    return;
  }

  // Queue the task for execution
  transitionTask(task.id, "queued", `Workflow step: ${stepDef.name}`);

  // Update the run step record
  const runStep = run.steps.find((s) => s.stepId === stepDef.id && s.status === "pending");
  if (runStep) {
    db.prepare(
      "UPDATE workflow_run_steps SET status = 'running', task_id = ?, started_at = ? WHERE id = ?",
    ).run(task.id, Date.now(), runStep.id);
  }
}

function evaluateCondition(condition: any, context: any): boolean {
  if (!condition || typeof condition !== "object") return true;
  const { field, op, value } = condition;
  if (!field || !op) return true;

  const actual = field.split(".").reduce((obj: any, key: string) => obj?.[key], context);

  switch (op) {
    case "eq": return actual === value;
    case "neq": return actual !== value;
    case "truthy": return Boolean(actual);
    case "falsy": return !actual;
    case "contains":
      return typeof actual === "string" ? actual.includes(String(value)) :
        Array.isArray(actual) ? actual.includes(value) : false;
    default: return true;
  }
}
