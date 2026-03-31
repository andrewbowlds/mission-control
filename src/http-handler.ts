import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createGoogleOAuthStartUrl,
  disconnectGoogleContacts,
  getGoogleConnectionStatus,
  handleGoogleOAuthCallback,
} from "./google-contacts-auth.js";
import { getGoogleSyncStatus, runGoogleContactsSync } from "./google-contacts-sync.js";
import { getFirestoreSyncStatus, pushContactToFirestore, runFirestoreContactsSync } from "./firestore-contacts-sync.js";
import {
  getCalendarConnectionStatus,
  createCalendarOAuthUrl,
  handleCalendarOAuthCallback,
  disconnectCalendar,
} from "./integrations/google-calendar.js";
import { verifyWebhookSignature, getWebhookSecret } from "./integrations/github.js";
import { bootstrapGoogleContactsIntegration } from "./integrations/google-contacts.js";
import { evaluateEvent } from "./automation-engine.js";
import {
  handleOmiTranscript,
  handleOmiMemoryCreated,
  handleOmiDaySummary,
  handleOmiAudioBytes,
} from "./omi-integration.js";

const MC_PREFIX = "/mission-control";
const API_PREFIX = `${MC_PREFIX}/api/google`;
const API_PREFIX_UNSCOPED = "/api/google";
const FIRESTORE_API_PREFIX = `${MC_PREFIX}/api/firestore`;
const FIRESTORE_API_PREFIX_UNSCOPED = "/api/firestore";
const GCAL_API_PREFIX = `${MC_PREFIX}/api/gcal`;
const GCAL_API_PREFIX_UNSCOPED = "/api/gcal";
const GITHUB_API_PREFIX = `${MC_PREFIX}/api/github`;
const GITHUB_API_PREFIX_UNSCOPED = "/api/github";
const OMI_API_PREFIX = `${MC_PREFIX}/api/omi`;
const OMI_API_PREFIX_UNSCOPED = "/api/omi";

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function handleGoogleApi(req: IncomingMessage, res: ServerResponse, rawUrl: string): boolean {
  const method = req.method ?? "GET";
  const reqUrl = new URL(rawUrl, "http://localhost");
  const pathname = reqUrl.pathname;

  const apiBase = pathname.startsWith(API_PREFIX)
    ? API_PREFIX
    : (pathname.startsWith(API_PREFIX_UNSCOPED) ? API_PREFIX_UNSCOPED : null);

  if (!apiBase) return false;

  if (pathname === `${apiBase}/status` && method === "GET") {
    sendJson(res, 200, getGoogleConnectionStatus());
    return true;
  }

  if (pathname === `${apiBase}/connect` && method === "GET") {
    try {
      const { url } = createGoogleOAuthStartUrl();
      res.writeHead(302, { Location: url });
      res.end();
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === `${apiBase}/callback` && method === "GET") {
    const code = reqUrl.searchParams.get("code") ?? "";
    const state = reqUrl.searchParams.get("state") ?? "";
    if (!code || !state) {
      res.writeHead(302, { Location: `${MC_PREFIX}?google_oauth=error` });
      res.end();
      return true;
    }

    // Route to calendar handler if state has gcal: prefix
    if (state.startsWith("gcal:")) {
      void handleCalendarOAuthCallback(code, state)
        .then(() => {
          res.writeHead(302, { Location: `${MC_PREFIX}?gcal_oauth=connected` });
          res.end();
        })
        .catch(() => {
          res.writeHead(302, { Location: `${MC_PREFIX}?gcal_oauth=error` });
          res.end();
        });
      return true;
    }

    void handleGoogleOAuthCallback(code, state)
      .then(() => {
        bootstrapGoogleContactsIntegration();
        res.writeHead(302, { Location: `${MC_PREFIX}?google_oauth=connected` });
        res.end();
      })
      .catch(() => {
        res.writeHead(302, { Location: `${MC_PREFIX}?google_oauth=error` });
        res.end();
      });
    return true;
  }

  if (pathname === `${apiBase}/disconnect` && method === "POST") {
    disconnectGoogleContacts();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === `${apiBase}/sync` && method === "POST") {
    void runGoogleContactsSync()
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (pathname === `${apiBase}/sync/status` && method === "GET") {
    sendJson(res, 200, { run: getGoogleSyncStatus() });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

function handleFirestoreApi(req: IncomingMessage, res: ServerResponse, rawUrl: string): boolean {
  const method = req.method ?? "GET";
  const reqUrl = new URL(rawUrl, "http://localhost");
  const pathname = reqUrl.pathname;

  const apiBase = pathname.startsWith(FIRESTORE_API_PREFIX)
    ? FIRESTORE_API_PREFIX
    : (pathname.startsWith(FIRESTORE_API_PREFIX_UNSCOPED) ? FIRESTORE_API_PREFIX_UNSCOPED : null);

  if (!apiBase) return false;

  if (pathname === `${apiBase}/sync` && method === "POST") {
    void runFirestoreContactsSync()
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (pathname === `${apiBase}/sync/status` && method === "GET") {
    sendJson(res, 200, { run: getFirestoreSyncStatus() });
    return true;
  }

  const pushMatch = pathname.match(new RegExp(`^${apiBase}/contacts/([^/]+)/push$`));
  if (pushMatch && method === "POST") {
    const contactId = decodeURIComponent(pushMatch[1] ?? "");
    void pushContactToFirestore(contactId)
      .then((result) => sendJson(res, 200, result))
      .catch((err) => sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

function handleGCalApi(req: IncomingMessage, res: ServerResponse, rawUrl: string): boolean {
  const method = req.method ?? "GET";
  const reqUrl = new URL(rawUrl, "http://localhost");
  const pathname = reqUrl.pathname;

  const apiBase = pathname.startsWith(GCAL_API_PREFIX)
    ? GCAL_API_PREFIX
    : (pathname.startsWith(GCAL_API_PREFIX_UNSCOPED) ? GCAL_API_PREFIX_UNSCOPED : null);

  if (!apiBase) return false;

  if (pathname === `${apiBase}/status` && method === "GET") {
    sendJson(res, 200, getCalendarConnectionStatus());
    return true;
  }

  if (pathname === `${apiBase}/connect` && method === "GET") {
    try {
      const { url } = createCalendarOAuthUrl();
      res.writeHead(302, { Location: url });
      res.end();
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === `${apiBase}/disconnect` && method === "POST") {
    disconnectCalendar();
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readBodyBinary(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function handleGitHubWebhook(req: IncomingMessage, res: ServerResponse, rawUrl: string): boolean {
  const method = req.method ?? "GET";
  const pathname = rawUrl.split("?")[0];

  const isWebhook =
    (pathname === `${GITHUB_API_PREFIX}/webhook` || pathname === `${GITHUB_API_PREFIX_UNSCOPED}/webhook`) &&
    method === "POST";

  if (!isWebhook) return false;

  void (async () => {
    try {
      const body = await readBody(req);
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      const eventType = req.headers["x-github-event"] as string | undefined;

      // Verify signature if webhook secret is configured
      const secret = getWebhookSecret();
      if (secret && signature) {
        if (!verifyWebhookSignature(body, signature, secret)) {
          sendJson(res, 401, { error: "Invalid signature" });
          return;
        }
      }

      // Respond 200 immediately
      sendJson(res, 200, { ok: true });

      // Fire automation events
      if (eventType && body) {
        const payload = JSON.parse(body);
        const automationEvent =
          eventType === "issues" && payload.action === "opened" ? "github_issue_opened" as const :
          eventType === "pull_request" && payload.action === "opened" ? "github_pr_opened" as const :
          eventType === "push" ? "github_push" as const : null;

        if (automationEvent) {
          evaluateEvent(automationEvent, {
            agentId: payload.repository?.full_name,
            tags: ["github", eventType],
          });
        }
      }
    } catch {
      sendJson(res, 400, { error: "Invalid request" });
    }
  })();

  return true;
}

function handleOmiWebhook(req: IncomingMessage, res: ServerResponse, rawUrl: string): boolean {
  const method = req.method ?? "GET";
  const pathname = rawUrl.split("?")[0];

  const isOmi =
    (pathname.startsWith(OMI_API_PREFIX) || pathname.startsWith(OMI_API_PREFIX_UNSCOPED)) &&
    method === "POST";

  if (!isOmi) return false;

  void (async () => {
    try {
      const route = pathname.endsWith("/transcript") ? "transcript"
        : pathname.endsWith("/memory") ? "memory"
        : pathname.endsWith("/day-summary") ? "day-summary"
        : pathname.endsWith("/audio") ? "audio"
        : null;

      if (route === "audio") {
        // Binary body — read before responding
        const reqUrl = new URL(rawUrl, "http://localhost");
        const uid = reqUrl.searchParams.get("uid") ?? "unknown";
        const sampleRate = parseInt(reqUrl.searchParams.get("sample_rate") ?? "8000", 10);
        const chunk = await readBodyBinary(req);
        sendJson(res, 200, { ok: true });
        handleOmiAudioBytes(chunk, uid, sampleRate);
      } else {
        const body = await readBody(req);
        const payload = JSON.parse(body);
        sendJson(res, 200, { ok: true });
        if (route === "transcript") {
          await handleOmiTranscript(payload);
        } else if (route === "memory") {
          await handleOmiMemoryCreated(payload);
        } else if (route === "day-summary") {
          await handleOmiDaySummary(payload);
        }
      }
    } catch {
      sendJson(res, 400, { error: "Invalid request" });
    }
  })();

  return true;
}

function getDistDir(): string {
  // This file lives at ~/mission-control/src/http-handler.ts (or compiled equivalent).
  // dist/ui is at ~/mission-control/dist/ui.
  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = path.join(path.dirname(__filename), "..");
  return path.resolve(projectRoot, "dist", "ui");
}

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":   return "application/javascript; charset=utf-8";
    case ".css":  return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg":  return "image/svg+xml";
    case ".png":  return "image/png";
    case ".ico":  return "image/x-icon";
    case ".woff2": return "font/woff2";
    case ".woff":  return "font/woff";
    default: return "application/octet-stream";
  }
}

function injectBootstrap(html: string, config: Record<string, unknown>): string {
  const tag = `<script>window.__mcBootstrap=${JSON.stringify(config)}</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : tag + html;
}

export function handleMissionControlRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bootstrapConfig: Record<string, unknown>,
): boolean {
  const rawUrl = req.url ?? "/";
  const url = rawUrl.split("?")[0];
  if (url.startsWith(API_PREFIX_UNSCOPED)) return handleGoogleApi(req, res, rawUrl);
  if (url.startsWith(FIRESTORE_API_PREFIX_UNSCOPED)) return handleFirestoreApi(req, res, rawUrl);
  if (url.startsWith(GCAL_API_PREFIX_UNSCOPED)) return handleGCalApi(req, res, rawUrl);
  if (url.startsWith(GITHUB_API_PREFIX_UNSCOPED)) return handleGitHubWebhook(req, res, rawUrl);
  if (url.startsWith(OMI_API_PREFIX_UNSCOPED)) return handleOmiWebhook(req, res, rawUrl);
  if (!url.startsWith(MC_PREFIX)) return false;
  if (url.startsWith(API_PREFIX)) return handleGoogleApi(req, res, rawUrl);
  if (url.startsWith(FIRESTORE_API_PREFIX)) return handleFirestoreApi(req, res, rawUrl);
  if (url.startsWith(GCAL_API_PREFIX)) return handleGCalApi(req, res, rawUrl);
  if (url.startsWith(GITHUB_API_PREFIX)) return handleGitHubWebhook(req, res, rawUrl);
  if (url.startsWith(OMI_API_PREFIX)) return handleOmiWebhook(req, res, rawUrl);

  const distDir = getDistDir();

  if (!fs.existsSync(distDir)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Mission Control UI not built yet.\nRun: cd ~/mission-control && npm install && npm run build\nThen restart the gateway.",
    );
    return true;
  }

  // Strip prefix, default to index.html
  let filePath = url.slice(MC_PREFIX.length) || "/";
  if (filePath === "/" || filePath === "") filePath = "/index.html";

  const fullPath = path.resolve(distDir, filePath.replace(/^\//, ""));

  // Security: prevent path traversal outside dist dir
  if (!fullPath.startsWith(path.resolve(distDir))) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  const serveIndex = () => {
    const indexPath = path.join(distDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const html = injectBootstrap(fs.readFileSync(indexPath, "utf8"), bootstrapConfig);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  };

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    // SPA fallback
    serveIndex();
    return true;
  }

  const ext = path.extname(fullPath);
  if (ext === ".html") {
    const html = injectBootstrap(fs.readFileSync(fullPath, "utf8"), bootstrapConfig);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } else {
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, {
      "Content-Type": contentTypeForExt(ext),
      "Cache-Control": "public, max-age=3600",
    });
    res.end(content);
  }
  return true;
}
