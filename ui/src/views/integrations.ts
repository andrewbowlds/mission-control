import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, Integration, GitHubRepo, GitHubIssue } from "../app.ts";

@customElement("mc-integrations")
export class McIntegrations extends LitElement {
  @property({ attribute: false }) app!: AppFacade;
  @state() private showGitHubConfig = false;
  @state() private githubToken = "";
  @state() private githubSecret = "";
  @state() private syncing: Record<string, boolean> = {};
  @state() private selectedRepoId: string | null = null;

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
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 12px;
      padding: 20px;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }
    .card-icon {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    .card-icon.gcal { background: #1a2744; }
    .card-icon.gcontacts { background: #1a3a2e; }
    .card-icon.github { background: #1a1a2e; }
    .card-title { font-weight: 600; font-size: 14px; }
    .card-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .status-badge.connected { background: #064e3b; color: #34d399; }
    .status-badge.disconnected { background: #1e1e2e; color: #64748b; }
    .status-badge.error { background: #450a0a; color: #f87171; }
    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .status-dot.connected { background: #34d399; }
    .status-dot.disconnected { background: #64748b; }
    .status-dot.error { background: #f87171; }
    .card-meta {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 12px;
    }
    .card-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid #374151;
      background: none;
      color: #94a3b8;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn:hover { border-color: #a78bfa; color: #a78bfa; }
    .btn.primary {
      background: #4c1d95;
      border-color: #6d28d9;
      color: #e2e8f0;
    }
    .btn.primary:hover { background: #5b21b6; }
    .btn.danger { color: #f87171; }
    .btn.danger:hover { border-color: #f87171; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Config modal */
    .config-section {
      background: #0a0a0f;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
      padding: 14px;
      margin-top: 12px;
    }
    .config-section label {
      display: block;
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
    }
    .config-section input {
      width: 100%;
      padding: 6px 10px;
      background: #111118;
      border: 1px solid #374151;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 12px;
      margin-bottom: 10px;
      box-sizing: border-box;
    }
    .config-section input:focus { outline: none; border-color: #a78bfa; }

    /* GitHub detail */
    .detail-section {
      margin-top: 16px;
    }
    .repo-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
    }
    .repo-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #0a0a0f;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .repo-item:hover { background: #1e1e2e; }
    .repo-item.active { background: #1e1e2e; border-left: 2px solid #a78bfa; }
    .repo-name { color: #94a3b8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-private { font-size: 9px; color: #f59e0b; }

    .issue-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 300px;
      overflow-y: auto;
      margin-top: 8px;
    }
    .issue-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: #0a0a0f;
      border-radius: 6px;
      font-size: 12px;
    }
    .issue-number { color: #64748b; font-weight: 600; flex-shrink: 0; }
    .issue-title { color: #94a3b8; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .issue-state {
      font-size: 9px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .issue-state.open { background: #064e3b; color: #34d399; }
    .issue-state.closed { background: #1e1e2e; color: #64748b; }
    .issue-pr { font-size: 9px; color: #818cf8; }
    .issue-linked { font-size: 9px; color: #a78bfa; }

    .none { font-size: 12px; color: #374151; font-style: italic; }
  `;

  private gcalIntegration(): Integration | undefined {
    return this.app.integrations.find((i) => i.type === "google_calendar");
  }

  private gcontactsIntegration(): Integration | undefined {
    return this.app.integrations.find((i) => i.type === "google_contacts");
  }

  private githubIntegration(): Integration | undefined {
    return this.app.integrations.find((i) => i.type === "github");
  }

  private fmtDate(ms?: number): string {
    if (!ms) return "Never";
    return new Date(ms).toLocaleString();
  }

  private async handleGCalConnect(): Promise<void> {
    const url = await this.app.gcalConnect();
    if (url) window.open(url, "_blank");
  }

  private async handleGCalSync(): Promise<void> {
    this.syncing = { ...this.syncing, gcal: true };
    await this.app.gcalSync();
    this.syncing = { ...this.syncing, gcal: false };
  }

  private async handleGContactsConnect(): Promise<void> {
    const url = await this.app.gcontactsConnect();
    if (url) window.open(url, "_blank");
  }

  private async handleGContactsSync(): Promise<void> {
    this.syncing = { ...this.syncing, gcontacts: true };
    await this.app.gcontactsSync();
    this.syncing = { ...this.syncing, gcontacts: false };
  }

  private async handleGitHubConnect(): Promise<void> {
    if (!this.githubToken.trim()) return;
    this.syncing = { ...this.syncing, ghConnect: true };
    await this.app.githubConnect({
      token: this.githubToken.trim(),
      webhookSecret: this.githubSecret.trim() || undefined,
    });
    this.githubToken = "";
    this.githubSecret = "";
    this.showGitHubConfig = false;
    this.syncing = { ...this.syncing, ghConnect: false };
  }

  private async handleGitHubSync(): Promise<void> {
    this.syncing = { ...this.syncing, github: true };
    await this.app.githubSync();
    this.syncing = { ...this.syncing, github: false };
  }

  render() {
    const gcal = this.gcalIntegration();
    const gc = this.gcontactsIntegration();
    const gh = this.githubIntegration();

    return html`
      <h2>Integrations</h2>

      <div class="grid">
        <!-- Google Calendar -->
        <div class="card">
          <div class="card-header">
            <div class="card-icon gcal">C</div>
            <div>
              <div class="card-title">Google Calendar</div>
              <div class="card-sub">Sync events and deadlines</div>
            </div>
          </div>

          <div class="status-badge ${gcal?.status ?? "disconnected"}">
            <div class="status-dot ${gcal?.status ?? "disconnected"}"></div>
            ${gcal?.status === "connected" ? "Connected" : gcal?.status === "error" ? "Error" : "Not Connected"}
          </div>

          ${gcal?.status === "connected" ? html`
            <div class="card-meta">
              Last sync: ${this.fmtDate(gcal.lastSyncAt)}<br>
              Events loaded: ${this.app.calendarEvents.length}
            </div>
            <div class="card-actions">
              <button class="btn" ?disabled=${this.syncing.gcal} @click=${() => void this.handleGCalSync()}>
                ${this.syncing.gcal ? "Syncing..." : "Sync Now"}
              </button>
              <button class="btn danger" @click=${() => void this.app.gcalDisconnect()}>Disconnect</button>
            </div>
          ` : html`
            ${gcal?.errorMessage ? html`<div class="card-meta" style="color: #f87171;">${gcal.errorMessage}</div>` : ""}
            <div class="card-actions">
              <button class="btn primary" @click=${() => void this.handleGCalConnect()}>Connect Google Calendar</button>
            </div>
          `}
        </div>

        <!-- Google Contacts -->
        <div class="card">
          <div class="card-header">
            <div class="card-icon gcontacts">P</div>
            <div>
              <div class="card-title">Google Contacts</div>
              <div class="card-sub">Sync contacts from Google</div>
            </div>
          </div>

          <div class="status-badge ${gc?.status ?? "disconnected"}">
            <div class="status-dot ${gc?.status ?? "disconnected"}"></div>
            ${gc?.status === "connected" ? "Connected" : gc?.status === "error" ? "Error" : "Not Connected"}
          </div>

          ${gc?.status === "connected" ? html`
            <div class="card-meta">
              Last sync: ${this.fmtDate(gc.lastSyncAt)}<br>
              Contacts: ${this.app.people.length}
            </div>
            <div class="card-actions">
              <button class="btn" ?disabled=${this.syncing.gcontacts} @click=${() => void this.handleGContactsSync()}>
                ${this.syncing.gcontacts ? "Syncing..." : "Sync Now"}
              </button>
              <button class="btn danger" @click=${() => void this.app.gcontactsDisconnect()}>Disconnect</button>
            </div>
          ` : html`
            ${gc?.errorMessage ? html`<div class="card-meta" style="color: #f87171;">${gc.errorMessage}</div>` : ""}
            <div class="card-actions">
              <button class="btn primary" @click=${() => void this.handleGContactsConnect()}>Connect Google Contacts</button>
            </div>
          `}
        </div>

        <!-- GitHub -->
        <div class="card">
          <div class="card-header">
            <div class="card-icon github">G</div>
            <div>
              <div class="card-title">GitHub</div>
              <div class="card-sub">Sync repos, issues & PRs</div>
            </div>
          </div>

          <div class="status-badge ${gh?.status ?? "disconnected"}">
            <div class="status-dot ${gh?.status ?? "disconnected"}"></div>
            ${gh?.status === "connected" ? "Connected" : gh?.status === "error" ? "Error" : "Not Connected"}
          </div>

          ${gh?.status === "connected" ? html`
            <div class="card-meta">
              Last sync: ${this.fmtDate(gh.lastSyncAt)}<br>
              Repos: ${this.app.githubRepos.length} | Issues: ${this.app.githubIssues.length}
            </div>
            <div class="card-actions">
              <button class="btn" ?disabled=${this.syncing.github} @click=${() => void this.handleGitHubSync()}>
                ${this.syncing.github ? "Syncing..." : "Sync Now"}
              </button>
              <button class="btn danger" @click=${() => void this.app.githubDisconnect()}>Disconnect</button>
            </div>
          ` : html`
            ${gh?.errorMessage ? html`<div class="card-meta" style="color: #f87171;">${gh.errorMessage}</div>` : ""}
            <div class="card-actions">
              <button class="btn primary" @click=${() => { this.showGitHubConfig = true; }}>Configure GitHub</button>
            </div>
            ${this.showGitHubConfig ? html`
              <div class="config-section">
                <label>Personal Access Token</label>
                <input type="password" placeholder="ghp_..." .value=${this.githubToken}
                  @input=${(e: Event) => { this.githubToken = (e.target as HTMLInputElement).value; }}>
                <label>Webhook Secret (optional)</label>
                <input type="text" placeholder="your-webhook-secret" .value=${this.githubSecret}
                  @input=${(e: Event) => { this.githubSecret = (e.target as HTMLInputElement).value; }}>
                <div class="card-actions">
                  <button class="btn primary" ?disabled=${this.syncing.ghConnect || !this.githubToken.trim()}
                    @click=${() => void this.handleGitHubConnect()}>
                    ${this.syncing.ghConnect ? "Connecting..." : "Connect"}
                  </button>
                  <button class="btn" @click=${() => { this.showGitHubConfig = false; }}>Cancel</button>
                </div>
              </div>
            ` : ""}
          `}
        </div>
      </div>

      <!-- GitHub Detail: Repos & Issues -->
      ${gh?.status === "connected" && this.app.githubRepos.length > 0 ? html`
        <div class="section-title">GitHub Repositories</div>
        <div class="detail-section" style="display: grid; grid-template-columns: 300px 1fr; gap: 16px;">
          <div>
            <div class="repo-list">
              ${this.app.githubRepos.map((repo) => html`
                <div class="repo-item ${this.selectedRepoId === repo.id ? "active" : ""}"
                  @click=${() => { this.selectedRepoId = repo.id; void this.app.loadGitHubIssues({ repoId: repo.id }); }}>
                  <span class="repo-name">${repo.fullName}</span>
                  ${repo.isPrivate ? html`<span class="repo-private">Private</span>` : ""}
                </div>
              `)}
            </div>
          </div>
          <div>
            ${this.selectedRepoId ? this.renderIssues() : html`<div class="none">Select a repository to view issues</div>`}
          </div>
        </div>
      ` : ""}
    `;
  }

  private renderIssues() {
    const issues = this.app.githubIssues.filter((i) => i.repoId === this.selectedRepoId);
    if (!issues.length) return html`<div class="none">No issues found</div>`;

    return html`
      <div class="issue-list">
        ${issues.map((issue) => html`
          <div class="issue-item">
            <span class="issue-number">#${issue.number}</span>
            <span class="issue-title">${issue.title}</span>
            ${issue.isPr ? html`<span class="issue-pr">PR</span>` : ""}
            <span class="issue-state ${issue.state}">${issue.state}</span>
            ${issue.taskId ? html`<span class="issue-linked">Linked</span>` : html`
              <button class="btn" style="padding: 2px 8px; font-size: 10px;"
                @click=${() => { this.handleCreateTask(issue); }}>
                + Task
              </button>
            `}
          </div>
        `)}
      </div>
    `;
  }

  private handleCreateTask(issue: GitHubIssue): void {
    const agentId = this.app.agents[0]?.id;
    if (!agentId) return;
    void this.app.githubCreateTask(issue.id, agentId);
  }
}
