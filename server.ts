import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require("archiver") as (format: string, options?: Record<string, unknown>) => any;
import { PassThrough } from "stream";
import http from "http";
import https from "https";
import { sync } from "./sync";
import { createLogger } from "./logger";
import type { Logger, SyncLogEntry, SyncFn, ZipCache, ApiGet, DownloadFile } from "./types";

const Colors = {
  bg: "#272822",
  bgLight: "#3e3d32",
  bgLighter: "#49483e",
  fg: "#f8f8f2",
  comment: "#75715e",
  yellow: "#e6db74",
  orange: "#fd971f",
  green: "#a6e22e",
  magenta: "#ae81ff",
  blue: "#66d9ef",
} as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeIp(ip: string | undefined): string {
  return String(ip ?? "").replace(/[^a-fA-F0-9:.]/g, "");
}

function isTailscaleIp(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "127.0.0.1") return true;
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  const v4 = match ? match[1] : (ip.includes(":") ? null : ip);
  if (!v4) return false;
  const octets = v4.split(".").map(Number);
  return octets[0] === 100 && (octets[1] >= 64 && octets[1] <= 127);
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface BookmarkMeta {
  id: number;
  tags: string[];
  url: string;
  articleUrl?: string;
  unread?: boolean;
}

type MetaRecord = Record<string, BookmarkMeta>;

function renderIndex(snapshotDir: string, filterTag: string, isTrusted: boolean): string {
  const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
  const metaPath = path.join(snapshotDir, "meta.json");
  const meta: MetaRecord = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  const rows = files.map((f) => {
    const name = f.replace(/-\d+\.html$/, "");
    const bm = meta[f];
    const bmLink = bm
      ? `<a href="${esc(bm.url)}" target="_blank" style="color:${Colors.green}">#${bm.id}</a>`
      : "";
    const tags = bm && bm.tags && bm.tags.length
      ? bm.tags.filter((t) => t !== filterTag).map((t) => `<span style="display:inline-block;font-family:'Fira Code',monospace;font-size:11px;padding:2px 8px;border-radius:3px;margin-right:4px;background:${Colors.bgLighter};color:${Colors.yellow}">${esc(t)}</span>`).join("")
      : "";
    const isUnread = bm ? bm.unread !== false : true;
    const domainCell = bm && bm.articleUrl
      ? `<a href="${esc(bm.articleUrl)}" target="_blank" style="color:#8a8a7a;font-size:12px">${esc(extractDomain(bm.articleUrl))}</a>`
      : "";
    const readClass = isUnread ? "" : " is-read";
    const firstCell = bm
      ? `<span class="read-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;"></span>`
      : isTrusted
        ? `<form method="POST" action="/delete" style="display:inline"><input type="hidden" name="file" value="${esc(f)}"><button type="submit" class="del-btn" title="Delete snapshot&#10;Hold Alt/Option to skip confirmation" onclick="if(!event.altKey)return confirm('Delete ${esc(name)} — ${esc(f)}?')" style="background:none;border:none;color:${Colors.comment};cursor:pointer;font-size:14px;padding:2px 4px;line-height:1;">&times;</button></form>`
        : "";
    return `<tr class="${readClass}" style="border-bottom:1px solid ${Colors.bgLight}"><td style="padding:6px 8px;text-align:center;width:32px">${firstCell}</td><td style="padding:6px 12px;font-family:'Fira Code',monospace;font-size:13px">${bmLink}</td><td style="padding:6px 16px 6px 12px"><a href="${esc(f)}" target="_blank" style="color:${Colors.orange}">${esc(name)}</a></td><td style="padding:6px 16px 6px 12px">${domainCell}</td><td style="padding:6px 16px 6px 12px">${tags}</td></tr>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Snapshots</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing:border-box;margin:0;padding:0; }
    body { background:${Colors.bg};color:${Colors.fg};font-family:'Inter',sans-serif;min-height:100vh; }
    a { text-decoration:none; }
    a:hover { text-decoration:underline; }
    .btn { display:inline-block;padding:6px 14px;border-radius:4px;font-size:13px;font-family:'Inter',sans-serif;cursor:pointer;border:none;transition:opacity .15s; }
    .btn:hover { opacity:0.85;text-decoration:none; }
    table { width:100%;border-collapse:collapse; }
    thead th { padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${Colors.comment};border-bottom:2px solid ${Colors.comment};font-weight:500; }
    tbody tr:hover { background:${Colors.bgLight}; }
    .read-dot { background:${Colors.bgLighter}; }
    tr.is-read .read-dot { background:${Colors.green}; }
    tr.is-read td:nth-child(2) a { color:${Colors.comment}; }
  </style>
</head>
<body>
  <div style="max-width:960px;margin:0 auto;padding:32px 24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <h1 style="font-size:22px;font-weight:700;color:${Colors.fg}">Snapshots</h1>
      <span style="color:${Colors.comment};font-size:13px">${files.length}</span>
      <div style="flex:1;min-width:8px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/download.zip" class="btn" style="background:${Colors.green};color:${Colors.bg}">Download ZIP</a>
        <a href="/sync" class="btn" style="background:${Colors.magenta};color:${Colors.bg}">Sync</a>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table id="snapshots">
        <thead><tr>
          <th style="width:32px"></th><th class="sort" onclick="sortTable(1)">ID</th><th class="sort" onclick="sortTable(2)" style="min-width:300px;width:40%">Title</th><th>Domain</th><th>Tags</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
  <script>
    let sortedOrderStateIsAsc = true;
    let currentCol = 1;
    function sortTable(col) {
      if (currentCol !== col) { sortedOrderStateIsAsc = false; }
      sortedOrderStateIsAsc = !sortedOrderStateIsAsc;
      currentCol = col;
      const t = document.getElementById("snapshots"),
        rows = Array.from(t.querySelectorAll("tbody tr"));
      rows.sort((a, b) => {
        let x = a.cells[col].textContent.trim(), y = b.cells[col].textContent.trim();
        const sortOrder = isNaN(x - y) ? x.localeCompare(y) : x - y;
        return sortedOrderStateIsAsc ? sortOrder : -1 * sortOrder;
      });
      rows.forEach(r => t.querySelector("tbody").appendChild(r));
    }
    sortTable(1);
  </script>
</body>
</html>`;
}

export interface CreateAppOptions {
  snapshotDir: string;
  syncFn: SyncFn;
  tag?: string;
  logger: Logger;
}

export function createApp({ snapshotDir, syncFn, tag = "Offline", logger }: CreateAppOptions) {
  const app = express();
  let syncing = false;
  let zipCache: ZipCache | null = null;

  function zipFileHash(): string {
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
    const parts = files.map((f) => `${f}:${fs.statSync(path.join(snapshotDir, f)).mtimeMs}`);
    return parts.join("|");
  }

  function invalidateZipCache(): void {
    zipCache = null;
  }
  app.set("trust proxy", true);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.urlencoded({ extended: false }));

  const trustCheck = (req: Request, _res: Response, next: NextFunction): void => {
    req.isTrusted = isTailscaleIp(req.ip);
    next();
  };

  app.use((req: Request, _res: Response, next: NextFunction): void => {
    const ip = safeIp(req.ip);
    logger.info(`${ip} - ${req.method} ${req.url}`);
    if (!isTailscaleIp(req.ip)) {
      logger.toExternal(`${ip} - ${req.method} ${req.url}`);
    }
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (req.path.endsWith(".html")) {
      express.static(snapshotDir)(req, res, next);
    } else {
      next();
    }
  });

  app.get("/", trustCheck, (req: Request, res: Response) => {
    res.type("html").send(renderIndex(snapshotDir, tag, req.isTrusted!));
  });

  app.get("/download.zip", (req: Request, res: Response) => {
    const ip = safeIp(req.ip);
    const hash = zipFileHash();
    if (zipCache && zipCache.hash === hash) {
      logger.info(`${ip} - ZIP download served from cache (${zipCache.count} files)`);
      res.type("application/zip").attachment("snapshots.zip").send(zipCache.buffer);
      return;
    }
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
    logger.info(`${ip} - ZIP download requested (${files.length} files)`);
    res.type("application/zip").attachment("snapshots.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err: Error) => {
        logger.error(`ZIP archive error: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: { message: "ZIP creation failed" } });
        }
      });
    const pass = new PassThrough();
    const chunks: Buffer[] = [];
    pass.on("data", (chunk: Buffer) => chunks.push(chunk));
    pass.on("end", () => {
      zipCache = { buffer: Buffer.concat(chunks), hash, count: files.length };
    });
    archive.pipe(pass);
    pass.pipe(res);
    // @ts-expect-error - archiver type mismatch with actual package
    archive.append(renderIndex(snapshotDir, tag), { name: "index.html" });
    for (const f of files) {
      archive.file(path.join(snapshotDir, f), { name: f });
    }
    archive.finalize();
  });

  app.get("/sync", async (req: Request, res: Response) => {
    const ip = safeIp(req.ip);
    if (syncing) {
      logger.info(`${ip} - Sync skipped (already in progress)`);
      return res.redirect("/");
    }
    syncing = true;
    logger.info(`${ip} - Sync triggered via HTTP`);
    try {
      await syncFn();
      invalidateZipCache();
      res.redirect("/");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`Sync failed: ${msg}`);
      res.status(500).type("text/plain").send("Sync failed. Check server logs for details.\n");
    } finally {
      syncing = false;
    }
  });

  app.post("/delete", trustCheck, (req: Request, res: Response) => {
    if (!req.isTrusted) { res.status(403).type("text/plain").send("Forbidden\n"); return; }
    const file = req.body.file;
    if (!file) { res.status(400).type("text/plain").send("Missing file parameter\n"); return; }
    if (typeof file !== "string" || file.includes("/") || file.includes("..")) { res.status(400).type("text/plain").send("Invalid filename\n"); return; }
    const filePath = path.join(snapshotDir, file);
    if (!fs.existsSync(filePath)) { res.status(404).type("text/plain").send("File not found\n"); return; }
    fs.unlinkSync(filePath);
    const metaPath = path.join(snapshotDir, "meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      delete meta[file];
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
    logger.info(`Deleted: ${file}`);
    invalidateZipCache();
    res.redirect("/");
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(500).json({ error: { message: "Internal server error" } });
  });

  return app;
}

function makeApiGet(base: string, token: string): ApiGet {
  const headers: Record<string, string> = token ? { Authorization: `Token ${token}`, Connection: "close" } : { Connection: "close" };
  const mod = base.startsWith("https") ? https : http;
  return function apiGet(url: string): ReturnType<ApiGet> {
    const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
    return new Promise((resolve, reject) => {
      const req = mod.get(fullUrl, { headers }, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let body = "";
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode} from ${url}`)));
          return;
        }
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url}: ${e instanceof Error ? e.message : String(e)}`));
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error(`Request timeout: ${url}`));
      });
    });
  };
}

function makeDownloadFile(base: string, token: string): DownloadFile {
  const headers: Record<string, string> = token ? { Authorization: `Token ${token}`, Connection: "close" } : { Connection: "close" };
  const mod = base.startsWith("https") ? https : http;
  return function downloadFile(url: string, dest: string): Promise<void> {
    const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const cleanup = (): void => {
        try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
      };
      const req = mod.get(fullUrl, { headers }, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          cleanup();
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        res.on("error", (e: Error) => { cleanup(); reject(e); });
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve());
        });
      });
      req.on("error", (e: Error) => {
        cleanup();
        reject(e);
      });
      req.setTimeout(30000, () => {
        req.destroy();
        cleanup();
        reject(new Error(`Request timeout: ${url}`));
      });
    });
  };
}

function main(): void {
  const base = (process.env.LINKDING_URL || "").replace(/\/+$/, "");
  const token = process.env.LINKDING_TOKEN || "";
  const tag = process.env.LINKDING_TAG || "Offline";
  const port = parseInt(process.env.PORT || "8080", 10);
  const snapshotDir = process.env.SNAPSHOT_DIR || "/snapshots";
  const syncOnStart = (process.env.SYNC_ON_START || "true").toLowerCase() === "true";
  const delay = parseInt(process.env.SYNC_DELAY || "200", 10);

  const logDir = process.env.LOG_DIR || path.join(snapshotDir, "..", "logs");
  const logger = createLogger(logDir);

  if (!base) {
    logger.error("LINKDING_URL must be set");
    process.exit(1);
  }

  fs.mkdirSync(snapshotDir, { recursive: true });

  const apiGet = makeApiGet(base, token);
  const downloadFile = makeDownloadFile(base, token);

  const syncFn: SyncFn = () => sync({ base, snapshotDir, apiGet, downloadFile, tag, log: logger, delay });

  if (syncOnStart) {
    logger.info("Sync triggered on startup");
    syncFn().catch((e: Error) => logger.error(`Startup sync failed: ${e.message}`));
  }

  const app = createApp({ snapshotDir, syncFn, tag, logger });
  const server = app.listen(port, "0.0.0.0", () => {
    logger.info(`Serving snapshots on http://0.0.0.0:${port}/`);
  });
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down`);
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { SyncLogEntry };

if (require.main === module) {
  main();
}
