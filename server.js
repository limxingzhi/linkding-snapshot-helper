require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { sync } = require("./sync");
const { clean } = require("./sync");
const { createLogger } = require("./logger");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderIndex(snapshotDir) {
  const M = { bg:"#272822", bgLight:"#3e3d32", bgLighter:"#49483e", fg:"#f8f8f2", comment:"#75715e", yellow:"#e6db74", orange:"#fd971f", green:"#a6e22e", magenta:"#ae81ff", blue:"#66d9ef" };
  const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
  const metaPath = path.join(snapshotDir, "meta.json");
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  const rows = files.map((f) => {
    const name = f.replace(/-\d+\.html$/, "");
    const bm = meta[f];
    const bmLink = bm
      ? `<a href="${esc(bm.url)}" target="_blank" style="color:${M.green}">#${bm.id}</a>`
      : "";
    const tags = bm && bm.tags && bm.tags.length
      ? bm.tags.map((t) => `<span style="display:inline-block;font-family:'Fira Code',monospace;font-size:11px;padding:2px 8px;border-radius:3px;margin-right:4px;background:${M.bgLighter};color:${M.yellow}">${esc(t)}</span>`).join("")
      : "";
    return `<tr style="border-bottom:1px solid ${M.bgLight}"><td style="padding:6px 12px;font-family:'Fira Code',monospace;font-size:13px">${bmLink}</td><td style="padding:6px 16px 6px 12px"><a href="${esc(f)}" target="_blank" style="color:${M.orange}">${esc(name)}</a></td><td style="padding:6px 16px 6px 12px">${tags}</td></tr>`;
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
    body { background:${M.bg};color:${M.fg};font-family:'Inter',sans-serif;min-height:100vh; }
    a { text-decoration:none; }
    a:hover { text-decoration:underline; }
    .btn { display:inline-block;padding:6px 14px;border-radius:4px;font-size:13px;font-family:'Inter',sans-serif;cursor:pointer;border:none;transition:opacity .15s; }
    .btn:hover { opacity:0.85;text-decoration:none; }
    table { width:100%;border-collapse:collapse; }
    thead th { padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${M.comment};border-bottom:2px solid ${M.comment};font-weight:500;cursor:pointer; }
    tbody tr:hover { background:${M.bgLight}; }
  </style>
</head>
<body>
  <div style="max-width:960px;margin:0 auto;padding:32px 24px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <h1 style="font-size:22px;font-weight:700;color:${M.fg}">Snapshots</h1>
      <span style="color:${M.comment};font-size:13px">${files.length}</span>
      <div style="flex:1;min-width:8px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/download.zip" class="btn" style="background:${M.green};color:${M.bg}">Download ZIP</a>
        <a href="/sync" class="btn" style="background:${M.magenta};color:${M.bg}">Sync</a>
        <a href="/clean" class="btn" style="background:${M.blue};color:${M.bg}">Clean</a>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table id="snapshots">
        <thead><tr>
          <th class="sort" onclick="sortTable(0)">ID</th><th class="sort" onclick="sortTable(1)">Title</th><th>Tags</th>
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
    sortTable(0);
  </script>
</body>
</html>`;
}

function createApp({ snapshotDir, syncFn, cleanFn = async () => {}, logger }) {
  const app = express();
  app.set("trust proxy", true);
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use((req, _res, next) => {
    const ip = req.ip;
    logger.info(`${req.method} ${req.url} - ${ip}`);
    next();
  });

  app.use((req, res, next) => {
    if (req.path.endsWith(".html")) {
      express.static(snapshotDir)(req, res, next);
    } else {
      next();
    }
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderIndex(snapshotDir));
  });

  app.get("/download.zip", (req, res) => {
    const ip = req.ip;
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
    logger.info(`ZIP download requested (${files.length} files) - ${ip}`);
    res.type("application/zip").attachment("snapshots.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      logger.error(`ZIP archive error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: { message: "ZIP creation failed" } });
      }
    });
    archive.pipe(res);
    archive.append(renderIndex(snapshotDir), { name: "index.html" });
    for (const f of files) {
      archive.file(path.join(snapshotDir, f), { name: f });
    }
    archive.finalize();
  });

  app.get("/sync", async (req, res) => {
    const ip = req.ip;
    logger.info(`Sync triggered via HTTP - ${ip}`);
    try {
      await syncFn();
      res.redirect("/");
    } catch (e) {
      logger.error(`Sync failed: ${e.message}`);
      res.status(500).type("text/plain").send("Sync failed. Check server logs for details.\n");
    }
  });

  app.get("/clean", async (req, res) => {
    const ip = req.ip;
    logger.info(`Clean triggered via HTTP - ${ip}`);
    try {
      await cleanFn();
      res.redirect("/");
    } catch (e) {
      logger.error(`Clean failed: ${e.message}`);
      res.status(500).type("text/plain").send("Clean failed. Check server logs for details.\n");
    }
  });

  app.use((err, req, res, next) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(err.status || 500).json({ error: { message: "Internal server error" } });
  });

  return app;
}

function makeApiGet(base, token) {
  const headers = token ? { Authorization: `Token ${token}` } : {};
  const mod = base.startsWith("https") ? require("https") : require("http");
  return function apiGet(url) {
    const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
    return new Promise((resolve, reject) => {
      const req = mod.get(fullUrl, { headers }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
          }
        });
      });
      req.on("error", reject);
    });
  };
}

function makeDownloadFile(base, token) {
  const headers = token ? { Authorization: `Token ${token}` } : {};
  const mod = base.startsWith("https") ? require("https") : require("http");
  return function downloadFile(url, dest) {
    const fullUrl = url.startsWith("http") ? url : `${base}${url}`;
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const req = mod.get(fullUrl, { headers }, (res) => {
        res.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      });
      req.on("error", (e) => {
        fs.unlinkSync(dest);
        reject(e);
      });
    });
  };
}

function main() {
  const base = (process.env.LINKDING_URL || "").replace(/\/+$/, "");
  const token = process.env.LINKDING_TOKEN || "";
  const tag = process.env.LINKDING_TAG || "Offline";
  const port = parseInt(process.env.PORT || "8080", 10);
  const snapshotDir = process.env.SNAPSHOT_DIR || "/snapshots";
  const syncOnStart = (process.env.SYNC_ON_START || "true").toLowerCase() === "true";

  const logDir = process.env.LOG_DIR || path.join(snapshotDir, "..", "logs");
  const logger = createLogger(logDir);

  if (!base) {
    logger.error("LINKDING_URL must be set");
    process.exit(1);
  }

  fs.mkdirSync(snapshotDir, { recursive: true });

  const apiGet = makeApiGet(base, token);
  const downloadFile = makeDownloadFile(base, token);

  const syncFn = () => sync({ base, snapshotDir, apiGet, downloadFile, tag, log: logger });

  if (syncOnStart) {
    logger.info("Sync triggered on startup");
    syncFn().catch((e) => logger.error(`Startup sync failed: ${e.message}`));
  }

  const cleanFn = () => clean({ base, snapshotDir, apiGet, tag, log: logger });

  const app = createApp({ snapshotDir, syncFn, cleanFn, logger });
  app.listen(port, "0.0.0.0", () => {
    logger.info(`Serving snapshots on http://0.0.0.0:${port}/`);
  });
}

module.exports = { createApp };

if (require.main === module) {
  main();
}
