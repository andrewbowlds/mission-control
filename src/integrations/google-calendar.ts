import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { getMcDb } from "../mc-db.js";
import {
  getIntegrationByType,
  createIntegration,
  markConnected,
  markError,
  markSynced,
  updateIntegration,
} from "./framework.js";
import type { CalendarEvent } from "../types.js";

// ── Token Store (separate from contacts) ─────────────────────────────────────

type GCalTokenStore = {
  connectedAt?: number;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountEmail?: string;
  pendingState?: string;
  pendingStateExpiresAt?: number;
};

const GCAL_SCOPE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

function getStoreDir(): string {
  const dir = path.join(os.homedir(), ".openclaw", "workspace", "mission-control");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getStoreDir(), "google-calendar-oauth.json");
}

function readStore(): GCalTokenStore {
  const p = getStorePath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as GCalTokenStore; } catch { return {}; }
}

function writeStore(store: GCalTokenStore): void {
  const p = getStorePath();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(p, 0o600);
}

function getOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const rawUri = process.env.GOOGLE_REDIRECT_URI?.trim() || process.env.REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !rawUri) return null;
  // Reuse the same /api/google/callback redirect URI registered in Google Console
  return { clientId, clientSecret, redirectUri: rawUri };
}

function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

// ── Connection Status ────────────────────────────────────────────────────────

export function getCalendarConnectionStatus(): { connected: boolean; accountEmail?: string; expiresAt?: number } {
  const store = readStore();
  if (!store.refreshToken && !store.accessToken) return { connected: false };
  return { connected: true, accountEmail: store.accountEmail, expiresAt: store.expiresAt };
}

// ── OAuth Flow ───────────────────────────────────────────────────────────────

export function createCalendarOAuthUrl(): { url: string } {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");

  const nonce = randomUUID();
  const state = `gcal:${nonce}`;
  const store = readStore();
  store.pendingState = state;
  store.pendingStateExpiresAt = Date.now() + 10 * 60 * 1000;
  writeStore(store);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", cfg.clientId);
  authUrl.searchParams.set("redirect_uri", cfg.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GCAL_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return { url: authUrl.toString() };
}

export async function handleCalendarOAuthCallback(code: string, state: string): Promise<void> {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("Google OAuth is not configured.");

  const store = readStore();
  if (!store.pendingState || store.pendingState !== state || (store.pendingStateExpiresAt ?? 0) < Date.now()) {
    throw new Error("Invalid or expired OAuth state.");
  }

  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenRes.ok) {
    const details = await tokenRes.text().catch(() => "");
    throw new Error(`Token exchange failed (${tokenRes.status}): ${details.slice(0, 240)}`);
  }

  const token = (await tokenRes.json()) as any;
  const idPayload = decodeJwtPayload(token.id_token);

  const next: GCalTokenStore = {
    connectedAt: Date.now(),
    accessToken: token.access_token,
    refreshToken: token.refresh_token || store.refreshToken,
    expiresAt: Date.now() + Math.max(1, token.expires_in || 0) * 1000,
    accountEmail: typeof idPayload.email === "string" ? idPayload.email : store.accountEmail,
  };
  writeStore(next);

  // Ensure integration record exists
  let integration = getIntegrationByType("google_calendar");
  if (!integration) {
    integration = createIntegration({
      type: "google_calendar",
      label: next.accountEmail ?? "Google Calendar",
    });
  }
  markConnected(integration.id);
}

export function disconnectCalendar(): void {
  writeStore({});
  const integration = getIntegrationByType("google_calendar");
  if (integration) {
    updateIntegration(integration.id, { status: "disconnected" });
  }
}

// ── Access Token ─────────────────────────────────────────────────────────────

async function refreshAccessToken(store: GCalTokenStore): Promise<GCalTokenStore> {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("Google OAuth is not configured.");
  if (!store.refreshToken) throw new Error("Google refresh token is missing.");

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: store.refreshToken,
    grant_type: "refresh_token",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!tokenRes.ok) {
    const details = await tokenRes.text().catch(() => "");
    throw new Error(`Token refresh failed (${tokenRes.status}): ${details.slice(0, 180)}`);
  }

  const token = (await tokenRes.json()) as any;
  const next: GCalTokenStore = {
    ...store,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || store.refreshToken,
    expiresAt: Date.now() + Math.max(1, token.expires_in || 0) * 1000,
  };
  writeStore(next);
  return next;
}

async function getAccessToken(): Promise<string | null> {
  const store = readStore();
  if (!store.accessToken && !store.refreshToken) return null;
  const earlyRefreshAt = (store.expiresAt ?? 0) - 30_000;
  if (store.accessToken && Date.now() < earlyRefreshAt) return store.accessToken;
  if (store.refreshToken) {
    const refreshed = await refreshAccessToken(store);
    return refreshed.accessToken ?? null;
  }
  return store.accessToken ?? null;
}

// ── Row Mapping ──────────────────────────────────────────────────────────────

function rowToEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    integrationId: row.integration_id,
    externalId: row.external_id,
    title: row.title,
    description: row.description ?? undefined,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: Boolean(row.all_day),
    location: row.location ?? undefined,
    taskId: row.task_id ?? undefined,
    status: row.status ?? "confirmed",
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncCalendarEvents(opts?: { timeMin?: string; timeMax?: string }): Promise<{ synced: number }> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not connected to Google Calendar.");

  const integration = getIntegrationByType("google_calendar");
  if (!integration) throw new Error("No Google Calendar integration found.");

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "250");
  if (opts?.timeMin) url.searchParams.set("timeMin", opts.timeMin);
  else url.searchParams.set("timeMin", new Date(Date.now() - 7 * 86400000).toISOString());
  if (opts?.timeMax) url.searchParams.set("timeMax", opts.timeMax);
  else url.searchParams.set("timeMax", new Date(Date.now() + 30 * 86400000).toISOString());

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    markError(integration.id, `Sync failed (${res.status})`);
    throw new Error(`Calendar API failed (${res.status}): ${details.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const items: any[] = data.items ?? [];

  const db = getMcDb();
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO calendar_events (id, integration_id, external_id, title, description, start_at, end_at, all_day, location, status, raw_json, synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(integration_id, external_id) DO UPDATE SET
      title = excluded.title, description = excluded.description, start_at = excluded.start_at,
      end_at = excluded.end_at, all_day = excluded.all_day, location = excluded.location,
      status = excluded.status, raw_json = excluded.raw_json, synced_at = excluded.synced_at, updated_at = excluded.updated_at
  `);

  let synced = 0;
  for (const item of items) {
    const externalId = item.id;
    if (!externalId) continue;

    const isAllDay = !!item.start?.date;
    const startAt = isAllDay ? new Date(item.start.date).getTime() : new Date(item.start?.dateTime).getTime();
    const endAt = isAllDay ? new Date(item.end.date).getTime() : new Date(item.end?.dateTime).getTime();
    if (isNaN(startAt) || isNaN(endAt)) continue;

    const status = item.status === "tentative" ? "tentative" : item.status === "cancelled" ? "cancelled" : "confirmed";

    upsert.run(
      randomUUID(), integration.id, externalId,
      item.summary ?? "Untitled", item.description ?? null,
      startAt, endAt, isAllDay ? 1 : 0, item.location ?? null,
      status, JSON.stringify(item), now, now, now,
    );
    synced++;
  }

  markSynced(integration.id);
  markConnected(integration.id);
  return { synced };
}

// ── Event CRUD ───────────────────────────────────────────────────────────────

export function listCalendarEvents(opts?: { from?: number; to?: number; integrationId?: string }): CalendarEvent[] {
  const db = getMcDb();
  const parts: string[] = ["1=1"];
  const params: any = {};

  if (opts?.integrationId) {
    parts.push("integration_id = :integrationId");
    params.integrationId = opts.integrationId;
  }
  if (opts?.from) {
    parts.push("end_at >= :from");
    params.from = opts.from;
  }
  if (opts?.to) {
    parts.push("start_at <= :to");
    params.to = opts.to;
  }

  const rows = db.prepare(`SELECT * FROM calendar_events WHERE ${parts.join(" AND ")} ORDER BY start_at ASC`).all(params) as any[];
  return rows.map(rowToEvent);
}

export function getCalendarEvent(id: string): CalendarEvent | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(id) as any;
  return row ? rowToEvent(row) : undefined;
}

export async function createCalendarEvent(data: {
  title: string;
  startAt: number;
  endAt: number;
  allDay?: boolean;
  description?: string;
  location?: string;
}): Promise<CalendarEvent | undefined> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not connected to Google Calendar.");

  const integration = getIntegrationByType("google_calendar");
  if (!integration) throw new Error("No Google Calendar integration found.");

  const gcalEvent: any = {
    summary: data.title,
    description: data.description,
    location: data.location,
  };

  if (data.allDay) {
    gcalEvent.start = { date: new Date(data.startAt).toISOString().split("T")[0] };
    gcalEvent.end = { date: new Date(data.endAt).toISOString().split("T")[0] };
  } else {
    gcalEvent.start = { dateTime: new Date(data.startAt).toISOString() };
    gcalEvent.end = { dateTime: new Date(data.endAt).toISOString() };
  }

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(gcalEvent),
  });

  if (!res.ok) throw new Error(`Failed to create event (${res.status})`);
  const created = (await res.json()) as any;

  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO calendar_events (id, integration_id, external_id, title, description, start_at, end_at, all_day, location, status, raw_json, synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
  `).run(id, integration.id, created.id, data.title, data.description ?? null, data.startAt, data.endAt, data.allDay ? 1 : 0, data.location ?? null, JSON.stringify(created), now, now, now);

  return getCalendarEvent(id);
}

export async function deleteCalendarEvent(id: string): Promise<boolean> {
  const db = getMcDb();
  const event = getCalendarEvent(id);
  if (!event) return false;

  // Delete from Google Calendar
  const token = await getAccessToken();
  if (token) {
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.externalId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
  }

  const result = db.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
  return result.changes > 0;
}

export function linkEventToTask(eventId: string, taskId: string | null): CalendarEvent | undefined {
  const db = getMcDb();
  db.prepare("UPDATE calendar_events SET task_id = ?, updated_at = ? WHERE id = ?").run(taskId, Date.now(), eventId);
  return getCalendarEvent(eventId);
}
