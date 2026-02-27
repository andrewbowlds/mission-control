import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, Workflow, WorkflowStep, WorkflowRun, TaskTemplate } from "../app.ts";

@customElement("mc-workflows")
export class McWorkflows extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  @state() private selectedWorkflowId: string | null = null;
  @state() private selectedRunId: string | null = null;
  @state() private showCreateModal = false;
  @state() private showStepModal = false;
  @state() private editingStepId: string | null = null;

  // Create workflow form
  @state() private newName = "";
  @state() private newDescription = "";
  @state() private newTriggerType: "manual" | "cron" | "event" = "manual";
  @state() private newTriggerConfig = "";

  // Step form
  @state() private stepName = "";
  @state() private stepTemplateId = "";
  @state() private stepOnFailure: "stop" | "skip" | "retry" = "stop";
  @state() private stepRetryCount = 0;
  @state() private stepConditionJson = "";
  @state() private stepContextOverrides = "";

  static styles = css`
    :host { display: flex; height: 100%; overflow: hidden; }

    /* ── Left panel: workflow list ─────────────────────────────────── */
    .list-panel {
      width: 280px; flex-shrink: 0; border-right: 1px solid #1e1e2e;
      display: flex; flex-direction: column; background: #0d0d14;
    }
    .list-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid #1e1e2e;
    }
    .list-header h3 { margin: 0; font-size: 14px; font-weight: 600; }
    .list-items { flex: 1; overflow-y: auto; }
    .wf-item {
      padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #111118;
      transition: background 0.1s;
    }
    .wf-item:hover { background: #111118; }
    .wf-item.active { background: #1a1a2e; border-left: 3px solid #a78bfa; }
    .wf-item-name { font-size: 13px; font-weight: 500; }
    .wf-item-meta { font-size: 11px; color: #64748b; margin-top: 2px; display: flex; gap: 8px; align-items: center; }
    .trigger-badge {
      font-size: 10px; padding: 1px 6px; border-radius: 4px;
      background: #1e1e2e; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .trigger-badge.cron { background: #1a2332; color: #60a5fa; }
    .trigger-badge.event { background: #1a2e1a; color: #4ade80; }
    .enabled-dot { width: 6px; height: 6px; border-radius: 50%; }
    .dot-on { background: #22c55e; }
    .dot-off { background: #475569; }

    /* ── Right panel: detail ────────────────────────────────────────── */
    .detail-panel { flex: 1; overflow-y: auto; padding: 20px; }
    .empty-detail { display: flex; align-items: center; justify-content: center; height: 100%; color: #475569; font-size: 14px; }

    .detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .detail-header h2 { margin: 0; font-size: 18px; }
    .detail-desc { font-size: 13px; color: #94a3b8; margin-bottom: 16px; }

    /* ── Section cards ────────────────────────────────────────────── */
    .section { background: #111118; border: 1px solid #1e1e2e; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .section-title { font-size: 13px; font-weight: 600; margin-bottom: 12px; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.04em; }

    /* ── Steps ───────────────────────────────────────────────────── */
    .step-list { display: flex; flex-direction: column; gap: 8px; }
    .step-item {
      display: flex; align-items: center; gap: 10px;
      background: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 6px; padding: 10px 12px;
    }
    .step-order {
      width: 24px; height: 24px; border-radius: 50%; background: #1e1e2e;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: #a78bfa; flex-shrink: 0;
    }
    .step-info { flex: 1; min-width: 0; }
    .step-name { font-size: 13px; font-weight: 500; }
    .step-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
    .step-actions { display: flex; gap: 4px; }

    /* ── Run history ─────────────────────────────────────────────── */
    .run-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .run-table th { text-align: left; padding: 6px 8px; color: #64748b; font-weight: 500; border-bottom: 1px solid #1e1e2e; }
    .run-table td { padding: 6px 8px; border-bottom: 1px solid #111118; }
    .run-table tr { cursor: pointer; }
    .run-table tr:hover td { background: #111118; }
    .status-badge {
      font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 600;
    }
    .status-running { background: #1a2332; color: #60a5fa; }
    .status-completed { background: #0f2e1a; color: #4ade80; }
    .status-failed { background: #2e0f0f; color: #f87171; }
    .status-cancelled { background: #1e1e2e; color: #94a3b8; }
    .status-pending { background: #1e1e2e; color: #94a3b8; }
    .status-skipped { background: #1e1e2e; color: #64748b; }

    /* ── Run detail ──────────────────────────────────────────────── */
    .run-steps { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
    .run-step {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 6px;
    }
    .run-step-name { flex: 1; font-size: 12px; }
    .run-step-time { font-size: 11px; color: #64748b; }

    /* ── Buttons ─────────────────────────────────────────────────── */
    button {
      background: #0a0a0f; color: #e2e8f0; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
    }
    button:hover { background: #1e1e2e; }
    .btn-primary { background: #7c3aed; border-color: #8b5cf6; }
    .btn-primary:hover { background: #8b5cf6; }
    .btn-danger { color: #ef4444; border-color: #3b0a0a; }
    .btn-danger:hover { background: #3b0a0a; }
    .btn-success { background: #15803d; border-color: #22c55e; }
    .btn-success:hover { background: #16a34a; }
    .btn-sm { padding: 3px 8px; font-size: 11px; }

    /* ── Modal ────────────────────────────────────────────────────── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100;
      display: flex; align-items: center; justify-content: center;
    }
    .modal {
      background: #111118; border: 1px solid #2d2d44; border-radius: 10px;
      padding: 24px; width: 440px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
    }
    .modal h3 { margin: 0 0 16px; font-size: 16px; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%; background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit;
      box-sizing: border-box;
    }
    .form-group textarea { min-height: 60px; resize: vertical; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  `;

  private get selectedWorkflow(): Workflow | undefined {
    return this.app.workflows.find((w) => w.id === this.selectedWorkflowId);
  }

  private get workflowRuns(): WorkflowRun[] {
    if (!this.selectedWorkflowId) return [];
    return this.app.workflowRuns.filter((r) => r.workflowId === this.selectedWorkflowId);
  }

  private get selectedRun(): WorkflowRun | undefined {
    return this.app.workflowRuns.find((r) => r.id === this.selectedRunId);
  }

  private fmtTime(ts?: number): string {
    if (!ts) return "-";
    return new Date(ts).toLocaleString();
  }

  private fmtDuration(startMs?: number, endMs?: number): string {
    if (!startMs) return "-";
    const end = endMs ?? Date.now();
    const secs = Math.round((end - startMs) / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  private templateName(id?: string): string {
    if (!id) return "Inline";
    const t = this.app.templates.find((t) => t.id === id);
    return t?.name ?? id.slice(0, 8);
  }

  // ── Create Workflow ──────────────────────────────────────────────────────

  private openCreateModal(): void {
    this.newName = "";
    this.newDescription = "";
    this.newTriggerType = "manual";
    this.newTriggerConfig = "";
    this.showCreateModal = true;
  }

  private async submitCreate(): Promise<void> {
    if (!this.newName.trim()) return;
    const wf = await this.app.createWorkflow({
      name: this.newName.trim(),
      description: this.newDescription.trim() || undefined,
      triggerType: this.newTriggerType,
      triggerConfigJson: this.newTriggerConfig.trim() || undefined,
    });
    if (wf) this.selectedWorkflowId = wf.id;
    this.showCreateModal = false;
  }

  // ── Step management ──────────────────────────────────────────────────────

  private openAddStep(): void {
    this.editingStepId = null;
    this.stepName = "";
    this.stepTemplateId = "";
    this.stepOnFailure = "stop";
    this.stepRetryCount = 0;
    this.stepConditionJson = "";
    this.stepContextOverrides = "";
    this.showStepModal = true;
  }

  private openEditStep(step: WorkflowStep): void {
    this.editingStepId = step.id;
    this.stepName = step.name;
    this.stepTemplateId = step.templateId ?? "";
    this.stepOnFailure = step.onFailure;
    this.stepRetryCount = step.retryCount;
    this.stepConditionJson = step.conditionJson ?? "";
    this.stepContextOverrides = step.contextOverridesJson ?? "";
    this.showStepModal = true;
  }

  private async submitStep(): Promise<void> {
    if (!this.stepName.trim()) return;
    const data = {
      name: this.stepName.trim(),
      templateId: this.stepTemplateId || undefined,
      onFailure: this.stepOnFailure,
      retryCount: this.stepRetryCount,
      conditionJson: this.stepConditionJson.trim() || undefined,
      contextOverridesJson: this.stepContextOverrides.trim() || undefined,
    };
    if (this.editingStepId) {
      await this.app.updateWorkflowStep(this.editingStepId, data);
    } else if (this.selectedWorkflowId) {
      await this.app.addWorkflowStep(this.selectedWorkflowId, data);
    }
    this.showStepModal = false;
  }

  private async deleteStep(stepId: string): Promise<void> {
    if (!confirm("Remove this step?")) return;
    await this.app.removeWorkflowStep(stepId);
  }

  // ── Workflow actions ─────────────────────────────────────────────────────

  private async toggleEnabled(wf: Workflow): Promise<void> {
    await this.app.updateWorkflow(wf.id, { enabled: !wf.enabled });
  }

  private async deleteWorkflow(wf: Workflow): Promise<void> {
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    await this.app.deleteWorkflow(wf.id);
    if (this.selectedWorkflowId === wf.id) this.selectedWorkflowId = null;
  }

  private async runWorkflow(): Promise<void> {
    if (!this.selectedWorkflowId) return;
    await this.app.startWorkflow(this.selectedWorkflowId);
  }

  private async cancelRun(runId: string): Promise<void> {
    await this.app.cancelWorkflowRun(runId);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    return html`
      ${this.renderListPanel()}
      ${this.renderDetailPanel()}
      ${this.showCreateModal ? this.renderCreateModal() : nothing}
      ${this.showStepModal ? this.renderStepModal() : nothing}
    `;
  }

  private renderListPanel() {
    const workflows = this.app.workflows;
    return html`
      <div class="list-panel">
        <div class="list-header">
          <h3>Workflows</h3>
          <button class="btn-primary btn-sm" @click=${() => this.openCreateModal()}>+ New</button>
        </div>
        <div class="list-items">
          ${workflows.length === 0
            ? html`<div style="padding:20px;text-align:center;color:#475569;font-size:13px;">No workflows yet</div>`
            : workflows.map((wf) => html`
              <div class="wf-item ${this.selectedWorkflowId === wf.id ? "active" : ""}"
                   @click=${() => { this.selectedWorkflowId = wf.id; this.selectedRunId = null; }}>
                <div class="wf-item-name">${wf.name}</div>
                <div class="wf-item-meta">
                  <span class="trigger-badge ${wf.triggerType}">${wf.triggerType}</span>
                  <span>${wf.steps?.length ?? 0} steps</span>
                  <div class="enabled-dot ${wf.enabled ? "dot-on" : "dot-off"}"></div>
                </div>
              </div>
            `)}
        </div>
      </div>
    `;
  }

  private renderDetailPanel() {
    const wf = this.selectedWorkflow;
    if (!wf) return html`<div class="detail-panel"><div class="empty-detail">Select a workflow or create a new one</div></div>`;

    return html`
      <div class="detail-panel">
        <div class="detail-header">
          <h2>${wf.name}</h2>
          <span class="trigger-badge ${wf.triggerType}">${wf.triggerType}</span>
          <button class="btn-sm" @click=${() => this.toggleEnabled(wf)}>${wf.enabled ? "Disable" : "Enable"}</button>
          <button class="btn-success btn-sm" @click=${() => this.runWorkflow()}>Run Now</button>
          <button class="btn-danger btn-sm" @click=${() => this.deleteWorkflow(wf)}>Delete</button>
        </div>
        ${wf.description ? html`<div class="detail-desc">${wf.description}</div>` : nothing}

        <!-- Steps -->
        <div class="section">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div class="section-title">Steps</div>
            <button class="btn-sm" @click=${() => this.openAddStep()}>+ Add Step</button>
          </div>
          <div class="step-list">
            ${(wf.steps ?? []).sort((a, b) => a.stepOrder - b.stepOrder).map((step, i) => html`
              <div class="step-item">
                <div class="step-order">${i + 1}</div>
                <div class="step-info">
                  <div class="step-name">${step.name}</div>
                  <div class="step-meta">
                    Template: ${this.templateName(step.templateId)}
                    | On fail: ${step.onFailure}
                    ${step.retryCount > 0 ? html` | Retries: ${step.retryCount}` : nothing}
                  </div>
                </div>
                <div class="step-actions">
                  <button class="btn-sm" @click=${() => this.openEditStep(step)}>Edit</button>
                  <button class="btn-sm btn-danger" @click=${() => this.deleteStep(step.id)}>X</button>
                </div>
              </div>
            `)}
            ${(wf.steps ?? []).length === 0 ? html`<div style="color:#475569;font-size:12px;padding:8px;">No steps yet. Add one to get started.</div>` : nothing}
          </div>
        </div>

        <!-- Run History -->
        <div class="section">
          <div class="section-title">Run History</div>
          ${this.workflowRuns.length === 0
            ? html`<div style="color:#475569;font-size:12px;">No runs yet.</div>`
            : html`
              <table class="run-table">
                <thead><tr>
                  <th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th><th>Step</th><th></th>
                </tr></thead>
                <tbody>
                  ${this.workflowRuns.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20).map((run) => html`
                    <tr @click=${() => { this.selectedRunId = this.selectedRunId === run.id ? null : run.id; }}>
                      <td><span class="status-badge status-${run.status}">${run.status}</span></td>
                      <td style="font-size:11px;color:#94a3b8;">${run.triggerSource ?? "manual"}</td>
                      <td style="font-size:11px;">${this.fmtTime(run.startedAt)}</td>
                      <td style="font-size:11px;">${this.fmtDuration(run.startedAt, run.endedAt)}</td>
                      <td style="font-size:11px;">${run.currentStep + 1}/${run.steps?.length ?? "?"}</td>
                      <td>${run.status === "running" ? html`<button class="btn-sm btn-danger" @click=${(e: Event) => { e.stopPropagation(); this.cancelRun(run.id); }}>Cancel</button>` : nothing}</td>
                    </tr>
                    ${this.selectedRunId === run.id ? html`
                      <tr><td colspan="6" style="padding:0;">
                        <div class="run-steps">
                          ${(run.steps ?? []).map((rs) => html`
                            <div class="run-step">
                              <span class="status-badge status-${rs.status}" style="font-size:9px;">${rs.status}</span>
                              <span class="run-step-name">${rs.stepId.slice(0, 8)}</span>
                              <span class="run-step-time">${this.fmtDuration(rs.startedAt, rs.endedAt)}</span>
                              ${rs.error ? html`<span style="color:#f87171;font-size:11px;">${rs.error}</span>` : nothing}
                            </div>
                          `)}
                        </div>
                      </td></tr>
                    ` : nothing}
                  `)}
                </tbody>
              </table>
            `}
        </div>
      </div>
    `;
  }

  // ── Modals ──────────────────────────────────────────────────────────────

  private renderCreateModal() {
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showCreateModal = false; }}>
        <div class="modal">
          <h3>New Workflow</h3>
          <div class="form-group">
            <label>Name</label>
            <input .value=${this.newName} @input=${(e: Event) => { this.newName = (e.target as HTMLInputElement).value; }}>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea .value=${this.newDescription} @input=${(e: Event) => { this.newDescription = (e.target as HTMLTextAreaElement).value; }}></textarea>
          </div>
          <div class="form-group">
            <label>Trigger Type</label>
            <select .value=${this.newTriggerType} @change=${(e: Event) => { this.newTriggerType = (e.target as HTMLSelectElement).value as any; }}>
              <option value="manual">Manual</option>
              <option value="cron">Cron</option>
              <option value="event">Event</option>
            </select>
          </div>
          ${this.newTriggerType !== "manual" ? html`
            <div class="form-group">
              <label>Trigger Config (JSON)</label>
              <textarea .value=${this.newTriggerConfig} @input=${(e: Event) => { this.newTriggerConfig = (e.target as HTMLTextAreaElement).value; }}
                placeholder='${this.newTriggerType === "cron" ? '{"expr": "0 9 * * *", "tz": "UTC"}' : '{"eventType": "task_completed"}'}'></textarea>
            </div>
          ` : nothing}
          <div class="modal-actions">
            <button @click=${() => { this.showCreateModal = false; }}>Cancel</button>
            <button class="btn-primary" @click=${() => this.submitCreate()}>Create</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderStepModal() {
    const templates = this.app.templates;
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showStepModal = false; }}>
        <div class="modal">
          <h3>${this.editingStepId ? "Edit Step" : "Add Step"}</h3>
          <div class="form-group">
            <label>Step Name</label>
            <input .value=${this.stepName} @input=${(e: Event) => { this.stepName = (e.target as HTMLInputElement).value; }}>
          </div>
          <div class="form-group">
            <label>Template</label>
            <select .value=${this.stepTemplateId} @change=${(e: Event) => { this.stepTemplateId = (e.target as HTMLSelectElement).value; }}>
              <option value="">-- None (inline) --</option>
              ${templates.map((t) => html`<option value=${t.id}>${t.name}</option>`)}
            </select>
          </div>
          <div class="form-group">
            <label>On Failure</label>
            <select .value=${this.stepOnFailure} @change=${(e: Event) => { this.stepOnFailure = (e.target as HTMLSelectElement).value as any; }}>
              <option value="stop">Stop workflow</option>
              <option value="skip">Skip step</option>
              <option value="retry">Retry step</option>
            </select>
          </div>
          <div class="form-group">
            <label>Retry Count</label>
            <input type="number" min="0" max="10" .value=${String(this.stepRetryCount)}
              @input=${(e: Event) => { this.stepRetryCount = parseInt((e.target as HTMLInputElement).value) || 0; }}>
          </div>
          <div class="form-group">
            <label>Condition (JSON, optional)</label>
            <textarea .value=${this.stepConditionJson} @input=${(e: Event) => { this.stepConditionJson = (e.target as HTMLTextAreaElement).value; }}
              placeholder='{"field": "prevResult.success", "op": "eq", "value": true}'></textarea>
          </div>
          <div class="form-group">
            <label>Context Overrides (JSON, optional)</label>
            <textarea .value=${this.stepContextOverrides} @input=${(e: Event) => { this.stepContextOverrides = (e.target as HTMLTextAreaElement).value; }}></textarea>
          </div>
          <div class="modal-actions">
            <button @click=${() => { this.showStepModal = false; }}>Cancel</button>
            <button class="btn-primary" @click=${() => this.submitStep()}>${this.editingStepId ? "Save" : "Add"}</button>
          </div>
        </div>
      </div>
    `;
  }
}
