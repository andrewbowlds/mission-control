import { LitElement, css, html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, AnalyticsData, ThroughputBucket, AgentPerformance, DurationBucket, PriorityDist, WorkflowAnalyticsSummary, TagBreakdown, AgentCapability, RoutingRule } from "../app.ts";

@customElement("mc-analytics")
export class McAnalytics extends LitElement {
  @property({ attribute: false }) app!: AppFacade;
  @state() private loading = false;

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box; }

    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .header h2 { margin: 0; font-size: 18px; }

    .range-bar { display: flex; gap: 4px; }
    .range-btn {
      background: #0a0a0f; color: #94a3b8; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-family: inherit;
    }
    .range-btn:hover { background: #1e1e2e; }
    .range-btn.active { background: #7c3aed; color: #fff; border-color: #8b5cf6; }

    /* Metric cards row */
    .metrics-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px;
    }
    .metric-card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 16px; text-align: center;
    }
    .metric-val { font-size: 28px; font-weight: 700; color: #a78bfa; }
    .metric-val.green { color: #22c55e; }
    .metric-val.red { color: #ef4444; }
    .metric-val.blue { color: #60a5fa; }
    .metric-lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

    /* Two column layout */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }

    /* Section card */
    .section {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px; padding: 16px;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      color: #64748b; margin: 0 0 12px 0;
    }

    /* Table */
    .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .data-table th {
      text-align: left; padding: 6px 8px; color: #64748b; font-weight: 600;
      border-bottom: 1px solid #1e1e2e; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .data-table td { padding: 6px 8px; border-bottom: 1px solid #0d0d14; }
    .data-table tr:hover td { background: #0d0d14; }

    /* Progress bar */
    .bar-bg { background: #1e1e2e; border-radius: 4px; height: 16px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }

    /* SVG chart */
    .chart-container { width: 100%; overflow-x: auto; }
    .chart-container svg { display: block; }

    /* Priority badges */
    .priority-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 10px; font-weight: 600; text-transform: uppercase;
    }
    .pri-critical { background: #3b0a0a; color: #ef4444; }
    .pri-high { background: #2a1a00; color: #f59e0b; }
    .pri-normal { background: #0a1a2a; color: #60a5fa; }
    .pri-low { background: #0a2a0a; color: #4ade80; }

    /* Tags */
    .tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag-chip {
      background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 6px;
      padding: 4px 10px; font-size: 11px; color: #94a3b8;
    }
    .tag-count { color: #a78bfa; font-weight: 600; margin-left: 4px; }

    .empty { text-align: center; padding: 30px; color: #475569; font-size: 13px; }
    .loading { text-align: center; padding: 40px; color: #64748b; }

    /* Intelligence section */
    .cap-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .cap-card {
      background: #0d0d14; border: 1px solid #1e1e2e; border-radius: 8px; padding: 12px;
    }
    .cap-card-agent { font-weight: 600; color: #a78bfa; font-size: 13px; margin-bottom: 8px; }
    .cap-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 11px;
    }
    .cap-name { color: #94a3b8; width: 100px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cap-bar { flex: 1; height: 12px; background: #1e1e2e; border-radius: 3px; overflow: hidden; }
    .cap-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
    .cap-pct { color: #64748b; width: 36px; text-align: right; font-size: 10px; }
    .cap-samples { color: #475569; font-size: 9px; }
    .rule-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 0;
      border-bottom: 1px solid #0d0d14; font-size: 12px;
    }
    .rule-row:last-child { border-bottom: none; }
    .rule-type { font-size: 9px; padding: 2px 6px; border-radius: 4px; background: #1a1a2e; color: #818cf8; text-transform: uppercase; }
    .rule-agent { color: #a78bfa; font-weight: 500; }
    .rule-confidence { color: #64748b; font-size: 10px; }
    .rule-fires { color: #475569; font-size: 10px; }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (!this.app.analyticsData.overview) {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    await this.app.loadAnalytics();
    this.loading = false;
  }

  private fmtDuration(ms: number): string {
    if (!ms) return "0s";
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  private fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    const d = this.app.analyticsData;
    const range = this.app.analyticsRange;

    return html`
      <div class="header">
        <h2>Analytics</h2>
        <div class="range-bar">
          ${[7, 30, 90].map((days) => html`
            <button class="range-btn ${range === days ? "active" : ""}"
              @click=${() => this.app.setAnalyticsRange(days)}>${days}d</button>
          `)}
        </div>
        <button class="range-btn" @click=${() => void this.refresh()}>Refresh</button>
      </div>

      ${this.loading ? html`<div class="loading">Loading analytics...</div>` : html`
        ${d.overview ? this.renderMetrics(d) : html`<div class="empty">No data available. Create some tasks first.</div>`}
      `}
    `;
  }

  private renderMetrics(d: AnalyticsData) {
    const o = d.overview!;
    return html`
      <!-- Summary cards -->
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-val green">${o.completed}</div>
          <div class="metric-lbl">Completed</div>
        </div>
        <div class="metric-card">
          <div class="metric-val red">${o.failed}</div>
          <div class="metric-lbl">Failed</div>
        </div>
        <div class="metric-card">
          <div class="metric-val">${o.totalTasks > 0 ? Math.round((o.completed / o.totalTasks) * 100) : 0}%</div>
          <div class="metric-lbl">Success Rate</div>
        </div>
        <div class="metric-card">
          <div class="metric-val blue">${this.fmtDuration(o.avgCompletionMs)}</div>
          <div class="metric-lbl">Avg Duration</div>
        </div>
      </div>

      <div class="two-col">
        <!-- Throughput chart -->
        <div class="section">
          <div class="section-title">Task Throughput</div>
          ${d.throughput.length ? this.renderThroughputChart(d.throughput) : html`<div class="empty">No throughput data</div>`}
        </div>

        <!-- Agent performance -->
        <div class="section">
          <div class="section-title">Agent Performance</div>
          ${d.agents.length ? this.renderAgentTable(d.agents) : html`<div class="empty">No agent data</div>`}
        </div>
      </div>

      <div class="two-col">
        <!-- Duration histogram -->
        <div class="section">
          <div class="section-title">Task Duration Distribution</div>
          ${this.renderDurationBars(d.durations)}
        </div>

        <!-- Priority distribution -->
        <div class="section">
          <div class="section-title">Priority Distribution</div>
          ${d.priorities.length ? this.renderPriorityTable(d.priorities) : html`<div class="empty">No data</div>`}
        </div>
      </div>

      <!-- Workflows -->
      ${d.workflows.length ? html`
        <div class="section">
          <div class="section-title">Workflow Analytics</div>
          ${this.renderWorkflowTable(d.workflows)}
        </div>
      ` : nothing}

      <!-- SLA -->
      ${d.sla && d.sla.total > 0 ? html`
        <div class="section">
          <div class="section-title">SLA Compliance</div>
          ${this.renderSla(d.sla)}
        </div>
      ` : nothing}

      <!-- Tags -->
      ${d.tags.length ? html`
        <div class="section">
          <div class="section-title">Tags Breakdown</div>
          ${this.renderTags(d.tags)}
        </div>
      ` : nothing}

      <!-- Intelligence: Agent Capabilities -->
      ${this.renderAgentCapabilities()}

      <!-- Intelligence: Routing Rules -->
      ${this.renderRoutingRules()}
    `;
  }

  // ── Throughput SVG bar chart ──────────────────────────────────────────────

  private renderThroughputChart(buckets: ThroughputBucket[]) {
    const w = 500, h = 180, padL = 30, padB = 24, padT = 10;
    const n = buckets.length;
    if (n === 0) return nothing;

    const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.created, b.completed)));
    const barW = Math.max(4, Math.min(20, (w - padL) / (n * 2.5)));
    const gap = barW * 0.5;
    const groupW = barW * 2 + gap;
    const chartW = padL + n * (groupW + gap);

    const yScale = (v: number) => padT + (h - padT - padB) * (1 - v / maxVal);

    return html`
      <div class="chart-container">
        <svg width="${Math.max(w, chartW)}" height="${h}" viewBox="0 0 ${Math.max(w, chartW)} ${h}">
          <!-- Y axis labels -->
          ${[0, 0.5, 1].map((frac) => {
            const y = yScale(maxVal * frac);
            const val = Math.round(maxVal * frac);
            return svg`
              <text x="${padL - 4}" y="${y + 3}" text-anchor="end" fill="#475569" font-size="9">${val}</text>
              <line x1="${padL}" y1="${y}" x2="${Math.max(w, chartW)}" y2="${y}" stroke="#1e1e2e" stroke-width="0.5"/>
            `;
          })}
          <!-- Bars -->
          ${buckets.map((b, i) => {
            const x = padL + i * (groupW + gap);
            const createdH = (b.created / maxVal) * (h - padT - padB);
            const completedH = (b.completed / maxVal) * (h - padT - padB);
            return svg`
              <rect x="${x}" y="${h - padB - createdH}" width="${barW}" height="${createdH}"
                fill="#60a5fa" opacity="0.7" rx="2"/>
              <rect x="${x + barW + gap}" y="${h - padB - completedH}" width="${barW}" height="${completedH}"
                fill="#22c55e" opacity="0.8" rx="2"/>
              <text x="${x + groupW / 2}" y="${h - 6}" text-anchor="middle" fill="#475569" font-size="8">
                ${this.fmtDate(b.bucket)}
              </text>
            `;
          })}
          <!-- Legend -->
          <rect x="${padL}" y="${0}" width="8" height="8" fill="#60a5fa" rx="1"/>
          <text x="${padL + 12}" y="${7}" fill="#94a3b8" font-size="9">Created</text>
          <rect x="${padL + 60}" y="${0}" width="8" height="8" fill="#22c55e" rx="1"/>
          <text x="${padL + 72}" y="${7}" fill="#94a3b8" font-size="9">Completed</text>
        </svg>
      </div>
    `;
  }

  // ── Agent performance table ──────────────────────────────────────────────

  private renderAgentTable(agents: AgentPerformance[]) {
    return html`
      <table class="data-table">
        <thead><tr>
          <th>Agent</th><th>Done</th><th>Failed</th><th>Avg Duration</th><th>Success</th>
        </tr></thead>
        <tbody>
          ${agents.map((a) => html`
            <tr>
              <td style="font-weight:500;">${a.agentId}</td>
              <td style="color:#22c55e;">${a.tasksCompleted}</td>
              <td style="color:#ef4444;">${a.tasksFailed}</td>
              <td style="color:#94a3b8;">${this.fmtDuration(a.avgDurationMs)}</td>
              <td>
                <div style="display:flex;align-items:center;gap:6px;">
                  <div class="bar-bg" style="width:60px;">
                    <div class="bar-fill" style="width:${a.successRate}%;background:${a.successRate >= 80 ? "#22c55e" : a.successRate >= 50 ? "#f59e0b" : "#ef4444"};"></div>
                  </div>
                  <span style="font-size:11px;color:#94a3b8;">${a.successRate}%</span>
                </div>
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  // ── Duration bars ─────────────────────────────────────────────────────────

  private renderDurationBars(durations: DurationBucket[]) {
    const maxCount = Math.max(1, ...durations.map((d) => d.count));
    const total = durations.reduce((s, d) => s + d.count, 0);
    if (total === 0) return html`<div class="empty">No completed tasks with durations</div>`;

    return html`
      ${durations.map((d) => html`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:11px;color:#94a3b8;width:70px;text-align:right;flex-shrink:0;">${d.label}</span>
          <div class="bar-bg" style="flex:1;">
            <div class="bar-fill" style="width:${(d.count / maxCount) * 100}%;background:#818cf8;"></div>
          </div>
          <span style="font-size:11px;color:#64748b;width:30px;">${d.count}</span>
        </div>
      `)}
    `;
  }

  // ── Priority table ────────────────────────────────────────────────────────

  private renderPriorityTable(priorities: PriorityDist[]) {
    return html`
      <table class="data-table">
        <thead><tr>
          <th>Priority</th><th>Total</th><th>Done</th><th>Failed</th><th>Pending</th>
        </tr></thead>
        <tbody>
          ${priorities.map((p) => html`
            <tr>
              <td><span class="priority-badge pri-${p.priority}">${p.priority}</span></td>
              <td>${p.total}</td>
              <td style="color:#22c55e;">${p.completed}</td>
              <td style="color:#ef4444;">${p.failed}</td>
              <td style="color:#94a3b8;">${p.pending}</td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  // ── Workflow table ────────────────────────────────────────────────────────

  private renderWorkflowTable(workflows: WorkflowAnalyticsSummary[]) {
    return html`
      <table class="data-table">
        <thead><tr>
          <th>Workflow</th><th>Runs</th><th>Done</th><th>Failed</th><th>Avg Duration</th>
        </tr></thead>
        <tbody>
          ${workflows.map((w) => html`
            <tr>
              <td style="font-weight:500;">${w.name}</td>
              <td>${w.totalRuns}</td>
              <td style="color:#22c55e;">${w.completed}</td>
              <td style="color:#ef4444;">${w.failed}</td>
              <td style="color:#94a3b8;">${this.fmtDuration(w.avgDurationMs)}</td>
            </tr>
          `)}
        </tbody>
      </table>
    `;
  }

  // ── SLA gauge ─────────────────────────────────────────────────────────────

  private renderSla(s: { total: number; metDeadline: number; missedDeadline: number; noDeadline: number; complianceRate: number }) {
    return html`
      <div style="display:flex;align-items:center;gap:24px;">
        <div style="text-align:center;">
          <div style="font-size:36px;font-weight:700;color:${s.complianceRate >= 80 ? "#22c55e" : s.complianceRate >= 50 ? "#f59e0b" : "#ef4444"}">
            ${s.complianceRate}%
          </div>
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;">Compliance</div>
        </div>
        <div style="flex:1;">
          <div style="display:flex;gap:20px;font-size:12px;color:#94a3b8;">
            <span>Met: <b style="color:#22c55e;">${s.metDeadline}</b></span>
            <span>Missed: <b style="color:#ef4444;">${s.missedDeadline}</b></span>
            <span>No Deadline: <b>${s.noDeadline}</b></span>
          </div>
          <div class="bar-bg" style="margin-top:8px;height:10px;">
            <div class="bar-fill" style="width:${s.complianceRate}%;background:${s.complianceRate >= 80 ? "#22c55e" : s.complianceRate >= 50 ? "#f59e0b" : "#ef4444"};"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  private renderTags(tags: TagBreakdown[]) {
    return html`
      <div class="tag-chips">
        ${tags.map((t) => html`
          <div class="tag-chip">
            ${t.tag}<span class="tag-count">${t.count}</span>
            <span style="font-size:9px;color:#475569;margin-left:4px;">
              ${t.completed}ok ${t.failed}fail
            </span>
          </div>
        `)}
      </div>
    `;
  }

  // ── Intelligence: Agent Capabilities ──────────────────────────────────────

  private renderAgentCapabilities() {
    const caps = this.app.agentCapabilities;
    if (!caps.length) return nothing;

    // Group by agent
    const byAgent = new Map<string, AgentCapability[]>();
    for (const cap of caps) {
      if (!byAgent.has(cap.agentId)) byAgent.set(cap.agentId, []);
      byAgent.get(cap.agentId)!.push(cap);
    }

    return html`
      <div class="section">
        <div class="section-title">Agent Capabilities (learned from task history)</div>
        <div class="cap-grid">
          ${Array.from(byAgent.entries()).map(([agentId, agentCaps]) => {
            const sorted = agentCaps.sort((a, b) => b.proficiency - a.proficiency).slice(0, 8);
            return html`
              <div class="cap-card">
                <div class="cap-card-agent">${agentId}</div>
                ${sorted.map((c) => {
                  const pct = Math.round(c.proficiency * 100);
                  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
                  return html`
                    <div class="cap-row">
                      <span class="cap-name" title="${c.capability}">${c.capability.replace(/^(type|tag|domain|priority):/, "")}</span>
                      <div class="cap-bar">
                        <div class="cap-bar-fill" style="width:${pct}%;background:${color};"></div>
                      </div>
                      <span class="cap-pct">${pct}%</span>
                      <span class="cap-samples">(${c.sampleCount})</span>
                    </div>
                  `;
                })}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  // ── Intelligence: Routing Rules ───────────────────────────────────────────

  private renderRoutingRules() {
    const rules = this.app.routingRules;
    if (!rules.length) return nothing;

    return html`
      <div class="section">
        <div class="section-title">Routing Rules</div>
        ${rules.map((r) => html`
          <div class="rule-row">
            <span class="rule-type">${r.ruleType}</span>
            <span style="flex:1;color:#e2e8f0;">${r.name}</span>
            <span class="rule-agent">${r.preferredAgentId}</span>
            <span class="rule-confidence">${Math.round(r.confidence * 100)}%</span>
            <span class="rule-fires">${r.fireCount} fires</span>
            <span style="font-size:10px;color:${r.enabled ? "#22c55e" : "#ef4444"};">${r.enabled ? "on" : "off"}</span>
          </div>
        `)}
      </div>
    `;
  }
}
