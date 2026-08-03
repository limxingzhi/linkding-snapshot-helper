import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "../server";
import { execSync } from "child_process";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { Logger, SyncFn } from "../types";

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {}, toExternal: () => {} };
const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "snapshots");
const TMP_DIR = path.join(__dirname, "__fixtures__", "zip_tmp");

beforeAll(() => {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, "test-page.html"), "<html>hello</html>");
});

afterAll(() => {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

describe("Express server", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const noopSync = async () => [];
    app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: noopSync, logger: silentLog });
  });

  it("serves static TXT files from snapshot directory", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "test-page.txt"), "hello text");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/test-page.txt");
    expect(res.status).toBe(200);
    expect(res.text).toBe("hello text");

    fs.unlinkSync(path.join(FIXTURE_DIR, "test-page.txt"));
  });

  it("returns 404 for missing txt files", async () => {
    const res = await request(app).get("/nonexistent.txt");
    expect(res.status).toBe(404);
  });

  it("shows TXT download link in index when .txt file exists", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "article-txt.html"), "<html>a</html>");
    fs.writeFileSync(path.join(FIXTURE_DIR, "article-txt.txt"), "text version");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("TXT");
    expect(res.text).toContain('href="article-txt.txt"');

    fs.unlinkSync(path.join(FIXTURE_DIR, "article-txt.html"));
    fs.unlinkSync(path.join(FIXTURE_DIR, "article-txt.txt"));
  });

  it("ZIP download includes .txt files", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "page-zip.html"), "<html>p</html>");
    fs.writeFileSync(path.join(FIXTURE_DIR, "page-zip.txt"), "text content");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/download.zip").buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const zipPath = path.join(TMP_DIR, "out.zip");
    fs.writeFileSync(zipPath, res.body);
    execSync(`unzip -o ${zipPath} -d ${TMP_DIR}/txt_out`, { stdio: "pipe" });

    const extracted = fs.readdirSync(path.join(TMP_DIR, "txt_out"));
    expect(extracted).toContain("page-zip.html");
    expect(extracted).toContain("page-zip.txt");
    expect(fs.readFileSync(path.join(TMP_DIR, "txt_out", "page-zip.txt"), "utf8")).toBe("text content");

    fs.unlinkSync(path.join(FIXTURE_DIR, "page-zip.html"));
    fs.unlinkSync(path.join(FIXTURE_DIR, "page-zip.txt"));
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("POST /delete also removes the .txt counterpart", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "pair.html"), "<html>x</html>");
    fs.writeFileSync(path.join(FIXTURE_DIR, "pair.txt"), "text x");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").send("file=pair.html");
    expect(res.status).toBe(302);
    expect(fs.existsSync(path.join(FIXTURE_DIR, "pair.html"))).toBe(false);
    expect(fs.existsSync(path.join(FIXTURE_DIR, "pair.txt"))).toBe(false);
  });

  it("serves static HTML files from snapshot directory", async () => {
    const res = await request(app).get("/test-page.html");
    expect(res.status).toBe(200);
    expect(res.text).toBe("<html>hello</html>");
  });

  it("includes security headers from helmet", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("returns 404 for missing files", async () => {
    const res = await request(app).get("/nonexistent.html");
    expect(res.status).toBe(404);
  });

  it("does not serve meta.json via static files", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), '{"secret":"data"}');
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/meta.json");
    expect(res.status).toBe(404);

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("GET /sync triggers sync and redirects to /", async () => {
    const res = await request(app).get("/sync");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
  });

  it("GET /sync returns 500 without leaking internal error details", async () => {
    const failSync = async () => { throw new Error("secret-internal-url/api/token=abc"); };
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: failSync, logger: silentLog });

    const res = await request(app).get("/sync");
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("secret-internal-url");
    expect(res.text).not.toContain("token=abc");
  });

  it("handles uncaught errors with centralized error handler", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "throw.html"), "<html>ok</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });
    const origReaddir = fs.readdirSync;
    fs.readdirSync = () => { throw new Error("disk error"); };

    const res = await request(app).get("/download.zip");
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");

    fs.readdirSync = origReaddir;
    fs.unlinkSync(path.join(FIXTURE_DIR, "throw.html"));
  });

  it("GET /download.zip returns a zip containing all snapshots", async () => {
    const res = await request(app).get("/download.zip").buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const zipPath = path.join(TMP_DIR, "out.zip");
    fs.writeFileSync(zipPath, res.body);
    execSync(`unzip -o ${zipPath} -d ${TMP_DIR}/out`, { stdio: "pipe" });

    const extracted = fs.readdirSync(path.join(TMP_DIR, "out")).sort();
    expect(extracted).toContain("index.html");
    expect(extracted).toContain("test-page.html");
    expect(fs.readFileSync(path.join(TMP_DIR, "out", "test-page.html"), "utf8")).toBe("<html>hello</html>");
    expect(fs.readFileSync(path.join(TMP_DIR, "out", "index.html"), "utf8")).toContain("test-page");

    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("escapes bookmark URLs in index to prevent XSS", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: 'https://example.com"><script>alert(1)</script>' } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("https://example.com&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.text).not.toMatch(/href="[^"]*<script>/);

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("escapes single quotes in HTML output", async () => {
    const meta = { "test-page.html": { id: 1, tags: ["it's"], url: "https://example.com" } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("it&#39;s");

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("shows is-read class for bookmarks with unread=false", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: "https://example.com", unread: false } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("is-read");

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("does not show is-read class for unread bookmarks", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: "https://example.com", unread: true } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('class=""');
    expect(res.text).not.toMatch(/class="[^"]*is-read[^"]*"/);

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("filters the configured tag from displayed tags", async () => {
    const meta = { "test-page.html": { id: 1, tags: ["Offline", "other"], url: "https://example.com" } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], tag: "Offline", logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("other");
    expect(res.text).not.toContain("Offline");

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("POST /delete removes a snapshot file and redirects to /", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "delete-me.html"), "<html>x</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").send("file=delete-me.html");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
    expect(fs.existsSync(path.join(FIXTURE_DIR, "delete-me.html"))).toBe(false);
  });

  it("POST /delete removes stale meta.json entry", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "stale.html"), "<html>x</html>");
    const meta = { "keep.html": { id: 1 }, "stale.html": { id: 2 } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    await request(app).post("/delete").send("file=stale.html");

    const updated = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8"));
    expect(updated["keep.html"]).toBeDefined();
    expect(updated["stale.html"]).toBeUndefined();
    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("POST /delete returns 400 for missing file parameter", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").send("nope=1");
    expect(res.status).toBe(400);
  });

  it("POST /delete returns 400 for path traversal attempts", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").send("file=../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("POST /delete returns 404 for non-existent file", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").send("file=nonexistent.html");
    expect(res.status).toBe(404);
  });

  it("shows delete button for snapshots without meta entry", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/delete"');
  });

  it("skips concurrent sync when one is already in progress", async () => {
    let calls = 0;
    const slowSync = () => new Promise<[]>((r) => setTimeout(() => { calls++; r([]); }, 200));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: slowSync as () => Promise<[]>, logger: silentLog });

    const [, res2] = await Promise.all([
      request(app).get("/sync"),
      new Promise<any>((r) => setTimeout(() => r(request(app).get("/sync")), 30)),
    ]);
    expect(res2.status).toBe(302);
    expect(calls).toBe(1);
  });

  it("allows sync after previous sync completes", async () => {
    let calls = 0;
    const countingSync: SyncFn = async () => { calls++; return []; };
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: countingSync, logger: silentLog });

    await request(app).get("/sync");
    expect(calls).toBe(1);
    await request(app).get("/sync");
    expect(calls).toBe(2);
  });

  it("caches zip output and serves identical content on subsequent requests", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res1 = await request(app).get("/download.zip").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    const res2 = await request(app).get("/download.zip").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res1.body.equals(res2.body)).toBe(true);
  });

  it("invalidates zip cache after delete", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "cache-del.html"), "<html>x</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res1 = await request(app).get("/download.zip").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    await request(app).post("/delete").send("file=cache-del.html");
    const res2 = await request(app).get("/download.zip").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res1.body.equals(res2.body)).toBe(false);
    expect(fs.existsSync(path.join(FIXTURE_DIR, "cache-del.html"))).toBe(false);
  });

  it("does not show delete button for snapshots with meta entry", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: "https://example.com" } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('action="/delete"');

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("shows domain column linking to article URL", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: "https://linkd.example/bookmarks", articleUrl: "https://example.com/article" } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://example.com/article"');
    expect(res.text).toContain("example.com");

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("strips www. from domain display", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: "https://linkd.example/bookmarks", articleUrl: "https://www.example.com/article" } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain(">example.com<");
    expect(res.text).toContain('href="https://www.example.com/article"');

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("shows empty domain cell when articleUrl is missing", async () => {
    const meta = { "test-page.html": { id: 1, tags: [], url: "https://linkd.example/bookmarks" } };
    fs.writeFileSync(path.join(FIXTURE_DIR, "meta.json"), JSON.stringify(meta));
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<th>Domain</th>");

    fs.unlinkSync(path.join(FIXTURE_DIR, "meta.json"));
  });

  it("POST /delete returns 403 for non-Tailscale IP", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "nope.html"), "<html>x</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").set("X-Forwarded-For", "192.168.1.5").send("file=nope.html");
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(FIXTURE_DIR, "nope.html"))).toBe(true);
    fs.unlinkSync(path.join(FIXTURE_DIR, "nope.html"));
  });

  it("POST /delete succeeds for Tailscale IP", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "ts-del.html"), "<html>x</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").set("X-Forwarded-For", "100.100.50.25").send("file=ts-del.html");
    expect(res.status).toBe(302);
    expect(fs.existsSync(path.join(FIXTURE_DIR, "ts-del.html"))).toBe(false);
  });

  it("POST /delete succeeds for localhost", async () => {
    fs.writeFileSync(path.join(FIXTURE_DIR, "local-del.html"), "<html>x</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/delete").send("file=local-del.html");
    expect(res.status).toBe(302);
    expect(fs.existsSync(path.join(FIXTURE_DIR, "local-del.html"))).toBe(false);
  });

  it("shows delete button for Tailscale IP", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/").set("X-Forwarded-For", "100.100.50.25");
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/delete"');
  });

  it("hides delete button for non-Tailscale IP", async () => {
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/").set("X-Forwarded-For", "192.168.1.5");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('action="/delete"');
  });

  describe("external access logging", () => {
    it("calls toExternal for non-Tailscale IP", async () => {
      const calls: string[] = [];
      const testLog: Logger = { ...silentLog, toExternal: (m) => calls.push(m) };
      const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: testLog });

      await request(app).get("/test-page.html").set("X-Forwarded-For", "192.168.1.5");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toMatch(/^192\.168\.1\.5 - GET \/test-page\.html$/);
    });

    it("calls toExternal for public IP", async () => {
      const calls: string[] = [];
      const testLog: Logger = { ...silentLog, toExternal: (m) => calls.push(m) };
      const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: testLog });

      await request(app).get("/").set("X-Forwarded-For", "203.0.113.42");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toMatch(/^203\.0\.113\.42 - GET \/$/);
    });

    it("does not call toExternal for Tailscale IP", async () => {
      const calls: string[] = [];
      const testLog: Logger = { ...silentLog, toExternal: (m) => calls.push(m) };
      const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: testLog });

      await request(app).get("/").set("X-Forwarded-For", "100.100.50.25");
      expect(calls).toHaveLength(0);
    });

    it("does not call toExternal for localhost", async () => {
      const calls: string[] = [];
      const testLog: Logger = { ...silentLog, toExternal: (m) => calls.push(m) };
      const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: testLog });

      await request(app).get("/").send();
      expect(calls).toHaveLength(0);
    });
  });
});

describe("BASE_PATH routing", () => {
  afterEach(() => {
    delete process.env.BASE_PATH;
  });

  it("serves index at /snapd/ with prefixed action links", async () => {
    process.env.BASE_PATH = "/snapd";
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/snapd/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/snapd/delete"');
    expect(res.text).toContain('href="/snapd/download.zip"');
    expect(res.text).toContain('href="/snapd/sync"');
  });

  it("serves static HTML and TXT files under the base path", async () => {
    process.env.BASE_PATH = "/snapd";
    fs.writeFileSync(path.join(FIXTURE_DIR, "prefix-page.txt"), "prefix text");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const htmlRes = await request(app).get("/snapd/test-page.html");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.text).toBe("<html>hello</html>");

    const txtRes = await request(app).get("/snapd/prefix-page.txt");
    expect(txtRes.status).toBe(200);
    expect(txtRes.text).toBe("prefix text");

    fs.unlinkSync(path.join(FIXTURE_DIR, "prefix-page.txt"));
  });

  it("GET /snapd/sync redirects to /snapd/ after syncing", async () => {
    process.env.BASE_PATH = "/snapd";
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/snapd/sync");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/snapd/");
  });

  it("POST /snapd/delete removes a file and redirects to /snapd/", async () => {
    process.env.BASE_PATH = "/snapd";
    fs.writeFileSync(path.join(FIXTURE_DIR, "prefix-del.html"), "<html>x</html>");
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).post("/snapd/delete").send("file=prefix-del.html");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/snapd/");
    expect(fs.existsSync(path.join(FIXTURE_DIR, "prefix-del.html"))).toBe(false);
  });

  it("GET /snapd/download.zip returns a zip", async () => {
    process.env.BASE_PATH = "/snapd";
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/snapd/download.zip");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
  });

  it("returns 404 for unprefixed routes when BASE_PATH is set", async () => {
    process.env.BASE_PATH = "/snapd";
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/");
    expect(res.status).toBe(404);
  });

  it("normalizes BASE_PATH with trailing slash", async () => {
    process.env.BASE_PATH = "/snapd/";
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/snapd/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/snapd/delete"');
  });

  it("redirects bare BASE_PATH to BASE_PATH/ so relative links resolve", async () => {
    process.env.BASE_PATH = "/snapd";
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], logger: silentLog });

    const res = await request(app).get("/snapd");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/snapd/");
  });
});
