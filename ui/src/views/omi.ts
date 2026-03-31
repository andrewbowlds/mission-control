import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade } from "../app.ts";

interface OmiProfile {
  id: string;
  displayName: string;
  omiUid: string;
  connectedAt: number;
}

interface OmiMemory {
  id: string;
  content: string;
  category: string;
}

interface MemoryLink {
  personId: string;
  personName: string;
  linkedAt: number;
}

interface CrmPerson {
  id: string;
  name: string;
  company?: string;
}

const PROFILE_KEY = "mc_omi_profile_id";

@customElement("mc-omi")
export class McOmi extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  // ── Profiles ──────────────────────────────────────────────────────────────
  @state() private profiles: OmiProfile[] = [];
  @state() private selectedProfileId = localStorage.getItem(PROFILE_KEY) ?? "";
  @state() private loadingProfiles = false;

  // Connect form
  @state() private showConnectForm = false;
  @state() private connectName = "";
  @state() private connectUid = "";
  @state() private connectKey = "";
  @state() private connecting = false;
  @state() private connectError = "";

  // ── Data for selected profile ──────────────────────────────────────────────
  @state() private memories: OmiMemory[] = [];
  @state() private speakers: { omiSpeakerId: number; personName: string; personId: string; conversationCount: number }[] = [];
  @state() private loadingMemories = false;
  @state() private loadingSpeakers = false;
  @state() private memoriesError = "";
  @state() private speakersError = "";

  // Save speaker form
  @state() private savingSpeaker = false;
  @state() private newSpeakerId = "";
  @state() private newPersonId = "";
  @state() private newPersonName = "";
  @state() private saveMsg = "";

  // Memory modal
  @state() private selectedMemory: OmiMemory | null = null;
  @state() private memoryLinks: MemoryLink[] = [];
  @state() private loadingLinks = false;
  @state() private allPeople: CrmPerson[] = [];
  @state() private personSearch = "";
  @state() private linkingPersonId = "";
  @state() private linkMsg = "";
  @state() private deletingMemory = false;
  @state() private webhooksExpanded = false;

  static styles = css`
    :host {
      display: block;
      padding: 24px;
      overflow-y: auto;
      height: 100%;
      box-sizing: border-box;
    }
    h2 { font-size: 17px; font-weight: 600; color: #a78bfa; margin: 0 0 4px 0; }
    .subtitle { font-size: 12px; color: #475569; margin: 0 0 20px 0; }
    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: #64748b; margin: 28px 0 12px 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 14px; margin-bottom: 24px;
    }
    .card {
      background: #111118; border: 1px solid #1e1e2e;
      border-radius: 12px; padding: 20px;
    }
    .card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .card-icon {
      width: 42px; height: 42px; border-radius: 10px;
      background: #1a1440; display: flex; align-items: center;
      justify-content: center; font-size: 20px; flex-shrink: 0;
    }
    .card-title { font-weight: 600; font-size: 14px; }
    .card-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .status-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; color: #94a3b8; margin-bottom: 6px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .dot.live { background: #34d399; box-shadow: 0 0 6px #34d399; }
    .dot.off { background: #475569; }
    .btn {
      font-size: 12px; padding: 6px 14px; border-radius: 8px;
      border: none; cursor: pointer; font-weight: 600; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.8; }
    .btn:disabled { opacity: 0.4; cursor: default; }
    .btn-primary { background: #5b21b6; color: #fff; }
    .btn-ghost { background: transparent; color: #64748b; border: 1px solid #1e1e2e; }
    .btn-danger { background: transparent; color: #f87171; border: 1px solid #3f1a1a; }
    .btn-danger:hover { background: #3f1a1a; opacity: 1; }
    .btn-sm { font-size: 11px; padding: 4px 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      text-align: left; color: #475569; font-weight: 600;
      padding: 6px 10px; border-bottom: 1px solid #1e1e2e;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    }
    td {
      padding: 8px 10px; border-bottom: 1px solid #0f0f1a;
      color: #cbd5e1; vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    .badge {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 2px 7px; border-radius: 8px;
      background: #1e1e2e; color: #94a3b8;
    }
    .badge.purple { background: #1a1440; color: #a78bfa; }
    .badge.green { background: #052e16; color: #34d399; }

    /* ── Profile bar ── */
    .profile-bar {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px; background: #0f0f1a;
      border: 1px solid #1e1e2e; border-radius: 12px;
      margin-bottom: 24px; flex-wrap: wrap;
    }
    .profile-label { font-size: 11px; color: #475569; font-weight: 600; flex-shrink: 0; }
    .profile-select {
      background: #111118; border: 1px solid #1e1e2e;
      border-radius: 7px; color: #e2e8f0; font-size: 12px;
      padding: 4px 10px; cursor: pointer; flex: 1; min-width: 140px; max-width: 220px;
    }
    .profile-select:focus { outline: none; border-color: #5b21b6; }
    .profile-uid { font-size: 10px; color: #334155; font-family: monospace; flex-shrink: 0; }

    /* ── Connect form ── */
    .connect-card {
      background: #0f0f1a; border: 1px solid #2d1f5e;
      border-radius: 12px; padding: 22px; margin-bottom: 24px;
    }
    .connect-title {
      font-size: 14px; font-weight: 600; color: #a78bfa; margin: 0 0 6px 0;
    }
    .connect-sub { font-size: 12px; color: #475569; margin: 0 0 18px 0; line-height: 1.5; }
    .connect-fields {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 10px; margin-bottom: 14px;
    }
    .field-label { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
    .field-hint { font-size: 10px; color: #334155; margin-top: 3px; }
    input, .connect-input {
      background: #0a0a12; border: 1px solid #1e1e2e;
      border-radius: 6px; color: #e2e8f0; font-size: 12px;
      padding: 6px 10px; width: 100%; box-sizing: border-box;
    }
    input:focus, .connect-input:focus { outline: none; border-color: #5b21b6; }
    .connect-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .connect-error { font-size: 11px; color: #f87171; }

    /* ── Memories ── */
    .memory-row {
      padding: 10px 12px; border-bottom: 1px solid #0f0f1a;
      cursor: pointer; border-radius: 8px; transition: background 0.1s;
      display: flex; align-items: flex-start; gap: 10px;
    }
    .memory-row:hover { background: #16161f; }
    .memory-row:last-child { border-bottom: none; }
    .memory-text { flex: 1; min-width: 0; }
    .memory-content {
      color: #e2e8f0; font-size: 12px; line-height: 1.5;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .memory-cat { font-size: 10px; color: #64748b; margin-top: 3px; }
    .memory-chevron { color: #334155; font-size: 14px; padding-top: 1px; flex-shrink: 0; }

    /* ── Speaker form ── */
    .form-row {
      display: flex; gap: 8px; align-items: flex-end;
      flex-wrap: wrap; margin-top: 14px;
    }
    .form-field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 11px; color: #64748b; font-weight: 600; }
    .save-msg { font-size: 11px; color: #34d399; margin-left: 6px; align-self: center; }
    .error-msg { font-size: 11px; color: #f87171; margin-top: 8px; }
    .empty { color: #475569; font-size: 12px; padding: 12px 0; }
    .webhook-url {
      font-family: monospace; font-size: 11px; color: #a78bfa;
      background: #0f0f1a; padding: 4px 8px; border-radius: 5px;
      margin-top: 8px; word-break: break-all;
    }
    .section-toggle {
      background: none; border: none; cursor: pointer;
      color: #64748b; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      display: flex; align-items: center; gap: 6px; padding: 0;
    }
    .section-toggle:hover { color: #94a3b8; }
    .toggle-chevron { font-size: 10px; transition: transform 0.15s; display: inline-block; }
    .toggle-chevron.open { transform: rotate(90deg); }

    /* ── No profile state ── */
    .no-profile {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 60px 24px; text-align: center; gap: 16px;
    }
    .no-profile-icon { font-size: 48px; }
    .no-profile-title { font-size: 18px; font-weight: 600; color: #e2e8f0; }
    .no-profile-sub { font-size: 13px; color: #475569; max-width: 400px; line-height: 1.6; }

    /* ── Modal ── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 100; padding: 24px;
    }
    .modal {
      background: #111118; border: 1px solid #2d2d3f; border-radius: 16px;
      width: 100%; max-width: 560px; max-height: 80vh;
      display: flex; flex-direction: column;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    }
    .modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px 14px; border-bottom: 1px solid #1e1e2e;
    }
    .modal-title { font-size: 13px; font-weight: 600; color: #e2e8f0; }
    .modal-close {
      background: none; border: none; color: #475569;
      font-size: 18px; cursor: pointer; line-height: 1; padding: 2px 6px; border-radius: 4px;
    }
    .modal-close:hover { color: #94a3b8; background: #1e1e2e; }
    .modal-body {
      flex: 1; overflow-y: auto; padding: 18px 20px;
      display: flex; flex-direction: column; gap: 18px;
    }
    .modal-content-text { color: #e2e8f0; font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
    .modal-section-label {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: #475569; margin-bottom: 8px;
    }
    .linked-person {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 10px; background: #0f0f1a; border-radius: 8px; margin-bottom: 6px;
    }
    .linked-person-name { font-size: 12px; color: #cbd5e1; }
    .unlink-btn {
      background: none; border: none; color: #475569;
      cursor: pointer; font-size: 14px; padding: 0 4px; line-height: 1;
    }
    .unlink-btn:hover { color: #f87171; }
    .people-search {
      width: 100%; box-sizing: border-box; background: #0f0f1a;
      border: 1px solid #1e1e2e; border-radius: 8px;
      color: #e2e8f0; font-size: 12px; padding: 7px 12px;
    }
    .people-search:focus { outline: none; border-color: #5b21b6; }
    .people-dropdown {
      background: #0d0d16; border: 1px solid #1e1e2e;
      border-radius: 8px; margin-top: 4px; max-height: 180px; overflow-y: auto;
    }
    .people-option {
      padding: 8px 12px; cursor: pointer; font-size: 12px;
      color: #cbd5e1; border-bottom: 1px solid #0f0f1a;
    }
    .people-option:last-child { border-bottom: none; }
    .people-option:hover { background: #16161f; }
    .people-option-sub { font-size: 10px; color: #475569; margin-top: 1px; }
    .link-msg { font-size: 11px; color: #34d399; margin-top: 6px; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadProfiles();
  }

  // ── Profile management ─────────────────────────────────────────────────────

  private async loadProfiles() {
    this.loadingProfiles = true;
    try {
      const data = await this.app.gw.request<{ profiles: OmiProfile[] }>("mc.omi.listProfiles", {});
      this.profiles = data?.profiles ?? [];
      // Auto-select if saved profile is still valid
      if (this.selectedProfileId && this.profiles.some(p => p.id === this.selectedProfileId)) {
        this.onProfileSelected(this.selectedProfileId);
      } else if (this.profiles.length === 1 && !this.selectedProfileId) {
        this.onProfileSelected(this.profiles[0].id);
      } else if (this.selectedProfileId) {
        // Saved selection no longer exists
        this.selectedProfileId = "";
        localStorage.removeItem(PROFILE_KEY);
      }
    } catch (err) {
      console.error("loadProfiles:", err);
    } finally {
      this.loadingProfiles = false;
    }
  }

  private onProfileSelected(id: string) {
    this.selectedProfileId = id;
    localStorage.setItem(PROFILE_KEY, id);
    if (id) {
      this.loadMemories();
      this.loadSpeakers();
    }
  }

  private async connectProfile() {
    const name = this.connectName.trim();
    const uid = this.connectUid.trim();
    const key = this.connectKey.trim();
    if (!name || !uid || !key) { this.connectError = "All fields are required."; return; }
    this.connecting = true;
    this.connectError = "";
    try {
      const data = await this.app.gw.request<{ profile: OmiProfile }>("mc.omi.addProfile", {
        displayName: name, omiUid: uid, omiMcpKey: key,
      });
      this.connectName = "";
      this.connectUid = "";
      this.connectKey = "";
      this.showConnectForm = false;
      await this.loadProfiles();
      if (data?.profile?.id) this.onProfileSelected(data.profile.id);
    } catch (err) {
      this.connectError = err instanceof Error ? err.message : String(err);
    } finally {
      this.connecting = false;
    }
  }

  private async disconnectProfile(id: string) {
    if (!confirm("Disconnect this Omi account?")) return;
    await this.app.gw.request("mc.omi.removeProfile", { id });
    if (this.selectedProfileId === id) {
      this.selectedProfileId = "";
      localStorage.removeItem(PROFILE_KEY);
      this.memories = [];
      this.speakers = [];
    }
    await this.loadProfiles();
  }

  // ── Data loaders ───────────────────────────────────────────────────────────

  private get profileParam() {
    return this.selectedProfileId ? `?profileId=${encodeURIComponent(this.selectedProfileId)}` : "";
  }

  private async loadMemories() {
    this.loadingMemories = true;
    this.memoriesError = "";
    try {
      const res = await fetch(`/api/omi/memories${this.profileParam}`);
      if (!res.ok) throw new Error(`${res.status}`);
      this.memories = await res.json();
    } catch (err) {
      this.memoriesError = String(err);
    } finally {
      this.loadingMemories = false;
    }
  }

  private async loadSpeakers() {
    this.loadingSpeakers = true;
    this.speakersError = "";
    try {
      const data = await this.app.gw.request<{ speakers: typeof this.speakers }>("mc.omi.listSpeakers", {});
      this.speakers = data?.speakers ?? [];
    } catch (err) {
      this.speakersError = String(err);
    } finally {
      this.loadingSpeakers = false;
    }
  }

  private async saveSpeaker() {
    const id = parseInt(this.newSpeakerId, 10);
    if (isNaN(id) || !this.newPersonId.trim() || !this.newPersonName.trim()) return;
    this.savingSpeaker = true;
    this.saveMsg = "";
    try {
      await this.app.gw.request("mc.omi.saveSpeaker", {
        omiSpeakerId: id, personId: this.newPersonId.trim(), personName: this.newPersonName.trim(),
      });
      this.saveMsg = "Saved!";
      this.newSpeakerId = ""; this.newPersonId = ""; this.newPersonName = "";
      await this.loadSpeakers();
      setTimeout(() => { this.saveMsg = ""; }, 3000);
    } catch (err) {
      this.saveMsg = `Error: ${err}`;
    } finally {
      this.savingSpeaker = false;
    }
  }

  // ── Memory modal ───────────────────────────────────────────────────────────

  private async openMemory(memory: OmiMemory) {
    this.selectedMemory = memory;
    this.memoryLinks = [];
    this.personSearch = "";
    this.linkMsg = "";
    this.loadingLinks = true;
    const [linksResult, peopleResult] = await Promise.allSettled([
      this.app.gw.request<{ links: MemoryLink[] }>("mc.omi.getMemoryLinks", { memoryId: memory.id }),
      this.app.gw.request<{ people: CrmPerson[] }>("mc.people.list", {}),
    ]);
    this.memoryLinks = linksResult.status === "fulfilled" ? (linksResult.value?.links ?? []) : [];
    this.allPeople = peopleResult.status === "fulfilled" ? (peopleResult.value?.people ?? []) : [];
    this.loadingLinks = false;
  }

  private closeModal() {
    this.selectedMemory = null;
    this.personSearch = "";
    this.linkMsg = "";
    this.deletingMemory = false;
  }

  private async deleteMemory() {
    if (!this.selectedMemory) return;
    if (!confirm("Delete this memory? This cannot be undone.")) return;
    this.deletingMemory = true;
    try {
      const url = `/api/omi/memories/${encodeURIComponent(this.selectedMemory.id)}${this.profileParam}`;
      await fetch(url, { method: "DELETE" });
      this.memories = this.memories.filter(m => m.id !== this.selectedMemory!.id);
      this.closeModal();
    } catch (err) {
      console.error("delete failed:", err);
      this.deletingMemory = false;
    }
  }

  private async linkPerson(person: CrmPerson) {
    if (!this.selectedMemory) return;
    this.linkingPersonId = person.id;
    try {
      await this.app.gw.request("mc.omi.linkPerson", {
        memoryId: this.selectedMemory.id, personId: person.id, personName: person.name,
      });
      this.personSearch = "";
      this.linkMsg = `Linked ${person.name}`;
      const data = await this.app.gw.request<{ links: MemoryLink[] }>("mc.omi.getMemoryLinks", { memoryId: this.selectedMemory.id });
      this.memoryLinks = data?.links ?? [];
      setTimeout(() => { this.linkMsg = ""; }, 3000);
    } catch (err) {
      this.linkMsg = `Error: ${err}`;
    } finally {
      this.linkingPersonId = "";
    }
  }

  private async unlinkPerson(personId: string) {
    if (!this.selectedMemory) return;
    await this.app.gw.request("mc.omi.unlinkPerson", { memoryId: this.selectedMemory.id, personId });
    this.memoryLinks = this.memoryLinks.filter(l => l.personId !== personId);
  }

  private get filteredPeople(): CrmPerson[] {
    const q = this.personSearch.toLowerCase().trim();
    if (!q) return [];
    const linked = new Set(this.memoryLinks.map(l => l.personId));
    return this.allPeople
      .filter(p => !linked.has(p.id) && (
        p.name.toLowerCase().includes(q) || (p.company ?? "").toLowerCase().includes(q)
      ))
      .slice(0, 8);
  }

  private get selectedProfile(): OmiProfile | undefined {
    return this.profiles.find(p => p.id === this.selectedProfileId);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  private renderConnectForm() {
    return html`
      <div class="connect-card">
        <p class="connect-title">Connect Omi Account</p>
        <p class="connect-sub">
          Enter your Omi credentials to see your memories and conversations.
          Your API key is stored securely on the server — it's never sent to other browsers.
        </p>
        <div class="connect-fields">
          <div>
            <div class="field-label">Your Name</div>
            <input class="connect-input" placeholder="e.g. Sarah" .value=${this.connectName}
              @input=${(e: Event) => { this.connectName = (e.target as HTMLInputElement).value; }} />
          </div>
          <div>
            <div class="field-label">Omi User ID</div>
            <input class="connect-input" placeholder="uid from Omi app" .value=${this.connectUid}
              @input=${(e: Event) => { this.connectUid = (e.target as HTMLInputElement).value; }} />
            <div class="field-hint">Omi app → Settings → Developer → User ID</div>
          </div>
          <div>
            <div class="field-label">MCP API Key</div>
            <input class="connect-input" type="password" placeholder="omi_mcp_…" .value=${this.connectKey}
              @input=${(e: Event) => { this.connectKey = (e.target as HTMLInputElement).value; }} />
            <div class="field-hint">Omi app → Settings → Developer → MCP</div>
          </div>
        </div>
        <div class="connect-actions">
          <button class="btn btn-primary" @click=${this.connectProfile} ?disabled=${this.connecting}>
            ${this.connecting ? "Connecting…" : "Connect"}
          </button>
          ${this.profiles.length > 0 ? html`
            <button class="btn btn-ghost" @click=${() => { this.showConnectForm = false; this.connectError = ""; }}>
              Cancel
            </button>
          ` : ""}
          ${this.connectError ? html`<span class="connect-error">${this.connectError}</span>` : ""}
        </div>
      </div>
    `;
  }

  private renderModal() {
    const m = this.selectedMemory;
    if (!m) return "";
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.closeModal(); }}>
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Memory</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="badge purple">${m.category}</span>
              <button class="btn btn-danger btn-sm" @click=${this.deleteMemory} ?disabled=${this.deletingMemory}>
                ${this.deletingMemory ? "Deleting…" : "Delete"}
              </button>
              <button class="modal-close" @click=${this.closeModal}>✕</button>
            </div>
          </div>
          <div class="modal-body">
            <div>
              <div class="modal-section-label">Content</div>
              <div class="modal-content-text">${m.content}</div>
            </div>
            <div>
              <div class="modal-section-label">People</div>
              ${this.loadingLinks ? html`<div class="empty">Loading…</div>` : ""}
              ${this.memoryLinks.length === 0 && !this.loadingLinks
                ? html`<div class="empty">No people linked yet.</div>` : ""}
              ${this.memoryLinks.map(link => html`
                <div class="linked-person">
                  <span class="linked-person-name">${link.personName}</span>
                  <button class="unlink-btn" @click=${() => this.unlinkPerson(link.personId)}>✕</button>
                </div>
              `)}
              <div style="margin-top:10px">
                <input class="people-search" placeholder="Search CRM contacts to link…"
                  .value=${this.personSearch}
                  @input=${(e: Event) => { this.personSearch = (e.target as HTMLInputElement).value; }} />
                ${this.filteredPeople.length > 0 ? html`
                  <div class="people-dropdown">
                    ${this.filteredPeople.map(p => html`
                      <div class="people-option"
                        @click=${() => this.linkPerson(p)}
                        style=${this.linkingPersonId === p.id ? "opacity:0.5;pointer-events:none" : ""}>
                        <div>${p.name}</div>
                        ${p.company ? html`<div class="people-option-sub">${p.company}</div>` : ""}
                      </div>
                    `)}
                  </div>
                ` : ""}
                ${this.linkMsg ? html`<div class="link-msg">${this.linkMsg}</div>` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      ${this.renderModal()}

      <h2>Omi Wearable</h2>
      <p class="subtitle">Connect your Omi device to see your memories, speakers, and conversation data</p>

      <!-- Profile bar -->
      ${this.profiles.length > 0 ? html`
        <div class="profile-bar">
          <span class="profile-label">Viewing as</span>
          <select class="profile-select"
            .value=${this.selectedProfileId}
            @change=${(e: Event) => this.onProfileSelected((e.target as HTMLSelectElement).value)}>
            <option value="" ?selected=${!this.selectedProfileId}>— select profile —</option>
            ${this.profiles.map(p => html`
              <option value=${p.id} ?selected=${p.id === this.selectedProfileId}>${p.displayName}</option>
            `)}
          </select>
          ${this.selectedProfile ? html`
            <span class="profile-uid">uid: ${this.selectedProfile.omiUid}</span>
            <span class="badge green">Connected</span>
            <button class="btn btn-ghost btn-sm" style="margin-left:auto"
              @click=${() => this.disconnectProfile(this.selectedProfile!.id)}>
              Disconnect
            </button>
          ` : ""}
          <button class="btn btn-primary btn-sm" @click=${() => { this.showConnectForm = !this.showConnectForm; this.connectError = ""; }}>
            + Add Account
          </button>
        </div>
      ` : ""}

      <!-- Connect form (shown when no profiles OR user clicked + Add) -->
      ${this.profiles.length === 0 || this.showConnectForm ? html`
        ${this.profiles.length === 0 ? html`
          <div class="no-profile">
            <div class="no-profile-icon">🎙️</div>
            <div class="no-profile-title">Connect your Omi</div>
            <div class="no-profile-sub">
              Each team member connects their own Omi account using their personal API key.
              Your memories and conversations are private to your account.
            </div>
          </div>
        ` : ""}
        ${this.renderConnectForm()}
      ` : ""}

      <!-- No profile selected -->
      ${this.profiles.length > 0 && !this.selectedProfileId && !this.showConnectForm ? html`
        <div class="no-profile" style="padding:40px 24px">
          <div class="no-profile-sub">Select a profile above to view Omi data.</div>
        </div>
      ` : ""}

      <!-- Per-profile content -->
      ${this.selectedProfileId ? html`

        <!-- Webhook config -->
        <div class="section-title" style="margin-bottom:${this.webhooksExpanded ? "12px" : "6px"}">
          <button class="section-toggle" @click=${() => { this.webhooksExpanded = !this.webhooksExpanded; }}>
            <span class="toggle-chevron ${this.webhooksExpanded ? "open" : ""}">›</span>
            Webhooks
          </button>
        </div>
        ${this.webhooksExpanded ? html`
        <div class="grid">
          <div class="card">
            <div class="card-header"><div class="card-icon">🎙️</div>
              <div><div class="card-title">Real-time Transcript</div>
                <div class="card-sub">Trigger phrase detection → agent activation</div></div>
            </div>
            <div class="status-row"><span class="dot live"></span> Active</div>
            <div class="webhook-url">/api/omi/transcript</div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-icon">🧠</div>
              <div><div class="card-title">Conversation Events</div>
                <div class="card-sub">Action items → tasks, CRM activity logging</div></div>
            </div>
            <div class="status-row"><span class="dot off"></span> Configure in Omi app</div>
            <div class="webhook-url">/api/omi/memory</div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-icon">📅</div>
              <div><div class="card-title">Day Summary</div>
                <div class="card-sub">End-of-day Jarvis debrief</div></div>
            </div>
            <div class="status-row"><span class="dot off"></span> Configure in Omi app</div>
            <div class="webhook-url">/api/omi/day-summary</div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-icon">🔊</div>
              <div><div class="card-title">Audio Bytes</div>
                <div class="card-sub">Voice samples for speaker fingerprinting</div></div>
            </div>
            <div class="status-row"><span class="dot live"></span> Active · 5s interval</div>
            <div class="webhook-url">/api/omi/audio</div>
          </div>
        </div>
        ` : ""}

        <!-- Speaker mappings -->
        <div class="section-title">Speaker Mappings</div>
        <div class="card">
          ${this.loadingSpeakers ? html`<div class="empty">Loading…</div>` : ""}
          ${this.speakersError ? html`<div class="error-msg">${this.speakersError}</div>` : ""}
          ${!this.loadingSpeakers && this.speakers.length === 0 && !this.speakersError
            ? html`<div class="empty">No speakers mapped yet.</div>` : ""}
          ${this.speakers.length > 0 ? html`
            <table>
              <thead><tr>
                <th>Speaker ID</th><th>CRM Contact</th><th>Person ID</th><th>Conversations</th>
              </tr></thead>
              <tbody>
                ${this.speakers.map(s => html`
                  <tr>
                    <td><span class="badge">SPEAKER_${String(s.omiSpeakerId).padStart(2, "0")}</span></td>
                    <td>${s.personName}</td>
                    <td style="color:#475569">${s.personId}</td>
                    <td>${s.conversationCount}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          ` : ""}
          <div class="form-row">
            <div class="form-field">
              <label>Speaker #</label>
              <input type="number" min="0" placeholder="0" .value=${this.newSpeakerId}
                @input=${(e: Event) => { this.newSpeakerId = (e.target as HTMLInputElement).value; }} />
            </div>
            <div class="form-field">
              <label>CRM Person ID</label>
              <input placeholder="uuid..." .value=${this.newPersonId}
                @input=${(e: Event) => { this.newPersonId = (e.target as HTMLInputElement).value; }} />
            </div>
            <div class="form-field">
              <label>Name</label>
              <input placeholder="John Smith" .value=${this.newPersonName}
                @input=${(e: Event) => { this.newPersonName = (e.target as HTMLInputElement).value; }} />
            </div>
            <button class="btn btn-primary btn-sm" @click=${this.saveSpeaker} ?disabled=${this.savingSpeaker}>
              ${this.savingSpeaker ? "Saving…" : "Map Speaker"}
            </button>
            ${this.saveMsg ? html`<span class="save-msg">${this.saveMsg}</span>` : ""}
          </div>
        </div>

        <!-- Memories -->
        <div class="section-title">
          Memories
          <button class="btn btn-primary btn-sm" style="margin-left:10px;vertical-align:middle"
            @click=${this.loadMemories}>Refresh</button>
        </div>
        <div class="card">
          ${this.loadingMemories ? html`<div class="empty">Loading…</div>` : ""}
          ${this.memoriesError ? html`<div class="error-msg">Could not load memories: ${this.memoriesError}</div>` : ""}
          ${!this.loadingMemories && this.memories.length === 0 && !this.memoriesError
            ? html`<div class="empty">No memories found.</div>` : ""}
          ${this.memories.map(m => html`
            <div class="memory-row" @click=${() => this.openMemory(m)}>
              <div class="memory-text">
                <div class="memory-content">${m.content}</div>
                <div class="memory-cat">${m.category}</div>
              </div>
              <span class="memory-chevron">›</span>
            </div>
          `)}
        </div>

      ` : ""}
    `;
  }
}
