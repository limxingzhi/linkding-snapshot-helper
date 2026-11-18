import fs from "node:fs";
import path from "node:path";
import { sanitize } from "./sanitize";
import type {
  ApiGet,
  CleanOptions,
  LinkdingBookmark,
  MetaEntry,
  MetaRecord,
  SyncLogEntry,
  SyncOptions,
} from "./types";
import {
  BookmarkListResponseSchema,
  AssetListResponseSchema,
  MetaRecordSchema,
} from "./types";

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ECONNABORTED",
]);

export function isTransientError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (TRANSIENT_ERROR_CODES.has((e as NodeJS.ErrnoException).code || "")) return true;
  if (e.name === "TimeoutError" || e.name === "AbortError") return true;
  if (/socket hang up/i.test(e.message)) return true;
  return e.cause instanceof Error && isTransientError(e.cause);
}

async function withRetry<T>(fn: () => Promise<T>, retries: number, retryDelay: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= retries || !isTransientError(e)) throw e;
      await new Promise((r) => setTimeout(r, retryDelay * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function sync({
  base,
  snapshotDir,
  apiGet,
  downloadFile,
  tag = "Offline",
  log: logger,
  delay = 200,
  retries = 2,
  retryDelay = 1000,
}: SyncOptions): Promise<SyncLogEntry[]> {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const existing = new Set(fs.readdirSync(snapshotDir).filter((f) => f.endsWith(".html")));

  // Prior metadata: map each bookmark id to the file we already hold and the
  // asset id it was downloaded from. Lets us skip re-downloading when the
  // newest snapshot is unchanged, even if the title (and thus filename) changed.
  let metaOnDisk: MetaRecord = {};
  try {
    metaOnDisk = readMeta(snapshotDir);
  } catch {
    logger.warn("meta.json unreadable, starting with empty metadata");
  }
  const knownByBookmark = new Map<number, Array<{ filename: string; assetId?: number }>>();
  for (const [filename, rec] of Object.entries(metaOnDisk)) {
    if (!existing.has(filename)) continue;
    const known = knownByBookmark.get(rec.id) ?? [];
    known.push({ filename, assetId: rec.assetId });
    knownByBookmark.set(rec.id, known);
  }

  const bookmarks: LinkdingBookmark[] = [];
  let url: string | null = `${base}/api/bookmarks/?q=%23${encodeURIComponent(tag)}&limit=100`;
  while (url) {
    const currentUrl = url;
    const data = BookmarkListResponseSchema.parse(await withRetry(() => apiGet(currentUrl), retries, retryDelay));
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
    const commonFields = {
      tags: bm.tag_names || [],
      bookmarkUrl: `${base}/bookmarks?q=%23${tag}&details=${bmId}`,
      articleUrl: bm.url || "",
      unread: bm.unread !== false,
    };

    try {
      // The file already exists: nothing to do, and the asset lookup would be
      // wasted work. Skipping it keeps steady-state syncs to a few API calls.
      if (existing.has(filename)) {
        logger.info(`[${i + 1}/${bookmarks.length}] SKIP (already exists): ${safeTitle}`);
        log.push({
          status: "skip",
          title: safeTitle,
          reason: "already exists",
          filename,
          bookmarkId: bmId,
          ...commonFields,
          assetId: metaOnDisk[filename]?.assetId,
        });
        continue;
      }

      // Only bookmarks without a matching file need an asset lookup.
      const assetsData = AssetListResponseSchema.parse(
        await withRetry(() => apiGet(`${base}/api/bookmarks/${bmId}/assets/`), retries, retryDelay),
      );
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

      // The newest snapshot is one we already downloaded under an older
      // filename (the bookmark was renamed, so the title-derived filename no
      // longer matches). Re-downloading would duplicate the same content.
      const known = knownByBookmark.get(bmId)?.find((k) => k.assetId != null && k.assetId === assetId);
      if (known) {
        logger.info(`[${i + 1}/${bookmarks.length}] SKIP (snapshot unchanged): ${safeTitle}`);
        log.push({
          status: "skip",
          title: safeTitle,
          reason: "snapshot unchanged",
          filename: known.filename,
          bookmarkId: bmId,
          ...commonFields,
          assetId,
        });
        continue;
      }

      const filepath = path.join(snapshotDir, filename);
      await withRetry(() => downloadFile(`${base}/api/bookmarks/${bmId}/assets/${assetId}/download/`, filepath), retries, retryDelay);

      // Pace requests to linkding: throttle real downloads only, not skips.
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }

      const size = fs.statSync(filepath).size;
      logger.info(`[${i + 1}/${bookmarks.length}] OK: ${filename} (${size.toLocaleString()} bytes)`);

      log.push({
        status: "ok",
        title: safeTitle,
        filename,
        size,
        bookmarkId: bmId,
        ...commonFields,
        assetId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[${i + 1}/${bookmarks.length}] ERROR: ${safeTitle} - ${msg}`);
      log.push({ status: "error", title: safeTitle, error: msg });
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
        assetId: entry.assetId,
      };
    } else if (entry.status === "skip" && entry.filename && entry.bookmarkId && entry.bookmarkUrl) {
      meta[entry.filename] = {
        id: entry.bookmarkId,
        tags: entry.tags || [],
        url: entry.bookmarkUrl,
        articleUrl: entry.articleUrl || "",
        unread: entry.unread !== false,
        assetId: entry.assetId,
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

async function fetchAllBookmarks(apiGet: ApiGet, startUrl: string): Promise<LinkdingBookmark[]> {
  // Fetch all pages in parallel: the page count is known from the first response.
  const bookmarks: LinkdingBookmark[] = [];
  const first = BookmarkListResponseSchema.parse(await apiGet(startUrl));
  bookmarks.push(...first.results);
  const firstUrl = new URL(startUrl);
  const limit = parseInt(firstUrl.searchParams.get("limit") || "100", 10);
  const totalPages = Math.ceil(first.count / Math.max(1, limit));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, totalPages - 1) }, (_, k) => {
      const pageUrl = new URL(startUrl);
      pageUrl.searchParams.set("offset", String((k + 1) * limit));
      return apiGet(pageUrl.toString());
    }),
  );
  for (const page of rest) {
    bookmarks.push(...BookmarkListResponseSchema.parse(page).results);
  }
  return bookmarks;
}

export async function clean({
  base,
  snapshotDir,
  apiGet,
  tag = "Offline",
  log: logger,
}: CleanOptions): Promise<{ removed: string[] }> {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const allFiles = fs.readdirSync(snapshotDir);
  const htmlFiles = allFiles.filter((f) => f.endsWith(".html"));

  // Archived bookmarks are still linked to their local snapshot: the sync
  // query no longer returns them, but archiving should not delete the copy.
  const search = `?q=%23${encodeURIComponent(tag)}&limit=100`;
  const [active, archived] = await Promise.all([
    fetchAllBookmarks(apiGet, `${base}/api/bookmarks/${search}`),
    fetchAllBookmarks(apiGet, `${base}/api/bookmarks/archived/${search}`),
  ]);
  const bookmarks = [...active, ...archived];

  const activeIds = new Set(bookmarks.map((bm) => String(bm.id)));
  const bookmarkMap: Record<string, LinkdingBookmark> = {};
  for (const bm of bookmarks) {
    bookmarkMap[String(bm.id)] = bm;
  }
  const removed: string[] = [];

  // Remove orphan .html files
  for (const f of htmlFiles) {
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
  // Update unread in O(meta + bookmarks) instead of O(meta x bookmarks)
  const metaById = new Map<number, MetaEntry[]>();
  for (const entry of Object.values(meta)) {
    const byId = metaById.get(entry.id) ?? [];
    byId.push(entry);
    metaById.set(entry.id, byId);
  }
  for (const bm of bookmarks) {
    for (const entry of metaById.get(bm.id) ?? []) {
      entry.unread = bm.unread !== false;
    }
  }
  fs.writeFileSync(path.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2));

  logger.info(`Clean complete: ${removed.length} file(s) removed`);
  return { removed };
}
