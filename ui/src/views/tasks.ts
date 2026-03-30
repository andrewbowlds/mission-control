import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, AgentRow, Task, TaskStatus, TaskUpdateMetadata } from "../app.ts";

type ColumnDef = { status: TaskStatus; label: string; color: string; dotColor: string };

const COLUMNS: ColumnDef[] = [
  { status: "pending", label: "Pending", color: "#64748b", dotColor: "#475569" },
  { status: "queued", label: "Queued", color: "#818cf8", dotColor: "#6366f1" },
  { status: "running", label: "Running", color: "#f59e0b", dotColor: "#f59e0b" },
  { status: "waiting_approval", label: "Approval", color: "#f97316", dotColor: "#f97316" },
  { status: "done", label: "Done", color: "#22c55e", dotColor: "#22c55e" },
  { status: "failed", label: "Failed", color: "#ef4444", dotColor: "#ef4444" },
];

const KIND_LABELS: Record<NonNullable<TaskUpdateMetadata["kind"]>, string> = {
  system: "System",
  progress: "Progress",
  finding: "Finding",
  blocker: "Blocker",
  decision: "Decision",
  completion: "Completion",
};

const KIND_CLASS: Record<NonNullable<TaskUpdateMetadata["kind"]>, string> = {
  system: "kind-system",
  progress: "kind-progress",
  finding: "kind-finding",
  blocker: "kind-blocker",
  decision: "kind-decision",
  completion: "kind-completion",
};

@customElement("mc-tasks")
export class McTasks extends LitElement {
  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .toolbar { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #1e1e2e; flex-shrink: 0; }
    .toolbar h2 { font-size: 15px; font-weight: 600; color: #a78bfa; margin: 0; }
    .engine-pill { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; background: #111118; padding: 4px 10px; border-radius: 6px; }
    .engine-dot { width: 6px; height: 6px; border-radius: 50%; }
    .engine-on { background: #22c55e; }
    .engine-off { background: #ef4444; }
    .filter-group { display: flex; gap: 4px; margin-left: 8px; }
    .filter-btn { padding: 4px 10px; border: 1px solid #1e1e2e; background: none; color: #64748b; border-radius: 6px; font-size: 11px; cursor: pointer; }
    .filter-btn.active { background: #1e1e2e; color: #a78bfa; border-color: #4c1d95; }
    .create-btn { margin-left: auto; padding: 6px 16px; background: #4c1d95; color: #e9d5ff; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }

    .kanban { display: grid; grid-template-columns: repeat(6, 1fr); flex: 1; overflow: hidden; }
    .col { display: flex; flex-direction: column; border-right: 1px solid #1e1e2e; overflow: hidden; min-width: 0; }
    .col:last-child { border-right: none; }
    .col-head { padding: 10px 12px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #1e1e2e; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .col-count { background: #1e1e2e; border-radius: 10px; padding: 1px 6px; font-size: 9px; }
    .col-body { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

    .card { background: #111118; border: 1px solid #1e1e2e; border-radius: 8px; padding: 10px; cursor: pointer; transition: border-color 0.15s; }
    .card:hover { border-color: #4c1d95; }
    .card-title { font-size: 12px; font-weight: 500; margin-bottom: 6px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .card-meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .tag { font-size: 9px; border-radius: 4px; padding: 1px 6px; font-weight: 500; white-space: nowrap; }
    .tag-agent { background: #1e1e2e; color: #94a3b8; }
    .tag-critical { background: #3b0a0a; color: #f87171; }
    .tag-high { background: #2a0a0a; color: #ef4444; }
    .tag-normal { background: #1a1a2e; color: #a78bfa; }
    .tag-low { background: #0a1628; color: #3b82f6; }
    .tag-approval { background: #2a1a00; color: #f97316; }
    .card-sub { font-size: 10px; color: #475569; margin-top: 4px; }
    .card-actions { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
    .btn { padding: 3px 8px; border: none; border-radius: 5px; font-size: 10px; font-weight: 500; cursor: pointer; }
    .btn-queue { background: #1e1e3e; color: #818cf8; }
    .btn-cancel { background: #1e1e2e; color: #94a3b8; }
    .btn-retry { background: #2a1a00; color: #f59e0b; }
    .btn-del { background: #2a0a0a; color: #ef4444; }
    .latest-update { margin-top: 8px; padding: 8px; border-radius: 8px; background: #0f0f16; border: 1px solid #1e1e2e; }
    .latest-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
    .latest-note { font-size: 11px; color: #cbd5e1; line-height: 1.4; }

    .update-kind { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .kind-system { background: #1f2937; color: #cbd5e1; }
    .kind-progress { background: #172554; color: #93c5fd; }
    .kind-finding { background: #3f2a06; color: #fcd34d; }
    .kind-blocker { background: #450a0a; color: #fca5a5; }
    .kind-decision { background: #3b0764; color: #d8b4fe; }
    .kind-completion { background: #052e16; color: #86efac; }
    .phase-badge, .confidence-badge { border-radius: 999px; padding: 2px 8px; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .phase-badge { background: #111827; color: #94a3b8; }
    .confidence-badge { background: #1e1e2e; color: #94a3b8; }

    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
    .modal { background: #111118; border: 1px solid #1e1e2e; border-radius: 16px; padding: 24px; width: 500px; max-width: 90vw; max-height: 90vh; overflow: auto; }
    .modal h3 { font-size: 16px; font-weight: 600; color: #a78bfa; margin: 0 0 18px 0; }
    .form-row { margin-bottom: 14px; }
    .form-row label { display: block; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
    input, select, textarea { width: 100%; background: #0a0a0f; border: 1px solid #1e1e2e; color: #e2e8f0; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; box-sizing: border-box; }
    textarea { resize: vertical; min-height: 80px; }
    .check-row { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .check-row input[type="checkbox"] { width: auto; }
    .check-row label { font-size: 12px; color: #94a3b8; margin: 0; text-transform: none; letter-spacing: normal; }
    .form-row-inline { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .form-row-inline-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    .btn-modal-cancel { padding: 8px 16px; background: #1e1e2e; border: none; border-radius: 8px; color: #94a3b8; cursor: pointer; font-size: 13px; }
    .btn-modal-submit { padding: 8px 16px; background: #4c1d95; border: none; border-radius: 8px; color: #e9d5ff; cursor: pointer; font-size: 13px; }

    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
    .detail-field label { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; display: block; }
    .detail-field .val { font-size: 13px; color: #e2e8f0; }
    .timeline { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; max-height: 340px; overflow-y: auto; }
    .update { border: 1px solid #1e1e2e; border-radius: 10px; padding: 10px 12px; background: #0f0f16; }
    .update-head { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: #94a3b8; margin-bottom: 6px; }
    .update-head-left { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .update-note { font-size: 12px; color: #e2e8f0; line-height: 1.45; }
    .update-next { margin-top: 6px; font-size: 11px; color: #93c5fd; }
    .runs { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
    .run-item { display: flex; align-items: center; gap: 8px; background: #0f0f16; border: 1px solid #1e1e2e; border-radius: 6px; padding: 6px 10px; font-size: 11px; }
    .run-status { font-weight: 600; }
    .run-completed { color: #22c55e; }
    .run-failed { color: #ef4444; }
    .run-running { color: #f59e0b; }
    .note-input { display: flex; gap: 8px; margin-top: 8px; }
    .note-input input { flex: 1; }
    .note-input button { flex-shrink: 0; }
  `;

  @property({ attribute: false }) app!: AppFacade;

  @state() private showCreate = false;
  @state() private selectedTaskId = "";
  @state() private selectedTask: Task | null = null;
  @state() private showBlocked = false;
  @state() private showCancelled = false;
  @state() private formTitle = "";
  @state() private formDesc = "";
  @state() private formAgent = "";
  @state() private formPriority = "normal";
  @state() private formRequiresApproval = false;
  @state() private formParentId = "";
  @state() private updateNote = "";
  @state() private updateKind: NonNullable<TaskUpdateMetadata["kind"]> = "progress";
  @state() private updatePhase: NonNullable<TaskUpdateMetadata["phase"]> = "investigating";
  @state() private updateConfidence: NonNullable<TaskUpdateMetadata["confidence"]> = "medium";
  @state() private updateNextStep = "";

  private agentLabel(agent: AgentRow): string {
    return `${agent.identity?.emoji ?? ""} ${agent.identity?.name ?? agent.name ?? agent.id}`.trim();
  }

  private tasksByStatus(status: TaskStatus): Task[] {
    return this.app.tasks.filter((t) => t.status === status);
  }

  private latestUpdate(task: Task) {
    const updates = task.updates ?? [];
    return updates.length ? [...updates].sort((a, b) => b.createdAt - a.createdAt)[0] : null;
  }

  private async onSelectTask(taskId: string): Promise<void> {
    this.selectedTaskId = taskId;
    const detail = await this.app.getTaskDetail(taskId);
    this.selectedTask = detail ?? null;
  }

  private async onSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.formTitle.trim() || !this.formAgent) return;
    await this.app.createTask({
      title: this.formTitle.trim(),
      description: this.formDesc.trim() || undefined,
      agentId: this.formAgent,
      priority: this.formPriority,
      requiresApproval: this.formRequiresApproval,
      parentId: this.formParentId || undefined,
    });
    this.showCreate = false;
    this.formTitle = "";
    this.formDesc = "";
    this.formAgent = "";
    this.formPriority = "normal";
    this.formRequiresApproval = false;
    this.formParentId = "";
  }

  private renderLatestUpdate(task: Task) {
    const update = this.latestUpdate(task);
    if (!update) return "";
    const kind = update.metadata?.kind ?? "system";
    return html`
      <div class="latest-update">
        <div class="latest-head">
          <span class="update-kind ${KIND_CLASS[kind]}">${KIND_LABELS[kind]}</span>
          ${update.metadata?.phase ? html`<span class="phase-badge">${update.metadata.phase}</span>` : ""}
          <span class="card-sub">${new Date(update.createdAt).toLocaleTimeString()}</span>
        </div>
        <div class="latest-note">${update.note}</div>
      </div>
    `;
  }

  private renderCard(task: Task) {
    const agent = this.app.agents.find((a) => a.id === task.agentId);
    const agentLbl = agent ? this.agentLabel(agent) : task.agentId;
    const childCount = this.app.tasks.filter((t) => t.parentId === task.id).length;

    return html`
      <div class="card" @click=${() => void this.onSelectTask(task.id)}>
        <div class="card-title">${task.title}</div>
        <div class="card-meta">
          <span class="tag tag-agent">${agentLbl}</span>
          <span class="tag tag-${task.priority}">${task.priority}</span>
          ${task.requiresApproval ? html`<span class="tag tag-approval">approval</span>` : ""}
        </div>
        ${childCount > 0 ? html`<div class="card-sub">${childCount} subtask${childCount > 1 ? "s" : ""}</div>` : ""}
        ${task.deadlineAt ? html`<div class="card-sub">Due: ${new Date(task.deadlineAt).toLocaleDateString()}</div>` : ""}
        ${this.renderLatestUpdate(task)}
        <div class="card-actions" @click=${(e: Event) => e.stopPropagation()}>
          ${task.status === "pending" ? html`<button class="btn btn-queue" @click=${() => void this.app.queueTask(task.id)}>Queue</button>` : ""}
          ${task.status === "failed" ? html`<button class="btn btn-retry" @click=${() => void this.app.retryTask(task.id)}>Retry</button>` : ""}
          ${!["done", "cancelled", "failed"].includes(task.status) ? html`<button class="btn btn-cancel" @click=${() => void this.app.cancelTask(task.id)}>Cancel</button>` : ""}
          <button class="btn btn-del" @click=${() => { if (confirm(`Delete "${task.title}"?`)) void this.app.deleteTask(task.id); }}>Del</button>
        </div>
      </div>
    `;
  }

  private renderCol(col: ColumnDef) {
    const tasks = this.tasksByStatus(col.status);
    return html`
      <div class="col">
        <div class="col-head" style="color: ${col.color}">
          <span>${col.label}</span>
          <span class="col-count">${tasks.length}</span>
        </div>
        <div class="col-body">${tasks.map((t) => this.renderCard(t))}</div>
      </div>
    `;
  }

  private async onAddNote(): Promise<void> {
    if (!this.selectedTaskId || !this.updateNote.trim()) return;
    await this.app.addTaskUpdate(this.selectedTaskId, this.updateNote.trim(), "operator", {
      kind: this.updateKind,
      phase: this.updatePhase,
      confidence: this.updateConfidence,
      nextStep: this.updateNextStep.trim() || undefined,
      blocker: this.updateKind === "blocker",
    });
    this.updateNote = "";
    this.updateNextStep = "";
    const detail = await this.app.getTaskDetail(this.selectedTaskId);
    this.selectedTask = detail ?? null;
  }

  private renderTaskDetail() {
    const task = this.selectedTask;
    if (!task) return "";

    const updates = [...(task.updates ?? [])].sort((a, b) => b.createdAt - a.createdAt);
    const runs = task.runs ?? [];
    const deps = task.dependencies ?? [];

    return html`
      <div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) { this.selectedTaskId = ""; this.selectedTask = null; } }}>
        <div class="modal" style="width: 760px;">
          <h3>${task.title}</h3>

          <div class="detail-grid">
            <div class="detail-field"><label>Status</label><div class="val">${task.status}</div></div>
            <div class="detail-field"><label>Priority</label><div class="val">${task.priority}</div></div>
            <div class="detail-field"><label>Agent</label><div class="val">${task.agentId}</div></div>
            <div class="detail-field"><label>Type</label><div class="val">${task.taskType}</div></div>
            ${task.scheduledAt ? html`<div class="detail-field"><label>Scheduled</label><div class="val">${new Date(task.scheduledAt).toLocaleString()}</div></div>` : ""}
            ${task.deadlineAt ? html`<div class="detail-field"><label>Deadline</label><div class="val">${new Date(task.deadlineAt).toLocaleString()}</div></div>` : ""}
            ${task.startedAt ? html`<div class="detail-field"><label>Started</label><div class="val">${new Date(task.startedAt).toLocaleString()}</div></div>` : ""}
            ${task.completedAt ? html`<div class="detail-field"><label>Completed</label><div class="val">${new Date(task.completedAt).toLocaleString()}</div></div>` : ""}
          </div>

          ${task.description ? html`<div class="form-row"><label>Description</label><div style="font-size:13px;color:#94a3b8;line-height:1.5;">${task.description}</div></div>` : ""}
          ${task.errorMessage ? html`<div class="form-row"><label>Error</label><div style="font-size:12px;color:#ef4444;">${task.errorMessage}</div></div>` : ""}

          ${deps.length > 0 ? html`
            <div class="form-row">
              <label>Dependencies</label>
              <div style="font-size:12px;color:#94a3b8;">${deps.map((d) => {
                const depTask = this.app.tasks.find((t) => t.id === d);
                return html`<div>${depTask ? `${depTask.title} (${depTask.status})` : d}</div>`;
              })}</div>
            </div>
          ` : ""}

          ${runs.length > 0 ? html`
            <div class="form-row">
              <label>Execution Runs</label>
              <div class="runs">
                ${runs.map((r) => html`
                  <div class="run-item">
                    <span class="run-status run-${r.status}">#${r.runNumber} ${r.status}</span>
                    ${r.durationMs ? html`<span style="color:#64748b">${(r.durationMs / 1000).toFixed(1)}s</span>` : ""}
                    ${r.error ? html`<span style="color:#ef4444;font-size:10px;">${r.error}</span>` : ""}
                  </div>
                `)}
              </div>
            </div>
          ` : ""}

          <div class="form-row">
            <label>Add Timeline Update</label>
            <div class="form-row-inline-3">
              <div>
                <label>Type</label>
                <select .value=${this.updateKind} @change=${(e: Event) => { this.updateKind = (e.target as HTMLSelectElement).value as NonNullable<TaskUpdateMetadata["kind"]>; }}>
                  <option value="progress">Progress</option>
                  <option value="finding">Finding</option>
                  <option value="blocker">Blocker</option>
                  <option value="decision">Decision</option>
                  <option value="completion">Completion</option>
                  <option value="system">System</option>
                </select>
              </div>
              <div>
                <label>Phase</label>
                <select .value=${this.updatePhase} @change=${(e: Event) => { this.updatePhase = (e.target as HTMLSelectElement).value as NonNullable<TaskUpdateMetadata["phase"]>; }}>
                  <option value="planning">Planning</option>
                  <option value="investigating">Investigating</option>
                  <option value="implementing">Implementing</option>
                  <option value="validating">Validating</option>
                  <option value="reporting">Reporting</option>
                </select>
              </div>
              <div>
                <label>Confidence</label>
                <select .value=${this.updateConfidence} @change=${(e: Event) => { this.updateConfidence = (e.target as HTMLSelectElement).value as NonNullable<TaskUpdateMetadata["confidence"]>; }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div class="note-input">
              <input .value=${this.updateNote} @input=${(e: Event) => { this.updateNote = (e.target as HTMLInputElement).value; }} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") void this.onAddNote(); }} placeholder="What is the agent doing, struggling with, or discovering?" />
              <button class="btn-modal-submit" style="padding:8px 12px;" @click=${() => void this.onAddNote()}>Add</button>
            </div>
            <div style="margin-top:8px;">
              <input .value=${this.updateNextStep} @input=${(e: Event) => { this.updateNextStep = (e.target as HTMLInputElement).value; }} placeholder="Optional next step preview" />
            </div>
          </div>

          <div class="form-row">
            <label>Timeline</label>
            <div class="timeline">
              ${updates.length ? updates.map((u) => {
                const kind = u.metadata?.kind ?? "system";
                return html`
                  <div class="update">
                    <div class="update-head">
                      <div class="update-head-left">
                        <span>${u.author}${u.status ? ` - ${u.status}` : ""}</span>
                        <span class="update-kind ${KIND_CLASS[kind]}">${KIND_LABELS[kind]}</span>
                        ${u.metadata?.phase ? html`<span class="phase-badge">${u.metadata.phase}</span>` : ""}
                        ${u.metadata?.confidence ? html`<span class="confidence-badge">${u.metadata.confidence}</span>` : ""}
                      </div>
                      <span>${new Date(u.createdAt).toLocaleString()}</span>
                    </div>
                    <div class="update-note">${u.note}</div>
                    ${u.metadata?.nextStep ? html`<div class="update-next">Next: ${u.metadata.nextStep}</div>` : ""}
                  </div>
                `;
              }) : html`<div style="font-size:12px;color:#374151;font-style:italic;">No updates yet.</div>`}
            </div>
          </div>

          <div class="modal-actions">
            ${task.status === "failed" ? html`<button class="btn-modal-submit" style="background:#2a1a00;color:#f59e0b;" @click=${() => { void this.app.retryTask(task.id); this.selectedTaskId = ""; this.selectedTask = null; }}>Retry</button>` : ""}
            ${!["done", "cancelled"].includes(task.status) ? html`<button class="btn-modal-cancel" @click=${() => { void this.app.cancelTask(task.id); this.selectedTaskId = ""; this.selectedTask = null; }}>Cancel Task</button>` : ""}
            <button class="btn-modal-cancel" @click=${() => { this.selectedTaskId = ""; this.selectedTask = null; }}>Close</button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const eng = this.app.engineStatus;
    const blocked = this.tasksByStatus("blocked");
    const cancelled = this.tasksByStatus("cancelled");

    return html`
      <div class="toolbar">
        <h2>Tasks</h2>
        ${eng ? html`
          <div class="engine-pill">
            <div class="engine-dot ${eng.running ? "engine-on" : "engine-off"}"></div>
            Engine ${eng.running ? "ON" : "OFF"}
            ${eng.activeTasks > 0 ? html` | ${eng.activeTasks} active` : ""}
          </div>
        ` : ""}
        <div class="filter-group">
          ${blocked.length > 0 ? html`
            <button class="filter-btn ${this.showBlocked ? "active" : ""}" @click=${() => { this.showBlocked = !this.showBlocked; }}>Blocked (${blocked.length})</button>
          ` : ""}
          ${cancelled.length > 0 ? html`
            <button class="filter-btn ${this.showCancelled ? "active" : ""}" @click=${() => { this.showCancelled = !this.showCancelled; }}>Cancelled (${cancelled.length})</button>
          ` : ""}
        </div>
        <button class="create-btn" @click=${() => { this.showCreate = true; }}>+ New Task</button>
      </div>

      <div class="kanban">
        ${COLUMNS.map((col) => this.renderCol(col))}
      </div>

      ${this.showBlocked && blocked.length > 0 ? html`
        <div style="padding: 8px 20px; border-top: 1px solid #1e1e2e; max-height: 200px; overflow-y: auto;">
          <div style="font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 6px;">BLOCKED TASKS</div>
          ${blocked.map((t) => this.renderCard(t))}
        </div>
      ` : ""}

      ${this.showCancelled && cancelled.length > 0 ? html`
        <div style="padding: 8px 20px; border-top: 1px solid #1e1e2e; max-height: 200px; overflow-y: auto;">
          <div style="font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 6px;">CANCELLED TASKS</div>
          ${cancelled.map((t) => this.renderCard(t))}
        </div>
      ` : ""}

      ${this.showCreate ? html`
        <div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showCreate = false; }}>
          <div class="modal">
            <h3>New Task</h3>
            <form @submit=${this.onSubmit}>
              <div class="form-row">
                <label>Title</label>
                <input required .value=${this.formTitle} @input=${(e: Event) => { this.formTitle = (e.target as HTMLInputElement).value; }} />
              </div>
              <div class="form-row-inline">
                <div>
                  <label style="display:block;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Agent</label>
                  <select required .value=${this.formAgent} @change=${(e: Event) => { this.formAgent = (e.target as HTMLSelectElement).value; }}>
                    <option value="">Select agent...</option>
                    ${this.app.agents.map((a) => html`<option value=${a.id}>${this.agentLabel(a)}</option>`)}
                  </select>
                </div>
                <div>
                  <label style="display:block;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Priority</label>
                  <select .value=${this.formPriority} @change=${(e: Event) => { this.formPriority = (e.target as HTMLSelectElement).value; }}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <label>Description</label>
                <textarea .value=${this.formDesc} @input=${(e: Event) => { this.formDesc = (e.target as HTMLTextAreaElement).value; }}></textarea>
              </div>
              <div class="form-row">
                <label>Parent Task (optional)</label>
                <select .value=${this.formParentId} @change=${(e: Event) => { this.formParentId = (e.target as HTMLSelectElement).value; }}>
                  <option value="">None (top-level)</option>
                  ${this.app.tasks.filter((t) => !["done", "cancelled"].includes(t.status)).map((t) => html`<option value=${t.id}>${t.title}</option>`)}
                </select>
              </div>
              <div class="check-row">
                <input type="checkbox" id="req-approval" .checked=${this.formRequiresApproval} @change=${(e: Event) => { this.formRequiresApproval = (e.target as HTMLInputElement).checked; }} />
                <label for="req-approval">Require approval before execution</label>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn-modal-cancel" @click=${() => { this.showCreate = false; }}>Cancel</button>
                <button type="submit" class="btn-modal-submit">Create Task</button>
              </div>
            </form>
          </div>
        </div>
      ` : ""}

      ${this.selectedTask ? this.renderTaskDetail() : ""}
    `;
  }
}
