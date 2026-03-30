/**
 * Mission Control agent tool — gives agents direct access to mc.* RPC methods.
 */
import type { AnyAgentTool } from "openclaw/plugin-sdk/agent-runtime";
import { jsonResult } from "openclaw/plugin-sdk/agent-runtime";
import { callMcMethod, listMcMethods } from "./mc-dispatch.js";

// Plain JSON Schema (matches what TypeBox would generate).
// AnyAgentTool uses AgentTool<any>, so any valid JSON Schema object works.
const MissionControlToolSchema = {
  type: "object" as const,
  properties: {
    method: {
      type: "string" as const,
      description:
        'The MC gateway method to call, e.g. "mc.tasks.create", "mc.tasks.list", "mc.approvals.resolve". Use "mc.methods.list" to see all available methods.',
    },
    params: {
      type: "object" as const,
      description:
        "Parameters for the method. Refer to the Mission Control context in your system prompt for parameter documentation.",
      additionalProperties: true,
    },
  },
  required: ["method"] as const,
};

export function createMissionControlTool(): AnyAgentTool {
  return {
    label: "Mission Control",
    name: "mission_control",
    description:
      "Call Mission Control RPC methods to manage tasks, approvals, workflows, templates, automations, people, notifications, delegations, intelligence, analytics, and integrations. Pass the full method name (e.g. mc.tasks.create) and its parameters.",
    parameters: MissionControlToolSchema as any,
    execute: async (_toolCallId, args) => {
      const { method, params } = args as { method: string; params?: Record<string, unknown> };

      // Special meta-method: list available methods
      if (method === "mc.methods.list") {
        return jsonResult({ methods: listMcMethods() });
      }

      const result = await callMcMethod(method, params ?? {});
      return jsonResult(result ?? { ok: true });
    },
  };
}
