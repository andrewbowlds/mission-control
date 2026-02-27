import { randomUUID } from "node:crypto";
import { getMcDb } from "../mc-db.js";
import type { RoutingRule, RoutingRuleType, Task, AgentRecommendation } from "../types.js";
import {
  extractCapabilities,
  scoreAgent,
  getKnownAgentIds,
} from "./capabilities.js";

// ── Row Mapping ─────────────────────────────────────────────────────────────

function rowToRule(r: any): RoutingRule {
  return {
    id: String(r.id),
    name: String(r.name),
    ruleType: String(r.rule_type) as RoutingRuleType,
    matchConfigJson: String(r.match_config_json),
    preferredAgentId: String(r.preferred_agent_id),
    confidence: Number(r.confidence),
    enabled: Boolean(r.enabled),
    override: Boolean(r.override),
    fireCount: Number(r.fire_count),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

// ── Rule CRUD ───────────────────────────────────────────────────────────────

export function listRoutingRules(opts?: { enabled?: boolean }): RoutingRule[] {
  const db = getMcDb();
  const clauses: string[] = ["1=1"];
  const params: Record<string, string | number> = {};

  if (opts?.enabled !== undefined) {
    clauses.push("enabled = :enabled");
    params.enabled = opts.enabled ? 1 : 0;
  }

  return (
    db
      .prepare(
        `SELECT * FROM routing_rules WHERE ${clauses.join(" AND ")} ORDER BY confidence DESC, created_at ASC`,
      )
      .all(params) as any[]
  ).map(rowToRule);
}

export function getRoutingRule(id: string): RoutingRule | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM routing_rules WHERE id = ?").get(id) as any;
  return row ? rowToRule(row) : undefined;
}

export function createRoutingRule(data: {
  name: string;
  ruleType: RoutingRuleType;
  matchConfigJson: string;
  preferredAgentId: string;
  confidence?: number;
  override?: boolean;
}): RoutingRule {
  const db = getMcDb();
  const now = Date.now();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO routing_rules (id, name, rule_type, match_config_json, preferred_agent_id, confidence, override, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.ruleType,
    data.matchConfigJson,
    data.preferredAgentId,
    data.confidence ?? 0.5,
    data.override ? 1 : 0,
    now,
    now,
  );

  return getRoutingRule(id)!;
}

export function updateRoutingRule(
  id: string,
  patch: Partial<{
    name: string;
    ruleType: RoutingRuleType;
    matchConfigJson: string;
    preferredAgentId: string;
    confidence: number;
    enabled: boolean;
    override: boolean;
  }>,
): RoutingRule | undefined {
  const db = getMcDb();
  const sets: string[] = ["updated_at = :now"];
  const params: Record<string, string | number> = { id, now: Date.now() };

  if (patch.name !== undefined) { sets.push("name = :name"); params.name = patch.name; }
  if (patch.ruleType !== undefined) { sets.push("rule_type = :ruleType"); params.ruleType = patch.ruleType; }
  if (patch.matchConfigJson !== undefined) { sets.push("match_config_json = :matchConfig"); params.matchConfig = patch.matchConfigJson; }
  if (patch.preferredAgentId !== undefined) { sets.push("preferred_agent_id = :agentId"); params.agentId = patch.preferredAgentId; }
  if (patch.confidence !== undefined) { sets.push("confidence = :confidence"); params.confidence = patch.confidence; }
  if (patch.enabled !== undefined) { sets.push("enabled = :enabled"); params.enabled = patch.enabled ? 1 : 0; }
  if (patch.override !== undefined) { sets.push("override = :override"); params.override = patch.override ? 1 : 0; }

  db.prepare(`UPDATE routing_rules SET ${sets.join(", ")} WHERE id = :id`).run(params);
  return getRoutingRule(id);
}

export function deleteRoutingRule(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM routing_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

// ── Rule Matching ──────────────────────────────────────────────────────────

type MatchConfig = {
  keywords?: string[];
  tags?: string[];
  priorities?: string[];
  taskTypes?: string[];
};

function parseMatchConfig(json: string): MatchConfig {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function ruleMatchesTask(rule: RoutingRule, task: Task): boolean {
  const config = parseMatchConfig(rule.matchConfigJson);
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();

  switch (rule.ruleType) {
    case "keyword":
      return (config.keywords ?? []).some((kw) => text.includes(kw.toLowerCase()));

    case "tag":
      return (config.tags ?? []).some((t) => task.tags.includes(t));

    case "priority":
      return (config.priorities ?? []).includes(task.priority);

    case "task_type":
      return (config.taskTypes ?? []).includes(task.taskType);

    default:
      return false;
  }
}

// ── Recommendation Engine ──────────────────────────────────────────────────

/**
 * Recommend the best agent(s) for a given task.
 * Combines routing rules (explicit) with capability scoring (learned).
 *
 * Returns ranked list of recommendations, highest score first.
 */
export function recommendAgents(
  task: Task,
  opts?: { topN?: number },
): AgentRecommendation[] {
  const db = getMcDb();
  const topN = opts?.topN ?? 5;
  const recommendations = new Map<string, { score: number; reasons: string[] }>();

  // 1. Check override rules first (explicit hard routing)
  const rules = listRoutingRules({ enabled: true });
  for (const rule of rules) {
    if (!ruleMatchesTask(rule, task)) continue;

    const agentId = rule.preferredAgentId;
    const existing = recommendations.get(agentId) ?? { score: 0, reasons: [] };

    if (rule.override) {
      // Override rule: this agent wins immediately
      return [{
        agentId,
        score: 1.0,
        reason: `Override rule: ${rule.name}`,
      }];
    }

    // Non-override rule: boost score
    existing.score += rule.confidence * 0.4;
    existing.reasons.push(`Rule: ${rule.name}`);
    recommendations.set(agentId, existing);

    // Increment fire count
    db.prepare("UPDATE routing_rules SET fire_count = fire_count + 1 WHERE id = ?").run(rule.id);
  }

  // 2. Score all known agents by capability proficiency
  const requiredCaps = extractCapabilities(task);
  const knownAgents = getKnownAgentIds();

  for (const agentId of knownAgents) {
    const capScore = scoreAgent(agentId, requiredCaps);
    const existing = recommendations.get(agentId) ?? { score: 0, reasons: [] };

    existing.score += capScore * 0.6; // capability is 60% of total weight
    existing.reasons.push(`Proficiency: ${Math.round(capScore * 100)}%`);
    recommendations.set(agentId, existing);
  }

  // 3. Sort by score and return top N
  const sorted = Array.from(recommendations.entries())
    .map(([agentId, { score, reasons }]) => ({
      agentId,
      score: Math.round(score * 100) / 100,
      reason: reasons.join("; "),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return sorted;
}

/**
 * Get the single best agent recommendation, or undefined if no data.
 */
export function recommendBestAgent(task: Task): AgentRecommendation | undefined {
  const results = recommendAgents(task, { topN: 1 });
  return results[0];
}
