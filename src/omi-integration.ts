/**
 * Omi wearable integration for Mission Control.
 *
 * Handles four omi webhook types:
 *  - realtime_transcript → trigger phrase detection → agent activation
 *  - memory_created      → task creation, CRM activity logging, speaker learning
 *  - day_summary         → Jarvis daily debrief
 *  - audio_bytes         → voice sample buffering for future speaker fingerprinting
 *
 * Speaker learning:
 *  Omi diarizes speakers as SPEAKER_00, SPEAKER_01 etc. This module maintains
 *  an `omiSpeakers` Firestore collection mapping numeric speaker IDs to MC CRM
 *  person IDs. Unknown speakers generate a "Label speakers" review task.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTask } from "./task-engine.js";
import { createContactActivity } from "./contact-activity-store.js";
import { getEdpFirestore } from "./firestore-sms.js";
import type { PluginRuntime } from "openclaw/plugin-sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OmiTranscriptSegment {
  id?: string;
  text: string;
  speaker: string;
  speaker_id?: number;
  speaker_name?: string;
  is_user?: boolean;
  person_id?: string;
  start?: number;
  end?: number;
  stt_provider?: string;
}

export interface OmiStructured {
  title?: string;
  overview?: string;
  emoji?: string;
  category?: string;
  action_items?: Array<{ text?: string; description?: string; completed?: boolean }>;
  events?: unknown[];
}

export interface OmiConversation {
  id: string;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  structured?: OmiStructured;
  transcript_segments?: OmiTranscriptSegment[];
  status?: string;
  visibility?: string;
  uid?: string;
}

export interface OmiRealtimePayload {
  conversation_id?: string;
  segments?: OmiTranscriptSegment[];
  text?: string;
  speaker?: string;
  speaker_id?: number;
  is_user?: boolean;
}

export interface OmiDaySummary {
  date?: string;
  summary?: string;
  uid?: string;
}

// ── Module-level state ────────────────────────────────────────────────────────

let runtime: PluginRuntime | null = null;
let log = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
};

// Realtime transcript buffers: conversationId → accumulated text
const transcriptBuffers = new Map<string, string>();
// Conversations where a trigger has already fired (dedup)
const firedTriggers = new Set<string>();

export function setOmiRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function setOmiLogger(l: { info: (msg: string) => void; warn: (msg: string) => void }): void {
  log = l;
}

// ── Speaker learning ──────────────────────────────────────────────────────────

export interface OmiSpeakerRecord {
  omiSpeakerId: number;
  personId: string;
  personName: string;
  confirmedAt: number;
  conversationCount: number;
  createdAt: number;
  updatedAt: number;
}

async function lookupSpeaker(omiSpeakerId: number): Promise<OmiSpeakerRecord | null> {
  try {
    const db = await getEdpFirestore();
    const snap = await db.collection("omiSpeakers")
      .where("omiSpeakerId", "==", omiSpeakerId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    return snap.docs[0].data() as OmiSpeakerRecord;
  } catch (err) {
    log.warn(`[omi] lookupSpeaker failed: ${err}`);
    return null;
  }
}

/**
 * Persist a speaker → CRM contact mapping.
 * Called when user identifies an unknown speaker (via MC task resolution or agent).
 */
export async function saveSpeakerMapping(
  omiSpeakerId: number,
  personId: string,
  personName: string,
): Promise<void> {
  try {
    const db = await getEdpFirestore();
    const col = db.collection("omiSpeakers");
    const existing = await col.where("omiSpeakerId", "==", omiSpeakerId).limit(1).get();
    const now = Date.now();

    if (!existing.empty) {
      await existing.docs[0].ref.update({
        personId,
        personName,
        confirmedAt: now,
        conversationCount: (existing.docs[0].data().conversationCount ?? 0) + 1,
        updatedAt: now,
      });
    } else {
      await col.add({
        omiSpeakerId,
        personId,
        personName,
        confirmedAt: now,
        conversationCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    log.info(`[omi] speaker ${omiSpeakerId} mapped to ${personName} (${personId})`);
  } catch (err) {
    log.warn(`[omi] saveSpeakerMapping failed: ${err}`);
  }
}

export async function listSpeakerMappings(): Promise<OmiSpeakerRecord[]> {
  try {
    const db = await getEdpFirestore();
    const snap = await db.collection("omiSpeakers").orderBy("conversationCount", "desc").get();
    return snap.docs.map(d => d.data() as OmiSpeakerRecord);
  } catch (err) {
    log.warn(`[omi] listSpeakerMappings failed: ${err}`);
    return [];
  }
}

// ── Conversation routing ──────────────────────────────────────────────────────

const PROPERTY_KEYWORDS = [
  "maintenance", "repair", "tenant", "lease", "rent", "unit", "property",
  "landlord", "inspection", "hvac", "plumbing", "electrical", "roof",
  "move-in", "move-out", "move in", "move out",
];

const SALES_KEYWORDS = [
  "buyer", "seller", "listing", "offer", "commission", "closing",
  "showing", "lead", "prospect", "realtor",
];

function routeConversation(conversation: OmiConversation): string {
  const combined = [
    conversation.structured?.title ?? "",
    conversation.structured?.overview ?? "",
    (conversation.transcript_segments ?? []).map(s => s.text).join(" "),
  ].join(" ").toLowerCase();

  if (PROPERTY_KEYWORDS.some(kw => combined.includes(kw))) return "pierce";
  if (SALES_KEYWORDS.some(kw => combined.includes(kw))) return "lindsey";
  return "main";
}

// ── Trigger phrase detection ──────────────────────────────────────────────────

interface TriggerDef {
  patterns: RegExp[];
  agentId: string;
}

const TRIGGER_DEFS: TriggerDef[] = [
  { patterns: [/\b(?:hey\s+)?jarvis\b/i], agentId: "main" },
  { patterns: [/\b(?:hey\s+)?pierce\b/i], agentId: "pierce" },
  { patterns: [/\b(?:hey\s+)?lindsey\b/i], agentId: "lindsey" },
  { patterns: [/\b(?:hey\s+)?brett\b/i], agentId: "brett" },
  { patterns: [/\b(?:hey\s+)?kimberly\b/i], agentId: "kimberly" },
  { patterns: [/\b(?:hey\s+)?becky\b/i], agentId: "becky" },
  { patterns: [/\b(?:hey\s+)?william\b/i], agentId: "william" },
];

function detectTrigger(text: string): { agentId: string; intent: string } | null {
  for (const def of TRIGGER_DEFS) {
    for (const pattern of def.patterns) {
      const match = pattern.exec(text);
      if (match) {
        const intent = text.slice((match.index ?? 0) + match[0].length).trim();
        return { agentId: def.agentId, intent: intent || text.trim() };
      }
    }
  }
  return null;
}

// ── Realtime transcript handler ───────────────────────────────────────────────

export async function handleOmiTranscript(payload: OmiRealtimePayload): Promise<void> {
  if (!runtime) return;

  const convId = payload.conversation_id ?? "unknown";

  const newText = payload.segments
    ? payload.segments.map(s => s.text).join(" ")
    : (payload.text ?? "");

  if (!newText.trim()) return;

  const existing = transcriptBuffers.get(convId) ?? "";
  const updated = (existing + " " + newText).trim();
  transcriptBuffers.set(convId, updated);

  if (firedTriggers.has(convId)) return;

  const trigger = detectTrigger(updated);
  if (!trigger) return;

  firedTriggers.add(convId);
  log.info(`[omi] trigger → "${trigger.agentId}" (conv: ${convId})`);

  const sessionKey = `${trigger.agentId}:omi-trigger-${convId}`;
  const message = `[Omi voice trigger] ${trigger.intent}`;

  try {
    await runtime.subagent.run({ sessionKey, message });
  } catch (err) {
    log.warn(`[omi] trigger agent start failed: ${err}`);
  }
}

// ── memory_created handler ────────────────────────────────────────────────────

export async function handleOmiMemoryCreated(conversation: OmiConversation): Promise<void> {
  if (!conversation.id) return;

  const title = conversation.structured?.title ?? "Untitled conversation";
  const overview = conversation.structured?.overview ?? "";
  const category = conversation.structured?.category ?? "other";
  const actionItems = conversation.structured?.action_items ?? [];
  const segments = conversation.transcript_segments ?? [];

  log.info(`[omi] memory_created: "${title}" (${conversation.id})`);

  // Clean up realtime buffers for this conversation
  transcriptBuffers.delete(conversation.id);
  firedTriggers.delete(conversation.id);

  const agentId = routeConversation(conversation);

  // 1. Create MC tasks for each extracted action item
  for (const item of actionItems) {
    const itemText = (item.text ?? item.description ?? "").trim();
    if (!itemText) continue;
    try {
      createTask({
        title: itemText,
        agentId,
        description: `**Source:** Omi wearable conversation\n**Conversation:** ${title}\n\n${overview}\n\n**Conversation ID:** ${conversation.id}`,
        priority: "normal",
        tags: ["source:omi", `omi-conv:${conversation.id}`, category],
      });
      log.info(`[omi] task created: "${itemText}" → ${agentId}`);
    } catch (err) {
      log.warn(`[omi] task creation failed: ${err}`);
    }
  }

  // 2. Identify speakers (async Firestore lookups in parallel)
  const uniqueSpeakerIds = [
    ...new Set(
      segments
        .map(s => s.speaker_id)
        .filter((id): id is number => id != null),
    ),
  ];

  const lookupResults = await Promise.all(
    uniqueSpeakerIds.map(async id => ({ id, record: await lookupSpeaker(id) })),
  );

  const knownSpeakers = new Map<number, OmiSpeakerRecord>();
  const unknownSpeakerIds: number[] = [];

  for (const { id, record } of lookupResults) {
    // Check if omi already matched via its own person database
    const seg = segments.find(s => s.speaker_id === id);
    if (seg?.person_id) {
      knownSpeakers.set(id, {
        omiSpeakerId: id,
        personId: seg.person_id,
        personName: seg.speaker_name ?? `SPEAKER_${id}`,
        confirmedAt: Date.now(),
        conversationCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } else if (record) {
      knownSpeakers.set(id, record);
    } else {
      unknownSpeakerIds.push(id);
    }
  }

  // 3. Log CRM activity for known contacts
  const conversationTs = conversation.started_at
    ? new Date(conversation.started_at).getTime()
    : Date.now();

  for (const [, speaker] of knownSpeakers) {
    if (speaker.personId === "self") continue;
    try {
      createContactActivity({
        personId: speaker.personId,
        channel: "call",
        direction: "inbound",
        timestamp: conversationTs,
        status: "completed",
        summary: `[Omi] ${title}${overview ? `: ${overview}` : ""}`,
        providerId: conversation.id,
        providerName: "omi",
        metadataJson: JSON.stringify({ category, conversationId: conversation.id }),
      });
      log.info(`[omi] activity logged for ${speaker.personName} (${speaker.personId})`);
    } catch (err) {
      log.warn(`[omi] activity log failed: ${err}`);
    }
  }

  // 4. Create speaker labeling task for unknown speakers
  if (unknownSpeakerIds.length > 0) {
    const transcriptPreview = segments
      .slice(0, 20)
      .map(s => `**${s.speaker_name ?? s.speaker}:** ${s.text}`)
      .join("\n");

    const speakerList = unknownSpeakerIds
      .map(id => `SPEAKER_${String(id).padStart(2, "0")}`)
      .join(", ");

    try {
      createTask({
        title: `Identify speakers from: "${title}"`,
        agentId: "main",
        description: [
          `Omi captured a conversation with speakers that haven't been linked to CRM contacts yet.`,
          ``,
          `**Conversation:** ${title}`,
          overview ? `**Overview:** ${overview}` : "",
          `**Unknown speakers:** ${speakerList}`,
          `**Conversation ID:** ${conversation.id}`,
          ``,
          `To link a speaker, call \`saveSpeakerMapping(speakerId, personId, personName)\` or use the mc.omi.saveSpeaker gateway method.`,
          ``,
          `**Transcript (first 20 lines):**`,
          transcriptPreview,
        ].filter(Boolean).join("\n"),
        priority: "low",
        taskType: "manual",
        executionMode: "human",
        tags: ["source:omi", "speaker-labeling", `omi-conv:${conversation.id}`],
      });
      log.info(`[omi] speaker labeling task created for ${unknownSpeakerIds.length} unknown speaker(s)`);
    } catch (err) {
      log.warn(`[omi] speaker labeling task creation failed: ${err}`);
    }
  }

  // 5. Start agent session for deeper processing when there's content worth reviewing
  const hasContent = actionItems.length > 0 || knownSpeakers.size > 0 || segments.length > 5;
  if (runtime && hasContent) {
    const sessionKey = `${agentId}:omi-conv-${conversation.id}`;

    const speakerIndex = Array.from(knownSpeakers.values())
      .map(s => `  SPEAKER_${String(s.omiSpeakerId).padStart(2, "0")} = ${s.personName} (CRM ID: ${s.personId})`)
      .join("\n");

    const transcriptFull = segments
      .map(s => `${s.speaker_name ?? s.speaker}: ${s.text}`)
      .join("\n");

    const message = [
      `[Omi wearable] New conversation captured and ready for review.`,
      ``,
      `**Title:** ${title}`,
      overview ? `**Overview:** ${overview}` : "",
      `**Category:** ${category}`,
      speakerIndex ? `**Identified speakers:**\n${speakerIndex}` : "",
      unknownSpeakerIds.length > 0
        ? `**Unknown speakers:** ${unknownSpeakerIds.map(id => `SPEAKER_${String(id).padStart(2, "0")}`).join(", ")} — a labeling task has been created.`
        : "",
      actionItems.length > 0
        ? `**Action items (${actionItems.length}):** tasks created in Mission Control.`
        : "",
      ``,
      `Please update any relevant CRM records or create additional follow-up tasks as needed.`,
      ``,
      `**Full transcript:**`,
      transcriptFull,
    ].filter(Boolean).join("\n");

    try {
      await runtime.subagent.run({ sessionKey, message });
    } catch (err) {
      log.warn(`[omi] processing session start failed: ${err}`);
    }
  }
}

// ── day_summary handler ───────────────────────────────────────────────────────

export async function handleOmiDaySummary(summary: OmiDaySummary): Promise<void> {
  if (!runtime) return;
  if (!summary.summary) return;

  const date = summary.date ?? new Date().toISOString().slice(0, 10);
  log.info(`[omi] day_summary received for ${date}`);

  const sessionKey = `main:omi-daily-${date}`;
  const message = [
    `[Omi wearable] Daily summary for ${date}:`,
    ``,
    summary.summary,
    ``,
    `Please review this day's activity and provide a briefing covering: what was accomplished, open tasks, upcoming deadlines, and any follow-ups needed.`,
  ].join("\n");

  try {
    await runtime.subagent.run({ sessionKey, message });
  } catch (err) {
    log.warn(`[omi] day summary session start failed: ${err}`);
  }
}

// ── audio_bytes handler ───────────────────────────────────────────────────────
// Omi sends raw audio chunks every N seconds (configured in app).
// We buffer them to disk per uid so they can be used for voice fingerprinting
// once a voice recognition pipeline is added.

const AUDIO_BUFFER_DIR = path.join(os.homedir(), ".openclaw", "workspace", "mission-control", "omi-audio");

// In-memory write streams: uid → WriteStream
const audioStreams = new Map<string, fs.WriteStream>();
// Timestamps of last chunk per uid — streams idle >30s are closed
const audioLastSeen = new Map<string, number>();

function getAudioStream(uid: string, sampleRate: number): fs.WriteStream {
  const existing = audioStreams.get(uid);
  if (existing) return existing;

  fs.mkdirSync(AUDIO_BUFFER_DIR, { recursive: true });
  const filename = `${uid}_${sampleRate}hz_${Date.now()}.pcm`;
  const stream = fs.createWriteStream(path.join(AUDIO_BUFFER_DIR, filename), { flags: "a" });
  audioStreams.set(uid, stream);
  log.info(`[omi-audio] opened buffer for uid ${uid} @ ${sampleRate}Hz → ${filename}`);
  return stream;
}

function closeIdleAudioStreams(): void {
  const now = Date.now();
  for (const [uid, lastSeen] of audioLastSeen.entries()) {
    if (now - lastSeen > 30_000) {
      audioStreams.get(uid)?.end();
      audioStreams.delete(uid);
      audioLastSeen.delete(uid);
      log.info(`[omi-audio] closed idle stream for uid ${uid}`);
    }
  }
}

// Sweep idle streams every 30 seconds
setInterval(closeIdleAudioStreams, 30_000).unref();

export function handleOmiAudioBytes(chunk: Buffer, uid: string, sampleRate: number): void {
  if (!chunk.length) return;
  audioLastSeen.set(uid, Date.now());
  const stream = getAudioStream(uid, sampleRate);
  stream.write(chunk);
}
