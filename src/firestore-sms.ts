import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let adminApp: any = null;

const SA_SEARCH_PATHS = [
  path.join(os.homedir(), ".config", "openclaw", "edp-firebase-sa.json"),
  path.join(os.homedir(), ".openclaw", "secrets", "edp-firebase-sa.json"),
];

function parseServiceAccount(): any {
  const fromPath = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_PATH;
  if (fromPath) return JSON.parse(fs.readFileSync(fromPath, "utf8"));

  const raw = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_JSON || process.env.ADMIN_SERVICE_ACCOUNT;
  if (raw) {
    try {
      if (raw.trim().startsWith("{")) return JSON.parse(raw);
    } catch {}
    return JSON.parse(raw);
  }

  // Fallback: check well-known file paths
  for (const p of SA_SEARCH_PATHS) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}
  }

  throw new Error("Missing Firebase service account credentials");
}

async function getDb() {
  const admin = await import("firebase-admin");
  if (!adminApp) {
    const credential = admin.credential.cert(parseServiceAccount());
    adminApp = admin.initializeApp({ credential }, "mc-sms-reader");
  }
  return admin.firestore(adminApp);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export type SmsMediaEntry = {
  originalUrl: string;
  contentType: string;
  storagePath: string;
  permanentUrl: string;
};

export type SmsLogEntry = {
  direction: "inbound" | "outbound";
  body: string;
  from: string;
  to: string;
  timestamp: string;
  messageSid?: string;
  variantName?: string;
  agentId?: string;
  numMedia?: number;
  media?: SmsMediaEntry[];
};

/**
 * Write an SMS log entry to the twilioSmsLogs collection.
 * Uses messageSid as doc ID for dedup when available.
 */
export async function logSmsToTwilioLogs(entry: SmsLogEntry): Promise<string> {
  const db = await getDb();
  const col = db.collection("twilioSmsLogs");
  const data = {
    ...entry,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  if (entry.messageSid) {
    await col.doc(entry.messageSid).set(data, { merge: true });
    return entry.messageSid;
  }

  const ref = await col.add(data);
  return ref.id;
}

export async function fetchSmsHistory(
  rawPhones: string[],
  limit = 200,
): Promise<SmsLogEntry[]> {
  const phones = [...new Set(rawPhones.map(normalizePhone))];
  if (phones.length === 0) return [];

  const db = await getDb();
  const col = db.collection("twilioSmsLogs");

  // Query without orderBy to avoid needing composite indexes; sort in-memory instead
  const [inboundSnap, outboundSnap] = await Promise.all([
    col.where("from", "in", phones).limit(limit).get(),
    col.where("to", "in", phones).limit(limit).get(),
  ]);

  const seen = new Set<string>();
  const messages: SmsLogEntry[] = [];

  for (const doc of [...inboundSnap.docs, ...outboundSnap.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const d = doc.data();
    messages.push({
      direction: d.direction === "outbound" ? "outbound" : "inbound",
      body: d.body ?? "",
      from: d.from ?? "",
      to: d.to ?? "",
      timestamp: d.timestamp ?? "",
      messageSid: d.messageSid,
      variantName: d.variantName,
      agentId: d.agentId,
      numMedia: d.numMedia,
      media: d.media,
    });
  }

  // Sort chronological (oldest first) for chat display
  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return messages;
}
