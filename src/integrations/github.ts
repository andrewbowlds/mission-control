import { randomUUID, createHmac } from "node:crypto";
import { getMcDb } from "../mc-db.js";
import {
  getIntegrationByType,
  createIntegration,
  markConnected,
  markError,
  markSynced,
  updateIntegration,
} from "./framework.js";
import { createTask } from "../task-engine.js";
import type { GitHubRepo, GitHubIssue, Task } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJson(json: string | null | undefined, fallback: any = {}): any {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function rowToRepo(row: any): GitHubRepo {
  return {
    id: row.id,
    integrationId: row.integration_id,
    externalId: Number(row.external_id),
    fullName: row.full_name,
    description: row.description ?? undefined,
    url: row.url,
    defaultBranch: row.default_branch ?? undefined,
    isPrivate: Boolean(row.is_private),
    syncedAt: row.synced_at,
  };
}

function rowToIssue(row: any): GitHubIssue {
  return {
    id: row.id,
    repoId: row.repo_id,
    externalId: Number(row.external_id),
    number: Number(row.number),
    title: row.title,
    body: row.body ?? undefined,
    state: row.state as "open" | "closed",
    isPr: Boolean(row.is_pr),
    author: row.author ?? undefined,
    assignee: row.assignee ?? undefined,
    labels: parseJson(row.labels_json, []),
    taskId: row.task_id ?? undefined,
    url: row.url,
    externalCreatedAt: row.external_created_at ?? undefined,
    externalUpdatedAt: row.external_updated_at ?? undefined,
    syncedAt: row.synced_at,
  };
}

// ── GitHub API Client ────────────────────────────────────────────────────────

async function githubApi<T = any>(
  path: string,
  token: string,
  opts?: { method?: string; body?: any },
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

async function githubApiPaginated<T = any>(path: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = `https://api.github.com${path}`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) break;

    const items = (await res.json()) as T[];
    results.push(...items);

    // Parse Link header for next page
    const linkHeader = res.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? null;

    if (results.length >= 500) break; // Safety limit
  }

  return results;
}

// ── Connection ───────────────────────────────────────────────────────────────

function getGitHubToken(): string | null {
  const integration = getIntegrationByType("github");
  if (!integration) return null;
  const config = parseJson(integration.configJson);
  return config.token ?? null;
}

export async function connectGitHub(data: { token: string; webhookSecret?: string }): Promise<void> {
  // Test connection
  await githubApi("/user", data.token);

  let integration = getIntegrationByType("github");
  if (!integration) {
    integration = createIntegration({ type: "github", label: "GitHub" });
  }

  const configJson = JSON.stringify({
    token: data.token,
    webhookSecret: data.webhookSecret ?? undefined,
  });

  updateIntegration(integration.id, { configJson, status: "connected", errorMessage: null });
}

export function disconnectGitHub(): void {
  const integration = getIntegrationByType("github");
  if (integration) {
    updateIntegration(integration.id, { configJson: "{}", status: "disconnected" });
    // Clean up synced data
    const db = getMcDb();
    const repos = db.prepare("SELECT id FROM github_repos WHERE integration_id = ?").all(integration.id) as any[];
    for (const repo of repos) {
      db.prepare("DELETE FROM github_issues WHERE repo_id = ?").run(repo.id);
    }
    db.prepare("DELETE FROM github_repos WHERE integration_id = ?").run(integration.id);
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncGitHubRepos(): Promise<{ synced: number }> {
  const token = getGitHubToken();
  if (!token) throw new Error("Not connected to GitHub.");

  const integration = getIntegrationByType("github");
  if (!integration) throw new Error("No GitHub integration found.");

  const repos = await githubApiPaginated<any>("/user/repos?sort=updated&per_page=100", token);

  const db = getMcDb();
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO github_repos (id, integration_id, external_id, full_name, description, url, default_branch, is_private, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(integration_id, external_id) DO UPDATE SET
      full_name = excluded.full_name, description = excluded.description, url = excluded.url,
      default_branch = excluded.default_branch, is_private = excluded.is_private, synced_at = excluded.synced_at
  `);

  let synced = 0;
  for (const repo of repos) {
    upsert.run(
      randomUUID(), integration.id, repo.id,
      repo.full_name, repo.description ?? null, repo.html_url,
      repo.default_branch ?? null, repo.private ? 1 : 0, now,
    );
    synced++;
  }

  return { synced };
}

export async function syncGitHubIssues(repoFullName?: string): Promise<{ synced: number }> {
  const token = getGitHubToken();
  if (!token) throw new Error("Not connected to GitHub.");

  const integration = getIntegrationByType("github");
  if (!integration) throw new Error("No GitHub integration found.");

  const db = getMcDb();
  const now = Date.now();

  let repos: any[];
  if (repoFullName) {
    repos = db.prepare("SELECT * FROM github_repos WHERE integration_id = ? AND full_name = ?")
      .all(integration.id, repoFullName) as any[];
  } else {
    repos = db.prepare("SELECT * FROM github_repos WHERE integration_id = ?")
      .all(integration.id) as any[];
  }

  const upsert = db.prepare(`
    INSERT INTO github_issues (id, repo_id, external_id, number, title, body, state, is_pr, author, assignee, labels_json, url, external_created_at, external_updated_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id, external_id) DO UPDATE SET
      title = excluded.title, body = excluded.body, state = excluded.state,
      is_pr = excluded.is_pr, author = excluded.author, assignee = excluded.assignee,
      labels_json = excluded.labels_json, url = excluded.url,
      external_updated_at = excluded.external_updated_at, synced_at = excluded.synced_at
  `);

  let totalSynced = 0;
  for (const repo of repos) {
    const issues = await githubApiPaginated<any>(
      `/repos/${repo.full_name}/issues?state=all&sort=updated&per_page=100`,
      token,
    );

    for (const issue of issues) {
      const isPr = !!issue.pull_request;
      const labels = (issue.labels ?? []).map((l: any) => typeof l === "string" ? l : l.name).filter(Boolean);

      upsert.run(
        randomUUID(), repo.id, issue.id, issue.number,
        issue.title, issue.body ?? null, issue.state,
        isPr ? 1 : 0, issue.user?.login ?? null, issue.assignee?.login ?? null,
        JSON.stringify(labels), issue.html_url,
        issue.created_at ? new Date(issue.created_at).getTime() : null,
        issue.updated_at ? new Date(issue.updated_at).getTime() : null,
        now,
      );
      totalSynced++;
    }
  }

  markSynced(integration.id);
  return { synced: totalSynced };
}

// ── Query ────────────────────────────────────────────────────────────────────

export function listRepos(integrationId?: string): GitHubRepo[] {
  const db = getMcDb();
  if (integrationId) {
    return (db.prepare("SELECT * FROM github_repos WHERE integration_id = ? ORDER BY full_name").all(integrationId) as any[]).map(rowToRepo);
  }
  return (db.prepare("SELECT * FROM github_repos ORDER BY full_name").all() as any[]).map(rowToRepo);
}

export function listIssues(opts?: { repoId?: string; state?: string; search?: string; limit?: number }): GitHubIssue[] {
  const db = getMcDb();
  const parts: string[] = ["1=1"];
  const params: any = {};

  if (opts?.repoId) {
    parts.push("repo_id = :repoId");
    params.repoId = opts.repoId;
  }
  if (opts?.state) {
    parts.push("state = :state");
    params.state = opts.state;
  }
  if (opts?.search) {
    parts.push("title LIKE :search");
    params.search = `%${opts.search}%`;
  }

  const limit = opts?.limit ?? 200;
  const rows = db.prepare(`SELECT * FROM github_issues WHERE ${parts.join(" AND ")} ORDER BY external_updated_at DESC LIMIT ${limit}`).all(params) as any[];
  return rows.map(rowToIssue);
}

// ── Link Issue to Task ───────────────────────────────────────────────────────

export function linkIssueToTask(issueId: string, taskId: string | null): GitHubIssue | undefined {
  const db = getMcDb();
  db.prepare("UPDATE github_issues SET task_id = ? WHERE id = ?").run(taskId, issueId);
  const row = db.prepare("SELECT * FROM github_issues WHERE id = ?").get(issueId) as any;
  return row ? rowToIssue(row) : undefined;
}

export function createTaskFromIssue(issueId: string, agentId: string): Task | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM github_issues WHERE id = ?").get(issueId) as any;
  if (!row) return undefined;

  const issue = rowToIssue(row);
  const task = createTask({
    title: `[GH#${issue.number}] ${issue.title}`,
    description: issue.body ?? undefined,
    agentId,
    tags: ["github", ...issue.labels],
    contextJson: JSON.stringify({ githubIssueId: issueId, githubUrl: issue.url }),
  });

  if (task) {
    db.prepare("UPDATE github_issues SET task_id = ? WHERE id = ?").run(task.id, issueId);
  }

  return task;
}

// ── Webhook ──────────────────────────────────────────────────────────────────

export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  if (signature.length !== expected.length) return false;
  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export function getWebhookSecret(): string | null {
  const integration = getIntegrationByType("github");
  if (!integration) return null;
  const config = parseJson(integration.configJson);
  return config.webhookSecret ?? null;
}
