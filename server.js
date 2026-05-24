require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { sync } = require("./sync");
const { createLogger } = require("./logger");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderIndex(snapshotDir) {
  const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
  const metaPath = path.join(snapshotDir, "meta.json");
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  const rows = files.map((f) => {
    const name = f.replace(/\.html$/, "");
    const bm = meta[f];
    const bmLink = bm
      ? `<a href="${bm.url}" target="_blank" class="text-blue-400 hover:underline text-sm">#${bm.id}</a>`
      : "";
    const tags = bm && bm.tags && bm.tags.length
      ? bm.tags.map((t) => `<span class="inline-block text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 mr-1">${esc(t)}</span>`).join("")
      : "";
    return `<tr class="border-b border-gray-700 hover:bg-gray-800"><td class="py-1 pr-4 text-left">${bmLink}</td><td class="py-1 pr-4 text-left"><a href="${esc(f)}" target="_blank" class="text-blue-400 hover:underline">${esc(name)}</a></td><td class="py-1 text-left">${tags}</td></tr>`;
  }).join("\n");
  return `<!DOCTYPE html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snapshots</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-900 text-gray-100 min-h-screen"><div class="max-w-3xl mx-auto px-4 py-8"><h1 class="text-2xl font-bold mb-4">Snapshots</h1><a href="/download.zip" class="inline-block mb-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 no-underline text-sm font-medium">Download all as ZIP</a><div class="overflow-x-auto"><table class="w-full border-collapse" id="snapshots"><thead><tr class="border-b-2 border-gray-700"><th class="py-2 pr-4 text-left text-sm font-semibold text-gray-400 cursor-pointer select-none hover:text-gray-200" onclick="sortTable(0)">ID</th><th class="py-2 pr-4 text-left text-sm font-semibold text-gray-400 cursor-pointer select-none hover:text-gray-200" onclick="sortTable(1)">Title</th><th class="py-2 text-left text-sm font-semibold text-gray-400 cursor-pointer select-none hover:text-gray-200" onclick="sortTable(2)">Tags</th></tr></thead><tbody>${rows}</tbody></table></div></div><script>function sortTable(col){const t=document.getElementById("snapshots"),rows=Array.from(t.querySelectorAll("tbody tr"));let d=1;const k="sort-"+col;t.querySelector("thead th:nth-child("+(col+1)+")").classList.toggle(k);t.querySelectorAll("thead th").forEach((h,i)=>{if(i!==col)h.classList.remove("sort-"+i)});if(!t.querySelector("thead th:nth-child("+(col+1)+")").classList.contains(k))d=-1;rows.sort((a,b)=>{let x=a.cells[col].textContent.trim(),y=b.cells[col].textContent.trim();return isNaN(x-y)?x.localeCompare(y):x-y}).forEach(r=>t.querySelector("tbody").appendChild(r));rows.reverse()}</script></body></html>`;
}

function createApp({ snapshotDir, syncFn, logger }) {
  const app = express();
  app.set("trust proxy", true);

  app.use((req, _res, next) => {
    const ip = req.ip;
    logger.info(`${req.method} ${req.url} - ${ip}`);
    next();
  });

  app.use(express.static(snapshotDir));

  app.get("/", (req, res) => {
    res.type("html").send(renderIndex(snapshotDir));
  });

  app.get("/download.zip", (req, res) => {
    const ip = req.ip;
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
    logger.info(`ZIP download requested (${files.length} files) - ${ip}`);
    res.type("application/zip").attachment("snapshots.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
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
      res.status(500).type("text/plain").send(`Sync failed: ${e.message}\n`);
    }
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
    syncFn();
  }

  const app = createApp({ snapshotDir, syncFn, logger });
  app.listen(port, "0.0.0.0", () => {
    logger.info(`Serving snapshots on http://0.0.0.0:${port}/`);
  });
}

module.exports = { createApp };

if (require.main === module) {
  main();
}
