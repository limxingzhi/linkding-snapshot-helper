const request = require("supertest");
const fs = require("fs");
const path = require("path");
const { createApp } = require("../server");
const { execSync } = require("child_process");

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
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
  let app;

  beforeEach(() => {
    const noopSync = async () => [];
    app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: noopSync, logger: silentLog });
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
      const chunks = [];
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
    expect(extracted).toEqual(["index.html", "test-page.html"]);
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

  it("GET /clean triggers clean and redirects to /", async () => {
    const noopClean = async () => ({ removed: [] });
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], cleanFn: noopClean, logger: silentLog });

    const res = await request(app).get("/clean");
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/");
  });

  it("GET /clean returns 500 without leaking internal error details", async () => {
    const failClean = async () => { throw new Error("secret-clean-url/api/token=xyz"); };
    const app = createApp({ snapshotDir: FIXTURE_DIR, syncFn: async () => [], cleanFn: failClean, logger: silentLog });

    const res = await request(app).get("/clean");
    expect(res.status).toBe(500);
    expect(res.text).not.toContain("secret-clean-url");
    expect(res.text).not.toContain("token=xyz");
  });
});
