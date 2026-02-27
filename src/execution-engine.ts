import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk";
import {
  listTasks,
  getTask,
  getQueuedTasks,
  transitionTask,
  checkBlockedTasks,
  promoteScheduledTasks,
  createTaskRun,
  completeTaskRun,
  updateTaskRunSession,
  getRunningTaskRuns,
  findTaskRunBySession,
  addTaskUpdate,
} from "./task-engine.js";
import {
  createApprovalRequest,
  resolveApproval,
  expireApprovals,
} from "./approval-engine.js";
import type { Task, EngineStatus } from "./types.js";
import { recordOutcome } from "./intelligence/capabilities.js";
import {
  notifyApprovalNeeded,
  notifyTaskCompleted,
  notifyTaskFailed,
  checkDeadlines,
} from "./notification-engine.js";

type GatewayContext = GatewayRequestHandlerOptions["context"];
type BroadcastFn = GatewayContext["broadcast"];

// ── Engine State ────────────────────────────────────────────────────────────

let gatewayContext: GatewayContext | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let engineConfig = {
  maxConcurrent: 3,
  autoExecute: true,
  tickIntervalMs: 5000,
};

// ── Context Management ──────────────────────────────────────────────────────

export function captureGatewayContext(ctx: GatewayContext): void {
  gatewayContext = ctx;
}

function getBroadcast(): BroadcastFn | null {
  return gatewayContext?.broadcast ?? null;
}

/** Exported for use by index.ts hooks (workflow advancement, automation evaluation) */
export function getBroadcastFn(): BroadcastFn | null {
  return getBroadcast();
}

// ── Broadcasting ────────────────────────────────────────────────────────────

function broadcastTaskEvent(type: string, task: Task): void {
  const broadcast = getBroadcast();
  if (broadcast) {
    broadcast("mc.task", { type, task });
  }
}

function broadcastApprovalEvent(type: string, approval: unknown): void {
  const broadcast = getBroadcast();
  if (broadcast) {
    broadcast("mc.approval", { type, approval });
  }
}

export function broadcastEngineStatus(): void {
  const broadcast = getBroadcast();
  if (broadcast) {
    broadcast("mc.engine", { type: "status", status: getEngineStatus() });
  }
}

// ── Device Auth Helpers ─────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

type DeviceIdentity = { deviceId: string; publicKeyPem: string; privateKeyPem: string };

let _deviceIdentity: DeviceIdentity | null = null;

function loadDeviceIdentity(): DeviceIdentity {
  if (_deviceIdentity) return _deviceIdentity;
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  const idPath = path.join(stateDir, "identity", "device.json");
  const raw = JSON.parse(fs.readFileSync(idPath, "utf8"));
  _deviceIdentity = {
    deviceId: raw.deviceId,
    publicKeyPem: raw.publicKeyPem,
    privateKeyPem: raw.privateKeyPem,
  };
  return _deviceIdentity;
}

function buildAuthPayload(p: {
  deviceId: string; clientId: string; clientMode: string; role: string;
  scopes: string[]; signedAtMs: number; token: string; nonce: string;
  platform?: string; deviceFamily?: string;
}): string {
  const platform = (p.platform ?? "").trim().toLowerCase();
  const deviceFamily = (p.deviceFamily ?? "").trim().toLowerCase();
  return ["v3", p.deviceId, p.clientId, p.clientMode, p.role,
    p.scopes.join(","), String(p.signedAtMs), p.token, p.nonce,
    platform, deviceFamily].join("|");
}

function loadGatewayAuthToken(): string | null {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  const configPath = path.join(stateDir, "openclaw.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config?.gateway?.auth?.token ?? null;
  } catch { return null; }
}

function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

function publicKeyRawBase64Url(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  // Ed25519 SPKI DER: 12 byte header + 32 byte raw key
  const raw = spki.subarray(spki.length - 32);
  return base64UrlEncode(raw);
}

// ── Device Auth Token Store ────────────────────────────────────────────────

function loadDeviceAuthToken(deviceId: string, role: string): string | null {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  const storePath = path.join(stateDir, "openclaw.device.auth.v1");
  try {
    const data = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const tokens = data?.devices?.[deviceId]?.tokens;
    return tokens?.[role]?.token ?? null;
  } catch { return null; }
}

// ── Agent Dispatch ──────────────────────────────────────────────────────────

/**
 * Dispatch a task to an agent by calling the gateway's `agent` method
 * via a local WebSocket with proper Ed25519 device auth.
 */
async function dispatchTaskToAgent(task: Task): Promise<{
  runId: string;
  sessionKey: string;
}> {
  const run = createTaskRun(task.id, task.agentId);
  const sessionKey = `${task.agentId}:mc-task-${task.id}`;

  const prompt = buildAgentPrompt(task);
  updateTaskRunSession(run.id, sessionKey);

  const updated = transitionTask(task.id, "running", "Dispatched to agent");
  if (updated) broadcastTaskEvent("status_changed", updated);

  try {
    await sendAuthenticatedAgentRequest({
      sessionKey,
      idempotencyKey: randomUUID(),
      message: prompt,
      channel: "webchat",
    });
  } catch (err) {
    completeTaskRun(run.id, { status: "failed", error: String(err) });
    const failed = transitionTask(task.id, "failed", `Dispatch failed: ${err}`);
    if (failed) broadcastTaskEvent("status_changed", failed);
    throw err;
  }

  return { runId: run.id, sessionKey };
}

/**
 * Send an agent request via WebSocket with Ed25519 challenge-response auth.
 * Flow: open WS → receive connect.challenge → sign nonce → send connect → receive connected → send agent request → receive response
 */
async function sendAuthenticatedAgentRequest(params: {
  sessionKey: string; idempotencyKey: string; message: string; channel: string;
}): Promise<void> {
  const port = (gatewayContext as any)?.deps?.config?.gateway?.port ?? 18789;
  const url = `ws://127.0.0.1:${port}/ws`;
  const identity = loadDeviceIdentity();
  const role = "operator";
  const scopes = ["operator.admin"];
  const gatewayToken = loadGatewayAuthToken() ?? "";
  const deviceToken = loadDeviceAuthToken(identity.deviceId, role);
  // Gateway auth: prefer shared gateway token; fall back to per-device token
  const authToken = gatewayToken || deviceToken || "";

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("Gateway agent request timed out"));
    }, 30000);

    const ws = new WebSocket(url);
    const reqId = randomUUID();

    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(String(event.data));

        // Step 1: Handle challenge — sign nonce and send connect frame
        if (data.type === "event" && data.event === "connect.challenge") {
          const nonce = data.payload?.nonce;
          if (!nonce) { ws.close(); reject(new Error("No nonce")); return; }

          const signedAtMs = Date.now();
          const payload = buildAuthPayload({
            deviceId: identity.deviceId, clientId: "gateway-client",
            clientMode: "backend", role, scopes, signedAtMs, token: authToken, nonce,
            platform: "linux",
          });
          const signature = signPayload(identity.privateKeyPem, payload);

          ws.send(JSON.stringify({
            type: "req", id: reqId + "-connect", method: "connect",
            params: {
              minProtocol: 3, maxProtocol: 3,
              client: { id: "gateway-client", version: "1.0.0", platform: "linux", mode: "backend" },
              caps: [], role, scopes,
              auth: { token: authToken || undefined, deviceToken: deviceToken || undefined },
              device: {
                id: identity.deviceId,
                publicKey: publicKeyRawBase64Url(identity.publicKeyPem),
                signature, signedAt: signedAtMs, nonce,
              },
            },
          }));
          return;
        }

        // Step 2: Connected — send agent request
        if (data.type === "res" && data.id === reqId + "-connect" && data.ok) {
          ws.send(JSON.stringify({
            type: "req", id: reqId, method: "agent",
            params: { ...params, idempotencyKey: params.idempotencyKey },
          }));
          return;
        }

        // Step 3: Agent response — success
        if (data.type === "res" && data.id === reqId) {
          clearTimeout(timeout);
          ws.close();
          if (data.ok) resolve();
          else reject(new Error(data.error?.message ?? "Agent request failed"));
          return;
        }
      } catch { /* ignore parse errors */ }
    });

    ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WebSocket error")); });
    ws.addEventListener("close", () => { clearTimeout(timeout); reject(new Error("WebSocket closed unexpectedly")); });
  });
}

function buildAgentPrompt(task: Task): string {
  const parts: string[] = [];

  parts.push(`# Task: ${task.title}`);
  if (task.description) {
    parts.push(`\n## Description\n${task.description}`);
  }

  // Include context if provided
  if (task.contextJson && task.contextJson !== "{}") {
    try {
      const ctx = JSON.parse(task.contextJson);
      if (Object.keys(ctx).length > 0) {
        parts.push(`\n## Context\n${JSON.stringify(ctx, null, 2)}`);
      }
    } catch { /* ignore parse errors */ }
  }

  if (task.deadlineAt) {
    parts.push(`\n**Deadline:** ${new Date(task.deadlineAt).toISOString()}`);
  }

  parts.push(`\n**Priority:** ${task.priority}`);
  parts.push(`\n**Task ID:** ${task.id}`);

  parts.push(`\nPlease complete this task. When done, summarize what you accomplished.`);

  return parts.join("\n");
}

// ── Engine Tick ──────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!gatewayContext) return;

  try {
    // 1. Expire timed-out approval requests
    const expired = expireApprovals();
    for (const id of expired) {
      broadcastApprovalEvent("expired", { id });
    }

    // 2. Check deadlines and create notifications
    try {
      const deadlineNotified = checkDeadlines();
      if (deadlineNotified.length > 0) {
        const broadcast = getBroadcast();
        if (broadcast) broadcast("mc.notification", { type: "deadline", count: deadlineNotified.length });
      }
    } catch {}

    // 3. Check blocked tasks -- promote if deps are now met
    const promoted = checkBlockedTasks();
    for (const taskId of promoted) {
      const task = getTask(taskId);
      if (task) broadcastTaskEvent("status_changed", task);
    }

    // 4. Promote scheduled tasks that are past their scheduled_at
    const scheduled = promoteScheduledTasks();
    for (const taskId of scheduled) {
      const task = getTask(taskId);
      if (task) broadcastTaskEvent("status_changed", task);
    }

    // 5. Check for timed-out running tasks
    const runningRuns = getRunningTaskRuns();
    const now = Date.now();
    for (const run of runningRuns) {
      const task = getTask(run.taskId);
      if (!task) continue;
      if (task.timeoutMs && (now - run.startedAt) > task.timeoutMs) {
        completeTaskRun(run.id, { status: "timeout", error: "Task execution timed out" });
        // Retry if allowed
        if (task.retryCount < task.maxRetries) {
          const retried = transitionTask(task.id, "queued", "Retrying after timeout");
          if (retried) broadcastTaskEvent("status_changed", retried);
        } else {
          const failed = transitionTask(task.id, "failed", "Timed out after max retries");
          if (failed) broadcastTaskEvent("status_changed", failed);
        }
      }
    }

    // 6. Dispatch queued tasks if auto-execute is on
    if (!engineConfig.autoExecute) return;

    const currentlyRunning = runningRuns.length;
    const available = engineConfig.maxConcurrent - currentlyRunning;
    if (available <= 0) return;

    const ready = getQueuedTasks(available);
    for (const task of ready) {
      // Check approval gate
      if (task.requiresApproval && task.approvalStatus !== "approved") {
        const approval = createApprovalRequest({
          taskId: task.id,
          requestType: "task_start",
          title: `Approve task: ${task.title}`,
          description: task.description,
          requestedBy: task.agentId,
        });
        const waiting = transitionTask(task.id, "waiting_approval", "Awaiting approval");
        if (waiting) broadcastTaskEvent("status_changed", waiting);
        broadcastApprovalEvent("new", approval);
        notifyApprovalNeeded(task.id, task.title, task.agentId);
        const broadcast = getBroadcast();
        if (broadcast) broadcast("mc.notification", { type: "new" });
        continue;
      }

      // Dispatch
      try {
        await dispatchTaskToAgent(task);
      } catch (err) {
        // Already handled in dispatchTaskToAgent
      }
    }
  } catch (err) {
    // Don't let tick errors crash the engine
    console.error("[mc-engine] tick error:", err);
  }
}

// ── Agent Completion Hook ───────────────────────────────────────────────────

/**
 * Called from the plugin's agent_end hook.
 * Matches the completed session to a running task run and updates status.
 */
export function handleAgentEnd(
  sessionKey: string | undefined,
  event: { success: boolean; error?: string; messages?: unknown[] },
): void {
  if (!sessionKey) return;

  const run = findTaskRunBySession(sessionKey);
  if (!run) return;

  const task = getTask(run.taskId);
  if (!task) return;

  // Calculate run duration for intelligence tracking
  const runDurationMs = run.startedAt ? Date.now() - run.startedAt : undefined;

  if (event.success) {
    completeTaskRun(run.id, { status: "completed" });
    const done = transitionTask(task.id, "done", "Agent completed successfully");
    if (done) {
      broadcastTaskEvent("completed", done);
      // Check if completing this task unblocks others
      const promoted = checkBlockedTasks();
      for (const promotedId of promoted) {
        const promotedTask = getTask(promotedId);
        if (promotedTask) broadcastTaskEvent("status_changed", promotedTask);
      }
    }
    // Record success for intelligence layer
    try { recordOutcome(task.agentId, task, true, runDurationMs); } catch {}
    // Notify
    try {
      notifyTaskCompleted(task.id, task.title, task.agentId);
      const broadcast = getBroadcast();
      if (broadcast) broadcast("mc.notification", { type: "new" });
    } catch {}
  } else {
    const errorMsg = event.error ?? "Agent execution failed";
    completeTaskRun(run.id, { status: "failed", error: errorMsg });
    // Record failure for intelligence layer
    try { recordOutcome(task.agentId, task, false, runDurationMs); } catch {}
    // Notify
    try {
      notifyTaskFailed(task.id, task.title, task.agentId, event.error);
      const broadcast = getBroadcast();
      if (broadcast) broadcast("mc.notification", { type: "new" });
    } catch {}

    // Retry if allowed
    if (task.retryCount < task.maxRetries) {
      addTaskUpdate(task.id, { note: `Run failed: ${errorMsg}. Retrying...`, author: "system" });
      const retried = transitionTask(task.id, "queued", `Retrying after failure: ${errorMsg}`);
      if (retried) broadcastTaskEvent("status_changed", retried);
    } else {
      const failed = transitionTask(task.id, "failed", `Failed: ${errorMsg}`);
      if (failed) broadcastTaskEvent("status_changed", failed);
    }
  }

  broadcastEngineStatus();
}

/**
 * Called after an approval is resolved.
 * If approved, re-queues the task. If rejected, cancels it.
 */
export function handleApprovalResolved(
  approvalId: string,
  decision: "approved" | "rejected",
  opts?: { decidedBy?: string; note?: string },
): void {
  const approval = resolveApproval(approvalId, decision, opts);
  if (!approval) return;

  broadcastApprovalEvent("resolved", approval);

  if (decision === "approved") {
    const task = transitionTask(approval.taskId, "queued", "Approval granted, task re-queued");
    if (task) broadcastTaskEvent("status_changed", task);
  } else {
    const task = transitionTask(approval.taskId, "cancelled", `Approval rejected: ${opts?.note ?? "No reason given"}`);
    if (task) broadcastTaskEvent("status_changed", task);
  }

  broadcastEngineStatus();
}

// ── Engine Lifecycle ────────────────────────────────────────────────────────

export function startEngine(): void {
  if (tickInterval) return;
  tickInterval = setInterval(() => void tick(), engineConfig.tickIntervalMs);
  console.log(`[mc-engine] started (tick every ${engineConfig.tickIntervalMs}ms, max concurrent: ${engineConfig.maxConcurrent})`);
}

export function stopEngine(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    console.log("[mc-engine] stopped");
  }
}

export function getEngineStatus(): EngineStatus {
  const running = getRunningTaskRuns();
  const queued = listTasks({ status: "queued" });
  const blocked = listTasks({ status: "blocked" });
  const waitingApproval = listTasks({ status: "waiting_approval" });

  return {
    running: tickInterval !== null,
    maxConcurrent: engineConfig.maxConcurrent,
    autoExecute: engineConfig.autoExecute,
    activeTasks: running.length,
    queuedTasks: queued.length,
    blockedTasks: blocked.length,
    pendingApprovals: waitingApproval.length,
  };
}

export function updateEngineConfig(patch: {
  maxConcurrent?: number;
  autoExecute?: boolean;
}): EngineStatus {
  if (patch.maxConcurrent !== undefined) {
    engineConfig.maxConcurrent = Math.max(1, Math.min(10, patch.maxConcurrent));
  }
  if (patch.autoExecute !== undefined) {
    engineConfig.autoExecute = patch.autoExecute;
  }
  return getEngineStatus();
}
