require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { sync } = require("./sync");

function createApp({ snapshotDir, syncFn }) {
  const app = express();

  app.use(express.static(snapshotDir));

  app.get("/", (_req, res) => {
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
    const links = files.map((f) => `<li><a href="/${encodeURIComponent(f)}">${f.replace(/\.html$/, "")}</a></li>`).join("\n");
    res.type("html").send(`<!DOCTYPE html><html><body><h1>Snapshots</h1><a href="/download.zip" style="display:inline-block;margin-bottom:1em;padding:0.5em 1em;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px">Download all as ZIP</a><ul>${links}</ul></body></html>`);
  });

  app.get("/download.zip", (req, res) => {
    const files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")).sort();
    res.type("application/zip").attachment("snapshots.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    for (const f of files) {
      archive.file(path.join(snapshotDir, f), { name: f });
    }
    archive.finalize();
  });

  app.get("/sync", async (_req, res) => {
    await syncFn();
    res.type("text/plain").send("Sync complete\n");
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

  if (!base) {
    console.error("LINKDING_URL must be set");
    process.exit(1);
  }

  fs.mkdirSync(snapshotDir, { recursive: true });

  const apiGet = makeApiGet(base, token);
  const downloadFile = makeDownloadFile(base, token);

  const syncFn = () => sync({ base, snapshotDir, apiGet, downloadFile, tag });

  if (syncOnStart) {
    syncFn();
  }

  const app = createApp({ snapshotDir, syncFn });
  app.listen(port, "0.0.0.0", () => {
    console.log(`Serving snapshots on http://0.0.0.0:${port}/`);
  });
}

module.exports = { createApp };

if (require.main === module) {
  main();
}
