const fs = require("fs");
const path = require("path");

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "server.log");

  function write(level, msg) {
    const ts = new Date().toISOString();
    const line = `${ts} [${level}] ${msg}\n`;
    process.stdout.write(line);
    fs.appendFileSync(logFile, line);
  }

  return {
    info: (msg) => write("INFO", msg),
    warn: (msg) => write("WARN", msg),
    error: (msg) => write("ERROR", msg),
  };
}

module.exports = { createLogger };
