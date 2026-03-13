/**
 * SMS Retry Sweep Service
 *
 * Runs as an MC background service.  Every 60 seconds it checks the smsInbox
 * Firestore collection for failed messages whose nextRetryAt has elapsed and
 * replays them to the gateway webhook.
 */

import {
  getRetryQueue,
  replayMessage,
  type RetryCandidate,
} from "./sms-inbox.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let interval: ReturnType<typeof setInterval> | null = null;
let port = 18789;
let hooksToken = "";

const TICK_MS = 60_000;
const MAX_CONCURRENT = 3;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startRetryService(opts: {
  port: number;
  hooksToken: string;
}): void {
  port = opts.port;
  hooksToken = opts.hooksToken;

  if (interval) return;
  interval = setInterval(tick, TICK_MS);
  console.log("[sms-retry] service started (tick every 60s)");
}

export function stopRetryService(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  console.log("[sms-retry] service stopped");
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return; // Guard against overlapping ticks
  ticking = true;

  try {
    const queue = await getRetryQueue(MAX_CONCURRENT);
    if (queue.length === 0) return;

    console.log(`[sms-retry] retrying ${queue.length} message(s)`);

    const results = await Promise.allSettled(
      queue.map((msg) => retryOne(msg)),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const msg = queue[i];
      if (r.status === "rejected") {
        console.error(
          `[sms-retry] retry failed for ${msg.docId}:`,
          r.reason,
        );
      }
    }
  } catch (err) {
    console.error("[sms-retry] tick error:", err);
  } finally {
    ticking = false;
  }
}

async function retryOne(msg: RetryCandidate): Promise<void> {
  const ok = await replayMessage(msg, port, hooksToken);
  if (ok) {
    console.log(
      `[sms-retry] replayed ${msg.docId} to ${msg.agentId} (attempt ${msg.attempts + 1})`,
    );
  } else {
    console.warn(
      `[sms-retry] replay returned non-ok for ${msg.docId}`,
    );
  }
}
