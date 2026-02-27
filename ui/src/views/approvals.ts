import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, ApprovalRequest } from "../app.ts";

@customElement("mc-approvals")
export class McApprovals extends LitElement {
  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .toolbar { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #1e1e2e; flex-shrink: 0; }
    .toolbar h2 { font-size: 15px; font-weight: 600; color: #a78bfa; margin: 0; }
    .stat { font-size: 12px; color: #64748b; }
    .stat strong { color: #f97316; }

    .list { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px; }

    .approval-card {
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 12px;
      padding: 16px;
      transition: border-color 0.15s;
    }
    .approval-card.pending { border-left: 3px solid #f97316; }
    .approval-card.approved { border-left: 3px solid #22c55e; }
    .approval-card.rejected { border-left: 3px solid #ef4444; }
    .approval-card.expired { border-left: 3px solid #374151; }

    .approval-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10px; }
    .approval-title { font-size: 14px; font-weight: 600; color: #e2e8f0; }
    .approval-type {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      border-radius: 4px;
      background: #1e1e2e;
      color: #94a3b8;
    }

    .approval-meta { font-size: 12px; color: #64748b; margin-bottom: 10px; line-height: 1.5; }
    .approval-desc { font-size: 12px; color: #94a3b8; margin-bottom: 12px; line-height: 1.5; }

    .approval-actions { display: flex; gap: 8px; align-items: center; }
    .note-input { flex: 1; background: #0a0a0f; border: 1px solid #1e1e2e; color: #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 12px; font-family: inherit; }
    .btn-approve {
      padding: 6px 16px;
      background: #14532d;
      color: #4ade80;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-reject {
      padding: 6px 16px;
      background: #450a0a;
      color: #f87171;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .decision-info { font-size: 11px; color: #64748b; margin-top: 8px; }
    .decision-info .approved { color: #22c55e; }
    .decision-info .rejected { color: #ef4444; }

    .empty { text-align: center; padding: 80px 0; color: #374151; font-size: 14px; }

    .tab-row { display: flex; gap: 4px; }
    .tab-btn { padding: 4px 12px; border: 1px solid #1e1e2e; background: none; color: #64748b; border-radius: 6px; font-size: 11px; cursor: pointer; }
    .tab-btn.active { background: #1e1e2e; color: #a78bfa; border-color: #4c1d95; }
  `;

  @property({ attribute: false }) app!: AppFacade;

  @state() private filter: "pending" | "all" = "pending";
  @state() private notes: Record<string, string> = {};

  private get filteredApprovals(): ApprovalRequest[] {
    if (this.filter === "pending") {
      return this.app.approvals.filter((a) => a.status === "pending");
    }
    return this.app.approvals;
  }

  private async onResolve(id: string, decision: "approved" | "rejected"): Promise<void> {
    const note = this.notes[id]?.trim();
    await this.app.resolveApproval(id, decision, note);
    const next = { ...this.notes };
    delete next[id];
    this.notes = next;
  }

  private renderApproval(approval: ApprovalRequest) {
    const isPending = approval.status === "pending";
    const task = this.app.tasks.find((t) => t.id === approval.taskId);

    return html`
      <div class="approval-card ${approval.status}">
        <div class="approval-header">
          <div class="approval-title">${approval.title}</div>
          <span class="approval-type">${approval.requestType.replace("_", " ")}</span>
        </div>

        <div class="approval-meta">
          ${task ? html`Task: <strong>${task.title}</strong> (${task.agentId})` : html`Task: ${approval.taskId}`}
          <br />
          Requested: ${new Date(approval.createdAt).toLocaleString()}
          ${approval.requestedBy ? html` by ${approval.requestedBy}` : ""}
        </div>

        ${approval.description ? html`<div class="approval-desc">${approval.description}</div>` : ""}

        ${isPending ? html`
          <div class="approval-actions">
            <input
              class="note-input"
              placeholder="Optional note..."
              .value=${this.notes[approval.id] ?? ""}
              @input=${(e: Event) => {
                this.notes = { ...this.notes, [approval.id]: (e.target as HTMLInputElement).value };
              }}
            />
            <button class="btn-approve" @click=${() => void this.onResolve(approval.id, "approved")}>Approve</button>
            <button class="btn-reject" @click=${() => void this.onResolve(approval.id, "rejected")}>Reject</button>
          </div>
        ` : html`
          <div class="decision-info">
            Decision: <span class="${approval.status}">${approval.status}</span>
            ${approval.decidedBy ? html` by ${approval.decidedBy}` : ""}
            ${approval.decidedAt ? html` at ${new Date(approval.decidedAt).toLocaleString()}` : ""}
            ${approval.decisionNote ? html`<br />Note: ${approval.decisionNote}` : ""}
          </div>
        `}
      </div>
    `;
  }

  render() {
    const pending = this.app.approvals.filter((a) => a.status === "pending");
    const filtered = this.filteredApprovals;

    return html`
      <div class="toolbar">
        <h2>Approvals</h2>
        <div class="stat"><strong>${pending.length}</strong> pending</div>
        <div class="tab-row">
          <button class="tab-btn ${this.filter === "pending" ? "active" : ""}" @click=${() => { this.filter = "pending"; }}>Pending</button>
          <button class="tab-btn ${this.filter === "all" ? "active" : ""}" @click=${() => { this.filter = "all"; }}>All</button>
        </div>
      </div>

      <div class="list">
        ${filtered.length > 0
          ? filtered.map((a) => this.renderApproval(a))
          : html`<div class="empty">${this.filter === "pending" ? "No pending approvals" : "No approval history"}</div>`}
      </div>
    `;
  }
}
