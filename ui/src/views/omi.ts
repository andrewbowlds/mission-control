import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade } from "../app.ts";

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

@customElement("mc-omi")
export class McOmi extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

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

  static styles = css`
    :host {
      display: block;
      padding: 24px;
      overflow-y: auto;
      height: 100%;
      box-sizing: border-box;
    }
    h2 {
      font-size: 17px;
      font-weight: 600;
      color: #a78bfa;
      margin: 0 0 4px 0;
    }
    .subtitle {
      font-size: 12px;
      color: #475569;
      margin: 0 0 28px 0;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin: 28px 0 12px 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 14px;
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
      background: #1a1440;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    .card-title { font-weight: 600; font-size: 14px; }
    .card-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .status-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot.live { background: #34d399; box-shadow: 0 0 6px #34d399; }
    .dot.off { background: #475569; }
    .btn {
      font-size: 12px;
      padding: 6px 14px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.8; }
    .btn-primary { background: #5b21b6; color: #fff; }
    .btn-ghost {
      background: transparent;
      color: #64748b;
      border: 1px solid #1e1e2e;
    }
    .btn-sm { font-size: 11px; padding: 4px 10px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      text-align: left;
      color: #475569;
      font-weight: 600;
      padding: 6px 10px;
      border-bottom: 1px solid #1e1e2e;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #0f0f1a;
      color: #cbd5e1;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 8px;
      background: #1e1e2e;
      color: #94a3b8;
    }
    .badge.purple { background: #1a1440; color: #a78bfa; }
    .memory-row {
      padding: 10px 12px;
      border-bottom: 1px solid #0f0f1a;
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.1s;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .memory-row:hover { background: #16161f; }
    .memory-row:last-child { border-bottom: none; }
    .memory-text {
      flex: 1;
      min-width: 0;
    }
    .memory-content {
      color: #e2e8f0;
      font-size: 12px;
      line-height: 1.5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .memory-cat {
      font-size: 10px;
      color: #64748b;
      margin-top: 3px;
    }
    .memory-chevron {
      color: #334155;
      font-size: 14px;
      padding-top: 1px;
      flex-shrink: 0;
    }
    .form-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .form-field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 11px; color: #64748b; font-weight: 600; }
    input {
      background: #0f0f1a;
      border: 1px solid #1e1e2e;
      border-radius: 6px;
      color: #e2e8f0;
      font-size: 12px;
      padding: 5px 10px;
      width: 120px;
    }
    input:focus { outline: none; border-color: #5b21b6; }
    .save-msg { font-size: 11px; color: #34d399; margin-left: 6px; align-self: center; }
    .error-msg { font-size: 11px; color: #f87171; margin-top: 8px; }
    .empty { color: #475569; font-size: 12px; padding: 12px 0; }
    .webhook-url {
      font-family: monospace;
      font-size: 11px;
      color: #a78bfa;
      background: #0f0f1a;
      padding: 4px 8px;
      border-radius: 5px;
      margin-top: 8px;
      word-break: break-all;
    }

    /* ── Modal ── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 24px;
    }
    .modal {
      background: #111118;
      border: 1px solid #2d2d3f;
      border-radius: 16px;
      width: 100%;
      max-width: 560px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 64px rgba(0,0,0,0.6);
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px 14px;
      border-bottom: 1px solid #1e1e2e;
    }
    .modal-title {
      font-size: 13px;
      font-weight: 600;
      color: #e2e8f0;
    }
    .modal-close {
      background: none;
      border: none;
      color: #475569;
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .modal-close:hover { color: #94a3b8; background: #1e1e2e; }
    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .modal-content-text {
      color: #e2e8f0;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-wrap;
    }
    .modal-section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #475569;
      margin-bottom: 8px;
    }
    .linked-person {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 10px;
      background: #0f0f1a;
      border-radius: 8px;
      margin-bottom: 6px;
    }
    .linked-person-name { font-size: 12px; color: #cbd5e1; }
    .unlink-btn {
      background: none;
      border: none;
      color: #475569;
      cursor: pointer;
      font-size: 14px;
      padding: 0 4px;
      line-height: 1;
    }
    .unlink-btn:hover { color: #f87171; }
    .people-search {
      width: 100%;
      box-sizing: border-box;
      background: #0f0f1a;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 12px;
      padding: 7px 12px;
    }
    .people-search:focus { outline: none; border-color: #5b21b6; }
    .people-dropdown {
      background: #0d0d16;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
      margin-top: 4px;
      max-height: 180px;
      overflow-y: auto;
    }
    .people-option {
      padding: 8px 12px;
      cursor: pointer;
      font-size: 12px;
      color: #cbd5e1;
      border-bottom: 1px solid #0f0f1a;
    }
    .people-option:last-child { border-bottom: none; }
    .people-option:hover { background: #16161f; }
    .people-option-sub { font-size: 10px; color: #475569; margin-top: 1px; }
    .link-msg { font-size: 11px; color: #34d399; margin-top: 6px; }
    .btn-danger { background: transparent; color: #f87171; border: 1px solid #3f1a1a; }
    .btn-danger:hover { background: #3f1a1a; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.loadSpeakers();
    this.loadMemories();
  }

  private async loadMemories() {
    this.loadingMemories = true;
    this.memoriesError = "";
    try {
      const res = await fetch("/api/omi/memories");
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
        omiSpeakerId: id,
        personId: this.newPersonId.trim(),
        personName: this.newPersonName.trim(),
      });
      this.saveMsg = "Saved!";
      this.newSpeakerId = "";
      this.newPersonId = "";
      this.newPersonName = "";
      await this.loadSpeakers();
      setTimeout(() => { this.saveMsg = ""; }, 3000);
    } catch (err) {
      this.saveMsg = `Error: ${err}`;
    } finally {
      this.savingSpeaker = false;
    }
  }

  @state() private deletingMemory = false;

  // ── Modal ──────────────────────────────────────────────────────────────────

  private async openMemory(memory: OmiMemory) {
    this.selectedMemory = memory;
    this.memoryLinks = [];
    this.personSearch = "";
    this.linkMsg = "";
    this.loadingLinks = true;

    // Load links + all people in parallel
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
    if (!confirm(`Delete this memory? This cannot be undone.`)) return;
    this.deletingMemory = true;
    try {
      await fetch(`/api/omi/memories/${encodeURIComponent(this.selectedMemory.id)}`, { method: "DELETE" });
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
        memoryId: this.selectedMemory.id,
        personId: person.id,
        personName: person.name,
      });
      this.personSearch = "";
      this.linkMsg = `Linked ${person.name}`;
      // Refresh links
      const data = await this.app.gw.request<{ links: MemoryLink[] }>("mc.omi.getMemoryLinks", {
        memoryId: this.selectedMemory.id,
      });
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
    try {
      await this.app.gw.request("mc.omi.unlinkPerson", {
        memoryId: this.selectedMemory.id,
        personId,
      });
      this.memoryLinks = this.memoryLinks.filter(l => l.personId !== personId);
    } catch (err) {
      console.error("unlink failed:", err);
    }
  }

  private get filteredPeople(): CrmPerson[] {
    const q = this.personSearch.toLowerCase().trim();
    if (!q) return [];
    const linked = new Set(this.memoryLinks.map(l => l.personId));
    return this.allPeople
      .filter(p => !linked.has(p.id) && (
        p.name.toLowerCase().includes(q) ||
        (p.company ?? "").toLowerCase().includes(q)
      ))
      .slice(0, 8);
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
              <button class="btn btn-danger btn-sm" @click=${this.deleteMemory}
                ?disabled=${this.deletingMemory}>
                ${this.deletingMemory ? "Deleting…" : "Delete"}
              </button>
              <button class="modal-close" @click=${this.closeModal}>✕</button>
            </div>
          </div>
          <div class="modal-body">
            <!-- Content -->
            <div>
              <div class="modal-section-label">Content</div>
              <div class="modal-content-text">${m.content}</div>
            </div>

            <!-- Linked people -->
            <div>
              <div class="modal-section-label">People</div>
              ${this.loadingLinks ? html`<div class="empty">Loading…</div>` : ""}
              ${this.memoryLinks.length === 0 && !this.loadingLinks
                ? html`<div class="empty">No people linked yet.</div>`
                : ""}
              ${this.memoryLinks.map(link => html`
                <div class="linked-person">
                  <span class="linked-person-name">${link.personName}</span>
                  <button class="unlink-btn" title="Remove" @click=${() => this.unlinkPerson(link.personId)}>✕</button>
                </div>
              `)}

              <!-- Search to add -->
              <div style="margin-top:10px">
                <input
                  class="people-search"
                  placeholder="Search CRM contacts to link…"
                  .value=${this.personSearch}
                  @input=${(e: Event) => { this.personSearch = (e.target as HTMLInputElement).value; }}
                />
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
      <p class="subtitle">Live integration status, speaker mappings, and captured memories</p>

      <!-- Webhook status -->
      <div class="section-title">Webhooks</div>
      <div class="grid">
        <div class="card">
          <div class="card-header">
            <div class="card-icon">🎙️</div>
            <div>
              <div class="card-title">Real-time Transcript</div>
              <div class="card-sub">Trigger phrase detection → agent activation</div>
            </div>
          </div>
          <div class="status-row"><span class="dot live"></span> Active</div>
          <div class="webhook-url">/api/omi/transcript</div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-icon">🧠</div>
            <div>
              <div class="card-title">Conversation Events</div>
              <div class="card-sub">Action items → tasks, CRM activity logging</div>
            </div>
          </div>
          <div class="status-row"><span class="dot off"></span> Configure in Omi app</div>
          <div class="webhook-url">/api/omi/memory</div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-icon">📅</div>
            <div>
              <div class="card-title">Day Summary</div>
              <div class="card-sub">End-of-day Jarvis debrief</div>
            </div>
          </div>
          <div class="status-row"><span class="dot off"></span> Configure in Omi app</div>
          <div class="webhook-url">/api/omi/day-summary</div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-icon">🔊</div>
            <div>
              <div class="card-title">Audio Bytes</div>
              <div class="card-sub">Voice samples for future speaker fingerprinting</div>
            </div>
          </div>
          <div class="status-row"><span class="dot live"></span> Active · 5s interval</div>
          <div class="webhook-url">/api/omi/audio</div>
        </div>
      </div>

      <!-- Speaker mappings -->
      <div class="section-title">Speaker Mappings</div>
      <div class="card">
        ${this.loadingSpeakers ? html`<div class="empty">Loading…</div>` : ""}
        ${this.speakersError ? html`<div class="error-msg">${this.speakersError}</div>` : ""}
        ${!this.loadingSpeakers && this.speakers.length === 0 && !this.speakersError
          ? html`<div class="empty">No speakers mapped yet. Speakers are auto-identified after conversations.</div>`
          : ""}
        ${this.speakers.length > 0 ? html`
          <table>
            <thead>
              <tr>
                <th>Speaker ID</th>
                <th>CRM Contact</th>
                <th>Person ID</th>
                <th>Conversations</th>
              </tr>
            </thead>
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

        <!-- Add mapping form -->
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
          <button class="btn btn-primary btn-sm" @click=${this.saveSpeaker}
            ?disabled=${this.savingSpeaker}>
            ${this.savingSpeaker ? "Saving…" : "Map Speaker"}
          </button>
          ${this.saveMsg ? html`<span class="save-msg">${this.saveMsg}</span>` : ""}
        </div>
      </div>

      <!-- Omi memories -->
      <div class="section-title">
        Omi Memories
        <button class="btn btn-primary btn-sm" style="margin-left:10px;vertical-align:middle"
          @click=${this.loadMemories}>Refresh</button>
      </div>
      <div class="card">
        ${this.loadingMemories ? html`<div class="empty">Loading…</div>` : ""}
        ${this.memoriesError ? html`<div class="error-msg">Could not load memories: ${this.memoriesError}</div>` : ""}
        ${!this.loadingMemories && this.memories.length === 0 && !this.memoriesError
          ? html`<div class="empty">No memories found.</div>`
          : ""}
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
    `;
  }
}
