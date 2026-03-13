import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import { listTasks } from "./task-engine.js";
import { getAgentPerformance } from "./analytics-engine.js";
import type { Task, TaskStatus } from "./types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type DailyBriefing = {
  id: string;
  agentId: string;
  date: string;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  summaryMd: string;
  generatedAt: number;
};

// ── Row Mapping ──────────────────────────────────────────────────────────────

function mapRow(row: any): DailyBriefing {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    date: String(row.date),
    completedCount: Number(row.completed_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    summaryMd: String(row.summary_md),
    generatedAt: Number(row.generated_at),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get epoch ms for start of a YYYY-MM-DD date (local time). */
function dayStartMs(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getTime();
}

/** Get epoch ms for end of a YYYY-MM-DD date (local time). */
function dayEndMs(dateStr: string): number {
  return new Date(dateStr + "T23:59:59.999").getTime();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, normal: 2, low: 3,
};

function prioritySort(a: Task, b: Task): number {
  return (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
}

const MAX_COMPLETED_SHOWN = 10;
const MAX_OPEN_SHOWN = 10;

// ── Briefing Generation ──────────────────────────────────────────────────────

/**
 * Generate a daily briefing for a single agent.
 * `date` is the day to summarize (YYYY-MM-DD), typically yesterday.
 */
export function generateBriefing(agentId: string, date: string): DailyBriefing {
  const db = getMcDb();
  const from = dayStartMs(date);
  const to = dayEndMs(date);

  // Tasks completed on the target date
  const completedTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE agent_id = ? AND status = 'done'
      AND completed_at >= ? AND completed_at <= ?
    ORDER BY completed_at DESC
  `).all(agentId, from, to) as any[];

  // Tasks that failed on the target date
  const failedTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE agent_id = ? AND status = 'failed'
      AND updated_at >= ? AND updated_at <= ?
    ORDER BY updated_at DESC
  `).all(agentId, from, to) as any[];

  // Average duration of completed runs on the target date
  const durationRow = db.prepare(`
    SELECT AVG(duration_ms) as avg_dur FROM task_runs
    WHERE agent_id = ? AND status = 'completed'
      AND ended_at >= ? AND ended_at <= ?
  `).get(agentId, from, to) as any;
  const avgDurMs = Math.round(Number(durationRow?.avg_dur ?? 0));

  // Currently open tasks for this agent (any date)
  const openStatuses: TaskStatus[] = ["pending", "queued", "running", "blocked", "waiting_approval"];
  const openTasks = listTasks({ agentId, status: openStatuses });
  openTasks.sort(prioritySort);

  // 7-day performance for metrics line
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const perfRows = getAgentPerformance({ from: sevenDaysAgo });
  const perf = perfRows.find((p) => p.agentId === agentId);

  // Build markdown
  const lines: string[] = [];
  lines.push(`## Your Daily Briefing (${todayStr()})`);
  lines.push("");

  // Yesterday's results
  lines.push(`### Yesterday (${date})`);
  if (completedTasks.length === 0 && failedTasks.length === 0) {
    lines.push("- No tasks completed or failed.");
  } else {
    if (completedTasks.length > 0) {
      const durStr = avgDurMs > 0 ? ` (avg ${formatDuration(avgDurMs)})` : "";
      lines.push(`- Completed: ${completedTasks.length} task${completedTasks.length !== 1 ? "s" : ""}${durStr}`);
      const shown = completedTasks.slice(0, MAX_COMPLETED_SHOWN);
      for (const t of shown) {
        lines.push(`  - "${t.title}"`);
      }
      if (completedTasks.length > MAX_COMPLETED_SHOWN) {
        lines.push(`  - + ${completedTasks.length - MAX_COMPLETED_SHOWN} more`);
      }
    }
    if (failedTasks.length > 0) {
      lines.push(`- Failed: ${failedTasks.length} task${failedTasks.length !== 1 ? "s" : ""}`);
      for (const t of failedTasks) {
        const err = t.error_message ? ` — ${String(t.error_message).slice(0, 80)}` : "";
        const canRetry = Number(t.retry_count ?? 0) < Number(t.max_retries ?? 2) ? " (retry available)" : "";
        lines.push(`  - "${t.title}"${err}${canRetry}`);
      }
    }
  }
  lines.push("");

  // Open work
  if (openTasks.length > 0) {
    lines.push(`### Open Work (${openTasks.length} task${openTasks.length !== 1 ? "s" : ""})`);
    const shown = openTasks.slice(0, MAX_OPEN_SHOWN);
    for (const t of shown) {
      lines.push(`- [${t.priority}] "${t.title}" (${t.status})`);
    }
    if (openTasks.length > MAX_OPEN_SHOWN) {
      lines.push(`- + ${openTasks.length - MAX_OPEN_SHOWN} more`);
    }
  } else {
    lines.push("### Open Work");
    lines.push("- No pending tasks.");
  }
  lines.push("");

  // Key metrics
  if (perf) {
    const avgStr = perf.avgDurationMs > 0 ? ` | Avg task time: ${formatDuration(perf.avgDurationMs)}` : "";
    lines.push(`### Key Metrics (7d)`);
    lines.push(`- Success rate: ${perf.successRate}% | Completed: ${perf.tasksCompleted} | Failed: ${perf.tasksFailed}${avgStr}`);
  }

  const summaryMd = lines.join("\n");
  const now = Date.now();

  // Upsert into daily_briefings
  db.prepare(`
    INSERT INTO daily_briefings (id, agent_id, date, completed_count, failed_count, pending_count, summary_md, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, date) DO UPDATE SET
      completed_count = excluded.completed_count,
      failed_count = excluded.failed_count,
      pending_count = excluded.pending_count,
      summary_md = excluded.summary_md,
      generated_at = excluded.generated_at
  `).run(
    randomUUID(), agentId, date,
    completedTasks.length, failedTasks.length, openTasks.length,
    summaryMd, now,
  );

  return {
    id: randomUUID(),
    agentId,
    date,
    completedCount: completedTasks.length,
    failedCount: failedTasks.length,
    pendingCount: openTasks.length,
    summaryMd,
    generatedAt: now,
  };
}

/**
 * Generate briefings for all agents that have any tasks.
 */
export function generateAllBriefings(date?: string): DailyBriefing[] {
  const db = getMcDb();
  const targetDate = date ?? yesterday();

  // Get all distinct agent IDs that have tasks
  const rows = db.prepare("SELECT DISTINCT agent_id FROM tasks").all() as any[];
  const results: DailyBriefing[] = [];

  for (const row of rows) {
    try {
      results.push(generateBriefing(String(row.agent_id), targetDate));
    } catch (err) {
      console.error(`[briefing] failed to generate for ${row.agent_id}:`, err);
    }
  }

  return results;
}

// ── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Get the latest briefing for an agent (today or yesterday).
 */
export function getLatestBriefing(agentId: string): DailyBriefing | null {
  const db = getMcDb();
  const row = db.prepare(`
    SELECT * FROM daily_briefings
    WHERE agent_id = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(agentId) as any;

  return row ? mapRow(row) : null;
}

/**
 * Get briefing for a specific agent and date.
 */
export function getBriefing(agentId: string, date: string): DailyBriefing | null {
  const db = getMcDb();
  const row = db.prepare(
    "SELECT * FROM daily_briefings WHERE agent_id = ? AND date = ?",
  ).get(agentId, date) as any;

  return row ? mapRow(row) : null;
}

/**
 * Get briefing history for an agent.
 */
export function getBriefingHistory(agentId: string, limit = 7): DailyBriefing[] {
  const db = getMcDb();
  const rows = db.prepare(`
    SELECT * FROM daily_briefings
    WHERE agent_id = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(agentId, limit) as any[];

  return rows.map(mapRow);
}

/**
 * Returns a compact briefing string for injection into agent system prompt.
 * If no cached briefing exists, generates a live one from current data.
 */
export function getBriefingContext(agentId: string): string {
  // Try cached briefing first (today's or yesterday's)
  let briefing = getLatestBriefing(agentId);

  // If no cached briefing, generate a live one for yesterday
  if (!briefing) {
    try {
      briefing = generateBriefing(agentId, yesterday());
    } catch {
      return "";
    }
  }

  // Skip if the briefing is empty/trivial
  if (briefing.completedCount === 0 && briefing.failedCount === 0 && briefing.pendingCount === 0) {
    return "";
  }

  return briefing.summaryMd;
}

// ── Scheduled Generation ─────────────────────────────────────────────────────

let lastBriefingDate = "";

/**
 * Called from the execution engine tick loop.
 * Generates briefings once per day after 6 AM local time.
 */
export function maybeTriggerDailyBriefings(): void {
  const today = todayStr();
  if (today === lastBriefingDate) return;

  const hour = new Date().getHours();
  if (hour < 6) return;

  lastBriefingDate = today;
  try {
    const results = generateAllBriefings(yesterday());
    if (results.length > 0) {
      console.log(`[briefing] generated ${results.length} daily briefings for ${yesterday()}`);
    }
  } catch (err) {
    console.error("[briefing] daily generation failed:", err);
    // Reset so it retries next tick
    lastBriefingDate = "";
  }
}
