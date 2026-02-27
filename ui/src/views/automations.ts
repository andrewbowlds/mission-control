import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, AutomationRule, AutomationEventType, AutomationActionType } from "../app.ts";

@customElement("mc-automations")
export class McAutomations extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  @state() private showModal = false;
  @state() private editingId: string | null = null;

  // Form state
  @state() private formName = "";
  @state() private formDescription = "";
  @state() private formEventType: AutomationEventType = "task_completed";
  @state() private formEventFilter = "";
  @state() private formActionType: AutomationActionType = "create_task";
  @state() private formActionConfig = "";
  @state() private formCooldownMs = 0;
  @state() private formEnabled = true;

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box; }

    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .header h2 { margin: 0; font-size: 18px; }

    .rules-table { width: 100%; max-width: 1100px; border-collapse: collapse; font-size: 13px; }
    .rules-table th {
      text-align: left; padding: 8px 10px; color: #64748b; font-weight: 500;
      border-bottom: 1px solid #1e1e2e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .rules-table td { padding: 8px 10px; border-bottom: 1px solid #111118; }
    .rules-table tr:hover td { background: #111118; }

    .badge {
      font-size: 10px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;
      font-weight: 600; letter-spacing: 0.02em;
    }
    .badge-event { background: #1a2332; color: #60a5fa; }
    .badge-action { background: #1a2e1a; color: #4ade80; }

    .toggle {
      width: 36px; height: 20px; border-radius: 10px; border: none; cursor: pointer;
      position: relative; transition: background 0.15s;
    }
    .toggle.on { background: #22c55e; }
    .toggle.off { background: #374151; }
    .toggle::after {
      content: ""; position: absolute; top: 2px;
      width: 16px; height: 16px; border-radius: 50%; background: white;
      transition: left 0.15s;
    }
    .toggle.on::after { left: 18px; }
    .toggle.off::after { left: 2px; }

    .fire-count { font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; }
    .empty { text-align: center; padding: 40px; color: #475569; font-size: 14px; }

    button {
      background: #0a0a0f; color: #e2e8f0; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
    }
    button:hover { background: #1e1e2e; }
    .btn-primary { background: #7c3aed; border-color: #8b5cf6; }
    .btn-primary:hover { background: #8b5cf6; }
    .btn-danger { color: #ef4444; border-color: #3b0a0a; }
    .btn-danger:hover { background: #3b0a0a; }
    .btn-sm { padding: 3px 8px; font-size: 11px; }

    /* ── Modal ────────────────────────────────────────────────────── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100;
      display: flex; align-items: center; justify-content: center;
    }
    .modal {
      background: #111118; border: 1px solid #2d2d44; border-radius: 10px;
      padding: 24px; width: 500px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
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
    .form-row { display: flex; gap: 12px; }
    .form-row .form-group { flex: 1; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .hint { font-size: 11px; color: #475569; margin-top: 4px; }
    .form-check { display: flex; align-items: center; gap: 8px; }
    .form-check input[type="checkbox"] { width: auto; }
  `;

  private openCreate(): void {
    this.editingId = null;
    this.formName = "";
    this.formDescription = "";
    this.formEventType = "task_completed";
    this.formEventFilter = "";
    this.formActionType = "create_task";
    this.formActionConfig = "";
    this.formCooldownMs = 0;
    this.formEnabled = true;
    this.showModal = true;
  }

  private openEdit(rule: AutomationRule): void {
    this.editingId = rule.id;
    this.formName = rule.name;
    this.formDescription = rule.description ?? "";
    this.formEventType = rule.eventType;
    this.formEventFilter = rule.eventFilterJson && rule.eventFilterJson !== "{}" ? rule.eventFilterJson : "";
    this.formActionType = rule.actionType;
    this.formActionConfig = rule.actionConfigJson;
    this.formCooldownMs = rule.cooldownMs;
    this.formEnabled = rule.enabled;
    this.showModal = true;
  }

  private async submit(): Promise<void> {
    if (!this.formName.trim() || !this.formActionConfig.trim()) return;
    const data = {
      name: this.formName.trim(),
      description: this.formDescription.trim() || undefined,
      eventType: this.formEventType,
      eventFilterJson: this.formEventFilter.trim() || undefined,
      actionType: this.formActionType,
      actionConfigJson: this.formActionConfig.trim(),
      cooldownMs: this.formCooldownMs,
      enabled: this.formEnabled,
    };
    if (this.editingId) {
      await this.app.updateAutomationRule(this.editingId, data);
    } else {
      await this.app.createAutomationRule(data);
    }
    this.showModal = false;
  }

  private async toggleRule(rule: AutomationRule): Promise<void> {
    await this.app.updateAutomationRule(rule.id, { enabled: !rule.enabled });
  }

  private async deleteRule(rule: AutomationRule): Promise<void> {
    if (!confirm(`Delete automation rule "${rule.name}"?`)) return;
    await this.app.deleteAutomationRule(rule.id);
  }

  private actionPlaceholder(): string {
    switch (this.formActionType) {
      case "create_task": return '{"templateId": "<id>", "title": "Override title"}';
      case "start_workflow": return '{"workflowId": "<id>"}';
      case "send_message": return '{"message": "Alert: something happened"}';
      default: return "{}";
    }
  }

  render() {
    const rules = this.app.automationRules;
    return html`
      <div class="header">
        <h2>Automation Rules</h2>
        <button class="btn-primary btn-sm" @click=${() => this.openCreate()}>+ New Rule</button>
      </div>

      ${rules.length === 0
        ? html`<div class="empty">No automation rules yet. Create one to trigger actions on events.</div>`
        : html`
          <table class="rules-table">
            <thead><tr>
              <th>Enabled</th><th>Name</th><th>Event</th><th>Action</th><th>Cooldown</th><th>Fired</th><th>Last Fired</th><th></th>
            </tr></thead>
            <tbody>
              ${rules.map((rule) => html`
                <tr>
                  <td>
                    <button class="toggle ${rule.enabled ? "on" : "off"}" @click=${() => this.toggleRule(rule)}></button>
                  </td>
                  <td>
                    <div style="font-weight:500;">${rule.name}</div>
                    ${rule.description ? html`<div style="font-size:11px;color:#64748b;margin-top:2px;">${rule.description}</div>` : nothing}
                  </td>
                  <td><span class="badge badge-event">${rule.eventType.replace("_", " ")}</span></td>
                  <td><span class="badge badge-action">${rule.actionType.replace("_", " ")}</span></td>
                  <td style="font-size:12px;color:#94a3b8;">${rule.cooldownMs > 0 ? `${Math.round(rule.cooldownMs / 1000)}s` : "-"}</td>
                  <td><span class="fire-count">${rule.fireCount}</span></td>
                  <td style="font-size:11px;color:#64748b;">${rule.lastFiredAt ? new Date(rule.lastFiredAt).toLocaleString() : "-"}</td>
                  <td>
                    <div style="display:flex;gap:4px;">
                      <button class="btn-sm" @click=${() => this.openEdit(rule)}>Edit</button>
                      <button class="btn-sm btn-danger" @click=${() => this.deleteRule(rule)}>Del</button>
                    </div>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>
        `}

      ${this.showModal ? this.renderModal() : nothing}
    `;
  }

  private renderModal() {
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showModal = false; }}>
        <div class="modal">
          <h3>${this.editingId ? "Edit Automation Rule" : "New Automation Rule"}</h3>

          <div class="form-group">
            <label>Name</label>
            <input .value=${this.formName} @input=${(e: Event) => { this.formName = (e.target as HTMLInputElement).value; }}>
          </div>

          <div class="form-group">
            <label>Description</label>
            <input .value=${this.formDescription} @input=${(e: Event) => { this.formDescription = (e.target as HTMLInputElement).value; }}>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Event Type</label>
              <select .value=${this.formEventType} @change=${(e: Event) => { this.formEventType = (e.target as HTMLSelectElement).value as AutomationEventType; }}>
                <option value="task_completed">Task Completed</option>
                <option value="task_failed">Task Failed</option>
                <option value="cron">Cron</option>
              </select>
            </div>
            <div class="form-group">
              <label>Action Type</label>
              <select .value=${this.formActionType} @change=${(e: Event) => { this.formActionType = (e.target as HTMLSelectElement).value as AutomationActionType; }}>
                <option value="create_task">Create Task</option>
                <option value="start_workflow">Start Workflow</option>
                <option value="send_message">Send Message</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Event Filter (JSON, optional)</label>
            <textarea .value=${this.formEventFilter} @input=${(e: Event) => { this.formEventFilter = (e.target as HTMLTextAreaElement).value; }}
              placeholder='{"agentId": "default", "tags": ["billing"]}'></textarea>
            <div class="hint">Filter by agentId, tags, priority, or taskType</div>
          </div>

          <div class="form-group">
            <label>Action Config (JSON)</label>
            <textarea .value=${this.formActionConfig} @input=${(e: Event) => { this.formActionConfig = (e.target as HTMLTextAreaElement).value; }}
              placeholder=${this.actionPlaceholder()}></textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Cooldown (seconds)</label>
              <input type="number" min="0" .value=${String(Math.round(this.formCooldownMs / 1000))}
                @input=${(e: Event) => { this.formCooldownMs = (parseInt((e.target as HTMLInputElement).value) || 0) * 1000; }}>
            </div>
            <div class="form-group">
              <label>&nbsp;</label>
              <div class="form-check">
                <input type="checkbox" .checked=${this.formEnabled}
                  @change=${(e: Event) => { this.formEnabled = (e.target as HTMLInputElement).checked; }}>
                <span style="font-size:13px;">Enabled</span>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button @click=${() => { this.showModal = false; }}>Cancel</button>
            <button class="btn-primary" @click=${() => this.submit()}>${this.editingId ? "Save" : "Create"}</button>
          </div>
        </div>
      </div>
    `;
  }
}
