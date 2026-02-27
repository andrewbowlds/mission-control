import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AppFacade } from "../app.ts";

@customElement("mc-team")
export class MCTeam extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box }
    .wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }
    .card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 16px;
    }
    .card h3 { margin: 0 0 12px; font-size: 15px; color: #a78bfa }
    .row {
      padding: 8px 0; border-top: 1px solid #1a1a2a;
      display: flex; align-items: center; gap: 10px;
    }
    .avatar {
      width: 32px; height: 32px; border-radius: 50%; background: #1e1e2e;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    .agent-name { font-size: 14px; font-weight: 500 }
    .meta { font-size: 12px; color: #475569 }
    .stat-row { display: flex; gap: 16px; margin-bottom: 12px }
    .stat {
      background: #0a0a0f; border-radius: 8px; padding: 10px 14px; text-align: center;
    }
    .stat-val { font-size: 20px; font-weight: 700; color: #a78bfa }
    .stat-lbl { font-size: 10px; color: #475569; text-transform: uppercase; margin-top: 2px }
    .sub-row {
      padding: 6px 0; border-top: 1px solid #1a1a2a; font-size: 13px;
    }
    .sub-target { color: #94a3b8 }
    .sub-status { font-size: 11px; color: #475569 }
    @media (max-width: 800px) { .wrap { grid-template-columns: 1fr } }
  `;

  render() {
    const { agents, subagents, sessions } = this.app;
    return html`
      <div class="stat-row">
        <div class="stat"><div class="stat-val">${agents.length}</div><div class="stat-lbl">Agents</div></div>
        <div class="stat"><div class="stat-val">${subagents.length}</div><div class="stat-lbl">Subagents</div></div>
        <div class="stat"><div class="stat-val">${sessions.length}</div><div class="stat-lbl">Sessions</div></div>
      </div>
      <div class="wrap">
        <div class="card">
          <h3>Agents</h3>
          ${agents.length === 0
            ? html`<div class="meta">No agents found</div>`
            : agents.map(
                (a) => html`
                  <div class="row">
                    <div class="avatar">${a.identity?.emoji || "🤖"}</div>
                    <div>
                      <div class="agent-name">${a.identity?.name || a.name || a.id}</div>
                      <div class="meta">${a.id}</div>
                    </div>
                  </div>
                `
              )}
        </div>
        <div class="card">
          <h3>Subagents</h3>
          ${subagents.length === 0
            ? html`<div class="meta">No subagents running</div>`
            : subagents.map(
                (s: any) => html`
                  <div class="sub-row">
                    <div class="sub-target">${s.target || s.id || "subagent"}</div>
                    <div class="sub-status">${s.status || "unknown"}</div>
                  </div>
                `
              )}
        </div>
      </div>
    `;
  }
}
