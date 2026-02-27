/**
 * Mission Control gateway WebSocket client.
 *
 * Implements the same device-identity auth as openclaw's main control UI so it
 * reuses any existing paired device token stored in localStorage.  If the user
 * is already authenticated in the main gateway UI they will be auto-authenticated
 * here too.
 */

import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";

// ── Device identity (shared localStorage key with main control UI) ────────────

const IDENTITY_KEY = "openclaw-device-identity-v1";
const AUTH_STORE_KEY = "openclaw.device.auth.v1";

type DeviceIdentity = { deviceId: string; publicKey: string; privateKey: string };

function b64Enc(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64Dec(s: string): Uint8Array {
  const norm = s.replaceAll("-", "+").replaceAll("_", "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fpKey(pub: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", pub.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function loadOrCreateIdentity(): Promise<DeviceIdentity> {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { version?: number; deviceId?: string; publicKey?: string; privateKey?: string };
      if (p?.version === 1 && p.deviceId && p.publicKey && p.privateKey) {
        return { deviceId: p.deviceId, publicKey: p.publicKey, privateKey: p.privateKey };
      }
    }
  } catch { /* fall through */ }
  const priv = utils.randomPrivateKey();
  const pub = await getPublicKeyAsync(priv);
  const deviceId = await fpKey(pub);
  const identity: DeviceIdentity = { deviceId, publicKey: b64Enc(pub), privateKey: b64Enc(priv) };
  localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({ version: 1, ...identity, createdAtMs: Date.now() }),
  );
  return identity;
}

function loadDeviceToken(deviceId: string, role = "operator"): string | null {
  try {
    const raw = localStorage.getItem(AUTH_STORE_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw) as { version?: number; deviceId?: string; tokens?: Record<string, { token?: string }> };
    if (store?.version !== 1 || store.deviceId !== deviceId) return null;
    return store.tokens?.[role]?.token ?? null;
  } catch { return null; }
}

type AuthStore = { version: number; deviceId: string; tokens: Record<string, unknown> };

function saveDeviceToken(deviceId: string, role: string, token: string, scopes: string[]) {
  try {
    let existing: AuthStore | null = null;
    try {
      const raw = localStorage.getItem(AUTH_STORE_KEY);
      if (raw) existing = JSON.parse(raw) as AuthStore | null;
    } catch { /* ignore */ }
    const store = {
      version: 1,
      deviceId,
      tokens: { ...(existing?.deviceId === deviceId ? existing?.tokens : {}) },
    };
    store.tokens[role] = { token, role, scopes, updatedAtMs: Date.now() };
    localStorage.setItem(AUTH_STORE_KEY, JSON.stringify(store));
  } catch { /* best-effort */ }
}

function buildPayload(p: {
  deviceId: string; role: string; scopes: string[];
  signedAtMs: number; token: string | null; nonce?: string;
}): string {
  const version = p.nonce ? "v2" : "v1";
  const parts = [
    version, p.deviceId, "control-ui", "webchat",
    p.role, p.scopes.join(","), String(p.signedAtMs), p.token ?? "",
  ];
  if (p.nonce) parts.push(p.nonce);
  return parts.join("|");
}

// ── Client types ──────────────────────────────────────────────────────────────

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

export type GatewayConnectionStatus = "connecting" | "connected" | "disconnected";

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

// ── MCGatewayClient ───────────────────────────────────────────────────────────

export class MCGatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private nonce: string | null = null;
  private connectSent = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 800;
  private manualToken: string | null = null;

  constructor(
    private readonly gatewayUrl: string,
    private readonly onEvent: (evt: GatewayEventFrame) => void,
    private readonly onReady: () => void,
    private readonly onStatus: (s: GatewayConnectionStatus) => void,
    initialToken?: string,
  ) {
    this.manualToken = initialToken?.trim() ? initialToken.trim() : null;
  }

  setManualToken(token: string | null): void {
    this.manualToken = token?.trim() ? token.trim() : null;
  }

  start(): void {
    this.closed = false;
    this.openSocket();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error("client stopped"));
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private openSocket(): void {
    if (this.closed) return;
    this.onStatus("connecting");
    const ws = new WebSocket(this.gatewayUrl);
    this.ws = ws;
    ws.addEventListener("open", () => this.scheduleConnect());
    ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    ws.addEventListener("close", () => {
      this.ws = null;
      this.flushPending(new Error("disconnected"));
      this.onStatus("disconnected");
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => { /* handled by close */ });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    setTimeout(() => this.openSocket(), delay);
  }

  private flushPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private scheduleConnect(): void {
    this.nonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => void this.doConnect(), 750);
  }

  private async doConnect(): Promise<void> {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }

    const isSecure = typeof crypto !== "undefined" && !!crypto?.subtle;
    const role = "operator";
    const scopes = ["operator.admin", "operator.approvals", "operator.pairing"];

    type HelloPayload = { auth?: { deviceToken?: string; role?: string; scopes?: string[] } };

    // If a manual gateway token is provided, always use token-only auth and skip device auth.
    // Do this even when the browser is in a non-secure context where crypto.subtle is unavailable.
    if (this.manualToken) {
      void this.request<HelloPayload>("connect", {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "openclaw-control-ui", version: "1.0.0", platform: navigator.platform ?? "web", mode: "webchat" },
        role, scopes, caps: [],
        auth: { token: this.manualToken },
        userAgent: navigator.userAgent,
        locale: navigator.language,
      }).then(() => {
        this.backoffMs = 800;
        this.onStatus("connected");
        this.onReady();
      }).catch(() => {
        this.ws?.close(4008, "connect failed");
      });
      return;
    }

    if (isSecure) {
      const identity = await loadOrCreateIdentity();
      const authToken = loadDeviceToken(identity.deviceId, role);

      const signedAtMs = Date.now();
      const payload = buildPayload({
        deviceId: identity.deviceId, role, scopes, signedAtMs,
        token: authToken, nonce: this.nonce ?? undefined,
      });
      const sig = b64Enc(
        await signAsync(new TextEncoder().encode(payload), b64Dec(identity.privateKey)),
      );

      void this.request<HelloPayload>("connect", {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "openclaw-control-ui", version: "1.0.0", platform: navigator.platform ?? "web", mode: "webchat" },
        role, scopes, caps: [],
        auth: authToken ? { token: authToken } : undefined,
        device: { id: identity.deviceId, publicKey: identity.publicKey, signature: sig, signedAt: signedAtMs, nonce: this.nonce ?? undefined },
        userAgent: navigator.userAgent,
        locale: navigator.language,
      }).then((hello) => {
        if (hello?.auth?.deviceToken) {
          saveDeviceToken(identity.deviceId, hello.auth.role ?? role, hello.auth.deviceToken, hello.auth.scopes ?? []);
        }
        this.backoffMs = 800;
        this.onStatus("connected");
        this.onReady();
      }).catch(() => {
        this.ws?.close(4008, "connect failed");
      });
    } else {
      // Non-secure context (plain HTTP) — try without device auth
      void this.request("connect", {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "openclaw-control-ui", version: "1.0.0", platform: "web", mode: "webchat" },
        role, scopes, caps: [],
        userAgent: navigator.userAgent,
        locale: navigator.language,
      }).then(() => {
        this.backoffMs = 800;
        this.onStatus("connected");
        this.onReady();
      }).catch(() => {
        this.ws?.close(4008, "connect failed");
      });
    }
  }

  private handleMessage(raw: string): void {
    let parsed: { type?: unknown };
    try { parsed = JSON.parse(raw) as { type?: unknown }; } catch { return; }

    if (parsed.type === "event") {
      const evt = parsed as GatewayEventFrame;
      // challenge from gateway triggers immediate connect
      if (evt.event === "connect.challenge") {
        const p = evt.payload as { nonce?: unknown } | undefined;
        if (typeof p?.nonce === "string") {
          this.nonce = p.nonce;
          void this.doConnect();
        }
        return;
      }
      try { this.onEvent(evt); } catch (e) { console.error("[mc-gw] event handler error:", e); }
      return;
    }

    if (parsed.type === "res") {
      const res = parsed as { type: "res"; id: string; ok: boolean; payload?: unknown; error?: { message?: string } };
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.payload);
      else p.reject(new Error(res.error?.message ?? "request failed"));
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = crypto.randomUUID();
    const p = new Promise<T>((resolve, reject) =>
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject }),
    );
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return p;
  }
}
