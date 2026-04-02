import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AppFacade, CalendarEvent } from "../app.ts";

@customElement("mc-calendar")
export class MCCalendar extends LitElement {
  @property({ attribute: false }) app!: AppFacade;

  @state() private showModal = false;
  @state() private editingJobId: string | null = null;

  // Calendar navigation state
  @state() private calView: "day" | "week" | "month" = "week";
  @state() private calAnchor: Date = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

  // Form state
  @state() private formName = "";
  @state() private formScheduleType: "cron" | "every" | "at" = "cron";
  @state() private formCronExpr = "";
  @state() private formEveryMs = 60000;
  @state() private formAtTime = "";
  @state() private formTimezone = "UTC";
  @state() private formDeliveryMethod = "gateway";
  @state() private formDeliveryTarget = "";

  private readonly HOUR_H = 52; // px per hour in time grid
  private _pendingScrollToNow = true;

  protected updated(): void {
    if (this._pendingScrollToNow && this.calView !== "month") {
      const el = this.shadowRoot?.querySelector(".time-scroll") as HTMLElement | null;
      if (el) {
        const now = new Date();
        el.scrollTop = Math.max(0, (now.getHours() + now.getMinutes() / 60) * this.HOUR_H - 100);
        this._pendingScrollToNow = false;
      }
    }
  }

  static styles = css`
    :host { display: block; height: 100%; overflow: auto; padding: 20px; box-sizing: border-box; }

    /* ── Shared ──────────────────────────────────────────────────── */
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

    /* ── Calendar card ────────────────────────────────────────────── */
    .cal-card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 10px;
      margin-top: 20px; max-width: 900px; overflow: hidden;
    }

    /* Toolbar */
    .cal-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid #1e1e2e; gap: 8px; flex-wrap: wrap;
    }
    .cal-nav { display: flex; align-items: center; gap: 6px; }
    .cal-nav button { font-size: 16px; padding: 2px 10px; line-height: 1; }
    .cal-title { font-size: 14px; font-weight: 600; min-width: 180px; text-align: center; }
    .cal-controls { display: flex; align-items: center; gap: 6px; }
    .view-toggle { display: flex; border: 1px solid #2d2d44; border-radius: 6px; overflow: hidden; }
    .view-toggle button { border: none; border-right: 1px solid #2d2d44; border-radius: 0; }
    .view-toggle button:last-child { border-right: none; }
    .btn-active { background: #3b1d8a !important; color: #c4b5fd !important; }

    /* ── Week / Day header row ──────────────────────────────────── */
    .week-head {
      display: grid; border-bottom: 1px solid #1e1e2e;
    }
    .time-gutter { width: 52px; flex-shrink: 0; }
    .day-head {
      display: flex; flex-direction: column; align-items: center;
      padding: 6px 4px; gap: 3px; border-left: 1px solid #1a1a2a;
    }
    .day-head.today-col { background: rgba(124,58,237,0.05); }
    .day-name { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .day-num {
      font-size: 18px; font-weight: 300; line-height: 1;
      width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
    }
    .day-num.today {
      background: #7c3aed; color: white; border-radius: 50%;
      font-size: 14px; font-weight: 600;
    }

    /* All-day row */
    .allday-row { display: grid; border-bottom: 1px solid #1e1e2e; min-height: 26px; }
    .allday-label {
      font-size: 9px; color: #475569; text-align: right; padding: 4px 6px 0 0;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .allday-cell { border-left: 1px solid #1a1a2a; padding: 2px; }

    /* Event chips (all-day + month view) */
    .chip {
      font-size: 10px; background: #1e1035; border-left: 2px solid #a78bfa;
      color: #e2e8f0; padding: 1px 5px; border-radius: 2px;
      margin-bottom: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chip-tentative { border-left-color: #ca8a04; background: #1a1400; opacity: 0.8; }
    .chip-cancelled { border-left-color: #475569; background: #0f0f1a; opacity: 0.5; text-decoration: line-through; }

    /* Time grid */
    .time-scroll { overflow-y: auto; height: 560px; }
    .time-grid { display: grid; }
    .time-col { /* stacks hour labels */ }
    .hour-label {
      height: 52px; font-size: 10px; color: #475569;
      text-align: right; padding-right: 8px; padding-top: 0;
      box-sizing: border-box; display: flex; align-items: flex-start;
      justify-content: flex-end; padding-top: 2px;
    }
    .day-col { position: relative; border-left: 1px solid #1a1a2a; }
    .day-col.today-col { background: rgba(124,58,237,0.04); }
    .hour-slot { height: 52px; border-bottom: 1px solid #0d0d1a; box-sizing: border-box; }

    /* Current time indicator */
    .now-line {
      position: absolute; left: 0; right: 0; height: 2px;
      background: #ef4444; z-index: 2; pointer-events: none;
    }
    .now-line::before {
      content: ''; position: absolute; left: -4px; top: -4px;
      width: 10px; height: 10px; background: #ef4444; border-radius: 50%;
    }

    /* Timed events */
    .cal-event-timed {
      position: absolute;
      background: #1e1035; border: 1px solid #6d28d9; border-left: 3px solid #a78bfa;
      border-radius: 4px; padding: 2px 5px; font-size: 11px;
      overflow: hidden; z-index: 1; box-sizing: border-box; cursor: default;
    }
    .cal-event-timed:hover { background: #2d1a50; z-index: 3; }
    .cal-event-timed.ev-tentative {
      border-left-color: #ca8a04; border-color: #92400e; background: #1a1000; opacity: 0.85;
    }
    .cal-event-timed.ev-cancelled {
      border-left-color: #475569; border-color: #1e293b; background: #0a0a10; opacity: 0.5;
    }
    .ev-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ev-loc { font-size: 9px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Month View ─────────────────────────────────────────────── */
    .month-head { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid #1e1e2e; }
    .month-day-head {
      text-align: center; font-size: 10px; color: #475569;
      text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0;
    }
    .month-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
    .month-cell {
      min-height: 88px; border-bottom: 1px solid #0d0d1a; border-right: 1px solid #0d0d1a;
      padding: 4px; box-sizing: border-box;
    }
    .month-cell:nth-child(7n) { border-right: none; }
    .month-cell.other-month { opacity: 0.35; }
    .month-cell.today-cell { background: rgba(124,58,237,0.06); }
    .month-date {
      font-size: 12px; font-weight: 500;
      width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
      margin-bottom: 2px;
    }
    .month-date.today {
      background: #7c3aed; color: white; border-radius: 50%; font-weight: 600;
    }
    .month-more { font-size: 9px; color: #64748b; padding: 1px 4px; }

    /* ── Cron job events ────────────────────────────────────────── */
    .chip-cron { border-left-color: #22c55e; background: #0a1f0f; color: #86efac; }
    .chip-cron-disabled { opacity: 0.45; }
    .cal-event-timed.ev-cron {
      background: #0a1f0f; border-color: #166534; border-left-color: #22c55e; color: #86efac;
    }
    .cal-event-timed.ev-cron:hover { background: #14532d; }
    .cal-event-timed.ev-cron-disabled { opacity: 0.4; }

    /* ── Empty state ────────────────────────────────────────────── */
    .cal-empty { text-align: center; padding: 40px; color: #475569; }
  `;

  // ── Navigation ──────────────────────────────────────────────────────────

  private navPrev(): void {
    const d = new Date(this.calAnchor);
    if (this.calView === "day") d.setDate(d.getDate() - 1);
    else if (this.calView === "week") d.setDate(d.getDate() - 7);
    else { d.setMonth(d.getMonth() - 1); d.setDate(1); }
    this.calAnchor = d;
    this._pendingScrollToNow = false;
  }

  private navNext(): void {
    const d = new Date(this.calAnchor);
    if (this.calView === "day") d.setDate(d.getDate() + 1);
    else if (this.calView === "week") d.setDate(d.getDate() + 7);
    else { d.setMonth(d.getMonth() + 1); d.setDate(1); }
    this.calAnchor = d;
    this._pendingScrollToNow = false;
  }

  private goToday(): void {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    this.calAnchor = d;
    this._pendingScrollToNow = true;
  }

  private setView(v: "day" | "week" | "month"): void {
    this.calView = v;
    this._pendingScrollToNow = true;
  }

  // ── Date helpers ─────────────────────────────────────────────────────────

  private sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private isToday(d: Date): boolean { return this.sameDay(d, new Date()); }

  private getWeekDays(): Date[] {
    const anchor = new Date(this.calAnchor);
    const sunday = new Date(anchor);
    sunday.setDate(anchor.getDate() - anchor.getDay());
    sunday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
  }

  private getMonthWeeks(): Date[][] {
    const year = this.calAnchor.getFullYear();
    const month = this.calAnchor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const gridStart = new Date(firstDay);
    gridStart.setDate(1 - firstDay.getDay());
    const weeks: Date[][] = [];
    const cur = new Date(gridStart);
    while (cur <= lastDay || weeks.length < 6) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
      weeks.push(week);
      if (weeks.length >= 6) break;
    }
    return weeks;
  }

  private getNavTitle(): string {
    if (this.calView === "month") {
      return this.calAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    if (this.calView === "day") {
      return this.calAnchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    const days = this.getWeekDays();
    const s = days[0], e = days[6];
    if (s.getMonth() === e.getMonth()) {
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.getDate()}, ${e.getFullYear()}`;
    }
    if (s.getFullYear() === e.getFullYear()) {
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${e.getFullYear()}`;
    }
    return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }

  private fmtHour(h: number): string {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
  }

  // ── Event helpers ────────────────────────────────────────────────────────

  private cronEventsForDay(day: Date): Array<CalendarEvent & { isCron: true; jobEnabled: boolean }> {
    const jobs = this.app.cronJobs || [];
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
    const ds = dayStart.getTime(), de = dayEnd.getTime();
    const dur = 20 * 60 * 1000; // 20-minute display duration
    const results: Array<CalendarEvent & { isCron: true; jobEnabled: boolean }> = [];

    for (const job of jobs) {
      const name = job.name || job.id || "Scheduled Job";
      const enabled = job.enabled !== false;
      const sched = job.schedule;

      const makeEv = (t: number) => ({
        id: `cron-${job.id}-${t}`,
        integrationId: "cron",
        externalId: job.id,
        title: name,
        startAt: t,
        endAt: t + dur,
        allDay: false as const,
        status: "confirmed" as const,
        syncedAt: 0, createdAt: 0, updatedAt: 0,
        isCron: true as const,
        jobEnabled: enabled,
      });

      if (sched?.kind === "every" && sched.everyMs > 0) {
        let t = job.nextRunAt ?? Date.now();
        // Walk back to find first occurrence on or before this day
        while (t - sched.everyMs >= ds) t -= sched.everyMs;
        while (t <= de) {
          if (t >= ds) results.push(makeEv(t));
          t += sched.everyMs;
        }
      } else {
        const at = job.nextRunAt ?? (sched?.kind === "at" ? sched.at : undefined);
        if (at && at >= ds && at <= de) results.push(makeEv(at));
      }
    }
    return results;
  }

  private eventsForDay(day: Date): Array<CalendarEvent & { isCron?: true; jobEnabled?: boolean }> {
    const calEvents = this.app.calendarEvents || [];
    const filtered = calEvents.filter((ev) => {
      if (ev.allDay) {
        const startDay = new Date(ev.startAt); startDay.setHours(0, 0, 0, 0);
        const endDay = new Date(ev.endAt); endDay.setHours(0, 0, 0, 0);
        const d = new Date(day); d.setHours(0, 0, 0, 0);
        return d >= startDay && d < endDay;
      }
      return this.sameDay(new Date(ev.startAt), day);
    });
    return [...filtered, ...this.cronEventsForDay(day)];
  }

  private calcEventTop(ev: CalendarEvent): number {
    const d = new Date(ev.startAt);
    return (d.getHours() + d.getMinutes() / 60) * this.HOUR_H;
  }

  private calcEventHeight(ev: CalendarEvent): number {
    const dur = (ev.endAt - ev.startAt) / 3600000;
    return Math.max(dur * this.HOUR_H, 20);
  }

  private layoutTimedEvents(events: CalendarEvent[]): Array<{ ev: CalendarEvent; col: number; cols: number }> {
    const sorted = [...events].sort((a, b) => a.startAt - b.startAt);
    const laneEnds: number[] = [];
    const result: Array<{ ev: CalendarEvent; col: number; cols: number }> = [];

    for (const ev of sorted) {
      let lane = laneEnds.findIndex((end) => end <= ev.startAt);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = ev.endAt;
      result.push({ ev, col: lane, cols: 0 });
    }

    for (const item of result) {
      const overlapping = result.filter(
        (o) => o.ev.startAt < item.ev.endAt && o.ev.endAt > item.ev.startAt
      );
      item.cols = overlapping.reduce((max, o) => Math.max(max, o.col), 0) + 1;
    }

    return result;
  }

  private evStatusClass(ev: CalendarEvent & { isCron?: boolean; jobEnabled?: boolean }): string {
    if ((ev as any).isCron) return (ev as any).jobEnabled === false ? "ev-cron ev-cron-disabled" : "ev-cron";
    if (ev.status === "cancelled") return "ev-cancelled";
    if (ev.status === "tentative") return "ev-tentative";
    return "";
  }

  private chipClass(ev: CalendarEvent & { isCron?: boolean; jobEnabled?: boolean }): string {
    if ((ev as any).isCron) return (ev as any).jobEnabled === false ? "chip chip-cron chip-cron-disabled" : "chip chip-cron";
    if (ev.status === "cancelled") return "chip chip-cancelled";
    if (ev.status === "tentative") return "chip chip-tentative";
    return "chip";
  }

  // ── Cron helpers (unchanged) ─────────────────────────────────────────────

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
    const delivery = { method: this.formDeliveryMethod, target: this.formDeliveryTarget || undefined };
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

      ${this.renderCalendarSection()}

      ${this.showModal ? this.renderModal() : nothing}
    `;
  }

  // ── Calendar section ─────────────────────────────────────────────────────

  private renderCalendarSection() {
    return html`
      <div class="cal-card">
        ${this.renderCalToolbar()}
        ${this.calView === "month" ? this.renderMonthView() : this.renderTimeView(
          this.calView === "week" ? this.getWeekDays() : [this.calAnchor]
        )}
      </div>
    `;
  }

  private renderCalToolbar() {
    return html`
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="btn-sm" @click=${() => this.navPrev()}>&#8249;</button>
          <span class="cal-title">${this.getNavTitle()}</span>
          <button class="btn-sm" @click=${() => this.navNext()}>&#8250;</button>
        </div>
        <div class="cal-controls">
          <button class="btn-sm" @click=${() => this.goToday()}>Today</button>
          <div class="view-toggle">
            ${(["day", "week", "month"] as const).map((v) => html`
              <button
                class="btn-sm ${this.calView === v ? "btn-active" : ""}"
                @click=${() => this.setView(v)}
              >${v[0].toUpperCase() + v.slice(1)}</button>
            `)}
          </div>
          <button class="btn-sm" @click=${() => void this.app.gcalSync()}>Sync</button>
        </div>
      </div>
    `;
  }

  // ── Time view (week + day share this) ────────────────────────────────────

  private renderTimeView(days: Date[]) {
    const now = new Date();
    const cols = `52px repeat(${days.length}, 1fr)`;

    return html`
      <!-- Day name + date header -->
      <div class="week-head" style="grid-template-columns: ${cols}">
        <div class="time-gutter"></div>
        ${days.map((d) => html`
          <div class="day-head ${this.isToday(d) ? "today-col" : ""}">
            <span class="day-name">${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
            <span class="day-num ${this.isToday(d) ? "today" : ""}">${d.getDate()}</span>
          </div>
        `)}
      </div>

      <!-- All-day row -->
      <div class="allday-row" style="grid-template-columns: ${cols}">
        <div class="time-gutter allday-label">all‑day</div>
        ${days.map((d) => html`
          <div class="allday-cell">
            ${this.eventsForDay(d)
              .filter((ev) => ev.allDay)
              .map((ev) => html`
                <div class="${this.chipClass(ev)}" title="${ev.title}">${ev.title}</div>
              `)}
          </div>
        `)}
      </div>

      <!-- Scrollable time grid -->
      <div class="time-scroll">
        <div class="time-grid" style="grid-template-columns: ${cols}">
          <!-- Hour labels -->
          <div class="time-col">
            ${Array.from({ length: 24 }, (_, h) => html`
              <div class="hour-label">${this.fmtHour(h)}</div>
            `)}
          </div>

          <!-- Day columns -->
          ${days.map((d) => {
            const timed = this.eventsForDay(d).filter((ev) => !ev.allDay);
            const laid = this.layoutTimedEvents(timed);
            const todayCol = this.isToday(d);
            return html`
              <div class="day-col ${todayCol ? "today-col" : ""}">
                ${Array.from({ length: 24 }, () => html`<div class="hour-slot"></div>`)}

                ${todayCol ? html`
                  <div class="now-line" style="top: ${(now.getHours() + now.getMinutes() / 60) * this.HOUR_H}px"></div>
                ` : nothing}

                ${laid.map(({ ev, col, cols: numCols }) => html`
                  <div
                    class="cal-event-timed ${this.evStatusClass(ev)}"
                    style="
                      top: ${this.calcEventTop(ev)}px;
                      height: ${this.calcEventHeight(ev)}px;
                      left: calc(${(col / numCols) * 100}% + 2px);
                      width: calc(${(1 / numCols) * 100}% - 4px);
                    "
                    title="${ev.title}${ev.location ? `\n${ev.location}` : ""}"
                  >
                    <div class="ev-title">${ev.title}</div>
                    ${ev.location ? html`<div class="ev-loc">${ev.location}</div>` : nothing}
                  </div>
                `)}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  // ── Month view ───────────────────────────────────────────────────────────

  private renderMonthView() {
    const year = this.calAnchor.getFullYear();
    const month = this.calAnchor.getMonth();
    const weeks = this.getMonthWeeks();

    return html`
      <div class="month-head">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => html`
          <div class="month-day-head">${d}</div>
        `)}
      </div>
      <div class="month-grid">
        ${weeks.map((week) => week.map((d) => {
          const dayEvents = this.eventsForDay(d);
          const otherMonth = d.getMonth() !== month;
          const todayCell = this.isToday(d);
          const MAX_CHIPS = 3;
          const visible = dayEvents.slice(0, MAX_CHIPS);
          const overflow = dayEvents.length - MAX_CHIPS;

          return html`
            <div class="month-cell ${otherMonth ? "other-month" : ""} ${todayCell ? "today-cell" : ""}">
              <div class="month-date ${todayCell ? "today" : ""}">${d.getDate()}</div>
              ${visible.map((ev) => html`
                <div class="${this.chipClass(ev)}" title="${ev.title}">
                  ${!ev.allDay ? html`<span style="color:#64748b">${new Date(ev.startAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} </span>` : nothing}${ev.title}
                </div>
              `)}
              ${overflow > 0 ? html`<div class="month-more">+${overflow} more</div>` : nothing}
            </div>
          `;
        }))}
      </div>
    `;
  }

  // ── Cron job render helpers (unchanged) ──────────────────────────────────

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
