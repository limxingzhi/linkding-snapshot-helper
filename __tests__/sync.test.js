const fs = require("fs");
const path = require("path");
const { sync } = require("../sync");

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
const TMP = path.join(__dirname, "__fixtures__", "sync_tmp");

let linkding;

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

function makeApi(base) {
  return async function apiGet(url) {
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
      return { results: linkding.assets[bmId] || [] };
    }
    throw new Error(`Unexpected API call: ${url}`);
  };
}

function makeDownloader() {
  return async function downloadFile(url, dest) {
    const dlMatch = url.match(/\/api\/bookmarks\/(\d+)\/assets\/(\d+)\/download\//);
    if (dlMatch) {
      const bmId = parseInt(dlMatch[1], 10);
      const content = linkding.downloads[bmId];
      if (content) {
        fs.writeFileSync(dest, content);
        return;
      }
    }
    throw new Error(`Unexpected download: ${url}`);
  };
}

function runSync(bookmarks, assets, downloads, opts = {}) {
  linkding.bookmarks = bookmarks;
  linkding.assets = assets || {};
  linkding.downloads = downloads || {};
  const base = "https://linkding.test";
  return sync({
    base,
    snapshotDir: TMP,
    apiGet: makeApi(base),
    downloadFile: makeDownloader(),
    tag: opts.tag || "Offline",
    log: silentLog,
  });
}

describe("sync", () => {
  it("downloads a snapshot for a bookmark with an asset", async () => {
    const bookmarks = [{ id: 1, title: "My Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 1: "<html>content</html>" };

    await runSync(bookmarks, assets, downloads);

    const expectedFile = path.join(TMP, "My Page.html");
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

  it("replaces existing file when filename already exists on disk", async () => {
    fs.writeFileSync(path.join(TMP, "Page.html"), "old");
    const bookmarks = [{ id: 5, title: "Page" }];
    const assets = { 5: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 5: "new content" };

    await runSync(bookmarks, assets, downloads);

    expect(fs.readFileSync(path.join(TMP, "Page.html"), "utf8")).toBe("new content");
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
      1: "alpha",
      2: "beta",
      3: "gamma",
    };

    await runSync(bookmarks, assets, downloads);

    expect(fs.readFileSync(path.join(TMP, "Alpha.html"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(TMP, "Beta.html"), "utf8")).toBe("beta");
    expect(fs.readFileSync(path.join(TMP, "Gamma.html"), "utf8")).toBe("gamma");
  });

  it("uses sanitized title for filenames", async () => {
    const bookmarks = [{ id: 1, title: 'What: A "Great" Page?' }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 1: "content" };

    await runSync(bookmarks, assets, downloads);

    const expectedFile = path.join(TMP, "What A Great Page.html");
    expect(fs.existsSync(expectedFile)).toBe(true);
  });

  it("continues on errors for individual bookmarks", async () => {
    const bookmarks = [
      { id: 1, title: "Bad" },
      { id: 2, title: "Good" },
    ];
    const assets = {
      1: [{ id: 10, asset_type: "snapshot" }],
      2: [{ id: 20, asset_type: "snapshot" }],
    };

    const apiGet = async (url) => {
      if (url.includes("/bookmarks/1/")) throw new Error("API error");
      const base = "https://linkding.test";
      if (url.startsWith(`${base}/api/bookmarks/`) && !url.includes("/assets/")) {
        return { results: bookmarks, next: null, count: 2 };
      }
      if (url.includes("/bookmarks/2/assets/")) {
        return { results: assets[2] };
      }
      throw new Error(`Unexpected: ${url}`);
    };
    const downloadFile = async (url, dest) => {
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

    expect(fs.readFileSync(path.join(TMP, "Good.html"), "utf8")).toBe("good content");
  });

  it("returns log of all operations", async () => {
    const bookmarks = [{ id: 1, title: "Page" }];
    const assets = { 1: [{ id: 10, asset_type: "snapshot" }] };
    const downloads = { 1: "content" };

    const log = await runSync(bookmarks, assets, downloads);

    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "ok", title: "Page" });
  });
});
