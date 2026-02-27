import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { MCGatewayClient, type GatewayConnectionStatus, type GatewayEventFrame } from "./gateway-client.ts";
import "./views/dashboard.ts";
import "./views/tasks.ts";
import "./views/approvals.ts";
import "./views/chat.ts";
import "./views/people.ts";
import "./views/memory.ts";
import "./views/calendar.ts";
import "./views/team.ts";
import "./views/trello.ts";
import "./views/workflows.ts";
import "./views/automations.ts";
import "./views/analytics.ts";
import "./views/integrations.ts";

declare global {
  interface Window {
    __mcBootstrap?: { gatewayUrl?: string; basePath?: string };
  }
}

export type AgentRow = {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string; avatarUrl?: string; theme?: string };
};

export type SessionRow = {
  key: string;
  kind?: string;
  label?: string;
  updatedAt: number | null;
  lastMessagePreview?: string;
  sessionId?: string;
  channel?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

// ── Task Engine v2 Types ────────────────────────────────────────────────────

export type TaskStatus =
  | "pending" | "queued" | "running" | "waiting_approval"
  | "blocked" | "done" | "failed" | "cancelled";

export type TaskPriority = "critical" | "high" | "normal" | "low";

export type TaskUpdate = {
  id: string;
  taskId: string;
  author: string;
  note: string;
  status?: TaskStatus;
  link?: string;
  createdAt: number;
};

export type TaskRun = {
  id: string;
  taskId: string;
  agentId: string;
  sessionKey?: string;
  runNumber: number;
  status: "running" | "completed" | "failed" | "timeout" | "cancelled";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
};

export type Task = {
  id: string;
  parentId?: string;
  title: string;
  description?: string;
  agentId: string;
  sessionKey?: string;
  status: TaskStatus;
  priority: TaskPriority;
  taskType: string;
  executionMode: string;
  maxRetries: number;
  retryCount: number;
  timeoutMs?: number;
  requiresApproval: boolean;
  approvalStatus?: string;
  scheduledAt?: number;
  deadlineAt?: number;
  tags: string[];
  contextJson: string;
  resultJson?: string;
  errorMessage?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  children?: Task[];
  dependencies?: string[];
  updates?: TaskUpdate[];
  runs?: TaskRun[];
};

export type ApprovalRequest = {
  id: string;
  taskId: string;
  requestType: string;
  title: string;
  description?: string;
  contextJson?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy?: string;
  decidedBy?: string;
  decidedAt?: number;
  decisionNote?: string;
  createdAt: number;
};

export type EngineStatus = {
  running: boolean;
  maxConcurrent: number;
  autoExecute: boolean;
  activeTasks: number;
  queuedTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
};

export type Room = {
  id: string;
  name: string;
  agentIds: string[];
  sessionKeys: Record<string, string>;
  createdAt: number;
};

export type Person = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  status: "lead" | "prospect" | "customer" | "churned" | "partner";
  tags: string[];
  notes?: string;
  googleNotesRaw?: string;
  sourcePrimary?: string;
  lastContactedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type MemorySummary = { name: string; size: number; updatedAt: number };

// ── Trello Types ──────────────────────────────────────────────────────────

export type TrelloBoard = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export type TrelloList = {
  id: string;
  boardId: string;
  name: string;
  position: number;
  createdAt: number;
};

export type TrelloLabel = { color: string; text: string };
export type TrelloChecklistItem = { text: string; done: boolean };

export type TrelloCard = {
  id: string;
  listId: string;
  boardId: string;
  title: string;
  description?: string;
  position: number;
  labels: TrelloLabel[];
  dueAt?: number;
  assignee?: string;
  checklist: TrelloChecklistItem[];
  coverColor?: string;
  createdAt: number;
  updatedAt: number;
};

export type TrelloComment = {
  id: string;
  cardId: string;
  author: string;
  text: string;
  createdAt: number;
};

// ── Phase 2: Templates, Workflows, Automations ──────────────────────────

export type TaskTemplate = {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  priority: string;
  taskType: string;
  executionMode: string;
  maxRetries: number;
  timeoutMs?: number;
  requiresApproval: boolean;
  tags: string[];
  contextJson: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowTriggerType = "manual" | "cron" | "event";
export type WorkflowStepFailureAction = "stop" | "skip" | "retry";

export type WorkflowStep = {
  id: string;
  workflowId: string;
  stepOrder: number;
  name: string;
  templateId?: string;
  inlineConfigJson?: string;
  conditionJson?: string;
  onFailure: WorkflowStepFailureAction;
  retryCount: number;
  timeoutMs?: number;
  contextOverridesJson: string;
  createdAt: number;
};

export type Workflow = {
  id: string;
  name: string;
  description?: string;
  triggerType: WorkflowTriggerType;
  triggerConfigJson: string;
  enabled: boolean;
  cronJobId?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
};

export type WorkflowRunStep = {
  id: string;
  runId: string;
  stepId: string;
  taskId?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  endedAt?: number;
  error?: string;
  resultJson?: string;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  triggerSource?: string;
  contextJson: string;
  currentStep: number;
  startedAt: number;
  endedAt?: number;
  error?: string;
  steps: WorkflowRunStep[];
};

export type AutomationEventType = "task_completed" | "task_failed" | "cron";
export type AutomationActionType = "create_task" | "start_workflow" | "send_message";

export type AutomationRule = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  eventType: AutomationEventType;
  eventFilterJson: string;
  actionType: AutomationActionType;
  actionConfigJson: string;
  cooldownMs: number;
  lastFiredAt?: number;
  fireCount: number;
  createdAt: number;
  updatedAt: number;
};

// ── Phase 3: Analytics Types ──────────────────────────────────────────────

export type OverviewMetrics = {
  totalTasks: number;
  completed: number;
  failed: number;
  inProgress: number;
  queued: number;
  blocked: number;
  avgCompletionMs: number;
  approvalRate: number;
};

export type ThroughputBucket = { bucket: number; created: number; completed: number };
export type AgentPerformance = { agentId: string; tasksCompleted: number; tasksFailed: number; avgDurationMs: number; successRate: number };
export type DurationBucket = { label: string; count: number };
export type PriorityDist = { priority: string; total: number; completed: number; failed: number; pending: number };
export type WorkflowAnalyticsSummary = { workflowId: string; name: string; totalRuns: number; completed: number; failed: number; avgDurationMs: number };
export type SlaReport = { total: number; metDeadline: number; missedDeadline: number; noDeadline: number; complianceRate: number };
export type TagBreakdown = { tag: string; count: number; completed: number; failed: number };

export type AnalyticsData = {
  overview: OverviewMetrics | null;
  throughput: ThroughputBucket[];
  agents: AgentPerformance[];
  durations: DurationBucket[];
  priorities: PriorityDist[];
  workflows: WorkflowAnalyticsSummary[];
  sla: SlaReport | null;
  tags: TagBreakdown[];
};

// ── Phase 5: Intelligence Types ───────────────────────────────────────────

export type AgentCapability = {
  id: string;
  agentId: string;
  capability: string;
  proficiency: number;
  sampleCount: number;
  totalSuccesses: number;
  totalFailures: number;
  avgDurationMs?: number;
  lastUpdatedAt: number;
  createdAt: number;
};

export type RoutingRuleType = "keyword" | "tag" | "priority" | "task_type";

export type RoutingRule = {
  id: string;
  name: string;
  ruleType: RoutingRuleType;
  matchConfigJson: string;
  preferredAgentId: string;
  confidence: number;
  enabled: boolean;
  override: boolean;
  fireCount: number;
  createdAt: number;
  updatedAt: number;
};

export type AgentRecommendation = {
  agentId: string;
  score: number;
  reason: string;
};

// ── Phase 4: Integration Types ────────────────────────────────────────────

export type IntegrationType = "google_calendar" | "github";
export type IntegrationStatus = "connected" | "disconnected" | "error";

export type Integration = {
  id: string;
  type: IntegrationType;
  label: string;
  configJson: string;
  status: IntegrationStatus;
  errorMessage?: string;
  lastSyncAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type CalendarEvent = {
  id: string;
  integrationId: string;
  externalId: string;
  title: string;
  description?: string;
  startAt: number;
  endAt: number;
  allDay: boolean;
  location?: string;
  taskId?: string;
  status: "confirmed" | "tentative" | "cancelled";
  syncedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type GitHubRepo = {
  id: string;
  integrationId: string;
  externalId: number;
  fullName: string;
  description?: string;
  url: string;
  defaultBranch?: string;
  isPrivate: boolean;
  syncedAt: number;
};

export type GitHubIssue = {
  id: string;
  repoId: string;
  externalId: number;
  number: number;
  title: string;
  body?: string;
  state: "open" | "closed";
  isPr: boolean;
  author?: string;
  assignee?: string;
  labels: string[];
  taskId?: string;
  url: string;
  externalCreatedAt?: number;
  externalUpdatedAt?: number;
  syncedAt: number;
};

// ── Notification Types ───────────────────────────────────────────────────

export type NotificationType =
  | "approval_needed" | "task_completed" | "task_failed"
  | "task_delegated" | "delegation_request" | "delegation_approved"
  | "delegation_rejected" | "deadline_approaching"
  | "workflow_completed" | "workflow_failed" | "system";

export type MCNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  severity: "info" | "warning" | "error" | "success";
  sourceType?: string;
  sourceId?: string;
  actorId?: string;
  read: boolean;
  dismissed: boolean;
  actionType?: string;
  actionPayloadJson?: string;
  createdAt: number;
};

// ── Delegation Types ─────────────────────────────────────────────────────

export type DelegationStatus = "pending" | "approved" | "rejected" | "completed" | "cancelled";

export type MCDelegation = {
  id: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
  status: DelegationStatus;
  requiresApproval: boolean;
  approvalId?: string;
  originalAgentId: string;
  createdAt: number;
  resolvedAt?: number;
};

type Tab = "dashboard" | "tasks" | "approvals" | "chat" | "people" | "memory" | "calendar" | "team" | "trello" | "workflows" | "automations" | "analytics" | "integrations";

const MC_GATEWAY_TOKEN_KEY = "mc.gateway.token.v1";

/** App facade passed down to views */
export type AppFacade = {
  gw: MCGatewayClient;
  agents: AgentRow[];
  sessions: SessionRow[];
  subagents: any[];
  tasks: Task[];
  rooms: Room[];
  people: Person[];
  memoryFiles: MemorySummary[];
  cronJobs: any[];
  cronSource: string;
  approvals: ApprovalRequest[];
  engineStatus: EngineStatus | null;
  createTask(data: {
    title: string;
    agentId: string;
    description?: string;
    priority?: string;
    parentId?: string;
    requiresApproval?: boolean;
    scheduledAt?: number;
    deadlineAt?: number;
    dependencies?: string[];
    contextJson?: string;
  }): Promise<Task | undefined>;
  updateTask(id: string, patch: Record<string, unknown>): Promise<Task | undefined>;
  addTaskUpdate(id: string, note: string, author?: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  queueTask(id: string): Promise<Task | undefined>;
  cancelTask(id: string, reason?: string): Promise<Task | undefined>;
  retryTask(id: string): Promise<Task | undefined>;
  getTaskDetail(id: string): Promise<Task | undefined>;
  resolveApproval(id: string, decision: "approved" | "rejected", note?: string): Promise<void>;
  getSessionHistory(sessionKey: string, limit?: number): Promise<any[]>;
  sendToSession(sessionKey: string, message: string): Promise<void>;
  createRoom(data: { name: string; agentIds: string[] }): Promise<Room | undefined>;
  inviteToRoom(roomId: string, agentId: string, roomName: string): Promise<void>;
  sendRoomMessage(room: Room, message: string): Promise<void>;
  createPerson(data: Omit<Person, "id" | "createdAt" | "updatedAt">): Promise<Person | undefined>;
  updatePerson(id: string, patch: Partial<Omit<Person, "id" | "createdAt">>): Promise<Person | undefined>;
  deletePerson(id: string): Promise<void>;
  // Trello
  trelloBoards: TrelloBoard[];
  trelloLists: TrelloList[];
  trelloCards: TrelloCard[];
  currentTrelloBoardId: string | null;
  createTrelloBoard(data: { name: string; description?: string }): Promise<TrelloBoard | undefined>;
  updateTrelloBoard(id: string, patch: { name?: string; description?: string }): Promise<TrelloBoard | undefined>;
  deleteTrelloBoard(id: string): Promise<void>;
  createTrelloList(data: { boardId: string; name: string }): Promise<TrelloList | undefined>;
  updateTrelloList(id: string, patch: { name?: string; position?: number }): Promise<TrelloList | undefined>;
  deleteTrelloList(id: string): Promise<void>;
  loadTrelloBoardData(boardId: string): Promise<void>;
  setCurrentTrelloBoardId(boardId: string | null): void;
  createTrelloCard(data: { listId: string; boardId: string; title: string; description?: string; labels?: TrelloLabel[]; assignee?: string }): Promise<TrelloCard | undefined>;
  updateTrelloCard(id: string, patch: Record<string, unknown>): Promise<TrelloCard | undefined>;
  moveTrelloCard(id: string, listId: string, position: number): Promise<TrelloCard | undefined>;
  deleteTrelloCard(id: string): Promise<void>;
  listTrelloComments(cardId: string): Promise<TrelloComment[]>;
  addTrelloComment(cardId: string, text: string, author?: string): Promise<TrelloComment | undefined>;
  // Phase 2: Templates
  templates: TaskTemplate[];
  createTemplate(data: { name: string; agentId: string; description?: string; priority?: string; taskType?: string; executionMode?: string; maxRetries?: number; timeoutMs?: number; requiresApproval?: boolean; tags?: string[]; contextJson?: string }): Promise<TaskTemplate | undefined>;
  updateTemplate(id: string, patch: Record<string, unknown>): Promise<TaskTemplate | undefined>;
  deleteTemplate(id: string): Promise<void>;
  instantiateTemplate(templateId: string, overrides?: { title?: string; contextJson?: string }): Promise<Task | undefined>;
  // Phase 2: Workflows
  workflows: Workflow[];
  workflowRuns: WorkflowRun[];
  createWorkflow(data: { name: string; description?: string; triggerType?: WorkflowTriggerType; triggerConfigJson?: string; enabled?: boolean }): Promise<Workflow | undefined>;
  updateWorkflow(id: string, patch: Record<string, unknown>): Promise<Workflow | undefined>;
  deleteWorkflow(id: string): Promise<void>;
  addWorkflowStep(workflowId: string, data: { name: string; templateId?: string; inlineConfigJson?: string; conditionJson?: string; onFailure?: string; retryCount?: number; timeoutMs?: number; contextOverridesJson?: string }): Promise<WorkflowStep | undefined>;
  updateWorkflowStep(id: string, patch: Record<string, unknown>): Promise<WorkflowStep | undefined>;
  removeWorkflowStep(id: string): Promise<void>;
  reorderWorkflowSteps(workflowId: string, stepIds: string[]): Promise<void>;
  startWorkflow(workflowId: string, opts?: { contextJson?: string }): Promise<WorkflowRun | undefined>;
  getWorkflowRun(runId: string): Promise<WorkflowRun | undefined>;
  cancelWorkflowRun(runId: string): Promise<void>;
  // Phase 2: Automations
  automationRules: AutomationRule[];
  createAutomationRule(data: { name: string; eventType: AutomationEventType; actionType: AutomationActionType; actionConfigJson: string; description?: string; eventFilterJson?: string; cooldownMs?: number; enabled?: boolean }): Promise<AutomationRule | undefined>;
  updateAutomationRule(id: string, patch: Record<string, unknown>): Promise<AutomationRule | undefined>;
  deleteAutomationRule(id: string): Promise<void>;
  // Phase 2: Cron management
  addCronJob(data: { name: string; schedule: any; delivery: any }): Promise<any>;
  updateCronJob(id: string, patch: Record<string, unknown>): Promise<any>;
  removeCronJob(id: string): Promise<void>;
  runCronJob(id: string): Promise<void>;
  // Phase 3: Analytics
  analyticsData: AnalyticsData;
  analyticsRange: number;
  loadAnalytics(): Promise<void>;
  setAnalyticsRange(days: number): void;
  // Phase 4: Integrations
  integrations: Integration[];
  calendarEvents: CalendarEvent[];
  githubRepos: GitHubRepo[];
  githubIssues: GitHubIssue[];
  loadIntegrations(): Promise<void>;
  loadCalendarEvents(): Promise<void>;
  loadGitHubRepos(): Promise<void>;
  loadGitHubIssues(opts?: { repoId?: string }): Promise<void>;
  gcalConnect(): Promise<string | undefined>;
  gcalDisconnect(): Promise<void>;
  gcalSync(): Promise<void>;
  gcalCreateEvent(data: { title: string; startAt: number; endAt: number; allDay?: boolean; description?: string; location?: string }): Promise<CalendarEvent | undefined>;
  gcalDeleteEvent(id: string): Promise<void>;
  gcalLinkTask(eventId: string, taskId: string | null): Promise<CalendarEvent | undefined>;
  githubConnect(data: { token: string; webhookSecret?: string }): Promise<void>;
  githubDisconnect(): Promise<void>;
  githubSync(): Promise<void>;
  githubCreateTask(issueId: string, agentId: string): Promise<Task | undefined>;
  // Phase 5: Intelligence
  agentCapabilities: AgentCapability[];
  routingRules: RoutingRule[];
  loadAgentCapabilities(): Promise<void>;
  loadRoutingRules(): Promise<void>;
  createRoutingRule(data: { name: string; ruleType: RoutingRuleType; matchConfigJson: string; preferredAgentId: string; confidence?: number; override?: boolean }): Promise<RoutingRule | undefined>;
  updateRoutingRule(id: string, patch: Record<string, unknown>): Promise<RoutingRule | undefined>;
  deleteRoutingRule(id: string): Promise<void>;
  getRecommendations(taskId: string): Promise<AgentRecommendation[]>;
  resetAgentCapabilities(agentId: string): Promise<void>;
  // Notifications
  notifications: MCNotification[];
  unreadCount: number;
  notificationsOpen: boolean;
  loadNotifications(): Promise<void>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  dismissNotification(id: string): Promise<void>;
  dismissAllNotifications(): Promise<void>;
  toggleNotifications(): void;
  // Delegations
  delegations: MCDelegation[];
  loadDelegations(): Promise<void>;
  requestDelegation(data: { taskId: string; fromAgentId: string; toAgentId: string; reason?: string; requiresApproval?: boolean }): Promise<MCDelegation | undefined>;
  resolveDelegation(id: string, approved: boolean, note?: string): Promise<MCDelegation | undefined>;
  cancelDelegation(id: string): Promise<void>;
  getDelegationSuggestions(taskId: string): Promise<AgentRecommendation[]>;
  autoDelegateTask(taskId: string, fromAgentId: string, reason?: string): Promise<MCDelegation | undefined>;
  reload(): Promise<void>;
};

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function findSessionByLabel(
  gw: MCGatewayClient,
  agentId: string,
  label: string,
): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    await delay(500);
    try {
      const res = await gw.request<{ sessions?: SessionRow[] }>("sessions.list", {
        agentId,
        label,
        limit: 1,
      });
      const sk = res?.sessions?.[0]?.key;
      if (sk) return sk;
    } catch { /* retry */ }
  }
  return null;
}

@customElement("mc-app")
export class McApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #0a0a0f;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 20px;
      background: #0d0d14;
      border-bottom: 1px solid #1e1e2e;
      height: 48px;
      flex-shrink: 0;
    }
    .brand {
      font-weight: 700;
      font-size: 14px;
      color: #a78bfa;
      margin-right: 28px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .nav-tab {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 13px;
      font-weight: 500;
      padding: 0 14px;
      height: 48px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      position: relative;
    }
    .nav-tab:hover { color: #e2e8f0; }
    .nav-tab.active { color: #a78bfa; border-bottom-color: #a78bfa; }
    .badge {
      position: absolute;
      top: 8px;
      right: 4px;
      background: #ef4444;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
    .status {
      margin-left: auto;
      font-size: 11px;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #374151; flex-shrink: 0; }
    .dot.connecting { background: #f59e0b; }
    .dot.connected  { background: #22c55e; }
    .dot.disconnected { background: #ef4444; }
    .content { height: calc(100vh - 48px); overflow: hidden; }
    .bell-wrap { position: relative; margin-left: auto; margin-right: 8px; }
    .bell-btn {
      background: none; border: none; color: #94a3b8; font-size: 18px;
      cursor: pointer; padding: 4px 8px; position: relative;
    }
    .bell-btn:hover { color: #e2e8f0; }
    .bell-badge {
      position: absolute; top: 0; right: 0;
      background: #ef4444; color: #fff; font-size: 9px; font-weight: 700;
      min-width: 16px; height: 16px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center; padding: 0 3px;
    }
    .notif-panel {
      position: absolute; top: 40px; right: 0; z-index: 999;
      width: 380px; max-height: 480px; overflow-y: auto;
      background: #12121a; border: 1px solid #1e1e2e; border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .notif-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 14px; border-bottom: 1px solid #1e1e2e;
    }
    .notif-header span { font-size: 13px; font-weight: 600; color: #e2e8f0; }
    .notif-actions { display: flex; gap: 8px; }
    .notif-actions button {
      background: none; border: none; color: #a78bfa; font-size: 11px;
      cursor: pointer; padding: 2px 4px;
    }
    .notif-actions button:hover { text-decoration: underline; }
    .notif-item {
      padding: 10px 14px; border-bottom: 1px solid #1a1a2e; cursor: pointer;
      transition: background 0.1s;
    }
    .notif-item:hover { background: #1a1a2e; }
    .notif-item.unread { border-left: 3px solid #a78bfa; }
    .notif-item .n-title { font-size: 12px; font-weight: 600; color: #e2e8f0; margin-bottom: 2px; }
    .notif-item .n-body { font-size: 11px; color: #94a3b8; line-height: 1.3; }
    .notif-item .n-time { font-size: 10px; color: #64748b; margin-top: 4px; }
    .notif-item .n-severity {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      margin-right: 6px; vertical-align: middle;
    }
    .n-severity.info { background: #3b82f6; }
    .n-severity.warning { background: #f59e0b; }
    .n-severity.error { background: #ef4444; }
    .n-severity.success { background: #22c55e; }
    .notif-empty { padding: 24px; text-align: center; color: #64748b; font-size: 12px; }
    .notif-dismiss {
      background: none; border: none; color: #64748b; font-size: 14px;
      cursor: pointer; padding: 2px 4px; float: right;
    }
    .notif-dismiss:hover { color: #ef4444; }
  `;

  @state() private tab: Tab = "dashboard";
  @state() private gwStatus: GatewayConnectionStatus = "connecting";
  @state() private agents: AgentRow[] = [];
  @state() private sessions: SessionRow[] = [];
  @state() private subagents: any[] = [];
  @state() private tasks: Task[] = [];
  @state() private rooms: Room[] = [];
  @state() private people: Person[] = [];
  @state() private memoryFiles: MemorySummary[] = [];
  @state() private cronJobs: any[] = [];
  @state() private cronSource = "";
  @state() private approvals: ApprovalRequest[] = [];
  @state() private engineStatus: EngineStatus | null = null;
  @state() private trelloBoards: TrelloBoard[] = [];
  @state() private trelloLists: TrelloList[] = [];
  @state() private trelloCards: TrelloCard[] = [];
  @state() private currentTrelloBoardId: string | null = null;
  @state() private templates: TaskTemplate[] = [];
  @state() private workflows: Workflow[] = [];
  @state() private workflowRuns: WorkflowRun[] = [];
  @state() private automationRules: AutomationRule[] = [];
  @state() private analyticsData: AnalyticsData = {
    overview: null, throughput: [], agents: [], durations: [],
    priorities: [], workflows: [], sla: null, tags: [],
  };
  @state() private analyticsRange = 30;
  @state() private integrations: Integration[] = [];
  @state() private calendarEvents: CalendarEvent[] = [];
  @state() private githubRepos: GitHubRepo[] = [];
  @state() private githubIssues: GitHubIssue[] = [];
  @state() private agentCapabilities: AgentCapability[] = [];
  @state() private routingRules: RoutingRule[] = [];
  @state() private notifications: MCNotification[] = [];
  @state() private unreadCount = 0;
  @state() private notificationsOpen = false;
  @state() private delegations: MCDelegation[] = [];

  private gw!: MCGatewayClient;

  private getSavedManualToken(): string | undefined {
    try {
      const token = localStorage.getItem(MC_GATEWAY_TOKEN_KEY)?.trim();
      return token || undefined;
    } catch {
      return undefined;
    }
  }

  private promptGatewayToken(): void {
    const existing = this.getSavedManualToken() ?? "";
    const next = window.prompt("Enter OpenClaw gateway token (leave blank to clear):", existing);
    if (next === null) return;
    const trimmed = next.trim();
    try {
      if (trimmed) localStorage.setItem(MC_GATEWAY_TOKEN_KEY, trimmed);
      else localStorage.removeItem(MC_GATEWAY_TOKEN_KEY);
    } catch {
      // ignore storage write failures
    }
    this.gw.setManualToken(trimmed || null);
    this.gw.stop();
    this.gw.start();
  }

  connectedCallback() {
    super.connectedCallback();
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";

    let url = window.__mcBootstrap?.gatewayUrl;
    if (!url) {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url = `${protocol}//${location.host}/ws`;
    }

    this.gw = new MCGatewayClient(
      url,
      (evt) => this.handleEvent(evt),
      () => void this.loadAll(),
      (s) => { this.gwStatus = s; },
      this.getSavedManualToken(),
    );
    this.gw.start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.gw.stop();
  }

  private handleEvent(evt: GatewayEventFrame): void {
    if (evt.event === "chat") {
      void this.loadSessions();
    }
    if (evt.event === "mc.task") {
      void this.loadTasks();
    }
    if (evt.event === "mc.approval") {
      void this.loadApprovals();
    }
    if (evt.event === "mc.trello") {
      void this.loadTrelloBoards();
      // Reload board-specific data if we have an active board
      if (this.currentTrelloBoardId) {
        void this.loadTrelloBoardData(this.currentTrelloBoardId);
      }
    }
    if (evt.event === "mc.engine") {
      const payload = evt.payload as any;
      if (payload?.status) {
        this.engineStatus = payload.status;
      }
    }
    if (evt.event === "mc.template") {
      void this.loadTemplates();
    }
    if (evt.event === "mc.workflow") {
      void this.loadWorkflows();
      void this.loadWorkflowRuns();
    }
    if (evt.event === "mc.automation") {
      void this.loadAutomationRules();
    }
    if (evt.event === "mc.cron") {
      void this.loadCronJobs();
    }
    if (evt.event === "mc.integration") {
      void this.loadIntegrations();
    }
    if (evt.event === "mc.gcal") {
      void this.loadCalendarEvents();
      void this.loadIntegrations();
    }
    if (evt.event === "mc.github") {
      void this.loadGitHubRepos();
      void this.loadGitHubIssues();
      void this.loadIntegrations();
    }
    if (evt.event === "mc.intelligence") {
      void this.loadAgentCapabilities();
      void this.loadRoutingRules();
    }
    if (evt.event === "mc.notification") {
      void this.loadNotifications();
      void this.loadUnreadCount();
    }
    if (evt.event === "mc.delegation") {
      void this.loadDelegations();
      void this.loadTasks();
    }
  }

  private async loadAll(): Promise<void> {
    await Promise.allSettled([
      this.loadAgents(),
      this.loadSessions(),
      this.loadSubagents(),
      this.loadTasks(),
      this.loadRooms(),
      this.loadPeople(),
      this.loadMemoryFiles(),
      this.loadCronJobs(),
      this.loadApprovals(),
      this.loadEngineStatus(),
      this.loadTrelloBoards(),
      this.loadTemplates(),
      this.loadWorkflows(),
      this.loadWorkflowRuns(),
      this.loadAutomationRules(),
      this.loadIntegrations(),
      this.loadCalendarEvents(),
      this.loadGitHubRepos(),
      this.loadGitHubIssues(),
      this.loadAgentCapabilities(),
      this.loadRoutingRules(),
      this.loadNotifications(),
      this.loadUnreadCount(),
      this.loadDelegations(),
    ]);
  }

  private async loadAgents(): Promise<void> {
    const res = await this.gw.request<{ agents: AgentRow[] }>("agents.list", {}).catch(() => null);
    this.agents = res?.agents ?? [];
  }

  private async loadSessions(): Promise<void> {
    const res = await this.gw.request<{ sessions: SessionRow[] }>("sessions.list", {
      includeLastMessage: true,
      limit: 200,
    }).catch(() => null);
    this.sessions = res?.sessions ?? [];
  }

  private async loadTasks(): Promise<void> {
    const res = await this.gw.request<{ tasks: Task[] }>("mc.tasks.list", {}).catch(() => null);
    this.tasks = res?.tasks ?? [];
  }

  private async loadRooms(): Promise<void> {
    const res = await this.gw.request<{ rooms: Room[] }>("mc.rooms.list", {}).catch(() => null);
    this.rooms = res?.rooms ?? [];
  }

  private async loadPeople(): Promise<void> {
    const res = await this.gw.request<{ people: Person[] }>("mc.people.list", {}).catch(() => null);
    this.people = res?.people ?? [];
  }

  private async loadSubagents(): Promise<void> {
    const res = await this.gw.request<{ subagents: any[] }>("subagents.list", {}).catch(() => null);
    this.subagents = res?.subagents ?? [];
  }

  private async loadMemoryFiles(): Promise<void> {
    const res = await this.gw.request<{ files: MemorySummary[] }>("mc.memory.list", {}).catch(() => null);
    this.memoryFiles = res?.files ?? [];
  }

  private async loadCronJobs(): Promise<void> {
    const res = await this.gw.request<{ jobs: any[]; source: string }>("mc.cron.list", {}).catch(() => null);
    this.cronJobs = res?.jobs ?? [];
    this.cronSource = res?.source ?? "none";
  }

  private async loadApprovals(): Promise<void> {
    const res = await this.gw.request<{ approvals: ApprovalRequest[] }>("mc.approvals.list", { status: "pending" }).catch(() => null);
    this.approvals = res?.approvals ?? [];
  }

  private async loadEngineStatus(): Promise<void> {
    const res = await this.gw.request<{ status: EngineStatus }>("mc.engine.status", {}).catch(() => null);
    this.engineStatus = res?.status ?? null;
  }

  private async loadTemplates(): Promise<void> {
    const res = await this.gw.request<{ templates: TaskTemplate[] }>("mc.templates.list", {}).catch(() => null);
    this.templates = res?.templates ?? [];
  }

  private async loadWorkflows(): Promise<void> {
    const res = await this.gw.request<{ workflows: Workflow[] }>("mc.workflows.list", {}).catch(() => null);
    this.workflows = res?.workflows ?? [];
  }

  private async loadWorkflowRuns(): Promise<void> {
    const res = await this.gw.request<{ runs: WorkflowRun[] }>("mc.workflows.runs.list", {}).catch(() => null);
    this.workflowRuns = res?.runs ?? [];
  }

  private async loadAutomationRules(): Promise<void> {
    const res = await this.gw.request<{ rules: AutomationRule[] }>("mc.automations.list", {}).catch(() => null);
    this.automationRules = res?.rules ?? [];
  }

  async loadIntegrations(): Promise<void> {
    const res = await this.gw.request<{ integrations: Integration[] }>("mc.integrations.list", {}).catch(() => null);
    this.integrations = res?.integrations ?? [];
  }

  async loadCalendarEvents(): Promise<void> {
    const now = Date.now();
    const res = await this.gw.request<{ events: CalendarEvent[] }>("mc.gcal.events.list", {
      from: now - 7 * 86400000,
      to: now + 30 * 86400000,
    }).catch(() => null);
    this.calendarEvents = res?.events ?? [];
  }

  async loadGitHubRepos(): Promise<void> {
    const res = await this.gw.request<{ repos: GitHubRepo[] }>("mc.github.repos.list", {}).catch(() => null);
    this.githubRepos = res?.repos ?? [];
  }

  async loadGitHubIssues(opts?: { repoId?: string }): Promise<void> {
    const res = await this.gw.request<{ issues: GitHubIssue[] }>("mc.github.issues.list", {
      ...opts, limit: 200,
    }).catch(() => null);
    this.githubIssues = res?.issues ?? [];
  }

  async loadAgentCapabilities(): Promise<void> {
    const res = await this.gw.request<{ capabilities: AgentCapability[] }>("mc.intelligence.capabilities.list", {}).catch(() => null);
    this.agentCapabilities = res?.capabilities ?? [];
  }

  async loadRoutingRules(): Promise<void> {
    const res = await this.gw.request<{ rules: RoutingRule[] }>("mc.intelligence.routing.list", {}).catch(() => null);
    this.routingRules = res?.rules ?? [];
  }

  async loadNotifications(): Promise<void> {
    const res = await this.gw.request<{ notifications: MCNotification[] }>("mc.notifications.list", { limit: 50 }).catch(() => null);
    this.notifications = res?.notifications ?? [];
  }

  async loadUnreadCount(): Promise<void> {
    const res = await this.gw.request<{ count: number }>("mc.notifications.unreadCount", {}).catch(() => null);
    this.unreadCount = res?.count ?? 0;
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.gw.request("mc.notifications.markRead", { id }).catch(() => null);
    this.notifications = this.notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
    this.unreadCount = Math.max(0, this.unreadCount - 1);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.gw.request("mc.notifications.markAllRead", {}).catch(() => null);
    this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
    this.unreadCount = 0;
  }

  async dismissNotificationById(id: string): Promise<void> {
    await this.gw.request("mc.notifications.dismiss", { id }).catch(() => null);
    this.notifications = this.notifications.filter((n) => n.id !== id);
  }

  async dismissAllNotifications(): Promise<void> {
    await this.gw.request("mc.notifications.dismissAll", {}).catch(() => null);
    this.notifications = [];
    this.unreadCount = 0;
  }

  private toggleNotifications(): void {
    this.notificationsOpen = !this.notificationsOpen;
    if (this.notificationsOpen) void this.loadNotifications();
  }

  async loadDelegations(): Promise<void> {
    const res = await this.gw.request<{ delegations: MCDelegation[] }>("mc.delegations.list", { limit: 50 }).catch(() => null);
    this.delegations = res?.delegations ?? [];
  }

  async requestDelegation(data: { taskId: string; fromAgentId: string; toAgentId: string; reason?: string; requiresApproval?: boolean }): Promise<MCDelegation | undefined> {
    const res = await this.gw.request<{ delegation: MCDelegation }>("mc.delegations.request", data).catch(() => null);
    if (res?.delegation) void this.loadDelegations();
    return res?.delegation;
  }

  async resolveDelegation(id: string, approved: boolean, note?: string): Promise<MCDelegation | undefined> {
    const res = await this.gw.request<{ delegation: MCDelegation }>("mc.delegations.resolve", { id, approved, note }).catch(() => null);
    if (res?.delegation) {
      void this.loadDelegations();
      void this.loadTasks();
    }
    return res?.delegation;
  }

  async cancelDelegation(id: string): Promise<void> {
    await this.gw.request("mc.delegations.cancel", { id }).catch(() => null);
    void this.loadDelegations();
  }

  async getDelegationSuggestions(taskId: string): Promise<AgentRecommendation[]> {
    const res = await this.gw.request<{ suggestions: AgentRecommendation[] }>("mc.delegations.suggestions", { taskId }).catch(() => null);
    return res?.suggestions ?? [];
  }

  async autoDelegateTask(taskId: string, fromAgentId: string, reason?: string): Promise<MCDelegation | undefined> {
    const res = await this.gw.request<{ delegation: MCDelegation }>("mc.delegations.autoDelegate", { taskId, fromAgentId, reason }).catch(() => null);
    if (res?.delegation) void this.loadDelegations();
    return res?.delegation;
  }

  async createRoutingRule(data: { name: string; ruleType: RoutingRuleType; matchConfigJson: string; preferredAgentId: string; confidence?: number; override?: boolean }): Promise<RoutingRule | undefined> {
    const res = await this.gw.request<{ rule: RoutingRule }>("mc.intelligence.routing.create", data).catch(() => null);
    if (res?.rule) void this.loadRoutingRules();
    return res?.rule;
  }

  async updateRoutingRule(id: string, patch: Record<string, unknown>): Promise<RoutingRule | undefined> {
    const res = await this.gw.request<{ rule: RoutingRule }>("mc.intelligence.routing.update", { id, ...patch }).catch(() => null);
    if (res?.rule) void this.loadRoutingRules();
    return res?.rule;
  }

  async deleteRoutingRule(id: string): Promise<void> {
    await this.gw.request("mc.intelligence.routing.delete", { id }).catch(() => null);
    void this.loadRoutingRules();
  }

  async getRecommendations(taskId: string): Promise<AgentRecommendation[]> {
    const res = await this.gw.request<{ recommendations: AgentRecommendation[] }>("mc.intelligence.recommend", { taskId }).catch(() => null);
    return res?.recommendations ?? [];
  }

  async resetAgentCapabilities(agentId: string): Promise<void> {
    await this.gw.request("mc.intelligence.capabilities.reset", { agentId }).catch(() => null);
    void this.loadAgentCapabilities();
  }

  async loadAnalytics(): Promise<void> {
    const now = Date.now();
    const from = now - this.analyticsRange * 86400000;
    const range = { from, to: now };
    const [overview, throughput, agents, durations, priorities, workflows, sla, tags] =
      await Promise.allSettled([
        this.gw.request<OverviewMetrics>("mc.analytics.overview", range),
        this.gw.request<{ buckets: ThroughputBucket[] }>("mc.analytics.throughput", range),
        this.gw.request<{ agents: AgentPerformance[] }>("mc.analytics.agents", range),
        this.gw.request<{ buckets: DurationBucket[] }>("mc.analytics.durations", range),
        this.gw.request<{ priorities: PriorityDist[] }>("mc.analytics.priorities", range),
        this.gw.request<{ workflows: WorkflowAnalyticsSummary[] }>("mc.analytics.workflows", range),
        this.gw.request<SlaReport>("mc.analytics.sla", range),
        this.gw.request<{ tags: TagBreakdown[] }>("mc.analytics.tags", range),
      ]);
    this.analyticsData = {
      overview: overview.status === "fulfilled" ? overview.value : null,
      throughput: throughput.status === "fulfilled" ? throughput.value?.buckets ?? [] : [],
      agents: agents.status === "fulfilled" ? agents.value?.agents ?? [] : [],
      durations: durations.status === "fulfilled" ? durations.value?.buckets ?? [] : [],
      priorities: priorities.status === "fulfilled" ? priorities.value?.priorities ?? [] : [],
      workflows: workflows.status === "fulfilled" ? workflows.value?.workflows ?? [] : [],
      sla: sla.status === "fulfilled" ? sla.value : null,
      tags: tags.status === "fulfilled" ? tags.value?.tags ?? [] : [],
    };
  }

  private setAnalyticsRange(days: number): void {
    this.analyticsRange = days;
    void this.loadAnalytics();
  }

  // ── Task operations ─────────────────────────────────────────────────────────

  async createTask(data: {
    title: string;
    agentId: string;
    description?: string;
    priority?: string;
    parentId?: string;
    requiresApproval?: boolean;
    scheduledAt?: number;
    deadlineAt?: number;
    dependencies?: string[];
    contextJson?: string;
  }): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.tasks.create", data).catch(() => null);
    if (res?.task) void this.loadTasks();
    return res?.task;
  }

  async updateTask(id: string, patch: Record<string, unknown>): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.tasks.update", { id, ...patch }).catch(() => null);
    if (res?.task) this.tasks = this.tasks.map((t) => (t.id === id ? res.task : t));
    return res?.task;
  }

  async addTaskUpdate(id: string, note: string, author = "operator"): Promise<void> {
    await this.gw.request("mc.tasks.addUpdate", { id, note, author }).catch(() => null);
  }

  async deleteTask(id: string): Promise<void> {
    await this.gw.request("mc.tasks.delete", { id }).catch(() => null);
    this.tasks = this.tasks.filter((t) => t.id !== id);
  }

  async queueTask(id: string): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.tasks.queue", { id }).catch(() => null);
    if (res?.task) this.tasks = this.tasks.map((t) => (t.id === id ? res.task : t));
    return res?.task;
  }

  async cancelTask(id: string, reason?: string): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.tasks.cancel", { id, reason }).catch(() => null);
    if (res?.task) this.tasks = this.tasks.map((t) => (t.id === id ? res.task : t));
    return res?.task;
  }

  async retryTask(id: string): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.tasks.retry", { id }).catch(() => null);
    if (res?.task) this.tasks = this.tasks.map((t) => (t.id === id ? res.task : t));
    return res?.task;
  }

  async getTaskDetail(id: string): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.tasks.get", { id }).catch(() => null);
    return res?.task;
  }

  async resolveApproval(id: string, decision: "approved" | "rejected", note?: string): Promise<void> {
    await this.gw.request("mc.approvals.resolve", { id, decision, note }).catch(() => null);
    void this.loadApprovals();
    void this.loadTasks();
  }

  async getSessionHistory(sessionKey: string, limit = 100): Promise<any[]> {
    const res = await this.gw.request<{ messages?: any[] }>("sessions.history", { sessionKey, limit }).catch(() => null);
    return res?.messages ?? [];
  }

  async sendToSession(sessionKey: string, message: string): Promise<void> {
    await this.gw.request("chat.send", { sessionKey, message }).catch(() => null);
    void this.loadSessions();
  }

  // ── Room operations ─────────────────────────────────────────────────────────

  async createRoom(data: { name: string; agentIds: string[] }): Promise<Room | undefined> {
    const res = await this.gw.request<{ room: Room }>("mc.rooms.create", data).catch(() => null);
    if (!res?.room) return undefined;
    this.rooms = [...this.rooms, res.room];
    for (const agentId of data.agentIds) {
      await this.inviteToRoom(res.room.id, agentId, res.room.name);
    }
    return this.rooms.find((r) => r.id === res.room.id);
  }

  async inviteToRoom(roomId: string, agentId: string, roomName: string): Promise<void> {
    const room = this.rooms.find((r) => r.id === roomId);
    const agentIds = room ? [...new Set([...room.agentIds, agentId])] : [agentId];
    const label = `mc-r:${roomId.slice(0, 8)}:${agentId}`.slice(0, 64);

    await this.gw.request("agent", {
      agentId,
      message: `You are now a participant in the "${roomName}" mission control room. Stand by for group messages.`,
      label,
      channel: "webchat",
      idempotencyKey: crypto.randomUUID(),
    }).catch(() => null);

    const sessionKey = await findSessionByLabel(this.gw, agentId, label);
    const sessionKeys = { ...(room?.sessionKeys ?? {}) };
    if (sessionKey) sessionKeys[agentId] = sessionKey;

    const updated = await this.gw
      .request<{ room: Room }>("mc.rooms.update", { id: roomId, agentIds, sessionKeys })
      .catch(() => null);
    if (updated?.room) this.rooms = this.rooms.map((r) => (r.id === roomId ? updated.room : r));
    void this.loadSessions();
  }

  async sendRoomMessage(room: Room, message: string): Promise<void> {
    const entries = Object.entries(room.sessionKeys);
    await Promise.all(
      entries.map(([, sessionKey]) =>
        this.gw.request("chat.send", { sessionKey, message }).catch(() => null),
      ),
    );
    void this.loadSessions();
  }

  // ── People operations ──────────────────────────────────────────────────────

  async createPerson(data: Omit<Person, "id" | "createdAt" | "updatedAt">): Promise<Person | undefined> {
    const res = await this.gw.request<{ person: Person }>("mc.people.create", data).catch(() => null);
    if (res?.person) this.people = [res.person, ...this.people];
    return res?.person;
  }

  async updatePerson(id: string, patch: Partial<Omit<Person, "id" | "createdAt">>): Promise<Person | undefined> {
    const res = await this.gw.request<{ person: Person }>("mc.people.update", { id, ...patch }).catch(() => null);
    if (res?.person) this.people = this.people.map((p) => (p.id === id ? res.person : p));
    return res?.person;
  }

  async deletePerson(id: string): Promise<void> {
    await this.gw.request("mc.people.delete", { id }).catch(() => null);
    this.people = this.people.filter((p) => p.id !== id);
  }

  // ── Trello operations ────────────────────────────────────────────────────────

  private async loadTrelloBoards(): Promise<void> {
    const res = await this.gw.request<{ boards: TrelloBoard[] }>("mc.trello.boards.list", {}).catch(() => null);
    this.trelloBoards = res?.boards ?? [];
  }

  async loadTrelloBoardData(boardId: string): Promise<void> {
    const [listsRes, cardsRes] = await Promise.all([
      this.gw.request<{ lists: TrelloList[] }>("mc.trello.lists.list", { boardId }).catch(() => null),
      this.gw.request<{ cards: TrelloCard[] }>("mc.trello.cards.list", { boardId }).catch(() => null),
    ]);
    this.trelloLists = listsRes?.lists ?? [];
    this.trelloCards = cardsRes?.cards ?? [];
  }

  async createTrelloBoard(data: { name: string; description?: string }): Promise<TrelloBoard | undefined> {
    const res = await this.gw.request<{ board: TrelloBoard }>("mc.trello.boards.create", data).catch(() => null);
    if (res?.board) void this.loadTrelloBoards();
    return res?.board;
  }

  async updateTrelloBoard(id: string, patch: { name?: string; description?: string }): Promise<TrelloBoard | undefined> {
    const res = await this.gw.request<{ board: TrelloBoard }>("mc.trello.boards.update", { id, ...patch }).catch(() => null);
    if (res?.board) this.trelloBoards = this.trelloBoards.map((b) => (b.id === id ? res.board : b));
    return res?.board;
  }

  async deleteTrelloBoard(id: string): Promise<void> {
    await this.gw.request("mc.trello.boards.delete", { id }).catch(() => null);
    this.trelloBoards = this.trelloBoards.filter((b) => b.id !== id);
    this.trelloLists = [];
    this.trelloCards = [];
  }

  async createTrelloList(data: { boardId: string; name: string }): Promise<TrelloList | undefined> {
    const res = await this.gw.request<{ list: TrelloList }>("mc.trello.lists.create", data).catch(() => null);
    if (res?.list) this.trelloLists = [...this.trelloLists, res.list];
    return res?.list;
  }

  async updateTrelloList(id: string, patch: { name?: string; position?: number }): Promise<TrelloList | undefined> {
    const res = await this.gw.request<{ list: TrelloList }>("mc.trello.lists.update", { id, ...patch }).catch(() => null);
    if (res?.list) this.trelloLists = this.trelloLists.map((l) => (l.id === id ? res.list : l));
    return res?.list;
  }

  async deleteTrelloList(id: string): Promise<void> {
    await this.gw.request("mc.trello.lists.delete", { id }).catch(() => null);
    this.trelloLists = this.trelloLists.filter((l) => l.id !== id);
    this.trelloCards = this.trelloCards.filter((c) => c.listId !== id);
  }

  async createTrelloCard(data: { listId: string; boardId: string; title: string; description?: string; labels?: TrelloLabel[]; assignee?: string }): Promise<TrelloCard | undefined> {
    const res = await this.gw.request<{ card: TrelloCard }>("mc.trello.cards.create", data).catch(() => null);
    if (res?.card) this.trelloCards = [...this.trelloCards, res.card];
    return res?.card;
  }

  async updateTrelloCard(id: string, patch: Record<string, unknown>): Promise<TrelloCard | undefined> {
    const res = await this.gw.request<{ card: TrelloCard }>("mc.trello.cards.update", { id, ...patch }).catch(() => null);
    if (res?.card) this.trelloCards = this.trelloCards.map((c) => (c.id === id ? res.card : c));
    return res?.card;
  }

  async moveTrelloCard(id: string, listId: string, position: number): Promise<TrelloCard | undefined> {
    const res = await this.gw.request<{ card: TrelloCard }>("mc.trello.cards.move", { id, listId, position }).catch(() => null);
    if (res?.card) this.trelloCards = this.trelloCards.map((c) => (c.id === id ? res.card : c));
    return res?.card;
  }

  async deleteTrelloCard(id: string): Promise<void> {
    await this.gw.request("mc.trello.cards.delete", { id }).catch(() => null);
    this.trelloCards = this.trelloCards.filter((c) => c.id !== id);
  }

  async listTrelloComments(cardId: string): Promise<TrelloComment[]> {
    const res = await this.gw.request<{ comments: TrelloComment[] }>("mc.trello.cards.listComments", { cardId }).catch(() => null);
    return res?.comments ?? [];
  }

  async addTrelloComment(cardId: string, text: string, author = "operator"): Promise<TrelloComment | undefined> {
    const res = await this.gw.request<{ comment: TrelloComment }>("mc.trello.cards.addComment", { cardId, text, author }).catch(() => null);
    return res?.comment;
  }

  setCurrentTrelloBoardId(boardId: string | null): void {
    this.currentTrelloBoardId = boardId;
  }

  // ── Template operations ───────────────────────────────────────────────────

  async createTemplate(data: { name: string; agentId: string; description?: string; priority?: string; taskType?: string; executionMode?: string; maxRetries?: number; timeoutMs?: number; requiresApproval?: boolean; tags?: string[]; contextJson?: string }): Promise<TaskTemplate | undefined> {
    const res = await this.gw.request<{ template: TaskTemplate }>("mc.templates.create", data).catch(() => null);
    if (res?.template) void this.loadTemplates();
    return res?.template;
  }

  async updateTemplate(id: string, patch: Record<string, unknown>): Promise<TaskTemplate | undefined> {
    const res = await this.gw.request<{ template: TaskTemplate }>("mc.templates.update", { id, ...patch }).catch(() => null);
    if (res?.template) this.templates = this.templates.map((t) => (t.id === id ? res.template : t));
    return res?.template;
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.gw.request("mc.templates.delete", { id }).catch(() => null);
    this.templates = this.templates.filter((t) => t.id !== id);
  }

  async instantiateTemplate(templateId: string, overrides?: { title?: string; contextJson?: string }): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.templates.instantiate", { templateId, ...overrides }).catch(() => null);
    if (res?.task) void this.loadTasks();
    return res?.task;
  }

  // ── Workflow operations ───────────────────────────────────────────────────

  async createWorkflow(data: { name: string; description?: string; triggerType?: string; triggerConfigJson?: string; enabled?: boolean }): Promise<Workflow | undefined> {
    const res = await this.gw.request<{ workflow: Workflow }>("mc.workflows.create", data).catch(() => null);
    if (res?.workflow) void this.loadWorkflows();
    return res?.workflow;
  }

  async updateWorkflow(id: string, patch: Record<string, unknown>): Promise<Workflow | undefined> {
    const res = await this.gw.request<{ workflow: Workflow }>("mc.workflows.update", { id, ...patch }).catch(() => null);
    if (res?.workflow) this.workflows = this.workflows.map((w) => (w.id === id ? res.workflow : w));
    return res?.workflow;
  }

  async deleteWorkflow(id: string): Promise<void> {
    await this.gw.request("mc.workflows.delete", { id }).catch(() => null);
    this.workflows = this.workflows.filter((w) => w.id !== id);
  }

  async addWorkflowStep(workflowId: string, data: { name: string; templateId?: string; inlineConfigJson?: string; conditionJson?: string; onFailure?: string; retryCount?: number; timeoutMs?: number; contextOverridesJson?: string }): Promise<WorkflowStep | undefined> {
    const res = await this.gw.request<{ step: WorkflowStep }>("mc.workflows.addStep", { workflowId, ...data }).catch(() => null);
    if (res?.step) void this.loadWorkflows();
    return res?.step;
  }

  async updateWorkflowStep(id: string, patch: Record<string, unknown>): Promise<WorkflowStep | undefined> {
    const res = await this.gw.request<{ step: WorkflowStep }>("mc.workflows.updateStep", { id, ...patch }).catch(() => null);
    if (res?.step) void this.loadWorkflows();
    return res?.step;
  }

  async removeWorkflowStep(id: string): Promise<void> {
    await this.gw.request("mc.workflows.removeStep", { id }).catch(() => null);
    void this.loadWorkflows();
  }

  async reorderWorkflowSteps(workflowId: string, stepIds: string[]): Promise<void> {
    await this.gw.request("mc.workflows.reorderSteps", { workflowId, stepIds }).catch(() => null);
    void this.loadWorkflows();
  }

  async startWorkflow(workflowId: string, opts?: { contextJson?: string }): Promise<WorkflowRun | undefined> {
    const res = await this.gw.request<{ run: WorkflowRun }>("mc.workflows.start", { workflowId, ...opts }).catch(() => null);
    if (res?.run) void this.loadWorkflowRuns();
    return res?.run;
  }

  async getWorkflowRun(runId: string): Promise<WorkflowRun | undefined> {
    const res = await this.gw.request<{ run: WorkflowRun }>("mc.workflows.runs.get", { id: runId }).catch(() => null);
    return res?.run;
  }

  async cancelWorkflowRun(runId: string): Promise<void> {
    await this.gw.request("mc.workflows.runs.cancel", { id: runId }).catch(() => null);
    void this.loadWorkflowRuns();
  }

  // ── Automation operations ─────────────────────────────────────────────────

  async createAutomationRule(data: { name: string; eventType: AutomationEventType; actionType: AutomationActionType; actionConfigJson: string; description?: string; eventFilterJson?: string; cooldownMs?: number; enabled?: boolean }): Promise<AutomationRule | undefined> {
    const res = await this.gw.request<{ rule: AutomationRule }>("mc.automations.create", data).catch(() => null);
    if (res?.rule) void this.loadAutomationRules();
    return res?.rule;
  }

  async updateAutomationRule(id: string, patch: Record<string, unknown>): Promise<AutomationRule | undefined> {
    const res = await this.gw.request<{ rule: AutomationRule }>("mc.automations.update", { id, ...patch }).catch(() => null);
    if (res?.rule) this.automationRules = this.automationRules.map((r) => (r.id === id ? res.rule : r));
    return res?.rule;
  }

  async deleteAutomationRule(id: string): Promise<void> {
    await this.gw.request("mc.automations.delete", { id }).catch(() => null);
    this.automationRules = this.automationRules.filter((r) => r.id !== id);
  }

  // ── Cron management operations ────────────────────────────────────────────

  async addCronJob(data: { name: string; schedule: any; delivery: any }): Promise<any> {
    const res = await this.gw.request("mc.cron.add", data).catch(() => null);
    void this.loadCronJobs();
    return res;
  }

  async updateCronJob(id: string, patch: Record<string, unknown>): Promise<any> {
    const res = await this.gw.request("mc.cron.update", { id, ...patch }).catch(() => null);
    void this.loadCronJobs();
    return res;
  }

  async removeCronJob(id: string): Promise<void> {
    await this.gw.request("mc.cron.remove", { id }).catch(() => null);
    void this.loadCronJobs();
  }

  async runCronJob(id: string): Promise<void> {
    await this.gw.request("mc.cron.run", { id }).catch(() => null);
    void this.loadCronJobs();
  }

  // ── Integration operations ──────────────────────────────────────────────────

  async gcalConnect(): Promise<string | undefined> {
    const res = await this.gw.request<{ url: string }>("mc.gcal.connect", {}).catch(() => null);
    return res?.url;
  }

  async gcalDisconnect(): Promise<void> {
    await this.gw.request("mc.gcal.disconnect", {}).catch(() => null);
    void this.loadIntegrations();
    this.calendarEvents = [];
  }

  async gcalSync(): Promise<void> {
    await this.gw.request("mc.gcal.sync", {}).catch(() => null);
    void this.loadCalendarEvents();
    void this.loadIntegrations();
  }

  async gcalCreateEvent(data: { title: string; startAt: number; endAt: number; allDay?: boolean; description?: string; location?: string }): Promise<CalendarEvent | undefined> {
    const res = await this.gw.request<{ event: CalendarEvent }>("mc.gcal.events.create", data).catch(() => null);
    if (res?.event) void this.loadCalendarEvents();
    return res?.event;
  }

  async gcalDeleteEvent(id: string): Promise<void> {
    await this.gw.request("mc.gcal.events.delete", { id }).catch(() => null);
    this.calendarEvents = this.calendarEvents.filter((e) => e.id !== id);
  }

  async gcalLinkTask(eventId: string, taskId: string | null): Promise<CalendarEvent | undefined> {
    const res = await this.gw.request<{ event: CalendarEvent }>("mc.gcal.events.linkTask", { eventId, taskId }).catch(() => null);
    if (res?.event) this.calendarEvents = this.calendarEvents.map((e) => (e.id === eventId ? res.event : e));
    return res?.event;
  }

  async githubConnect(data: { token: string; webhookSecret?: string }): Promise<void> {
    await this.gw.request("mc.github.connect", data).catch(() => null);
    void this.loadIntegrations();
  }

  async githubDisconnect(): Promise<void> {
    await this.gw.request("mc.github.disconnect", {}).catch(() => null);
    void this.loadIntegrations();
    this.githubRepos = [];
    this.githubIssues = [];
  }

  async githubSync(): Promise<void> {
    await this.gw.request("mc.github.sync", {}).catch(() => null);
    void this.loadGitHubRepos();
    void this.loadGitHubIssues();
    void this.loadIntegrations();
  }

  async githubCreateTask(issueId: string, agentId: string): Promise<Task | undefined> {
    const res = await this.gw.request<{ task: Task }>("mc.github.issues.createTask", { issueId, agentId }).catch(() => null);
    if (res?.task) void this.loadTasks();
    return res?.task;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  private buildFacade(): AppFacade {
    return {
      gw: this.gw,
      agents: this.agents,
      sessions: this.sessions,
      subagents: this.subagents,
      tasks: this.tasks,
      rooms: this.rooms,
      people: this.people,
      memoryFiles: this.memoryFiles,
      cronJobs: this.cronJobs,
      cronSource: this.cronSource,
      approvals: this.approvals,
      engineStatus: this.engineStatus,
      createTask: (d) => this.createTask(d),
      updateTask: (id, p) => this.updateTask(id, p),
      addTaskUpdate: (id, note, author) => this.addTaskUpdate(id, note, author),
      deleteTask: (id) => this.deleteTask(id),
      queueTask: (id) => this.queueTask(id),
      cancelTask: (id, reason) => this.cancelTask(id, reason),
      retryTask: (id) => this.retryTask(id),
      getTaskDetail: (id) => this.getTaskDetail(id),
      resolveApproval: (id, d, n) => this.resolveApproval(id, d, n),
      getSessionHistory: (sessionKey, limit) => this.getSessionHistory(sessionKey, limit),
      sendToSession: (sessionKey, message) => this.sendToSession(sessionKey, message),
      createRoom: (d) => this.createRoom(d),
      inviteToRoom: (id, agentId, name) => this.inviteToRoom(id, agentId, name),
      sendRoomMessage: (r, m) => this.sendRoomMessage(r, m),
      createPerson: (d) => this.createPerson(d),
      updatePerson: (id, p) => this.updatePerson(id, p),
      deletePerson: (id) => this.deletePerson(id),
      // Trello
      trelloBoards: this.trelloBoards,
      trelloLists: this.trelloLists,
      trelloCards: this.trelloCards,
      currentTrelloBoardId: this.currentTrelloBoardId,
      createTrelloBoard: (d) => this.createTrelloBoard(d),
      updateTrelloBoard: (id, p) => this.updateTrelloBoard(id, p),
      deleteTrelloBoard: (id) => this.deleteTrelloBoard(id),
      createTrelloList: (d) => this.createTrelloList(d),
      updateTrelloList: (id, p) => this.updateTrelloList(id, p),
      deleteTrelloList: (id) => this.deleteTrelloList(id),
      loadTrelloBoardData: (boardId) => this.loadTrelloBoardData(boardId),
      setCurrentTrelloBoardId: (id) => this.setCurrentTrelloBoardId(id),
      createTrelloCard: (d) => this.createTrelloCard(d),
      updateTrelloCard: (id, p) => this.updateTrelloCard(id, p),
      moveTrelloCard: (id, listId, pos) => this.moveTrelloCard(id, listId, pos),
      deleteTrelloCard: (id) => this.deleteTrelloCard(id),
      listTrelloComments: (cardId) => this.listTrelloComments(cardId),
      addTrelloComment: (cardId, text, author) => this.addTrelloComment(cardId, text, author),
      // Phase 2: Templates
      templates: this.templates,
      createTemplate: (d) => this.createTemplate(d),
      updateTemplate: (id, p) => this.updateTemplate(id, p),
      deleteTemplate: (id) => this.deleteTemplate(id),
      instantiateTemplate: (id, o) => this.instantiateTemplate(id, o),
      // Phase 2: Workflows
      workflows: this.workflows,
      workflowRuns: this.workflowRuns,
      createWorkflow: (d) => this.createWorkflow(d),
      updateWorkflow: (id, p) => this.updateWorkflow(id, p),
      deleteWorkflow: (id) => this.deleteWorkflow(id),
      addWorkflowStep: (wid, d) => this.addWorkflowStep(wid, d),
      updateWorkflowStep: (id, p) => this.updateWorkflowStep(id, p),
      removeWorkflowStep: (id) => this.removeWorkflowStep(id),
      reorderWorkflowSteps: (wid, ids) => this.reorderWorkflowSteps(wid, ids),
      startWorkflow: (id, o) => this.startWorkflow(id, o),
      getWorkflowRun: (id) => this.getWorkflowRun(id),
      cancelWorkflowRun: (id) => this.cancelWorkflowRun(id),
      // Phase 2: Automations
      automationRules: this.automationRules,
      createAutomationRule: (d) => this.createAutomationRule(d),
      updateAutomationRule: (id, p) => this.updateAutomationRule(id, p),
      deleteAutomationRule: (id) => this.deleteAutomationRule(id),
      // Phase 2: Cron management
      addCronJob: (d) => this.addCronJob(d),
      updateCronJob: (id, p) => this.updateCronJob(id, p),
      removeCronJob: (id) => this.removeCronJob(id),
      runCronJob: (id) => this.runCronJob(id),
      // Phase 3: Analytics
      analyticsData: this.analyticsData,
      analyticsRange: this.analyticsRange,
      loadAnalytics: () => this.loadAnalytics(),
      setAnalyticsRange: (d) => this.setAnalyticsRange(d),
      // Phase 4: Integrations
      integrations: this.integrations,
      calendarEvents: this.calendarEvents,
      githubRepos: this.githubRepos,
      githubIssues: this.githubIssues,
      loadIntegrations: () => this.loadIntegrations(),
      loadCalendarEvents: () => this.loadCalendarEvents(),
      loadGitHubRepos: () => this.loadGitHubRepos(),
      loadGitHubIssues: (o) => this.loadGitHubIssues(o),
      gcalConnect: () => this.gcalConnect(),
      gcalDisconnect: () => this.gcalDisconnect(),
      gcalSync: () => this.gcalSync(),
      gcalCreateEvent: (d) => this.gcalCreateEvent(d),
      gcalDeleteEvent: (id) => this.gcalDeleteEvent(id),
      gcalLinkTask: (eid, tid) => this.gcalLinkTask(eid, tid),
      githubConnect: (d) => this.githubConnect(d),
      githubDisconnect: () => this.githubDisconnect(),
      githubSync: () => this.githubSync(),
      githubCreateTask: (iid, aid) => this.githubCreateTask(iid, aid),
      // Phase 5: Intelligence
      agentCapabilities: this.agentCapabilities,
      routingRules: this.routingRules,
      loadAgentCapabilities: () => this.loadAgentCapabilities(),
      loadRoutingRules: () => this.loadRoutingRules(),
      createRoutingRule: (d) => this.createRoutingRule(d),
      updateRoutingRule: (id, p) => this.updateRoutingRule(id, p),
      deleteRoutingRule: (id) => this.deleteRoutingRule(id),
      getRecommendations: (tid) => this.getRecommendations(tid),
      resetAgentCapabilities: (aid) => this.resetAgentCapabilities(aid),
      // Notifications
      notifications: this.notifications,
      unreadCount: this.unreadCount,
      notificationsOpen: this.notificationsOpen,
      loadNotifications: () => this.loadNotifications(),
      markNotificationRead: (id) => this.markNotificationRead(id),
      markAllNotificationsRead: () => this.markAllNotificationsRead(),
      dismissNotification: (id) => this.dismissNotificationById(id),
      dismissAllNotifications: () => this.dismissAllNotifications(),
      toggleNotifications: () => this.toggleNotifications(),
      // Delegations
      delegations: this.delegations,
      loadDelegations: () => this.loadDelegations(),
      requestDelegation: (d) => this.requestDelegation(d),
      resolveDelegation: (id, a, n) => this.resolveDelegation(id, a, n),
      cancelDelegation: (id) => this.cancelDelegation(id),
      getDelegationSuggestions: (tid) => this.getDelegationSuggestions(tid),
      autoDelegateTask: (tid, aid, r) => this.autoDelegateTask(tid, aid, r),
      reload: () => this.loadAll(),
    };
  }

  private formatTimeAgo(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  private renderNotificationPanel() {
    return html`
      <div class="notif-panel">
        <div class="notif-header">
          <span>Notifications</span>
          <div class="notif-actions">
            <button @click=${() => void this.markAllNotificationsRead()}>Mark all read</button>
            <button @click=${() => void this.dismissAllNotifications()}>Clear all</button>
          </div>
        </div>
        ${this.notifications.length === 0
          ? html`<div class="notif-empty">No notifications</div>`
          : this.notifications.map((n) => html`
            <div class="notif-item ${n.read ? "" : "unread"}" @click=${() => void this.markNotificationRead(n.id)}>
              <button class="notif-dismiss" @click=${(e: Event) => { e.stopPropagation(); void this.dismissNotificationById(n.id); }}>x</button>
              <div class="n-title">
                <span class="n-severity ${n.severity}"></span>
                ${n.title}
              </div>
              ${n.body ? html`<div class="n-body">${n.body}</div>` : ""}
              <div class="n-time">${this.formatTimeAgo(n.createdAt)}</div>
            </div>
          `)}
      </div>
    `;
  }

  private get pendingApprovalCount(): number {
    return this.approvals.filter((a) => a.status === "pending").length;
  }

  private get activeTaskCount(): number {
    return this.tasks.filter((t) => !["done", "cancelled"].includes(t.status)).length;
  }

  render() {
    const facade = this.buildFacade();
    const pendingCount = this.pendingApprovalCount;
    return html`
      <div class="topbar">
        <span class="brand">Mission Control</span>
        <button
          class="nav-tab ${this.tab === "dashboard" ? "active" : ""}"
          @click=${() => { this.tab = "dashboard"; }}
        >Dashboard</button>
        <button
          class="nav-tab ${this.tab === "tasks" ? "active" : ""}"
          @click=${() => { this.tab = "tasks"; }}
        >Tasks (${this.activeTaskCount})</button>
        <button
          class="nav-tab ${this.tab === "approvals" ? "active" : ""}"
          @click=${() => { this.tab = "approvals"; }}
        >Approvals${pendingCount > 0 ? html`<span class="badge">${pendingCount}</span>` : ""}</button>
        <button
          class="nav-tab ${this.tab === "workflows" ? "active" : ""}"
          @click=${() => { this.tab = "workflows"; }}
        >Workflows</button>
        <button
          class="nav-tab ${this.tab === "automations" ? "active" : ""}"
          @click=${() => { this.tab = "automations"; }}
        >Automations</button>
        <button
          class="nav-tab ${this.tab === "analytics" ? "active" : ""}"
          @click=${() => { this.tab = "analytics"; void this.loadAnalytics(); }}
        >Analytics</button>
        <button
          class="nav-tab ${this.tab === "chat" ? "active" : ""}"
          @click=${() => { this.tab = "chat"; }}
        >Chat</button>
        <button
          class="nav-tab ${this.tab === "people" ? "active" : ""}"
          @click=${() => { this.tab = "people"; }}
        >People</button>
        <button
          class="nav-tab ${this.tab === "memory" ? "active" : ""}"
          @click=${() => { this.tab = "memory"; }}
        >Memory</button>
        <button
          class="nav-tab ${this.tab === "calendar" ? "active" : ""}"
          @click=${() => { this.tab = "calendar"; }}
        >Calendar</button>
        <button
          class="nav-tab ${this.tab === "team" ? "active" : ""}"
          @click=${() => { this.tab = "team"; }}
        >Team</button>
        <button
          class="nav-tab ${this.tab === "integrations" ? "active" : ""}"
          @click=${() => { this.tab = "integrations"; }}
        >Integrations</button>
        <button
          class="nav-tab ${this.tab === "trello" ? "active" : ""}"
          @click=${() => { this.tab = "trello"; }}
        >Trello</button>
        <div class="bell-wrap">
          <button class="bell-btn" @click=${() => this.toggleNotifications()}>
            &#128276;
            ${this.unreadCount > 0 ? html`<span class="bell-badge">${this.unreadCount}</span>` : ""}
          </button>
          ${this.notificationsOpen ? this.renderNotificationPanel() : ""}
        </div>
        <div class="status" style="margin-left:0;">
          <button class="nav-tab" style="height:32px;padding:0 10px;" @click=${() => this.promptGatewayToken()}>
            Token
          </button>
          <div class="dot ${this.gwStatus}"></div>
          ${this.gwStatus === "connected" ? "Live" : this.gwStatus === "connecting" ? "Connecting..." : "Offline"}
        </div>
      </div>
      <div class="content">
        ${this.tab === "dashboard" ? html`<mc-dashboard .app=${facade}></mc-dashboard>` : ""}
        ${this.tab === "tasks" ? html`<mc-tasks .app=${facade}></mc-tasks>` : ""}
        ${this.tab === "approvals" ? html`<mc-approvals .app=${facade}></mc-approvals>` : ""}
        ${this.tab === "chat" ? html`<mc-chat .app=${facade}></mc-chat>` : ""}
        ${this.tab === "people" ? html`<mc-people .app=${facade}></mc-people>` : ""}
        ${this.tab === "memory" ? html`<mc-memory .app=${facade}></mc-memory>` : ""}
        ${this.tab === "calendar" ? html`<mc-calendar .app=${facade}></mc-calendar>` : ""}
        ${this.tab === "team" ? html`<mc-team .app=${facade}></mc-team>` : ""}
        ${this.tab === "trello" ? html`<mc-trello .app=${facade}></mc-trello>` : ""}
        ${this.tab === "workflows" ? html`<mc-workflows .app=${facade}></mc-workflows>` : ""}
        ${this.tab === "automations" ? html`<mc-automations .app=${facade}></mc-automations>` : ""}
        ${this.tab === "analytics" ? html`<mc-analytics .app=${facade}></mc-analytics>` : ""}
        ${this.tab === "integrations" ? html`<mc-integrations .app=${facade}></mc-integrations>` : ""}
      </div>
    `;
  }
}
