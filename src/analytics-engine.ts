import { getMcDb } from "./mc-db.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type TimeRange = { from?: number; to?: number };

export type OverviewMetrics = {
  totalTasks: number;
  completed: number;
  failed: number;
  inProgress: number;
  queued: number;
  blocked: number;
  avgCompletionMs: number;
  approvalRate: number;
};

export type ThroughputBucket = {
  bucket: number;
  created: number;
  completed: number;
};

export type AgentPerformance = {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  successRate: number;
};

export type DurationBucket = {
  label: string;
  count: number;
};

export type PriorityDist = {
  priority: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
};

export type WorkflowAnalytics = {
  workflowId: string;
  name: string;
  totalRuns: number;
  completed: number;
  failed: number;
  avgDurationMs: number;
};

export type SlaReport = {
  total: number;
  metDeadline: number;
  missedDeadline: number;
  noDeadline: number;
  complianceRate: number;
};

export type TagBreakdown = {
  tag: string;
  count: number;
  completed: number;
  failed: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function rangeClause(col: string, range?: TimeRange): { clause: string; params: Record<string, number> } {
  const parts: string[] = [];
  const params: Record<string, number> = {};
  if (range?.from) {
    parts.push(`${col} >= :rangeFrom`);
    params.rangeFrom = range.from;
  }
  if (range?.to) {
    parts.push(`${col} <= :rangeTo`);
    params.rangeTo = range.to;
  }
  return { clause: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

// ── Query Functions ──────────────────────────────────────────────────────────

export function getOverviewMetrics(range?: TimeRange): OverviewMetrics {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN t.status = 'running' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN t.status = 'queued' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked
    FROM tasks t
    WHERE 1=1${clause}
  `).get(params) as any;

  // Average completion time from completed task_runs
  const avgRow = db.prepare(`
    SELECT AVG(r.duration_ms) AS avg_dur
    FROM task_runs r
    JOIN tasks t ON r.task_id = t.id
    WHERE r.status = 'completed' AND r.duration_ms IS NOT NULL${clause}
  `).get(params) as any;

  // Approval rate: approved / (approved + rejected)
  const approvalRow = db.prepare(`
    SELECT
      SUM(CASE WHEN a.status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM approval_requests a
    JOIN tasks t ON a.task_id = t.id
    WHERE 1=1${clause}
  `).get(params) as any;

  const approved = Number(approvalRow?.approved ?? 0);
  const rejected = Number(approvalRow?.rejected ?? 0);
  const approvalTotal = approved + rejected;

  return {
    totalTasks: Number(row?.total ?? 0),
    completed: Number(row?.completed ?? 0),
    failed: Number(row?.failed ?? 0),
    inProgress: Number(row?.in_progress ?? 0),
    queued: Number(row?.queued ?? 0),
    blocked: Number(row?.blocked ?? 0),
    avgCompletionMs: Math.round(Number(avgRow?.avg_dur ?? 0)),
    approvalRate: approvalTotal > 0 ? Math.round((approved / approvalTotal) * 100) : 100,
  };
}

export function getTaskThroughput(range?: TimeRange, bucketMs = 86400000): ThroughputBucket[] {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  // Get created counts per bucket
  const createdRows = db.prepare(`
    SELECT (t.created_at / :bucketMs) AS bucket, COUNT(*) AS cnt
    FROM tasks t
    WHERE 1=1${clause}
    GROUP BY bucket
    ORDER BY bucket
  `).all({ ...params, bucketMs }) as any[];

  // Get completed counts per bucket
  const completedRows = db.prepare(`
    SELECT (t.completed_at / :bucketMs) AS bucket, COUNT(*) AS cnt
    FROM tasks t
    WHERE t.completed_at IS NOT NULL${clause.replace(/t\.created_at/g, "t.completed_at")}
    GROUP BY bucket
    ORDER BY bucket
  `).all({ ...params, bucketMs }) as any[];

  // Merge into single array
  const map = new Map<number, ThroughputBucket>();
  for (const r of createdRows) {
    const b = Number(r.bucket) * bucketMs;
    map.set(b, { bucket: b, created: Number(r.cnt), completed: 0 });
  }
  for (const r of completedRows) {
    const b = Number(r.bucket) * bucketMs;
    const existing = map.get(b);
    if (existing) {
      existing.completed = Number(r.cnt);
    } else {
      map.set(b, { bucket: b, created: 0, completed: Number(r.cnt) });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.bucket - b.bucket);
}

export function getAgentPerformance(range?: TimeRange): AgentPerformance[] {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  const rows = db.prepare(`
    SELECT
      t.agent_id,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      AVG(CASE WHEN r.status = 'completed' THEN r.duration_ms END) AS avg_dur
    FROM tasks t
    LEFT JOIN task_runs r ON r.task_id = t.id
    WHERE 1=1${clause}
    GROUP BY t.agent_id
    ORDER BY completed DESC
  `).all(params) as any[];

  return rows.map((r) => {
    const comp = Number(r.completed ?? 0);
    const fail = Number(r.failed ?? 0);
    const total = comp + fail;
    return {
      agentId: String(r.agent_id),
      tasksCompleted: comp,
      tasksFailed: fail,
      avgDurationMs: Math.round(Number(r.avg_dur ?? 0)),
      successRate: total > 0 ? Math.round((comp / total) * 100) : 0,
    };
  });
}

export function getTaskDurationBreakdown(range?: TimeRange): DurationBucket[] {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN r.duration_ms < 60000 THEN 1 ELSE 0 END) AS under_1m,
      SUM(CASE WHEN r.duration_ms >= 60000 AND r.duration_ms < 300000 THEN 1 ELSE 0 END) AS m1_5,
      SUM(CASE WHEN r.duration_ms >= 300000 AND r.duration_ms < 900000 THEN 1 ELSE 0 END) AS m5_15,
      SUM(CASE WHEN r.duration_ms >= 900000 AND r.duration_ms < 3600000 THEN 1 ELSE 0 END) AS m15_60,
      SUM(CASE WHEN r.duration_ms >= 3600000 AND r.duration_ms < 14400000 THEN 1 ELSE 0 END) AS h1_4,
      SUM(CASE WHEN r.duration_ms >= 14400000 THEN 1 ELSE 0 END) AS over_4h
    FROM task_runs r
    JOIN tasks t ON r.task_id = t.id
    WHERE r.status = 'completed' AND r.duration_ms IS NOT NULL${clause}
  `).get(params) as any;

  return [
    { label: "< 1 min", count: Number(row?.under_1m ?? 0) },
    { label: "1-5 min", count: Number(row?.m1_5 ?? 0) },
    { label: "5-15 min", count: Number(row?.m5_15 ?? 0) },
    { label: "15-60 min", count: Number(row?.m15_60 ?? 0) },
    { label: "1-4 hrs", count: Number(row?.h1_4 ?? 0) },
    { label: "4+ hrs", count: Number(row?.over_4h ?? 0) },
  ];
}

export function getPriorityDistribution(range?: TimeRange): PriorityDist[] {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  const rows = db.prepare(`
    SELECT
      t.priority,
      COUNT(*) AS total,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN t.status IN ('pending','queued','blocked') THEN 1 ELSE 0 END) AS pending
    FROM tasks t
    WHERE 1=1${clause}
    GROUP BY t.priority
    ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END
  `).all(params) as any[];

  return rows.map((r) => ({
    priority: String(r.priority),
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    pending: Number(r.pending ?? 0),
  }));
}

export function getWorkflowAnalytics(range?: TimeRange): WorkflowAnalytics[] {
  const db = getMcDb();
  const { clause, params } = rangeClause("wr.started_at", range);

  const rows = db.prepare(`
    SELECT
      w.id AS workflow_id,
      w.name,
      COUNT(wr.id) AS total_runs,
      SUM(CASE WHEN wr.status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN wr.status = 'failed' THEN 1 ELSE 0 END) AS failed,
      AVG(CASE WHEN wr.ended_at IS NOT NULL THEN wr.ended_at - wr.started_at END) AS avg_dur
    FROM workflows w
    LEFT JOIN workflow_runs wr ON wr.workflow_id = w.id${clause ? " AND 1=1" + clause : ""}
    GROUP BY w.id
    ORDER BY total_runs DESC
  `).all(params) as any[];

  return rows.map((r) => ({
    workflowId: String(r.workflow_id),
    name: String(r.name),
    totalRuns: Number(r.total_runs ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    avgDurationMs: Math.round(Number(r.avg_dur ?? 0)),
  }));
}

export function getSlaReport(range?: TimeRange): SlaReport {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN t.deadline_at IS NOT NULL AND t.completed_at IS NOT NULL AND t.completed_at <= t.deadline_at THEN 1 ELSE 0 END) AS met,
      SUM(CASE WHEN t.deadline_at IS NOT NULL AND (t.completed_at IS NULL OR t.completed_at > t.deadline_at) AND t.status IN ('done','failed') THEN 1 ELSE 0 END) AS missed,
      SUM(CASE WHEN t.deadline_at IS NULL THEN 1 ELSE 0 END) AS no_deadline
    FROM tasks t
    WHERE 1=1${clause}
  `).get(params) as any;

  const met = Number(row?.met ?? 0);
  const missed = Number(row?.missed ?? 0);
  const withDeadline = met + missed;

  return {
    total: Number(row?.total ?? 0),
    metDeadline: met,
    missedDeadline: missed,
    noDeadline: Number(row?.no_deadline ?? 0),
    complianceRate: withDeadline > 0 ? Math.round((met / withDeadline) * 100) : 100,
  };
}

export function getTagBreakdown(range?: TimeRange): TagBreakdown[] {
  const db = getMcDb();
  const { clause, params } = rangeClause("t.created_at", range);

  const rows = db.prepare(`
    SELECT
      j.value AS tag,
      COUNT(*) AS cnt,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM tasks t, json_each(t.tags_json) j
    WHERE 1=1${clause}
    GROUP BY j.value
    ORDER BY cnt DESC
  `).all(params) as any[];

  return rows.map((r) => ({
    tag: String(r.tag),
    count: Number(r.cnt ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
  }));
}
