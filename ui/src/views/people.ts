import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, Person } from "../app.ts";

type PersonStatus = Person["status"];
type ViewMode = "list" | "detail" | "add";
type GoogleConnectionStatus = {
  connected: boolean;
  accountEmail?: string;
  expiresAt?: number;
};

type GoogleSyncRun = {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "success" | "failed";
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errorSummary?: string;
};

function googleApiPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const onPrefixedRoute = window.location.pathname.startsWith("/mission-control");
  return `${onPrefixedRoute ? "/mission-control" : ""}/api/google${p}`;
}

const STATUS_OPTIONS: PersonStatus[] = ["lead", "prospect", "customer", "partner", "churned"];
const STATUS_COLORS: Record<PersonStatus, string> = {
  lead: "#3b82f6",
  prospect: "#a855f7",
  customer: "#22c55e",
  partner: "#eab308",
  churned: "#ef4444",
};

@customElement("mc-people")
export class MCPeople extends LitElement {
  @property({ attribute: false }) app!: AppFacade;
  @state() viewMode: ViewMode = "list";
  @state() selectedId = "";
  @state() actionError = "";
  @state() searchQuery = "";
  @state() filterStatus: PersonStatus | "" = "";
  @state() editing = false;
  @state() googleStatus: GoogleConnectionStatus = { connected: false };
  @state() googleSyncRun: GoogleSyncRun | null = null;
  @state() googleLoading = false;
  @state() googleSyncing = false;
  @state() googleError = "";

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box }

    .oauth-card {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
      margin-bottom: 14px; padding: 12px;
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
    }
    .oauth-meta { font-size: 12px; color: #94a3b8; display: flex; flex-direction: column; gap: 4px }

    .toolbar {
      display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .toolbar input[type="search"] { flex: 1; min-width: 180px }

    .status-badge {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    }

    .count { font-size: 12px; color: #94a3b8; margin-bottom: 10px; display: flex; gap: 12px; flex-wrap: wrap }

    table {
      width: 100%; border-collapse: collapse;
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      overflow: hidden;
    }
    th { text-align: left; padding: 10px 12px; font-size: 12px; color: #64748b;
         border-bottom: 1px solid #1e1e2e; background: #0d0d14; white-space: nowrap }
    td { padding: 10px 12px; border-bottom: 1px solid #16162a; font-size: 13px }
    tr:last-child td { border-bottom: none }
    tr.clickable { cursor: pointer; transition: background 100ms }
    tr.clickable:hover { background: #16162a }

    .tags { display: flex; gap: 4px; flex-wrap: wrap }
    .tag {
      background: #1e1e2e; border: 1px solid #2d2d44; border-radius: 4px;
      padding: 1px 6px; font-size: 11px; color: #94a3b8;
    }

    .detail-card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 20px; max-width: 700px;
    }
    .detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px }
    .detail-header h2 { margin: 0; font-size: 20px }
    .detail-grid {
      display: grid; grid-template-columns: 120px 1fr; gap: 8px 16px; font-size: 13px;
    }
    .detail-label { color: #64748b; font-weight: 500 }
    .detail-value { color: #e2e8f0 }
    .detail-notes {
      margin-top: 16px; padding: 12px; background: #0d0d14;
      border: 1px solid #1e1e2e; border-radius: 8px; font-size: 13px;
      white-space: pre-wrap; color: #cbd5e1; min-height: 40px;
    }
    .detail-actions { display: flex; gap: 8px; margin-top: 16px }

    .form-card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 20px; max-width: 600px;
    }
    .form-card h2 { margin: 0 0 16px; font-size: 18px }
    .form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px }
    .form-row label { font-size: 12px; color: #64748b; font-weight: 500 }
    .form-row input, .form-row select, .form-row textarea {
      background: #0a0a0f; color: #e2e8f0; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 8px; font-size: 13px;
    }
    .form-row textarea { min-height: 80px; resize: vertical; font-family: inherit }
    .form-row input::placeholder { color: #475569 }
    .form-actions { display: flex; gap: 8px; margin-top: 16px }

    .err { color: #f87171; font-size: 13px; margin-bottom: 10px }
    .muted { color: #475569; font-size: 12px }
    .empty { text-align: center; padding: 40px; color: #475569 }

    select, input, button {
      background: #0a0a0f; color: #e2e8f0; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 6px; font-size: 13px;
    }
    button { cursor: pointer; white-space: nowrap }
    button:hover { background: #1e1e2e }
    button.primary { background: #7c3aed; border-color: #8b5cf6 }
    button.primary:hover { background: #8b5cf6 }
    button.danger { background: #7f1d1d; border-color: #991b1b }
    button.danger:hover { background: #991b1b }

    .back-btn { margin-bottom: 12px }
  `;

  private get selectedPerson(): Person | undefined {
    return this.app.people.find((p) => p.id === this.selectedId);
  }

  private get filteredPeople(): Person[] {
    let list = this.app.people;
    if (this.filterStatus) list = list.filter((p) => p.status === this.filterStatus);
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.email?.toLowerCase().includes(q)) ||
          (p.company?.toLowerCase().includes(q)) ||
          (p.role?.toLowerCase().includes(q)) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }

  private openDetail(person: Person) {
    this.selectedId = person.id;
    this.viewMode = "detail";
    this.editing = false;
    this.actionError = "";
  }

  private backToList() {
    this.viewMode = "list";
    this.selectedId = "";
    this.editing = false;
    this.actionError = "";
  }

  private fmtDate(ts?: number): string {
    if (!ts) return "-";
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  private statusBadge(status: PersonStatus) {
    const bg = STATUS_COLORS[status] + "22";
    const color = STATUS_COLORS[status];
    return html`<span class="status-badge" style="background:${bg};color:${color};border:1px solid ${color}44">${status}</span>`;
  }

  connectedCallback() {
    super.connectedCallback();
    void Promise.all([this.loadGoogleStatus(), this.loadGoogleSyncStatus()]);
  }

  private async loadGoogleStatus() {
    this.googleLoading = true;
    this.googleError = "";
    try {
      const res = await fetch(googleApiPath("/status"), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`status failed (${res.status})`);
      this.googleStatus = (await res.json()) as GoogleConnectionStatus;
    } catch (err) {
      this.googleError = err instanceof Error ? err.message : String(err);
      this.googleStatus = { connected: false };
    } finally {
      this.googleLoading = false;
    }
  }

  private async loadGoogleSyncStatus() {
    try {
      const res = await fetch(googleApiPath("/sync/status"), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`sync status failed (${res.status})`);
      const data = (await res.json()) as { run?: GoogleSyncRun };
      this.googleSyncRun = data.run ?? null;
    } catch {
      this.googleSyncRun = null;
    }
  }

  private connectGoogle() {
    window.location.href = googleApiPath("/connect");
  }

  private async syncNow() {
    this.googleError = "";
    this.googleSyncing = true;
    try {
      const res = await fetch(googleApiPath("/sync"), { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error(`sync failed (${res.status})`);
      await this.loadGoogleSyncStatus();
      await this.app.reload();
    } catch (err) {
      this.googleError = err instanceof Error ? err.message : String(err);
    } finally {
      this.googleSyncing = false;
    }
  }

  private async disconnectGoogle() {
    this.googleError = "";
    try {
      const res = await fetch(googleApiPath("/disconnect"), { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error(`disconnect failed (${res.status})`);
      await this.loadGoogleStatus();
    } catch (err) {
      this.googleError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Actions ────────────────────────────────────────────────────────

  private async handleCreate(e: SubmitEvent) {
    e.preventDefault();
    this.actionError = "";
    const fd = new FormData(e.target as HTMLFormElement);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    const tagsRaw = String(fd.get("tags") || "").trim();
    try {
      await this.app.createPerson({
        name,
        email: String(fd.get("email") || "").trim() || undefined,
        phone: String(fd.get("phone") || "").trim() || undefined,
        company: String(fd.get("company") || "").trim() || undefined,
        role: String(fd.get("role") || "").trim() || undefined,
        status: String(fd.get("status") || "lead") as PersonStatus,
        tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
        notes: String(fd.get("notes") || "").trim() || undefined,
      });
      this.backToList();
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : String(err);
    }
  }

  private async handleUpdate(e: SubmitEvent) {
    e.preventDefault();
    this.actionError = "";
    const fd = new FormData(e.target as HTMLFormElement);
    const tagsRaw = String(fd.get("tags") || "").trim();
    try {
      await this.app.updatePerson(this.selectedId, {
        name: String(fd.get("name") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        phone: String(fd.get("phone") || "").trim(),
        company: String(fd.get("company") || "").trim(),
        role: String(fd.get("role") || "").trim(),
        status: String(fd.get("status") || "lead") as PersonStatus,
        tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
        notes: String(fd.get("notes") || "").trim(),
      });
      this.editing = false;
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : String(err);
    }
  }

  private async handleDelete(person: Person) {
    this.actionError = "";
    try {
      await this.app.deletePerson(person.id);
      this.backToList();
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : String(err);
    }
  }

  private async markContacted(person: Person) {
    this.actionError = "";
    try {
      await this.app.updatePerson(person.id, { lastContactedAt: Date.now() });
    } catch (err) {
      this.actionError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Renderers ──────────────────────────────────────────────────────

  private renderForm(person?: Person) {
    const isEdit = !!person;
    return html`
      <div class="form-card">
        <h2>${isEdit ? "Edit Contact" : "Add Contact"}</h2>
        ${this.actionError ? html`<div class="err">${this.actionError}</div>` : nothing}
        <form @submit=${isEdit ? this.handleUpdate : this.handleCreate}>
          <div class="form-row">
            <label>Name *</label>
            <input name="name" .value=${person?.name ?? ""} required placeholder="Full name" />
          </div>
          <div class="form-row">
            <label>Email</label>
            <input name="email" type="email" .value=${person?.email ?? ""} placeholder="email@example.com" />
          </div>
          <div class="form-row">
            <label>Phone</label>
            <input name="phone" .value=${person?.phone ?? ""} placeholder="+1 555-0123" />
          </div>
          <div class="form-row">
            <label>Company</label>
            <input name="company" .value=${person?.company ?? ""} placeholder="Company name" />
          </div>
          <div class="form-row">
            <label>Role</label>
            <input name="role" .value=${person?.role ?? ""} placeholder="Job title / role" />
          </div>
          <div class="form-row">
            <label>Status</label>
            <select name="status">
              ${STATUS_OPTIONS.map(
                (s) => html`<option value=${s} ?selected=${(person?.status ?? "lead") === s}>${s}</option>`
              )}
            </select>
          </div>
          <div class="form-row">
            <label>Tags (comma-separated)</label>
            <input name="tags" .value=${person?.tags.join(", ") ?? ""} placeholder="vip, investor, design" />
          </div>
          <div class="form-row">
            <label>Notes</label>
            <textarea name="notes" placeholder="Free-form notes...">${person?.notes ?? ""}</textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary">${isEdit ? "Save Changes" : "Add Contact"}</button>
            <button type="button" @click=${isEdit ? () => (this.editing = false) : () => this.backToList()}>Cancel</button>
          </div>
        </form>
      </div>
    `;
  }

  private renderDetail() {
    const person = this.selectedPerson;
    if (!person) return html`<div class="empty">Person not found. <button @click=${() => this.backToList()}>Back</button></div>`;

    if (this.editing) {
      return html`
        <button class="back-btn" @click=${() => (this.editing = false)}>Back to detail</button>
        ${this.renderForm(person)}
      `;
    }

    return html`
      <button class="back-btn" @click=${() => this.backToList()}>Back to list</button>
      ${this.actionError ? html`<div class="err">${this.actionError}</div>` : nothing}
      <div class="detail-card">
        <div class="detail-header">
          <h2>${person.name}</h2>
          ${this.statusBadge(person.status)}
        </div>
        <div class="detail-grid">
          <span class="detail-label">Email</span>
          <span class="detail-value">${person.email || html`<span class="muted">-</span>`}</span>

          <span class="detail-label">Phone</span>
          <span class="detail-value">${person.phone || html`<span class="muted">-</span>`}</span>

          <span class="detail-label">Company</span>
          <span class="detail-value">${person.company || html`<span class="muted">-</span>`}</span>

          <span class="detail-label">Role</span>
          <span class="detail-value">${person.role || html`<span class="muted">-</span>`}</span>

          <span class="detail-label">Tags</span>
          <span class="detail-value">
            ${person.tags.length
              ? html`<span class="tags">${person.tags.map((t) => html`<span class="tag">${t}</span>`)}</span>`
              : html`<span class="muted">none</span>`}
          </span>

          <span class="detail-label">Last contacted</span>
          <span class="detail-value">${this.fmtDate(person.lastContactedAt)}</span>

          <span class="detail-label">Created</span>
          <span class="detail-value">${this.fmtDate(person.createdAt)}</span>

          <span class="detail-label">Updated</span>
          <span class="detail-value">${this.fmtDate(person.updatedAt)}</span>
        </div>
        <div style="margin-top:16px;">
          <div class="detail-label" style="margin-bottom:6px;">CRM Notes</div>
          <div class="detail-notes">${person.notes || html`<span class="muted">No CRM notes</span>`}</div>
        </div>
        <div style="margin-top:10px;">
          <div class="detail-label" style="margin-bottom:6px;">Google Notes</div>
          <div class="detail-notes">${person.googleNotesRaw || html`<span class="muted">No Google notes</span>`}</div>
        </div>
        <div class="detail-actions">
          <button class="primary" @click=${() => (this.editing = true)}>Edit</button>
          <button @click=${() => this.markContacted(person)}>Mark Contacted</button>
          <button class="danger" @click=${() => { if (confirm(`Delete ${person.name}?`)) this.handleDelete(person); }}>Delete</button>
        </div>
      </div>
    `;
  }

  private renderList() {
    const people = this.filteredPeople;

    return html`
      ${this.actionError ? html`<div class="err">${this.actionError}</div>` : nothing}
      ${this.googleError ? html`<div class="err">Google sync: ${this.googleError}</div>` : nothing}

      <div class="oauth-card">
        <div class="oauth-meta">
          <strong>Google Contacts</strong>
          ${this.googleLoading
            ? html`<span>Checking connection…</span>`
            : this.googleStatus.connected
              ? html`<span>Connected${this.googleStatus.accountEmail ? html` as ${this.googleStatus.accountEmail}` : ""}</span>
                  <span>Scope: contacts.readonly</span>
                  ${this.googleSyncRun
                    ? html`<span>Last sync: ${this.fmtDate(this.googleSyncRun.endedAt ?? this.googleSyncRun.startedAt)} · imported ${this.googleSyncRun.importedCount}, updated ${this.googleSyncRun.updatedCount}, errors ${this.googleSyncRun.errorCount}</span>`
                    : html`<span>Last sync: never</span>`}`
              : html`<span>Disconnected</span>`}
        </div>
        <div>
          <button class="primary" @click=${() => this.connectGoogle()}>
            ${this.googleStatus.connected ? "Reconnect Google" : "Sign in with Google"}
          </button>
          ${this.googleStatus.connected
            ? html`<button @click=${() => this.syncNow()} style="margin-left:8px;" ?disabled=${this.googleSyncing}>${this.googleSyncing ? "Syncing…" : "Sync now"}</button>
                <button @click=${() => this.disconnectGoogle()} style="margin-left:8px;">Disconnect</button>`
            : nothing}
        </div>
      </div>

      <div class="count">
        <span>${this.app.people.length} contacts</span>
        ${STATUS_OPTIONS.map((s) => {
          const n = this.app.people.filter((p) => p.status === s).length;
          return n ? html`<span>${s}: ${n}</span>` : nothing;
        })}
      </div>

      <div class="toolbar">
        <input
          type="search"
          placeholder="Search by name, email, company, role, or tag..."
          .value=${this.searchQuery}
          @input=${(e: any) => (this.searchQuery = e.target.value)}
        />
        <select @change=${(e: any) => (this.filterStatus = e.target.value)}>
          <option value="">All statuses</option>
          ${STATUS_OPTIONS.map((s) => html`<option value=${s} ?selected=${this.filterStatus === s}>${s}</option>`)}
        </select>
        <button class="primary" @click=${() => { this.viewMode = "add"; this.actionError = ""; }}>+ Add Contact</button>
      </div>

      ${people.length === 0
        ? html`<div class="empty">${this.app.people.length === 0 ? "No contacts yet. Add your first contact above." : "No contacts match your filters."}</div>`
        : html`
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Tags</th>
                <th>Last Contact</th>
              </tr>
            </thead>
            <tbody>
              ${people.map(
                (p) => html`
                  <tr class="clickable" @click=${() => this.openDetail(p)}>
                    <td>
                      <div>${p.name}</div>
                      ${p.email ? html`<div class="muted">${p.email}</div>` : nothing}
                    </td>
                    <td>${p.company || html`<span class="muted">-</span>`}</td>
                    <td>${p.role || html`<span class="muted">-</span>`}</td>
                    <td>${this.statusBadge(p.status)}</td>
                    <td>
                      ${p.tags.length
                        ? html`<span class="tags">${p.tags.slice(0, 3).map((t) => html`<span class="tag">${t}</span>`)}${p.tags.length > 3 ? html`<span class="muted">+${p.tags.length - 3}</span>` : nothing}</span>`
                        : html`<span class="muted">-</span>`}
                    </td>
                    <td class="muted">${this.fmtDate(p.lastContactedAt)}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
        `}
    `;
  }

  render() {
    if (this.viewMode === "add") {
      return html`
        <button class="back-btn" @click=${() => this.backToList()}>Back to list</button>
        ${this.renderForm()}
      `;
    }
    if (this.viewMode === "detail") return this.renderDetail();
    return this.renderList();
  }
}
