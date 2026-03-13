/**
 * SMS Inbox — Firestore-backed message persistence with auto-ack and retry.
 *
 * Every inbound SMS is logged to the `smsInbox` Firestore collection BEFORE
 * agent processing.  If the agent session fails (rate-limit, model error, etc.)
 * the message is retained for automatic retry by the sweep service.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SmsMediaEntry } from "./firestore-sms.js";

// ---------------------------------------------------------------------------
// Firebase Admin Setup (reuses same SA credential as firestore-sms.ts)
// ---------------------------------------------------------------------------

let adminApp: any = null;

const SA_SEARCH_PATHS = [
  path.join(os.homedir(), ".config", "openclaw", "edp-firebase-sa.json"),
  path.join(os.homedir(), ".openclaw", "secrets", "edp-firebase-sa.json"),
];

function parseServiceAccount(): any {
  const fromPath = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_PATH;
  if (fromPath) return JSON.parse(fs.readFileSync(fromPath, "utf8"));

  const raw =
    process.env.EDP_FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.ADMIN_SERVICE_ACCOUNT;
  if (raw) {
    try {
      if (raw.trim().startsWith("{")) return JSON.parse(raw);
    } catch {}
    return JSON.parse(raw);
  }

  for (const p of SA_SEARCH_PATHS) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}
  }

  throw new Error("Missing Firebase service account credentials for sms-inbox");
}

async function getDb() {
  const admin = await import("firebase-admin");
  if (!adminApp) {
    const credential = admin.credential.cert(parseServiceAccount());
    adminApp = admin.initializeApp({ credential }, "mc-sms-inbox");
  }
  return admin.firestore(adminApp);
}

// ---------------------------------------------------------------------------
// Phone → Agent mapping (built from config env at init)
// ---------------------------------------------------------------------------

const phoneToAgent = new Map<string, string>();

export function initPhoneMap(env: Record<string, string>): void {
  const mappings: Record<string, string> = {
    PIERCE_TWILIO_NUMBER: "pierce",
    KIMBERLY_TWILIO_NUMBER: "kimberly",
    BRETT_TWILIO_NUMBER: "brett",
    BECKY_TWILIO_NUMBER: "becky",
    TWILIO_PHONE_NUMBER: "main",
  };
  for (const [envKey, agentId] of Object.entries(mappings)) {
    const phone = env[envKey];
    if (phone) phoneToAgent.set(normalizePhone(phone), agentId);
  }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function resolveAgentFromPhone(toPhone: string): string | undefined {
  return phoneToAgent.get(normalizePhone(toPhone));
}

// ---------------------------------------------------------------------------
// Agent display names for auto-ack
// ---------------------------------------------------------------------------

const AGENT_NAMES: Record<string, string> = {
  pierce: "Pierce",
  kimberly: "Kimberly",
  brett: "Brett",
  becky: "Becky",
  main: "Our team",
};

// ---------------------------------------------------------------------------
// Retry backoff schedule (seconds)
// ---------------------------------------------------------------------------

const BACKOFF = [60, 120, 300, 600, 900];
const MAX_ATTEMPTS = BACKOFF.length;

function nextRetryAt(attempt: number): string {
  const delaySec = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
  return new Date(Date.now() + delaySec * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// In-memory SMS session tracking (from/to per session key)
// ---------------------------------------------------------------------------

const smsSessionMap = new Map<string, { from: string; to: string }>();
const autoAckSent = new Set<string>();

/**
 * Track an active SMS session so agent_end can look up the sender phone.
 */
export function trackSmsSession(sessionKey: string, from: string, to: string): void {
  smsSessionMap.set(sessionKey, { from, to });
}

/**
 * Retrieve and remove an SMS session's phone info.
 */
export function popSmsSession(sessionKey: string): { from: string; to: string } | undefined {
  const entry = smsSessionMap.get(sessionKey);
  if (entry) smsSessionMap.delete(sessionKey);
  return entry;
}

/**
 * Check if an auto-ack was already sent for this session key (in-memory dedup).
 */
export function markAutoAckSent(sessionKey: string): boolean {
  if (autoAckSent.has(sessionKey)) return false; // already sent
  autoAckSent.add(sessionKey);
  // Clean up after 60s to allow future messages on the same session
  setTimeout(() => autoAckSent.delete(sessionKey), 60_000);
  return true; // first time
}

/**
 * Strip markdown formatting and tool call artifacts to produce clean SMS-friendly plain text.
 */
function stripMarkdown(text: string): string {
  return text
    // Strip tool call XML blocks (model sometimes outputs these as raw text)
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/g, "")
    .replace(/<\/?tool_call>/g, "")
    // Strip any remaining XML-like tags the model might emit
    .replace(/<\/?(?:parameter|function|tool_use|tool_result)[^>]*>/g, "")
    // Standard markdown stripping
    .replace(/^#{1,6}\s+/gm, "")          // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")       // bold
    .replace(/\*(.+?)\*/g, "$1")           // italic
    .replace(/__(.+?)__/g, "$1")           // bold alt
    .replace(/_(.+?)_/g, "$1")             // italic alt
    .replace(/`(.+?)`/g, "$1")             // inline code
    .replace(/```[\s\S]*?```/g, "")        // fenced code blocks
    .replace(/^\s*[-*+]\s+/gm, "- ")       // normalize list markers
    .replace(/^\s*\d+\.\s+/gm, "")         // numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/\n{3,}/g, "\n\n")            // collapse blank lines
    .trim();
}

/**
 * Send the agent's actual reply back via SMS.
 */
export async function sendSmsReply(
  toPhone: string,
  fromPhone: string,
  body: string,
): Promise<string | null> {
  const smsScript = path.join(
    os.homedir(),
    ".openclaw",
    "workspace",
    "scripts",
    "twilio-sms.js",
  );

  if (!fs.existsSync(smsScript)) return null;

  // Strip markdown and truncate to SMS-friendly length
  const cleaned = stripMarkdown(body);
  const truncated = cleaned.length > 1500
    ? cleaned.slice(0, 1497) + "..."
    : cleaned;

  return new Promise((resolve) => {
    execFile(
      "node",
      [smsScript, "--to", toPhone, "--from", fromPhone, "--body", truncated],
      { timeout: 30000 },
      (err, stdout) => {
        if (err) {
          console.error("[sms-inbox] reply send failed:", err.message);
          resolve(null);
          return;
        }
        const match = stdout.match(/SMS created:\s*(SM\w+)/);
        resolve(match ? match[1] : null);
      },
    );
  });
}

/**
 * Check if text is just a tool call preamble with no real content for the user.
 * e.g. "Let me query that information." followed only by XML tool calls.
 */
function isToolCallPreambleOnly(text: string): boolean {
  // Strip any tool call XML
  const stripped = text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/g, "")
    .replace(/<\/?tool_call>/g, "")
    .replace(/<\/?(?:parameter|function|tool_use|tool_result)[^>]*>/g, "")
    .trim();
  // If nothing left, or just a short "let me..." intro, skip it
  if (!stripped) return true;
  if (stripped.length < 80 && /^(let me|i'll|i will|one moment|checking|looking|querying)/i.test(stripped)) {
    return true;
  }
  return false;
}

/**
 * Extract the last assistant text from an agent's message history.
 * Skips messages that are just tool call preamble (no actual answer).
 */
export function extractLastAssistantText(messages: unknown[]): string | null {
  if (!Array.isArray(messages)) return null;

  // Walk backwards to find the last assistant message with real content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg?.role !== "assistant") continue;

    const content = msg.content;
    let text: string | null = null;

    if (typeof content === "string" && content.trim()) {
      text = content.trim();
    }
    // Handle array content blocks (pi-ai / Anthropic format)
    if (!text && Array.isArray(content)) {
      const textParts: string[] = [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b?.type === "text" && typeof b.text === "string") {
          textParts.push(b.text);
        }
      }
      const joined = textParts.join("\n").trim();
      if (joined) text = joined;
    }

    if (text && !isToolCallPreambleOnly(text)) return text;
    // If this message was just tool preamble, keep looking backwards
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core Inbox Operations
// ---------------------------------------------------------------------------

export type SmsInboxDoc = {
  from: string;
  to: string;
  body: string;
  agentId: string;
  sessionKey: string;
  status: "received" | "processing" | "replied" | "failed" | "escalated";
  receivedAt: string;
  lastAttemptAt: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  lastError: string;
  ackSent: boolean;
  ackMessageSid: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Log an inbound SMS to Firestore.  Returns the doc ID on first write,
 * or null if this sessionKey was already logged (dedup — the hook fires
 * in both gateway and plugin contexts).
 */
export async function logInboundSms(params: {
  from: string;
  to: string;
  body: string;
  agentId: string;
  sessionKey: string;
  messageSid?: string;
}): Promise<string | null> {
  const db = await getDb();
  const now = new Date().toISOString();

  // Deterministic doc ID: prefer messageSid, fall back to sessionKey-based hash.
  // This ensures both hook contexts (gateway + plugins) write the same doc.
  const docId = params.messageSid || `sk-${params.sessionKey.replace(/[\/]/g, "_")}`;
  const data: Omit<SmsInboxDoc, "ackMessageSid"> & { ackMessageSid: string } = {
    from: params.from,
    to: params.to,
    body: params.body,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    status: "received",
    receivedAt: now,
    lastAttemptAt: now,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    nextRetryAt: "",
    lastError: "",
    ackSent: false,
    ackMessageSid: "",
    createdAt: now,
    updatedAt: now,
  };

  const col = db.collection("smsInbox");
  const existing = await col.doc(docId).get();
  if (existing.exists) return null; // Already logged by other context
  await col.doc(docId).set(data);
  return docId;
}

/**
 * Send a lightweight auto-ack SMS (no AI needed).
 */
export async function sendAutoAck(
  toPhone: string,
  fromPhone: string,
  agentId: string,
): Promise<string | null> {
  const agentName = AGENT_NAMES[agentId] || "Our team";
  const body = `Thanks for your message! ${agentName} will get back to you shortly. - EDP Realty`;

  const smsScript = path.join(
    os.homedir(),
    ".openclaw",
    "workspace",
    "scripts",
    "twilio-sms.js",
  );

  if (!fs.existsSync(smsScript)) return null;

  return new Promise((resolve) => {
    execFile(
      "node",
      [smsScript, "--to", toPhone, "--from", fromPhone, "--body", body],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) {
          console.error("[sms-inbox] auto-ack send failed:", err.message);
          resolve(null);
          return;
        }
        // Extract message SID from output
        const match = stdout.match(/SMS created:\s*(SM\w+)/);
        resolve(match ? match[1] : null);
      },
    );
  });
}

/**
 * Update auto-ack status on the inbox doc.
 */
export async function markAckSent(docId: string, ackSid: string): Promise<void> {
  const db = await getDb();
  await db.collection("smsInbox").doc(docId).update({
    ackSent: true,
    ackMessageSid: ackSid,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Mark a message as processing (agent session started).
 */
export async function markProcessing(sessionKey: string): Promise<void> {
  const doc = await findBySessionKey(sessionKey);
  if (!doc) return;
  const db = await getDb();
  await db.collection("smsInbox").doc(doc.id).update({
    status: "processing",
    lastAttemptAt: new Date().toISOString(),
    attempts: (doc.data()?.attempts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Mark a message as replied (agent completed successfully).
 */
export async function markReplied(sessionKey: string): Promise<void> {
  const doc = await findBySessionKey(sessionKey);
  if (!doc) return;
  const db = await getDb();
  await db.collection("smsInbox").doc(doc.id).update({
    status: "replied",
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Mark a message as failed (agent errored).
 */
export async function markFailed(sessionKey: string, error: string): Promise<void> {
  const doc = await findBySessionKey(sessionKey);
  if (!doc) return;
  const data = doc.data() as SmsInboxDoc;
  const attempt = (data.attempts ?? 0);
  const db = await getDb();

  if (attempt >= MAX_ATTEMPTS) {
    await db.collection("smsInbox").doc(doc.id).update({
      status: "escalated",
      lastError: error,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  await db.collection("smsInbox").doc(doc.id).update({
    status: "failed",
    lastError: error,
    nextRetryAt: nextRetryAt(attempt),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Find an inbox doc by session key (most recent non-replied).
 */
async function findBySessionKey(
  sessionKey: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  // The gateway prepends "agent:main:" to session keys — normalize
  const normalized = sessionKey.replace(/^agent:main:/, "");
  const db = await getDb();
  const snap = await db
    .collection("smsInbox")
    .where("sessionKey", "==", normalized)
    .where("status", "in", ["received", "processing", "failed"])
    .limit(1)
    .get();

  return snap.empty ? null : snap.docs[0];
}

// ---------------------------------------------------------------------------
// Retry Queue
// ---------------------------------------------------------------------------

export type RetryCandidate = {
  docId: string;
  from: string;
  to: string;
  body: string;
  agentId: string;
  attempts: number;
};

/**
 * Get messages that are ready for retry.
 */
export async function getRetryQueue(limit = 5): Promise<RetryCandidate[]> {
  const db = await getDb();
  const now = new Date().toISOString();
  const snap = await db
    .collection("smsInbox")
    .where("status", "==", "failed")
    .where("nextRetryAt", "<=", now)
    .limit(limit)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      docId: d.id,
      from: data.from,
      to: data.to,
      body: data.body,
      agentId: data.agentId,
      attempts: data.attempts ?? 0,
    };
  });
}

/**
 * Replay a message by POSTing to the local gateway webhook.
 */
export async function replayMessage(
  msg: RetryCandidate,
  port: number,
  hooksToken: string,
): Promise<boolean> {
  const url = `http://127.0.0.1:${port}/hooks/twilio/sms/${msg.agentId}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${hooksToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: msg.from,
        To: msg.to,
        Body: msg.body,
        MessageSid: `retry-${msg.docId}-${msg.attempts}`,
        AccountSid: "retry",
      }),
    });
    return resp.ok;
  } catch (err) {
    console.error("[sms-inbox] replay failed:", err);
    return false;
  }
}

/**
 * Mark a retry doc as processing (bump attempts, update session key).
 */
export async function markRetryProcessing(
  docId: string,
  sessionKey: string,
): Promise<void> {
  const db = await getDb();
  const doc = await db.collection("smsInbox").doc(docId).get();
  if (!doc.exists) return;
  const data = doc.data() as SmsInboxDoc;
  await db.collection("smsInbox").doc(docId).update({
    status: "processing",
    sessionKey,
    lastAttemptAt: new Date().toISOString(),
    attempts: (data.attempts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Media Processing (Twilio MMS → Firebase Cloud Storage)
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/3gpp": ".3gp",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/amr": ".amr",
  "application/pdf": ".pdf",
  "text/vcard": ".vcf",
  "text/x-vcard": ".vcf",
};

let storageBucket: any = null;

async function getStorageBucket() {
  if (storageBucket) return storageBucket;
  const admin = await import("firebase-admin");

  // Reuse the existing admin app or create one
  if (!adminApp) {
    const credential = admin.credential.cert(parseServiceAccount());
    adminApp = admin.initializeApp({ credential }, "mc-sms-inbox");
  }

  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || "edp-invoicing.firebasestorage.app";
  storageBucket = admin.storage(adminApp).bucket(bucketName);
  return storageBucket;
}

export type MediaItem = {
  url: string;
  contentType: string;
  index: number;
};

/**
 * Download media from Twilio and upload to Firebase Cloud Storage.
 * Returns permanent URLs and storage paths for each item.
 */
export async function processMediaAttachments(
  messageSid: string,
  mediaItems: MediaItem[],
): Promise<SmsMediaEntry[]> {
  if (!mediaItems || mediaItems.length === 0) return [];

  const accountSid = process.env.TWILIO_ACCOUNT_SID || readTwilioCredential("twilio_account_sid");
  const authToken = process.env.TWILIO_AUTH_TOKEN || readTwilioCredential("twilio_auth_token");

  const results: SmsMediaEntry[] = [];

  for (const item of mediaItems) {
    try {
      // Download from Twilio (requires Basic Auth)
      const resp = await fetch(item.url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
        redirect: "follow",
      });

      if (!resp.ok) {
        console.error(`[sms-media] download failed for ${item.url}: ${resp.status}`);
        continue;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      const ext = MIME_TO_EXT[item.contentType] || ".bin";
      const storagePath = `sms-media/${messageSid}/${item.index}${ext}`;

      // Upload to GCS
      const bucket = await getStorageBucket();
      const file = bucket.file(storagePath);
      await file.save(buffer, {
        metadata: {
          contentType: item.contentType,
          metadata: { messageSid, originalUrl: item.url },
        },
      });
      await file.makePublic();

      const permanentUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
      results.push({
        originalUrl: item.url,
        contentType: item.contentType,
        storagePath,
        permanentUrl,
      });

      console.log(`[sms-media] uploaded ${storagePath} (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`[sms-media] error processing media item ${item.index}:`, err);
    }
  }

  return results;
}

function readTwilioCredential(name: string): string {
  const envKey = name.toUpperCase();
  if (process.env[envKey]) return process.env[envKey]!.trim();
  const secretPath = path.join(os.homedir(), ".openclaw", "workspace", "secrets", name.toLowerCase());
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  return "";
}

// ---------------------------------------------------------------------------
// Inbox Query (for RPC methods)
// ---------------------------------------------------------------------------

export async function listInbox(params?: {
  status?: string;
  agentId?: string;
  limit?: number;
}): Promise<SmsInboxDoc[]> {
  const db = await getDb();
  let query: FirebaseFirestore.Query = db.collection("smsInbox");

  if (params?.status) {
    query = query.where("status", "==", params.status);
  }
  if (params?.agentId) {
    query = query.where("agentId", "==", params.agentId);
  }
  query = query.orderBy("receivedAt", "desc").limit(params?.limit ?? 50);

  const snap = await query.get();
  return snap.docs.map((d) => ({ ...d.data(), _id: d.id }) as any);
}

export async function getInboxStats(): Promise<Record<string, number>> {
  const db = await getDb();
  const statuses = ["received", "processing", "replied", "failed", "escalated"];
  const counts: Record<string, number> = {};

  for (const status of statuses) {
    const snap = await db
      .collection("smsInbox")
      .where("status", "==", status)
      .count()
      .get();
    counts[status] = snap.data().count;
  }

  return counts;
}
