import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleTokenStore = {
  connectedAt?: number;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  accountEmail?: string;
  pendingState?: string;
  pendingStateExpiresAt?: number;
};

export type GoogleConnectionStatus = {
  connected: boolean;
  accountId?: string;
  accountEmail?: string;
  expiresAt?: number;
};

const GOOGLE_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/contacts",
].join(" ");

function getStoreDir(): string {
  const dir = path.join(os.homedir(), ".openclaw", "workspace", "mission-control");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getStoreDir(), "google-contacts-oauth.json");
}

function readStore(): GoogleTokenStore {
  const p = getStorePath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GoogleTokenStore;
  } catch {
    return {};
  }
}

function writeStore(store: GoogleTokenStore): void {
  const p = getStorePath();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(p, 0o600);
}

function decodeJwtPayload(token?: string): Record<string, unknown> {
  if (!token) return {};
  const parts = token.split(".");
  if (parts.length < 2) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || process.env.REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function getGoogleConnectionStatus(): GoogleConnectionStatus {
  const store = readStore();
  if (!store.refreshToken && !store.accessToken) {
    return { connected: false };
  }
  return {
    connected: true,
    accountId: store.accountId,
    accountEmail: store.accountEmail,
    expiresAt: store.expiresAt,
  };
}

export function disconnectGoogleContacts(): void {
  writeStore({});
}

async function refreshGoogleAccessToken(store: GoogleTokenStore): Promise<GoogleTokenStore> {
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

  const token = (await tokenRes.json()) as TokenResponse;
  const next: GoogleTokenStore = {
    ...store,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || store.refreshToken,
    expiresAt: Date.now() + Math.max(1, token.expires_in || 0) * 1000,
  };
  writeStore(next);
  return next;
}

export async function getGoogleAccessToken(): Promise<string | null> {
  const store = readStore();
  if (!store.accessToken && !store.refreshToken) return null;

  const earlyRefreshAt = (store.expiresAt ?? 0) - 30_000;
  if (store.accessToken && Date.now() < earlyRefreshAt) return store.accessToken;

  if (store.refreshToken) {
    const refreshed = await refreshGoogleAccessToken(store);
    return refreshed.accessToken ?? null;
  }

  return store.accessToken ?? null;
}

export function createGoogleOAuthStartUrl(): { url: string } {
  const cfg = getOAuthConfig();
  if (!cfg) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI (or REDIRECT_URI).");
  }

  const state = randomUUID();
  const store = readStore();
  store.pendingState = state;
  store.pendingStateExpiresAt = Date.now() + 10 * 60 * 1000;
  writeStore(store);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", cfg.clientId);
  authUrl.searchParams.set("redirect_uri", cfg.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return { url: authUrl.toString() };
}

export async function handleGoogleOAuthCallback(code: string, state: string): Promise<void> {
  const cfg = getOAuthConfig();
  if (!cfg) {
    throw new Error("Google OAuth is not configured.");
  }

  const store = readStore();
  if (!store.pendingState || !store.pendingStateExpiresAt || store.pendingState !== state || store.pendingStateExpiresAt < Date.now()) {
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

  const token = (await tokenRes.json()) as TokenResponse;
  const idPayload = decodeJwtPayload(token.id_token);

  const next: GoogleTokenStore = {
    connectedAt: Date.now(),
    accessToken: token.access_token,
    refreshToken: token.refresh_token || store.refreshToken,
    expiresAt: Date.now() + Math.max(1, token.expires_in || 0) * 1000,
    accountId: typeof idPayload.sub === "string" ? idPayload.sub : store.accountId,
    accountEmail: typeof idPayload.email === "string" ? idPayload.email : store.accountEmail,
  };

  writeStore(next);
}
