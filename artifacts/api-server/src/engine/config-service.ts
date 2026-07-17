/**
 * Config Service — Centralized configuration with environment variable support
 *
 * No magic numbers anywhere else in the codebase. All tunables live here.
 * Runtime updates are supported for safe values (overlays, quality thresholds).
 */

import { logger } from "../lib/logger";

// ── Timing constants ──────────────────────────────────────────────────────────

export const config = {
  // Restart / backoff
  backoffDelaysMs:         [5_000, 15_000, 30_000, 60_000, 120_000, 300_000],
  maxRestartAttempts:      6,

  // Circuit breaker
  cbWindowMs:              5  * 60_000,  // 5-minute failure window
  cbFailureThreshold:      5,
  cbOpenCooldownMs:        10 * 60_000,  // 10-minute cooldown

  // Watchdogs
  stallTimeoutMs:          15_000,       // frame stall before restart
  healthWarnMs:            10_000,       // warn before stall fires
  startupTimeoutMs:        60_000,       // no frames after start
  browserCamStartupMs:     90_000,       // browser cam startup window
  sessionRefreshMs:        3 * 60 * 60 * 1000, // 3hr TikTok session max

  // Encoder speed watchdog
  speedFloor:              0.85,         // restart if below this sustained
  speedSustainedMs:        5 * 60_000,   // must be below floor for 5 min
  speedCooldownMs:         3 * 60_000,   // min time between speed restarts

  // URL cache
  urlCacheTtlMs:           10 * 60_000,  // 10-minute URL cache

  // RTMP output
  rtmpBufferMs:            8_000,        // client-side RTMP send buffer
  rtmpRwTimeoutUs:         20_000_000,   // read/write timeout in microseconds

  // Audio
  micSampleRate:           48000,  // broadcast standard — eliminates SRC artifacts
  micChunkIntervalMs:      20,     // 20 ms chunks: smaller window = less jitter impact
  volSampleRate:           48000,
  volChunkIntervalMs:      20,
  audioAsyncSamples:       512,    // ≈10 ms at 48 kHz; was 8000 (167 ms) — way too aggressive

  // Overlay render fps
  bgRendererFps:           2,
  uiRendererFps:           25,

  // Health scoring
  healthRecoveryThreshold: 50,           // score below this triggers recovery
  healthWarningThreshold:  80,

  // Source failover
  stableResetMs:           10 * 60_000,  // 10 min stable before auto-reset to primary

  // HLS
  hlsEnabled:              process.env.HLS_ENABLED === "true",
  hlsBaseDir:              process.env.HLS_SEGMENT_DIR || "/tmp/hls",

  // Logging
  logBufferSize:           50,           // max log lines kept per stream
  suppressPatterns:        [
    "Late SEI is not implemented",
    "If you want to help, upload a sample",
    "ffmpeg-devel@ffmpeg.org",
    "streams.videolan.org/upload",
  ],

  // Relay
  relayMaxConsecutiveFailures: 20,
} as const;

// Validate critical config at startup
export function validateConfig(): void {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET environment variable is required but was not set.");
  }
  logger.info({ hlsEnabled: config.hlsEnabled }, "[config] Configuration validated");
}
