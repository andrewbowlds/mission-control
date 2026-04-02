#!/usr/bin/env node
/**
 * Standalone static-file server for Mission Control UI.
 *
 * Serves the Vite-built UI from dist/ui/ on its own port so the Cloudflare
 * tunnel can route missioncontrol.edprealty.com directly here, avoiding the
 * gateway's built-in control-ui override.
 *
 * Bootstrap config is injected into index.html so the UI knows where the
 * gateway WebSocket lives (since it's on a different origin).
 *
 * Auth: Firebase session cookies (same project as edpmain / edpAgentNet).
 * POST /auth/session  — exchange a Firebase ID token for a session cookie
 * GET  /auth/logout   — clear session cookie
 * All other routes require a valid session cookie or redirect to login.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = resolve(__dirname, "dist", "ui");
const PORT = parseInt(process.env.MC_PORT ?? "18800", 10);

// The UI needs to connect to the gateway WebSocket on a different origin.
const GATEWAY_WS_URL =
    process.env.MC_GATEWAY_WS_URL ?? "wss://gateway.edprealty.com/ws";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

const BOOTSTRAP_CONFIG = {
    gatewayUrl: GATEWAY_WS_URL,
    initialToken: GATEWAY_TOKEN,
    basePath: "/",
};

// Firebase public config (safe to embed in HTML — same values in edpmain/edpAgentNet)
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyC5pb9-HPYnkE5iQcOMW2cz9sY_2foxx0c",
    authDomain: "edp-invoicing.firebaseapp.com",
    projectId: "edp-invoicing",
    storageBucket: "edp-invoicing.firebasestorage.app",
    messagingSenderId: "272765525220",
    appId: "1:272765525220:web:d4765a9b8dada1c569a0f1",
};

// Session cookie settings
const SESSION_COOKIE_NAME = "mc_session";
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

// ── Firebase Admin (lazy init) ────────────────────────────────────────────────

let _adminApp = null;
let adminAuth = null;
let adminDb = null;

async function getAdminApp() {
    if (_adminApp) return _adminApp;
    const SA_PATH = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_PATH
        ?? `${process.env.HOME}/.config/openclaw/edp-firebase-sa.json`;
    const { default: admin } = await import("firebase-admin");
    if (!admin.apps.length) {
        _adminApp = admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
    } else {
        _adminApp = admin.apps[0];
    }
    return _adminApp;
}

async function getAdminAuth() {
    if (adminAuth) return adminAuth;
    await getAdminApp();
    const { default: admin } = await import("firebase-admin");
    adminAuth = admin.auth();
    return adminAuth;
}

async function getAdminFirestore() {
    if (adminDb) return adminDb;
    await getAdminApp();
    const { getFirestore } = await import("firebase-admin/firestore");
    adminDb = getFirestore();
    return adminDb;
}

// ── Gateway connection persistence ────────────────────────────────────────────

async function getGatewayConnection(uid) {
    try {
        const db = await getAdminFirestore();
        const doc = await db.collection("mcGatewayConnections").doc(uid).get();
        return doc.exists ? doc.data() : null;
    } catch { return null; }
}

async function saveGatewayConnection(uid, { gatewayUrl, token, instanceName }) {
    const db = await getAdminFirestore();
    await db.collection("mcGatewayConnections").doc(uid).set({
        gatewayUrl: gatewayUrl || "",
        token: token || "",
        instanceName: instanceName || "",
        connectedAt: Date.now(),
    }, { merge: true });
}

async function deleteGatewayConnection(uid) {
    const db = await getAdminFirestore();
    await db.collection("mcGatewayConnections").doc(uid).delete();
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function parseCookies(header) {
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k) cookies[k.trim()] = decodeURIComponent(v.join("=").trim());
    }
    return cookies;
}

function setSessionCookie(res, cookie) {
    res.setHeader("Set-Cookie",
        `${SESSION_COOKIE_NAME}=${cookie}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_MS / 1000}; Path=/`
    );
}

function clearSessionCookie(res) {
    res.setHeader("Set-Cookie",
        `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`
    );
}

async function verifySession(cookies) {
    const sessionCookie = cookies[SESSION_COOKIE_NAME];
    if (!sessionCookie) return null;
    try {
        const auth = await getAdminAuth();
        const decoded = await auth.verifySessionCookie(sessionCookie, true);
        return decoded;
    } catch {
        return null;
    }
}

// ── Body reader ───────────────────────────────────────────────────────────────

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

// ── Login page ────────────────────────────────────────────────────────────────

function loginPage(errorMsg = "") {
    const cfg = JSON.stringify(FIREBASE_CONFIG);
    const err = errorMsg ? `<p class="error">${errorMsg}</p>` : "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mission Control — Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #08080f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #111118;
      border: 1px solid #1e1e2e;
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    }
    .logo {
      font-size: 22px;
      font-weight: 700;
      color: #a78bfa;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }
    .sub {
      font-size: 13px;
      color: #475569;
      margin-bottom: 32px;
    }
    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      background: #0f0f1a;
      border: 1px solid #1e1e2e;
      border-radius: 8px;
      color: #e2e8f0;
      font-size: 14px;
      padding: 10px 14px;
      margin-bottom: 16px;
      transition: border-color 0.15s;
    }
    input:focus { outline: none; border-color: #5b21b6; }
    .btn {
      width: 100%;
      background: #5b21b6;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      padding: 11px;
      cursor: pointer;
      margin-bottom: 12px;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.4; cursor: default; }
    .btn-google {
      background: #1e1e2e;
      border: 1px solid #2d2d3f;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 4px 0 12px;
      font-size: 11px;
      color: #334155;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #1e1e2e;
    }
    .error {
      background: #3f1a1a;
      border: 1px solid #7f1d1d;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 12px;
      color: #fca5a5;
      margin-bottom: 16px;
    }
    .spinner {
      display: none;
      width: 16px; height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin: 0 auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Mission Control</div>
    <div class="sub">EDP Realty AI Operations</div>
    ${err}
    <div id="error-box" class="error" style="display:none"></div>

    <label for="email">Email</label>
    <input id="email" type="email" placeholder="you@edprealty.com" autocomplete="email" />

    <label for="password">Password</label>
    <input id="password" type="password" placeholder="••••••••" autocomplete="current-password" />

    <button class="btn" id="sign-in-btn" onclick="signIn()">Sign In</button>

    <div class="divider">or</div>

    <button class="btn btn-google" id="google-btn" onclick="signInGoogle()">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.1 6.8 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16.1 18.9 12 24 12c3.1 0 5.8 1.1 8 2.9l5.7-5.7C34.1 6.8 29.3 4 24 4 16.2 4 9.5 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5.1l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8L6 33.3C9.1 39.8 16.1 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.3l6.2 5.2C41.1 35.3 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
      Sign in with Google
    </button>
  </div>

  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
    import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

    const app = initializeApp(${cfg});
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();

    function showError(msg) {
      const el = document.getElementById("error-box");
      el.textContent = msg;
      el.style.display = "block";
    }

    function setLoading(loading) {
      document.getElementById("sign-in-btn").disabled = loading;
      document.getElementById("google-btn").disabled = loading;
    }

    async function exchangeToken(user) {
      const idToken = await user.getIdToken(true); // force refresh to pick up latest custom claims
      const res = await fetch("/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const data = await res.json().catch(() => ({}));
        showError(data.error ?? "Sign-in failed. You may not have access.");
        setLoading(false);
      }
    }

    window.signIn = async function() {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      if (!email || !password) return showError("Email and password are required.");
      setLoading(true);
      document.getElementById("error-box").style.display = "none";
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await exchangeToken(cred.user);
      } catch (e) {
        showError(e.code === "auth/invalid-credential" ? "Incorrect email or password." : e.message);
        setLoading(false);
      }
    };

    window.signInGoogle = async function() {
      setLoading(true);
      document.getElementById("error-box").style.display = "none";
      try {
        const cred = await signInWithPopup(auth, provider);
        await exchangeToken(cred.user);
      } catch (e) {
        if (e.code !== "auth/popup-closed-by-user") showError(e.message);
        setLoading(false);
      }
    };

    // Allow Enter key to submit
    document.getElementById("password").addEventListener("keydown", e => {
      if (e.key === "Enter") window.signIn();
    });
  </script>
</body>
</html>`;
}

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
};

// ── Bootstrap injection ──────────────────────────────────────────────────────

function injectBootstrap(html, config) {
    const cfg = config ?? BOOTSTRAP_CONFIG;
    const tag = `<script>window.__mcBootstrap=${JSON.stringify(cfg)}</script>`;
    return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : tag + html;
}

// ── Allowed origins for CORS ──────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
    "https://missioncontrol.edprealty.com",
    "https://missioncontrol.eidithai.com",
    "https://gateway.edprealty.com",
    "https://gateway.eidithai.com",
]);

function corsHeaders(origin) {
    const headers = {};
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
        headers["Access-Control-Allow-Headers"] = "Content-Type";
    }
    return headers;
}

// ── Static file serving ───────────────────────────────────────────────────────

function serveIndex(res, origin, config) {
    const indexPath = join(DIST_DIR, "index.html");
    if (!existsSync(indexPath)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Mission Control UI not built.\nRun: cd ~/mission-control && npm run build");
        return;
    }
    const html = injectBootstrap(readFileSync(indexPath, "utf8"), config);
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        ...corsHeaders(origin),
    });
    res.end(html);
}

// ── Gateway proxy ─────────────────────────────────────────────────────────────

const GATEWAY_HTTP_URL =
    process.env.MC_GATEWAY_HTTP_URL ?? "http://127.0.0.1:18789";

function proxyToGateway(req, res, targetPath) {
    const url = new URL(targetPath, GATEWAY_HTTP_URL);
    const options = {
        hostname: url.hostname,
        port: url.port || 18789,
        path: url.pathname + (req.url?.split("?")[1] ? `?${req.url.split("?")[1]}` : ""),
        method: req.method,
        headers: { ...req.headers, host: url.host },
    };

    import("node:http").then(({ default: http }) => {
        const proxy = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
        });
        proxy.on("error", () => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Gateway unavailable" }));
        });
        req.pipe(proxy);
    });
}

// ── Request handler ───────────────────────────────────────────────────────────

// Paths that don't require auth
const PUBLIC_PATHS = new Set(["/auth/session", "/auth/logout", "/favicon.ico"]);
// Static asset extensions that should be served without an auth check
const ASSET_EXTS = new Set([".js", ".css", ".woff2", ".woff", ".png", ".svg", ".ico"]);

const server = createServer(async (req, res) => {
    const origin = req.headers.origin ?? "";

    // CORS preflight
    if (req.method === "OPTIONS") {
        res.writeHead(204, { ...corsHeaders(origin), "Access-Control-Max-Age": "86400" });
        res.end();
        return;
    }

    const url = (req.url ?? "/").split("?")[0];

    // ── Auth endpoints ──────────────────────────────────────────────────────

    if (url === "/auth/session" && req.method === "POST") {
        try {
            const body = JSON.parse(await readBody(req));
            const { idToken } = body;
            if (!idToken) throw new Error("idToken required");
            const auth = await getAdminAuth();
            // Verify token is valid
            const decoded = await auth.verifyIdToken(idToken);
            // Create a 5-day session cookie
            const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
            setSessionCookie(res, sessionCookie);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, uid: decoded.uid, email: decoded.email }));
        } catch (err) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message ?? "Authentication failed" }));
        }
        return;
    }

    if (url === "/debug/me") {
        const cookies = parseCookies(req.headers.cookie);
        const decoded = await verifySession(cookies);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(decoded, null, 2));
        return;
    }

    if (url === "/auth/logout") {
        clearSessionCookie(res);
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
    }

    if (url === "/login") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(loginPage());
        return;
    }

    // ── Auth check ──────────────────────────────────────────────────────────

    // Skip auth for static assets (js/css/fonts) so the SPA can load
    const ext = extname(url);
    let reqBootstrap = null; // built per-request after auth
    if (!PUBLIC_PATHS.has(url) && !ASSET_EXTS.has(ext)) {
        const cookies = parseCookies(req.headers.cookie);
        const decoded = await verifySession(cookies);
        if (!decoded) {
            // Redirect to login
            res.writeHead(302, { Location: "/login" });
            res.end();
            return;
        }
        // Build per-request bootstrap with user's own gateway connection
        const gwConn = await getGatewayConnection(decoded.uid);
        reqBootstrap = {
            gatewayUrl: gwConn?.gatewayUrl || GATEWAY_WS_URL,
            initialToken: gwConn?.token || GATEWAY_TOKEN,
            basePath: "/",
            user: {
                uid: decoded.uid,
                email: decoded.email,
                name: decoded.name ?? decoded.email?.split("@")[0] ?? "",
                photoURL: decoded.picture ?? null,
                // Pass all custom claims as roles (isAdmin, isAgent, etc.)
                // Also grant isAdmin if the email is in MC_ADMIN_EMAILS (comma-separated)
                roles: (() => {
                    const claims = Object.fromEntries(
                        Object.entries(decoded).filter(([k]) =>
                            k.startsWith("is") || k === "role" || k === "roles"
                        )
                    );
                    // sys_admin claim also grants isAdmin
                    if (decoded.sys_admin) claims.isAdmin = true;
                    const adminEmails = (process.env.MC_ADMIN_EMAILS || "").split(",").map(e => e.trim()).filter(Boolean);
                    if (!claims.isAdmin && adminEmails.includes(decoded.email)) claims.isAdmin = true;
                    return claims;
                })(),
                gatewayConnected: !!gwConn?.gatewayUrl,
            },
        };
    }

    // ── Gateway connection API ──────────────────────────────────────────────

    if (url === "/api/user/gateway") {
        const cookies = parseCookies(req.headers.cookie);
        const decoded = await verifySession(cookies);
        if (!decoded) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Unauthorized" })); return; }

        if (req.method === "GET") {
            const conn = await getGatewayConnection(decoded.uid);
            res.writeHead(200, { "Content-Type": "application/json" });
            // Don't expose full token — just first/last 4 chars
            const masked = conn?.token
                ? conn.token.slice(0, 4) + "••••" + conn.token.slice(-4)
                : null;
            res.end(JSON.stringify({ gatewayUrl: conn?.gatewayUrl || "", instanceName: conn?.instanceName || "", tokenMasked: masked, connectedAt: conn?.connectedAt || null }));
            return;
        }

        if (req.method === "POST") {
            try {
                const body = JSON.parse(await readBody(req));
                const { gatewayUrl, token, instanceName } = body;
                if (!gatewayUrl || !token) throw new Error("gatewayUrl and token are required");
                await saveGatewayConnection(decoded.uid, { gatewayUrl, token, instanceName });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        if (req.method === "DELETE") {
            await deleteGatewayConnection(decoded.uid);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
    }

    // ── Proxy API routes ────────────────────────────────────────────────────

    if (url.startsWith("/api/omi/") || url === "/api/omi") {
        proxyToGateway(req, res, "/mission-control" + url);
        return;
    }

    // ── Static assets ───────────────────────────────────────────────────────

    let filePath = url === "/" || url === "" ? "/index.html" : url;

    if (filePath.startsWith("/mission-control")) {
        filePath = filePath.slice("/mission-control".length) || "/index.html";
    }

    const fullPath = resolve(DIST_DIR, filePath.replace(/^\//, ""));

    if (!fullPath.startsWith(resolve(DIST_DIR))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
        serveIndex(res, origin, reqBootstrap);
        return;
    }

    const fileExt = extname(fullPath);
    if (fileExt === ".html") {
        const html = injectBootstrap(readFileSync(fullPath, "utf8"), reqBootstrap);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...corsHeaders(origin) });
        res.end(html);
        return;
    }

    const content = readFileSync(fullPath);
    res.writeHead(200, {
        "Content-Type": MIME[fileExt] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
        ...corsHeaders(origin),
    });
    res.end(content);
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`[mc-server] Mission Control UI listening on http://127.0.0.1:${PORT}`);
    console.log(`[mc-server] Gateway WebSocket: ${GATEWAY_WS_URL}`);
    console.log(`[mc-server] Firebase Auth: enabled (project: edp-invoicing)`);
});
