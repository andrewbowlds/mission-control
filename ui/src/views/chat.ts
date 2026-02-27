import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, SessionRow } from "../app.ts";

@customElement("mc-chat")
export class McChat extends LitElement {
  static styles = css`
    :host { display:flex; height:100%; overflow:hidden; }
    .left { width:320px; border-right:1px solid #1e1e2e; display:flex; flex-direction:column; }
    .left h3 { margin:0; padding:12px 14px; font-size:12px; color:#94a3b8; border-bottom:1px solid #1e1e2e; text-transform:uppercase; letter-spacing:.08em; }
    .list { overflow:auto; flex:1; }
    .item { padding:10px 12px; border-bottom:1px solid #161623; cursor:pointer; }
    .item.active { background:#111118; }
    .name { font-size:12px; color:#e2e8f0; }
    .preview { font-size:11px; color:#64748b; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
    .head { padding:12px 16px; border-bottom:1px solid #1e1e2e; font-size:13px; color:#a78bfa; }
    .msgs { flex:1; overflow:auto; padding:12px; display:flex; flex-direction:column; gap:8px; }
    .msg { max-width:80%; border:1px solid #1e1e2e; border-radius:10px; padding:8px 10px; background:#0f0f17; }
    .msg.user { margin-left:auto; background:#1b1530; border-color:#34245f; }
    .meta { font-size:10px; color:#64748b; margin-bottom:4px; }
    .text { font-size:12px; color:#e2e8f0; white-space:pre-wrap; }
    .composer { border-top:1px solid #1e1e2e; padding:10px; display:flex; gap:8px; }
    textarea { flex:1; min-height:44px; max-height:120px; background:#111118; color:#e2e8f0; border:1px solid #1e1e2e; border-radius:8px; padding:8px; font-family:inherit; }
    button { background:#4c1d95; color:#e9d5ff; border:none; border-radius:8px; padding:8px 14px; cursor:pointer; }
    .empty { margin:auto; color:#64748b; }
  `;

  @property({ attribute: false }) app!: AppFacade;
  @state() private selectedKey = "";
  @state() private history: any[] = [];
  @state() private draft = "";

  private get sessions(): SessionRow[] {
    return [...this.app.sessions].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  }

  private label(s: SessionRow): string {
    return s.label || s.key;
  }

  private async pick(sessionKey: string): Promise<void> {
    this.selectedKey = sessionKey;
    this.history = await this.app.getSessionHistory(sessionKey, 120);
  }

  private extractText(msg: any): string {
    const c = msg?.content;
    if (!Array.isArray(c)) return "";
    const parts: string[] = [];
    for (const p of c) {
      if (typeof p === "string") parts.push(p);
      else if (p?.type === "text" && typeof p.text === "string") parts.push(p.text);
    }
    return parts.join("\n");
  }

  private async send(): Promise<void> {
    if (!this.selectedKey || !this.draft.trim()) return;
    const txt = this.draft.trim();
    this.draft = "";
    await this.app.sendToSession(this.selectedKey, txt);
    this.history = await this.app.getSessionHistory(this.selectedKey, 120);
  }

  render() {
    const selected = this.sessions.find(s => s.key === this.selectedKey);
    return html`
      <div class="left">
        <h3>All Chats</h3>
        <div class="list">
          ${this.sessions.map(s => html`
            <div class="item ${s.key===this.selectedKey?'active':''}" @click=${() => void this.pick(s.key)}>
              <div class="name">${this.label(s)}</div>
              <div class="preview">${s.lastMessagePreview || 'No messages yet'}</div>
            </div>
          `)}
        </div>
      </div>
      <div class="main">
        <div class="head">${selected ? this.label(selected) : 'Select a chat'}</div>
        <div class="msgs">
          ${!selected ? html`<div class="empty">Choose a chat to view interactions</div>` : this.history.map((m:any)=> html`
            <div class="msg ${m.role==='user'?'user':''}">
              <div class="meta">${m.role || 'unknown'}</div>
              <div class="text">${this.extractText(m) || '(non-text message)'}</div>
            </div>
          `)}
        </div>
        ${selected ? html`
          <div class="composer">
            <textarea .value=${this.draft} @input=${(e:Event)=>{this.draft=(e.target as HTMLTextAreaElement).value;}} placeholder="Chime into this chat..."></textarea>
            <button @click=${() => void this.send()}>Send</button>
          </div>
        ` : ''}
      </div>
    `;
  }
}
