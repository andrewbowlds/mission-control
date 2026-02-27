import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, CalendarEvent } from "../app.ts";

@customElement("mc-calendar")
export class MCCalendar extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  @state() private showModal = false;
  @state() private editingJobId: string | null = null;

  // Form state
  @state() private formName = "";
  @state() private formScheduleType: "cron" | "every" | "at" = "cron";
  @state() private formCronExpr = "";
  @state() private formEveryMs = 60000;
  @state() private formAtTime = "";
  @state() private formTimezone = "UTC";
  @state() private formDeliveryMethod = "gateway";
  @state() private formDeliveryTarget = "";

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box; }

    .card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      padding: 16px; max-width: 900px;
    }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .header h2 { margin: 0; font-size: 18px; }
    .meta { font-size: 12px; color: #475569; }

    .job {
      border-top: 1px solid #1a1a2a; padding: 12px 0;
      display: flex; align-items: flex-start; gap: 12px;
    }
    .job-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
    .dot-enabled { background: #22c55e; }
    .dot-disabled { background: #475569; }
    .job-info { flex: 1; min-width: 0; }
    .job-name { font-weight: 500; font-size: 14px; }
    .job-expr { font-size: 12px; color: #94a3b8; margin-top: 2px; font-family: monospace; }
    .job-times { font-size: 12px; color: #475569; margin-top: 4px; }
    .job-status { font-size: 11px; margin-top: 4px; }
    .status-success { color: #22c55e; }
    .status-failed { color: #f87171; }
    .job-actions { display: flex; gap: 4px; flex-shrink: 0; margin-top: 2px; }
    .empty { text-align: center; padding: 30px; color: #475569; }

    /* Linked workflow indicator */
    .linked-wf {
      font-size: 11px; color: #a78bfa; margin-top: 4px;
      display: flex; align-items: center; gap: 4px;
    }

    button {
      background: #0a0a0f; color: #e2e8f0; border: 1px solid #2d2d44;
      border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; font-family: inherit;
    }
    button:hover { background: #1e1e2e; }
    .btn-primary { background: #7c3aed; border-color: #8b5cf6; }
    .btn-primary:hover { background: #8b5cf6; }
    .btn-danger { color: #ef4444; border-color: #3b0a0a; }
    .btn-danger:hover { background: #3b0a0a; }
    .btn-success { background: #15803d; border-color: #22c55e; }
    .btn-success:hover { background: #16a34a; }
    .btn-sm { padding: 3px 8px; font-size: 11px; }

    /* ── Modal ────────────────────────────────────────────────────── */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 100;
      display: flex; align-items: center; justify-content: center;
    }
    .modal {
      background: #111118; border: 1px solid #2d2d44; border-radius: 10px;
      padding: 24px; width: 460px; max-width: 90vw; max-height: 80vh; overflow-y: auto;
    }
    .modal h3 { margin: 0 0 16px; font-size: 16px; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
    .form-group input, .form-group select {
      width: 100%; background: #0a0a0f; border: 1px solid #2d2d44; color: #e2e8f0;
      border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit;
      box-sizing: border-box;
    }
    .form-row { display: flex; gap: 12px; }
    .form-row .form-group { flex: 1; }
    .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .hint { font-size: 11px; color: #475569; margin-top: 4px; }

    /* ── Calendar Events ──────────────────────────────────────── */
    .events-card { margin-top: 20px; }
    .day-group { margin-bottom: 16px; }
    .day-label {
      font-size: 12px; font-weight: 600; color: #a78bfa;
      text-transform: uppercase; letter-spacing: 0.06em;
      margin-bottom: 6px; padding-bottom: 4px;
      border-bottom: 1px solid #1a1a2a;
    }
    .day-label.today { color: #22c55e; }
    .event {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid #0f0f1a;
      font-size: 13px;
    }
    .event:last-child { border-bottom: none; }
    .event-time {
      font-size: 11px; color: #64748b; font-family: monospace;
      min-width: 100px; flex-shrink: 0;
    }
    .event-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-location { font-size: 11px; color: #475569; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-linked { font-size: 9px; color: #a78bfa; padding: 2px 6px; background: #1e1035; border-radius: 4px; }
    .event-allday { font-size: 10px; color: #818cf8; }
    .event-cancelled { text-decoration: line-through; opacity: 0.5; }
    .event-tentative { opacity: 0.7; font-style: italic; }
  `;

  private fmtTs(ts?: number): string {
    if (!ts) return "n/a";
    return new Date(ts).toLocaleString();
  }

  private fmtInterval(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  private getScheduleDisplay(job: any): string {
    if (job.expression) return job.expression;
    if (job.schedule) {
      if (typeof job.schedule === "string") return job.schedule;
      if (job.schedule.kind === "cron") return `${job.schedule.expr}${job.schedule.tz ? ` (${job.schedule.tz})` : ""}`;
      if (job.schedule.kind === "every") return `every ${this.fmtInterval(job.schedule.everyMs)}`;
      if (job.schedule.kind === "at") return `at ${new Date(job.schedule.at).toLocaleString()}`;
    }
    return "n/a";
  }

  private findLinkedWorkflow(jobId: string): string | undefined {
    return this.app.workflows.find((w) => w.cronJobId === jobId)?.name;
  }

  // ── Create/Edit ────────────────────────────────────────────────────────

  private openCreate(): void {
    this.editingJobId = null;
    this.formName = "";
    this.formScheduleType = "cron";
    this.formCronExpr = "0 9 * * *";
    this.formEveryMs = 60000;
    this.formAtTime = "";
    this.formTimezone = "UTC";
    this.formDeliveryMethod = "gateway";
    this.formDeliveryTarget = "";
    this.showModal = true;
  }

  private openEdit(job: any): void {
    this.editingJobId = job.id;
    this.formName = job.name || "";
    this.formDeliveryMethod = "gateway";
    this.formDeliveryTarget = "";
    this.formTimezone = "UTC";

    // Parse schedule
    const sched = job.schedule;
    if (sched?.kind === "every") {
      this.formScheduleType = "every";
      this.formEveryMs = sched.everyMs ?? 60000;
    } else if (sched?.kind === "at") {
      this.formScheduleType = "at";
      this.formAtTime = sched.at ? new Date(sched.at).toISOString().slice(0, 16) : "";
    } else {
      this.formScheduleType = "cron";
      this.formCronExpr = sched?.expr ?? job.expression ?? "";
      this.formTimezone = sched?.tz ?? "UTC";
    }

    // Parse delivery
    const delivery = job.delivery;
    if (delivery) {
      this.formDeliveryMethod = delivery.method ?? "gateway";
      this.formDeliveryTarget = delivery.target ?? "";
    }

    this.showModal = true;
  }

  private buildSchedule(): any {
    switch (this.formScheduleType) {
      case "cron": return { kind: "cron", expr: this.formCronExpr, tz: this.formTimezone || undefined };
      case "every": return { kind: "every", everyMs: this.formEveryMs };
      case "at": return { kind: "at", at: this.formAtTime ? new Date(this.formAtTime).getTime() : Date.now() + 60000 };
    }
  }

  private async submit(): Promise<void> {
    if (!this.formName.trim()) return;
    const schedule = this.buildSchedule();
    const delivery = {
      method: this.formDeliveryMethod,
      target: this.formDeliveryTarget || undefined,
    };

    if (this.editingJobId) {
      await this.app.updateCronJob(this.editingJobId, { name: this.formName.trim(), schedule, delivery });
    } else {
      await this.app.addCronJob({ name: this.formName.trim(), schedule, delivery });
    }
    this.showModal = false;
  }

  private async deleteJob(id: string, name: string): Promise<void> {
    if (!confirm(`Delete cron job "${name}"?`)) return;
    await this.app.removeCronJob(id);
  }

  private async runNow(id: string): Promise<void> {
    await this.app.runCronJob(id);
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    const jobs = this.app.cronJobs || [];
    return html`
      <div class="card">
        <div class="header">
          <h2>Scheduled Jobs</h2>
          <span class="meta">Source: ${this.app.cronSource || "unknown"}</span>
          <button @click=${() => this.app.reload()}>Refresh</button>
          <button class="btn-primary btn-sm" @click=${() => this.openCreate()}>+ New Job</button>
        </div>
        ${jobs.length === 0
          ? html`<div class="empty">No cron jobs found. Create one to schedule tasks.</div>`
          : jobs.map((j: any) => this.renderJob(j))}
      </div>

      ${this.renderCalendarEvents()}

      ${this.showModal ? this.renderModal() : nothing}
    `;
  }

  // ── Calendar Events ────────────────────────────────────────────────────

  private groupEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
    const groups = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.startAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ev);
    }
    return groups;
  }

  private fmtEventTime(ev: CalendarEvent): string {
    if (ev.allDay) return "All day";
    const s = new Date(ev.startAt);
    const e = new Date(ev.endAt);
    return `${s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  private fmtDayLabel(key: string): { label: string; isToday: boolean } {
    const d = new Date(key + "T00:00:00");
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const label = isToday ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return { label, isToday };
  }

  private renderCalendarEvents() {
    const events = this.app.calendarEvents || [];
    if (events.length === 0 && !this.app.integrations?.some((i) => i.type === "google_calendar" && i.status === "connected")) {
      return nothing;
    }

    const grouped = this.groupEventsByDay(events);
    return html`
      <div class="card events-card">
        <div class="header">
          <h2>Calendar Events</h2>
          <span class="meta">${events.length} events</span>
          <button @click=${() => void this.app.gcalSync()}>Sync</button>
        </div>
        ${events.length === 0
          ? html`<div class="empty">No calendar events. Click Sync to fetch from Google Calendar.</div>`
          : Array.from(grouped.entries()).map(([key, dayEvents]) => {
              const { label, isToday } = this.fmtDayLabel(key);
              return html`
                <div class="day-group">
                  <div class="day-label ${isToday ? "today" : ""}">${label}</div>
                  ${dayEvents.map((ev) => html`
                    <div class="event ${ev.status === "cancelled" ? "event-cancelled" : ev.status === "tentative" ? "event-tentative" : ""}">
                      <span class="event-time">${this.fmtEventTime(ev)}</span>
                      <span class="event-title">${ev.title}</span>
                      ${ev.location ? html`<span class="event-location">${ev.location}</span>` : nothing}
                      ${ev.taskId ? html`<span class="event-linked">Linked</span>` : nothing}
                    </div>
                  `)}
                </div>
              `;
            })}
      </div>
    `;
  }

  private renderJob(j: any) {
    const linkedWf = this.findLinkedWorkflow(j.id);
    return html`
      <div class="job">
        <div class="job-dot ${j.enabled === false ? "dot-disabled" : "dot-enabled"}"></div>
        <div class="job-info">
          <div class="job-name">
            ${j.name || j.id || "job"}
            ${j.enabled === false ? html`<span class="meta">(disabled)</span>` : nothing}
          </div>
          <div class="job-expr">${this.getScheduleDisplay(j)}</div>
          <div class="job-times">
            Next: ${this.fmtTs(j.nextRunAt)} &middot; Last: ${this.fmtTs(j.lastRunAt)}
          </div>
          ${j.lastStatus
            ? html`<div class="job-status ${j.lastStatus === "success" ? "status-success" : "status-failed"}">
                Last run: ${j.lastStatus}${j.lastError ? ` — ${j.lastError}` : ""}
              </div>`
            : nothing}
          ${linkedWf ? html`<div class="linked-wf">Linked to workflow: ${linkedWf}</div>` : nothing}
        </div>
        <div class="job-actions">
          <button class="btn-success btn-sm" @click=${() => this.runNow(j.id)}>Run</button>
          <button class="btn-sm" @click=${() => this.openEdit(j)}>Edit</button>
          <button class="btn-danger btn-sm" @click=${() => this.deleteJob(j.id, j.name || j.id)}>Del</button>
        </div>
      </div>
    `;
  }

  private renderModal() {
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) this.showModal = false; }}>
        <div class="modal">
          <h3>${this.editingJobId ? "Edit Cron Job" : "New Cron Job"}</h3>

          <div class="form-group">
            <label>Name</label>
            <input .value=${this.formName} @input=${(e: Event) => { this.formName = (e.target as HTMLInputElement).value; }}>
          </div>

          <div class="form-group">
            <label>Schedule Type</label>
            <select .value=${this.formScheduleType} @change=${(e: Event) => { this.formScheduleType = (e.target as HTMLSelectElement).value as any; }}>
              <option value="cron">Cron Expression</option>
              <option value="every">Repeat Interval</option>
              <option value="at">One-time At</option>
            </select>
          </div>

          ${this.formScheduleType === "cron" ? html`
            <div class="form-row">
              <div class="form-group">
                <label>Cron Expression</label>
                <input .value=${this.formCronExpr} @input=${(e: Event) => { this.formCronExpr = (e.target as HTMLInputElement).value; }}
                  placeholder="0 9 * * *">
                <div class="hint">min hour day month weekday</div>
              </div>
              <div class="form-group">
                <label>Timezone</label>
                <input .value=${this.formTimezone} @input=${(e: Event) => { this.formTimezone = (e.target as HTMLInputElement).value; }}
                  placeholder="UTC">
              </div>
            </div>
          ` : nothing}

          ${this.formScheduleType === "every" ? html`
            <div class="form-group">
              <label>Repeat Every (seconds)</label>
              <input type="number" min="1" .value=${String(Math.round(this.formEveryMs / 1000))}
                @input=${(e: Event) => { this.formEveryMs = (parseInt((e.target as HTMLInputElement).value) || 60) * 1000; }}>
              <div class="hint">Current: ${this.fmtInterval(this.formEveryMs)}</div>
            </div>
          ` : nothing}

          ${this.formScheduleType === "at" ? html`
            <div class="form-group">
              <label>Run At</label>
              <input type="datetime-local" .value=${this.formAtTime}
                @input=${(e: Event) => { this.formAtTime = (e.target as HTMLInputElement).value; }}>
            </div>
          ` : nothing}

          <div class="form-row">
            <div class="form-group">
              <label>Delivery Method</label>
              <select .value=${this.formDeliveryMethod} @change=${(e: Event) => { this.formDeliveryMethod = (e.target as HTMLSelectElement).value; }}>
                <option value="gateway">Gateway</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div class="form-group">
              <label>Target (optional)</label>
              <input .value=${this.formDeliveryTarget} @input=${(e: Event) => { this.formDeliveryTarget = (e.target as HTMLInputElement).value; }}
                placeholder="${this.formDeliveryMethod === "http" ? "https://..." : "method name"}">
            </div>
          </div>

          <div class="modal-actions">
            <button @click=${() => { this.showModal = false; }}>Cancel</button>
            <button class="btn-primary" @click=${() => this.submit()}>${this.editingJobId ? "Save" : "Create"}</button>
          </div>
        </div>
      </div>
    `;
  }
}
