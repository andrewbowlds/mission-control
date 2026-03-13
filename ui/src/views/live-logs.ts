import { LitElement, css, html } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { map } from "lit/directives/map.js";
import { classMap } from "lit/directives/class-map.js";
import type { MCGatewayClient } from "../gateway-client.js";

type LogEntry = {
    id: string;
    timestamp: number;
    type: "llm_input" | "llm_output" | "before_tool_call" | "after_tool_call";
    agentId?: string;
    sessionKey?: string;
    payload: any;
};

@customElement("mc-live-logs")
export class McLiveLogs extends LitElement {
    static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #000;
      color: #0f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      overflow: hidden;
      padding: 10px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      color: #888;
      border-bottom: 1px solid #333;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .log-stream {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .log {
      display: flex;
      gap: 12px;
      line-height: 1.4;
      word-break: break-all;
    }
    .time {
      color: #666;
      white-space: nowrap;
    }
    .agent {
      color: #a855f7;
      font-weight: bold;
    }
    .type {
      color: #3b82f6;
    }
    
    .type.llm_input { color: #f59e0b; }
    .type.llm_output { color: #10b981; }
    .type.before_tool_call { color: #0ea5e9; }
    .type.after_tool_call { color: #6366f1; }
    
    .payload {
      color: #d1d5db;
    }
    .empty {
      color: #666;
      font-style: italic;
      text-align: center;
      margin-top: 40px;
    }
  `;

    @property({ attribute: false })
    client!: MCGatewayClient;

    @state()
    private logs: LogEntry[] = [];

    private _listener = (evt: any) => this.handleEvent(evt);

    override connectedCallback() {
        super.connectedCallback();
        window.addEventListener("mc-gateway-event", this._listener);
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("mc-gateway-event", this._listener);
    }

    private handleEvent(e: any) {
        const detail = e.detail;
        if (detail.event === "mc.agent_logs") {
            const payload = detail.payload;
            const log: LogEntry = {
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                type: payload.type,
                agentId: payload.agentId,
                sessionKey: payload.sessionKey,
                payload: payload.event,
            };
            this.logs = [...this.logs.slice(-499), log]; // Keep last 500 logs
            this.requestUpdate();

            // Auto scroll
            setTimeout(() => {
                const stream = this.shadowRoot?.querySelector('.log-stream');
                if (stream) stream.scrollTop = stream.scrollHeight;
            }, 0);
        }
    }

    private renderPayload(type: string, payload: any) {
        if (type === "llm_input") {
            return html`Prompted model \${payload.model} for session \${payload.sessionId}`;
        } else if (type === "llm_output") {
            return html`Received \${payload.assistantTexts?.length ?? 0} texts from \${payload.model}`;
        } else if (type === "before_tool_call" || type === "after_tool_call") {
            return html`Tool: \${payload.toolName}`;
        }
        return html`\${JSON.stringify(payload)}`;
    }

    private renderLog(log: LogEntry) {
        return html`<div class="log">
          <div class="time">[\${new Date(log.timestamp).toLocaleTimeString()}]</div>
          <div class="agent">\${log.agentId ?? "system"}</div>
          <div class="type \${log.type}">[\${log.type}]</div>
          <div class="payload">\${this.renderPayload(log.type, log.payload)}</div>
        </div>`;
    }

    private renderStream() {
        if (this.logs.length === 0) {
            return html`<div class="empty">Waiting for agent activity...</div>`;
        }
        return map(this.logs, (log) => this.renderLog(log));
    }

    override render() {
        return html`<div class="header">
        <span>Live Agent Stream (<span style="color: #10b981">●</span> Active)</span>
        <span>\${this.logs.length} events recorded</span>
      </div>
      <div class="log-stream">
        \${this.renderStream()}
      </div>`;
  }
}
