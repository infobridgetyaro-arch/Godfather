/**
 * heartbeat.ts — Primary VPS health signal
 *
 * Writes a timestamp + active stream snapshot to Redis every 5 seconds.
 * The backup VPS failover-watcher reads this to determine if the primary is
 * still alive. If the heartbeat is stale for > FAILOVER_TIMEOUT_MS (default
 * 15s), the backup initiates automatic stream recovery.
 *
 * Also exposes isShuttingDown so the /api/ready endpoint can return 503
 * during graceful drains (Kubernetes rolling update, PM2 reload, etc.).
 */

import { hybridStorage } from "./redis-storage";
import { logger } from "../lib/logger";

let heartbeatTimer: NodeJS.Timeout | null = null;
export let isShuttingDown = false;

const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Start the heartbeat loop. Call once after the server is listening.
 */
export function startHeartbeat(): void {
  if (heartbeatTimer) return; // already running

  heartbeatTimer = setInterval(async () => {
    try {
      await hybridStorage.writeHeartbeat();
    } catch {}
  }, HEARTBEAT_INTERVAL_MS);

  // Write immediately so backup doesn't wait 5s on startup
  hybridStorage.writeHeartbeat().catch(() => {});

  logger.info("[heartbeat] Started — writing to Redis every 5s");
}

/**
 * Stop the heartbeat loop and signal graceful shutdown.
 * Call on SIGTERM so Kubernetes readiness probe returns 503.
 */
export function stopHeartbeat(): void {
  isShuttingDown = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  logger.info("[heartbeat] Stopped");
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  stopHeartbeat();
  // Give PM2 / k8s 10s to drain in-flight requests before the process exits
  setTimeout(() => process.exit(0), 10_000);
});
