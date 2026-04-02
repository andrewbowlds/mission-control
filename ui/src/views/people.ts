import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, Person } from "../app.ts";

type PersonStatus = Person["status"];
type ViewMode = "list" | "detail" | "add";
type ActivityChannel = "call" | "text" | "email";
type ActivityDirection = "inbound" | "outbound";
type CommunicationActivity = {
  id: string;
  personId: string;
  channel: ActivityChannel;
  direction: ActivityDirection;
  timestamp: number;
  status?: string;
  summary?: string;
  taskId?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  providerName?: string;
};

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

  @state() activities: CommunicationActivity[] = [];
  @state() activitySearch = "";
  @state() activityChannel: ActivityChannel | "" = "";
  @state() activityDirection: ActivityDirection | "" = "";
  @state() activityError = "";

  @state() textMessages: CommunicationActivity[] = [];
  @state() textLoading = false;
  @state() textAgentFilter = "";

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box }
    .oauth-card, .detail-card, table { background: #111118; border: 1px solid #1e1e2e; border-radius: 10px; }
    .oauth-card { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; padding: 12px; }
    .oauth-meta { font-size: 12px; color: #94a3b8; display: flex; flex-direction: column; gap: 4px }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .toolbar input[type="search"] { flex: 1; min-width: 180px }
    .status-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; text-transform:uppercase; }
    .count { font-size: 12px; color: #94a3b8; margin-bottom: 10px; display: flex; gap: 12px; flex-wrap: wrap }
    table { width:100%; border-collapse: collapse; overflow: hidden; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #16162a; font-size: 13px }
    tr.clickable:hover { background: #16162a; cursor: pointer }
    .tags { display: flex; gap: 4px; flex-wrap: wrap }
    .tag { background:#1e1e2e; border:1px solid #2d2d44; border-radius:4px; padding:1px 6px; font-size:11px; color:#94a3b8; }
    .detail-card { padding: 20px; max-width: 850px; }
    .detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 8px 16px; font-size: 13px; }
    .detail-label { color: #64748b; font-weight: 500 }
    .detail-value { color: #e2e8f0 }
    .detail-notes { margin-top:8px; padding:12px; background:#0d0d14; border:1px solid #1e1e2e; border-radius:8px; white-space: pre-wrap; }
    .detail-actions { display: flex; gap: 8px; margin-top: 16px }
    .form-card { background:#111118; border:1px solid #1e1e2e; border-radius:10px; padding:20px; max-width:600px; }
    .form-row { display:flex; flex-direction:column; gap:4px; margin-bottom:12px; }
    .form-row input, .form-row select, .form-row textarea, input, select, button { background:#0a0a0f; color:#e2e8f0; border:1px solid #2d2d44; border-radius:6px; padding:8px; font-size:13px; }
    .form-row textarea { min-height:80px; resize:vertical; }
    .form-actions { display:flex; gap:8px; margin-top:12px; }
    .err { color:#f87171; font-size:13px; margin-bottom:10px; }
    .muted { color:#64748b; font-size:12px; }
    .empty { text-align:center; padding:40px; color:#475569; }
    button { cursor: pointer }
    button.primary { background:#7c3aed; border-color:#8b5cf6; }
    button.danger { background:#7f1d1d; border-color:#991b1b; }
    .timeline-item { background:#0d0d14; border:1px solid #1e1e2e; border-radius:8px; padding:10px; }
    .text-section { margin-top:18px; border-top:1px solid #1e1e2e; padding-top:14px; }
    .text-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .chat-container { display:flex; flex-direction:column; gap:6px; max-height:400px; overflow-y:auto; padding:12px; background:#0a0a0f; border:1px solid #1e1e2e; border-radius:10px; }
    .msg-row { display:flex; }
    .msg-row.inbound { justify-content:flex-start; }
    .msg-row.outbound { justify-content:flex-end; }
    .msg-bubble { max-width:75%; padding:8px 12px; border-radius:12px; font-size:13px; line-height:1.4; word-break:break-word; }
    .msg-bubble.inbound { background:#1e1e2e; color:#e2e8f0; border-bottom-left-radius:4px; }
    .msg-bubble.outbound { background:#7c3aed; color:#fff; border-bottom-right-radius:4px; }
    .msg-meta { font-size:10px; color:#64748b; margin-top:3px; }
    .msg-row.outbound .msg-meta { text-align:right; }
    .chat-empty { text-align:center; padding:32px; color:#475569; font-size:12px; }
    .contact-avatar {
      width: 30px; height: 30px; border-radius: 50%; object-fit: cover;
      background: #1e1e2e; color: #a78bfa; font-size: 12px; font-weight: 600;
      display: inline-flex; align-items: center; justify-content: center;
      flex-shrink: 0; overflow: hidden; border: 1px solid #2d2d44; vertical-align: middle;
    }
    .contact-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    .name-cell { display: flex; align-items: center; gap: 8px; }
    .name-cell-text { display: flex; flex-direction: column; }
  `;

  private get selectedPerson(): Person | undefined { return this.app.people.find((p) => p.id === this.selectedId); }

  private get filteredPeople(): Person[] {
    let list = this.app.people;
    if (this.filterStatus) list = list.filter((p) => p.status === this.filterStatus);
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.email?.toLowerCase().includes(q)) || (p.company?.toLowerCase().includes(q)) || (p.role?.toLowerCase().includes(q)) || p.tags.some((t) => t.toLowerCase().includes(q)) || (p.phones?.some((ph) => ph.value.includes(q))));
    }
    return list;
  }

  connectedCallback() {
    super.connectedCallback();
    void Promise.all([this.loadGoogleStatus(), this.loadGoogleSyncStatus()]);
  }

  private openDetail(person: Person) {
    this.selectedId = person.id;
    this.viewMode = "detail";
    this.editing = false;
    this.actionError = "";
    this.activitySearch = "";
    this.activityChannel = "";
    this.activityDirection = "";
    void this.loadActivities(person.id);
    void this.loadTextMessages(person.id);
  }

  private backToList() { this.viewMode = "list"; this.selectedId = ""; this.editing = false; this.actionError = ""; }
  private fmtDate(ts?: number): string { if (!ts) return "-"; return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  private fmtDateTime(ts?: number): string { if (!ts) return "-"; return new Date(ts).toLocaleString(); }

  private statusBadge(status: PersonStatus) {
    const bg = STATUS_COLORS[status] + "22";
    const color = STATUS_COLORS[status];
    return html`<span class="status-badge" style="background:${bg};color:${color};border:1px solid ${color}44">${status}</span>`;
  }

  private async loadTextMessages(personId = this.selectedId) {
    if (!personId) return;
    this.textLoading = true;
    try {
      type SmsMsg = { direction: string; body: string; from: string; to: string; timestamp: string; messageSid?: string; variantName?: string; agent?: string };
      const res = await this.app.gw.request<{ messages: SmsMsg[] }>("mc.people.smsHistory", {
        personId,
        agent: this.textAgentFilter || undefined,
        limit: 500,
      });
      this.textMessages = (res?.messages ?? []).map((m) => ({
        id: m.messageSid ?? "",
        personId,
        channel: "text" as ActivityChannel,
        direction: (m.direction === "outbound" ? "outbound" : "inbound") as ActivityDirection,
        timestamp: new Date(m.timestamp).getTime(),
        summary: m.body,
        providerName: m.variantName || m.agent || "twilio",
      }));
    } catch {
      this.textMessages = [];
    } finally {
      this.textLoading = false;
    }
  }

  private async loadActivities(personId = this.selectedId) {
    if (!personId) return;
    this.activityError = "";
    try {
      const res = await this.app.gw.request<{ activities: CommunicationActivity[] }>("mc.people.activities.list", {
        personId,
        channel: this.activityChannel || undefined,
        direction: this.activityDirection || undefined,
        query: this.activitySearch.trim() || undefined,
        limit: 250,
      });
      this.activities = res?.activities ?? [];
    } catch (err) {
      this.activityError = err instanceof Error ? err.message : String(err);
      this.activities = [];
    }
  }

  private async addActivity(e: SubmitEvent) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await this.app.gw.request("mc.people.activities.create", {
        personId: this.selectedId,
        channel: String(fd.get("channel") || "text"),
        direction: String(fd.get("direction") || "outbound"),
        status: String(fd.get("status") || "").trim() || undefined,
        summary: String(fd.get("summary") || "").trim() || undefined,
        taskId: String(fd.get("taskId") || "").trim() || undefined,
        sessionId: String(fd.get("sessionId") || "").trim() || undefined,
        messageId: String(fd.get("messageId") || "").trim() || undefined,
        providerId: String(fd.get("providerId") || "").trim() || undefined,
        providerName: String(fd.get("providerName") || "").trim() || undefined,
      });
      (e.target as HTMLFormElement).reset();
      await Promise.all([this.loadActivities(), this.loadTextMessages()]);
    } catch (err) {
      this.activityError = err instanceof Error ? err.message : String(err);
    }
  }

  private async loadGoogleStatus() { try { const res = await fetch(googleApiPath("/status"), { credentials: "same-origin" }); this.googleStatus = res.ok ? await res.json() : { connected: false }; } catch { this.googleStatus = { connected: false }; } }
  private async loadGoogleSyncStatus() { try { const res = await fetch(googleApiPath("/sync/status"), { credentials: "same-origin" }); this.googleSyncRun = res.ok ? ((await res.json()) as any).run ?? null : null; } catch { this.googleSyncRun = null; } }
  private connectGoogle() { window.location.href = googleApiPath("/connect"); }
  private async syncNow() { this.googleSyncing = true; try { await fetch(googleApiPath("/sync"), { method: "POST", credentials: "same-origin" }); await this.loadGoogleSyncStatus(); await this.app.reload(); } finally { this.googleSyncing = false; } }
  private async disconnectGoogle() { await fetch(googleApiPath("/disconnect"), { method: "POST", credentials: "same-origin" }); await this.loadGoogleStatus(); }

  private async handleCreate(e: SubmitEvent) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const tagsRaw = String(fd.get("tags") || "").trim();
    await this.app.createPerson({
      name: String(fd.get("name") || "").trim(),
      email: String(fd.get("email") || "").trim() || undefined,
      phone: String(fd.get("phone") || "").trim() || undefined,
      company: String(fd.get("company") || "").trim() || undefined,
      role: String(fd.get("role") || "").trim() || undefined,
      status: String(fd.get("status") || "lead") as PersonStatus,
      tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notes: String(fd.get("notes") || "").trim() || undefined,
    });
    this.backToList();
  }

  private async handleUpdate(e: SubmitEvent) {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const tagsRaw = String(fd.get("tags") || "").trim();
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
  }

  private renderForm(person?: Person) {
    const isEdit = !!person;
    return html`<div class="form-card"><h2>${isEdit ? "Edit Contact" : "Add Contact"}</h2>
      <form @submit=${isEdit ? this.handleUpdate : this.handleCreate}>
        <div class="form-row"><label>Name</label><input name="name" .value=${person?.name ?? ""} required /></div>
        <div class="form-row"><label>Email</label><input name="email" .value=${person?.email ?? ""} /></div>
        <div class="form-row"><label>Phone</label><input name="phone" .value=${person?.phone ?? ""} /></div>
        <div class="form-row"><label>Company</label><input name="company" .value=${person?.company ?? ""} /></div>
        <div class="form-row"><label>Role</label><input name="role" .value=${person?.role ?? ""} /></div>
        <div class="form-row"><label>Status</label><select name="status">${STATUS_OPTIONS.map((s) => html`<option value=${s} ?selected=${(person?.status ?? "lead") === s}>${s}</option>`)}</select></div>
        <div class="form-row"><label>Tags</label><input name="tags" .value=${person?.tags.join(", ") ?? ""} /></div>
        <div class="form-row"><label>Notes</label><textarea name="notes">${person?.notes ?? ""}</textarea></div>
        <div class="form-actions"><button class="primary" type="submit">${isEdit ? "Save" : "Add Contact"}</button><button type="button" @click=${() => (isEdit ? (this.editing = false) : this.backToList())}>Cancel</button></div>
      </form></div>`;
  }

  private renderTextMessages() {
    return html`<div class="text-section">
      <div class="text-header">
        <div class="detail-label">Text Messages</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <select @change=${(e: any) => { this.textAgentFilter = e.target.value; void this.loadTextMessages(); }}>
            <option value="">All agents</option>
            <option value="pierce" ?selected=${this.textAgentFilter === "pierce"}>Pierce</option>
            <option value="Eidith" ?selected=${this.textAgentFilter === "Eidith"}>Eidith</option>
          </select>
          <button @click=${() => this.loadTextMessages()}>Refresh</button>
        </div>
      </div>
      ${this.textLoading ? html`<div class="muted">Loading...</div>` :
        this.textMessages.length === 0 ? html`<div class="chat-container"><div class="chat-empty">No text messages with this contact.</div></div>` :
        html`<div class="chat-container" id="text-chat-scroll">
          ${this.textMessages.map((m) => html`
            <div class="msg-row ${m.direction}">
              <div>
                <div class="msg-bubble ${m.direction}">${m.summary || html`<span style="opacity:0.5">(no content)</span>`}</div>
                <div class="msg-meta">${this.fmtDateTime(m.timestamp)}${m.status ? ` · ${m.status}` : ""}${m.providerName ? ` · ${m.providerName}` : ""}${m.sessionId ? ` · agent ${m.sessionId.slice(0, 8)}` : ""}</div>
              </div>
            </div>`)}
        </div>`}
    </div>`;
  }

  private renderActivities() {
    return html`<div style="margin-top:18px; border-top:1px solid #1e1e2e; padding-top:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div class="detail-label">Communications timeline</div>
        <button @click=${() => this.loadActivities()}>Refresh</button>
      </div>
      <div class="toolbar">
        <input type="search" placeholder="Search timeline" .value=${this.activitySearch} @change=${(e: any) => { this.activitySearch = e.target.value; void this.loadActivities(); }} />
        <select @change=${(e: any) => { this.activityChannel = e.target.value; void this.loadActivities(); }}><option value="">All channels</option><option value="call" ?selected=${this.activityChannel === "call"}>call</option><option value="text" ?selected=${this.activityChannel === "text"}>text</option><option value="email" ?selected=${this.activityChannel === "email"}>email</option></select>
        <select @change=${(e: any) => { this.activityDirection = e.target.value; void this.loadActivities(); }}><option value="">All directions</option><option value="inbound" ?selected=${this.activityDirection === "inbound"}>inbound</option><option value="outbound" ?selected=${this.activityDirection === "outbound"}>outbound</option></select>
      </div>
      ${this.activityError ? html`<div class="err">${this.activityError}</div>` : nothing}
      ${this.activities.length === 0 ? html`<div class="muted">No communications logged.</div>` : html`<div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto;">${this.activities.map((a) => html`<div class="timeline-item"><div style="display:flex;justify-content:space-between;"><strong>${a.channel} · ${a.direction}</strong><span class="muted">${this.fmtDateTime(a.timestamp)}</span></div><div>${a.summary || html`<span class="muted">(no summary)</span>`}</div><div class="muted">${a.status || "-"}${a.providerName ? ` · ${a.providerName}` : ""}${a.taskId ? ` · task ${a.taskId.slice(0, 8)}` : ""}${a.sessionId ? ` · session ${a.sessionId.slice(0, 8)}` : ""}</div></div>`)}</div>`}
      <form @submit=${this.addActivity} style="margin-top:10px; padding:10px; border:1px dashed #2d2d44; border-radius:8px;">
        <div class="detail-label" style="margin-bottom:8px;">Log outreach / communication</div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;"><select name="channel"><option value="call">call</option><option value="text" selected>text</option><option value="email">email</option></select><select name="direction"><option value="outbound" selected>outbound</option><option value="inbound">inbound</option></select><input name="status" placeholder="status/result" /><input name="providerName" placeholder="provider" /><input name="taskId" placeholder="task id" /><input name="sessionId" placeholder="session id" /><input name="messageId" placeholder="message id" /><input name="providerId" placeholder="provider message id" /></div>
        <div style="margin-top:8px;"><input name="summary" placeholder="content summary/snippet" style="width:100%;" /></div>
        <div style="margin-top:8px;"><button type="submit">Add timeline event</button></div>
      </form>
    </div>`;
  }

  private renderDetail() {
    const person = this.selectedPerson;
    if (!person) return html`<div class="empty">Person not found.</div>`;
    if (this.editing) return html`<button @click=${() => (this.editing = false)}>Back</button>${this.renderForm(person)}`;
    return html`<button @click=${() => this.backToList()}>Back to list</button><div class="detail-card">
      <div style="display:flex;align-items:center;gap:12px;"><h2>${person.name}</h2>${this.statusBadge(person.status)}</div>
      <div class="detail-grid">
        <span class="detail-label">Email</span><span class="detail-value">${person.email || "-"}</span>
        <span class="detail-label">Phone${(person.phones?.length ?? 0) > 1 ? "s" : ""}</span>
        <span class="detail-value">${(person.phones && person.phones.length > 0)
          ? person.phones.map((p, i) => html`${i > 0 ? html`<br/>` : nothing}${p.value} <span class="muted">(${p.type}${p.primary ? ", primary" : ""})</span>`)
          : (person.phone || "-")}</span>
        <span class="detail-label">Company</span><span class="detail-value">${person.company || "-"}</span>
        <span class="detail-label">Role</span><span class="detail-value">${person.role || "-"}</span>
        <span class="detail-label">Last contacted</span><span class="detail-value">${this.fmtDate(person.lastContactedAt)}</span>
      </div>
      <div class="detail-label" style="margin-top:10px;">CRM Notes</div><div class="detail-notes">${person.notes || html`<span class="muted">No CRM notes</span>`}</div>
      ${this.renderTextMessages()}
      ${this.renderActivities()}
      <div class="detail-actions"><button class="primary" @click=${() => (this.editing = true)}>Edit</button><button class="danger" @click=${async () => { if (confirm(`Delete ${person.name}?`)) { await this.app.deletePerson(person.id); this.backToList(); } }}>Delete</button></div>
    </div>`;
  }

  private renderList() {
    const people = this.filteredPeople;
    const ts = this.app.googleTokenStatus;
    const showWarning = ts && (!ts.connected || ts.expired);
    return html`
      ${showWarning ? html`
        <div class="oauth-card" style="border-color:#92400e; background:#1a0f00;">
          <div class="oauth-meta" style="color:#fbbf24;">
            <strong>Google Contacts disconnected</strong>
            <span>${ts!.expired ? "Your Google token has expired — contacts may be out of date." : "Google Contacts is not connected."}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="primary" @click=${() => void this.app.connectGoogleContacts()}>Reconnect Google</button>
            <a href="https://agentnet.edprealty.com" target="_blank" style="color:#a78bfa;font-size:12px;text-decoration:none;">or connect in AgentNet ↗</a>
          </div>
        </div>
      ` : html`
        <div class="oauth-card" style="font-size:12px; color:#64748b;">
          <span>Contacts synced from EDP AgentNet via Google Contacts${ts?.accountEmail ? ` (${ts.accountEmail})` : ""}.</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <button @click=${() => void this.app.connectGoogleContacts()} style="font-size:11px;padding:3px 8px;">Reconnect</button>
            <a href="https://agentnet.edprealty.com" target="_blank" style="color:#a78bfa;text-decoration:none;">AgentNet ↗</a>
          </div>
        </div>
      `}
      <div class="count"><span>${this.app.people.length} contacts</span></div>
      <div class="toolbar"><input type="search" placeholder="Search by name, email, company, role, or tag..." .value=${this.searchQuery} @input=${(e: any) => (this.searchQuery = e.target.value)} /><select @change=${(e: any) => (this.filterStatus = e.target.value)}><option value="">All statuses</option>${STATUS_OPTIONS.map((s) => html`<option value=${s} ?selected=${this.filterStatus === s}>${s}</option>`)}</select><button class="primary" @click=${() => (this.viewMode = "add")}>+ Add Contact</button></div>
      ${people.length === 0 ? html`<div class="empty">No contacts match your filters.</div>` : html`<table><thead><tr><th>Name</th><th>Phone</th><th>Company</th><th>Status</th><th>Tags</th><th>Last Contact</th></tr></thead><tbody>${people.map((p) => {
        const phoneList = p.phones && p.phones.length > 0 ? p.phones : (p.phone ? [{ value: p.phone, type: "mobile", primary: true }] : []);
        const initials = p.name.trim().split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
        return html`<tr class="clickable" @click=${() => this.openDetail(p)}><td><div class="name-cell"><div class="contact-avatar">${(p as any).photoUrl ? html`<img src="${(p as any).photoUrl}" referrerpolicy="no-referrer" alt="${p.name}">` : initials}</div><div class="name-cell-text"><div>${p.name}</div>${p.email ? html`<div class="muted">${p.email}</div>` : nothing}</div></div></td><td class="muted" style="font-size:12px;">${phoneList.length > 0 ? phoneList.map((ph, i) => html`${i > 0 ? html`<br/>` : nothing}${ph.value}`) : "-"}</td><td>${p.company || "-"}</td><td>${this.statusBadge(p.status)}</td><td>${p.tags.length ? html`<span class="tags">${p.tags.map((t) => html`<span class="tag">${t}</span>`)}</span>` : "-"}</td><td class="muted">${this.fmtDate(p.lastContactedAt)}</td></tr>`;
      })}</tbody></table>`}`;
  }

  render() {
    if (this.viewMode === "add") return html`<button @click=${() => this.backToList()}>Back to list</button>${this.renderForm()}`;
    if (this.viewMode === "detail") return this.renderDetail();
    return this.renderList();
  }
}
