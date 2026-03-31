import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { handleMissionControlRequest } from "./src/http-handler.js";
import { registerMcMethods } from "./src/gateway-methods.js";
import {
  startEngine,
  stopEngine,
  handleAgentEnd,
  captureGatewayContext,
  getBroadcastFn,
} from "./src/execution-engine.js";
import { getTask, createTask, listTasks } from "./src/task-engine.js";
import { findRunForTask, advanceWorkflowRun } from "./src/workflow-engine.js";
import { evaluateEvent } from "./src/automation-engine.js";
import { buildMissionControlContext, buildMissionControlContextCondensed } from "./src/agent-context.js";
import { logSmsToTwilioLogs } from "./src/firestore-sms.js";
import { seedIfEmpty } from "./src/seed-data.js";
import { bootstrapGoogleContactsIntegration } from "./src/integrations/google-contacts.js";
import { setWebhookConfig } from "./src/notification-engine.js";
import { createMissionControlTool } from "./src/agent-tool.js";
import {
  initPhoneMap,
  resolveAgentFromPhone,
  logInboundSms,
  sendAutoAck,
  markAckSent,
  markReplied,
  markFailed,
  trackSmsSession,
  popSmsSession,
  markAutoAckSent,
  sendSmsReply,
  extractLastAssistantText,
  processMediaAttachments,
} from "./src/sms-inbox.js";
import type { MediaItem } from "./src/sms-inbox.js";
import { startRetryService, stopRetryService } from "./src/sms-retry-service.js";
import { setOmiRuntime, setOmiLogger, startOmiMemoryCache } from "./src/omi-integration.js";

// ---------------------------------------------------------------------------
// Twilio payload cache reader (populated by sms-payload-cache.mjs transform)
// ---------------------------------------------------------------------------
const CACHE_KEY = "__mc_twilio_sms_payload_cache";

type CachedTwilioPayload = {
  From: string;
  To: string;
  Body: string;
  MessageSid: string;
  NumMedia: number;
  mediaItems: MediaItem[];
  SmsStatus: string;
  FromCity: string;
  FromState: string;
  ToCity: string;
  ToState: string;
  agentId: string;
  cachedAt: number;
};

function popCachedTwilioPayload(fromPhone: string, agentId: string): CachedTwilioPayload | null {
  const cache = (globalThis as any)[CACHE_KEY] as Map<string, CachedTwilioPayload> | undefined;
  if (!cache || cache.size === 0) return null;

  // Search by matching From phone and agentId, take most recent
  let best: { key: string; val: CachedTwilioPayload } | null = null;
  for (const [key, val] of cache.entries()) {
    if (val.From === fromPhone && val.agentId === agentId) {
      if (!best || val.cachedAt > best.val.cachedAt) {
        best = { key, val };
      }
    }
  }

  if (best) {
    cache.delete(best.key);
    return best.val;
  }
  return null;
}

const plugin = {
  id: "mission-control",
  name: "Mission Control",
  description: "Multi-agent task management and communication hub",
  register(api: OpenClawPluginApi) {
    const pConfig = (api.pluginConfig ?? {}) as { slackWebhookUrl?: string; discordWebhookUrl?: string };
    setWebhookConfig({
      slack: pConfig.slackWebhookUrl,
      discord: pConfig.discordWebhookUrl,
    });
    const gatewayCfg = (api.config as { gateway?: { port?: number } }).gateway ?? {};
    const port = gatewayCfg.port ?? 18789;

    // Bootstrap config is injected into the served HTML so the UI knows where to connect.
    // gatewayUrl is intentionally omitted here so the client auto-derives it from
    // window.location (using wss:// when served over https://).
    const bootstrapConfig: Record<string, unknown> = {
      basePath: "/mission-control",
      omiMcpKey: process.env.OMI_MCP_KEY ?? "",
    };

    // Serve Mission Control UI for all /mission-control/* paths
    api.registerHttpRoute({
      path: "/mission-control",
      auth: "none",
      match: "prefix",
      handler: (req, res) => handleMissionControlRequest(req, res, bootstrapConfig),
    });

    // Register all mc.* gateway RPC methods
    registerMcMethods(api);

    // Register agent-facing tool for direct mc.* method calls
    api.registerTool(createMissionControlTool());

    // Seed default templates, automation rules, and workflows (skips if already seeded)
    seedIfEmpty();

    // Initialize Omi wearable integration
    setOmiRuntime(api.runtime);
    startOmiMemoryCache();
    setOmiLogger({
      info: (msg: string) => api.logger.info(msg),
      warn: (msg: string) => api.logger.warn(msg),
    });

    // Auto-create Google Contacts integration record if tokens already exist
    bootstrapGoogleContactsIntegration();

    // Register execution engine as a background service
    api.registerService({
      id: "mc-execution-engine",
      start: () => {
        startEngine();
        api.logger.info("[mission-control] execution engine started");
      },
      stop: () => {
        stopEngine();
        api.logger.info("[mission-control] execution engine stopped");
      },
    });

    // Hook: detect agent completion for MC tasks AND SMS sessions
    api.on("agent_end", (event: any, ctx: any) => {
      const rawSessionKey = ctx?.sessionKey;
      if (!rawSessionKey || typeof rawSessionKey !== "string") return;

      // --- SMS inbox: track success/failure + deliver reply via SMS ---
      if (rawSessionKey.includes("-sms-inbound")) {
        const success = event?.success ?? true;
        if (success) {
          void markReplied(rawSessionKey).catch((err: any) =>
            api.logger.warn(`[sms-inbox] markReplied error: ${err}`),
          );

          // Send the agent's actual response back via SMS
          const session = popSmsSession(rawSessionKey);
          const replyText = extractLastAssistantText(event?.messages ?? []);
          // Resolve agentId from session key
          const skAgentMatch = rawSessionKey.match(/([^:]+)-sms-inbound/);
          const replyAgentId = skAgentMatch ? skAgentMatch[1] : "main";
          if (session && replyText) {
            void sendSmsReply(session.from, session.to, replyText)
              .then(async (sid) => {
                if (sid) {
                  api.logger.info(`[sms-inbox] reply sent ${sid} to ${session.from}`);
                  // Log outbound reply to twilioSmsLogs
                  try {
                    await logSmsToTwilioLogs({
                      direction: "outbound",
                      body: replyText.length > 1500 ? replyText.slice(0, 1497) + "..." : replyText,
                      from: session.to,
                      to: session.from,
                      timestamp: new Date().toISOString(),
                      messageSid: sid,
                      agentId: replyAgentId,
                      variantName: "agent-reply",
                    });
                    api.logger.info(`[sms-log] agent reply logged to twilioSmsLogs`);
                  } catch (logErr) {
                    api.logger.warn(`[sms-log] failed to log reply: ${logErr}`);
                  }
                } else {
                  api.logger.warn(`[sms-inbox] reply send returned no SID`);
                }
              })
              .catch((err: any) =>
                api.logger.warn(`[sms-inbox] reply send error: ${err}`),
              );
          } else if (!session) {
            api.logger.warn(`[sms-inbox] no session tracking for ${rawSessionKey} — cannot deliver reply`);
          } else if (!replyText) {
            api.logger.warn(`[sms-inbox] agent produced no text reply for ${rawSessionKey}`);
          }
        } else {
          const error = event?.error ?? "Unknown agent error";
          popSmsSession(rawSessionKey); // clean up session tracking
          void markFailed(rawSessionKey, String(error)).catch((err: any) =>
            api.logger.warn(`[sms-inbox] markFailed error: ${err}`),
          );
        }
      }

      // --- MC task handling (existing) ---
      if (!rawSessionKey.includes(":mc-task-")) return;

      // Gateway prefixes session keys with "agent:main:" — strip it to match
      // the stored key format ({agentId}:mc-task-{taskId})
      const sessionKey = rawSessionKey.replace(/^agent:main:/, "");

      handleAgentEnd(sessionKey, {
        success: event?.success ?? false,
        error: event?.error,
        messages: event?.messages,
      });

      // Phase 2: workflow advancement and automation evaluation
      const taskIdMatch = sessionKey.match(/:mc-task-(.+)$/);
      if (taskIdMatch) {
        const taskId = taskIdMatch[1];
        const broadcast = getBroadcastFn();

        // Advance workflow if this task belongs to a run
        const runId = findRunForTask(taskId);
        if (runId) {
          advanceWorkflowRun(runId);
          if (broadcast) broadcast("mc.workflow", { type: "run_advanced", runId });
        }

        // Evaluate automation rules
        const task = getTask(taskId);
        if (task) {
          const eventType = event?.success ? "task_completed" : "task_failed";
          evaluateEvent(eventType, { task, agentId: task.agentId, tags: task.tags }, broadcast ?? undefined);
        }
      }
    });

    // --- SMS Inbox: persist inbound SMS and auto-ack ---
    const configEnv = (api.config as any)?.env ?? {};
    initPhoneMap(configEnv);

    // Use before_agent_start to intercept SMS webhook-triggered agent sessions.
    // The prompt contains the formatted SMS body from the hook messageTemplate.
    // Session keys for SMS hooks follow the pattern: {agentId}-sms-inbound
    // Dedup handled at Firestore level (deterministic doc ID from sessionKey).
    api.on("before_agent_start", (event: any, ctx: any) => {
      const sessionKey = ctx?.sessionKey ?? "";
      if (!sessionKey.includes("-sms-inbound")) return;

      const prompt = event?.prompt ?? "";
      // Extract phone and body from messageTemplate format: "📱 SMS from {From}: {Body}"
      const smsMatch = prompt.match(/SMS from ([+\d]+):\s*([\s\S]+)/);
      if (!smsMatch) return;

      const from = smsMatch[1];
      const body = smsMatch[2].trim();
      // Resolve agent from session key (format: agent:{x}:{agentId}-sms-inbound)
      const skMatch = sessionKey.match(/([^:]+)-sms-inbound/);
      const agentId = skMatch ? skMatch[1] : "main";

      // Look up the agent's phone number from the reverse map
      const agentPhones: Record<string, string> = {};
      for (const [envKey, aid] of [
        ["PIERCE_TWILIO_NUMBER", "pierce"],
        ["KIMBERLY_TWILIO_NUMBER", "kimberly"],
        ["BRETT_TWILIO_NUMBER", "brett"],
        ["BECKY_TWILIO_NUMBER", "becky"],
        ["TWILIO_PHONE_NUMBER", "main"],
      ] as const) {
        const phone = configEnv[envKey];
        if (phone) agentPhones[aid] = phone;
      }
      const to = agentPhones[agentId] ?? "";

      if (!from || !body) return;

      // Track session so agent_end can deliver the reply via SMS
      trackSmsSession(sessionKey, from, to);

      // Create MC task for inbound SMS so all conversations are tracked
      try {
        const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;
        createTask({
          title: `SMS from ${from}: ${preview}`,
          agentId,
          description: `Inbound SMS received.\n\n**From:** ${from}\n**To:** ${to}\n**Message:** ${body}\n\n**Session:** ${sessionKey}`,
          priority: "normal",
          tags: ["sms", "inbound", `from:${from}`],
        });
        api.logger.info(`[sms-inbox] MC task created for inbound SMS from ${from} to ${agentId}`);
      } catch (err) {
        api.logger.warn(`[sms-inbox] failed to create MC task for SMS: ${err}`);
      }

      // Fire-and-forget: log to Firestore + auto-ack + twilioSmsLogs + media
      // logInboundSms returns null if doc already exists (dedup from dual-context hooks)
      void (async () => {
        try {
          // Read cached Twilio payload (populated by sms-payload-cache.mjs transform)
          const cached = popCachedTwilioPayload(from, agentId);
          const messageSid = cached?.MessageSid || "";

          const docId = await logInboundSms({
            from, to, body, agentId, sessionKey, messageSid,
          });
          if (!docId) return; // Already logged by other hook context
          api.logger.info(`[sms-inbox] logged ${docId} from ${from} to ${agentId}`);

          // Process media attachments (download from Twilio → upload to GCS)
          let mediaEntries: Awaited<ReturnType<typeof processMediaAttachments>> = [];
          if (cached && cached.NumMedia > 0 && cached.mediaItems.length > 0) {
            const sid = messageSid || docId;
            mediaEntries = await processMediaAttachments(sid, cached.mediaItems);
            api.logger.info(`[sms-media] processed ${mediaEntries.length}/${cached.NumMedia} media items`);
          }

          // Log inbound SMS to twilioSmsLogs (comprehensive history)
          await logSmsToTwilioLogs({
            direction: "inbound",
            body,
            from,
            to,
            timestamp: new Date().toISOString(),
            messageSid: messageSid || undefined,
            agentId,
            numMedia: cached?.NumMedia || 0,
            media: mediaEntries.length > 0 ? mediaEntries : undefined,
          });
          api.logger.info(`[sms-log] inbound logged to twilioSmsLogs from ${from}`);

          // Send auto-ack (only if agent is not main — main handles its own)
          // In-memory dedup prevents duplicate acks from dual hook contexts
          if (agentId !== "main" && to && markAutoAckSent(sessionKey)) {
            const ackSid = await sendAutoAck(from, to, agentId);
            if (ackSid) {
              await markAckSent(docId, ackSid);
              api.logger.info(`[sms-inbox] auto-ack sent ${ackSid}`);

              // Log auto-ack as outbound in twilioSmsLogs
              await logSmsToTwilioLogs({
                direction: "outbound",
                body: `Thanks for your message! ${agentId.charAt(0).toUpperCase() + agentId.slice(1)} will get back to you shortly. - EDP Realty`,
                from: to,
                to: from,
                timestamp: new Date().toISOString(),
                messageSid: ackSid,
                agentId,
                variantName: "auto-ack",
              });
              api.logger.info(`[sms-log] auto-ack logged to twilioSmsLogs`);
            }
          }
        } catch (err) {
          api.logger.warn(`[sms-inbox] log/ack error: ${err}`);
        }
      })();
    });

    // Intercept voice webhook-triggered agent sessions.
    // Session keys for voice hooks follow the pattern: {agentId}-voice-inbound
    // Prompt format: "📞 Inbound call from {From} (CallSid: {CallSid})"
    api.on("before_agent_start", (event: any, ctx: any) => {
      const sessionKey = ctx?.sessionKey ?? "";
      if (!sessionKey.includes("-voice-inbound")) return;

      const prompt = event?.prompt ?? "";
      const voiceMatch = prompt.match(/call from ([+\d]+).*?CallSid:\s*([A-Za-z0-9]+)/);
      if (!voiceMatch) return;

      const from = voiceMatch[1];
      const callSid = voiceMatch[2];
      const skMatch = sessionKey.match(/([^:]+)-voice-inbound/);
      const agentId = skMatch ? skMatch[1] : "main";

      // Create MC task for inbound voice call
      try {
        createTask({
          title: `Inbound call from ${from}`,
          agentId,
          description: `Inbound voice call received.\n\n**From:** ${from}\n**CallSid:** ${callSid}\n\n**Session:** ${sessionKey}`,
          priority: "normal",
          tags: ["voice", "inbound", `from:${from}`],
        });
        api.logger.info(`[voice-inbox] MC task created for inbound call from ${from} to ${agentId}`);
      } catch (err) {
        api.logger.warn(`[voice-inbox] failed to create MC task for call: ${err}`);
      }
    });

    // Register SMS retry sweep service
    const hooksToken = process.env.OPENCLAW_HOOKS_TOKEN ?? "";
    api.registerService({
      id: "mc-sms-retry",
      start: () => {
        startRetryService({ port, hooksToken });
        api.logger.info("[mission-control] SMS retry service started");
      },
      stop: () => {
        stopRetryService();
        api.logger.info("[mission-control] SMS retry service stopped");
      },
    });

    // Hook: inject Mission Control knowledge into agent prompts
    // Full reference on first message, condensed status on follow-ups
    api.on("before_prompt_build", (event: { messages?: unknown[] }, ctx: any) => {
      const isFirstMessage = !event.messages || event.messages.length === 0;
      const agentId = ctx?.agentId as string | undefined;
      return {
        prependContext: isFirstMessage
          ? buildMissionControlContext(agentId)
          : buildMissionControlContextCondensed(),
      };
    });

    // Hook: Live Agent Logs
    const logBroadcast = (type: string, event: any, ctx: any) => {
      const broadcast = getBroadcastFn();
      if (broadcast) {
        broadcast("mc.agent_logs", {
          type,
          event,
          agentId: ctx?.agentId,
          sessionKey: ctx?.sessionKey,
        });
      }
    };
    api.on("llm_input", (event, ctx) => logBroadcast("llm_input", event, ctx));
    api.on("llm_output", (event, ctx) => logBroadcast("llm_output", event, ctx));
    api.on("before_tool_call", (event, ctx) => logBroadcast("before_tool_call", event, ctx));
    api.on("after_tool_call", (event, ctx) => logBroadcast("after_tool_call", event, ctx));

    api.logger.info("[mission-control] plugin loaded — UI at /mission-control");
  },
};

export default plugin;
