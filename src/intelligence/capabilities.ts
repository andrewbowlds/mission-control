import { randomUUID } from "node:crypto";
import { getMcDb } from "../mc-db.js";
import type { AgentCapability, Task } from "../types.js";

// ── Row Mapping ─────────────────────────────────────────────────────────────

function rowToCapability(r: any): AgentCapability {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    capability: String(r.capability),
    proficiency: Number(r.proficiency),
    sampleCount: Number(r.sample_count),
    totalSuccesses: Number(r.total_successes),
    totalFailures: Number(r.total_failures),
    avgDurationMs: r.avg_duration_ms != null ? Number(r.avg_duration_ms) : undefined,
    lastUpdatedAt: Number(r.last_updated_at),
    createdAt: Number(r.created_at),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listCapabilities(opts?: {
  agentId?: string;
  capability?: string;
}): AgentCapability[] {
  const db = getMcDb();
  const clauses: string[] = ["1=1"];
  const params: Record<string, string | number> = {};

  if (opts?.agentId) {
    clauses.push("agent_id = :agentId");
    params.agentId = opts.agentId;
  }
  if (opts?.capability) {
    clauses.push("capability = :capability");
    params.capability = opts.capability;
  }

  return (
    db
      .prepare(
        `SELECT * FROM agent_capabilities WHERE ${clauses.join(" AND ")} ORDER BY proficiency DESC`,
      )
      .all(params) as any[]
  ).map(rowToCapability);
}

export function getCapability(
  agentId: string,
  capability: string,
): AgentCapability | undefined {
  const db = getMcDb();
  const row = db
    .prepare(
      "SELECT * FROM agent_capabilities WHERE agent_id = ? AND capability = ?",
    )
    .get(agentId, capability) as any;
  return row ? rowToCapability(row) : undefined;
}

export function getAgentProfile(agentId: string): AgentCapability[] {
  return listCapabilities({ agentId });
}

// ── Learning ────────────────────────────────────────────────────────────────

/**
 * Extract capability tags from a task. Uses tags, task_type, and keywords
 * from title/description to identify what domains this task exercises.
 */
export function extractCapabilities(task: Task): string[] {
  const caps = new Set<string>();

  // Task type is always a capability
  caps.add(`type:${task.taskType}`);

  // Priority handling is a capability
  if (task.priority === "critical" || task.priority === "high") {
    caps.add("priority:urgent");
  }

  // Tags become capabilities
  for (const tag of task.tags) {
    caps.add(`tag:${tag}`);
  }

  // Extract keywords from title
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  const domainKeywords: Record<string, string[]> = {
    "domain:coding": ["code", "implement", "refactor", "debug", "fix bug", "function", "class", "api"],
    "domain:research": ["research", "investigate", "analyze", "find", "search", "look up"],
    "domain:writing": ["write", "draft", "compose", "document", "email", "message", "blog"],
    "domain:data": ["data", "database", "sql", "query", "csv", "spreadsheet", "report"],
    "domain:devops": ["deploy", "server", "infrastructure", "ci/cd", "docker", "kubernetes"],
    "domain:design": ["design", "ui", "ux", "layout", "mockup", "wireframe"],
    "domain:communication": ["email", "slack", "notify", "message", "call", "meeting"],
    "domain:finance": ["invoice", "payment", "billing", "budget", "expense", "revenue"],
  };

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((kw) => text.includes(kw))) {
      caps.add(domain);
    }
  }

  return Array.from(caps);
}

/**
 * Update agent proficiency based on task completion outcome.
 * Uses exponential moving average: new_prof = alpha * outcome + (1 - alpha) * old_prof
 * alpha decreases as sample count grows (more data = less volatile).
 */
export function recordOutcome(
  agentId: string,
  task: Task,
  success: boolean,
  durationMs?: number,
): void {
  const db = getMcDb();
  const capabilities = extractCapabilities(task);
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO agent_capabilities (id, agent_id, capability, proficiency, sample_count, total_successes, total_failures, avg_duration_ms, last_updated_at, created_at)
    VALUES (:id, :agentId, :cap, :prof, 1, :succ, :fail, :dur, :now, :now)
    ON CONFLICT(agent_id, capability) DO UPDATE SET
      proficiency = :newProf,
      sample_count = sample_count + 1,
      total_successes = total_successes + :succ,
      total_failures = total_failures + :fail,
      avg_duration_ms = CASE
        WHEN :dur IS NOT NULL AND avg_duration_ms IS NOT NULL
        THEN (avg_duration_ms * sample_count + :dur) / (sample_count + 1)
        WHEN :dur IS NOT NULL THEN :dur
        ELSE avg_duration_ms
      END,
      last_updated_at = :now
  `);

  for (const cap of capabilities) {
    const existing = getCapability(agentId, cap);
    const outcome = success ? 1.0 : 0.0;

    let newProf: number;
    if (existing) {
      // Alpha decreases with more samples (min 0.05, max 0.3)
      const alpha = Math.max(0.05, 0.3 / Math.sqrt(existing.sampleCount + 1));
      newProf = alpha * outcome + (1 - alpha) * existing.proficiency;
    } else {
      // First observation: start at 0.5 biased toward outcome
      newProf = 0.4 + 0.2 * outcome;
    }

    upsert.run({
      id: randomUUID(),
      agentId,
      cap,
      prof: newProf,
      newProf,
      succ: success ? 1 : 0,
      fail: success ? 0 : 1,
      dur: durationMs ?? null,
      now,
    });
  }
}

// ── Agent Scoring ──────────────────────────────────────────────────────────

/**
 * Score an agent for a given set of capability requirements.
 * Returns weighted average of proficiencies, with missing capabilities
 * scored at 0.3 (below neutral).
 */
export function scoreAgent(
  agentId: string,
  requiredCapabilities: string[],
): number {
  if (requiredCapabilities.length === 0) return 0.5;

  const profile = getAgentProfile(agentId);
  const capMap = new Map(profile.map((c) => [c.capability, c]));

  let totalScore = 0;
  let totalWeight = 0;

  for (const cap of requiredCapabilities) {
    const entry = capMap.get(cap);
    // Weight by sample count (more data = more reliable)
    const weight = entry ? Math.min(10, entry.sampleCount + 1) : 1;
    const score = entry ? entry.proficiency : 0.3; // unknown = below neutral
    totalScore += score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0.5;
}

/**
 * Get all unique agent IDs that have any capability records.
 */
export function getKnownAgentIds(): string[] {
  const db = getMcDb();
  const rows = db
    .prepare("SELECT DISTINCT agent_id FROM agent_capabilities ORDER BY agent_id")
    .all() as any[];
  return rows.map((r) => String(r.agent_id));
}

/**
 * Delete all capabilities for an agent (for reset/testing).
 */
export function resetAgentCapabilities(agentId: string): void {
  const db = getMcDb();
  db.prepare("DELETE FROM agent_capabilities WHERE agent_id = ?").run(agentId);
}
