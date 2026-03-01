// ── Task Engine v2 ──────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled";

export type TaskPriority = "critical" | "high" | "normal" | "low";
export type TaskType = "manual" | "automated" | "scheduled" | "triggered";
export type ExecutionMode = "agent" | "workflow" | "human";

export type TaskUpdate = {
  id: string;
  taskId: string;
  author: string;
  note: string;
  status?: TaskStatus;
  link?: string;
  metadataJson?: string;
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
  resultJson?: string;
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
  taskType: TaskType;
  executionMode: ExecutionMode;
  maxRetries: number;
  retryCount: number;
  timeoutMs?: number;
  requiresApproval: boolean;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: number;
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
  // Populated by getTask / getTaskTree
  children?: Task[];
  dependencies?: string[];
  updates?: TaskUpdate[];
  runs?: TaskRun[];
};

export type ApprovalRequest = {
  id: string;
  taskId: string;
  requestType: "task_start" | "external_comms" | "spending" | "data_deletion" | "custom";
  title: string;
  description?: string;
  contextJson?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy?: string;
  decidedBy?: string;
  decidedAt?: number;
  decisionNote?: string;
  expiresAt?: number;
  createdAt: number;
};

// ── Rooms ──────────────────────────────────────────────────────────────────

export type Room = {
  id: string;
  name: string;
  agentIds: string[];
  /** agentId → session key for each agent's thread in this room */
  sessionKeys: Record<string, string>;
  createdAt: number;
};

// ── Cron ───────────────────────────────────────────────────────────────────

export type CronJob = {
  id: string;
  name: string;
  expression: string;
  target?: string;
  enabled: boolean;
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatus?: "success" | "failed";
  lastError?: string;
};

// ── People / CRM ──────────────────────────────────────────────────────────

export type PersonStatus = "lead" | "prospect" | "customer" | "churned" | "partner";

export type ContactPhone = { value: string; type: string; primary: boolean };

export type Person = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  phones?: ContactPhone[];
  company?: string;
  role?: string;
  status: PersonStatus;
  tags: string[];
  notes?: string;
  googleNotesRaw?: string;
  sourcePrimary?: string;
  lastContactedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type CommunicationChannel = "call" | "text" | "email";
export type CommunicationDirection = "inbound" | "outbound";

export type CommunicationActivity = {
  id: string;
  personId: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  timestamp: number;
  status?: string;
  summary?: string;
  taskId?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  providerName?: string;
  metadataJson?: string;
  createdAt: number;
  updatedAt: number;
};

// ── Trello Boards ────────────────────────────────────────────────────────

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

export type TrelloLabel = {
  color: string;
  text: string;
};

export type TrelloChecklistItem = {
  text: string;
  done: boolean;
};

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

// ── Task Templates ───────────────────────────────────────────────────────

export type TaskTemplate = {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  priority: TaskPriority;
  taskType: TaskType;
  executionMode: ExecutionMode;
  maxRetries: number;
  timeoutMs?: number;
  requiresApproval: boolean;
  tags: string[];
  contextJson: string;
  createdAt: number;
  updatedAt: number;
};

// ── Workflows ────────────────────────────────────────────────────────────

export type WorkflowTriggerType = "manual" | "cron" | "event";
export type WorkflowStepFailureAction = "stop" | "skip" | "retry";
export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled";
export type WorkflowRunStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

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

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  triggerSource?: string;
  contextJson: string;
  currentStep: number;
  startedAt: number;
  endedAt?: number;
  error?: string;
  steps: WorkflowRunStep[];
};

export type WorkflowRunStep = {
  id: string;
  runId: string;
  stepId: string;
  taskId?: string;
  status: WorkflowRunStepStatus;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  resultJson?: string;
};

// ── Automation Rules ─────────────────────────────────────────────────────

export type AutomationEventType = "task_completed" | "task_failed" | "cron" | "github_issue_opened" | "github_pr_opened" | "github_push" | "calendar_event_upcoming";
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

// ── Integrations ──────────────────────────────────────────────────────────

export type IntegrationType = "google_calendar" | "github" | "google_contacts";
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

// ── Intelligence Layer ────────────────────────────────────────────────────

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

// ── Notifications ────────────────────────────────────────────────────────

export type NotificationType =
  | "approval_needed"
  | "task_completed"
  | "task_failed"
  | "task_delegated"
  | "delegation_request"
  | "delegation_approved"
  | "delegation_rejected"
  | "deadline_approaching"
  | "workflow_completed"
  | "workflow_failed"
  | "system";

export type NotificationSeverity = "info" | "warning" | "error" | "success";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  severity: NotificationSeverity;
  sourceType?: string;
  sourceId?: string;
  actorId?: string;
  read: boolean;
  dismissed: boolean;
  actionType?: string;
  actionPayloadJson?: string;
  createdAt: number;
};

// ── Agent Delegation ─────────────────────────────────────────────────────

export type DelegationStatus = "pending" | "approved" | "rejected" | "completed" | "cancelled";

export type Delegation = {
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

// ── Engine Status ─────────────────────────────────────────────────────────

export type EngineStatus = {
  running: boolean;
  maxConcurrent: number;
  autoExecute: boolean;
  activeTasks: number;
  queuedTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
};
