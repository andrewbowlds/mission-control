import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, AgentRow, Room, SessionRow } from "../app.ts";

@customElement("mc-rooms")
export class McRooms extends LitElement {
  static styles = css`
    :host { display: flex; height: 100%; overflow: hidden; }

    /* ── Sidebar ── */
    .sidebar {
      width: 220px; flex-shrink: 0;
      border-right: 1px solid #1e1e2e;
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .sidebar-head {
      padding: 14px 16px 10px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid #1e1e2e;
    }
    .sidebar-title {
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: #64748b;
    }
    .add-btn {
      background: none; border: none;
      color: #a78bfa; font-size: 20px; line-height: 1;
      cursor: pointer; padding: 0 2px;
    }
    .room-list { flex: 1; overflow-y: auto; padding: 8px; }
    .room-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      color: #94a3b8; font-size: 13px;
      transition: background 0.15s;
    }
    .room-item:hover { background: #111118; }
    .room-item.active { background: #1e1e2e; color: #e2e8f0; }

    /* ── Main panel ── */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .room-head {
      padding: 12px 20px;
      border-bottom: 1px solid #1e1e2e;
      display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
    }
    .room-head-name { font-size: 15px; font-weight: 600; }
    .chip-list { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
    .chip { font-size: 11px; background: #1e1e2e; border-radius: 20px; padding: 3px 10px; color: #94a3b8; }
    .invite-btn {
      padding: 5px 12px;
      background: none;
      border: 1px solid #374151;
      border-radius: 6px;
      color: #64748b; font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .invite-btn:hover { border-color: #a78bfa; color: #a78bfa; }

    /* ── Thread area ── */
    .threads { flex: 1; overflow: hidden; display: grid; }
    .threads.multi { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .thread { display: flex; flex-direction: column; border-right: 1px solid #1e1e2e; overflow: hidden; }
    .thread:last-child { border-right: none; }
    .thread-head {
      padding: 10px 14px;
      background: #0a0a0f;
      border-bottom: 1px solid #1e1e2e;
      font-size: 12px; font-weight: 600; color: #94a3b8;
      display: flex; align-items: center; gap: 6px;
      flex-shrink: 0;
    }
    .thread-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .msg {
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .msg-text { font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .msg-time { font-size: 10px; color: #374151; margin-top: 4px; }
    .no-session { padding: 24px; text-align: center; color: #374151; font-size: 12px; font-style: italic; }

    /* ── Input bar ── */
    .input-bar {
      padding: 12px 16px;
      border-top: 1px solid #1e1e2e;
      display: flex; gap: 10px;
      flex-shrink: 0;
    }
    .input-bar input {
      flex: 1;
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 10px;
      color: #e2e8f0;
      padding: 10px 14px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .input-bar input:focus { border-color: #4c1d95; }
    .send-btn {
      padding: 10px 20px;
      background: #4c1d95;
      border: none; border-radius: 10px;
      color: #e9d5ff; font-size: 13px; font-weight: 600;
      cursor: pointer;
    }
    .send-btn:hover { background: #5b21b6; }

    /* ── Empty state ── */
    .empty-state {
      flex: 1;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      color: #374151; gap: 14px;
    }
    .empty-state p { font-size: 14px; }
    .empty-create-btn {
      padding: 10px 22px;
      background: #4c1d95;
      border: none; border-radius: 8px;
      color: #e9d5ff; font-size: 13px;
      cursor: pointer;
    }

    /* ── Create room modal ── */
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.7);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
    }
    .modal {
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 16px;
      padding: 24px;
      width: 420px; max-width: 90vw;
    }
    .modal h3 { font-size: 16px; font-weight: 600; color: #a78bfa; margin-bottom: 18px; }
    .form-row { margin-bottom: 14px; }
    .form-row label {
      display: block;
      font-size: 11px; color: #64748b; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      margin-bottom: 5px;
    }
    input[type="text"] {
      width: 100%;
      background: #0a0a0f;
      border: 1px solid #1e1e2e;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    input[type="text"]:focus { border-color: #4c1d95; }
    .agent-checkboxes { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
    .agent-check-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      background: #0a0a0f;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid #1e1e2e;
      transition: border-color 0.15s;
      font-size: 13px; color: #94a3b8;
    }
    .agent-check-row.selected { border-color: #4c1d95; color: #e2e8f0; }
    .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
    .btn-cancel { padding: 8px 16px; background: #1e1e2e; border: none; border-radius: 8px; color: #94a3b8; font-size: 13px; cursor: pointer; }
    .btn-submit { padding: 8px 16px; background: #4c1d95; border: none; border-radius: 8px; color: #e9d5ff; font-size: 13px; font-weight: 600; cursor: pointer; }
  `;

  @property({ attribute: false }) app!: AppFacade;

  @state() private selectedRoomId: string | null = null;
  @state() private messageInput = "";
  @state() private showCreate = false;
  @state() private newRoomName = "";
  @state() private pickedAgentIds: string[] = [];

  private get selectedRoom(): Room | null {
    return this.app.rooms.find((r) => r.id === this.selectedRoomId) ?? null;
  }

  private agentFor(id: string): AgentRow | undefined {
    return this.app.agents.find((a) => a.id === id);
  }

  private agentLabel(id: string): string {
    const a = this.agentFor(id);
    return `${a?.identity?.emoji ?? "🤖"} ${a?.identity?.name ?? a?.name ?? id}`;
  }

  private sessionFor(room: Room, agentId: string): SessionRow | undefined {
    const sk = room.sessionKeys[agentId];
    return sk ? this.app.sessions.find((s) => s.key === sk) : undefined;
  }

  private async onSend(): Promise<void> {
    const room = this.selectedRoom;
    if (!room || !this.messageInput.trim()) return;
    const msg = this.messageInput.trim();
    this.messageInput = "";
    await this.app.sendRoomMessage(room, msg);
  }

  private toggleAgent(agentId: string): void {
    if (this.pickedAgentIds.includes(agentId)) {
      this.pickedAgentIds = this.pickedAgentIds.filter((id) => id !== agentId);
    } else {
      this.pickedAgentIds = [...this.pickedAgentIds, agentId];
    }
  }

  private async onCreateRoom(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.newRoomName.trim() || !this.pickedAgentIds.length) return;
    const room = await this.app.createRoom({ name: this.newRoomName.trim(), agentIds: this.pickedAgentIds });
    if (room) this.selectedRoomId = room.id;
    this.showCreate = false;
    this.newRoomName = "";
    this.pickedAgentIds = [];
  }

  private async onInvite(): Promise<void> {
    const room = this.selectedRoom;
    if (!room) return;
    const agentId = prompt("Agent ID to invite:");
    if (agentId?.trim()) await this.app.inviteToRoom(room.id, agentId.trim(), room.name);
  }

  render() {
    const room = this.selectedRoom;
    return html`
      <div class="sidebar">
        <div class="sidebar-head">
          <span class="sidebar-title">Rooms</span>
          <button class="add-btn" @click=${() => { this.showCreate = true; }} title="Create room">+</button>
        </div>
        <div class="room-list">
          ${this.app.rooms.map((r) => html`
            <div
              class="room-item ${r.id === this.selectedRoomId ? "active" : ""}"
              @click=${() => { this.selectedRoomId = r.id; }}
            >
              💬 ${r.name}
            </div>
          `)}
        </div>
      </div>

      <div class="main">
        ${room ? html`
          <div class="room-head">
            <span class="room-head-name">💬 ${room.name}</span>
            <div class="chip-list">
              ${room.agentIds.map((id) => html`<span class="chip">${this.agentLabel(id)}</span>`)}
            </div>
            <button class="invite-btn" @click=${() => void this.onInvite()}>+ Invite</button>
          </div>

          <div class="threads ${room.agentIds.length > 1 ? "multi" : ""}">
            ${room.agentIds.length === 0
              ? html`<div style="padding:40px;text-align:center;color:#374151;font-size:13px">No agents in this room. Click Invite to add agents.</div>`
              : room.agentIds.map((agentId) => {
                  const session = this.sessionFor(room, agentId);
                  return html`
                    <div class="thread">
                      <div class="thread-head">${this.agentLabel(agentId)}</div>
                      <div class="thread-body">
                        ${session?.lastMessagePreview
                          ? html`
                              <div class="msg">
                                <div class="msg-text">${session.lastMessagePreview}</div>
                                ${session.updatedAt
                                  ? html`<div class="msg-time">${new Date(session.updatedAt).toLocaleTimeString()}</div>`
                                  : ""}
                              </div>
                            `
                          : html`<div class="no-session">Send a message to begin the conversation.</div>`}
                      </div>
                    </div>
                  `;
                })}
          </div>

          <div class="input-bar">
            <input
              type="text"
              placeholder="Send message to all agents in this room…"
              .value=${this.messageInput}
              @input=${(e: Event) => { this.messageInput = (e.target as HTMLInputElement).value; }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.onSend(); }
              }}
            />
            <button class="send-btn" @click=${() => void this.onSend()}>Send</button>
          </div>
        ` : html`
          <div class="empty-state">
            <p>Select a room or create one to start collaborating</p>
            <button class="empty-create-btn" @click=${() => { this.showCreate = true; }}>+ Create Room</button>
          </div>
        `}
      </div>

      ${this.showCreate ? html`
        <div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showCreate = false; }}>
          <div class="modal">
            <h3>Create Room</h3>
            <form @submit=${this.onCreateRoom}>
              <div class="form-row">
                <label>Room Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Research Team"
                  .value=${this.newRoomName}
                  @input=${(e: Event) => { this.newRoomName = (e.target as HTMLInputElement).value; }}
                />
              </div>
              <div class="form-row">
                <label>Invite Agents</label>
                <div class="agent-checkboxes">
                  ${this.app.agents.map((a) => {
                    const picked = this.pickedAgentIds.includes(a.id);
                    return html`
                      <div
                        class="agent-check-row ${picked ? "selected" : ""}"
                        @click=${() => this.toggleAgent(a.id)}
                      >
                        <input type="checkbox" .checked=${picked} @click=${(e: Event) => e.stopPropagation()} />
                        ${this.agentLabel(a.id)}
                      </div>
                    `;
                  })}
                </div>
              </div>
              <div class="modal-actions">
                <button type="button" class="btn-cancel" @click=${() => { this.showCreate = false; }}>Cancel</button>
                <button type="submit" class="btn-submit">Create Room</button>
              </div>
            </form>
          </div>
        </div>
      ` : ""}
    `;
  }
}
