const fs = require("fs");
const path = require("path");
const os = require("os");
const { createLogger } = require("../logger");

describe("logger", () => {
  let tmpDir;
  let log;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
    log = createLogger(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("toExternal", () => {
    it("appends messages to external-access.log", () => {
      log.toExternal("GET / - 203.0.113.5");
      log.toExternal("POST /delete - 198.51.100.2");

      const lines = fs.readFileSync(path.join(tmpDir, "external-access.log"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/\[EXTERNAL\] GET \/ - 203\.0\.113\.5$/);
      expect(lines[1]).toMatch(/\[EXTERNAL\] POST \/delete - 198\.51\.100\.2$/);
    });

    it("does not write to external-access.log on rotation of server.log", () => {
      // Write enough to fill server.log just under rotation
      const big = "x".repeat(500);
      for (let i = 0; i < 10; i++) log.info(big);
      log.toExternal("external entry");

      const contents = fs.readFileSync(path.join(tmpDir, "external-access.log"), "utf8");
      expect(contents).toContain("external entry");
    });
  });
});
