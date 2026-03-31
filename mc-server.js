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

function injectBootstrap(html) {
    const tag = `<script>window.__mcBootstrap=${JSON.stringify(BOOTSTRAP_CONFIG)}</script>`;
    return html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : tag + html;
}

// ── Allowed origins for CORS (WebSocket is on a different origin) ────────────

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

// ── Server ───────────────────────────────────────────────────────────────────

function serveIndex(res, origin) {
    const indexPath = join(DIST_DIR, "index.html");
    if (!existsSync(indexPath)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end(
            "Mission Control UI not built.\nRun: cd ~/mission-control && npm run build",
        );
        return;
    }
    const html = injectBootstrap(readFileSync(indexPath, "utf8"));
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        ...corsHeaders(origin),
    });
    res.end(html);
}

const GATEWAY_HTTP_URL =
    process.env.MC_GATEWAY_HTTP_URL ?? "http://127.0.0.1:18789";

/** Proxy a request to the openclaw gateway and pipe the response back. */
function proxyToGateway(req, res, targetPath) {
    const url = new URL(targetPath, GATEWAY_HTTP_URL);
    const options = {
        hostname: url.hostname,
        port: url.port || 18789,
        path: url.pathname + (req.url?.split("?")[1] ? `?${req.url.split("?")[1]}` : ""),
        method: req.method,
        headers: {
            ...req.headers,
            host: url.host,
        },
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

const server = createServer((req, res) => {
    const origin = req.headers.origin ?? "";

    // CORS preflight
    if (req.method === "OPTIONS") {
        res.writeHead(204, {
            ...corsHeaders(origin),
            "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
    }

    const url = (req.url ?? "/").split("?")[0];

    // Proxy API routes to the openclaw gateway.
    // The gateway's /api/* namespace is reserved, so we rewrite
    // /api/omi/* → /mission-control/api/omi/* which the plugin handles.
    if (url.startsWith("/api/omi/") || url === "/api/omi") {
        proxyToGateway(req, res, "/mission-control" + url);
        return;
    }

    // Serve static assets
    let filePath = url === "/" || url === "" ? "/index.html" : url;

    // Strip any leading /mission-control prefix (in case old bookmarks hit us)
    if (filePath.startsWith("/mission-control")) {
        filePath = filePath.slice("/mission-control".length) || "/index.html";
    }

    const fullPath = resolve(DIST_DIR, filePath.replace(/^\//, ""));

    // Security: prevent path traversal
    if (!fullPath.startsWith(resolve(DIST_DIR))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    // If file doesn't exist or is a directory → SPA fallback to index.html
    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
        serveIndex(res, origin);
        return;
    }

    const ext = extname(fullPath);
    if (ext === ".html") {
        const html = injectBootstrap(readFileSync(fullPath, "utf8"));
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            ...corsHeaders(origin),
        });
        res.end(html);
        return;
    }

    const content = readFileSync(fullPath);
    res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
        ...corsHeaders(origin),
    });
    res.end(content);
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`[mc-server] Mission Control UI listening on http://127.0.0.1:${PORT}`);
    console.log(`[mc-server] Gateway WebSocket: ${GATEWAY_WS_URL}`);
});
