import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { storeHandler } from "./mc-dispatch.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addTaskUpdate,
  queueTask,
  cancelTask,
  retryTask,
  reorderTask,
  addDependency,
  removeDependency,
  getTaskStats,
  transitionTask,
} from "./task-engine.js";
import {
  listApprovalRequests,
  getApprovalStats,
} from "./approval-engine.js";
import {
  captureGatewayContext,
  handleApprovalResolved,
  getEngineStatus,
  updateEngineConfig,
  broadcastEngineStatus,
} from "./execution-engine.js";
import { createRoom, listRooms, updateRoom } from "./rooms-store.js";
import {
  listBoards, getBoard, createBoard, updateBoard, deleteBoard,
  listLists, createList, updateList, deleteList,
  listCards, getCard, createCard, updateCard, moveCard, deleteCard,
  listComments, addComment,
} from "./trello-store.js";
import {
  createPerson,
  deletePerson,
  getPerson,
  listPeople,
  updatePerson,
  validatePersonStatus,
} from "./people-store.js";
import { listMemoryFiles, readMemoryFile, searchMemory } from "./memory-store.js";
import { createContactActivity, listContactActivities } from "./contact-activity-store.js";
import { fetchSmsHistory } from "./firestore-sms.js";
import { listInbox, getInboxStats } from "./sms-inbox.js";
import {
  generateBriefing,
  generateAllBriefings,
  getLatestBriefing,
  getBriefingHistory,
} from "./briefing-engine.js";
import { getContactsDb } from "./contacts-db.js";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  instantiateTemplate,
} from "./template-store.js";
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  addStep,
  updateStep,
  removeStep,
  reorderSteps,
  startWorkflow,
  listRuns,
  getRun,
  cancelRun,
} from "./workflow-engine.js";
import {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
} from "./automation-engine.js";
import {
  getOverviewMetrics,
  getTaskThroughput,
  getAgentPerformance,
  getTaskDurationBreakdown,
  getPriorityDistribution,
  getWorkflowAnalytics,
  getSlaReport,
  getTagBreakdown,
} from "./analytics-engine.js";
import {
  listIntegrations,
  getIntegration,
  deleteIntegration,
} from "./integrations/framework.js";
import {
  getCalendarConnectionStatus,
  createCalendarOAuthUrl,
  disconnectCalendar,
  syncCalendarEvents,
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  linkEventToTask,
} from "./integrations/google-calendar.js";
import {
  getContactsIntegrationStatus,
  disconnectGoogleContactsIntegration,
  syncGoogleContactsIntegration,
  pushGoogleContact,
} from "./integrations/google-contacts.js";
import { createGoogleOAuthStartUrl } from "./google-contacts-auth.js";
import {
  connectGitHub,
  disconnectGitHub,
  syncGitHubRepos,
  syncGitHubIssues,
  listRepos,
  listIssues,
  createTaskFromIssue,
} from "./integrations/github.js";
import {
  listCapabilities,
  getAgentProfile,
  resetAgentCapabilities,
} from "./intelligence/capabilities.js";
import {
  listRoutingRules,
  getRoutingRule,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
  recommendAgents,
} from "./intelligence/router.js";
import {
  listNotifications,
  getNotification,
  getUnreadCount,
  markRead,
  markAllRead,
  dismissNotification,
  dismissAll,
} from "./notification-engine.js";
import {
  listDelegations,
  getDelegation,
  requestDelegation,
  resolveDelegation,
  cancelDelegation,
  getDelegationSuggestions,
  autoDelegateTask,
} from "./delegation-engine.js";
import type {
  CronJob,
  TaskPriority,
  TaskStatus,
  TaskType,
  ExecutionMode,
  RoutingRuleType,
  WorkflowTriggerType,
  WorkflowStepFailureAction,
  AutomationEventType,
  AutomationActionType,
  NotificationType,
  DelegationStatus,
  CommunicationChannel,
  CommunicationDirection,
} from "./types.js";

type RegisterGatewayMethod = OpenClawPluginApi["registerGatewayMethod"];
type GatewayHandler = Parameters<RegisterGatewayMethod>[1];
type HandlerOpts = Parameters<GatewayHandler>[0];
type RespondFn = HandlerOpts["respond"];

function badRequest(respond: RespondFn, message: string): void {
  respond(false, undefined, { code: "INVALID_REQUEST", message });
}

function notFound(respond: RespondFn, message: string): void {
  respond(false, undefined, { code: "NOT_FOUND", message });
}

const validStatuses: TaskStatus[] = [
  "pending", "queued", "running", "waiting_approval", "blocked", "done", "failed", "cancelled",
];
const validPriorities: TaskPriority[] = ["critical", "high", "normal", "low"];
const validTaskTypes: TaskType[] = ["manual", "automated", "scheduled", "triggered"];
const validExecModes: ExecutionMode[] = ["agent", "workflow", "human"];
const validCommunicationChannels: CommunicationChannel[] = ["call", "text", "email"];
const validCommunicationDirections: CommunicationDirection[] = ["inbound", "outbound"];

export function registerMcMethods(api: OpenClawPluginApi): void {
  // Wrap registerGatewayMethod to also store handlers for agent tool dispatch
  const register: typeof api.registerGatewayMethod = (method, handler) => {
    api.registerGatewayMethod(method, handler);
    storeHandler(method, handler);
  };

  // ── Tasks ──────────────────────────────────────────────────────────────────

  register("mc.tasks.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const filter: Parameters<typeof listTasks>[0] = {};

    if (typeof params.agentId === "string") filter.agentId = params.agentId;
    if (typeof params.search === "string") filter.search = params.search;
    if (typeof params.limit === "number") filter.limit = params.limit;
    if (typeof params.offset === "number") filter.offset = params.offset;
    if (params.parentId === null) filter.parentId = null;
    else if (typeof params.parentId === "string") filter.parentId = params.parentId;

    if (typeof params.status === "string") {
      filter.status = params.status as TaskStatus;
    } else if (Array.isArray(params.status)) {
      filter.status = params.status.filter(
        (s): s is TaskStatus => typeof s === "string" && validStatuses.includes(s as TaskStatus),
      );
    }

    respond(true, { tasks: listTasks(filter) });
  });

  register("mc.tasks.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const task = getTask(id);
    if (!task) return notFound(respond, "task not found");
    respond(true, { task });
  });

  register("mc.tasks.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const title = typeof params.title === "string" ? params.title.trim() : "";
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    if (!title) return badRequest(respond, "title is required");
    if (!agentId) return badRequest(respond, "agentId is required");

    const task = createTask({
      title,
      agentId,
      description: typeof params.description === "string" ? params.description : undefined,
      priority: typeof params.priority === "string" && validPriorities.includes(params.priority as TaskPriority)
        ? (params.priority as TaskPriority)
        : "normal",
      parentId: typeof params.parentId === "string" ? params.parentId : undefined,
      taskType: typeof params.taskType === "string" && validTaskTypes.includes(params.taskType as TaskType)
        ? (params.taskType as TaskType)
        : "manual",
      executionMode: typeof params.executionMode === "string" && validExecModes.includes(params.executionMode as ExecutionMode)
        ? (params.executionMode as ExecutionMode)
        : "agent",
      requiresApproval: typeof params.requiresApproval === "boolean" ? params.requiresApproval : false,
      scheduledAt: typeof params.scheduledAt === "number" ? params.scheduledAt : undefined,
      deadlineAt: typeof params.deadlineAt === "number" ? params.deadlineAt : undefined,
      timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
      tags: Array.isArray(params.tags) ? params.tags.filter((t): t is string => typeof t === "string") : undefined,
      contextJson: typeof params.contextJson === "string" ? params.contextJson : undefined,
      dependencies: Array.isArray(params.dependencies) ? params.dependencies.filter((d): d is string => typeof d === "string") : undefined,
    });

    // Broadcast the new task
    context.broadcast("mc.task", { type: "created", task });
    broadcastEngineStatus();
    respond(true, { task });
  });

  register("mc.tasks.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");

    const patch: Parameters<typeof updateTask>[1] = {};
    if (typeof params.title === "string") patch.title = params.title;
    if (typeof params.description === "string") patch.description = params.description;
    if (typeof params.agentId === "string") patch.agentId = params.agentId;
    if (typeof params.priority === "string" && validPriorities.includes(params.priority as TaskPriority))
      patch.priority = params.priority as TaskPriority;
    if (Array.isArray(params.tags))
      patch.tags = params.tags.filter((t): t is string => typeof t === "string");
    if (typeof params.contextJson === "string") patch.contextJson = params.contextJson;
    if (typeof params.scheduledAt === "number") patch.scheduledAt = params.scheduledAt;
    if (typeof params.deadlineAt === "number") patch.deadlineAt = params.deadlineAt;
    if (typeof params.timeoutMs === "number") patch.timeoutMs = params.timeoutMs;
    if (typeof params.maxRetries === "number") patch.maxRetries = params.maxRetries;
    if (typeof params.requiresApproval === "boolean") patch.requiresApproval = params.requiresApproval;
    if (typeof params.executionMode === "string" && validExecModes.includes(params.executionMode as ExecutionMode))
      patch.executionMode = params.executionMode as ExecutionMode;
    if (typeof params.sortOrder === "number") patch.sortOrder = params.sortOrder;

    const task = updateTask(id, patch);
    if (!task) return notFound(respond, "task not found");
    context.broadcast("mc.task", { type: "updated", task });
    respond(true, { task });
  });

  register("mc.tasks.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const deleted = deleteTask(id);
    if (deleted) {
      context.broadcast("mc.task", { type: "deleted", id });
      broadcastEngineStatus();
    }
    respond(true, { deleted });
  });

  register("mc.tasks.addUpdate", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const note = typeof params.note === "string" ? params.note.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    if (!note) return badRequest(respond, "note is required");
    const author = typeof params.author === "string" ? params.author : "system";
    const update = addTaskUpdate(id, {
      author,
      note,
      status: typeof params.status === "string" && validStatuses.includes(params.status as TaskStatus)
        ? (params.status as TaskStatus)
        : undefined,
      link: typeof params.link === "string" ? params.link : undefined,
    });

    const outreach = params.outreach && typeof params.outreach === "object" ? params.outreach as Record<string, unknown> : null;
    if (outreach) {
      const personId = typeof outreach.personId === "string" ? outreach.personId.trim() : "";
      const channel = typeof outreach.channel === "string" && validCommunicationChannels.includes(outreach.channel as CommunicationChannel)
        ? outreach.channel as CommunicationChannel
        : null;
      const direction = typeof outreach.direction === "string" && validCommunicationDirections.includes(outreach.direction as CommunicationDirection)
        ? outreach.direction as CommunicationDirection
        : (author === "operator" ? "inbound" : "outbound");

      if (personId && channel) {
        createContactActivity({
          personId,
          channel,
          direction,
          timestamp: typeof outreach.timestamp === "number" ? outreach.timestamp : Date.now(),
          status: typeof outreach.status === "string" ? outreach.status : undefined,
          summary: typeof outreach.summary === "string" ? outreach.summary : note,
          taskId: id,
          sessionId: typeof outreach.sessionId === "string" ? outreach.sessionId : undefined,
          messageId: typeof outreach.messageId === "string" ? outreach.messageId : undefined,
          providerId: typeof outreach.providerId === "string" ? outreach.providerId : undefined,
          providerName: typeof outreach.providerName === "string" ? outreach.providerName : undefined,
          metadataJson: typeof outreach.metadataJson === "string" ? outreach.metadataJson : undefined,
        });
      }
    }
    const task = getTask(id);
    if (task) context.broadcast("mc.task", { type: "updated", task });
    respond(true, { update });
  });

  register("mc.tasks.queue", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const task = queueTask(id);
    if (!task) return notFound(respond, "task not found");
    context.broadcast("mc.task", { type: "status_changed", task });
    broadcastEngineStatus();
    respond(true, { task });
  });

  register("mc.tasks.cancel", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    const task = cancelTask(id, reason);
    if (!task) return notFound(respond, "task not found");
    context.broadcast("mc.task", { type: "status_changed", task });
    broadcastEngineStatus();
    respond(true, { task });
  });

  register("mc.tasks.retry", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const task = retryTask(id);
    if (!task) return notFound(respond, "task not found or not failed");
    context.broadcast("mc.task", { type: "status_changed", task });
    broadcastEngineStatus();
    respond(true, { task });
  });

  register("mc.tasks.reorder", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const sortOrder = typeof params.sortOrder === "number" ? params.sortOrder : NaN;
    if (!id) return badRequest(respond, "id is required");
    if (isNaN(sortOrder)) return badRequest(respond, "sortOrder is required");
    const ok = reorderTask(id, sortOrder);
    respond(true, { ok });
  });

  register("mc.tasks.addDep", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    const dependsOn = typeof params.dependsOn === "string" ? params.dependsOn.trim() : "";
    if (!taskId || !dependsOn) return badRequest(respond, "taskId and dependsOn are required");
    const ok = addDependency(taskId, dependsOn);
    if (ok) {
      const task = getTask(taskId);
      if (task) context.broadcast("mc.task", { type: "updated", task });
    }
    respond(true, { ok });
  });

  register("mc.tasks.removeDep", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    const dependsOn = typeof params.dependsOn === "string" ? params.dependsOn.trim() : "";
    if (!taskId || !dependsOn) return badRequest(respond, "taskId and dependsOn are required");
    const ok = removeDependency(taskId, dependsOn);
    if (ok) {
      const task = getTask(taskId);
      if (task) context.broadcast("mc.task", { type: "updated", task });
    }
    respond(true, { ok });
  });

  register("mc.tasks.stats", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { stats: getTaskStats() });
  });

  // ── Approvals ──────────────────────────────────────────────────────────────

  register("mc.approvals.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const filter: Parameters<typeof listApprovalRequests>[0] = {};
    if (typeof params.status === "string") filter.status = params.status as any;
    if (Array.isArray(params.status)) filter.status = params.status as any;
    if (typeof params.taskId === "string") filter.taskId = params.taskId;
    if (typeof params.limit === "number") filter.limit = params.limit;
    if (typeof params.offset === "number") filter.offset = params.offset;
    respond(true, { approvals: listApprovalRequests(filter) });
  });

  register("mc.approvals.resolve", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const decision = typeof params.decision === "string" ? params.decision : "";
    if (decision !== "approved" && decision !== "rejected")
      return badRequest(respond, "decision must be 'approved' or 'rejected'");
    handleApprovalResolved(id, decision, {
      decidedBy: typeof params.decidedBy === "string" ? params.decidedBy : "operator",
      note: typeof params.note === "string" ? params.note : undefined,
    });
    respond(true, { ok: true });
  });

  register("mc.approvals.stats", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { stats: getApprovalStats() });
  });

  // ── Engine ─────────────────────────────────────────────────────────────────

  register("mc.engine.status", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { status: getEngineStatus() });
  });

  register("mc.engine.config", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const patch: Parameters<typeof updateEngineConfig>[0] = {};
    if (typeof params.maxConcurrent === "number") patch.maxConcurrent = params.maxConcurrent;
    if (typeof params.autoExecute === "boolean") patch.autoExecute = params.autoExecute;
    const status = updateEngineConfig(patch);
    context.broadcast("mc.engine", { type: "config", status });
    respond(true, { status });
  });

  // ── Rooms ──────────────────────────────────────────────────────────────────

  register("mc.rooms.list", ({ respond }) => {
    respond(true, { rooms: listRooms() });
  });

  register("mc.rooms.create", ({ params, respond }) => {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    const agentIds = Array.isArray(params.agentIds)
      ? params.agentIds.filter((id): id is string => typeof id === "string")
      : [];
    respond(true, { room: createRoom({ name, agentIds }) });
  });

  register("mc.rooms.update", ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Parameters<typeof updateRoom>[1] = {};
    if (typeof params.name === "string") patch.name = params.name;
    if (Array.isArray(params.agentIds)) {
      patch.agentIds = params.agentIds.filter((x): x is string => typeof x === "string");
    }
    if (params.sessionKeys && typeof params.sessionKeys === "object" && !Array.isArray(params.sessionKeys)) {
      const raw = params.sessionKeys as Record<string, unknown>;
      patch.sessionKeys = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
    }
    const room = updateRoom(id, patch);
    if (!room) return notFound(respond, "room not found");
    respond(true, { room });
  });

  // ── People (CRM) ───────────────────────────────────────────────────────────

  register("mc.people.list", ({ respond }) => {
    respond(true, { people: listPeople() });
  });

  register("mc.people.get", ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const person = getPerson(id);
    if (!person) return notFound(respond, "person not found");
    respond(true, { person });
  });

  register("mc.people.create", ({ params, respond }) => {
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    const person = createPerson({
      name,
      email: typeof params.email === "string" ? params.email.trim() || undefined : undefined,
      phone: typeof params.phone === "string" ? params.phone.trim() || undefined : undefined,
      company: typeof params.company === "string" ? params.company.trim() || undefined : undefined,
      role: typeof params.role === "string" ? params.role.trim() || undefined : undefined,
      status: validatePersonStatus(params.status) ? params.status : undefined,
      tags: Array.isArray(params.tags) ? params.tags.filter((t: unknown) => typeof t === "string") : undefined,
      notes: typeof params.notes === "string" ? params.notes || undefined : undefined,
      lastContactedAt: typeof params.lastContactedAt === "number" ? params.lastContactedAt : undefined,
    });
    respond(true, { person });
  });

  register("mc.people.update", ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Record<string, unknown> = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.email === "string") patch.email = params.email.trim() || undefined;
    if (typeof params.phone === "string") patch.phone = params.phone.trim() || undefined;
    if (typeof params.company === "string") patch.company = params.company.trim() || undefined;
    if (typeof params.role === "string") patch.role = params.role.trim() || undefined;
    if (validatePersonStatus(params.status)) patch.status = params.status;
    if (Array.isArray(params.tags)) patch.tags = params.tags.filter((t: unknown) => typeof t === "string");
    if (typeof params.notes === "string") patch.notes = params.notes || undefined;
    if (typeof params.lastContactedAt === "number") patch.lastContactedAt = params.lastContactedAt;
    const person = updatePerson(id, patch);
    if (!person) return notFound(respond, "person not found");
    respond(true, { person });
  });

  register("mc.people.activities.list", ({ params, respond }) => {
    const personId = typeof params.personId === "string" ? params.personId.trim() : "";
    if (!personId) return badRequest(respond, "personId is required");
    const channel = typeof params.channel === "string" && validCommunicationChannels.includes(params.channel as CommunicationChannel)
      ? (params.channel as CommunicationChannel)
      : undefined;
    const direction = typeof params.direction === "string" && validCommunicationDirections.includes(params.direction as CommunicationDirection)
      ? (params.direction as CommunicationDirection)
      : undefined;

    const activities = listContactActivities({
      personId,
      channel,
      direction,
      query: typeof params.query === "string" ? params.query : undefined,
      limit: typeof params.limit === "number" ? params.limit : undefined,
      before: typeof params.before === "number" ? params.before : undefined,
      after: typeof params.after === "number" ? params.after : undefined,
    });
    respond(true, { activities });
  });

  register("mc.people.activities.create", ({ params, respond }) => {
    const personId = typeof params.personId === "string" ? params.personId.trim() : "";
    if (!personId) return badRequest(respond, "personId is required");
    const channel = typeof params.channel === "string" && validCommunicationChannels.includes(params.channel as CommunicationChannel)
      ? (params.channel as CommunicationChannel)
      : null;
    if (!channel) return badRequest(respond, "channel must be call|text|email");
    const direction = typeof params.direction === "string" && validCommunicationDirections.includes(params.direction as CommunicationDirection)
      ? (params.direction as CommunicationDirection)
      : null;
    if (!direction) return badRequest(respond, "direction must be inbound|outbound");

    const activity = createContactActivity({
      personId,
      channel,
      direction,
      timestamp: typeof params.timestamp === "number" ? params.timestamp : undefined,
      status: typeof params.status === "string" ? params.status : undefined,
      summary: typeof params.summary === "string" ? params.summary : undefined,
      taskId: typeof params.taskId === "string" ? params.taskId : undefined,
      sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
      messageId: typeof params.messageId === "string" ? params.messageId : undefined,
      providerId: typeof params.providerId === "string" ? params.providerId : undefined,
      providerName: typeof params.providerName === "string" ? params.providerName : undefined,
      metadataJson: typeof params.metadataJson === "string" ? params.metadataJson : undefined,
    });

    respond(true, { activity });
  });

  register("mc.people.smsHistory", async ({ params, respond }) => {
    const personId = typeof params.personId === "string" ? params.personId.trim() : "";
    if (!personId) return badRequest(respond, "personId is required");
    const limit = typeof params.limit === "number" ? params.limit : 200;

    try {
      const db = getContactsDb();
      const rows = db.prepare("SELECT value FROM contact_phones WHERE contact_id = ?").all(personId) as { value: string }[];
      const phones = rows.map((r) => r.value).filter(Boolean);
      if (phones.length === 0) return respond(true, { messages: [] });

      const messages = await fetchSmsHistory(phones, limit);
      respond(true, { messages });
    } catch (err) {
      respond(false, undefined, { code: "FIRESTORE_ERROR", message: err instanceof Error ? err.message : String(err) });
    }
  });

  register("mc.people.delete", ({ params, respond }) => {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    respond(true, { deleted: deletePerson(id) });
  });

  // ── Memory ────────────────────────────────────────────────────────────────

  register("mc.memory.list", ({ respond }) => {
    respond(true, { files: listMemoryFiles() });
  });

  register("mc.memory.read", ({ params, respond }) => {
    const file = typeof params.file === "string" ? params.file : "";
    if (!file) return badRequest(respond, "file is required");
    const content = readMemoryFile(file);
    if (content === null) return notFound(respond, "file not found");
    respond(true, { file, content });
  });

  register("mc.memory.search", ({ params, respond }) => {
    const query = typeof params.query === "string" ? params.query : "";
    respond(true, { results: searchMemory(query) });
  });

  // ── Cron / Calendar ───────────────────────────────────────────────────────

  register("mc.cron.list", async ({ context, respond }) => {
    captureGatewayContext(context);
    try {
      const raw = await context.cron.list({ includeDisabled: true });
      const jobs: CronJob[] = raw.map((job: any) => {
        const sched = job.schedule as { kind: string; expr?: string; tz?: string; everyMs?: number; at?: string };
        const expression =
          sched.kind === "cron"
            ? sched.expr! + (sched.tz ? ` (${sched.tz})` : "")
            : sched.kind === "every"
              ? `every ${sched.everyMs}ms`
              : `at ${sched.at}`;
        const rawStatus = job.state?.lastStatus as string | undefined;
        const lastStatus: CronJob["lastStatus"] =
          rawStatus === "ok" ? "success" : rawStatus === "error" ? "failed" : undefined;
        return {
          id: job.id as string,
          name: job.name as string,
          expression,
          target: job.agentId as string | undefined,
          enabled: job.enabled as boolean,
          nextRunAt: job.state?.nextRunAtMs as number | undefined,
          lastRunAt: job.state?.lastRunAtMs as number | undefined,
          lastStatus,
          lastError: job.state?.lastError as string | undefined,
        };
      });
      respond(true, { source: "cron.list", jobs });
    } catch {
      respond(true, { source: "none", jobs: [] });
    }
  });

  // ── Trello Boards ─────────────────────────────────────────────────────────

  register("mc.trello.boards.list", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { boards: listBoards() });
  });

  register("mc.trello.boards.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    const description = typeof params.description === "string" ? params.description : undefined;
    const board = createBoard({ name, description });
    context.broadcast("mc.trello", { type: "board_created", board });
    respond(true, { board });
  });

  register("mc.trello.boards.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: { name?: string; description?: string } = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.description === "string") patch.description = params.description;
    const board = updateBoard(id, patch);
    if (!board) return notFound(respond, "board not found");
    context.broadcast("mc.trello", { type: "board_updated", board });
    respond(true, { board });
  });

  register("mc.trello.boards.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!deleteBoard(id)) return notFound(respond, "board not found");
    context.broadcast("mc.trello", { type: "board_deleted", id });
    respond(true, { deleted: true });
  });

  // ── Trello Lists ──────────────────────────────────────────────────────────

  register("mc.trello.lists.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const boardId = typeof params.boardId === "string" ? params.boardId : "";
    if (!boardId) return badRequest(respond, "boardId is required");
    respond(true, { lists: listLists(boardId) });
  });

  register("mc.trello.lists.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const boardId = typeof params.boardId === "string" ? params.boardId : "";
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!boardId) return badRequest(respond, "boardId is required");
    if (!name) return badRequest(respond, "name is required");
    const list = createList({ boardId, name });
    context.broadcast("mc.trello", { type: "list_created", list });
    respond(true, { list });
  });

  register("mc.trello.lists.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: { name?: string; position?: number } = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.position === "number") patch.position = params.position;
    const list = updateList(id, patch);
    if (!list) return notFound(respond, "list not found");
    context.broadcast("mc.trello", { type: "list_updated", list });
    respond(true, { list });
  });

  register("mc.trello.lists.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!deleteList(id)) return notFound(respond, "list not found");
    context.broadcast("mc.trello", { type: "list_deleted", id });
    respond(true, { deleted: true });
  });

  // ── Trello Cards ──────────────────────────────────────────────────────────

  register("mc.trello.cards.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const boardId = typeof params.boardId === "string" ? params.boardId : "";
    if (!boardId) return badRequest(respond, "boardId is required");
    respond(true, { cards: listCards(boardId) });
  });

  register("mc.trello.cards.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const listId = typeof params.listId === "string" ? params.listId : "";
    const boardId = typeof params.boardId === "string" ? params.boardId : "";
    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!listId) return badRequest(respond, "listId is required");
    if (!boardId) return badRequest(respond, "boardId is required");
    if (!title) return badRequest(respond, "title is required");
    const card = createCard({
      listId,
      boardId,
      title,
      description: typeof params.description === "string" ? params.description : undefined,
      labels: Array.isArray(params.labels) ? params.labels : undefined,
      dueAt: typeof params.dueAt === "number" ? params.dueAt : undefined,
      assignee: typeof params.assignee === "string" ? params.assignee : undefined,
      checklist: Array.isArray(params.checklist) ? params.checklist : undefined,
      coverColor: typeof params.coverColor === "string" ? params.coverColor : undefined,
    });
    context.broadcast("mc.trello", { type: "card_created", card });
    respond(true, { card });
  });

  register("mc.trello.cards.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Record<string, any> = {};
    if (typeof params.title === "string") patch.title = params.title.trim();
    if (typeof params.description === "string") patch.description = params.description;
    if (Array.isArray(params.labels)) patch.labels = params.labels;
    if (typeof params.dueAt === "number" || params.dueAt === null) patch.dueAt = params.dueAt;
    if (typeof params.assignee === "string" || params.assignee === null) patch.assignee = params.assignee;
    if (Array.isArray(params.checklist)) patch.checklist = params.checklist;
    if (typeof params.coverColor === "string" || params.coverColor === null) patch.coverColor = params.coverColor;
    if (typeof params.position === "number") patch.position = params.position;
    if (typeof params.listId === "string") patch.listId = params.listId;
    const card = updateCard(id, patch);
    if (!card) return notFound(respond, "card not found");
    context.broadcast("mc.trello", { type: "card_updated", card });
    respond(true, { card });
  });

  register("mc.trello.cards.move", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    const listId = typeof params.listId === "string" ? params.listId : "";
    if (!id) return badRequest(respond, "id is required");
    if (!listId) return badRequest(respond, "listId is required");
    const position = typeof params.position === "number" ? params.position : 0;
    const card = moveCard(id, listId, position);
    if (!card) return notFound(respond, "card not found");
    context.broadcast("mc.trello", { type: "card_moved", card });
    respond(true, { card });
  });

  register("mc.trello.cards.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!deleteCard(id)) return notFound(respond, "card not found");
    context.broadcast("mc.trello", { type: "card_deleted", id });
    respond(true, { deleted: true });
  });

  // ── Trello Comments ───────────────────────────────────────────────────────

  register("mc.trello.cards.listComments", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const cardId = typeof params.cardId === "string" ? params.cardId : "";
    if (!cardId) return badRequest(respond, "cardId is required");
    respond(true, { comments: listComments(cardId) });
  });

  register("mc.trello.cards.addComment", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const cardId = typeof params.cardId === "string" ? params.cardId : "";
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!cardId) return badRequest(respond, "cardId is required");
    if (!text) return badRequest(respond, "text is required");
    const author = typeof params.author === "string" ? params.author : "operator";
    const comment = addComment({ cardId, author, text });
    context.broadcast("mc.trello", { type: "comment_added", comment });
    respond(true, { comment });
  });

  // ── Templates ──────────────────────────────────────────────────────────────

  register("mc.templates.list", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { templates: listTemplates() });
  });

  register("mc.templates.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const template = getTemplate(id);
    if (!template) return notFound(respond, "template not found");
    respond(true, { template });
  });

  register("mc.templates.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    if (!agentId) return badRequest(respond, "agentId is required");
    const template = createTemplate({
      name, agentId,
      description: typeof params.description === "string" ? params.description : undefined,
      priority: typeof params.priority === "string" && validPriorities.includes(params.priority as TaskPriority) ? params.priority as TaskPriority : undefined,
      taskType: typeof params.taskType === "string" && validTaskTypes.includes(params.taskType as TaskType) ? params.taskType as TaskType : undefined,
      executionMode: typeof params.executionMode === "string" && validExecModes.includes(params.executionMode as ExecutionMode) ? params.executionMode as ExecutionMode : undefined,
      maxRetries: typeof params.maxRetries === "number" ? params.maxRetries : undefined,
      timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      requiresApproval: typeof params.requiresApproval === "boolean" ? params.requiresApproval : undefined,
      tags: Array.isArray(params.tags) ? params.tags.filter((t: unknown): t is string => typeof t === "string") : undefined,
      contextJson: typeof params.contextJson === "string" ? params.contextJson : undefined,
    });
    context.broadcast("mc.template", { type: "created", template });
    respond(true, { template });
  });

  register("mc.templates.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Record<string, any> = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.agentId === "string") patch.agentId = params.agentId.trim();
    if (typeof params.description === "string") patch.description = params.description;
    if (typeof params.priority === "string" && validPriorities.includes(params.priority as TaskPriority)) patch.priority = params.priority;
    if (typeof params.taskType === "string" && validTaskTypes.includes(params.taskType as TaskType)) patch.taskType = params.taskType;
    if (typeof params.executionMode === "string" && validExecModes.includes(params.executionMode as ExecutionMode)) patch.executionMode = params.executionMode;
    if (typeof params.maxRetries === "number") patch.maxRetries = params.maxRetries;
    if (typeof params.timeoutMs === "number" || params.timeoutMs === null) patch.timeoutMs = params.timeoutMs;
    if (typeof params.requiresApproval === "boolean") patch.requiresApproval = params.requiresApproval;
    if (Array.isArray(params.tags)) patch.tags = params.tags.filter((t: unknown): t is string => typeof t === "string");
    if (typeof params.contextJson === "string") patch.contextJson = params.contextJson;
    const template = updateTemplate(id, patch);
    if (!template) return notFound(respond, "template not found");
    context.broadcast("mc.template", { type: "updated", template });
    respond(true, { template });
  });

  register("mc.templates.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!deleteTemplate(id)) return notFound(respond, "template not found");
    context.broadcast("mc.template", { type: "deleted", id });
    respond(true, { deleted: true });
  });

  register("mc.templates.instantiate", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const templateId = typeof params.templateId === "string" ? params.templateId : "";
    if (!templateId) return badRequest(respond, "templateId is required");
    const overrides: Record<string, any> = {};
    if (typeof params.title === "string") overrides.title = params.title;
    if (typeof params.description === "string") overrides.description = params.description;
    if (typeof params.contextJson === "string") overrides.contextJson = params.contextJson;
    if (typeof params.parentId === "string") overrides.parentId = params.parentId;
    if (typeof params.agentId === "string") overrides.agentId = params.agentId;
    if (typeof params.scheduledAt === "number") overrides.scheduledAt = params.scheduledAt;
    if (typeof params.deadlineAt === "number") overrides.deadlineAt = params.deadlineAt;
    const task = instantiateTemplate(templateId, overrides);
    if (!task) return notFound(respond, "template not found or instantiation failed");
    context.broadcast("mc.task", { type: "created", task });
    respond(true, { task });
  });

  // ── Workflows ──────────────────────────────────────────────────────────────

  const validTriggerTypes: WorkflowTriggerType[] = ["manual", "cron", "event"];
  const validFailureActions: WorkflowStepFailureAction[] = ["stop", "skip", "retry"];

  register("mc.workflows.list", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { workflows: listWorkflows() });
  });

  register("mc.workflows.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const workflow = getWorkflow(id);
    if (!workflow) return notFound(respond, "workflow not found");
    respond(true, { workflow });
  });

  register("mc.workflows.create", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    const triggerType = typeof params.triggerType === "string" && validTriggerTypes.includes(params.triggerType as WorkflowTriggerType)
      ? params.triggerType as WorkflowTriggerType : "manual";
    const triggerConfigJson = typeof params.triggerConfigJson === "string" ? params.triggerConfigJson : undefined;

    const workflow = createWorkflow({
      name,
      description: typeof params.description === "string" ? params.description : undefined,
      triggerType,
      triggerConfigJson,
      enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
    });

    // If cron-triggered, register the cron job
    if (triggerType === "cron" && triggerConfigJson) {
      try {
        const config = JSON.parse(triggerConfigJson);
        if (config.cronExpr) {
          const job = await context.cron.add({
            name: `mc-workflow:${workflow.name}`,
            schedule: { kind: "cron", expr: config.cronExpr, tz: config.cronTz },
            sessionTarget: "main",
            wakeMode: "next-heartbeat",
            payload: { kind: "systemEvent", text: `mc:workflow:${workflow.id}` },
            delivery: { mode: "none" },
            enabled: workflow.enabled,
          });
          updateWorkflow(workflow.id, { cronJobId: job.id });
        }
      } catch { /* cron registration failure is non-fatal */ }
    }

    const result = getWorkflow(workflow.id)!;
    context.broadcast("mc.workflow", { type: "created", workflow: result });
    respond(true, { workflow: result });
  });

  register("mc.workflows.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Record<string, any> = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.description === "string") patch.description = params.description;
    if (typeof params.triggerType === "string" && validTriggerTypes.includes(params.triggerType as WorkflowTriggerType)) patch.triggerType = params.triggerType;
    if (typeof params.triggerConfigJson === "string") patch.triggerConfigJson = params.triggerConfigJson;
    if (typeof params.enabled === "boolean") patch.enabled = params.enabled;
    const workflow = updateWorkflow(id, patch);
    if (!workflow) return notFound(respond, "workflow not found");
    context.broadcast("mc.workflow", { type: "updated", workflow });
    respond(true, { workflow });
  });

  register("mc.workflows.delete", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    // Clean up associated cron job
    const workflow = getWorkflow(id);
    if (workflow?.cronJobId) {
      try { await context.cron.remove(workflow.cronJobId); } catch {}
    }
    if (!deleteWorkflow(id)) return notFound(respond, "workflow not found");
    context.broadcast("mc.workflow", { type: "deleted", id });
    respond(true, { deleted: true });
  });

  register("mc.workflows.addStep", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const workflowId = typeof params.workflowId === "string" ? params.workflowId : "";
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!workflowId) return badRequest(respond, "workflowId is required");
    if (!name) return badRequest(respond, "name is required");
    const step = addStep(workflowId, {
      name,
      templateId: typeof params.templateId === "string" ? params.templateId : undefined,
      inlineConfigJson: typeof params.inlineConfigJson === "string" ? params.inlineConfigJson : undefined,
      conditionJson: typeof params.conditionJson === "string" ? params.conditionJson : undefined,
      onFailure: typeof params.onFailure === "string" && validFailureActions.includes(params.onFailure as WorkflowStepFailureAction) ? params.onFailure as WorkflowStepFailureAction : undefined,
      retryCount: typeof params.retryCount === "number" ? params.retryCount : undefined,
      timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      contextOverridesJson: typeof params.contextOverridesJson === "string" ? params.contextOverridesJson : undefined,
    });
    if (!step) return notFound(respond, "workflow not found");
    context.broadcast("mc.workflow", { type: "updated", workflow: getWorkflow(workflowId) });
    respond(true, { step });
  });

  register("mc.workflows.updateStep", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const stepId = typeof params.stepId === "string" ? params.stepId : "";
    if (!stepId) return badRequest(respond, "stepId is required");
    const patch: Record<string, any> = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.templateId === "string" || params.templateId === null) patch.templateId = params.templateId;
    if (typeof params.inlineConfigJson === "string" || params.inlineConfigJson === null) patch.inlineConfigJson = params.inlineConfigJson;
    if (typeof params.conditionJson === "string" || params.conditionJson === null) patch.conditionJson = params.conditionJson;
    if (typeof params.onFailure === "string" && validFailureActions.includes(params.onFailure as WorkflowStepFailureAction)) patch.onFailure = params.onFailure;
    if (typeof params.retryCount === "number") patch.retryCount = params.retryCount;
    if (typeof params.timeoutMs === "number" || params.timeoutMs === null) patch.timeoutMs = params.timeoutMs;
    if (typeof params.contextOverridesJson === "string") patch.contextOverridesJson = params.contextOverridesJson;
    const step = updateStep(stepId, patch);
    if (!step) return notFound(respond, "step not found");
    respond(true, { step });
  });

  register("mc.workflows.removeStep", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const stepId = typeof params.stepId === "string" ? params.stepId : "";
    if (!stepId) return badRequest(respond, "stepId is required");
    if (!removeStep(stepId)) return notFound(respond, "step not found");
    respond(true, { deleted: true });
  });

  register("mc.workflows.reorderSteps", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const workflowId = typeof params.workflowId === "string" ? params.workflowId : "";
    if (!workflowId) return badRequest(respond, "workflowId is required");
    if (!Array.isArray(params.stepIds)) return badRequest(respond, "stepIds is required");
    const stepIds = params.stepIds.filter((s: unknown): s is string => typeof s === "string");
    reorderSteps(workflowId, stepIds);
    const workflow = getWorkflow(workflowId);
    if (!workflow) return notFound(respond, "workflow not found");
    respond(true, { workflow });
  });

  register("mc.workflows.start", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const workflowId = typeof params.workflowId === "string" ? params.workflowId : "";
    if (!workflowId) return badRequest(respond, "workflowId is required");
    const run = startWorkflow(workflowId, {
      triggerSource: "manual",
      contextJson: typeof params.contextJson === "string" ? params.contextJson : undefined,
    });
    if (!run) return badRequest(respond, "workflow not found, disabled, or has no steps");
    context.broadcast("mc.workflow", { type: "run_started", run });
    respond(true, { run });
  });

  // ── Workflow Runs ──────────────────────────────────────────────────────────

  register("mc.workflows.runs.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const filter: { workflowId?: string; status?: string; limit?: number } = {};
    if (typeof params.workflowId === "string") filter.workflowId = params.workflowId;
    if (typeof params.status === "string") filter.status = params.status;
    if (typeof params.limit === "number") filter.limit = params.limit;
    respond(true, { runs: listRuns(filter) });
  });

  register("mc.workflows.runs.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const run = getRun(id);
    if (!run) return notFound(respond, "run not found");
    respond(true, { run });
  });

  register("mc.workflows.runs.cancel", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!cancelRun(id)) return badRequest(respond, "run not found or not running");
    context.broadcast("mc.workflow", { type: "run_cancelled", id });
    respond(true, { cancelled: true });
  });

  // ── Automation Rules ───────────────────────────────────────────────────────

  const validEventTypes: AutomationEventType[] = ["task_completed", "task_failed", "cron"];
  const validActionTypes: AutomationActionType[] = ["create_task", "start_workflow", "send_message"];

  register("mc.automations.list", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { rules: listRules() });
  });

  register("mc.automations.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const rule = getRule(id);
    if (!rule) return notFound(respond, "rule not found");
    respond(true, { rule });
  });

  register("mc.automations.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    const eventType = typeof params.eventType === "string" && validEventTypes.includes(params.eventType as AutomationEventType) ? params.eventType as AutomationEventType : null;
    const actionType = typeof params.actionType === "string" && validActionTypes.includes(params.actionType as AutomationActionType) ? params.actionType as AutomationActionType : null;
    if (!eventType) return badRequest(respond, "valid eventType is required");
    if (!actionType) return badRequest(respond, "valid actionType is required");
    const actionConfigJson = typeof params.actionConfigJson === "string" ? params.actionConfigJson : "{}";
    const rule = createRule({
      name, eventType, actionType, actionConfigJson,
      description: typeof params.description === "string" ? params.description : undefined,
      eventFilterJson: typeof params.eventFilterJson === "string" ? params.eventFilterJson : undefined,
      cooldownMs: typeof params.cooldownMs === "number" ? params.cooldownMs : undefined,
      enabled: typeof params.enabled === "boolean" ? params.enabled : undefined,
    });
    context.broadcast("mc.automation", { type: "created", rule });
    respond(true, { rule });
  });

  register("mc.automations.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Record<string, any> = {};
    if (typeof params.name === "string") patch.name = params.name.trim();
    if (typeof params.description === "string") patch.description = params.description;
    if (typeof params.enabled === "boolean") patch.enabled = params.enabled;
    if (typeof params.eventType === "string" && validEventTypes.includes(params.eventType as AutomationEventType)) patch.eventType = params.eventType;
    if (typeof params.eventFilterJson === "string") patch.eventFilterJson = params.eventFilterJson;
    if (typeof params.actionType === "string" && validActionTypes.includes(params.actionType as AutomationActionType)) patch.actionType = params.actionType;
    if (typeof params.actionConfigJson === "string") patch.actionConfigJson = params.actionConfigJson;
    if (typeof params.cooldownMs === "number") patch.cooldownMs = params.cooldownMs;
    const rule = updateRule(id, patch);
    if (!rule) return notFound(respond, "rule not found");
    context.broadcast("mc.automation", { type: "updated", rule });
    respond(true, { rule });
  });

  register("mc.automations.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!deleteRule(id)) return notFound(respond, "rule not found");
    context.broadcast("mc.automation", { type: "deleted", id });
    respond(true, { deleted: true });
  });

  // ── Cron Management ────────────────────────────────────────────────────────

  register("mc.cron.add", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (!name) return badRequest(respond, "name is required");
    if (!params.schedule || typeof params.schedule !== "object") return badRequest(respond, "schedule is required");
    try {
      const job = await context.cron.add({
        name,
        schedule: params.schedule as any,
        agentId: typeof params.agentId === "string" ? params.agentId : undefined,
        sessionTarget: (typeof params.sessionTarget === "string" ? params.sessionTarget : "isolated") as any,
        wakeMode: (typeof params.wakeMode === "string" ? params.wakeMode : "now") as any,
        payload: params.payload as any ?? { kind: "systemEvent", text: `Cron job "${name}" fired` },
        delivery: params.delivery as any ?? { mode: "none" },
        enabled: typeof params.enabled === "boolean" ? params.enabled : true,
      });
      context.broadcast("mc.cron", { type: "added", job });
      respond(true, { job });
    } catch (err) {
      badRequest(respond, `cron.add failed: ${err}`);
    }
  });

  register("mc.cron.update", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    try {
      const patch: Record<string, any> = {};
      if (typeof params.name === "string") patch.name = params.name;
      if (params.schedule && typeof params.schedule === "object") patch.schedule = params.schedule;
      if (typeof params.enabled === "boolean") patch.enabled = params.enabled;
      if (typeof params.agentId === "string") patch.agentId = params.agentId;
      await context.cron.update(id, patch);
      context.broadcast("mc.cron", { type: "updated", id });
      respond(true, { updated: true });
    } catch (err) {
      badRequest(respond, `cron.update failed: ${err}`);
    }
  });

  register("mc.cron.remove", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    try {
      await context.cron.remove(id);
      context.broadcast("mc.cron", { type: "removed", id });
      respond(true, { removed: true });
    } catch (err) {
      badRequest(respond, `cron.remove failed: ${err}`);
    }
  });

  register("mc.cron.run", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const mode = typeof params.mode === "string" && (params.mode === "due" || params.mode === "force") ? params.mode : "force";
    try {
      await context.cron.run(id, mode);
      context.broadcast("mc.cron", { type: "ran", id });
      respond(true, { ran: true });
    } catch (err) {
      badRequest(respond, `cron.run failed: ${err}`);
    }
  });

  // ── Analytics ──────────────────────────────────────────────────────────────

  function parseTimeRange(params: Record<string, unknown>): { from?: number; to?: number } | undefined {
    const from = typeof params.from === "number" ? params.from : undefined;
    const to = typeof params.to === "number" ? params.to : undefined;
    return from || to ? { from, to } : undefined;
  }

  register("mc.analytics.overview", async ({ params, respond }) => {
    respond(true, getOverviewMetrics(parseTimeRange(params)));
  });

  register("mc.analytics.throughput", async ({ params, respond }) => {
    const bucketMs = typeof params.bucketMs === "number" ? params.bucketMs : undefined;
    respond(true, { buckets: getTaskThroughput(parseTimeRange(params), bucketMs) });
  });

  register("mc.analytics.agents", async ({ params, respond }) => {
    respond(true, { agents: getAgentPerformance(parseTimeRange(params)) });
  });

  register("mc.analytics.durations", async ({ params, respond }) => {
    respond(true, { buckets: getTaskDurationBreakdown(parseTimeRange(params)) });
  });

  register("mc.analytics.priorities", async ({ params, respond }) => {
    respond(true, { priorities: getPriorityDistribution(parseTimeRange(params)) });
  });

  register("mc.analytics.workflows", async ({ params, respond }) => {
    respond(true, { workflows: getWorkflowAnalytics(parseTimeRange(params)) });
  });

  register("mc.analytics.sla", async ({ params, respond }) => {
    respond(true, getSlaReport(parseTimeRange(params)));
  });

  register("mc.analytics.tags", async ({ params, respond }) => {
    respond(true, { tags: getTagBreakdown(parseTimeRange(params)) });
  });

  // ── Integrations ────────────────────────────────────────────────────────────

  register("mc.integrations.list", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { integrations: listIntegrations() });
  });

  register("mc.integrations.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const integration = getIntegration(id);
    if (!integration) return notFound(respond, "integration not found");
    respond(true, { integration });
  });

  register("mc.integrations.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    if (!deleteIntegration(id)) return notFound(respond, "integration not found");
    context.broadcast("mc.integration", { type: "deleted", id });
    respond(true, { deleted: true });
  });

  // ── Google Calendar ─────────────────────────────────────────────────────────

  register("mc.gcal.status", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, getCalendarConnectionStatus());
  });

  register("mc.gcal.connect", ({ respond, context }) => {
    captureGatewayContext(context);
    try {
      const { url } = createCalendarOAuthUrl();
      respond(true, { url });
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.gcal.disconnect", ({ respond, context }) => {
    captureGatewayContext(context);
    disconnectCalendar();
    context.broadcast("mc.gcal", { type: "disconnected" });
    respond(true, { disconnected: true });
  });

  register("mc.gcal.sync", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    try {
      const opts: { timeMin?: string; timeMax?: string } = {};
      if (typeof params.timeMin === "string") opts.timeMin = params.timeMin;
      if (typeof params.timeMax === "string") opts.timeMax = params.timeMax;
      const result = await syncCalendarEvents(opts);
      context.broadcast("mc.gcal", { type: "synced", ...result });
      respond(true, result);
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.gcal.events.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const opts: { from?: number; to?: number; integrationId?: string } = {};
    if (typeof params.from === "number") opts.from = params.from;
    if (typeof params.to === "number") opts.to = params.to;
    if (typeof params.integrationId === "string") opts.integrationId = params.integrationId;
    respond(true, { events: listCalendarEvents(opts) });
  });

  register("mc.gcal.events.create", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!title) return badRequest(respond, "title is required");
    const startAt = typeof params.startAt === "number" ? params.startAt : 0;
    const endAt = typeof params.endAt === "number" ? params.endAt : 0;
    if (!startAt || !endAt) return badRequest(respond, "startAt and endAt are required");
    try {
      const event = await createCalendarEvent({
        title, startAt, endAt,
        allDay: typeof params.allDay === "boolean" ? params.allDay : false,
        description: typeof params.description === "string" ? params.description : undefined,
        location: typeof params.location === "string" ? params.location : undefined,
      });
      context.broadcast("mc.gcal", { type: "event_created", event });
      respond(true, { event });
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.gcal.events.delete", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    try {
      const deleted = await deleteCalendarEvent(id);
      if (!deleted) return notFound(respond, "event not found");
      context.broadcast("mc.gcal", { type: "event_deleted", id });
      respond(true, { deleted: true });
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.gcal.events.linkTask", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const eventId = typeof params.eventId === "string" ? params.eventId : "";
    const taskId = typeof params.taskId === "string" ? params.taskId : null;
    if (!eventId) return badRequest(respond, "eventId is required");
    const event = linkEventToTask(eventId, taskId);
    if (!event) return notFound(respond, "event not found");
    context.broadcast("mc.gcal", { type: "event_updated", event });
    respond(true, { event });
  });

  // ── Google Contacts ────────────────────────────────────────────────────────

  register("mc.gcontacts.status", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, getContactsIntegrationStatus());
  });

  register("mc.gcontacts.connect", ({ respond, context }) => {
    captureGatewayContext(context);
    try {
      const { url } = createGoogleOAuthStartUrl();
      respond(true, { url });
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.gcontacts.disconnect", ({ respond, context }) => {
    captureGatewayContext(context);
    disconnectGoogleContactsIntegration();
    context.broadcast("mc.gcontacts", { type: "disconnected" });
    respond(true, { disconnected: true });
  });

  register("mc.gcontacts.sync", async ({ respond, context }) => {
    captureGatewayContext(context);
    try {
      const result = await syncGoogleContactsIntegration();
      context.broadcast("mc.gcontacts", { type: "synced", ...result });
      respond(true, result);
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.gcontacts.push", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const contactId = typeof params.contactId === "string" ? params.contactId : "";
    if (!contactId) return badRequest(respond, "contactId is required");
    try {
      const result = await pushGoogleContact(contactId);
      context.broadcast("mc.gcontacts", { type: "pushed", contactId, ...result });
      respond(true, result);
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  // ── GitHub ──────────────────────────────────────────────────────────────────

  register("mc.github.connect", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    const token = typeof params.token === "string" ? params.token.trim() : "";
    if (!token) return badRequest(respond, "token is required");
    try {
      await connectGitHub({
        token,
        webhookSecret: typeof params.webhookSecret === "string" ? params.webhookSecret : undefined,
      });
      context.broadcast("mc.github", { type: "connected" });
      respond(true, { connected: true });
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.github.disconnect", ({ respond, context }) => {
    captureGatewayContext(context);
    disconnectGitHub();
    context.broadcast("mc.github", { type: "disconnected" });
    respond(true, { disconnected: true });
  });

  register("mc.github.sync", async ({ params, respond, context }) => {
    captureGatewayContext(context);
    try {
      const reposResult = await syncGitHubRepos();
      const issuesResult = await syncGitHubIssues(
        typeof params.repoFullName === "string" ? params.repoFullName : undefined,
      );
      context.broadcast("mc.github", { type: "synced", repos: reposResult.synced, issues: issuesResult.synced });
      respond(true, { repos: reposResult.synced, issues: issuesResult.synced });
    } catch (err) {
      badRequest(respond, err instanceof Error ? err.message : String(err));
    }
  });

  register("mc.github.repos.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const integrationId = typeof params.integrationId === "string" ? params.integrationId : undefined;
    respond(true, { repos: listRepos(integrationId) });
  });

  register("mc.github.issues.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const opts: { repoId?: string; state?: string; search?: string; limit?: number } = {};
    if (typeof params.repoId === "string") opts.repoId = params.repoId;
    if (typeof params.state === "string") opts.state = params.state;
    if (typeof params.search === "string") opts.search = params.search;
    if (typeof params.limit === "number") opts.limit = params.limit;
    respond(true, { issues: listIssues(opts) });
  });

  register("mc.github.issues.createTask", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const issueId = typeof params.issueId === "string" ? params.issueId : "";
    const agentId = typeof params.agentId === "string" ? params.agentId : "";
    if (!issueId) return badRequest(respond, "issueId is required");
    if (!agentId) return badRequest(respond, "agentId is required");
    const task = createTaskFromIssue(issueId, agentId);
    if (!task) return badRequest(respond, "issue not found or task creation failed");
    context.broadcast("mc.task", { type: "created", task });
    context.broadcast("mc.github", { type: "issue_linked", issueId, taskId: task.id });
    respond(true, { task });
  });

  // ── Intelligence: Capabilities ──────────────────────────────────────────

  register("mc.intelligence.capabilities.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const opts: { agentId?: string; capability?: string } = {};
    if (typeof params.agentId === "string") opts.agentId = params.agentId;
    if (typeof params.capability === "string") opts.capability = params.capability;
    respond(true, { capabilities: listCapabilities(opts) });
  });

  register("mc.intelligence.capabilities.agentProfile", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const agentId = typeof params.agentId === "string" ? params.agentId : "";
    if (!agentId) return badRequest(respond, "agentId is required");
    respond(true, { capabilities: getAgentProfile(agentId) });
  });

  register("mc.intelligence.capabilities.reset", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const agentId = typeof params.agentId === "string" ? params.agentId : "";
    if (!agentId) return badRequest(respond, "agentId is required");
    resetAgentCapabilities(agentId);
    context.broadcast("mc.intelligence", { type: "capabilities_reset", agentId });
    respond(true, { reset: true });
  });

  // ── Intelligence: Routing Rules ─────────────────────────────────────────

  register("mc.intelligence.routing.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const opts: { enabled?: boolean } = {};
    if (typeof params.enabled === "boolean") opts.enabled = params.enabled;
    respond(true, { rules: listRoutingRules(opts) });
  });

  register("mc.intelligence.routing.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const rule = getRoutingRule(id);
    if (!rule) return badRequest(respond, "routing rule not found");
    respond(true, { rule });
  });

  register("mc.intelligence.routing.create", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const name = typeof params.name === "string" ? params.name : "";
    const ruleType = typeof params.ruleType === "string" ? params.ruleType as RoutingRuleType : "keyword";
    const matchConfigJson = typeof params.matchConfigJson === "string" ? params.matchConfigJson : "{}";
    const preferredAgentId = typeof params.preferredAgentId === "string" ? params.preferredAgentId : "";
    if (!name) return badRequest(respond, "name is required");
    if (!preferredAgentId) return badRequest(respond, "preferredAgentId is required");
    const rule = createRoutingRule({
      name, ruleType, matchConfigJson, preferredAgentId,
      confidence: typeof params.confidence === "number" ? params.confidence : undefined,
      override: typeof params.override === "boolean" ? params.override : undefined,
    });
    context.broadcast("mc.intelligence", { type: "routing_rule_created", rule });
    respond(true, { rule });
  });

  register("mc.intelligence.routing.update", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const patch: Record<string, unknown> = {};
    if (typeof params.name === "string") patch.name = params.name;
    if (typeof params.ruleType === "string") patch.ruleType = params.ruleType;
    if (typeof params.matchConfigJson === "string") patch.matchConfigJson = params.matchConfigJson;
    if (typeof params.preferredAgentId === "string") patch.preferredAgentId = params.preferredAgentId;
    if (typeof params.confidence === "number") patch.confidence = params.confidence;
    if (typeof params.enabled === "boolean") patch.enabled = params.enabled;
    if (typeof params.override === "boolean") patch.override = params.override;
    const rule = updateRoutingRule(id, patch);
    if (!rule) return badRequest(respond, "routing rule not found");
    context.broadcast("mc.intelligence", { type: "routing_rule_updated", rule });
    respond(true, { rule });
  });

  register("mc.intelligence.routing.delete", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id : "";
    if (!id) return badRequest(respond, "id is required");
    const deleted = deleteRoutingRule(id);
    if (!deleted) return badRequest(respond, "routing rule not found");
    context.broadcast("mc.intelligence", { type: "routing_rule_deleted", id });
    respond(true, { deleted: true });
  });

  // ── Intelligence: Recommendations ───────────────────────────────────────

  register("mc.intelligence.recommend", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const taskId = typeof params.taskId === "string" ? params.taskId : "";
    if (!taskId) return badRequest(respond, "taskId is required");
    const task = getTask(taskId);
    if (!task) return badRequest(respond, "task not found");
    const topN = typeof params.topN === "number" ? params.topN : 5;
    const recommendations = recommendAgents(task, { topN });
    respond(true, { recommendations });
  });

  // ── Notifications ─────────────────────────────────────────────────────────

  register("mc.notifications.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const filter: Parameters<typeof listNotifications>[0] = {};
    if (typeof params.read === "boolean") filter.read = params.read;
    if (params.dismissed !== undefined) filter.dismissed = Boolean(params.dismissed);
    else filter.dismissed = false; // default: hide dismissed
    if (typeof params.type === "string") filter.type = params.type as NotificationType;
    if (Array.isArray(params.type)) filter.type = params.type as NotificationType[];
    if (typeof params.limit === "number") filter.limit = params.limit;
    if (typeof params.offset === "number") filter.offset = params.offset;
    respond(true, { notifications: listNotifications(filter) });
  });

  register("mc.notifications.unreadCount", ({ respond, context }) => {
    captureGatewayContext(context);
    respond(true, { count: getUnreadCount() });
  });

  register("mc.notifications.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const notification = getNotification(id);
    if (!notification) return notFound(respond, "notification not found");
    respond(true, { notification });
  });

  register("mc.notifications.markRead", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const notification = markRead(id);
    if (!notification) return notFound(respond, "notification not found");
    context.broadcast("mc.notification", { type: "read", id });
    respond(true, { notification });
  });

  register("mc.notifications.markAllRead", ({ respond, context }) => {
    captureGatewayContext(context);
    const count = markAllRead();
    context.broadcast("mc.notification", { type: "all_read" });
    respond(true, { count });
  });

  register("mc.notifications.dismiss", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const ok = dismissNotification(id);
    if (ok) context.broadcast("mc.notification", { type: "dismissed", id });
    respond(true, { ok });
  });

  register("mc.notifications.dismissAll", ({ respond, context }) => {
    captureGatewayContext(context);
    const count = dismissAll();
    context.broadcast("mc.notification", { type: "all_dismissed" });
    respond(true, { count });
  });

  // ── Delegations ───────────────────────────────────────────────────────────

  register("mc.delegations.list", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const filter: Parameters<typeof listDelegations>[0] = {};
    if (typeof params.taskId === "string") filter.taskId = params.taskId;
    if (typeof params.fromAgentId === "string") filter.fromAgentId = params.fromAgentId;
    if (typeof params.toAgentId === "string") filter.toAgentId = params.toAgentId;
    if (typeof params.status === "string") filter.status = params.status as DelegationStatus;
    if (Array.isArray(params.status)) filter.status = params.status as DelegationStatus[];
    if (typeof params.limit === "number") filter.limit = params.limit;
    if (typeof params.offset === "number") filter.offset = params.offset;
    respond(true, { delegations: listDelegations(filter) });
  });

  register("mc.delegations.get", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const delegation = getDelegation(id);
    if (!delegation) return notFound(respond, "delegation not found");
    respond(true, { delegation });
  });

  register("mc.delegations.request", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    const fromAgentId = typeof params.fromAgentId === "string" ? params.fromAgentId.trim() : "";
    const toAgentId = typeof params.toAgentId === "string" ? params.toAgentId.trim() : "";
    if (!taskId) return badRequest(respond, "taskId is required");
    if (!fromAgentId) return badRequest(respond, "fromAgentId is required");
    if (!toAgentId) return badRequest(respond, "toAgentId is required");
    const delegation = requestDelegation({
      taskId,
      fromAgentId,
      toAgentId,
      reason: typeof params.reason === "string" ? params.reason : undefined,
      requiresApproval: typeof params.requiresApproval === "boolean" ? params.requiresApproval : true,
    });
    if (!delegation) return notFound(respond, "task not found");
    context.broadcast("mc.delegation", { type: "requested", delegation });
    context.broadcast("mc.notification", { type: "new" });
    respond(true, { delegation });
  });

  register("mc.delegations.resolve", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const approved = params.approved === true;
    const delegation = resolveDelegation(id, approved, {
      decidedBy: typeof params.decidedBy === "string" ? params.decidedBy : "operator",
      note: typeof params.note === "string" ? params.note : undefined,
    });
    if (!delegation) return notFound(respond, "delegation not found or not pending");
    context.broadcast("mc.delegation", { type: "resolved", delegation });
    context.broadcast("mc.notification", { type: "new" });
    // If delegation completed, refresh tasks since agent changed
    if (delegation.status === "completed") {
      context.broadcast("mc.task", { type: "updated" });
    }
    respond(true, { delegation });
  });

  register("mc.delegations.cancel", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const id = typeof params.id === "string" ? params.id.trim() : "";
    if (!id) return badRequest(respond, "id is required");
    const delegation = cancelDelegation(id);
    if (!delegation) return notFound(respond, "delegation not found or not pending");
    context.broadcast("mc.delegation", { type: "cancelled", delegation });
    respond(true, { delegation });
  });

  register("mc.delegations.suggestions", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    if (!taskId) return badRequest(respond, "taskId is required");
    const topN = typeof params.topN === "number" ? params.topN : 5;
    const suggestions = getDelegationSuggestions(taskId, { topN });
    respond(true, { suggestions });
  });

  register("mc.delegations.autoDelegate", ({ params, respond, context }) => {
    captureGatewayContext(context);
    const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
    const fromAgentId = typeof params.fromAgentId === "string" ? params.fromAgentId.trim() : "";
    if (!taskId) return badRequest(respond, "taskId is required");
    if (!fromAgentId) return badRequest(respond, "fromAgentId is required");
    const reason = typeof params.reason === "string" ? params.reason : undefined;
    const delegation = autoDelegateTask(taskId, fromAgentId, reason);
    if (!delegation) return respond(true, { delegation: null, message: "No suitable agent found for delegation" });
    context.broadcast("mc.delegation", { type: "requested", delegation });
    context.broadcast("mc.notification", { type: "new" });
    respond(true, { delegation });
  });

  // ── SMS Inbox ──────────────────────────────────────────────────────────────

  register("mc.sms.inbox.list", async ({ params, respond }) => {
    try {
      const status = typeof params.status === "string" ? params.status : undefined;
      const agentId = typeof params.agentId === "string" ? params.agentId : undefined;
      const limit = typeof params.limit === "number" ? params.limit : 50;
      const messages = await listInbox({ status, agentId, limit });
      respond(true, { messages });
    } catch (err: any) {
      respond(false, { error: err.message });
    }
  });

  register("mc.sms.inbox.stats", async ({ respond }) => {
    try {
      const stats = await getInboxStats();
      respond(true, { stats });
    } catch (err: any) {
      respond(false, { error: err.message });
    }
  });

  // ── Briefings ──────────────────────────────────────────────────────────────

  register("mc.briefing.today", ({ params, respond }) => {
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    if (!agentId) return badRequest(respond, "agentId is required");

    let briefing = getLatestBriefing(agentId);
    if (!briefing) {
      // Generate on-demand for yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      briefing = generateBriefing(agentId, yesterday.toISOString().slice(0, 10));
    }
    respond(true, { briefing });
  });

  register("mc.briefing.history", ({ params, respond }) => {
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    if (!agentId) return badRequest(respond, "agentId is required");
    const limit = typeof params.limit === "number" ? params.limit : 7;
    respond(true, { briefings: getBriefingHistory(agentId, limit) });
  });

  register("mc.briefing.regenerate", ({ params, respond }) => {
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : undefined;
    const date = typeof params.date === "string" ? params.date.trim() : undefined;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = date ?? yesterday.toISOString().slice(0, 10);

    if (agentId) {
      const briefing = generateBriefing(agentId, targetDate);
      respond(true, { briefings: [briefing] });
    } else {
      const briefings = generateAllBriefings(targetDate);
      respond(true, { briefings });
    }
  });
}
