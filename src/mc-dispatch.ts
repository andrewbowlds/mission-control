/**
 * Handler registry for MC gateway methods.
 * Allows the agent tool to call mc.* methods internally without a WebSocket roundtrip.
 */
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "openclaw/plugin-sdk";
import { getGatewayContext } from "./execution-engine.js";

type Handler = GatewayRequestHandler;
type GatewayContext = GatewayRequestHandlerOptions["context"];

const handlers = new Map<string, Handler>();

/** Store a gateway handler for internal dispatch. Called during registerMcMethods. */
export function storeHandler(method: string, handler: Handler): void {
  handlers.set(method, handler);
}

/** List all registered MC method names. */
export function listMcMethods(): string[] {
  return Array.from(handlers.keys());
}

/** Marker for fallback contexts so captureGatewayContext can skip them. */
export const FALLBACK_CONTEXT_MARKER = Symbol.for("mc-dispatch-fallback");

/**
 * Build a minimal gateway context for agent tool dispatch.
 * Most MC handlers only need context.broadcast; cron and other services
 * are only used by a few admin methods. This fallback allows the majority
 * of methods to work even before a UI client connects.
 */
function buildFallbackContext(): GatewayContext {
  const unavailable = (name: string) => {
    throw new Error(`${name} is not available via the agent tool. Use the Mission Control UI for this operation.`);
  };

  return new Proxy({} as GatewayContext, {
    get(_target, prop) {
      if (prop === FALLBACK_CONTEXT_MARKER) return true;
      if (prop === "broadcast") return () => {}; // no-op: no UI clients to broadcast to
      if (prop === "broadcastToConnIds") return () => {};
      unavailable(String(prop));
    },
  });
}

/** Call an MC gateway method directly, bypassing WebSocket. Returns the response payload. */
export async function callMcMethod(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`Unknown MC method: ${method}. Available: ${listMcMethods().join(", ")}`);
  }

  // Use the real gateway context if captured, otherwise fall back to a minimal one
  const context = getGatewayContext() ?? buildFallbackContext();

  return new Promise<unknown>((resolve, reject) => {
    let settled = false;

    const respond: GatewayRequestHandlerOptions["respond"] = (ok, payload, error) => {
      if (settled) return;
      settled = true;
      if (ok) {
        resolve(payload);
      } else {
        const message = error?.message ?? (typeof payload === "string" ? payload : "MC method failed");
        reject(new Error(message));
      }
    };

    try {
      const result = handler({
        req: { type: "req", id: "agent-tool", method, params } as any,
        params,
        client: null,
        isWebchatConnect: () => false,
        respond,
        context,
      });

      // Handle async handlers that might reject
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        reject(err);
      }
    }
  });
}
