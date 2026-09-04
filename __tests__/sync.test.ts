import fs from "fs";
import path from "path";
import { sync, clean } from "../sync";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ApiGet, DownloadFile, Logger, LinkdingBookmark, LinkdingAsset } from "../types";

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, toExternal: () => {} };
const TMP = path.join(__dirname, "__fixtures__", "sync_tmp");

interface LinkdingState {
  bookmarks: LinkdingBookmark[];
  assets: Record<number, LinkdingAsset[]>;
  downloads: Record<number, string>;
}

let linkding: LinkdingState;

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  linkding = {
    bookmarks: [],
    assets: {},
    downloads: {},
  };
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

function makeApi(base: string): ApiGet {
  return async function apiGet(url: string) {
    const bookmarksPath = `${base}/api/bookmarks/`;
    if (url.startsWith(bookmarksPath) && !url.includes("/assets/")) {
      const u = new URL(url);
      const search = u.searchParams;
      const offset = parseInt(search.get("offset") || "0", 10);
      const limit = parseInt(search.get("limit") || "100", 10);
      const slice = linkding.bookmarks.slice(offset, offset + limit);
      return {
        results: slice,
        next:
          offset + limit < linkding.bookmarks.length
            ? `${bookmarksPath}?limit=${limit}&offset=${offset + limit}`
            : null,
        count: linkding.bookmarks.length,
      };
    }
    const assetMatch = url.match(/\/api\/bookmarks\/(\d+)\/assets\//);
    if (assetMatch) {
      const bmId = parseInt(assetMatch[1], 10);
      return { results: linkding.assets[bmId] || [], next: null, count: (linkding.assets[bmId] || []).length };
    }
    throw new Error(`Unexpected API call: ${url}`);
  };
}

function makeDownloader(): DownloadFile {
  return async function downloadFile(url: string, dest: string) {
    const dlMatch = url.match(/\/api\/bookmarks\/(\d+)\/assets\/(\d+)\/download\//);
    if (dlMatch) {
      const assetId = parseInt(dlMatch[2], 10);
      const content = linkding.downloads[assetId];
      if (content) {
        fs.writeFileSync(dest, content);
        return;
      }
    }
    throw new Error(`Unexpected download: ${url}`);
  };
}

function runSync(bookmarks: LinkdingBookmark[], assets?: Record<number, LinkdingAsset[]>, downloads?: Record<number, string>, opts: { tag?: string; retries?: number; retryDelay?: number; downloadFile?: DownloadFile } = {}) {
  linkding.bookmarks = bookmarks;
  linkding.assets = assets || {};
  linkding.downloads = downloads || {};
  const base = "https://linkding.test";
  return sync({
    base,
    snapshotDir: TMP,
    apiGet: makeApi(base),
    downloadFile: opts.downloadFile || makeDownloader(),
    tag: opts.tag || "Offline",
    log: silentLog,
    skipTxt: true,
    retries: opts.retries,
    retryDelay: opts.retryDelay,
  });
}

describe("sync", () => {
  it("downloads a snapshot for a bookmark with an asset", async () => {
    const bookmarks = [{ id: 1, title: "My Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "<html>content</html>" };

    await runSync(bookmarks, assets, downloads);

    const expectedFile = path.join(TMP, "My Page-1.html");
    expect(fs.existsSync(expectedFile)).toBe(true);
    expect(fs.readFileSync(expectedFile, "utf8")).toBe("<html>content</html>");
  });

  it("skips bookmarks with no snapshot asset", async () => {
    const bookmarks = [{ id: 1, title: "No Snap" }];
    const assets = { 1: [{ id: 10, asset_type: "pdf" }] };

    await runSync(bookmarks, assets, {});

    const files = fs.readdirSync(TMP).filter((f) => f.endsWith(".html"));
    expect(files).toHaveLength(0);
  });

  it("skips download when filename already exists on disk", async () => {
    fs.writeFileSync(path.join(TMP, "Page-5.html"), "old");
    const bookmarks = [{ id: 5, title: "Page" }];
    const assets = { 5: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "new content" };

    await runSync(bookmarks, assets, downloads);

    expect(fs.readFileSync(path.join(TMP, "Page-5.html"), "utf8")).toBe("old");
    const htmlFiles = fs.readdirSync(TMP).filter((f) => f.endsWith(".html"));
    expect(htmlFiles).toHaveLength(1);
  });

  it("handles paginated bookmark responses", async () => {
    const bookmarks = [
      { id: 1, title: "Alpha" },
      { id: 2, title: "Beta" },
      { id: 3, title: "Gamma" },
    ];
    const assets = {
      1: [{ id: 10, asset_type: "snapshot" }],
      2: [{ id: 20, asset_type: "snapshot" }],
      3: [{ id: 30, asset_type: "snapshot" }],
    };
    const downloads = {
      10: "alpha",
      20: "beta",
      30: "gamma",
    };

    await runSync(bookmarks, assets, downloads);

    expect(fs.readFileSync(path.join(TMP, "Alpha-1.html"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(TMP, "Beta-2.html"), "utf8")).toBe("beta");
    expect(fs.readFileSync(path.join(TMP, "Gamma-3.html"), "utf8")).toBe("gamma");
  });

  it("uses sanitized title for filenames", async () => {
    const bookmarks = [{ id: 1, title: 'What: A "Great" Page?' }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const expectedFile = path.join(TMP, "What A Great Page-1.html");
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it("continues on errors for individual bookmarks", async () => {
    const bookmarks: LinkdingBookmark[] = [
      { id: 1, title: "Bad" },
      { id: 2, title: "Good" },
    ];
    const assets = {
      1: [{ id: 10, asset_type: "snapshot" }],
      2: [{ id: 20, asset_type: "snapshot" }],
    };

    const apiGet: ApiGet = async (url: string) => {
      if (url.includes("/bookmarks/1/")) throw new Error("API error");
      const base = "https://linkding.test";
      if (url.startsWith(`${base}/api/bookmarks/`) && !url.includes("/assets/")) {
        return { results: bookmarks, next: null, count: 2 };
      }
      if (url.includes("/bookmarks/2/assets/")) {
        return { results: assets[2], next: null, count: 1 };
      }
      throw new Error(`Unexpected: ${url}`);
    };
    const downloadFile: DownloadFile = async (url: string, dest: string) => {
      if (url.includes("/bookmarks/2/")) {
        fs.writeFileSync(dest, "good content");
      }
    };

    await sync({
      base: "https://linkding.test",
      snapshotDir: TMP,
      apiGet,
      downloadFile,
      log: silentLog,
    });

    expect(fs.readFileSync(path.join(TMP, "Good-2.html"), "utf8")).toBe("good content");
  });

  it("retries transient download failures and succeeds", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    let calls = 0;
    const downloadFile: DownloadFile = async (_url: string, dest: string) => {
      calls++;
      if (calls < 3) {
        const e: NodeJS.ErrnoException = new Error("socket hang up");
        e.code = "ECONNRESET";
        throw e;
      }
      fs.writeFileSync(dest, "content");
    };

    await runSync(bookmarks, assets, {}, { downloadFile, retryDelay: 5 });

    expect(fs.readFileSync(path.join(TMP, "Page-1.html"), "utf8")).toBe("content");
    expect(calls).toBe(3);
  });

  it("gives up after retries for persistent download failures", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    let calls = 0;
    const downloadFile: DownloadFile = async () => {
      calls++;
      const e: NodeJS.ErrnoException = new Error("socket hang up");
      e.code = "ECONNRESET";
      throw e;
    };

    const log = await runSync(bookmarks, assets, {}, { downloadFile, retryDelay: 5 });

    expect(calls).toBe(3);
    expect(log[0]).toMatchObject({ status: "error" });
  });

  it("does not retry non-transient download errors", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    let calls = 0;
    const downloadFile: DownloadFile = async () => {
      calls++;
      throw new Error("HTTP 403 from url");
    };

    const log = await runSync(bookmarks, assets, {}, { downloadFile, retryDelay: 5 });

    expect(calls).toBe(1);
    expect(log[0]).toMatchObject({ status: "error" });
  });

  it("returns log of all operations", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    const log = await runSync(bookmarks, assets, downloads);

    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "ok", title: "Page" });
  });

  it("downloads the newest snapshot when multiple exist", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = {
      1: [
        { id: 10, asset_type: "snapshot", created_at: "2025-01-01T00:00:00Z" },
        { id: 20, asset_type: "snapshot", created_at: "2025-06-15T00:00:00Z" },
        { id: 30, asset_type: "snapshot", created_at: "2025-03-01T00:00:00Z" },
      ],
    };
    const downloads = { 10: "old", 20: "newest", 30: "middle" };

    await runSync(bookmarks, assets, downloads);

    expect(fs.readFileSync(path.join(TMP, "Page-1.html"), "utf8")).toBe("newest");
  });

  it("preserves metadata for skipped files on re-sync", async () => {
    const bookmarks = [{ id: 1, title: "Page", tag_names: ["tag1"] }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot", created_at: "2025-01-01T00:00:00Z" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const metaPath = path.join(TMP, "meta.json");
    const meta1 = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    expect(meta1["Page-1.html"]).toBeDefined();
    expect(meta1["Page-1.html"].tags).toEqual(["tag1"]);

    await runSync(bookmarks, assets, downloads);

    const meta2 = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    expect(meta2["Page-1.html"]).toBeDefined();
    expect(meta2["Page-1.html"].tags).toEqual(["tag1"]);
  });

  it("does not query assets for bookmarks whose file already exists", async () => {
    fs.writeFileSync(path.join(TMP, "Page-5.html"), "old");
    const bookmarks = [{ id: 5, title: "Page" }];
    const base = "https://linkding.test";
    let assetCalls = 0;
    const apiGet: ApiGet = async (url: string) => {
      if (url.includes("/bookmarks/5/assets/")) {
        assetCalls++;
        return { results: [], next: null, count: 0 };
      }
      return { results: bookmarks, next: null, count: 1 };
    };

    await sync({ base, snapshotDir: TMP, apiGet, downloadFile: makeDownloader(), log: silentLog, skipTxt: true });

    expect(assetCalls).toBe(0);
    expect(fs.readFileSync(path.join(TMP, "Page-5.html"), "utf8")).toBe("old");
  });

  it("records the downloaded asset id in meta.json", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot", created_at: "2025-01-01T00:00:00Z" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Page-1.html"].assetId).toBe(10);
  });

  it("skips re-download when the newest snapshot is unchanged after a rename", async () => {
    const assets = { 1: [{ id: 10, asset_type: "snapshot", created_at: "2025-01-01T00:00:00Z" }] };
    const downloads = { 10: "content" };

    await runSync([{ id: 1, title: "Original" }], assets, downloads);
    expect(fs.existsSync(path.join(TMP, "Original-1.html"))).toBe(true);

    const log = await runSync([{ id: 1, title: "Renamed" }], assets, downloads);

    expect(fs.existsSync(path.join(TMP, "Renamed-1.html"))).toBe(false);
    expect(fs.existsSync(path.join(TMP, "Original-1.html"))).toBe(true);
    expect(log[0]).toMatchObject({ status: "skip", reason: "snapshot unchanged" });
    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Original-1.html"]).toBeDefined();
    expect(meta["Renamed-1.html"]).toBeUndefined();
  });
});

describe("clean", () => {
  const base = "https://linkding.test";

  function runClean(bookmarks?: LinkdingBookmark[]) {
    linkding.bookmarks = bookmarks || [];
    return clean({
      base,
      snapshotDir: TMP,
      apiGet: makeApi(base),
      tag: "Offline",
      log: silentLog,
    });
  }

  it("removes files with no matching bookmark", async () => {
    fs.writeFileSync(path.join(TMP, "Orphan-99.html"), "<html>old</html>");
    fs.writeFileSync(path.join(TMP, "Active-1.html"), "<html>keep</html>");

    const result = await runClean([{ id: 1, title: "Active" }]);

    expect(fs.existsSync(path.join(TMP, "Orphan-99.html"))).toBe(false);
    expect(fs.existsSync(path.join(TMP, "Active-1.html"))).toBe(true);
    expect(result.removed).toEqual(["Orphan-99.html"]);
  });

  it("clean removes .txt file when .html is orphaned", async () => {
    fs.writeFileSync(path.join(TMP, "Orphan-99.html"), "<html>old</html>");
    fs.writeFileSync(path.join(TMP, "Orphan-99.txt"), "orphan text");

    const result = await runClean([]);

    expect(fs.existsSync(path.join(TMP, "Orphan-99.html"))).toBe(false);
    expect(fs.existsSync(path.join(TMP, "Orphan-99.txt"))).toBe(false);
    expect(result.removed).toContain("Orphan-99.html");
    expect(result.removed).toContain("Orphan-99.txt");
  });

  it("clean removes stale entries from meta.json", async () => {
    fs.writeFileSync(path.join(TMP, "Keep-1.html"), "<html>a</html>");
    fs.writeFileSync(path.join(TMP, "Gone-2.html"), "<html>b</html>");
    const meta = {
      "Keep-1.html": { id: 1, tags: [], url: "http://example.com/1" },
      "Gone-2.html": { id: 2, tags: [], url: "http://example.com/2" },
    };
    fs.writeFileSync(path.join(TMP, "meta.json"), JSON.stringify(meta));

    await runClean([{ id: 1, title: "Keep" }]);

    const updated = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(updated["Keep-1.html"]).toBeDefined();
    expect(updated["Gone-2.html"]).toBeUndefined();
  });

  it("does nothing when all files are linked", async () => {
    fs.writeFileSync(path.join(TMP, "Page-1.html"), "<html>a</html>");
    fs.writeFileSync(path.join(TMP, "Other-2.html"), "<html>b</html>");

    const result = await runClean([{ id: 1, title: "Page" }, { id: 2, title: "Other" }]);

    expect(result.removed).toEqual([]);
    expect(fs.readdirSync(TMP).filter((f) => f.endsWith(".html"))).toHaveLength(2);
  });

  it("removes files that do not match the filename pattern", async () => {
    fs.writeFileSync(path.join(TMP, "noid.html"), "<html>nope</html>");
    fs.writeFileSync(path.join(TMP, "Page-1.html"), "<html>keep</html>");

    const result = await runClean([{ id: 1, title: "Page" }]);

    expect(fs.existsSync(path.join(TMP, "noid.html"))).toBe(false);
    expect(result.removed).toEqual(["noid.html"]);
  });

  it("stores articleUrl in meta from bookmark", async () => {
    const bookmarks: LinkdingBookmark[] = [{ id: 1, title: "Page", url: "https://example.com/article" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Page-1.html"].articleUrl).toBe("https://example.com/article");
  });

  it("stores articleUrl in meta for skipped bookmarks on re-sync", async () => {
    fs.writeFileSync(path.join(TMP, "Page-1.html"), "existing");
    const bookmarks: LinkdingBookmark[] = [{ id: 1, title: "Page", url: "https://example.com/article", tag_names: ["tag1"] }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Page-1.html"].articleUrl).toBe("https://example.com/article");
  });

  it("stores unread=true in meta for unread bookmarks", async () => {
    const bookmarks: LinkdingBookmark[] = [{ id: 1, title: "Page", unread: true }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Page-1.html"].unread).toBe(true);
  });

  it("stores unread=false in meta for read bookmarks", async () => {
    const bookmarks: LinkdingBookmark[] = [{ id: 1, title: "Page", unread: false }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Page-1.html"].unread).toBe(false);
  });

  it("defaults to unread=true when field is absent", async () => {
    const bookmarks: LinkdingBookmark[] = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "content" };

    await runSync(bookmarks, assets, downloads);

    const meta = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(meta["Page-1.html"].unread).toBe(true);
  });

  it("generates .txt file alongside .html when skipTxt is false", async () => {
    const bookmarks: LinkdingBookmark[] = [{ id: 1, title: "Txt Test" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 10: "<html><body><p>Hello world</p></body></html>" };

    linkding.bookmarks = bookmarks;
    linkding.assets = assets;
    linkding.downloads = downloads;
    const base = "https://linkding.test";
    await sync({
      base,
      snapshotDir: TMP,
      apiGet: makeApi(base),
      downloadFile: makeDownloader(),
      log: silentLog,
      skipTxt: false,
    });

    expect(fs.existsSync(path.join(TMP, "Txt Test-1.html"))).toBe(true);
    expect(fs.existsSync(path.join(TMP, "Txt Test-1.txt"))).toBe(true);
    const txtContent = fs.readFileSync(path.join(TMP, "Txt Test-1.txt"), "utf8");
    expect(txtContent).toContain("Hello world");
  }, 30000);

  it("clean updates unread state for surviving bookmarks", async () => {
    fs.writeFileSync(path.join(TMP, "Page-1.html"), "<html>a</html>");
    const meta = { "Page-1.html": { id: 1, tags: [], url: "http://example.com/1", unread: true } };
    fs.writeFileSync(path.join(TMP, "meta.json"), JSON.stringify(meta));

    await runClean([{ id: 1, title: "Page", unread: false }]);

    const updated = JSON.parse(fs.readFileSync(path.join(TMP, "meta.json"), "utf8"));
    expect(updated["Page-1.html"].unread).toBe(false);
  });
});
