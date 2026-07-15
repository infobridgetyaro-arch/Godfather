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

async function bootstrap() {
  // ── Kill any orphaned FFmpeg processes from a previous server instance ──
  // When tsx watch hot-reloads (e.g. after a code change), the in-memory
  // activeStreams map is wiped but child FFmpeg processes keep running as
  // orphans — they hold open RTMP connections to YouTube/Facebook forever.
  // Kill them all at startup before registering any routes.
  await new Promise<void>((resolve) => {
    exec("pkill -9 -x ffmpeg 2>/dev/null; pkill -9 -f yt-dlp 2>/dev/null; true", () => resolve());
  });
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
