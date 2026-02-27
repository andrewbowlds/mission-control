import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, AgentRow, SessionRow, Task, TaskStatus, OverviewMetrics } from "../app.ts";

const STATUS_COLORS: Record<string, string> = {
  pending: "#64748b",
  queued: "#818cf8",
  running: "#f59e0b",
  waiting_approval: "#f97316",
  blocked: "#6b7280",
  done: "#22c55e",
  failed: "#ef4444",
  cancelled: "#374151",
};

@customElement("mc-dashboard")
export class McDashboard extends LitElement {
  @state() private metrics: OverviewMetrics | null = null;

  connectedCallback() {
    super.connectedCallback();
    void this.loadMetrics();
  }

  private async loadMetrics(): Promise<void> {
    const now = Date.now();
    const res = await this.app.gw.request<OverviewMetrics>("mc.analytics.overview", {
      from: now - 7 * 86400000, to: now,
    }).catch(() => null);
    this.metrics = res;
  }

  static styles = css`
    :host {
      display: block;
      padding: 24px;
      overflow-y: auto;
      height: 100%;
    }
    h2 {
      font-size: 17px;
      font-weight: 600;
      color: #a78bfa;
      margin: 0 0 20px 0;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin: 24px 0 12px 0;
    }

    /* Engine Status Bar */
    .engine-bar {
      display: flex;
      gap: 16px;
      padding: 16px;
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 12px;
      margin-bottom: 16px;
      align-items: center;
    }
    .engine-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .engine-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .engine-on { background: #22c55e; }
    .engine-off { background: #ef4444; }
    .engine-stats {
      display: flex;
      gap: 20px;
      margin-left: auto;
    }
    .engine-stat {
      text-align: center;
    }
    .engine-stat-val {
      font-size: 20px;
      font-weight: 700;
      color: #a78bfa;
    }
    .engine-stat-lbl {
      font-size: 9px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 2px;
    }

    /* Task Pipeline */
    .pipeline {
      display: flex;
      gap: 4px;
      padding: 14px 16px;
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 12px;
      margin-bottom: 16px;
      align-items: center;
    }
    .pipeline-step {
      flex: 1;
      text-align: center;
      padding: 8px 4px;
      border-radius: 8px;
      background: #0a0a0f;
    }
    .pipeline-val {
      font-size: 18px;
      font-weight: 700;
    }
    .pipeline-lbl {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 2px;
      color: #64748b;
    }
    .pipeline-arrow {
      color: #374151;
      font-size: 16px;
      flex-shrink: 0;
    }

    /* Approval Alert */
    .approval-alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: #1a0f00;
      border: 1px solid #f9731644;
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .approval-alert-icon {
      font-size: 20px;
      flex-shrink: 0;
    }
    .approval-alert-text {
      font-size: 13px;
      color: #f97316;
      font-weight: 500;
    }
    .approval-alert-count {
      font-weight: 700;
    }

    /* Agent Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      gap: 16px;
    }
    .card {
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 12px;
      padding: 18px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #4c1d95; }
    .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .avatar {
      width: 42px; height: 42px;
      border-radius: 50%;
      background: #1e1e2e;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }
    .agent-name { font-weight: 600; font-size: 14px; }
    .agent-id   { font-size: 11px; color: #64748b; margin-top: 2px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .stat {
      background: #0a0a0f;
      border-radius: 8px;
      padding: 10px 6px;
      text-align: center;
    }
    .stat-val { font-size: 22px; font-weight: 700; color: #a78bfa; }
    .stat-lbl { font-size: 10px; color: #64748b; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.04em; }
    .section-lbl {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .tasks-mini { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .task-mini {
      display: flex; align-items: center; gap: 8px;
      background: #0a0a0f; border-radius: 6px; padding: 6px 10px; font-size: 12px;
    }
    .task-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .task-name { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .task-status { font-size: 10px; color: #64748b; flex-shrink: 0; }
    .sessions {
      display: flex; flex-direction: column; gap: 5px;
      margin-bottom: 12px;
    }
    .session-item {
      background: #0a0a0f;
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 12px;
    }
    .session-lbl { color: #94a3b8; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-preview { color: #475569; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .none { font-size: 12px; color: #374151; font-style: italic; }
    .new-task-btn {
      width: 100%;
      padding: 8px;
      background: none;
      border: 1px dashed #374151;
      border-radius: 8px;
      color: #64748b;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .new-task-btn:hover { border-color: #a78bfa; color: #a78bfa; }
    .empty {
      grid-column: 1 / -1;
      text-align: center;
      padding: 80px 0;
      color: #374151;
      font-size: 14px;
    }

    /* Metrics summary */
    .metrics-summary {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
      margin-bottom: 16px;
    }
    .metric-card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 14px; text-align: center;
    }
    .metric-card-val { font-size: 24px; font-weight: 700; }
    .metric-card-val.green { color: #22c55e; }
    .metric-card-val.red { color: #ef4444; }
    .metric-card-val.purple { color: #a78bfa; }
    .metric-card-val.blue { color: #60a5fa; }
    .metric-card-lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
  `;

  @property({ attribute: false }) app!: AppFacade;

  private agentSessions(agentId: string): SessionRow[] {
    return this.app.sessions.filter(
      (s) => s.key.startsWith(agentId + ":") || s.key === agentId,
    );
  }

  private agentTasks(agentId: string): Task[] {
    return this.app.tasks.filter((t) => t.agentId === agentId);
  }

  private taskCountByStatus(status: TaskStatus): number {
    return this.app.tasks.filter((t) => t.status === status).length;
  }

  private async onNewTask(agentId: string): Promise<void> {
    const title = prompt(`New task for agent "${agentId}":`);
    if (title?.trim()) await this.app.createTask({ title: title.trim(), agentId });
  }

  render() {
    const { agents } = this.app;
    const eng = this.app.engineStatus;
    const pendingApprovals = this.app.approvals.filter((a) => a.status === "pending");

    const m = this.metrics;
    const fmtDur = (ms: number) => {
      if (!ms) return "0s";
      const s = Math.round(ms / 1000);
      if (s < 60) return `${s}s`;
      if (s < 3600) return `${Math.floor(s / 60)}m`;
      return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    };

    return html`
      <h2>Dashboard</h2>

      <!-- 7-day Metrics Summary -->
      ${m ? html`
        <div class="metrics-summary">
          <div class="metric-card">
            <div class="metric-card-val green">${m.completed}</div>
            <div class="metric-card-lbl">Completed (7d)</div>
          </div>
          <div class="metric-card">
            <div class="metric-card-val red">${m.failed}</div>
            <div class="metric-card-lbl">Failed (7d)</div>
          </div>
          <div class="metric-card">
            <div class="metric-card-val purple">${m.totalTasks > 0 ? Math.round((m.completed / m.totalTasks) * 100) : 0}%</div>
            <div class="metric-card-lbl">Success Rate (7d)</div>
          </div>
          <div class="metric-card">
            <div class="metric-card-val blue">${fmtDur(m.avgCompletionMs)}</div>
            <div class="metric-card-lbl">Avg Duration (7d)</div>
          </div>
        </div>
      ` : ""}

      <!-- Engine Status -->
      ${eng ? html`
        <div class="engine-bar">
          <div class="engine-indicator">
            <div class="engine-dot ${eng.running ? "engine-on" : "engine-off"}"></div>
            Execution Engine ${eng.running ? "Running" : "Stopped"}
          </div>
          <div class="engine-stats">
            <div class="engine-stat">
              <div class="engine-stat-val">${eng.activeTasks}</div>
              <div class="engine-stat-lbl">Active</div>
            </div>
            <div class="engine-stat">
              <div class="engine-stat-val">${eng.queuedTasks}</div>
              <div class="engine-stat-lbl">Queued</div>
            </div>
            <div class="engine-stat">
              <div class="engine-stat-val">${eng.blockedTasks}</div>
              <div class="engine-stat-lbl">Blocked</div>
            </div>
            <div class="engine-stat">
              <div class="engine-stat-val">${eng.pendingApprovals}</div>
              <div class="engine-stat-lbl">Approvals</div>
            </div>
          </div>
        </div>
      ` : ""}

      <!-- Approval Alert -->
      ${pendingApprovals.length > 0 ? html`
        <div class="approval-alert">
          <div class="approval-alert-icon">!</div>
          <div class="approval-alert-text">
            <span class="approval-alert-count">${pendingApprovals.length}</span>
            approval${pendingApprovals.length > 1 ? "s" : ""} waiting for your decision
          </div>
        </div>
      ` : ""}

      <!-- Task Pipeline -->
      <div class="pipeline">
        ${(["pending", "queued", "running", "done"] as TaskStatus[]).map((status, i) => html`
          ${i > 0 ? html`<div class="pipeline-arrow">&#8594;</div>` : ""}
          <div class="pipeline-step">
            <div class="pipeline-val" style="color: ${STATUS_COLORS[status]}">${this.taskCountByStatus(status)}</div>
            <div class="pipeline-lbl">${status.replace("_", " ")}</div>
          </div>
        `)}
      </div>

      <!-- Agent Cards -->
      ${!agents.length
        ? html`<div class="empty">No agents found. Check your gateway configuration.</div>`
        : ""}

      <div class="section-title">Agents</div>
      <div class="grid">
        ${agents.map((agent) => this.renderCard(agent))}
      </div>
    `;
  }

  private renderCard(agent: AgentRow) {
    const sessions = this.agentSessions(agent.id);
    const tasks = this.agentTasks(agent.id);
    const name = agent.identity?.name ?? agent.name ?? agent.id;
    const emoji = agent.identity?.emoji ?? "";
    const activeTasks = tasks.filter((t) => t.status === "running");
    const queuedTasks = tasks.filter((t) => t.status === "queued" || t.status === "pending");
    return html`
      <div class="card">
        <div class="card-header">
          <div class="avatar">${emoji || "A"}</div>
          <div>
            <div class="agent-name">${name}</div>
            <div class="agent-id">${agent.id}</div>
          </div>
        </div>

        <div class="stats">
          <div class="stat">
            <div class="stat-val">${sessions.length}</div>
            <div class="stat-lbl">Sessions</div>
          </div>
          <div class="stat">
            <div class="stat-val">${activeTasks.length}</div>
            <div class="stat-lbl">Active</div>
          </div>
          <div class="stat">
            <div class="stat-val">${queuedTasks.length}</div>
            <div class="stat-lbl">Queued</div>
          </div>
        </div>

        ${tasks.length ? html`
          <div class="section-lbl">Tasks</div>
          <div class="tasks-mini">
            ${tasks.slice(0, 5).map((t) => html`
              <div class="task-mini">
                <div class="task-dot" style="background: ${STATUS_COLORS[t.status] ?? "#374151"}"></div>
                <span class="task-name">${t.title}</span>
                <span class="task-status">${t.status}</span>
              </div>
            `)}
          </div>
        ` : ""}

        ${sessions.length ? html`
          <div class="section-lbl">Recent Sessions</div>
          <div class="sessions">
            ${sessions.slice(0, 3).map((s) => html`
              <div class="session-item">
                <div class="session-lbl">${s.label ?? s.key}</div>
                ${s.lastMessagePreview
                  ? html`<div class="session-preview">${s.lastMessagePreview}</div>`
                  : ""}
              </div>
            `)}
          </div>
        ` : html`<div class="none">No active sessions</div>`}

        <button class="new-task-btn" @click=${() => void this.onNewTask(agent.id)}>
          + Assign Task
        </button>
      </div>
    `;
  }
}
