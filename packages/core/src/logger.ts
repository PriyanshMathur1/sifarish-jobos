import { pino, type Logger } from "pino";

/**
 * Structured logging (PRD §100). One base logger; children carry
 * correlation ids: `reqId` for web requests, `jobId`/`runId` for workers.
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "jobos" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["*.password", "*.token", "*.oauth_tokens_enc", "req.headers.cookie"],
    censor: "[redacted]",
  },
});

export function requestLogger(reqId: string): Logger {
  return logger.child({ reqId });
}

export function workerLogger(queue: string, jobId: string): Logger {
  return logger.child({ queue, jobId });
}
