const fs = require("fs");
const path = require("path");
const { sanitize } = require("./sanitize");

async function sync({ base, snapshotDir, apiGet, downloadFile, tag = "Offline", log: logger }) {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const existing = new Set(fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")));

  const bookmarks = [];
  let url = `${base}/api/bookmarks/?q=%23${tag}&limit=100`;
  while (url) {
    const data = await apiGet(url);
    bookmarks.push(...data.results);
    url = data.next || null;
  }

  logger.info(`Syncing ${bookmarks.length} bookmarks...`);

  const log = [];

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const bmId = bm.id;
    const title = bm.title || "untitled";
    const safeTitle = sanitize(title);
    let filename = `${safeTitle}.html`;

    try {
      const assetsData = await apiGet(`${base}/api/bookmarks/${bmId}/assets/`);
      const snapshots = assetsData.results.filter((a) => a.asset_type === "snapshot");

      if (snapshots.length === 0) {
        logger.info(`[${i + 1}/${bookmarks.length}] SKIP (no snapshot): ${safeTitle}`);
        log.push({ status: "skip", title: safeTitle, reason: "no snapshot" });
        continue;
      }

      const asset = snapshots[0];
      const assetId = asset.id;

      let filepath = path.join(snapshotDir, filename);
      if (existing.has(filename)) {
        fs.unlinkSync(filepath);
      }

      await downloadFile(`${base}/api/bookmarks/${bmId}/assets/${assetId}/download/`, filepath);
      const size = fs.statSync(filepath).size;
      logger.info(`[${i + 1}/${bookmarks.length}] OK: ${filename} (${size.toLocaleString()} bytes)`);
      log.push({ status: "ok", title: safeTitle, filename, size, bookmarkId: bmId, bookmarkUrl: `${base}/bookmarks?q=%23${tag}&details=${bmId}` });
    } catch (e) {
      logger.error(`[${i + 1}/${bookmarks.length}] ERROR: ${safeTitle} - ${e.message}`);
      log.push({ status: "error", title: safeTitle, error: e.message });
    }
  }

  logger.info("Sync complete");

  const meta = {};
  for (const entry of log) {
    if (entry.bookmarkUrl) {
      meta[entry.filename] = { id: entry.bookmarkId, url: entry.bookmarkUrl };
    }
  }
  fs.writeFileSync(path.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2));

  return log;
}

module.exports = { sync };
