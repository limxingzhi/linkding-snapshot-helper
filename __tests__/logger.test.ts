import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../logger";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("logger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("toExternal", () => {
    it("appends messages to external-access.log", () => {
      const log = createLogger(tmpDir);
      log.toExternal("GET / - 203.0.113.5");
      log.toExternal("POST /delete - 198.51.100.2");

      const lines = fs.readFileSync(path.join(tmpDir, "external-access.log"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/\[EXTERNAL\] GET \/ - 203\.0\.113\.5$/);
      expect(lines[1]).toMatch(/\[EXTERNAL\] POST \/delete - 198\.51\.100\.2$/);
    });

    it("does not write to external-access.log on rotation of server.log", () => {
      const log = createLogger(tmpDir);
      // Write enough to fill server.log just under rotation
      const big = "x".repeat(500);
      for (let i = 0; i < 10; i++) log.info(big);
      log.toExternal("external entry");

      const contents = fs.readFileSync(path.join(tmpDir, "external-access.log"), "utf8");
      expect(contents).toContain("external entry");
    });
  });
});
