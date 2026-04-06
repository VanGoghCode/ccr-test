import type { LogEntry, LogSink, ReviewLogger } from "./types.js";

function createEntry(
  level: LogEntry["level"],
  message: string,
  details?: Record<string, unknown>,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    details: details && Object.keys(details).length > 0 ? details : undefined,
  };
}

export function createLogger(sink: LogSink): ReviewLogger {
  return {
    log(entry) {
      sink(entry);
    },
    debug(message, details) {
      sink(createEntry("debug", message, details));
    },
    info(message, details) {
      sink(createEntry("info", message, details));
    },
    warn(message, details) {
      sink(createEntry("warn", message, details));
    },
    error(message, details) {
      sink(createEntry("error", message, details));
    },
  };
}

export function createConsoleLogger(prefix = "CCR"): ReviewLogger {
  return createLogger((entry) => {
    const payload = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
    const line = `[${prefix}] ${entry.level.toUpperCase()} ${entry.message}${payload}`;
    if (entry.level === "error") {
      console.error(line);
      return;
    }
    if (entry.level === "warn") {
      console.warn(line);
      return;
    }
    if (entry.level === "debug") {
      console.debug(line);
      return;
    }
    console.info(line);
  });
}
