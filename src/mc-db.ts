import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

function getStoreDir(): string {
  const dir = path.join(os.homedir(), ".openclaw", "workspace", "mission-control");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbPath(): string {
  return path.join(getStoreDir(), "mc.sqlite");
}

let db: DatabaseSync | null = null;

function ensureDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(getDbPath());
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  runMigrations(db);
  return db;
}

function runMigrations(conn: DatabaseSync): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const migrations: Array<{ id: string; sql: string }> = [
    {
      id: "20260226_01_task_engine_v2",
      sql: `
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          title TEXT NOT NULL,
          description TEXT,
          agent_id TEXT NOT NULL,
          session_key TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          priority TEXT NOT NULL DEFAULT 'normal',
          task_type TEXT NOT NULL DEFAULT 'manual',
          execution_mode TEXT DEFAULT 'agent',
          max_retries INTEGER NOT NULL DEFAULT 2,
          retry_count INTEGER NOT NULL DEFAULT 0,
          timeout_ms INTEGER,
          requires_approval INTEGER NOT NULL DEFAULT 0,
          approval_status TEXT,
          approved_by TEXT,
          approved_at INTEGER,
          scheduled_at INTEGER,
          deadline_at INTEGER,
          tags_json TEXT DEFAULT '[]',
          context_json TEXT DEFAULT '{}',
          result_json TEXT,
          error_message TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS task_dependencies (
          task_id TEXT NOT NULL,
          depends_on_task_id TEXT NOT NULL,
          PRIMARY KEY (task_id, depends_on_task_id),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS task_updates (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          author TEXT NOT NULL DEFAULT 'system',
          note TEXT NOT NULL,
          status TEXT,
          link TEXT,
          metadata_json TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS task_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          session_key TEXT,
          run_number INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'running',
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          duration_ms INTEGER,
          error TEXT,
          result_json TEXT,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS approval_requests (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          request_type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          context_json TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_by TEXT,
          decided_by TEXT,
          decided_at INTEGER,
          decision_note TEXT,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_at ON tasks(scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_task_updates_task_id ON task_updates(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_dependencies(depends_on_task_id);
        CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
      `,
    },
    {
      id: "20260226_02_trello_boards",
      sql: `
        CREATE TABLE IF NOT EXISTS trello_boards (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trello_lists (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          name TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (board_id) REFERENCES trello_boards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS trello_cards (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL,
          board_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          labels_json TEXT DEFAULT '[]',
          due_at INTEGER,
          assignee TEXT,
          checklist_json TEXT DEFAULT '[]',
          cover_color TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (list_id) REFERENCES trello_lists(id) ON DELETE CASCADE,
          FOREIGN KEY (board_id) REFERENCES trello_boards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS trello_comments (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          author TEXT NOT NULL DEFAULT 'operator',
          text TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (card_id) REFERENCES trello_cards(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_trello_lists_board ON trello_lists(board_id);
        CREATE INDEX IF NOT EXISTS idx_trello_cards_board ON trello_cards(board_id);
        CREATE INDEX IF NOT EXISTS idx_trello_cards_list ON trello_cards(list_id);
        CREATE INDEX IF NOT EXISTS idx_trello_comments_card ON trello_comments(card_id);
      `,
    },
    {
      id: "20260226_03_phase2_workflows",
      sql: `
        CREATE TABLE IF NOT EXISTS task_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          agent_id TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'normal',
          task_type TEXT NOT NULL DEFAULT 'automated',
          execution_mode TEXT DEFAULT 'agent',
          max_retries INTEGER NOT NULL DEFAULT 2,
          timeout_ms INTEGER,
          requires_approval INTEGER NOT NULL DEFAULT 0,
          tags_json TEXT DEFAULT '[]',
          context_json TEXT DEFAULT '{}',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          trigger_type TEXT NOT NULL DEFAULT 'manual',
          trigger_config_json TEXT DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          cron_job_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_steps (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          step_order INTEGER NOT NULL,
          name TEXT NOT NULL,
          template_id TEXT,
          inline_config_json TEXT,
          condition_json TEXT,
          on_failure TEXT NOT NULL DEFAULT 'stop',
          retry_count INTEGER NOT NULL DEFAULT 0,
          timeout_ms INTEGER,
          context_overrides_json TEXT DEFAULT '{}',
          created_at INTEGER NOT NULL,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
          FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          trigger_source TEXT,
          context_json TEXT DEFAULT '{}',
          current_step INTEGER NOT NULL DEFAULT 0,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          error TEXT,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workflow_run_steps (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          task_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at INTEGER,
          ended_at INTEGER,
          error TEXT,
          result_json TEXT,
          FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS automation_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          event_type TEXT NOT NULL,
          event_filter_json TEXT DEFAULT '{}',
          action_type TEXT NOT NULL,
          action_config_json TEXT NOT NULL DEFAULT '{}',
          cooldown_ms INTEGER NOT NULL DEFAULT 0,
          last_fired_at INTEGER,
          fire_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow ON workflow_steps(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run ON workflow_run_steps(run_id);
        CREATE INDEX IF NOT EXISTS idx_automation_rules_event ON automation_rules(event_type);
        CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);
      `,
    },
    {
      id: "20260227_04_phase4_integrations",
      sql: `
        CREATE TABLE IF NOT EXISTS integrations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          label TEXT NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'disconnected',
          error_message TEXT,
          last_sync_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS calendar_events (
          id TEXT PRIMARY KEY,
          integration_id TEXT NOT NULL,
          external_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          start_at INTEGER NOT NULL,
          end_at INTEGER NOT NULL,
          all_day INTEGER NOT NULL DEFAULT 0,
          location TEXT,
          task_id TEXT,
          status TEXT NOT NULL DEFAULT 'confirmed',
          raw_json TEXT,
          synced_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
          UNIQUE(integration_id, external_id)
        );

        CREATE TABLE IF NOT EXISTS github_repos (
          id TEXT PRIMARY KEY,
          integration_id TEXT NOT NULL,
          external_id INTEGER NOT NULL,
          full_name TEXT NOT NULL,
          description TEXT,
          url TEXT NOT NULL,
          default_branch TEXT,
          is_private INTEGER NOT NULL DEFAULT 0,
          synced_at INTEGER NOT NULL,
          FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
          UNIQUE(integration_id, external_id)
        );

        CREATE TABLE IF NOT EXISTS github_issues (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL,
          external_id INTEGER NOT NULL,
          number INTEGER NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          state TEXT NOT NULL DEFAULT 'open',
          is_pr INTEGER NOT NULL DEFAULT 0,
          author TEXT,
          assignee TEXT,
          labels_json TEXT DEFAULT '[]',
          task_id TEXT,
          url TEXT NOT NULL,
          external_created_at INTEGER,
          external_updated_at INTEGER,
          synced_at INTEGER NOT NULL,
          FOREIGN KEY (repo_id) REFERENCES github_repos(id) ON DELETE CASCADE,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
          UNIQUE(repo_id, external_id)
        );

        CREATE INDEX IF NOT EXISTS idx_calendar_events_integration ON calendar_events(integration_id);
        CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);
        CREATE INDEX IF NOT EXISTS idx_calendar_events_task ON calendar_events(task_id);
        CREATE INDEX IF NOT EXISTS idx_github_repos_integration ON github_repos(integration_id);
        CREATE INDEX IF NOT EXISTS idx_github_issues_repo ON github_issues(repo_id);
        CREATE INDEX IF NOT EXISTS idx_github_issues_state ON github_issues(state);
        CREATE INDEX IF NOT EXISTS idx_github_issues_task ON github_issues(task_id);
      `,
    },
    {
      id: "20260227_05_phase5_intelligence",
      sql: `
        CREATE TABLE IF NOT EXISTS agent_capabilities (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          proficiency REAL NOT NULL DEFAULT 0.5,
          sample_count INTEGER NOT NULL DEFAULT 0,
          total_successes INTEGER NOT NULL DEFAULT 0,
          total_failures INTEGER NOT NULL DEFAULT 0,
          avg_duration_ms REAL,
          last_updated_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(agent_id, capability)
        );

        CREATE TABLE IF NOT EXISTS routing_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          rule_type TEXT NOT NULL DEFAULT 'keyword',
          match_config_json TEXT NOT NULL DEFAULT '{}',
          preferred_agent_id TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          enabled INTEGER NOT NULL DEFAULT 1,
          override INTEGER NOT NULL DEFAULT 0,
          fire_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_caps_agent ON agent_capabilities(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_caps_capability ON agent_capabilities(capability);
        CREATE INDEX IF NOT EXISTS idx_routing_rules_enabled ON routing_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_routing_rules_agent ON routing_rules(preferred_agent_id);
      `,
    },
    {
      id: "20260227_06_notifications_and_delegation",
      sql: `
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          severity TEXT NOT NULL DEFAULT 'info',
          source_type TEXT,
          source_id TEXT,
          actor_id TEXT,
          read INTEGER NOT NULL DEFAULT 0,
          dismissed INTEGER NOT NULL DEFAULT 0,
          action_type TEXT,
          action_payload_json TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS delegations (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          from_agent_id TEXT NOT NULL,
          to_agent_id TEXT NOT NULL,
          reason TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          requires_approval INTEGER NOT NULL DEFAULT 0,
          approval_id TEXT,
          original_agent_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
        CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_source ON notifications(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_delegations_task ON delegations(task_id);
        CREATE INDEX IF NOT EXISTS idx_delegations_from ON delegations(from_agent_id);
        CREATE INDEX IF NOT EXISTS idx_delegations_to ON delegations(to_agent_id);
        CREATE INDEX IF NOT EXISTS idx_delegations_status ON delegations(status);
      `,
    },
  ];

  const hasMigration = conn.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const insertMigration = conn.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    const found = hasMigration.get(migration.id) as { 1: number } | undefined;
    if (found) continue;
    conn.exec("BEGIN");
    try {
      conn.exec(migration.sql);
      insertMigration.run(migration.id, Date.now());
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Migrate legacy tasks.json into SQLite if it exists */
function ensureLegacyTaskImport(conn: DatabaseSync): void {
  const jsonPath = path.join(getStoreDir(), "tasks.json");
  if (!fs.existsSync(jsonPath)) return;

  let legacy: any[];
  try {
    legacy = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (!Array.isArray(legacy)) return;
  } catch {
    return;
  }

  const existsStmt = conn.prepare("SELECT id FROM tasks WHERE id = ?");
  const insertTask = conn.prepare(`
    INSERT INTO tasks (id, title, description, agent_id, session_key, status, priority, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertUpdate = conn.prepare(`
    INSERT INTO task_updates (id, task_id, author, note, status, link, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const statusMap: Record<string, string> = {
    todo: "pending",
    in_progress: "running",
    done: "done",
  };

  conn.exec("BEGIN");
  try {
    for (const task of legacy) {
      if (!task.id) continue;
      const exists = existsStmt.get(task.id) as { id: string } | undefined;
      if (exists) continue;

      const mappedStatus = statusMap[task.status] ?? "pending";
      insertTask.run(
        task.id,
        task.title ?? "Untitled",
        task.description ?? null,
        task.agentId ?? "main",
        task.sessionKey ?? null,
        mappedStatus,
        task.priority ?? "normal",
        JSON.stringify(task.tags ?? []),
        task.createdAt ?? Date.now(),
        task.updatedAt ?? Date.now(),
      );

      const updates = Array.isArray(task.updates) ? task.updates : [];
      for (const upd of updates) {
        insertUpdate.run(
          upd.id ?? `legacy-${Math.random().toString(36).slice(2)}`,
          task.id,
          upd.author ?? "system",
          upd.note ?? "Legacy update",
          upd.status ?? null,
          upd.link ?? null,
          upd.at ?? Date.now(),
        );
      }
    }
    conn.exec("COMMIT");
    // Rename old file so migration only runs once
    fs.renameSync(jsonPath, jsonPath + ".migrated");
  } catch {
    conn.exec("ROLLBACK");
  }
}

let legacyImported = false;

export function getMcDb(): DatabaseSync {
  const conn = ensureDb();
  if (!legacyImported) {
    legacyImported = true;
    ensureLegacyTaskImport(conn);
  }
  return conn;
}
