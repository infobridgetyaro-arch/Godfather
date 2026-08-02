/**
 * Watchdog Coordinator — Centralized watchdog management
 *
 * Consolidates all watchdog timers for a single stream into one place:
 *   1. Startup watchdog    — no frames after start → force restart
 *   2. Frame stall watchdog — no new frames for N seconds → restart
 *   3. Health warn monitor  — pre-stall warning to WebSocket
 *   4. Slow-encode watchdog — speed < 0.85x sustained for 5 min → restart
 *   5. Session refresh timer — TikTok session expiry prevention
 *
 * All watchdogs are relay-aware: they suppress restarts during expected
 * relay reconnect gaps so a brief source disconnect never triggers a
 * full FFmpeg restart.
 */

import { logger } from "../lib/logger";
import { eventBus } from "../engine/event-bus";
import { config } from "../engine/config-service";
import type { SourceRelay } from "../source-relay";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WatchdogOptions {
  streamId: string;
  getLastFrameCount: () => number;
  getRelay: () => SourceRelay | undefined;
  onStall: () => void;
  onStartupTimeout: () => void;
  onSlowEncoder: (sustainedMs: number) => void;
  sendLog: (msg: string) => void;
  isBrowserCamera: boolean;
  /**
   * Source type for the stream. The session-refresh timer only applies to
   * TikTok and X Space sources whose CDN auth tokens expire every ~90–120 s.
   * All other sources (YouTube, Facebook, camera, upload) must NOT be given a
   * forced proactive restart — it would interrupt a healthy stream for no reason.
   */
  sourceType?: string;
}

export interface WatchdogHandle {
  clearAll: () => void;
  recordSpeedSample: (speed: number) => void;
  notifyFrameReceived: () => void;
}

// ── Implementation ────────────────────────────────────────────────────────────

export function createWatchdogSet(opts: WatchdogOptions): WatchdogHandle {
  const {
    streamId, getLastFrameCount, getRelay,
    onStall, onStartupTimeout, onSlowEncoder, sendLog, isBrowserCamera,
    sourceType,
  } = opts;

  // Session refresh is only meaningful for sources whose CDN auth tokens expire.
  // Forcing a restart on YouTube/Facebook/camera/upload sources interrupts a
  // perfectly healthy stream — those sources have no session expiry to prevent.
  const needsSessionRefresh = sourceType === "tiktok" ||
    sourceType === "tiktok_pipe" ||
    sourceType === "xspace";

  let startupTimer: NodeJS.Timeout | null = null;
  let stallInterval: NodeJS.Timeout | null = null;
  let healthInterval: NodeJS.Timeout | null = null;
  let sessionRefreshTimer: NodeJS.Timeout | null = null;
  let lastOutputAt = Date.now();
  let healthWarned = false;
  let gotFirstFrame = false;

  // ── Slow encoder state ────────────────────────────────────────────────────
  let sustainedSlowStartAt: number | null = null;
  let lastSlowRestartAt: number | null = null;
  let lastSpeedLogAt = 0;

  // ── Startup watchdog ──────────────────────────────────────────────────────
  const startupMs = isBrowserCamera ? config.browserCamStartupMs : config.startupTimeoutMs;
  startupTimer = setTimeout(() => {
    if (!gotFirstFrame) {
      const elapsed = startupMs;
      sendLog(`Timeout: No frames encoded after ${elapsed / 1000}s — retrying with fresh URL...`);
      logger.warn({ streamId, elapsedMs: elapsed }, "[watchdog] startup timeout");
      eventBus.emit("STARTUP_TIMEOUT", { streamId, elapsedMs: elapsed });
      onStartupTimeout();
    }
  }, startupMs);

  // ── Frame stall watchdog ──────────────────────────────────────────────────
  let lastSeenFrame = getLastFrameCount();
  stallInterval = setInterval(() => {
    const relay = getRelay();
    const currentFrame = getLastFrameCount();

    // Relay-aware suppression
    if (relay?.isStalled()) {
      if (relay.isRecoveryDeadlineExceeded()) {
        const elapsedMs = relay.getReconnectStartedAt()
          ? Date.now() - relay.getReconnectStartedAt()!
          : 0;
        logger.warn({ streamId, elapsedMs, relayState: relay.getStatus() },
          "[watchdog] relay recovery deadline exceeded — restarting FFmpeg");
        sendLog(`[watchdog] Relay recovery deadline exceeded (${Math.round(elapsedMs / 1000)}s) — restarting FFmpeg`);
        lastSeenFrame = currentFrame;
        eventBus.emit("FRAME_STALL", { streamId, stalledMs: elapsedMs });
        onStall();
      } else {
        lastSeenFrame = currentFrame; // reset so it doesn't fire on recovery
      }
      return;
    }

    if (currentFrame === lastSeenFrame) {
      logger.warn({ streamId, frame: currentFrame }, "[watchdog] frame stall detected");
      sendLog(`Frame stall detected (no new frames for ${Math.round(config.stallTimeoutMs / 1000)}s) — restarting...`);
      eventBus.emit("FRAME_STALL", { streamId, stalledMs: config.stallTimeoutMs });
      onStall();
    } else {
      lastSeenFrame = currentFrame;
    }
  }, config.stallTimeoutMs);

  // ── Health warn monitor ───────────────────────────────────────────────────
  healthInterval = setInterval(() => {
    const relay = getRelay();
    const silentMs = Date.now() - lastOutputAt;

    if (relay?.isStalled()) {
      if (!healthWarned) {
        healthWarned = true;
        eventBus.emit("HEALTH_WARNING", {
          streamId, score: 50,
          reason: `Relay reconnecting — FFmpeg waiting for source data`,
        });
      }
      return;
    }

    if (silentMs >= config.healthWarnMs && !healthWarned) {
      healthWarned = true;
      eventBus.emit("HEALTH_WARNING", {
        streamId, score: 50,
        reason: `No FFmpeg output for ${Math.round(silentMs / 1000)}s — stream may be stalling`,
      });
    } else if (silentMs < config.healthWarnMs && healthWarned) {
      healthWarned = false;
      eventBus.emit("HEALTH_GOOD", { streamId, score: 100 });
    }
  }, 5000);

  // ── Session refresh (TikTok/xSpace session expiry prevention) ────────────
  // Only schedule for sources that have expiring CDN auth sessions.
  // YouTube, Facebook, camera, and upload streams must NOT receive this forced
  // restart — they have no session to refresh and it would cut a healthy stream.
  if (needsSessionRefresh) {
    sessionRefreshTimer = setTimeout(() => {
      sendLog("[watchdog] Proactive session refresh — preventing TikTok/xSpace session expiry");
      logger.info({ streamId, sourceType }, "[watchdog] session refresh timer fired");
      onStall(); // treated as a planned restart
    }, config.sessionRefreshMs);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function notifyFrameReceived(): void {
    gotFirstFrame = true;
    lastOutputAt = Date.now();
    healthWarned = false;
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
  }

  function recordSpeedSample(speed: number): void {
    const now = Date.now();
    const relay = getRelay();

    // During relay reconnect, reset any accumulated slow timer
    if (relay?.isStalled()) {
      if (sustainedSlowStartAt) {
        sustainedSlowStartAt = null;
        logger.info({ streamId }, "[watchdog] relay stalled — resetting slow encoder timer");
      }
      return;
    }

    // ── Log throttle ─────────────────────────────────────────────────────
    const belowFloor = speed < config.speedFloor;
    const logInterval = belowFloor ? 15_000 : 30_000;
    if (now - lastSpeedLogAt >= logInterval) {
      lastSpeedLogAt = now;
      const sustainedSec = sustainedSlowStartAt
        ? Math.round((now - sustainedSlowStartAt) / 1000)
        : 0;
      if (belowFloor) {
        const remainSec = Math.max(0, Math.round(config.speedSustainedMs / 1000) - sustainedSec);
        sendLog(
          `[watchdog] Speed ${speed.toFixed(2)}x (below ${config.speedFloor}x floor)` +
          ` | sustained: ${sustainedSec}s | restart in ~${remainSec}s if sustained`,
        );
      }
    }

    // ── Speed < floor ─────────────────────────────────────────────────────
    if (speed >= config.speedFloor) {
      if (sustainedSlowStartAt) {
        const hadSec = Math.round((now - sustainedSlowStartAt) / 1000);
        sendLog(`[watchdog] Speed recovered to ${speed.toFixed(2)}x after ${hadSec}s below floor — no restart`);
        sustainedSlowStartAt = null;
      }
      return;
    }

    if (!sustainedSlowStartAt) {
      sustainedSlowStartAt = now;
      sendLog(`[watchdog] Speed ${speed.toFixed(2)}x dropped below ${config.speedFloor}x floor — starting 5-minute timer`);
      logger.warn({ streamId, speed }, "[watchdog] encoder speed below floor — started timer");
      return;
    }

    const sustainedMs = now - sustainedSlowStartAt;
    const cooldownOk = !lastSlowRestartAt || now - lastSlowRestartAt > config.speedCooldownMs;

    if (sustainedMs >= config.speedSustainedMs && cooldownOk) {
      sustainedSlowStartAt = null;
      lastSlowRestartAt = now;
      logger.warn({ streamId, speed, sustainedMs }, "[watchdog] sustained slow encoder — restart triggered");
      sendLog(`[watchdog] Speed ${speed.toFixed(2)}x sustained ${Math.round(sustainedMs / 1000)}s — graceful restart`);
      eventBus.emit("ENCODER_SLOW", { streamId, speed, sustainedMs });
      onSlowEncoder(sustainedMs);
    }
  }

  function clearAll(): void {
    if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
    if (stallInterval) { clearInterval(stallInterval); stallInterval = null; }
    if (healthInterval) { clearInterval(healthInterval); healthInterval = null; }
    if (sessionRefreshTimer) { clearTimeout(sessionRefreshTimer); sessionRefreshTimer = null; }
  }

  return { clearAll, recordSpeedSample, notifyFrameReceived };
}
