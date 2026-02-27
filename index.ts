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
import { getTask } from "./src/task-engine.js";
import { findRunForTask, advanceWorkflowRun } from "./src/workflow-engine.js";
import { evaluateEvent } from "./src/automation-engine.js";
import { buildMissionControlContext } from "./src/agent-context.js";

const plugin = {
  id: "mission-control",
  name: "Mission Control",
  description: "Multi-agent task management and communication hub",
  register(api: OpenClawPluginApi) {
    const gatewayCfg = (api.config as { gateway?: { port?: number } }).gateway ?? {};
    const port = gatewayCfg.port ?? 18789;

    // Bootstrap config is injected into the served HTML so the UI knows where to connect.
    // gatewayUrl is intentionally omitted here so the client auto-derives it from
    // window.location (using wss:// when served over https://).
    const bootstrapConfig: Record<string, unknown> = {
      basePath: "/mission-control",
    };

    // Serve Mission Control UI for all /mission-control/* paths
    api.registerHttpHandler((req, res) =>
      handleMissionControlRequest(req, res, bootstrapConfig),
    );

    // Register all mc.* gateway RPC methods
    registerMcMethods(api);

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

    // Hook: detect agent completion for MC tasks
    api.on("agent_end", (event: any, ctx: any) => {
      const sessionKey = ctx?.sessionKey;
      if (!sessionKey || typeof sessionKey !== "string") return;

      // Only handle MC task sessions (format: {agentId}:mc-task-{taskId})
      if (!sessionKey.includes(":mc-task-")) return;

      handleAgentEnd(sessionKey, {
        success: event?.success ?? true,
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

    // Hook: inject Mission Control knowledge into all agent prompts
    api.on("before_prompt_build", () => {
      return { prependContext: buildMissionControlContext() };
    });

    api.logger.info("[mission-control] plugin loaded — UI at /mission-control");
  },
};

export default plugin;
