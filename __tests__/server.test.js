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

  it("returns 404 for missing files", async () => {
    const res = await request(app).get("/nonexistent.html");
    expect(res.status).toBe(404);
  });

  it("GET /sync triggers sync and returns Sync complete", async () => {
    const res = await request(app).get("/sync");
    expect(res.status).toBe(200);
    expect(res.text).toBe("Sync complete\n");
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
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
});
