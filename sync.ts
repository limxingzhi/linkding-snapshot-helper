import fs from "fs";
import path from "path";
import { sanitize } from "./sanitize";
import type {
  ApiGet,
  DownloadFile,
  Logger,
  LinkdingBookmark,
  SyncLogEntry,
  MetaRecord,
} from "./types";
import {
  BookmarkListResponseSchema,
  AssetListResponseSchema,
  MetaRecordSchema,
} from "./types";

export interface SyncOptions {
  base: string;
  snapshotDir: string;
  apiGet: ApiGet;
  downloadFile: DownloadFile;
  tag?: string;
  log: Logger;
  delay?: number;
}

export interface CleanOptions {
  base: string;
  snapshotDir: string;
  apiGet: ApiGet;
  tag?: string;
  log: Logger;
}

export async function sync({
  base,
  snapshotDir,
  apiGet,
  downloadFile,
  tag = "Offline",
  log: logger,
  delay = 200,
}: SyncOptions): Promise<SyncLogEntry[]> {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const existing = new Set(fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")));

  const bookmarks: LinkdingBookmark[] = [];
  let url: string | null = `${base}/api/bookmarks/?q=%23${encodeURIComponent(tag)}&limit=100`;
  while (url) {
    const data = BookmarkListResponseSchema.parse(await apiGet(url));
    bookmarks.push(...data.results);
    url = data.next;
  }

  logger.info(`Syncing ${bookmarks.length} bookmarks...`);

  const log: SyncLogEntry[] = [];

  for (let i = 0; i < bookmarks.length; i++) {
    const bm = bookmarks[i];
    const bmId = bm.id;
    const title = bm.title || "untitled";
    const safeTitle = sanitize(title);
    const filename = `${safeTitle}-${bmId}.html`;

    try {
      const assetsData = AssetListResponseSchema.parse(await apiGet(`${base}/api/bookmarks/${bmId}/assets/`));
      const snapshots = assetsData.results.filter((a) => a.asset_type === "snapshot");

      if (snapshots.length === 0) {
        logger.info(`[${i + 1}/${bookmarks.length}] SKIP (no snapshot): ${safeTitle}`);
        log.push({ status: "skip", title: safeTitle, reason: "no snapshot" });
        continue;
      }

      const asset = snapshots.reduce((a, b) =>
        (a.created_at || "") > (b.created_at || "") ? a : b
      );
      const assetId = asset.id;

      const filepath = path.join(snapshotDir, filename);
      if (existing.has(filename)) {
        logger.info(`[${i + 1}/${bookmarks.length}] SKIP (already exists): ${safeTitle}`);
        log.push({
          status: "skip",
          title: safeTitle,
          reason: "already exists",
          filename,
          bookmarkId: bmId,
          tags: bm.tag_names || [],
          bookmarkUrl: `${base}/bookmarks?q=%23${tag}&details=${bmId}`,
          articleUrl: bm.url || "",
          unread: bm.unread !== false,
        });
        continue;
      }

      await downloadFile(`${base}/api/bookmarks/${bmId}/assets/${assetId}/download/`, filepath);
      const size = fs.statSync(filepath).size;
      logger.info(`[${i + 1}/${bookmarks.length}] OK: ${filename} (${size.toLocaleString()} bytes)`);
      log.push({
        status: "ok",
        title: safeTitle,
        filename,
        size,
        bookmarkId: bmId,
        tags: bm.tag_names || [],
        bookmarkUrl: `${base}/bookmarks?q=%23${tag}&details=${bmId}`,
        articleUrl: bm.url || "",
        unread: bm.unread !== false,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[${i + 1}/${bookmarks.length}] ERROR: ${safeTitle} - ${msg}`);
      log.push({ status: "error", title: safeTitle, error: msg });
    } finally {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.info("Sync complete");

  const meta: MetaRecord = {};
  for (const entry of log) {
    if (entry.status === "ok") {
      meta[entry.filename] = {
        id: entry.bookmarkId,
        tags: entry.tags,
        url: entry.bookmarkUrl,
        articleUrl: entry.articleUrl,
        unread: entry.unread,
      };
    } else if (entry.status === "skip" && entry.filename && entry.bookmarkId && entry.bookmarkUrl) {
      meta[entry.filename] = {
        id: entry.bookmarkId,
        tags: entry.tags || [],
        url: entry.bookmarkUrl,
        articleUrl: entry.articleUrl || "",
        unread: entry.unread !== false,
      };
    }
  }
  fs.writeFileSync(path.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2));

  return log;
}

function readMeta(snapshotDir: string): MetaRecord {
  const metaPath = path.join(snapshotDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    return MetaRecordSchema.parse(JSON.parse(fs.readFileSync(metaPath, "utf8")));
  }
  return {};
}

export async function clean({
  base,
  snapshotDir,
  apiGet,
  tag = "Offline",
  log: logger,
}: CleanOptions): Promise<{ removed: string[] }> {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const existing = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html"));

  const bookmarks: LinkdingBookmark[] = [];
  let url: string | null = `${base}/api/bookmarks/?q=%23${encodeURIComponent(tag)}&limit=100`;
  while (url) {
    const data = BookmarkListResponseSchema.parse(await apiGet(url));
    bookmarks.push(...data.results);
    url = data.next;
  }

  const activeIds = new Set(bookmarks.map((bm) => String(bm.id)));
  const bookmarkMap: Record<string, LinkdingBookmark> = {};
  for (const bm of bookmarks) {
    bookmarkMap[String(bm.id)] = bm;
  }
  const removed: string[] = [];

  for (const f of existing) {
    const match = f.match(/-(\d+)\.html$/);
    if (!match || !activeIds.has(match[1])) {
      fs.unlinkSync(path.join(snapshotDir, f));
      removed.push(f);
      logger.info(`CLEAN: removed ${f}`);
    }
  }

  const meta = readMeta(snapshotDir);
  for (const f of removed) {
    delete meta[f];
  }
  for (const [id, bm] of Object.entries(bookmarkMap)) {
    const entry = Object.entries(meta).find(([, v]) => String(v.id) === id);
    if (entry) {
      entry[1].unread = bm.unread !== false;
    }
  }
  fs.writeFileSync(path.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2));

  logger.info(`Clean complete: ${removed.length} file(s) removed`);
  return { removed };
}
