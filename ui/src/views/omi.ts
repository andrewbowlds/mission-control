import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade } from "../app.ts";

@customElement("mc-omi")
export class McOmi extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  @state() private memories: { id: string; content: string; category: string }[] = [];
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
    .memory-content {
      color: #e2e8f0;
      font-size: 12px;
      line-height: 1.5;
    }
    .memory-cat {
      font-size: 10px;
      color: #64748b;
      margin-top: 3px;
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

  render() {
    return html`
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
          <div style="padding: 10px 0; border-bottom: 1px solid #0f0f1a;">
            <div class="memory-content">${m.content}</div>
            <div class="memory-cat">${m.category}</div>
          </div>
        `)}
      </div>
    `;
  }
}
