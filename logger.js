const fs = require("fs");
const path = require("path");

const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 2;

function rotate(logFile) {
  for (let i = MAX_FILES; i >= 1; i--) {
    const old = i === 1 ? logFile : `${logFile}.${i - 1}`;
    const next = `${logFile}.${i}`;
    if (fs.existsSync(old)) {
      if (i === MAX_FILES) {
        fs.unlinkSync(old);
      } else {
        fs.renameSync(old, next);
      }
    }
  }
}

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "server.log");
  const externalLogFile = path.join(logDir, "external-access.log");

  function write(level, msg) {
    const ts = new Date().toISOString();
    const line = `${ts} [${level}] ${msg}\n`;
    process.stdout.write(line);
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size >= MAX_SIZE) {
        rotate(logFile);
      }
    } catch (_) {}
    fs.appendFileSync(logFile, line);
  }

  function writeExternal(msg) {
    const ts = new Date().toISOString();
    const line = `${ts} [EXTERNAL] ${msg}\n`;
    process.stdout.write(line);
    fs.appendFileSync(externalLogFile, line);
  }

  return {
    info: (msg) => write("INFO", msg),
    warn: (msg) => write("WARN", msg),
    error: (msg) => write("ERROR", msg),
    toExternal: writeExternal,
  };
}

module.exports = { createLogger };
