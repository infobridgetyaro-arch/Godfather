import { createServer } from "http";
import { exec } from "child_process";
import app from "./app";
import { registerBintunetRoutes } from "./bintunet-routes";
import { logger } from "./lib/logger";
import { ensureYtdlpVersion } from "./lib/ytdlp";
import { hybridStorage } from "./state/redis-storage";
import { startHeartbeat } from "./state/heartbeat";
import { wsBus } from "./state/ws-bus";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Without this, SIGTERM (sent by Replit when restarting the workflow) leaves
// the HTTP server holding its port open until the OS cleans up — the next
// process instance then crashes with EADDRINUSE.
function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal — closing HTTP server");
  httpServer.close(() => {
    logger.info("HTTP server closed — exiting");
    process.exit(0);
  });
  // Force-exit if graceful close takes more than 5 s
  setTimeout(() => {
    logger.warn("Graceful close timed out — forcing exit");
    process.exit(1);
  }, 5_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

async function bootstrap() {
  // ── Kill any orphaned FFmpeg/yt-dlp processes and free the port ──────────
  // Also kill any stale node process still holding our port (e.g. from an
  // ungraceful previous restart) so we never hit EADDRINUSE on startup.
  await new Promise<void>((resolve) => {
    // lsof -ti :<port> prints PIDs holding the port; xargs -r kill -9 removes them.
    // This handles the case where a previous tsx watch child survived a SIGTERM
    // because the signal was sent to the parent (pnpm/sh) but not propagated down.
    exec(
      `lsof -ti :${port} 2>/dev/null | xargs -r kill -9 2>/dev/null; ` +
      `pkill -9 -x ffmpeg 2>/dev/null; pkill -9 -f yt-dlp 2>/dev/null; true`,
      () => resolve(),
    );
  });
  // Brief pause so the OS releases the port after the kill above.
  await new Promise<void>((r) => setTimeout(r, 300));
  logger.info("Killed any orphaned ffmpeg/yt-dlp processes from previous run");

  // ── Ensure yt-dlp binary is present and up to date ─────────────────────
  await ensureYtdlpVersion();

  // ── Load stream configs from Redis (if configured) ─────────────────────
  await hybridStorage.init();

  // ── Start Redis pub/sub WebSocket bus (multi-node WS fan-out) ──────────
  await wsBus.start();

  // ── Register all API + WebSocket routes ────────────────────────────────
  await registerBintunetRoutes(httpServer, app);

  // ── Start HTTP server ──────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  logger.info({ port }, "Server listening");

  // ── Start heartbeat AFTER server is confirmed listening ─────────────────
  // Only the PRIMARY writes the heartbeat key to Redis.
  // The backup VPS sets VPS_ROLE=backup and relies on failover-watcher.mjs
  // to poll that key. If the backup also wrote heartbeats it would shadow the
  // primary's key and the watcher would never see a stale timestamp.
  if (process.env["VPS_ROLE"] !== "backup") {
    startHeartbeat();
  } else {
    logger.info("[heartbeat] Skipped — VPS_ROLE=backup (failover-watcher monitors primary)");
  }
}

bootstrap().catch((err) => {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — keeping server alive");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — keeping server alive");
});
