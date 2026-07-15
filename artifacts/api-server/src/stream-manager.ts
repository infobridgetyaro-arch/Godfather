import { ChildProcess, spawn, exec } from "child_process";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { getLiveStats, clearStreamChatState, primeLiveDetection } from "./youtube-counter";
import { getYouTubeStreamUrl, getYouTubeVideoDirectUrl, downloadYouTubeVideoToTemp, clearYtDownloadCache, normaliseYouTubeUrl, getYouTubeFFmpegCookieHeader } from "./youtube-source";
import { YTDLP_BIN } from "./lib/ytdlp";
import type { WebSocket } from "ws";
import type { StreamConfig } from "./schema";
import { OverlayRenderer, defaultOverlayState, type OverlayState } from "./overlay-renderer";
import path from "path";
import fs from "fs";
import { startHlsEncoder, stopHlsEncoder } from "./hls-encoder";
import { SourceRelay } from "./source-relay";

import { normaliseFacebookUrl } from "./source/source-manager";
// ── New engine modules ────────────────────────────────────────────────────────
import { eventBus } from "./engine/event-bus";
import {
  recordStreamStatus,
  recordReconnect,
  recordRelayMetrics,
  recordHealthScore,
  removeStreamMetrics,
  recordStreamSample,
} from "./engine/metrics-service";
import { getOrCreateSceneManager, removeSceneManager } from "./scene/scene-manager";
import {
  initHealthScorer,
  scorerRegisterStream,
  scorerRemoveStream,
  scorerSetFFmpegAlive,
  scorerRecordBitrate,
  scorerRecordFps,
  scorerRecordReconnect,
  scorerRecordRtmpError,
  scorerSetTargetFps,
  scorerRecordDroppedFrames,
  scorerResetMetricWindows,
  getHealthSnapshot,
  getAllHealthSnapshots,
} from "./stream-health-scorer";
import {
  initFailover,
  triggerFailover as failoverTrigger,
  markSourceStable,
  markSourceFailed,
} from "./source-failover";
import { AdaptiveQualityManager } from "./aqm/adaptive-quality-manager.js";
import type { AQMOverride } from "./aqm/types.js";
import { config } from "./engine/config-service";
export { getHealthSnapshot, getAllHealthSnapshots };
export { setFailoverChain, getFailoverChain, getAllChains, removeFailoverChain, getCurrentSource, resetToPrimary, buildDefaultChain } from "./source-failover";

// ── AQM force-quality resolution tables (module scope) ────────────────────────
// Used by both buildFFmpegArgs (to set FFmpeg output size) and startStream
// (to size the overlay canvas).  They MUST stay in sync — if the canvas size
// doesn't match the declared rawvideo -s in the FFmpeg args the gradient pipe
// frames get squashed / letterboxed and appear visually broken.
interface ResEntry { w: number; h: number; kbps30: number; kbps60: number }
const AQM_LANDSCAPE_TABLE: Record<string, ResEntry> = {
  force_4k:    { w: 3840, h: 2160, kbps30: 16000, kbps60: 24000 },
  force_1440p: { w: 2560, h: 1440, kbps30:  9000, kbps60: 14000 },
  force_1080p: { w: 1920, h: 1080, kbps30:  4500, kbps60:  6000 },
  force_720p:  { w: 1280, h:  720, kbps30:  2500, kbps60:  3500 },
  force_540p:  { w:  960, h:  540, kbps30:  1500, kbps60:  2000 },
  force_480p:  { w:  854, h:  480, kbps30:  1000, kbps60:  1500 },
  force_360p:  { w:  640, h:  360, kbps30:   600, kbps60:   800 },
  force_240p:  { w:  426, h:  240, kbps30:   400, kbps60:   600 },
};
const AQM_PORTRAIT_TABLE: Record<string, ResEntry> = {
  force_4k:    { w: 2160, h: 3840, kbps30: 16000, kbps60: 24000 },
  force_1440p: { w: 1440, h: 2560, kbps30:  9000, kbps60: 14000 },
  force_1080p: { w: 1080, h: 1920, kbps30:  4500, kbps60:  6000 },
  force_720p:  { w:  720, h: 1280, kbps30:  2500, kbps60:  3500 },
  force_540p:  { w:  540, h:  960, kbps30:  1500, kbps60:  2000 },
  force_480p:  { w:  480, h:  854, kbps30:  1000, kbps60:  1500 },
  force_360p:  { w:  360, h:  640, kbps30:   600, kbps60:   800 },
  force_240p:  { w:  240, h:  426, kbps30:   400, kbps60:   600 },
};

// ── Break Video Preload Cache ─────────────────────────────────────────────────
// Pre-resolves YouTube URLs in the background so Go Live starts instantly.
interface PreloadEntry {
  status: "loading" | "ready" | "error";
  resolvedUrl?: string;
  error?: string;
  startedAt: number;
}
const breakVideoPreloadCache = new Map<string, PreloadEntry>();

export function preloadBreakVideo(url: string): void {
  const existing = breakVideoPreloadCache.get(url);
  if (existing && existing.status !== "error") return; // already in-flight or ready
  breakVideoPreloadCache.set(url, { status: "loading", startedAt: Date.now() });

  const isHTTP = url.startsWith("http://") || url.startsWith("https://");
  if (!isHTTP || !/youtube\.com|youtu\.be/.test(url)) {
    breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: url, startedAt: Date.now() });
    return;
  }

  (async () => {
    try {
      const streamUrl = await getYouTubeStreamUrl(url);
      breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: streamUrl, startedAt: Date.now() });
      logger.info(`Break preload: live stream resolved for ${url}`);
      return;
    } catch {}
    try {
      const directUrl = await getYouTubeVideoDirectUrl(url);
      breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: directUrl, startedAt: Date.now() });
      logger.info(`Break preload: direct URL resolved for ${url}`);
      return;
    } catch (e: any) {
      if (e?.message?.includes("cookies")) {
        breakVideoPreloadCache.set(url, { status: "error", error: e.message, startedAt: Date.now() });
        logger.warn(`Break preload: ${e.message}`);
        return;
      }
      // Start downloading immediately in the background so it's ready by Go Live
      logger.info(`Break preload: starting background download for ${url}`);
      breakVideoPreloadCache.set(url, { status: "loading", startedAt: Date.now() });
      downloadYouTubeVideoToTemp(url, (m) => logger.info(`Break preload download: ${m}`))
        .then((filePath) => {
          breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: filePath, startedAt: Date.now() });
          logger.info(`Break preload: download complete → ${filePath}`);
        })
        .catch((dlErr: any) => {
          breakVideoPreloadCache.set(url, { status: "error", error: dlErr.message, startedAt: Date.now() });
          logger.warn(`Break preload download failed: ${dlErr.message}`);
        });
    }
  })().catch(() => {});
}

export function getBreakVideoPreloadStatus(url: string): PreloadEntry | null {
  return breakVideoPreloadCache.get(url) ?? null;
}

// ── MicAudioPipe ──────────────────────────────────────────────────────────────
// Maintains a continuous PCM16 mono 44100 Hz audio stream to FFmpeg pipe:5.
// Silence is written when no browser mic data is available; real PCM16 audio
// when the control-room operator has the mic enabled.
//
// Drift-compensated scheduler: each tick measures the actual elapsed time with
// process.hrtime.bigint() and adjusts the next setTimeout delay to compensate,
// keeping accumulated clock drift < 1 ms over long streams.
//
// WHY: setInterval fires with ±5–15 ms jitter in Node.js. At 44100 Hz PCM16
// that is enough irregular data flow to create audible clicks at FFmpeg's
// pipe:5 input — especially noticeable in quiet passages or during a live mic.
// Replacing it with a drift-compensated setTimeout loop eliminates the clicks.
//
// Ring buffer uses power-of-two capacity + bitwise AND mask for the modulo
// operation — faster than % in the hot-path byte copy loop.
class MicAudioPipe {
  private buf: Buffer;
  private writePos = 0;
  private readPos = 0;
  private _timeoutId: NodeJS.Timeout | null = null;

  // 50 ms of mono PCM16 at 44100 Hz = 4410 bytes
  static readonly INTERVAL_MS = 50;
  static readonly CHUNK_BYTES = Math.floor(44100 * 0.05) * 2;
  // Ring buffer: 4-second capacity rounded up to power of two for fast masking
  private static readonly _RAW_CAP = 44100 * 2 * 4;
  static readonly CAPACITY = (() => {
    let p = 1;
    while (p < MicAudioPipe._RAW_CAP) p <<= 1;
    return p;
  })();
  private static readonly _MASK = MicAudioPipe.CAPACITY - 1;

  constructor() {
    this.buf = Buffer.alloc(MicAudioPipe.CAPACITY);
  }

  feed(pcm: Buffer): void {
    const cap  = MicAudioPipe.CAPACITY;
    const mask = MicAudioPipe._MASK;
    if (this.writePos - this.readPos + pcm.byteLength > cap) {
      this.readPos = this.writePos - cap + pcm.byteLength;
    }
    for (let i = 0; i < pcm.byteLength; i++) {
      this.buf[(this.writePos + i) & mask] = pcm[i];
    }
    this.writePos += pcm.byteLength;
  }

  startWritingTo(dest: NodeJS.WritableStream): void {
    const chunkBytes = MicAudioPipe.CHUNK_BYTES;
    const intervalMs = MicAudioPipe.INTERVAL_MS;
    const mask       = MicAudioPipe._MASK;

    // Drift-compensated scheduler: track ideal next-fire time in nanoseconds.
    // Each tick schedules the next timeout as (ideal_next - now), so accumulated
    // jitter is corrected on every tick rather than compounding over time.
    let nextTickNs = process.hrtime.bigint();
    const intervalNs = BigInt(intervalMs * 1_000_000);

    const tick = () => {
      if (!(dest as any).writable) return;

      const available = this.writePos - this.readPos;
      const out = Buffer.allocUnsafe(chunkBytes);

      if (available >= chunkBytes) {
        for (let i = 0; i < chunkBytes; i++) {
          out[i] = this.buf[(this.readPos + i) & mask];
        }
        this.readPos += chunkBytes;
      } else {
        out.fill(0); // silence on underrun
      }

      try { (dest as any).write(out); } catch {}

      nextTickNs += intervalNs;
      const nowNs = process.hrtime.bigint();
      const delayMs = Number(nextTickNs - nowNs) / 1_000_000;
      this._timeoutId = setTimeout(tick, Math.max(0, delayMs));
    };

    // Align first tick to one interval from now
    nextTickNs += intervalNs;
    this._timeoutId = setTimeout(tick, intervalMs);
  }

  stop(): void {
    if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
  }
}

// Global mic audio distribution — one MicAudioPipe per active FFmpeg process
const activeMicPipes = new Set<MicAudioPipe>();
export function feedMicAudio(pcm: Buffer): void {
  activeMicPipes.forEach((p) => p.feed(pcm));
}

// ── VolumeControlPipe ──────────────────────────────────────────────────────────
// Maintains a continuous f32le stereo 48000 Hz audio stream to FFmpeg pipe:6.
// All samples equal `gain` (0.0 = silence / muted, 1.0 = full pass-through).
// FFmpeg's `amultiply` filter multiplies source audio sample-by-sample by this
// signal — allowing real-time volume/mute control with ZERO stream reconnection.
// NOTE: 48000 Hz matches the YouTube-recommended audio sample rate so the
// amultiply operation runs in the same sample domain as the rest of the pipeline.
//
// Drift-compensated scheduler: same hrtime approach as MicAudioPipe — prevents
// setInterval jitter from producing audible volume-level stepping artifacts.
class VolumeControlPipe {
  private gain: number;
  private _timeoutId: NodeJS.Timeout | null = null;

  // 50 ms of stereo f32le at 48000 Hz = 2400 frames × 2 ch × 4 bytes = 19200 bytes
  static readonly INTERVAL_MS = 50;
  static readonly CHUNK_FRAMES = Math.floor(48000 * 0.05);
  static readonly CHUNK_BYTES = VolumeControlPipe.CHUNK_FRAMES * 2 * 4;

  constructor(initialGain: number) {
    this.gain = Math.max(0, Math.min(1, initialGain));
  }

  setGain(g: number): void {
    this.gain = Math.max(0, Math.min(1, g));
  }

  startWritingTo(dest: NodeJS.WritableStream): void {
    const frames     = VolumeControlPipe.CHUNK_FRAMES;
    const chunkBytes = VolumeControlPipe.CHUNK_BYTES;
    const intervalMs = VolumeControlPipe.INTERVAL_MS;

    let nextTickNs = process.hrtime.bigint();
    const intervalNs = BigInt(intervalMs * 1_000_000);

    const tick = () => {
      if (!(dest as any).writable) return;
      const buf = Buffer.allocUnsafe(chunkBytes);
      const g = this.gain;
      for (let i = 0; i < frames * 2; i++) {
        buf.writeFloatLE(g, i * 4);
      }
      try { (dest as any).write(buf); } catch {}

      nextTickNs += intervalNs;
      const nowNs = process.hrtime.bigint();
      const delayMs = Number(nextTickNs - nowNs) / 1_000_000;
      this._timeoutId = setTimeout(tick, Math.max(0, delayMs));
    };

    nextTickNs += intervalNs;
    this._timeoutId = setTimeout(tick, intervalMs);
  }

  stop(): void {
    if (this._timeoutId) { clearTimeout(this._timeoutId); this._timeoutId = null; }
  }
}

function computeGain(streamMuted: boolean, liveAudioMuted: boolean, vol: number): number {
  if (streamMuted || liveAudioMuted) return 0;
  return Math.max(0, Math.min(1, vol / 100));
}

function updateAllVolumeGains(): void {
  activeStreams.forEach((proc, streamId) => {
    if (!proc.volumePipe) return;
    const stream = storage.getStream(streamId);
    const gain = computeGain(stream?.muted ?? false, currentOverlayState.liveAudioMuted, globalStreamVolume);
    proc.volumePipe.setGain(gain);
  });
}

// Browser camera streams — tracks which streams use __browser__ as camera input
export const browserCameraStreams = new Set<string>();

// Browser camera stdin pipes (streamId → FFmpeg stdin writable stream)
const browserCameraPipes = new Map<string, NodeJS.WritableStream>();
// Pre-start buffer: accumulates WebM chunks (including init segment) before FFmpeg spawns
const browserCameraBuffers = new Map<string, Buffer[]>();
export function writeToBrowserCamera(streamId: string, data: Buffer): boolean {
  const pipe = browserCameraPipes.get(streamId);
  if (!pipe) {
    // FFmpeg not started yet — buffer so the init segment isn't lost
    const arr = browserCameraBuffers.get(streamId) ?? [];
    arr.push(data);
    browserCameraBuffers.set(streamId, arr);
    return false;
  }
  try { (pipe as any).write(data); return true; } catch { return false; }
}

/** Push a JPEG frame from the browser screen-share WS to all active uiRenderers */
export function setScreenShareFrameForAll(jpegBuf: Buffer): void {
  activeStreams.forEach((proc) => {
    proc.uiRenderer?.setScreenShareFrame(jpegBuf);
  });
}

// Global stream source volume (0–100). Controlled live via VolumeControlPipe — no restart.
let globalStreamVolume = 100;
export function updateStreamVolume(vol: number): void {
  globalStreamVolume = Math.max(0, Math.min(100, Math.round(vol)));
  updateAllVolumeGains();
}

interface StreamProcess {
  ffmpegProcess?: ChildProcess;
  bgRenderer?: OverlayRenderer;
  uiRenderer?: OverlayRenderer;
  micPipe?: MicAudioPipe;
  volumePipe?: VolumeControlPipe; // f32le gain signal to FFmpeg pipe:6 (no-restart volume/mute)
  breakDecoder?: ChildProcess;    // secondary lightweight FFmpeg — decodes break video to RGBA frames for pipe:4
  muted: boolean;
  autoRestart: boolean;
  watchdog?: NodeJS.Timeout;
  stallWatchdog?: NodeJS.Timeout;
  statsInterval?: NodeJS.Timeout; // polls CPU+RAM for the FFmpeg PID every 3s
  prefetchTimer?: NodeJS.Timeout;      // fires before URL expires — pre-fetches a fresh URL, then seamlessly restarts
  sessionRefreshTimer?: NodeJS.Timeout; // TikTok/xSpace: forced restart every SESSION_REFRESH_MS to prevent session expiry
  ytSourceProcess?: ChildProcess; // streamlink process piped to FFmpeg stdin for YouTube source
  sourceRelay?: SourceRelay;      // self-healing pipe relay for tiktok_pipe / youtube_pipe modes
  inputUrl?: string;
  sourceType?: string;
  urlExpired?: boolean;
  lastFrameCount?: number;        // most-recent frame count from FFmpeg -stats output
  streamStartTime?: number;       // unix ms when stream reached "streaming" status
  reconnectCount?: number;        // total pipeline restarts for this stream session
  lastBitrate?: number;           // most recent output bitrate in kbps (from FFmpeg -stats)
  lastFps?: number;               // most recent output fps (from FFmpeg -stats)
  lastSpeed?: number;             // most recent encoder speed= value (real-time ratio)
  totalDroppedFrames?: number;    // cumulative dropped frame count from FFmpeg -stats
  accumulatedLagSec?: number;     // total seconds of lag built up since last reconnect
  lastSpeedSampleAt?: number;     // unix ms of last speed= sample for delta-time calc
  lastSlowReconnectAt?: number;   // unix ms of last slow-encode-triggered reconnect (cooldown)
  lastSpeedLogAt?: number;        // unix ms of last pino speed log (throttled to every 30s)
  recoveryAttempts?: number;      // graceful recovery attempts before hard restart
  gracefulKillTimer?: NodeJS.Timeout; // SIGTERM→SIGKILL escalation timer
  sustainedSlowSpeedStartAt?: number; // unix ms when speed first dropped into 0.88–0.99x band
  lastCpuPct?: number;            // most recent FFmpeg process CPU % (updated every 3s by proc stats poll)
  lastMemMb?: number;             // most recent FFmpeg process RSS in MB (updated every 3s by proc stats poll)
  // ── Active encoding parameters (set at launch; sent in proc_stats so UI shows real quality) ──
  activeResW?: number;            // actual output width being encoded (e.g. 1280 for force_720p)
  activeResH?: number;            // actual output height being encoded (e.g. 720 for force_720p)
  activeBitrateKbps?: number;     // actual video bitrate target in kbps
  activeFps?: number;             // actual frames-per-second target
  lastRtmpErrorAt?: number;       // unix ms of last RTMP error restart (debounce guard)
}

// ── URL cache: reuse recently resolved URLs to skip 20-35s re-resolution on restart ──
interface CachedUrl {
  url: string;
  sourceType: "tiktok" | "youtube" | "camera";
  resolvedAt: number;
}
// TikTok/YouTube URLs typically last 10-30 min. Cache for 10 min so fast
// restarts reuse the URL while proactive pre-fetch keeps it always fresh.
const URL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const urlCache = new Map<string, CachedUrl>();

function getCachedUrl(streamId: string): CachedUrl | null {
  const entry = urlCache.get(streamId);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > URL_CACHE_TTL_MS) {
    urlCache.delete(streamId);
    return null;
  }
  return entry;
}

// Exposed for the /preview route so it can reuse a recently resolved
// source URL instead of re-spawning yt-dlp/streamlink on every request
// (previews are opened/refreshed far more often than the stream is
// actually (re)started, so this avoids repeated 5-30s resolution delays).
export function getPreviewCachedUrl(streamId: string): CachedUrl | null {
  return getCachedUrl(streamId);
}

export function setPreviewCachedUrl(
  streamId: string,
  url: string,
  sourceType: CachedUrl["sourceType"]
): void {
  urlCache.set(streamId, { url, sourceType, resolvedAt: Date.now() });
}

const activeStreams = new Map<string, StreamProcess>();

// Per-stream Adaptive Quality Manager instances. Persists across FFmpeg
// auto-reconnects so the quality degradation state is not lost on restart.
// Cleared only when the user explicitly stops the stream.
const aqmStore = new Map<string, AdaptiveQualityManager>();

// Tracks streams explicitly stopped by the user. Every auto-restart timer
// checks this before calling startStream so that a pending reconnect timer
// that fires after the user clicked Stop can never leak back to YouTube.
const manuallyStopped = new Set<string>();

// ── Restart-loop protection ───────────────────────────────────────────────────
// restartScheduled: set when ANY restart timer is pending for a stream.
// A second concurrent restart path checks this and bails — prevents the race
// between handleProcessExit and the health-recovery callback both scheduling
// startStream at the same time (the root cause of the rapid-restart + rate-limit loop).
const restartScheduled = new Set<string>();

// Consecutive restart failure count per stream → drives exponential backoff
// so a channel that keeps failing doesn't hammer YouTube and get the server IP blocked.
const restartBackoff = new Map<string, number>();

// Resolved streamlink quality cache — persists across hardKillAndRestart so the
// 10–30 s `streamlink --json` probe is skipped on every restart after the first.
// Key: streamId. Value: resolved quality string (e.g. "best", "hd").
const tiktokQualityCache = new Map<string, string>();
// Memory-restart cooldown: tracks the last time a memory-triggered hardKillAndRestart
// was issued per stream, so we don't loop if RSS stays elevated after the restart.
// Unlike the polling-closure-local variable it replaces, this survives across FFmpeg
// restarts (the Map entry is only cleared in stopStream, not in hardKillAndRestart).
const memRestartCooldown = new Map<string, number>();
// Backoff schedule: 5s → 15s → 30s → 60s → 120s → 300s cap for 6+
const BACKOFF_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

// ── Resolver circuit breaker ──────────────────────────────────────────────────
// After CB_FAILURE_THRESHOLD resolution failures in CB_WINDOW_MS, the circuit
// opens and blocks further attempts for CB_OPEN_COOLDOWN_MS. After the cooldown
// one probe is allowed; success closes the circuit, failure extends the cooldown.
interface CBState {
  failures: number[];       // unix-ms timestamps of recent failures
  openedAt: number | null;  // when circuit was opened (null = closed)
  probeInFlight: boolean;   // one probe allowed after cooldown
}
const CB_WINDOW_MS        = 5  * 60_000; // 5-minute failure window
const CB_FAILURE_THRESHOLD = 5;           // failures before circuit opens
const CB_OPEN_COOLDOWN_MS = 10 * 60_000; // 10-minute open-circuit cooldown
const resolverCBs = new Map<string, CBState>();

function getCB(streamId: string): CBState {
  if (!resolverCBs.has(streamId)) {
    resolverCBs.set(streamId, { failures: [], openedAt: null, probeInFlight: false });
  }
  return resolverCBs.get(streamId)!;
}

function cbCanAttempt(streamId: string): boolean {
  const cb = getCB(streamId);
  if (!cb.openedAt) return true; // circuit closed
  const now = Date.now();
  if (now - cb.openedAt >= CB_OPEN_COOLDOWN_MS && !cb.probeInFlight) {
    cb.probeInFlight = true; // allow one probe
    return true;
  }
  return false; // circuit open and probe not yet due
}

function cbRecordSuccess(streamId: string): void {
  const cb = getCB(streamId);
  cb.failures = [];
  cb.openedAt = null;
  cb.probeInFlight = false;
}

function cbRecordFailure(streamId: string): void {
  const cb = getCB(streamId);
  const now = Date.now();
  cb.probeInFlight = false;
  cb.failures.push(now);
  cb.failures = cb.failures.filter((t) => now - t < CB_WINDOW_MS);
  if (!cb.openedAt && cb.failures.length >= CB_FAILURE_THRESHOLD) {
    cb.openedAt = now;
    logger.warn({ streamId, failures: cb.failures.length },
      "[circuit-breaker] OPEN — suspending URL resolution for 10 min");
  } else if (cb.openedAt) {
    // probe failed — reset cooldown clock
    cb.openedAt = now;
    logger.warn({ streamId }, "[circuit-breaker] Probe failed — extending cooldown");
  }
}

function getBackoffDelay(streamId: string): number {
  const count = restartBackoff.get(streamId) ?? 0;
  return BACKOFF_DELAYS_MS[Math.min(count, BACKOFF_DELAYS_MS.length - 1)];
}
function bumpBackoff(streamId: string): void {
  restartBackoff.set(streamId, (restartBackoff.get(streamId) ?? 0) + 1);
}
function resetBackoff(streamId: string): void {
  restartBackoff.delete(streamId);
  restartScheduled.delete(streamId);
}

const wsClients = new Set<WebSocket>();

let currentOverlayState: OverlayState = defaultOverlayState();

const cameraLinks = new Map<string, string>();
export function setCameraLink(streamId: string, url: string) { cameraLinks.set(streamId, url); }
export function clearCameraLink(streamId: string) { cameraLinks.delete(streamId); }

export function addWSClient(ws: WebSocket) {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
}

export function broadcastGlobal(type: string, data: any) {
  const json = JSON.stringify({ type, streamId: null, data });
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

export function broadcastStream(streamId: string, type: string, data: any) {
  broadcast({ type, streamId, data });
}

function broadcast(msg: { type: string; streamId: string; data: any }) {
  const json = JSON.stringify(msg);
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

const streamLogBuffers = new Map<string, string[]>();
const LOG_BUFFER_SIZE = 50;

const LOG_SUPPRESS_PATTERNS = [
  "Late SEI is not implemented",
  "If you want to help, upload a sample",
  "ffmpeg-devel@ffmpeg.org",
  "streams.videolan.org/upload",
];

function shouldSuppressLog(line: string): boolean {
  return LOG_SUPPRESS_PATTERNS.some((p) => line.includes(p));
}

function sendLog(streamId: string, line: string) {
  if (shouldSuppressLog(line)) return;
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const data = `[${timestamp}] ${line}`;
  if (!streamLogBuffers.has(streamId)) streamLogBuffers.set(streamId, []);
  const buf = streamLogBuffers.get(streamId)!;
  buf.push(data);
  if (buf.length > LOG_BUFFER_SIZE) buf.shift();
  broadcast({ type: "log", streamId, data });
}

export function getStreamLogBuffers(): Map<string, string[]> {
  return streamLogBuffers;
}

function sendStatus(streamId: string, status: string) {
  storage.updateStream(streamId, { status: status as any });
  broadcast({ type: "status", streamId, data: status });
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

export function getCurrentOverlayState(): OverlayState {
  return currentOverlayState;
}

export function updateStreamOverlays(patch: Partial<OverlayState>) {
  if (patch.chatBurnMessages !== undefined) {
    logger.debug(
      { count: patch.chatBurnMessages.length, chatBurnActive: currentOverlayState.chatBurnActive },
      "[overlay] chatBurnMessages patch received",
    );
  }
  const prevBreakActive = currentOverlayState.breakActive;
  const prevBreakVideoUrl = currentOverlayState.breakVideoUrl ?? "";
  const prevBreakVideoPanX = currentOverlayState.breakVideoPanX ?? 50;
  const prevBreakVideoPanY = currentOverlayState.breakVideoPanY ?? 50;
  const prevBreakVideoMode = currentOverlayState.breakVideoMode ?? "fullscreen";
  const prevLiveAudioMuted = currentOverlayState.liveAudioMuted;

  currentOverlayState = { ...currentOverlayState, ...patch };

  const nowBreakActive = currentOverlayState.breakActive;
  const nowBreakVideoUrl = currentOverlayState.breakVideoUrl ?? "";
  const nowBreakVideoPanX = currentOverlayState.breakVideoPanX ?? 50;
  const nowBreakVideoPanY = currentOverlayState.breakVideoPanY ?? 50;
  const nowBreakVideoMode = currentOverlayState.breakVideoMode ?? "fullscreen";

  // ── Break video decoder — ZERO main-FFmpeg restart ─────────────────────────
  // A lightweight secondary FFmpeg decodes break video frames and writes RGBA to
  // the uiRenderer via setExternalFrame() → pipe:4. The main FFmpeg process keeps
  // streaming to YouTube/Facebook at all times — no RTMP interruption whatsoever.
  const breakJustStarted = nowBreakActive && !prevBreakActive;
  const breakJustEnded   = !nowBreakActive && prevBreakActive;
  const urlChanged = nowBreakActive && nowBreakVideoUrl !== prevBreakVideoUrl;
  const panChanged = nowBreakActive && !!nowBreakVideoUrl && (
    nowBreakVideoPanX !== prevBreakVideoPanX || nowBreakVideoPanY !== prevBreakVideoPanY
  );
  // Changing background mode (fullscreen / live-bg / gradient-bg) while break
  // is active requires a decoder restart because the vf filter string differs.
  const modeChanged = nowBreakActive && !!nowBreakVideoUrl &&
    nowBreakVideoMode !== prevBreakVideoMode;

  const needsDecoderStart =
    (breakJustStarted && !!nowBreakVideoUrl) ||
    (urlChanged && !!nowBreakVideoUrl) ||
    panChanged ||
    modeChanged;

  if (needsDecoderStart) {
    const streamIds = [...activeStreams.keys()];
    const videoUrl = nowBreakVideoUrl;
    const panX = nowBreakVideoPanX;
    const panY = nowBreakVideoPanY;
    const isHTTP = videoUrl.startsWith("http://") || videoUrl.startsWith("https://");

    const startDecoderForAll = (resolvedUrl: string) => {
      if (!currentOverlayState.breakActive || currentOverlayState.breakVideoUrl !== videoUrl) {
        logger.info("Break decoder: ready but break no longer active — skipping");
        return;
      }
      const mode = currentOverlayState.breakVideoMode;
      streamIds.forEach((id) => {
        if (activeStreams.has(id)) startBreakDecoder(id, resolvedUrl, panX, panY, mode);
      });
    };

    // ── Check preload cache — instant start if pre-resolved ──────────────────
    const preloaded = breakVideoPreloadCache.get(videoUrl);
    if (preloaded?.status === "ready" && preloaded.resolvedUrl) {
      streamIds.forEach((id) => sendLog(id, "Break video: using pre-resolved URL — starting immediately ✓"));
      startDecoderForAll(preloaded.resolvedUrl);
    } else if (isHTTP && isYouTubeUrl(videoUrl)) {
      streamIds.forEach((id) => sendLog(id, "Break video: resolving YouTube URL…"));
      getYouTubeStreamUrl(videoUrl)
        .then((streamUrl) => {
          streamIds.forEach((id) => sendLog(id, "Break video: live stream detected — starting"));
          startDecoderForAll(streamUrl);
        })
        .catch(() => {
          streamIds.forEach((id) => sendLog(id, "Break video: fetching direct video URL…"));
          getYouTubeVideoDirectUrl(videoUrl)
            .then((cdnUrl) => {
              streamIds.forEach((id) => sendLog(id, "Break video: URL resolved — starting"));
              startDecoderForAll(cdnUrl);
            })
            .catch((cdnErr) => {
              const msg = cdnErr.message.includes("cookies")
                ? cdnErr.message
                : "downloading video (may take 1–2 min on first load, cached after)…";
              streamIds.forEach((id) => sendLog(id, `Break video: ${msg}`));
              downloadYouTubeVideoToTemp(videoUrl, (m) => {
                streamIds.forEach((id) => sendLog(id, `Break video: ${m}`));
              })
                .then((filePath) => startDecoderForAll(filePath))
                .catch((dlErr) => {
                  streamIds.forEach((id) => sendLog(id, `Break video error: ${dlErr.message}`));
                });
            });
        });
    } else if (isHTTP) {
      startDecoderForAll(videoUrl);
    } else {
      const filename = path.basename(videoUrl.replace(/^\/api\/uploads\//, ""));
      const filePath = path.join(process.cwd(), "uploads", filename);
      if (fs.existsSync(filePath)) {
        startDecoderForAll(filePath);
      } else {
        streamIds.forEach((id) => sendLog(id, `Break video: file not found — ${filename}`));
      }
    }
  } else if (breakJustEnded) {
    // Break ended — stop decoders and let uiRenderer resume normal overlay rendering
    [...activeStreams.keys()].forEach((id) => stopBreakDecoder(id));
    logger.info("Break ended — decoders stopped, live overlays resumed");
  }

  if (currentOverlayState.liveAudioMuted !== prevLiveAudioMuted) {
    updateAllVolumeGains();
  }

  activeStreams.forEach((proc) => {
    proc.bgRenderer?.updateState(currentOverlayState);
    proc.uiRenderer?.updateState(currentOverlayState);
  });
}

function buildFFmpegArgs(
  stream: StreamConfig,
  inputUrl: string,
  outputs: string[],
  sourceType: string,
  aqmOverride?: AQMOverride | null,
): string[] {
  // Default 24 fps: stable middle of the 20–25 fps stability band.
  // 30 fps adds ~20% encoding work with no meaningful quality gain at relay bitrates.
  let fps = parseInt(stream.fps || "24", 10);
  const isVertical = stream.ratio === "mobile";
  // ── Resolution ladder ─────────────────────────────────────────────────────
  // Each quality tier maps to the resolution YouTube recommends for its bitrate:
  //   "best" → 1920×1080 (landscape) / 1080×1920 (vertical)  — 1080p
  //   "720p" → 1280×720  (landscape) / 720×1280  (vertical)  — 720p
  //   other  → 854×480   (landscape) / 480×854   (vertical)  — 480p
  //
  // Previously "best" was incorrectly scaled to 1280×720 (same as "720p") while
  // using the 4,500 kbps bitrate intended for 1080p. YouTube Studio reported
  // "bitrate (4824 Kbps) is higher than the recommended bitrate (2500 Kbps)"
  // because 4,500 kbps is indeed above the 720p30 ceiling. At true 1080p the
  // 4,500 kbps target falls well within YouTube's recommended range.
  // ── Adaptive Output Quality Controller — resolution & bitrate table ─────────
  // aqmMode drives the full quality ladder. "auto" falls back to the legacy
  // stream.quality tiers; force_* modes lock to a fixed resolution.
  //
  // Landscape (desktop 16:9):                   30fps / 60fps kbps
  //   force_4k    → 3840×2160   16 000 / 24 000
  //   force_1440p → 2560×1440    9 000 / 14 000
  //   force_1080p → 1920×1080    4 500 /  6 000
  //   force_720p  → 1280× 720    2 500 /  3 500
  //   force_540p  →  960× 540    1 500 /  2 000
  //   force_480p  →  854× 480    1 000 /  1 500
  //   force_360p  →  640× 360      600 /    800
  //   force_240p  →  426× 240      400 /    600
  //
  // Portrait (mobile 9:16) swaps W/H; bitrates are identical.
  //
  // Strict CBR enforcement (nal-hrd=cbr requires minrate = maxrate = bitrate):
  //   bufsize = 2× bitrate → YouTube's own CBR guidance; the encoder can absorb
  //     burst complexity within a 2-second VBV window.
  //   maxrate = bitrate (NOT 110%) — this is intentional.  nal-hrd=cbr only
  //     inserts filler NAL units when minrate = maxrate = bitrate.

  const streamAqmMode = (stream as any).aqmMode ?? "auto";
  const resTable = isVertical ? AQM_PORTRAIT_TABLE : AQM_LANDSCAPE_TABLE;
  const forcedRes: ResEntry | null = streamAqmMode !== "auto" ? (resTable[streamAqmMode] ?? null) : null;

  const isBestQuality = !forcedRes && stream.quality === "best";
  const is720Quality  = !forcedRes && stream.quality === "720p";

  let scaleW = forcedRes
    ? forcedRes.w
    : isVertical
      ? (isBestQuality ? 1080 : is720Quality ? 720 : 480)
      : (isBestQuality ? 1920 : is720Quality ? 1280 : 854);
  let scaleH = forcedRes
    ? forcedRes.h
    : isVertical
      ? (isBestQuality ? 1920 : is720Quality ? 1280 : 854)
      : (isBestQuality ? 1080 : is720Quality ? 720 : 480);

  const is60fps = fps === 60;
  let bitrateKbps: number;

  if (forcedRes) {
    bitrateKbps = is60fps ? forcedRes.kbps60 : forcedRes.kbps30;
  } else if (stream.quality === "best") {
    // Capped at 2500k: stability rule limits initial bitrate to 2000–2500k range.
    // At relay source quality (360p–480p DASH input), encoding at 4500k+ wastes CPU
    // without visible quality improvement and prevents real-time speed on shared hosts.
    bitrateKbps = is60fps ? 2500 : 2000;
  } else if (stream.quality === "720p") {
    bitrateKbps = is60fps ? 2500 : 2000;
  } else {
    bitrateKbps = is60fps ? 2000 : 1500;
  }

  // ── AQM override (auto mode only) ─────────────────────────────────────────
  // In force_* modes, the AQM collects metrics but never changes resolution.
  if (!forcedRes && aqmOverride) {
    fps         = aqmOverride.fps;
    scaleW      = aqmOverride.scaleW;
    scaleH      = aqmOverride.scaleH;
    bitrateKbps = aqmOverride.bitrateKbps;
  }

  // Strict CBR: minrate = maxrate = bitrate. VBV bufsize = 2× bitrate target.
  const bitrate = `${bitrateKbps}k`;
  const bufsize = `${bitrateKbps * 2}k`;

  // Browser camera (__browser__) reads from stdin (pipe:0).
  // ALL non-browser camera sources (local v4l2/avfoundation devices AND RTSP/HTTP
  // cameras) are treated as "no guaranteed audio track".  Using the local-camera
  // audio path (silence fallback + mic only) prevents the FFmpeg filter graph from
  // failing with "Stream specifier 0:a matches no streams" on cameras that have no
  // audio track (which is the majority of IP/RTSP cameras).
  const isBrowserCamera = sourceType === "camera" && inputUrl === "__browser__";
  const isLocalCamera = !isBrowserCamera && sourceType === "camera";
  const isUpload = sourceType === "upload";
  const shouldLoop = isUpload && (stream.uploadedVideoLoop !== false);

  // -stats forces frame=... progress output even with -loglevel warning.
  // FFmpeg 7 silently suppresses progress when loglevel < info unless -stats is explicit.
  const args: string[] = ["-loglevel", "warning", "-stats"];

  // ── Input 0: live source (or browser camera) ──────────────────────────────
  if (isBrowserCamera) {
    // ── Browser camera: read stream from stdin (pipe:0) ──────────────────────
    // MediaRecorder sends binary chunks via WebSocket; the backend pipes them to
    // FFmpeg stdin.  Omit -f so FFmpeg auto-detects the container — this covers
    // both WebM (Chrome/Android) and MP4 (Safari/iOS) without needing to know
    // the client's codec in advance.  Give FFmpeg enough probe budget to parse
    // the container header before it starts decoding.
    args.push(
      "-analyzeduration", "5000000",
      "-probesize", "500000",
      "-thread_queue_size", "4096",
      "-i", "pipe:0",
    );
  } else if (sourceType === "camera") {
    // Detect network/IP cameras by URL scheme — must NOT use -f v4l2 for these
    const isNetworkCamera =
      inputUrl.startsWith("rtsp://") ||
      inputUrl.startsWith("rtsps://") ||
      inputUrl.startsWith("http://") ||
      inputUrl.startsWith("https://") ||
      inputUrl.startsWith("rtp://");
    if (isNetworkCamera) {
      args.push(
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_on_network_error", "1",
        "-reconnect_delay_max", "5",
        "-rw_timeout", "10000000",
        "-thread_queue_size", "4096",
        "-fflags", "+discardcorrupt",
        "-i", inputUrl,
      );
    } else {
      // Local V4L2 / avfoundation / dshow device path
      const isWin = process.platform === "win32";
      const isMac = process.platform === "darwin";
      if (isWin) {
        args.push("-f", "dshow", "-thread_queue_size", "4096", "-i", `video=${inputUrl}`);
      } else if (isMac) {
        args.push("-f", "avfoundation", "-framerate", String(fps), "-thread_queue_size", "4096", "-i", inputUrl);
      } else {
        args.push("-f", "v4l2", "-framerate", String(fps), "-thread_queue_size", "4096", "-i", inputUrl);
      }
    }
  } else if (sourceType === "youtube") {
    // Direct HLS (.m3u8 URL pasted by user) — FFmpeg reads segments directly.
    const cookieHeader = getYouTubeFFmpegCookieHeader();
    const ytHeaders = [
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept: */*",
      "Accept-Language: en-US,en;q=0.9",
      "Referer: https://www.youtube.com/",
      ...(cookieHeader ? [cookieHeader.trimEnd()] : []),
    ].join("\r\n") + "\r\n";
    args.push(
      "-headers", ytHeaders,
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "5",
      "-tls_verify", "0",
      "-rw_timeout", "10000000",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
    );
  } else if (sourceType === "youtube_pipe") {
    // yt-dlp pipe mode: yt-dlp streams MPEG-TS to FFmpeg stdin.
    // yt-dlp handles all HLS segment fetches and POT token rotation internally
    // so YouTube CDN never sees bare unauthenticated requests (no 429).
    //
    // -flags low_delay: tells the H.264 decoder to output frames immediately
    //   without buffering to wait for late SEI NAL units. YouTube HLS streams
    //   frequently produce "Late SEI is not implemented" warnings at each 2s
    //   segment boundary. Without low_delay the decoder stalls ~30ms per
    //   segment waiting for the SEI, which cumulatively causes speed=0.97x and
    //   a minor RTMP bitrate deficiency that YouTube flags as insufficient data.
    //
    // analyzeduration/probesize: 2 seconds / 2 MB is sufficient for MPEG-TS
    //   (the container is self-describing; the PMT arrives in the first few
    //   packets).  The previous 10s/10MB value extended every restart by ~8s
    //   of probe silence — enough for YouTube Studio to flag "poor stream
    //   health" after a routine reconnect.
    args.push(
      // analyzeduration=0 + probesize=32k: MPEG-TS PMT is in the first packets;
      // probing longer only delays the first RTMP frame after every reconnect.
      "-analyzeduration", "0",
      "-probesize", "32768",
      "-thread_queue_size", "512",
      "-fflags", "+discardcorrupt+genpts",
      "-flags", "low_delay",
      "-i", "pipe:0",
    );
  } else if (sourceType === "xspace") {
    // X Space: yt-dlp extracts the HLS audio URL; FFmpeg reads audio-only.
    // No video track — the filter graph uses lavfi black + gradient as video.
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_delay_max", "5",
      "-rw_timeout", "10000000",
      "-thread_queue_size", "512",
      "-fflags", "+discardcorrupt+genpts",
      "-i", inputUrl,
    );
  } else if (isUpload) {
    // Uploaded video file — loop indefinitely with -stream_loop -1 for 24/7 play.
    // -re reads at native framerate so FFmpeg doesn't race ahead of real-time.
    const loopArgs = shouldLoop ? ["-stream_loop", "-1"] : [];
    args.push(
      ...loopArgs,
      "-re",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts",
      "-i", inputUrl,
    );
  } else if (sourceType === "tiktok_pipe") {
    // streamlink pipe mode: streamlink --stdout streams MPEG-TS to FFmpeg stdin.
    // streamlink continuously refreshes the TikTok HLS playlist and fetches fresh
    // segment URLs internally — CDN URL expiry is fully transparent to FFmpeg.
    //
    // low_delay: identical reasoning as youtube_pipe — avoids SEI stall at HLS
    // segment boundaries that accumulates into speed=0.97x lag and RTMP drops.
    //
    // analyzeduration/probesize: 2 seconds / 2 MB is sufficient for MPEG-TS
    //   (self-describing container; PMT arrives in the first few packets).
    //   The previous 10s/10MB value extended every restart by ~8 extra seconds
    //   of probe-only silence before FFmpeg produced a single RTMP frame.
    //   YouTube Studio detects probe-silence as "not receiving enough video",
    //   which was the primary driver of the "Poor stream health" rating that
    //   appeared consistently at ~90 s (probe 10s + restart overhead = gap
    //   long enough to trigger the warning in consecutive restart cycles).
    args.push(
      // analyzeduration=0 + probesize=32k: MPEG-TS is self-describing (PMT in
      // first packets); extended probing only delays first RTMP frame.  0 duration
      // + 32k size is enough to detect codec parameters in one read.
      "-analyzeduration", "0",
      "-probesize", "32768",
      // 512 packet pre-decode queue: enough for ~0.5s jitter absorption at
      // typical live bitrates without allowing unbounded backlog when encoder lags.
      "-thread_queue_size", "512",
      "-fflags", "+discardcorrupt+genpts",
      "-flags", "low_delay",
      "-i", "pipe:0",
    );
  } else if (sourceType === "facebook_pipe") {
    // yt-dlp pipe mode: yt-dlp muxes DASH video+audio → MPEG-TS → FFmpeg stdin.
    //
    // Facebook only offers separate DASH video + audio tracks (no pre-muxed
    // combined stream), so yt-dlp must mux them internally.  Every byte of
    // unnecessary buffering adds to the already-unavoidable CDN presentation
    // delay (~10-20 s set by Facebook's DASH manifest).
    //
    // analyzeduration 500 ms / probesize 500 KB:
    //   Smaller than youtube_pipe's 2 s / 2 MB because Facebook MPEG-TS is
    //   already well-formed by yt-dlp's muxer — we don't need a long probe
    //   window.  Reducing this shaves ~1.5 s off startup latency.
    //
    // low_delay: instruct the decoder to produce frames as early as possible
    //   without waiting for reorder buffers (same as youtube_pipe).
    //
    // +igndts  (replaces +discardcorrupt):
    //   Facebook DASH muxes audio and video from SEPARATE segment tracks.
    //   At every 4–6 s segment boundary the first audio packet of the new
    //   segment has a DTS that is inconsistent with the previous segment's DTS
    //   (the two tracks' DTS clocks are not guaranteed to be aligned).
    //   +discardcorrupt silently DROP those packets → audible cut every
    //   segment boundary.  +igndts tells FFmpeg to use PTS directly and ignore
    //   DTS for ordering, so boundary packets pass through intact.
    //   genpts then regenerates any missing PTS from the (now-ignored) DTS
    //   without discarding the underlying audio data.
    args.push(
      // ── probesize / analyzeduration — MUST be large for Facebook DASH ────────
      //
      // Facebook's yt-dlp MPEG-TS output muxes DASH video + audio from SEPARATE
      // segment tracks.  The AAC audio stream header (codec params, channel count,
      // sample format) does NOT always appear in the first 64 KB of the MPEG-TS:
      //
      //   • With probesize=65536 (64 KB) / analyzeduration=500000 (0.5 s):
      //     FFmpeg logs "Could not find codec parameters for stream 1 (Audio: aac,
      //     0 channels): unspecified sample format" and falls back to "rawvideo"
      //     for the video stream (no H.264 SPS/PPS found either).
      //
      //   • Audio decode fails → [0:a] produces ZERO frames → amix([2:a],[_fb_a_rs])
      //     stalls waiting for [_fb_a_rs] → muxer blocks → video frames (decoded
      //     as raw, ~6 MB each at 1080p) accumulate in the filter graph queue →
      //     900 MB in 7 s → self-healing restart at 1.0 GB → 1.5 GB in the next
      //     session → force-stop.  The stream dies in 30 seconds every time.
      //
      //   • FFmpeg itself reports: "Consider increasing the value for the
      //     'analyzeduration' (500000) and 'probesize' (65536) options"
      //
      // FIX: 5 MB / 10 s gives FFmpeg enough data to find:
      //   • H.264 SPS/PPS (typically in the first GOP, ≤2 MB for a 360p segment)
      //   • AAC audio init / channel descriptor (typically within first 1–2 s)
      // Once both codecs are resolved, [0:a] flows normally → amix unblocks →
      // muxer outputs → memory stays < 200 MB throughout the session.
      //
      // Startup-latency trade-off: yt-dlp already takes 9–20 s to connect to
      // Facebook (manifest fetch, DASH segment probe, cookie auth).  FFmpeg's
      // 10 s probe window runs concurrently with that — in practice the codec
      // parameters are resolved within the first 1–2 s of data flow, so the
      // effective startup penalty is zero.
      "-analyzeduration", "10000000",  // 10 s  (was 500000 = 0.5 s — too small)
      "-probesize",       "5242880",   // 5 MB  (was 65536  = 64 KB — caused OOM)
      // 4096 packets: Facebook DASH I-frames can be 80–300 KB each; 1024 was
      // sometimes insufficient to absorb the burst of small TS packets that
      // arrive between two I-frames, causing back-pressure on the pipe → visible
      // as periodic video freezes while audio continued normally.
      "-thread_queue_size", "4096",    // (was 1024)
      // +igndts+genpts only — no +discardcorrupt (drops DASH boundary packets →
      // audio cuts) and no +nobuffer (sacrifices stability for latency; ruled out
      // by STABILITY > CONTINUITY priority).
      "-fflags", "+igndts+genpts",
      // NOTE: -flags +low_delay intentionally omitted for Facebook.
      // Facebook H.264 uses B-frames (profile High, up to 3 reference frames).
      // low_delay forces the decoder to emit frames before the B-frame reorder
      // buffer fills → frames output in decode order instead of presentation
      // order → visible as random visual scratches / corrupted blocks every few
      // seconds.  Audio is unaffected because AAC has no reorder buffer.
      // Removing low_delay lets H.264 accumulate the full reorder window,
      // eliminating the visual artifacts entirely.
      //
      // ignore_err: Facebook DASH H.264 bitstreams frequently declare more
      // reference frames than the decoder's per-profile limit (errors:
      // "co located POCs unavailable", "mmco: unref short failure",
      // "number of reference frames exceeds max").  Without this flag FFmpeg
      // stalls the decode pipeline waiting for valid reference pictures, which
      // causes video freezes and eventually a crash.  ignore_err tells the
      // decoder to conceal errors with best-effort interpolation instead.
      "-err_detect", "ignore_err",
      "-i", "pipe:0",
    );
  } else if (sourceType === "link_pipe") {
    // Generic video link (yt-dlp pipe mode) — supports YouTube, Facebook,
    // Twitch, Vimeo, Twitter/X, and thousands of other sites yt-dlp knows.
    // Uses the same fast-probe settings as youtube_pipe to minimise startup lag.
    args.push(
      "-analyzeduration", "0",
      "-probesize", "32768",
      "-thread_queue_size", "512",
      "-fflags", "+discardcorrupt+genpts",
      "-flags", "low_delay",
      "-i", "pipe:0",
    );
  } else {
    // TikTok HLS (legacy direct-URL mode — kept as fallback if pipe mode fails).
    // tls_verify 0: TikTok CDN edge servers often use certificates that don't
    //   match the request hostname; disabling verification prevents the
    //   "Decryption has failed" TLS error that kills the stream after ~10s.
    // reconnect_delay_max 5: recover fast — expired HLS segments need a quick
    //   retry, not a 30s back-off that leaves the stream frozen.
    // rw_timeout 10s: detect dead connections faster so handleProcessExit fires
    //   sooner and a fresh URL is fetched for recovery.
    // multiple_requests 1: reuse the HTTP/TLS connection across HLS segment
    //   requests, reducing per-segment TLS handshake overhead.
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "5",
      "-multiple_requests", "1",
      "-tls_verify", "0",
      "-rw_timeout", "10000000",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "-referer", "https://www.tiktok.com/",
      "-thread_queue_size", "8192",
      // genpts: regenerate timestamps on reconnect so PTS discontinuities
      // don't stall the filter graph and cause a visible cut.
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
    );
  }

  // ── Input 1: lavfi black video — the "never-dies" fallback ───────────────
  // pixel_format=yuv420p + -color_range 1 (tv): explicit range avoids the
  // "deprecated pixel format used, make sure you did set range correctly" warning.
  // thread_queue_size=4: CRITICAL — lavfi generates raw decoded frames (not
  // compressed packets) in its own thread.  At 1080p YUV420p each frame is
  // ~3.1 MB, so queue=1024 can accumulate up to 3.1 GB before FFmpeg blocks.
  // When the encoder runs at 0.83–0.90× real-time, the lavfi thread outpaces
  // the filter graph at 0.17× rate, filling the queue at ~13 MB/s → OOM in
  // minutes.  Setting queue=4 caps the buffer to ~12 MB (matching pipe:3)
  // and causes the lavfi thread to block quickly, preventing unbounded growth.
  args.push(
    "-f", "lavfi",
    "-thread_queue_size", "4",
    "-color_range", "1",
    "-i", `color=c=black:size=${scaleW}x${scaleH}:rate=${fps}`,
  );

  // ── Input 2: lavfi silence — audio fallback ───────────────────────────────
  // 48000 Hz matches YouTube's recommended audio sample rate. Using the correct
  // sample rate here avoids a hidden resampling step in the codec pipeline that
  // can introduce cumulative A/V drift during 24/7 streams.
  // thread_queue_size=64: audio frames are tiny (~5 KB each), so 64 frames is
  // only ~320 KB — well below any meaningful memory contribution.
  args.push(
    "-f", "lavfi",
    "-thread_queue_size", "64",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
  );

  // ── Input 3: background gradient raw-RGBA pipe (fd 3) ────────────────────
  // thread_queue_size=4: at 2fps each frame is ~3.7–8MB; 4 frames = 15–33MB max queue.
  // Overlay is rendered at 2fps (reduced from 5fps) — the overlay content is
  // largely static (chat, news bar, gradient) so 2fps is indistinguishable
  // visually while cutting canvas-render CPU and pipe I/O by ~60%.
  // FFmpeg's fps_mode=cfr on the video output duplicates overlay frames between
  // render ticks seamlessly — no stutter or tearing visible to viewers.
  args.push(
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-video_size", `${scaleW}x${scaleH}`,
    "-framerate", "2",
    "-thread_queue_size", "4",
    "-i", "pipe:3",
  );

  // ── Input 4: UI overlay raw-RGBA pipe (fd 4) ──────────────────────────────
  // 15fps matches uiRenderer.startWritingTo(uiPipe, 15) below.
  //
  // WHY 15fps, not 25fps:
  //   At 1280×720 RGBA, each frame is 3.69 MB.  25fps = 92 MB/s of rawvideo
  //   data through pipe:4 alone.  On constrained VPS hardware this saturated
  //   memory bandwidth and caused the filter graph to block on the pipe read,
  //   pushing encoder speed below 1.0x and producing YouTube's "not receiving
  //   enough video for maintenance" disconnect.  Dropping to 15fps cuts the
  //   pipe throughput to 55 MB/s (–40%) while fps_mode=cfr on the output
  //   duplicates frames transparently — viewers see no stutter because the
  //   ticker/chat content changes at most ~2–3px per rendered frame anyway.
  //   thread_queue_size=8: reduced from 16 to cap the rawvideo queue at
  //   8 × ~8 MB = ~64 MB at 1080p RGBA.  The uiRenderer backpressure handler
  //   (drain timeout = 4 × intervalMs) will drop frames before the queue fills,
  //   so reducing the queue here doesn't risk stall-watchdog triggers.
  args.push(
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-video_size", `${scaleW}x${scaleH}`,
    "-framerate", "15",
    "-thread_queue_size", "8",
    "-i", "pipe:4",
  );

  // ── Input 5: browser mic audio — PCM16 mono 44100 Hz via pipe:5 ──────────
  // MicAudioPipe continuously writes silence (or real PCM16 when the control-room
  // operator has the mic enabled). This input is always present so the filter
  // graph stays consistent and no FFmpeg restart is needed to toggle mic on/off.
  args.push(
    "-f", "s16le",
    "-ar", "44100",
    "-ac", "1",
    // 512 packet queue: mic audio is 44100 Hz mono PCM16 (~86 KB/s); 512 frames
    // is ~250ms of headroom, well above any audio callback jitter.
    "-thread_queue_size", "512",
    "-i", "pipe:5",
  );

  // ── Input 6: volume control signal — f32le stereo 48000 Hz via pipe:6 ────
  // VolumeControlPipe writes constant-amplitude samples (0.0 = muted, 1.0 = full).
  // amultiply in the filter graph multiplies source audio sample-by-sample by this
  // signal, enabling real-time volume/mute with ZERO stream reconnection.
  // 48000 Hz matches the rest of the pipeline so FFmpeg never needs to internally
  // resample this control signal, eliminating a latency source.
  // thread_queue_size=1024: raised from 512 to prevent queue-blocking when the
  // audio mixer is momentarily stalled behind video encode bursts.
  args.push(
    "-f", "f32le",
    "-ar", "48000",
    "-ac", "2",
    "-thread_queue_size", "1024",
    "-i", "pipe:6",
  );

  // ── Input 7: X Space background media (image URL, local image, or local video) ──
  // Priority: xspaceVideoPath (uploaded local file) > xspaceImageUrl (remote URL).
  // Local image: -loop 1 -framerate 2 keeps a still image looping as video frames.
  // Local video: -stream_loop -1 loops the video file forever (no audio taken from it).
  // Remote image URL: -loop 1 (existing behaviour, kept for backwards compat).
  const xspaceImageUrl = sourceType === "xspace" ? (stream.xspaceImageUrl ?? "").trim() : "";
  const xspaceVideoPath = sourceType === "xspace" ? (stream.xspaceVideoPath ?? "").trim() : "";
  const videoExts = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ts"]);
  const xspaceLocalIsVideo = xspaceVideoPath
    ? videoExts.has(path.extname(xspaceVideoPath).toLowerCase())
    : false;

  if (xspaceVideoPath) {
    if (xspaceLocalIsVideo) {
      // Looped video file as visual background (audio intentionally ignored)
      args.push("-stream_loop", "-1", "-thread_queue_size", "8", "-i", xspaceVideoPath);
    } else {
      // Static image file (jpg/png/webp)
      args.push("-loop", "1", "-framerate", "2", "-thread_queue_size", "8", "-i", xspaceVideoPath);
    }
  } else if (xspaceImageUrl) {
    args.push("-loop", "1", "-thread_queue_size", "8", "-i", xspaceImageUrl);
  }

  // threads=0: auto-detect (all available cores for x264).
  // filter_threads=2 / filter_complex_threads=2: reduced from 4.
  //   On CPU-constrained VPS hosts (1–2 cores), 4 filter threads competed
  //   directly with the x264 encoder threads, causing context-switch overhead
  //   that pushed encoder speed below real-time (0.82–0.88x) and buffering.
  //   2 filter threads are enough for a 4-layer rgba overlay chain while
  //   leaving headroom for x264 to run without competing for scheduler time.
  // max_interleave_delta=0: don't buffer A/V waiting to interleave — emit each
  // packet as soon as it's ready so RTMP data flows at a constant rate.
  args.push(
    "-threads", "0",
    "-filter_threads", "2",
    "-filter_complex_threads", "2",
    "-max_muxing_queue_size", "2048",
    "-max_interleave_delta", "0",
  );

  // ── Filter graph ──────────────────────────────────────────────────────────
  //
  // Video chain (non-xspace):
  //   [0:v] live source  → scale (maintain AR, may be smaller than frame)    → [_src]
  //   [1:v] lavfi black  → base; [_src] centred on top                       → [_withvideo]
  //   [3:v] bg gradient  → semi-transparent blobs overlaid OVER video        → [_composed]
  //   [4:v] UI overlay   → chat/news/stats on top                            → [_final]
  //
  // Video chain (xspace — audio-only source, no [0:v]):
  //   [1:v] lavfi black  → base                                              → [_base]
  //   [3:v] bg gradient  → overlaid on top                                   → [_base2]
  //   [4:v] UI overlay   → final output                                      → [_final]
  //
  // Audio chain:
  //   Source volume applied via `volume=X` filter (X from globalStreamVolume).
  //   When muted, source volume = 0 but mic pipe (pipe:5) still contributes.
  //   mic pipe is always present; silence when inactive, real PCM16 when active.
  //   isLocalCamera: source has no audio — silence fallback + mic only.

  const isXSpace = sourceType === "xspace";
  const isFacebookPipe = sourceType === "facebook_pipe";

  // Mic noise reduction: aresample=48000 converts the 44.1kHz browser mic input to
  // the 48kHz pipeline sample rate BEFORE highpass/gate so all downstream filters
  // run in the same domain, preventing hidden auto-resamples that skew timings.
  // highpass removes low-frequency rumble, noise gate suppresses background noise.
  const micClean = `[5:a]aresample=48000,highpass=f=80,agate=threshold=0.015:ratio=8:attack=0.01:release=0.15[_mic]`;

  // Volume is controlled dynamically via VolumeControlPipe on pipe:6 — no restart needed.
  // [6:a] is a constant-amplitude f32le stereo signal; amultiply scales source audio by it.
  let audioFilter: string;
  if (isLocalCamera) {
    // Local v4l2/avfoundation device has no audio track — silence fallback + mic only.
    audioFilter = [
      `[6:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_vol]`,
      `[2:a][_vol]amultiply[_srcFin]`,
      micClean,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=2:normalize=0[_rawA]`,
      // async=8000: gentle drift correction — 8000 sample window (≈180ms at 44100Hz)
      // lets audio lag/lead up to that amount before FFmpeg corrects it.  The
      // aggressive async=1000 caused high-frequency corrections that spiked CPU and
      // momentarily stalled the muxer, contributing to YouTube buffering complaints.
      `[_rawA]aresample=async=8000[_audio]`,
    ].join(";");
  } else if (isFacebookPipe) {
    // ── Facebook DASH audio — timestamp-normalised mixing ─────────────────────
    //
    // Facebook DASH delivers audio as separate segment tracks muxed by yt-dlp.
    // Two problems affect the standard amix[silence, source] approach:
    //
    // 1. AUDIO CUTS at every 4–6 s segment boundary
    //    DASH audio segments are independent tracks.  At each boundary the first
    //    packet of the new segment has a PTS jump that may differ slightly from
    //    the previous segment's final PTS.  With the raw DASH timestamps, amix
    //    sees a micro-discontinuity at every boundary and either briefly buffers
    //    or discards the boundary packet → audible click / cut.
    //    (+igndts on the input already prevents discardcorrupt from dropping
    //    these packets; this filter removes the PTS discontinuity itself.)
    //
    // 2. GROWING LAG / PERMANENT SILENCE after yt-dlp restarts
    //    yt-dlp's MPEG-TS muxer resets its PCR clock to near-zero on each new
    //    session.  After a restart, the new session's audio arrives at PTS ≈ 0
    //    while the silence clock (anullsrc) has already advanced T_restart
    //    seconds.  amix (silence-first, duration=first) discards "past" packets
    //    → the mix outputs only silence indefinitely after any restart.
    //
    // Fix — normalise DASH audio to sample-count timestamps BEFORE mixing:
    //
    //   aresample=48000  : ensure consistent sample rate (defensive; yt-dlp
    //                      should already output 48 kHz but DASH tracks vary).
    //   asettb=1/48000   : set the filter timebase so that N maps exactly to
    //                      seconds (PTS = N / 48000 s).
    //   asetpts=N        : replace every packet's PTS with the cumulative
    //                      consumed-sample counter.  N is monotonically
    //                      increasing within this FFmpeg process — it does NOT
    //                      reset when yt-dlp restarts.  A new yt-dlp session
    //                      therefore continues from N_last_before_restart.
    //
    //   Recovery after a restart gap of D seconds:
    //     • Gap: silence advances T → T+D; [_fb_a_ts] produces nothing.
    //     • New yt-dlp starts; asetpts=N continues from N_end (= T × 48000).
    //     • New audio PTS = T (behind silence's T+D).  amix discards briefly.
    //     • After D more seconds of audio flowing through asetpts=N, N reaches
    //       N_end + D×48000 = (T+D)×48000.  PTS catches up to silence. ✓
    //     • Recovery gap = exactly D (the restart duration) — no growing debt.
    //
    // amix order [2:a][_fb_a_ts] — silence first (duration=first):
    //   anullsrc drives the output timeline so that DASH segment gaps never
    //   STALL the output (amix does not wait for the slower DASH input when
    //   silence is the primary / first input).  Silence fills gaps seamlessly.
    //   duration=first keeps output alive forever (silence never ends).
    //
    // dropout_transition=2 (vs 10 for other sources):
    //   Facebook DASH gaps are 0.5–3 s (segment boundary + manifest refresh).
    //   A 10 s fade-in/out window spans multiple gap cycles and makes recovery
    //   sound muffled.  2 s absorbs a single missed segment without a perceptible
    //   volume ramp when audio resumes quickly.
    audioFilter = [
      // aresample=48000: normalise sample rate defensively — yt-dlp targets 48 kHz
      // for Facebook DASH but individual tracks can vary.  Timestamps are preserved
      // as-is from yt-dlp's MPEG-TS output (which already normalises them to start
      // near zero on each session).  DO NOT use asetpts=N here: that resets audio
      // PTS to zero regardless of when yt-dlp actually connects.  Because yt-dlp
      // takes ~15–20 s to probe and connect, the silence clock (anullsrc) has
      // already advanced to ~17 s when the first audio packet arrives.  With
      // asetpts=N the audio PTS would be 0 while video PTS is ~17 s; the overlay
      // filters then buffer ~17 s of video frames waiting for audio to "catch up",
      // causing multi-GB memory growth and speed < 0.8x (filter graph stall).
      // +igndts on the input already handles DTS discontinuities at segment
      // boundaries without touching PTS, so no further timestamp manipulation is
      // needed here.
      `[0:a]aresample=48000[_fb_a_rs]`,
      // silence first → anullsrc drives the output timeline so DASH segment gaps
      // (0.5–3 s) never stall the muxer.  dropout_transition=2 (not 10) so the
      // fill-silence window doesn't span multiple gap cycles and sound muffled.
      `[2:a][_fb_a_rs]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[_srcRaw]`,
      `[6:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_vol]`,
      `[_srcRaw][_vol]amultiply[_srcFin]`,
      micClean,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=10:normalize=0[_rawA]`,
      `[_rawA]aresample=async=8000[_audio]`,
    ].join(";");
  } else {
    // Live source (TikTok / YouTube / X Space / RTSP / browser camera) has audio.
    // Blend source + silence fallback, multiply by volume pipe, then mix in cleaned mic.
    audioFilter = [
      // dropout_transition=10: bridge up to 10s of source audio dropout with silence
      // so a brief network hiccup never causes an audible gap in the RTMP output.
      `[2:a][0:a]amix=inputs=2:duration=first:dropout_transition=10:normalize=0[_srcRaw]`,
      `[6:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_vol]`,
      `[_srcRaw][_vol]amultiply[_srcFin]`,
      micClean,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=10:normalize=0[_rawA]`,
      `[_rawA]aresample=async=8000[_audio]`,
    ].join(";");
  }

  let filterGraph: string;

  if (isXSpace) {
    // X Space is audio-only — no [0:v] exists. Build video from gradient/black only.
    const hasXSpaceBg = !!(xspaceVideoPath || xspaceImageUrl);
    if (hasXSpaceBg) {
      // With a background media (input 7): scale & pad it to fill frame, overlay
      // above the gradient but below the UI overlay so the image/video is visible behind chat.
      // For video loops: eof_action=repeat on the UI overlay keeps rendering if the video
      // file temporarily stalls; the video itself loops via -stream_loop -1.
      filterGraph = [
        // pipe:3 is already rgba at scaleW×scaleH — no scale needed.
        `[3:v]format=rgba[_bg]`,
        `[1:v][_bg]overlay=0:0:format=auto[_base]`,
        // input 7 (bg video/image) may be any resolution — scale+pad required.
        `[7:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2,format=rgba[_img]`,
        `[_base][_img]overlay=0:0:format=auto[_baseImg]`,
        // pipe:4 is already rgba at scaleW×scaleH — no scale needed.
        `[4:v]format=rgba[_ui]`,
        `[_baseImg][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
        audioFilter,
      ].join(";");
    } else {
      filterGraph = [
        // pipe:3/pipe:4 are already rgba at scaleW×scaleH — no scale needed.
        `[3:v]format=rgba[_bg]`,
        `[1:v][_bg]overlay=0:0:format=auto[_base]`,
        `[4:v]format=rgba[_ui]`,
        `[_base][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
        audioFilter,
      ].join(";");
    }
  } else {
    // Scale video to fill the OUTPUT WIDTH exactly, then:
    //   • pad top/bottom with transparent pixels when the scaled height < frame height
    //     (e.g. landscape 16:9 source in a portrait 9:16 frame)
    //   • center-crop top/bottom when the scaled height > frame height
    //     (e.g. portrait 9:16 source in a landscape 16:9 frame)
    // Result: left & right edges always touch the frame edge; gradient from
    // pipe:3 shows through the transparent top/bottom bars.
    // IMPORTANT: format=yuva420p must come FIRST so that the pad filter can
    // write alpha=0 (transparent) pixels into the bar areas.  Placing it at
    // the end means pad runs on yuv420p (no alpha) and the filter graph
    // deadlocks — FFmpeg hangs, never exits, and handleProcessExit never fires.
    const videoSrcFilter = [
      // setpts=PTS-STARTPTS: normalise the source video timestamps to begin at 0.
      // TikTok HLS (and sometimes YouTube) MPEG-TS streams carry absolute PTS values
      // (e.g. 90000×N seconds of TS clock) that can be orders of magnitude larger than
      // the lavfi inputs [1:v]/[3:v]/[4:v] which start at PTS=0.  When the overlay
      // filter tries to time-align [_base] (lavfi, PTS≈0) with [_src] (TikTok,
      // PTS≈huge), it buffers [_base] frames waiting for [_src]'s timestamps to
      // "match" — accumulating decoded frames in the overlay FIFO for the entire
      // playback duration.  setpts=PTS-STARTPTS resets the live source to PTS=0 so
      // both inputs to overlay are on the same relative timescale from the start.
      `[0:v]setpts=PTS-STARTPTS,format=yuva420p`,
      // fast_bilinear: bilinear scaling with no fancy interpolation — ~40% less CPU
      // than the default (bicubic/Lanczos) at the cost of negligible quality loss
      // on a 30fps live encode where every millisecond counts.
      `scale=${scaleW}:-2:flags=fast_bilinear`,
      `pad=${scaleW}:'if(lte(ih,${scaleH}),${scaleH},ih)':0:'if(lte(ih,${scaleH}),(${scaleH}-ih)/2,0)':color=black@0`,
      `crop=${scaleW}:${scaleH}:0:'if(gte(ih,${scaleH}),(ih-${scaleH})/2,0)'`,
      `setsar=1[_src]`,
    ].join(",");

    filterGraph = [
      videoSrcFilter,
      // Step 1: gradient pipe — pipe:3 is already rgba at scaleW×scaleH, no scale needed.
      `[3:v]format=rgba[_bg]`,
      // Step 2: black fallback base + gradient on top → solid coloured background.
      `[1:v][_bg]overlay=0:0:format=auto[_base]`,
      // Step 3: video (yuva420p — transparent bars where no video pixels exist)
      // laid on top of the gradient background.
      // eof_action=repeat: freeze last video frame during brief reconnect gaps.
      `[_base][_src]overlay=0:0:format=auto:eof_action=repeat[_composed]`,
      // pipe:4 is already rgba at scaleW×scaleH — no scale needed.
      `[4:v]format=rgba[_ui]`,
      `[_composed][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
      audioFilter,
    ].join(";");
  }

  args.push("-filter_complex", filterGraph);
  args.push("-map", "[_final]");
  args.push("-map", "[_audio]");

  // ── Video encoder — YouTube "Excellent connection" settings ──────────────
  // preset: "ultrafast" is the new default for maximum VPS stability.
  //   Compared to "superfast" it cuts x264 CPU usage by another ~20-30%,
  //   keeping speed consistently at or above 1.0x on shared/low-core VPS
  //   hardware where "superfast" or "veryfast" caused speed=0.87-0.92x and
  //   the slow-encode watchdog triggered restarts. The quality reduction at
  //   live-streaming bitrates (4500–6000 kbps) is imperceptible to viewers.
  //   "superfast" remains available via stream.encoderPreset for operators
  //   with more CPU headroom who want slightly higher quality.
  // tune=zerolatency: keeps the encoder delay to 0 frames — critical for live
  //   streaming where any encoder buffer means higher end-to-end latency.
  //   Also disables lookahead buffers inside x264, which further reduces CPU.
  // profile=high + level=4.1: maximum compatibility with YouTube's ingest decoder.
  //   level 4.1 allows up to 1080p60 at ~50 Mbps — well above our target bitrates.
  // bf=0: no B-frames; YouTube Live's ingest pipeline does not support B-frames
  //   and will incorrectly re-order packets if they are present.
  // nal-hrd=cbr:force-cfr=1: NAL-level Constant Bitrate — the only encoding mode
  //   YouTube's infrastructure treats as truly constant (VBR causes bitrate spikes
  //   that trigger the "not receiving enough video" Studio warning).
  // g=fps*2: 2-second keyframe interval — YouTube's required GOP size for live.
  // sc_threshold=0: disable scene-change detection for fixed GOP (consistent keyframes).
  // fps_mode=cfr: Constant Frame Rate — ensures YouTube never sees timestamp gaps
  //   that trigger dropped-frame warnings in Studio. Also prevents the encoder
  //   from stalling waiting for a frame from a slow input.
  let encoderPreset = (stream.encoderPreset as string) || "ultrafast";
  if (aqmOverride?.preset) encoderPreset = aqmOverride.preset;
  args.push(
    "-c:v", "libx264",
    "-preset", encoderPreset,
    "-tune", "zerolatency",
    "-b:v", bitrate,
    "-minrate", bitrate,
    // nal-hrd=cbr requires -minrate = -maxrate = bitrate so that x264's HRD
    // model inserts filler NAL units whenever the encoded bitrate would fall
    // below the target.  Setting -maxrate higher than -minrate (e.g. 110%)
    // breaks the invariant: the VBV only enforces the ceiling, the floor is
    // free to drop toward zero during static content (eof_action=repeat freeze
    // frames, black background, HLS segment gaps).  That drop is exactly what
    // triggers YouTube Studio's "not receiving enough data" disconnect at ~2 min.
    // maxrate = bitrate (not the 110% value) is intentional for strict CBR.
    "-maxrate", bitrate,
    "-bufsize", bufsize,
    "-profile:v", "high",
    "-level", "4.1",
    "-bf", "0",
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt", "yuv420p",
    "-g", String(fps * 2),
    "-keyint_min", String(fps * 2),
    "-sc_threshold", "0",
    "-r", String(fps),
    "-fps_mode", "cfr",
    "-flags", "+global_header",
  );

  // AAC at 48 kHz stereo — YouTube's required audio specification.
  // 48000 Hz is the YouTube Live ingest standard; 44100 Hz causes YouTube's
  // encoder to internally resample, introducing per-frame timing jitter that
  // accumulates into A/V drift over multi-hour streams.
  // 160 kbps is the YouTube-recommended bitrate ceiling for stereo AAC.
  args.push(
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "48000",
    "-ac", "2",
    "-profile:a", "aac_low",
  );

  // ── RTMP output(s) — always tee for resilience ───────────────────────────
  // rw_timeout=20s: YouTube ingest can be slow to accept connections; 5s was
  // too short and caused outputs to be classified as failed prematurely.
  // onfail=ignore is intentionally NOT used here — once an output is dropped
  // by the tee muxer with onfail=ignore it is permanently gone and never
  // reconnects, causing YouTube "not receiving data" errors. We instead detect
  // the failure via the stderr "Ignoring failure for output" message and do a
  // clean hardKillAndRestart so the full RTMP session is re-established.
  //
  // rtmp_buffer=8000 (8 seconds): a client-side RTMP send buffer between
  // FFmpeg and YouTube's ingest server.  Without it, any encoder pause
  // (HLS segment boundary, CPU burst, brief filter stall) sends nothing to
  // YouTube for that interval, triggering the "not receiving enough video to
  // maintain smooth streaming" warning.  An 8-second buffer absorbs TikTok
  // HLS segment-boundary gaps (typically 2–4 s) and brief CPU spikes without
  // YouTube ever seeing a delivery pause. Previously 5000 ms — raised to 8000
  // after sustained 0.89x speeds caused visible cuts on TikTok→YouTube relay.
  // max_delay=0: do not buffer output packets waiting to fill a presentation
  // window; emit each packet as soon as it is ready.  Prevents the muxer from
  // holding frames for reordering and keeps end-to-end latency minimal.
  args.push("-max_delay", "0");
  // flush_packets=1: flush the I/O buffer after every packet instead of waiting
  // for the OS to do it.  Eliminates micro-stalls where the muxer has produced
  // a packet but the network write is delayed by buffer coalescing.
  args.push("-flush_packets", "1");
  args.push("-avoid_negative_ts", "make_zero");
  const teeOutputs = outputs
    .map((o) => `[f=flv:flvflags=no_duration_filesize:rtmp_live=1:rtmp_buffer=8000:rw_timeout=20000000]${o}`)
    .join("|");
  args.push("-f", "tee", teeOutputs);

  return args;
}

// ── Circuit-breaker-guarded URL resolver ──────────────────────────────────────
// All code paths that need a live URL call this wrapper instead of
// resolveInputUrl directly.  The wrapper enforces the circuit-breaker policy
// so that a storm of resolution failures (e.g. rate-limit cascade) cannot
// spawn unbounded yt-dlp / streamlink processes.
async function resolveInputUrlSafe(
  stream: StreamConfig,
  forceRefresh: boolean,
): Promise<{ url: string; sourceType: "tiktok" | "youtube" | "facebook" | "camera" | "upload" }> {
  const { id: streamId, sourceType } = stream;

  // Camera and upload sources are resolved locally — no external resolver needed
  if (sourceType === "camera" || sourceType === "upload") {
    return resolveInputUrl(stream, forceRefresh);
  }

  if (!cbCanAttempt(streamId)) {
    const cb = getCB(streamId);
    const remainMs = Math.max(0, CB_OPEN_COOLDOWN_MS - (Date.now() - (cb.openedAt ?? 0)));
    const remainMin = Math.ceil(remainMs / 60_000);
    throw new Error(
      `[circuit-breaker] URL resolution suspended — too many failures. Resuming in ~${remainMin} min.`,
    );
  }

  try {
    const result = await resolveInputUrl(stream, forceRefresh);
    cbRecordSuccess(streamId);
    return result;
  } catch (e: any) {
    // Definitive errors (NOT_LIVE, LIVE_ENDED, etc.) are not resolver failures —
    // they indicate the source is genuinely unavailable, not a transient problem.
    // Don't charge them against the circuit breaker.
    const code: string | undefined = e.code;
    const definitiveErrors = new Set([
      "NOT_LIVE", "LIVE_ENDED", "PRIVATE_ACCOUNT", "PRIVATE_VIDEO",
      "REGION_RESTRICTED", "GEO_RESTRICTED", "AGE_RESTRICTED",
      "MEMBERS_ONLY", "SCHEDULED", "UNAVAILABLE",
    ]);
    if (!code || !definitiveErrors.has(code)) {
      cbRecordFailure(streamId);
    }
    throw e;
  }
}

async function resolveInputUrl(
  stream: StreamConfig,
  forceRefresh = false,
): Promise<{ url: string; sourceType: "tiktok" | "youtube" | "facebook" | "camera" | "upload" }> {
  const sourceType = stream.sourceType || "tiktok";

  if (sourceType === "upload") {
    const filePath = stream.uploadedVideoPath || "";
    if (!filePath) throw new Error("No video file uploaded. Please upload a video file first.");
    const fs = await import("fs");
    if (!fs.existsSync(filePath)) throw new Error(`Uploaded video file not found: ${filePath}`);
    return { url: filePath, sourceType: "upload" };
  }

  if (sourceType === "camera") {
    // Browser camera mode — WebSocket sends video data directly to FFmpeg stdin.
    // Treat empty device, __browser__, or the schema placeholder /dev/video0
    // (which doesn't exist in cloud/Replit environments) as __browser__ so that
    // Guest Room mode works without needing to explicitly set the device path.
    const device = stream.cameraDevice || "";
    const isPlaceholder = device === "" || device === "/dev/video0";
    if (browserCameraStreams.has(stream.id) || device === "__browser__" || isPlaceholder) {
      return { url: "__browser__", sourceType: "camera" };
    }
    return { url: device, sourceType: "camera" };
  }

  // Reuse a recently cached URL to skip 20-35s re-resolution on fast restarts
  if (!forceRefresh) {
    const cached = getCachedUrl(stream.id);
    if (cached && cached.sourceType === sourceType) {
      logger.info({ streamId: stream.id, sourceType }, "Reusing cached input URL");
      return { url: cached.url, sourceType: cached.sourceType };
    }
  }

  if (sourceType === "youtube") {
    const input = (stream.youtubeSourceUrl || "").trim();
    if (!input) throw new Error("YouTube source URL or handle is required");

    // If the user pasted a direct HLS .m3u8 URL, pass it to FFmpeg as-is.
    // For all other YouTube URLs (page/channel/handle), use yt-dlp pipe mode:
    // yt-dlp streams MPEG-TS to FFmpeg stdin, keeping all CDN requests (including
    // POT token rotation) inside yt-dlp's session — this avoids the 429 errors
    // that occur when FFmpeg tries to fetch HLS segments directly from YouTube CDN.
    const isDirect = input.includes(".m3u8");
    if (isDirect) {
      urlCache.set(stream.id, { url: input, sourceType: "youtube", resolvedAt: Date.now() });
      return { url: input, sourceType: "youtube" };
    }
    // Return pipe:0 — yt-dlp will be spawned in startStream and piped to FFmpeg stdin.
    return { url: "pipe:0", sourceType: "youtube_pipe" as any };
  }

  if (sourceType === "facebook") {
    const input = (stream.facebookSourceUrl || "").trim();
    if (!input) throw new Error("Facebook Live URL is required");
    const resolved = normaliseFacebookUrl(input);
    if (!resolved) throw new Error(
      "Facebook Live requires a direct video URL containing a video ID, e.g. " +
      "facebook.com/watch/live/?v=123456789012345 or a plain numeric video ID. " +
      "Bare page names (e.g. 'pagename') cannot be resolved without login cookies."
    );
    // Pipe mode — yt-dlp spawned in startStream and piped to FFmpeg stdin.
    return { url: "pipe:0", sourceType: "facebook_pipe" as any };
  }

  if (sourceType === "xspace") {
    const spaceUrl = stream.xspaceUrl || "";
    if (!spaceUrl) throw new Error("X Space URL is required");
    // yt-dlp extracts the HLS audio URL from the X Space link.
    // Cache it — yt-dlp extraction can take 10-20s and the URL is valid for ~10min.
    const audioUrl = await getXSpaceAudioUrl(spaceUrl);
    urlCache.set(stream.id, { url: audioUrl, sourceType: "xspace" as any, resolvedAt: Date.now() });
    return { url: audioUrl, sourceType: "xspace" as any };
  }

  if (sourceType === "link") {
    const input = (stream.linkSourceUrl || "").trim();
    if (!input) throw new Error("Video link URL is required");
    // yt-dlp pipe mode — handles YouTube, Facebook, Twitch, Vimeo, Twitter/X,
    // TikTok, and thousands of other sites without a separate quality probe.
    return { url: "pipe:0", sourceType: "link_pipe" as any };
  }

  if (!stream.tiktokUsername) throw new Error("TikTok username is required");
  // Pipe mode: SourceRelay will spawn streamlink --stdout and manage the connection.
  // This avoids resolving a temporary CDN URL that expires in 5–30 minutes.
  // streamlink continuously refreshes the HLS playlist internally — no URL expiry.
  return { url: "pipe:0", sourceType: "tiktok_pipe" as any };
}

async function getXSpaceAudioUrl(spaceUrl: string): Promise<string> {
  const xCookiesPath = path.join(process.cwd(), "x-cookies.txt");
  const cookiesArgs = fs.existsSync(xCookiesPath) ? ["--cookies", xCookiesPath] : [];

  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [0, 3_000, 9_000, 27_000]; // 0s, 3s, 9s, 27s

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const delay = BACKOFF_MS[attempt - 1] ?? 27_000;
    if (delay > 0) {
      logger.info({ spaceUrl, attempt, delayMs: delay }, "[xspace] Waiting before retry...");
      await new Promise<void>((r) => setTimeout(r, delay));
    }

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const ytdlp = spawn(YTDLP_BIN, [
          "--no-config",
          "-g",
          "--no-playlist",
          "-f", "bestaudio",
          "--no-warnings",
          "--socket-timeout", "20",
          ...cookiesArgs,
          spaceUrl,
        ]);

        let stdout = "";
        let stderr = "";
        ytdlp.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        ytdlp.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          try { ytdlp.kill("SIGKILL"); } catch {}
          reject(new Error("yt-dlp timed out after 30s"));
        }, 30_000);

        ytdlp.on("close", (code) => {
          clearTimeout(timer);
          const audioUrl = stdout.trim().split("\n")[0]?.trim();
          if (code === 0 && audioUrl) {
            resolve(audioUrl);
          } else {
            reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(0, 300)}`));
          }
        });

        ytdlp.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          reject(new Error(err.code === "ENOENT" ? "yt-dlp is not installed on the server" : err.message));
        });
      });

      logger.info({ spaceUrl, attempt }, "[xspace] HLS audio URL extracted successfully");
      return url;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      const isFatal =
        lastError.includes("is not installed") ||
        lastError.includes("Space has ended") ||
        lastError.includes("not found") ||
        lastError.includes("does not exist");

      logger.warn({ spaceUrl, attempt, error: lastError }, `[xspace] Attempt ${attempt}/${MAX_ATTEMPTS} failed`);

      if (isFatal || attempt === MAX_ATTEMPTS) break;
    }
  }

  throw new Error(`Failed to extract X Space audio after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`);
}

// ── Frame-stall watchdog ──────────────────────────────────────────────────────
// Monitors encoded OUTPUT frame progress (frame= counter from FFmpeg stderr),
// NOT overlay-pipe frame count or source frame count.  The overlay pipes render
// at 2 fps (500 ms interval), well within the 15 s stall threshold.
// 15 s: YouTube gives ~2 min of grace for "no data"; we need each stall+restart
// cycle to finish well under 30 s so multiple incidents don't accumulate to 2 min.
// With the 90-second URL pre-fetch the restart itself takes < 5 s (no streamlink
// wait), so a 15 s watchdog → < 20 s total gap per incident.
const STALL_TIMEOUT_MS = 15_000;
const HEALTH_WARN_MS = 10_000; // warn before stall watchdog fires
// TikTok/xSpace streamlink sessions expire after ~3 hours.  Force a proactive
// restart before that so the stream never dies silently from session expiry.
const SESSION_REFRESH_MS = 3 * 60 * 60 * 1000; // 3 hours


function makeStallWatchdog(
  streamId: string,
  getLastFrame: () => number,
  getRelay: () => SourceRelay | undefined,
  trigger: () => void,
  intervalMs: number,
): NodeJS.Timeout {
  let lastSeenFrame = getLastFrame();
  return setInterval(() => {
    const relay = getRelay();
    const currentFrame = getLastFrame();

    // ── Relay-aware suppression ──────────────────────────────────────────────
    // While the relay is in reconnecting/recovering state, FFmpeg has no data
    // from pipe:0 — frame count will stall by design. ALWAYS suppress the
    // watchdog when a relay exists and is stalled.
    //
    // Previously we escalated after RECOVERY_DEADLINE_MS (90 s), but that
    // caused needless FFmpeg restarts during 429 rate-limit backoffs where
    // yt-dlp waits up to 60 s between retries. Restarting FFmpeg during
    // backoff creates a new process that also has no source immediately —
    // just adding a 2-5 s viewer cut with no recovery benefit.
    // The relay escalates to "failed" after maxConsecutiveFailures (999) retries;
    // the relay's own "failed" event (handled in startStream) is the correct
    // escalation path. Until that point, let the relay keep trying.
    if (relay?.isStalled()) {
      const elapsedMs = relay.getReconnectStartedAt()
        ? Date.now() - relay.getReconnectStartedAt()!
        : 0;
      logger.info(
        { streamId, elapsedMs, relayState: relay.getStatus() },
        "[watchdog] suppressed — relay reconnecting",
      );
      // Reset baseline so the watchdog doesn't immediately re-fire when frames resume.
      lastSeenFrame = currentFrame;
      return;
    }

    // Suppress when the relay is nominally "running" but the source has stopped
    // sending bytes (e.g. TikTok HLS segment gap). FFmpeg is blocking on stdin —
    // no new frames is expected, not a fault. The relay's own health monitor will
    // kill and re-extract streamlink if the gap exceeds MID_STREAM_STALL_MS.
    // Restarting FFmpeg here would cause an unnecessary cut.
    if (relay?.isDataStalled()) {
      lastSeenFrame = currentFrame;
      return;
    }

    if (currentFrame === lastSeenFrame) {
      logger.warn({ streamId, frame: currentFrame }, "Frame stall detected — triggering restart");
      sendLog(
        streamId,
        `Frame stall detected (no new frames for ${Math.round(intervalMs / 1000)}s) — restarting...`,
      );
      trigger();
    } else {
      lastSeenFrame = currentFrame;
    }
  }, intervalMs);
}

function stopBreakDecoder(streamId: string): void {
  const proc = activeStreams.get(streamId);
  if (!proc) return;
  if (proc.breakDecoder) {
    try { proc.breakDecoder.kill("SIGKILL"); } catch {}
    proc.breakDecoder = undefined;
  }
  proc.uiRenderer?.setExternalFrame(null);
}

function startBreakDecoder(
  streamId: string,
  videoUrl: string,
  panX: number,
  panY: number,
  breakVideoMode?: string,
): void {
  const proc = activeStreams.get(streamId);
  if (!proc?.uiRenderer) return;

  const stream = storage.getStream(streamId);
  if (!stream) return;

  // Kill any running decoder for this stream before starting a new one
  if (proc.breakDecoder) {
    try { proc.breakDecoder.kill("SIGKILL"); } catch {}
    proc.breakDecoder = undefined;
  }

  const isVertical = stream.ratio === "mobile";
  const _isBest720 = stream.quality === "best";
  const _is720p    = stream.quality === "720p";
  const outW = isVertical
    ? (_isBest720 ? 1080 : _is720p ? 720 : 480)
    : (_isBest720 ? 1920 : _is720p ? 1280 : 854);
  const outH = isVertical
    ? (_isBest720 ? 1920 : _is720p ? 1280 : 854)
    : (_isBest720 ? 1080 : _is720p ? 720 : 480);

  const panXF = (panX / 100).toFixed(4);
  const panYF = (panY / 100).toFixed(4);

  const mode = breakVideoMode ?? currentOverlayState.breakVideoMode ?? "fullscreen";

  let vf: string;
  if (mode === "live-bg" || mode === "gradient-bg") {
    // Letterbox: preserve video aspect ratio with transparent bars so the BG pipe shows through.
    vf = [
      `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
      `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`,
      `format=rgba`,
    ].join(",");
  } else {
    // fullscreen: scale to fill the output frame, then crop with pan offset — no black bars.
    vf = [
      `scale='if(gt(iw/ih,${outW}/${outH}),trunc(oh*(iw/ih)/2)*2,${outW})':'if(gt(iw/ih,${outW}/${outH}),${outH},trunc(ow*(ih/iw)/2)*2)'`,
      `crop=${outW}:${outH}:max(0\\,(iw-${outW})*${panXF}):max(0\\,(ih-${outH})*${panYF})`,
      `format=rgba`,
    ].join(",");
  }

  const isHttp = videoUrl.startsWith("http://") || videoUrl.startsWith("https://");
  const isHttps = videoUrl.startsWith("https://");
  const inputArgs: string[] = isHttp
    ? [
        "-stream_loop", "-1",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_on_network_error", "1",
        "-reconnect_delay_max", "5",
        "-rw_timeout", "15000000",
        ...(isHttps ? ["-tls_verify", "0"] : []),
      ]
    : ["-stream_loop", "-1"];

  const decoderArgs = [
    "-loglevel", "error",
    "-re",           // real-time rate: prevents reading far ahead of the renderer
    ...inputArgs,
    "-i", videoUrl,
    "-vf", vf,
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-r", "5",
    "pipe:1",
  ];

  sendLog(streamId, "Break video: decoder starting (no stream interruption)…");
  const decoder = spawn("ffmpeg", decoderArgs);
  proc.breakDecoder = decoder;

  const frameSize = outW * outH * 4;
  let accumulated = Buffer.allocUnsafe(0);
  let decoderGotFrames = false;

  decoder.stdout?.on("data", (chunk: Buffer) => {
    if (!decoderGotFrames) {
      decoderGotFrames = true;
      sendLog(streamId, "Break video: playing ✓");
    }
    accumulated = Buffer.concat([accumulated, chunk]);
    while (accumulated.length >= frameSize) {
      const frame = accumulated.subarray(0, frameSize);
      accumulated = accumulated.subarray(frameSize);
      // Discard if too far ahead (>3 frames) to prevent memory growth
      if (accumulated.length < frameSize * 3) {
        const currentProc = activeStreams.get(streamId);
        if (currentProc?.breakDecoder === decoder) {
          currentProc.uiRenderer?.setExternalFrame(Buffer.from(frame));
        }
      }
    }
  });

  // Log decoder errors so the user can see why a URL failed
  let decoderErrBuf = "";
  decoder.stderr?.on("data", (chunk: Buffer) => {
    decoderErrBuf += chunk.toString();
    const lines = decoderErrBuf.split("\n");
    decoderErrBuf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      logger.warn({ streamId, decoder: t }, "Break decoder stderr");
      sendLog(streamId, `Break video error: ${t}`);
    }
  });

  decoder.on("exit", () => {
    const currentProc = activeStreams.get(streamId);
    if (!currentProc || currentProc.breakDecoder !== decoder) return;
    currentProc.breakDecoder = undefined;

    // Auto-restart decoder if break is still active with the same URL
    if (currentOverlayState.breakActive && currentOverlayState.breakVideoUrl === videoUrl) {
      logger.info({ streamId }, "Break decoder exited — restarting");
      setTimeout(() => {
        if (currentOverlayState.breakActive && activeStreams.has(streamId)) {
          startBreakDecoder(streamId, videoUrl, panX, panY, currentOverlayState.breakVideoMode);
        }
      }, 1000);
    } else {
      currentProc.uiRenderer?.setExternalFrame(null);
    }
  });

  decoder.on("error", (err: NodeJS.ErrnoException) => {
    const currentProc = activeStreams.get(streamId);
    if (currentProc?.breakDecoder === decoder) currentProc.breakDecoder = undefined;
    if (err.code === "ENOENT") sendLog(streamId, "Break decoder: ffmpeg not found on system");
  });
}

function purgeUploadsDir(): void {
  const dir = path.join(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    let count = 0;
    for (const file of files) {
      if (file === ".gitkeep") continue;
      try { fs.unlinkSync(path.join(dir, file)); count++; } catch {}
    }
    if (count > 0) logger.info({ dir, count }, "Uploads purged after last stream stopped");
  } catch (err: any) {
    logger.warn({ err: err.message }, "Failed to purge uploads directory");
  }
}

function startProcStatsPolling(streamId: string, pid: number): NodeJS.Timeout {
  let statsTick = 0;
  return setInterval(() => {
    exec(`ps -p ${pid} -o %cpu=,rss=`, (err, stdout) => {
      if (err) {
        // Process gone — but only update scorer if the stream is still registered
        // in activeStreams. If handleProcessExit already cleaned up, scorerSetFFmpegAlive
        // would trigger a spurious recompute with no matching proc and no guards set.
        if (activeStreams.has(streamId)) scorerSetFFmpegAlive(streamId, false);
        return; // interval cleared in cleanupStreamProc
      }
      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 2) return;
      const cpu = parseFloat(parts[0]);
      const mem = Math.round(parseInt(parts[1], 10) / 1024); // KB → MB
      if (!isNaN(cpu) && !isNaN(mem)) {
        const proc = activeStreams.get(streamId);
        if (proc) { proc.lastCpuPct = cpu; proc.lastMemMb = mem; }
        const frames = proc?.lastFrameCount ?? 0;
        const uptime = proc?.streamStartTime ? Math.floor((Date.now() - proc.streamStartTime) / 1000) : 0;
        const health = getHealthSnapshot(streamId);
        const encSpeed = proc?.lastSpeed ?? 0;
        const droppedFrames = proc?.totalDroppedFrames ?? 0;
        const lagSec = proc?.accumulatedLagSec ?? 0;
        const recoveryAttempts = proc?.recoveryAttempts ?? 0;

        // Log CPU/mem/speed every ~30s at debug level for operator visibility
        if (statsTick % 10 === 0) {
          logger.info(
            {
              streamId,
              cpu: cpu.toFixed(1),
              memMb: mem,
              speed: encSpeed.toFixed(3),
              fps: proc?.lastFps ?? 0,
              bitrateKbps: proc?.lastBitrate ?? 0,
              droppedFrames,
              lagSec: lagSec.toFixed(2),
              reconnects: proc?.reconnectCount ?? 0,
              recoveryAttempts,
              uptime,
            },
            "[perf] stream stats",
          );
        }

        const aqmSnap = aqmStore.get(streamId)?.getSnapshot() ?? null;
        const chartPayload = {
          cpu,
          mem,
          frames,
          uptime,
          bitrate: proc?.lastBitrate ?? 0,
          fps: proc?.lastFps ?? 0,
          speed: encSpeed,
          droppedFrames,
          lagSec: parseFloat(lagSec.toFixed(2)),
          recoveryAttempts,
          reconnectCount: proc?.reconnectCount ?? 0,
          healthScore: health?.score ?? 100,
          healthStatus: health?.status ?? "excellent",
          aqmStage: aqmSnap?.stage ?? 0,
          aqmPhase: aqmSnap?.phase ?? "nominal",
          aqmBottleneck: aqmSnap?.primaryBottleneck?.subsystem ?? null,
          aqmHealth: aqmSnap?.healthScore ?? null,
          // Real active encoding parameters — set at FFmpeg launch, not derived from config.
          activeResW: proc?.activeResW ?? null,
          activeResH: proc?.activeResH ?? null,
          activeBitrateKbps: proc?.activeBitrateKbps ?? null,
          activeFps: proc?.activeFps ?? null,
        };
        broadcastStream(streamId, "proc_stats", chartPayload);

        // ── Memory circuit-breaker ────────────────────────────────────────────
        // Two-level response:
        //   1. At 1.0 GB: self-healing hardKillAndRestart (RTMP stays connected,
        //      AQM state preserved, 2-min cooldown prevents restart loops).
        //   2. At 1.4 GB: force stop — the restart itself must have failed or the
        //      growth is too fast; stop to prevent OOM crash.
        //
        // Root cause when hit: lavfi thread queue (pipe:1, thread_queue_size)
        // accumulating raw video frames faster than the encoder can consume them
        // (speed < 1.0x → lavfi outpaces filter graph at (1-speed)×fps×frame_size
        // per second).  The queue sizes have been reduced to cap this, but the
        // circuit-breaker remains as a last-resort safeguard.
        const cbNow = Date.now();
        if (mem > 1400) {
          logger.error(
            { streamId, memMb: mem },
            "[safety] FFmpeg RSS > 1.4 GB — force stopping to prevent OOM",
          );
          sendLog(streamId, `[safety] FFmpeg memory ${mem} MB exceeded 1.4 GB — stream stopped to prevent OOM.`);
          memRestartCooldown.delete(streamId);
          stopStream(streamId);
          return;
        }
        if (mem > 1000) {
          const lastRestart = memRestartCooldown.get(streamId) ?? 0;
          if (cbNow - lastRestart > 120_000) {
            memRestartCooldown.set(streamId, cbNow);
            logger.warn(
              { streamId, memMb: mem },
              "[safety] FFmpeg RSS > 1.0 GB — triggering self-healing restart",
            );
            sendLog(streamId, `[safety] FFmpeg memory ${mem} MB exceeded 1.0 GB — restarting pipeline automatically (RTMP stays connected).`);
            hardKillAndRestart(streamId, 500, false, true /* keepStatus */);
            return;
          }
        }
        if (mem > 600 && statsTick % 2 === 0) {
          // Log more frequently when memory is elevated (every 6s instead of 30s)
          logger.info(
            { streamId, memMb: mem, speed: encSpeed.toFixed(3), cpu: cpu.toFixed(1) },
            "[safety] elevated FFmpeg memory — monitoring",
          );
        }

        // Mark source stable every polling cycle so failover can auto-reset
        markSourceStable(streamId);
      }

      // Push audience stats (subs/viewers) every ~15s (every 5th proc_stats tick)
      statsTick++;
      if (statsTick % 5 === 0) {
        const { subs, viewers } = getLiveStats(streamId);
        broadcastStream(streamId, "stats", { subs, viewers, hasChat: subs !== null || viewers !== null });
      }
    });
  }, 3000);
}

function cleanupStreamProc(streamId: string, proc: StreamProcess) {
  if (proc.watchdog) clearTimeout(proc.watchdog);
  if (proc.stallWatchdog) clearInterval(proc.stallWatchdog);
  if (proc.statsInterval) clearInterval(proc.statsInterval);
  if (proc.prefetchTimer) clearTimeout(proc.prefetchTimer);
  if (proc.sessionRefreshTimer) clearTimeout(proc.sessionRefreshTimer);
  if (proc.gracefulKillTimer) { clearTimeout(proc.gracefulKillTimer); proc.gracefulKillTimer = undefined; }
  proc.sustainedSlowSpeedStartAt = undefined;
  proc.accumulatedLagSec = 0;
  if (proc.ytSourceProcess) {
    try { proc.ytSourceProcess.kill("SIGKILL"); } catch {}
    proc.ytSourceProcess = undefined;
  }
  if (proc.sourceRelay) {
    proc.sourceRelay.stop();
    proc.sourceRelay = undefined;
  }

  proc.bgRenderer?.stop();
  proc.uiRenderer?.stop();
  if (proc.micPipe) {
    proc.micPipe.stop();
    activeMicPipes.delete(proc.micPipe);
  }
  if (proc.volumePipe) proc.volumePipe.stop();
  if (proc.breakDecoder) {
    try { proc.breakDecoder.kill("SIGKILL"); } catch {}
    proc.breakDecoder = undefined;
  }
  browserCameraPipes.delete(streamId);
  browserCameraBuffers.delete(streamId);
  stopHlsEncoder(streamId);
  // Tell health scorer FFmpeg is no longer running (don't remove — keeps history)
  scorerSetFFmpegAlive(streamId, false);
}


export async function startStream(streamId: string, reuseUrl = false, keepStatus = false) {
  // Capture whether this is a user-initiated start (manuallyStopped flag was set)
  // vs. an auto-reconnect triggered by hardKillAndRestart. AQM quality state is
  // preserved across auto-reconnects so degraded parameters persist between restarts,
  // but is reset on fresh user-initiated starts so quality improves from scratch.
  const wasManuallyStoppped = manuallyStopped.has(streamId);
  // Clear the manual-stop guard so auto-restart timers work again after an
  // explicit restart (API /start or hardKillAndRestart called from the UI).
  manuallyStopped.delete(streamId);

  const stream = storage.getStream(streamId);
  if (!stream) throw new Error("Stream not found");

  const sourceType = stream.sourceType || "tiktok";

  if (sourceType === "tiktok" && !stream.tiktokUsername)
    throw new Error("TikTok username is required");
  if (sourceType === "youtube" && !stream.youtubeSourceUrl)
    throw new Error("YouTube username or URL is required");
  if (sourceType === "camera" && !stream.cameraDevice && !browserCameraStreams.has(streamId))
    throw new Error("Camera device path is required (or use the browser camera link)");
  if (sourceType === "xspace" && !stream.xspaceUrl)
    throw new Error("X Space URL is required");
  if (sourceType === "upload" && !stream.uploadedVideoPath)
    throw new Error("No video file uploaded. Upload a video file before starting the stream.");
  if (sourceType === "link" && !(stream as any).linkSourceUrl)
    throw new Error("Video link URL is required");
  if (!stream.youtubeStreamKey && !stream.facebookRtmpUrl && !stream.instagramStreamKey && !stream.tiktokStreamKey)
    throw new Error("At least one output (YouTube, Facebook, Instagram, or TikTok) is required");

  stopStream(streamId, !wasManuallyStoppped /* keepAqmState: preserve quality state on auto-reconnect */);
  // stopStream() marks the stream as manually stopped so its cleanup timers abort.
  // We are about to launch a brand-new FFmpeg session, so clear that flag now —
  // otherwise handleProcessExit will see it and silently drop the stream to "idle"
  // instead of auto-restarting on any crash.
  manuallyStopped.delete(streamId);

  // Register with health scorer — compute target bitrate from aqmMode / quality + fps.
  const streamFps = parseInt(stream.fps || "30", 10);
  const is60fps = streamFps >= 60;
  const startAqmMode = (stream as any).aqmMode ?? "auto";
  const aqmV = stream.ratio === "mobile";

  const _aqmResTable = aqmV ? AQM_PORTRAIT_TABLE : AQM_LANDSCAPE_TABLE;
  const _aqmForced = startAqmMode !== "auto" ? (_aqmResTable[startAqmMode] ?? null) : null;
  const aqmB = !_aqmForced && stream.quality === "best";
  const aqm7 = !_aqmForced && stream.quality === "720p";
  const aqmInitW = _aqmForced ? _aqmForced.w : aqmV ? (aqmB ? 1080 : aqm7 ? 720 : 480) : (aqmB ? 1920 : aqm7 ? 1280 : 854);
  const aqmInitH = _aqmForced ? _aqmForced.h : aqmV ? (aqmB ? 1920 : aqm7 ? 1280 : 854) : (aqmB ? 1080 : aqm7 ? 720 : 480);
  const qualityBitrateKbps = _aqmForced
    ? (is60fps ? _aqmForced.kbps60 : _aqmForced.kbps30)
    : stream.quality === "best"
      ? (is60fps ? 6000 : 4500)
      : stream.quality === "720p"
        ? (is60fps ? 3500 : 2500)
        : (is60fps ? 2000 : 1500);

  scorerRegisterStream(streamId, qualityBitrateKbps);
  scorerSetTargetFps(streamId, streamFps);

  // ── Adaptive Quality Manager ───────────────────────────────────────────────
  // Create a fresh AQM on user-initiated starts; preserve existing state on
  // auto-reconnects so quality degradations survive between FFmpeg restarts.
  if (!aqmStore.has(streamId) || wasManuallyStoppped) {
    aqmStore.set(streamId, new AdaptiveQualityManager(streamId, {
      bitrateKbps: qualityBitrateKbps,
      fps: streamFps,
      scaleW: aqmInitW,
      scaleH: aqmInitH,
      quality: stream.quality,
      isVertical: aqmV,
      encoderPreset: (stream.encoderPreset as string) || "ultrafast",
    }));
  }
  const sessionAqm = aqmStore.get(streamId)!;
  // Apply force mode — prevents AQM from degrading resolution in forced modes
  sessionAqm.setMode(startAqmMode);
  const aqmOverride = sessionAqm.getCurrentOverride();

  const encoderPresetLabel = (stream.encoderPreset as string) || "ultrafast";
  const qualityLabel = startAqmMode !== "auto"
    ? startAqmMode.replace("force_", "").toUpperCase()
    : stream.quality;
  sendLog(streamId, `--- Starting stream ---`);
  sendLog(streamId, `Quality: ${qualityLabel}${is60fps ? " 60fps" : ""} | AQM: ${startAqmMode} | FPS: ${stream.fps} | Layout: ${stream.ratio} | Preset: ${encoderPresetLabel}`);
  sendLog(streamId, `Audio: ${stream.muted ? "Muted" : "On"} | Auto-restart: ${stream.autoRestart ? "On" : "Off"} | Sample rate: 48000 Hz`);
  sendLog(streamId, `Video: H.264 High profile L4.1 | CBR | 2s keyframes | yuv420p`);
  if (!keepStatus) sendStatus(streamId, "reconnecting");

  // Holds the relay instance created for pipe-mode sources. Declared here (outside
  // the try block) so the catch block can stop it if startStream throws after
  // relay.start() but before activeStreams.set(). Stored into the proc at
  // activeStreams.set() below — NOT via activeStreams.get() mid-function, which
  // returns the old/missing proc and was the root cause of orphaned relay instances
  // writing to the same FFmpeg stdin (duplicate-relay / "Concatenated FLV" bug).
  let pendingRelay: SourceRelay | undefined;


  try {
    if (sourceType === "tiktok") {
      sendLog(streamId, `Starting TikTok self-healing relay for @${stream.tiktokUsername} (pipe mode — no URL expiry)...`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `YouTube source: direct HLS — connecting FFmpeg to ${stream.youtubeSourceUrl}...`);
    } else if (sourceType === "xspace") {
      sendLog(streamId, `Extracting X Space audio: ${stream.xspaceUrl}...`);
    } else if (sourceType === "upload") {
      const loopLabel = stream.uploadedVideoLoop !== false ? "looping 24/7" : "single play";
      sendLog(streamId, `Source: Uploaded video (${loopLabel}) → ${path.basename(stream.uploadedVideoPath || "")}`);
    } else if (sourceType === "link") {
      sendLog(streamId, `Source: Video Link → ${(stream as any).linkSourceUrl} (yt-dlp pipe mode)`);
    } else if (browserCameraStreams.has(streamId) || stream.cameraDevice === "__browser__") {
      sendLog(streamId, `Source: Browser Camera (waiting for WebSocket stream from guest)`);
    } else {
      sendLog(streamId, `Using camera device: ${stream.cameraDevice}`);
    }

    const resolved = await resolveInputUrlSafe(stream, !reuseUrl);
    const inputUrl = resolved.url;
    const resolvedType = resolved.sourceType as string;

    // Guard: user may have clicked Stop while we were waiting for URL resolution
    // (TikTok/X Space extraction can take 10–35 s). If the stream was deleted from
    // storage in the meantime, abort — otherwise FFmpeg would spawn as an orphan.
    if (!storage.getStream(streamId)) {
      sendLog(streamId, "Stream was stopped during URL resolution — aborting.");
      return;
    }

    if (resolvedType === "tiktok_pipe") {
      sendLog(streamId, `TikTok source ready [pipe mode — streamlink → stdin, self-healing] — launching FFmpeg...`);
    } else if (resolvedType === "youtube_pipe") {
      sendLog(streamId, `YouTube source ready [pipe mode — yt-dlp → stdin, self-healing] — launching FFmpeg...`);
    } else if (resolvedType === "facebook_pipe") {
      sendLog(streamId, `Facebook source ready [pipe mode — yt-dlp → stdin, self-healing] — launching FFmpeg...`);
    } else if (resolvedType === "link_pipe") {
      sendLog(streamId, `Video link ready [pipe mode — yt-dlp → stdin, self-healing] — launching FFmpeg...`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `YouTube source ready [direct HLS] — launching FFmpeg...`);
    } else if (sourceType === "tiktok") {
      const inputType = inputUrl.includes(".m3u8") ? "HLS" : "FLV";
      sendLog(streamId, `TikTok source: ${inputType} (legacy direct-URL mode)`);
    }

    const outputs: string[] = [];
    if (stream.youtubeStreamKey) {
      outputs.push(`rtmp://a.rtmp.youtube.com/live2/${stream.youtubeStreamKey}`);
      sendLog(streamId, `Output: YouTube`);
    }
    if (stream.facebookRtmpUrl) {
      outputs.push(`rtmps://live-api-s.facebook.com:443/rtmp/${stream.facebookRtmpUrl}`);
      sendLog(streamId, `Output: Facebook`);
    }
    if (stream.instagramStreamKey) {
      outputs.push(`rtmps://live-upload.instagram.com:443/live/${stream.instagramStreamKey}`);
      sendLog(streamId, `Output: Instagram`);
    }
    if (stream.tiktokStreamKey) {
      outputs.push(`rtmp://push.tiktokv.com/live/${stream.tiktokStreamKey}`);
      sendLog(streamId, `Output: TikTok`);
    }

    const ffmpegArgs = buildFFmpegArgs(stream, inputUrl, outputs, resolvedType, aqmOverride);
    if (aqmOverride) {
      sendLog(streamId, `[AQM] Stage ${aqmOverride.stage} override active: ${aqmOverride.scaleW}×${aqmOverride.scaleH} @ ${aqmOverride.bitrateKbps}kbps ${aqmOverride.fps}fps`);
    }
    sendLog(streamId, `Launching FFmpeg (1s GOP, 5s RTMP timeout, stall watchdog active)...`);

    // stdio[0] = stdin (pipe:0) — browser camera WebM only
    // stdio[3] = pipe:3 — background gradient RGBA
    // stdio[4] = pipe:4 — UI overlay RGBA
    // stdio[5] = pipe:5 — browser mic PCM16 mono 44100 Hz
    const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Subscriber count is fetched via channels.list which works regardless of
    // live status, so it's already cached and shows up instantly. Viewers +
    // chat require YouTube to resolve the *active live video* (search.list),
    // which is throttled to once every 30 min to save quota. Force a fresh
    // lookup right now (with retries) so viewers/chat appear within seconds
    // of GO LIVE instead of waiting on the next ambient poll cycle.
    if (stream.youtubeChannelId) {
      primeLiveDetection(streamId, stream.youtubeChannelId);
    }

    const isVertical = stream.ratio === "mobile";
    const _ovBest = stream.quality === "best";
    const _ov720  = stream.quality === "720p";
    // Mirror the exact same priority as buildFFmpegArgs:
    //   1. aqmMode force-preset  → fixed resolution, AQM adaptive override ignored
    //   2. AQM adaptive override → dynamic resolution from the quality manager
    //   3. Legacy stream.quality → "best" / "720p" / default tier
    // _aqmForced is already computed above from startAqmMode + the module-level tables.
    const overlayW = _aqmForced
      ? _aqmForced.w
      : aqmOverride
        ? aqmOverride.scaleW
        : (isVertical ? (_ovBest ? 1080 : _ov720 ? 720 : 480) : (_ovBest ? 1920 : _ov720 ? 1280 : 854));
    const overlayH = _aqmForced
      ? _aqmForced.h
      : aqmOverride
        ? aqmOverride.scaleH
        : (isVertical ? (_ovBest ? 1920 : _ov720 ? 1280 : 854) : (_ovBest ? 1080 : _ov720 ? 720 : 480));

    // ── Active encoding parameters — stored on the process so proc_stats can ──
    // broadcast the REAL quality the encoder is running at, not just the config.
    const activeBitrateKbps = _aqmForced
      ? (is60fps ? _aqmForced.kbps60 : _aqmForced.kbps30)
      : aqmOverride
        ? aqmOverride.bitrateKbps
        : stream.quality === "best"
          ? (is60fps ? 6000 : 4500)
          : stream.quality === "720p"
            ? (is60fps ? 3500 : 2500)
            : (is60fps ? 2000 : 1500);
    const activeFps = _aqmForced
      ? streamFps
      : aqmOverride
        ? aqmOverride.fps
        : streamFps;

    const bgRenderer = new OverlayRenderer(overlayW, overlayH, currentOverlayState, isVertical, "bg");
    const uiRenderer = new OverlayRenderer(overlayW, overlayH, currentOverlayState, isVertical, "ui");
    const stdioArr = ffmpegProc.stdio as (NodeJS.WritableStream | null | undefined)[];
    const bgPipe = stdioArr[3] as NodeJS.WritableStream;
    const uiPipe = stdioArr[4] as NodeJS.WritableStream;
    const micPipe5 = stdioArr[5] as NodeJS.WritableStream;

    bgPipe.on("error", () => {});
    uiPipe.on("error", () => {});
    micPipe5.on("error", () => {});

    // Background pipe (pipe:3): static gradient — 2fps is fine and saves CPU.
    // UI pipe (pipe:4): animated content (scrolling news ticker, chat burn-in,
    // donation ticker, etc.) — must match the -framerate "25" declared above.
    // At 2fps the ticker jumps ~40px per frame (500ms gap), causing visible
    // stutter; 15fps is smooth enough for ticker/chat at live-stream quality.
    bgRenderer.startWritingTo(bgPipe, 2);
    uiRenderer.startWritingTo(uiPipe, 15);

    // Mic audio pipe: continuously writes PCM16 silence (or real mic audio) to pipe:5
    const micPipe = new MicAudioPipe();
    activeMicPipes.add(micPipe);
    micPipe.startWritingTo(micPipe5);

    const volPipe6 = stdioArr[6] as NodeJS.WritableStream;
    volPipe6.on("error", () => {});
    const volumePipe = new VolumeControlPipe(computeGain(stream.muted ?? false, currentOverlayState.liveAudioMuted, globalStreamVolume));
    volumePipe.startWritingTo(volPipe6);

    // Browser camera: register stdin as the writable camera pipe
    if (inputUrl === "__browser__") {
      const stdinPipe = ffmpegProc.stdin as NodeJS.WritableStream | null;
      if (stdinPipe) {
        stdinPipe.on("error", () => {});
        browserCameraPipes.set(streamId, stdinPipe);
        // Flush any WebM data (including the init segment) that arrived before FFmpeg started
        const buffered = browserCameraBuffers.get(streamId);
        if (buffered?.length) {
          browserCameraBuffers.delete(streamId);
          buffered.forEach((d) => { try { stdinPipe.write(d); } catch {} });
        }
      }
    }

    // ── SourceRelay: self-healing pipe for TikTok and YouTube pipe modes ──────
    // Replaces the old yt-dlp one-shot spawn. Key difference: when the source
    // process exits (URL expiry, CDN error, network hiccup), SourceRelay respawns
    // it WITHOUT calling .end() on FFmpeg stdin — so FFmpeg keeps running and the
    // RTMP connection to YouTube/Facebook stays alive. The brief data pause
    // (typically 1–5 s) is absorbed by the rtmp_buffer and platform-side buffers.
    if (resolvedType === "youtube_pipe" || resolvedType === "tiktok_pipe" || resolvedType === "facebook_pipe" || resolvedType === "link_pipe") {
      const isYT = resolvedType === "youtube_pipe";
      const isFB = resolvedType === "facebook_pipe";
      const isLink = resolvedType === "link_pipe";
      const relayPageUrl = isYT
        ? normaliseYouTubeUrl((stream.youtubeSourceUrl || "").trim())
        : isFB
          ? (() => {
              const url = normaliseFacebookUrl((stream.facebookSourceUrl || "").trim());
              if (!url) throw new Error("Invalid Facebook Live URL — must contain a numeric video ID.");
              return url;
            })()
          : isLink
            ? ((stream as any).linkSourceUrl || "").trim()
            : `https://www.tiktok.com/@${stream.tiktokUsername}/live`;

      const relay = new SourceRelay({
        streamId,
        sourceType: resolvedType,
        pageUrl: relayPageUrl,
        quality: stream.quality || "best",
        // Seed from the persistent cache so the 10–30 s streamlink --json probe
        // is skipped on every restart after the first successful one.
        cachedQuality: tiktokQualityCache.get(streamId) ?? null,
        autoReconnect: stream.autoReconnect ?? true,
        maxReconnectMinutes: stream.maxReconnectMinutes ?? null,
        ffmpegStdin: ffmpegProc.stdin as NodeJS.WritableStream,
        onEvent: (evt) => {
          if (evt.type === "log" && evt.message) sendLog(streamId, evt.message);
          else if (evt.type === "warn" && evt.message) sendLog(streamId, evt.message);
          else if (evt.type === "status") {
            const s = evt.status;
            if (s === "reconnecting") {
              sendLog(
                streamId,
                `[relay] Source disconnected — reconnecting` +
                ` (attempt #${evt.totalRestarts ?? 0}, consecutive: ${evt.consecutiveFailures ?? 0})`,
              );
            } else if (s === "recovering") {
              sendLog(streamId, `[relay] New source process started — waiting for first frame...`);
            } else if (s === "running" && evt.recoveryMs != null) {
              sendLog(
                streamId,
                `[relay] Recovered in ${(evt.recoveryMs / 1000).toFixed(1)}s` +
                ` — RTMP session preserved, no FFmpeg restart`,
              );
              // Clear stale FPS/bitrate/drop samples accumulated during the
              // stall period. Without this the health scorer keeps a 15–30 s
              // window of near-zero values and fires "degraded" even though
              // the source is live again — the "false information" the user saw.
              scorerResetMetricWindows(streamId);
            } else if (s === "failed") {
              sendLog(streamId, `[relay] Source failed — stream stopped. Restart manually.`);
              const proc = activeStreams.get(streamId);
              if (proc?.ffmpegProcess === ffmpegProc) stopStream(streamId);
            }
          } else if (evt.type === "fatal" && evt.message) {
            sendLog(streamId, `[relay] Fatal: ${evt.message} — stream stopped. Restart manually.`);
            const proc = activeStreams.get(streamId);
            if (proc?.ffmpegProcess === ffmpegProc) stopStream(streamId);
          } else if (evt.type === "health" && evt.kbps !== undefined && evt.kbps > 0) {
            // Persist newly resolved quality back to the module-level cache
            // so the next hardKillAndRestart can skip the probe too.
            const resolved = relay.getCachedQuality();
            if (resolved) tiktokQualityCache.set(streamId, resolved);
            logger.debug(
              { streamId, kbps: evt.kbps, restarts: evt.totalRestarts },
              "[relay] health tick",
            );
          }
        },
      });

      // Guard stdin errors — the relay writes to stdin; if FFmpeg has exited,
      // the write will throw EPIPE. We suppress it here so the process doesn't crash.
      (ffmpegProc.stdin as NodeJS.WritableStream | null)?.on("error", () => {});

      relay.start();

      // Capture for activeStreams.set() below — do NOT use activeStreams.get() here
      // because the new proc is not in activeStreams yet (it's set at line ~2900).
      // Using activeStreams.get() mid-function returned the OLD proc (or undefined),
      // causing the relay to never be stored on the new proc, becoming an orphan that
      // kept writing to FFmpeg stdin after every restart (duplicate-relay bug).
      pendingRelay = relay;
    }

    let gotFrames = false;
    let lastProgressLog = 0;
    let lastFrameCount = 0;
    let stallWatchdog: NodeJS.Timeout | null = null;
    let lastOutputAt = Date.now();
    let healthWarned = false;
    let healthMonitor: NodeJS.Timeout | null = null;

    const startHealthMonitor = () => {
      healthMonitor = setInterval(() => {
        const silentMs = Date.now() - lastOutputAt;
        const proc = activeStreams.get(streamId);
        if (!proc || proc.ffmpegProcess !== ffmpegProc) {
          if (healthMonitor) { clearInterval(healthMonitor); healthMonitor = null; }
          return;
        }
        // During relay reconnect, FFmpeg silence is expected — don't emit "degraded".
        // Emit "reconnecting" once so the UI can show the correct state.
        if (proc.sourceRelay?.isStalled()) {
          if (!healthWarned) {
            healthWarned = true;
            broadcastStream(streamId, "stream_health", {
              status: "reconnecting",
              relayState: proc.sourceRelay.getStatus(),
              message: `Relay reconnecting — FFmpeg waiting for source data`,
            });
          }
          return;
        }
        if (silentMs >= HEALTH_WARN_MS && !healthWarned) {
          healthWarned = true;
          broadcastStream(streamId, "stream_health", {
            status: "degraded",
            silentSeconds: Math.round(silentMs / 1000),
            message: `No FFmpeg output for ${Math.round(silentMs / 1000)}s — stream may be stalling`,
          });
        } else if (silentMs < HEALTH_WARN_MS && healthWarned) {
          healthWarned = false;
          broadcastStream(streamId, "stream_health", { status: "healthy" });
        }
      }, 5000);
    };

    ffmpegProc.stderr?.on("data", (errData: Buffer) => {
      lastOutputAt = Date.now();
      const lines = errData.toString().split("\n").filter(Boolean);
      lines.forEach((line) => {
        const trimmed = line.trim();

        if (trimmed.startsWith("frame=") || trimmed.startsWith("size=")) {
          const frameMatch = trimmed.match(/frame=\s*(\d+)/);
          if (frameMatch) {
            lastFrameCount = parseInt(frameMatch[1]);
            const currentProc = activeStreams.get(streamId);
            if (currentProc) currentProc.lastFrameCount = lastFrameCount;
          }

          // ── Parse fps and bitrate from FFmpeg progress line ────────────────
          // Format: frame=  123 fps= 30 q=28.0 size= 1234kB time=00:00:04.10 bitrate=2456.7kbits/s speed=1.00x
          const fpsMatch = trimmed.match(/fps=\s*([\d.]+)/);
          if (fpsMatch) {
            const fps = parseFloat(fpsMatch[1]);
            if (!isNaN(fps) && fps >= 0) {
              const currentProc = activeStreams.get(streamId);
              if (currentProc) currentProc.lastFps = fps;
              scorerRecordFps(streamId, fps);
            }
          }
          const bitrateMatch = trimmed.match(/bitrate=\s*([\d.]+)kbits\/s/);
          if (bitrateMatch) {
            const bitrateKbps = parseFloat(bitrateMatch[1]);
            if (!isNaN(bitrateKbps) && bitrateKbps > 0) {
              const currentProc = activeStreams.get(streamId);
              if (currentProc) currentProc.lastBitrate = bitrateKbps;
              scorerRecordBitrate(streamId, bitrateKbps);
            }
          }

          // ── Dropped frames monitoring ───────────────────────────────────────
          // FFmpeg stats lines include "drop=N" — a cumulative dropped-frame count.
          // We record every sample (even zeros) so the scorer can compute rate over
          // its sliding window. Sustained drop rates > 1 fps/sec reduce health score,
          // which can trigger auto-recovery before YouTube Studio flags the stream.
          const dropMatch = trimmed.match(/drop=\s*(\d+)/);
          if (dropMatch) {
            const totalDropped = parseInt(dropMatch[1], 10);
            if (!isNaN(totalDropped)) {
              scorerRecordDroppedFrames(streamId, totalDropped);
              // Mirror on proc for proc_stats broadcast
              const currentProc = activeStreams.get(streamId);
              if (currentProc) currentProc.totalDroppedFrames = totalDropped;
            }
          }

          // ── Adaptive Quality Manager — speed monitor ───────────────────────
          // Replaces the old 5-minute restart-only watchdog. The AQM:
          //   • Detects sustained low speed (avg30s < 0.85x) within 30 seconds
          //   • Classifies the bottleneck (CPU / memory / source / unknown)
          //   • Applies progressive quality degradations instead of same-param restart:
          //       Stage 1: Bitrate -15%  (fast, cheap first try)
          //       Stage 2: Bitrate -25% + FPS step (30→25)
          //       Stage 3: Resolution step down (1080→720p) — biggest CPU win
          //       Stage 4: FPS step 2 (25→20) at reduced resolution
          //       Stage 5: Resolution step 2 (720→480p) + further FPS reduction
          //   • Restores quality one stage at a time when avg60s >= 1.10x for 3 min
          //   • Suppresses action during relay reconnects (speed=0 is expected)
          //   • Persists state across FFmpeg restarts within a session
          const speedMatch = trimmed.match(/speed=\s*([\d.]+)x/);
          if (speedMatch) {
            const encSpeed = parseFloat(speedMatch[1]);
            if (!isNaN(encSpeed) && encSpeed > 0) {
              const nowMs = Date.now();
              const currentProc = activeStreams.get(streamId);
              if (currentProc) {
                currentProc.lastSpeed = encSpeed;
                currentProc.lastSpeedSampleAt = nowMs;
                // Emit to Event Bus for metrics-service and any subscribers
                eventBus.emit("METRICS_SAMPLE", {
                  streamId,
                  fps: currentProc.lastFps ?? 0,
                  bitrateKbps: currentProc.lastBitrate ?? 0,
                  speed: encSpeed,
                  droppedFrames: currentProc.totalDroppedFrames ?? 0,
                });
                recordStreamSample(streamId, {
                  fps: currentProc.lastFps ?? 0,
                  bitrateKbps: currentProc.lastBitrate ?? 0,
                  encoderSpeed: encSpeed,
                  droppedFrames: currentProc.totalDroppedFrames ?? 0,
                });

                // ── Periodic speed logging ───────────────────────────────────
                const lastSpeedLog = currentProc.lastSpeedLogAt ?? 0;
                const belowFloor = encSpeed < 0.85;
                const logInterval = belowFloor ? 15_000 : 30_000;
                if (nowMs - lastSpeedLog >= logInterval) {
                  currentProc.lastSpeedLogAt = nowMs;
                  const aqmSnap = aqmStore.get(streamId)?.getSnapshot();
                  if (belowFloor) {
                    logger.warn(
                      {
                        streamId,
                        speed: encSpeed.toFixed(3),
                        frames: lastFrameCount,
                        cpu: currentProc.lastCpuPct?.toFixed(0),
                        aqmPhase: aqmSnap?.phase ?? "unknown",
                        aqmStage: aqmSnap?.stage ?? 0,
                      },
                      "[AQM] encoder speed below 0.85x threshold — AQM monitoring",
                    );
                  } else {
                    logger.info(
                      {
                        streamId,
                        speed: encSpeed.toFixed(3),
                        frames: lastFrameCount,
                        aqmPhase: aqmSnap?.phase ?? "nominal",
                        aqmStage: aqmSnap?.stage ?? 0,
                      },
                      "[perf] encoder speed — nominal",
                    );
                  }
                }

                // ── Feed AQM — may return a restart decision ─────────────────
                const aqm = aqmStore.get(streamId);
                if (aqm) {
                  const aqmDecision = aqm.feed({
                    speed: encSpeed,
                    fps: currentProc.lastFps,
                    bitrateKbps: currentProc.lastBitrate,
                    cpuPct: currentProc.lastCpuPct,
                    memMb: currentProc.lastMemMb,
                    droppedFrames: currentProc.totalDroppedFrames,
                    // Suppress AQM quality-reduction when the relay is in a
                    // reconnecting/recovering state OR when data has stopped
                    // arriving from the source but the process hasn't exited yet
                    // (mid-stream hang, detected 15 s before the relay kills it).
                    // Without this, AQM misclassifies a hung TikTok input
                    // (speed=0 from FFmpeg's view) as a CPU bottleneck and
                    // degrades quality parameters that have no effect on the
                    // actual failure.
                    relayStalled: (currentProc.sourceRelay?.isStalled() ?? false)
                      || (currentProc.sourceRelay?.isDataStalled() ?? false),
                    reconnectCount: currentProc.reconnectCount,
                  });
                  for (const line of aqmDecision.logLines) sendLog(streamId, line);
                  // AQM dashboard log (emitted every 20s inside the AQM)
                  if (aqmDecision.dashboardLog) sendLog(streamId, aqmDecision.dashboardLog);
                  // Apply the AQM's quality-degradation decision. This was previously
                  // disabled ("stream must run continuously without interruption"),
                  // but leaving sustained CPU/encoder overload completely unmitigated
                  // means the process keeps running pegged at the overload level
                  // indefinitely until it eventually gets killed by the OS or a
                  // watchdog (uncontrolled crash, 30-60s+ of dead air while the
                  // stall/reconnect logic notices and recovers). A brief, planned
                  // ~1-2s restart with reduced bitrate/resolution — gated by the
                  // AQM's own sustained-overload window, hysteresis, and oscillation
                  // guard so it fires rarely — is far less disruptive than that.
                  // reuseUrl=true (forceNewUrl=false) skips the 20-35s source
                  // re-resolution, and AQM state (the new stage/override) is kept
                  // across the restart, so the reconnect is fast and applies the
                  // degraded settings immediately.
                  if (aqmDecision.shouldRestart) {
                    const snap = aqm.getSnapshot();
                    sendLog(
                      streamId,
                      `[AQM] Sustained ${aqmDecision.adaptationType} overload — applying quality Stage ${snap.stage} (brief reconnect)...`,
                    );
                    const liveProc = activeStreams.get(streamId);
                    if (liveProc?.ffmpegProcess === ffmpegProc) {
                      hardKillAndRestart(streamId, 500, false /* forceNewUrl */, true /* keepStatus */);
                    }
                  }
                }
              }
            }
          }

          if (!gotFrames) {
            gotFrames = true;
            logger.info({ streamId }, "FFmpeg producing frames — stream is live");
            sendLog(streamId, `Streaming! Encoding and forwarding frames...`);
            sendStatus(streamId, "streaming");
            recordStreamStatus(streamId, "streaming");
            eventBus.emit("STREAM_STARTED", { streamId });

            const liveProc = activeStreams.get(streamId);
            if (liveProc) liveProc.streamStartTime = Date.now();
            // Mark FFmpeg alive in health scorer now that frames are flowing
            scorerSetFFmpegAlive(streamId, true);
            // Stream is producing frames — reset the restart backoff so the next
            // failure starts the countdown fresh rather than hitting the long delays.
            resetBackoff(streamId);

            // ── HLS encoder (separate FFmpeg process, does not affect RTMP) ──
            if (process.env.HLS_ENABLED === "true") {
              startHlsEncoder(streamId, inputUrl, resolvedType, stream).catch((e: any) => {
                sendLog(streamId, `[hls] Encoder start failed: ${e.message}`);
              });
            }

            // ── Proactive URL pre-fetch for xSpace only ───────────────────────
            // tiktok_pipe and youtube_pipe use SourceRelay which handles URL
            // refresh and reconnection automatically — no prefetch timer needed.
            // xspace still uses direct HLS URL mode so it still needs pre-fetch.
            if (sourceType === "xspace") {
              const schedulePrefetch = (intervalMs: number) => {
                const timer = setTimeout(async () => {
                  const currentProc = activeStreams.get(streamId);
                  if (!currentProc || currentProc.ffmpegProcess !== ffmpegProc) return;

                  sendLog(streamId, `[prefetch] Pre-fetching fresh X Space URL for 24/7 continuity...`);
                  try {
                    urlCache.delete(streamId);
                    const resolved = await resolveInputUrlSafe(stream, false);
                    urlCache.set(streamId, {
                      url: resolved.url,
                      sourceType: resolved.sourceType as "tiktok" | "youtube" | "camera",
                      resolvedAt: Date.now(),
                    });
                    sendLog(streamId, `[prefetch] Fresh URL cached — will be used on next restart.`);
                  } catch (e: any) {
                    sendLog(streamId, `[prefetch] URL refresh failed (${e.message?.slice(0, 120)})`);
                  }
                }, intervalMs);

                const runningProc = activeStreams.get(streamId);
                if (runningProc) runningProc.prefetchTimer = timer;
              };

              // X Space CDN auth tokens can expire in ~90-120 s
              schedulePrefetch(90 * 1000);
              // Refresh again at 8 min for longer sessions
              schedulePrefetch(8 * 60 * 1000);
            }

            // Session refresh timer disabled — auto-restart is off.

            const camUrl = cameraLinks.get(streamId);
            if (camUrl) broadcastStream(streamId, "camera_link", { url: camUrl });

            // Pipe-mode sources have a SourceRelay managing reconnection —
            // allow the full 90-second recovery deadline before escalating.
            // Direct-URL sources have no relay; use the standard 15-second timeout.
            const stallIntervalMs =
              (resolvedType === "tiktok_pipe" || resolvedType === "youtube_pipe")
                ? 90_000
                : STALL_TIMEOUT_MS;

            stallWatchdog = makeStallWatchdog(
              streamId,
              () => lastFrameCount,
              () => activeStreams.get(streamId)?.sourceRelay,
              () => {
                sendLog(streamId, `[watchdog] No new frames detected — reconnecting to recover...`);
                urlCache.delete(streamId);
                const proc = activeStreams.get(streamId);
                if (proc?.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 1000);
              },
              stallIntervalMs,
            );
            if (liveProc) liveProc.stallWatchdog = stallWatchdog;
            startHealthMonitor();
          }

          const now = Date.now();
          if (now - lastProgressLog > 30000) {
            lastProgressLog = now;
            if (frameMatch) {
              sendLog(streamId, `Progress: ${frameMatch[1]} frames`);
            }
            // ── Relay periodic stats ──────────────────────────────────────────
            const liveProc30 = activeStreams.get(streamId);
            const relay30 = liveProc30?.sourceRelay;
            if (relay30) {
              const avgRecoveryMs = relay30.getTotalRecoveries() > 0
                ? Math.round(relay30.getTotalRecoveryMs() / relay30.getTotalRecoveries())
                : null;
              logger.info({
                streamId,
                relayState: relay30.getStatus(),
                relayRestarts: relay30.getTotalRestarts(),
                relayConsecutiveFailures: relay30.getConsecutiveFailures(),
                relayTotalRecoveries: relay30.getTotalRecoveries(),
                avgRecoveryMs,
                longestOutageMs: relay30.getLongestOutageMs(),
                bytesRelayed: relay30.getBytesRelayed(),
                lastFrameAt: relay30.getLastFrameAt(),
                uptimeMs: relay30.getUptimeMs(),
              }, "[relay] periodic stats");
            }
          }
          return;
        }

        if (
          trimmed.includes("HTTP error 404") ||
          trimmed.includes("HTTP error 403") ||
          trimmed.includes("404 Not Found") ||
          trimmed.includes("403 Forbidden")
        ) {
          // For YouTube: 403/404 means the CDN URL expired or was rejected.
          // With the tv_embedded client the HLS URL has no rqh= token, so the
          // CDN doesn't require cookies — this only fires on genuine URL expiry.
          // Always refresh the URL and restart; never permanently kill the stream.
          {
            const proc = activeStreams.get(streamId);
            if (proc && !proc.urlExpired) {
              proc.urlExpired = true;
              // If our 90-second pre-fetch already cached a fresh URL (< 90s old),
              // reuse it so the restart is nearly instant (no streamlink wait).
              // Otherwise force-refresh to get a new one from scratch.
              const cachedEntry = urlCache.get(streamId);
              const cacheIsFresh = !!cachedEntry && Date.now() - cachedEntry.resolvedAt < 90_000;
              if (!cacheIsFresh) urlCache.delete(streamId);
              const label = trimmed.includes("404") ? "404" : "403";
              sendLog(
                streamId,
                `[source] CDN URL expired (${label}) — ${cacheIsFresh ? "using pre-fetched URL for fast restart" : "fetching fresh URL"} and reconnecting...`,
              );
              if (proc.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 300, !cacheIsFresh);
            }
          }
          return;
        }

        if (trimmed.includes("HTTP error 429") || trimmed.includes("429 Too Many Requests")) {
          urlCache.delete(streamId);
          {
            const proc = activeStreams.get(streamId);
            if (proc && !proc.urlExpired) {
              proc.urlExpired = true;
              sendLog(streamId, `[youtube] Rate-limited (429) — backing off 15s then reconnecting with fresh URL...`);
              sendLog(streamId, `[tip] Try switching to a different YouTube source (channel page vs watch URL) to reduce rate-limiting.`);
              if (proc.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 15_000, true);
            }
          }
          return;
        }

        if (trimmed.includes("Too many failure for output")) {
          sendLog(streamId, `[ffmpeg] RTMP output permanently dropped — reconnecting in 2s...`);
          {
            const proc = activeStreams.get(streamId);
            if (proc?.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 2000);
          }
          return;
        }

        if (
          trimmed.includes("Ignoring failure for output") ||
          trimmed.includes("RTMP_SendPacket") ||
          trimmed.includes("Error writing trailer") ||
          trimmed.includes("Broken pipe")
        ) {
          // An RTMP output has failed. Without onfail=ignore the tee muxer will
          // propagate the error and FFmpeg exits (handled by handleProcessExit).
          // With onfail=ignore the output is permanently dropped — it will never
          // reconnect, causing YouTube "not receiving data" warnings indefinitely.
          // Instead: trigger a clean restart so the full RTMP session is re-established.
          // Debounce: FFmpeg often emits several of these stderr lines in rapid
          // succession for the same underlying failure (one per output, per retry).
          // Without a cooldown the code restarts multiple times in 100ms, causing
          // overlapping restarts and prolonged viewer cuts. Only restart once per 5s.
          scorerRecordRtmpError(streamId);
          const proc = activeStreams.get(streamId);
          if (proc?.ffmpegProcess === ffmpegProc) {
            const nowMs = Date.now();
            const lastRtmpErr = proc.lastRtmpErrorAt ?? 0;
            if (nowMs - lastRtmpErr < 5_000) {
              // Already restarting for this burst — skip duplicate trigger
              return;
            }
            proc.lastRtmpErrorAt = nowMs;
            sendLog(streamId, `[ffmpeg] RTMP output failed — reconnecting...`);
            hardKillAndRestart(streamId, 1000);
          }
          return;
        }

        if (
          trimmed.includes("Connection timed out") ||
          trimmed.includes("Operation timed out")
        ) {
          sendLog(streamId, `[ffmpeg] RTMP connection timed out — reconnecting...`);
          {
            const proc = activeStreams.get(streamId);
            if (proc?.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 1500);
          }
          return;
        }

        if (
          trimmed.includes("Last message repeated") ||
          trimmed.includes("moov atom not found") ||
          // HLS segment-boundary reconnect — FFmpeg fetches the next segment
          // immediately ("in 0 second(s)") and streaming continues uninterrupted.
          // This is normal live-HLS behaviour, not an error.
          trimmed.includes("Will reconnect at") ||
          // Verbose HTTP/HLS operational messages — not actionable for the user
          trimmed.includes("Opening an input url") ||
          trimmed.includes("Opening an output url") ||
          trimmed.includes("Input stream #0") ||
          trimmed.includes("Starting new cluster") ||
          trimmed.includes("No trailing") ||
          // Bare codec-address line "[h264 @ 0x...]" with no message — FFmpeg
          // multi-line warning preamble that appears before Late SEI messages.
          /^\[[a-z0-9_]+ @ 0x[0-9a-f]+\]$/.test(trimmed) ||
          trimmed === ""
        ) return;

        // Suppress known noisy-but-harmless patterns (Late SEI, videolan upload
        // prompts, etc.) — defined in LOG_SUPPRESS_PATTERNS.  These are already
        // filtered from the frontend via sendLog(); apply the same filter here so
        // they don't flood the pino/workflow logs either.
        if (shouldSuppressLog(trimmed)) {
          // Still forward to frontend log (sendLog already checks internally)
          sendLog(streamId, `[ffmpeg] ${trimmed}`);
          return;
        }

        // Log FFmpeg warnings/errors to pino so they appear in workflow logs
        logger.warn({ streamId, ffmpeg: trimmed }, "FFmpeg stderr");
        sendLog(streamId, `[ffmpeg] ${trimmed}`);
      });
    });

    ffmpegProc.stdout?.on("data", () => {});

    ffmpegProc.on("error", (err) => {
      if (stallWatchdog) clearInterval(stallWatchdog);
      if (healthMonitor) { clearInterval(healthMonitor); healthMonitor = null; }
      bgRenderer.stop();
      uiRenderer.stop();
      micPipe.stop();
      activeMicPipes.delete(micPipe);
      browserCameraPipes.delete(streamId);
      if (err.message.includes("ENOENT")) {
        sendLog(streamId, `ERROR: ffmpeg not found. Install ffmpeg on your system.`);
      } else {
        sendLog(streamId, `FFmpeg error: ${err.message}`);
      }
      sendStatus(streamId, "error");
      activeStreams.delete(streamId);
    });

    ffmpegProc.on("exit", (code, signal) => {
      if (stallWatchdog) clearInterval(stallWatchdog);
      if (healthMonitor) { clearInterval(healthMonitor); healthMonitor = null; }
      bgRenderer.stop();
      uiRenderer.stop();
      micPipe.stop();
      activeMicPipes.delete(micPipe);
      browserCameraPipes.delete(streamId);
      sendLog(streamId, `FFmpeg exited (code: ${code}, signal: ${signal})`);
      const currentProc = activeStreams.get(streamId);
      if (currentProc?.ffmpegProcess !== ffmpegProc) return;
      handleProcessExit(streamId, code);
    });

    // Startup watchdog: if no frames arrive within the timeout, retry with a fresh URL.
    // Uses config values so the timeout can be tuned without a code deploy.
    const startupTimeout = inputUrl === "__browser__"
      ? config.browserCamStartupMs
      : config.startupTimeoutMs;
    const watchdog = setTimeout(() => {
      if (!gotFrames) {
        sendLog(streamId, `Timeout: No frames encoded after ${startupTimeout / 1000}s — retrying with fresh URL...`);
        const liveProc = activeStreams.get(streamId);
        if (liveProc?.ffmpegProcess === ffmpegProc) {
          hardKillAndRestart(streamId, 5000, true /* forceNewUrl */);
        }
      }
    }, startupTimeout);

    const statsInterval = ffmpegProc.pid
      ? startProcStatsPolling(streamId, ffmpegProc.pid)
      : undefined;

    activeStreams.set(streamId, {
      ffmpegProcess: ffmpegProc,
      bgRenderer,
      uiRenderer,
      micPipe,
      volumePipe,
      muted: stream.muted,
      autoRestart: stream.autoRestart,
      watchdog,
      statsInterval,
      // prefetchTimer is set later inside the gotFrames block (after ffmpegProc is running)
      // pendingRelay is set in the tiktok_pipe / youtube_pipe block above.
      // Stored here (not via activeStreams.get mid-function) to ensure it lands on
      // this new proc and cleanupStreamProc can always call relay.stop().
      ytSourceProcess: undefined,
      sourceRelay: pendingRelay,
      inputUrl,
      sourceType,
      // Real encoding parameters — reflects what FFmpeg is actually configured to encode.
      // Emitted in proc_stats so the dashboard shows confirmed quality, not just config.
      activeResW: overlayW,
      activeResH: overlayH,
      activeBitrateKbps,
      activeFps,
    });

    logger.info({ streamId }, `Stream started`);
  } catch (err: any) {
    // If we started a relay/fallback before the error was thrown, stop them now to
    // prevent orphaned processes from continuing to write to a dead FFmpeg stdin.
    pendingRelay?.stop();
    pendingRelay = undefined;

    const code: string | undefined = err.code;
    const msg: string = err.message || "Unknown error";

    // ── Failure classification ─────────────────────────────────────────────
    // Definitive failures: source is genuinely offline or inaccessible.
    // Do NOT auto-restart — retrying immediately is pointless and burns rate-limit quota.
    const isDefinitive = code && new Set([
      "NOT_LIVE", "LIVE_ENDED", "PRIVATE_ACCOUNT", "PRIVATE_VIDEO",
      "REGION_RESTRICTED", "GEO_RESTRICTED", "AGE_RESTRICTED",
      "MEMBERS_ONLY", "SCHEDULED", "UNAVAILABLE",
    ]).has(code);

    if (isDefinitive) {
      sendLog(streamId, `[resolve] ${msg}`);
      sendLog(streamId, `[resolve] Stopping auto-restart — source is definitively unavailable (${code})`);
      manuallyStopped.add(streamId); // block all further auto-restart paths
      sendStatus(streamId, "error");
      return;
    }

    // Rate-limited: auto-retry disabled — stop and wait for manual restart.
    if (code === "RATE_LIMITED") {
      sendLog(streamId, `[resolve] ${msg}`);
      sendLog(streamId, `[resolve] Rate-limited — stream stopped. Restart manually.`);
      sendStatus(streamId, "idle");
      return;
    }

    // Circuit breaker open: auto-retry disabled — stop and wait for manual restart.
    if (msg.includes("[circuit-breaker]")) {
      sendLog(streamId, msg);
      sendLog(streamId, `[circuit-breaker] Stream stopped — restart manually when ready.`);
      sendStatus(streamId, "idle");
      return;
    }

    // Generic transient failure — auto-retry disabled. Stop and wait for manual restart.
    sendLog(streamId, `Failed: ${msg} — stream stopped. Restart manually.`);
    sendStatus(streamId, "idle");
  }
}

// ── Immediate hard-kill + scheduled restart ───────────────────────────────────
// forceNewUrl=true  — bypass the URL cache (use when ending a break video so
//                     TikTok/YouTube live URLs are re-fetched).
// keepStatus=true   — do NOT emit "reconnecting"; UI stays as "streaming"
//                     (used for seamless mute/unmute where the gap is ~100 ms
//                      and is invisible to the viewer behind platform buffers).
function hardKillAndRestart(streamId: string, delayMs: number, forceNewUrl = false, keepStatus = false) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;
  // ── Guard: only one restart timer per stream at a time ───────────────────
  // This must be the FIRST guard check.  Everything after this point runs
  // at most once per stream — no concurrent entry from health-recovery.
  if (restartScheduled.has(streamId)) return;

  // Track reconnect counter on the proc so it persists into the new proc
  proc.reconnectCount = (proc.reconnectCount ?? 0) + 1;

  // ── CRITICAL ORDER ────────────────────────────────────────────────────────
  // 1. Disable auto-restart flag on the proc to prevent re-entry via health-recovery
  // 2. Delete from activeStreams so health-recovery bails at its own guard
  // 3. Set restartScheduled so any late-firing timers bail
  // 4. THEN call scorerRecordReconnect — it triggers recompute() synchronously
  //    which calls the health-recovery callback; both activeStreams and
  //    restartScheduled guards will be in place by that point.
  // This ordering was the root cause of the duplicate-restart death spiral:
  // the old code called scorerRecordReconnect BEFORE activeStreams.delete and
  // restartScheduled.add, allowing health-recovery to re-enter here and
  // schedule a second restart timer concurrently.
  proc.autoRestart = false;
  activeStreams.delete(streamId);    // guard #1: health-recovery bails on !has
  markSourceFailed(streamId);

  // ── Restart delay ─────────────────────────────────────────────────────────
  // Use the caller's intended delay for the first two failures.  After that,
  // honour the exponential backoff to prevent hammering external services
  // during extended failure chains (e.g. channel offline for 30+ minutes).
  //
  // Previously this function ignored delayMs entirely (it had a leading
  // underscore and used getBackoffDelay() unconditionally).  That caused every
  // reconnect — including a 300 ms CDN-URL refresh — to wait 5 s minimum,
  // which was the primary cause of YouTube Studio's "Poor" stream-health rating.
  const backoffCount = restartBackoff.get(streamId) ?? 0;
  const backoffDelay = getBackoffDelay(streamId);
  bumpBackoff(streamId);
  const delay = backoffCount < 2 ? delayMs : Math.max(delayMs, backoffDelay);

  restartScheduled.add(streamId);    // guard #2: any concurrent path bails on has

  // NOW safe to call — recompute() fires here but both guards are already set
  scorerRecordReconnect(streamId);
  recordReconnect(streamId);

  cleanupStreamProc(streamId, proc);
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}
  // Clear stale chat from the overlay and stop the poller chain so the
  // next live session always starts with a blank chat slate — whether the
  // restart is manual, a crash recovery, or an auto-reconnect.
  updateStreamOverlays({ chatBurnMessages: [] });
  clearStreamChatState(streamId);
  if (!keepStatus) sendStatus(streamId, "reconnecting");
  eventBus.emit("STREAM_RECONNECTING", { streamId, attempt: proc.reconnectCount ?? 1, delayMs: delay });

  if (delay > 5_000) sendLog(streamId, `Backing off — retrying in ${delay / 1000}s...`);

  // Actually perform the reconnect. `startStream` with `reuseUrl=true` will
  // reuse the cached resolved source URL (skips the 20-35s streamlink/yt-dlp
  // re-resolution) unless `forceNewUrl` says the cached URL is known-bad.
  // This is the piece that makes hardKillAndRestart a *restart* rather than
  // a stop: every caller (mute toggle, CDN URL refresh, RTMP hiccups, source
  // failover, health-triggered reconnects, quality changes) expects the
  // stream to keep flowing automatically — see the "reconnecting..." log
  // messages at each call site. Losing this scheduling previously made every
  // one of those call sites silently kill the stream and leave it idle,
  // requiring a manual restart click.
  setTimeout(() => {
    restartScheduled.delete(streamId);
    if (manuallyStopped.has(streamId)) return; // user stopped it while we were waiting
    startStream(streamId, !forceNewUrl, keepStatus).catch((e: any) => {
      sendLog(streamId, `[ffmpeg] Auto-reconnect failed: ${e?.message ?? e}`);
      sendStatus(streamId, "idle");
    });
  }, delay);
}

function handleProcessExit(streamId: string, code: number | null) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  // ── Delete from activeStreams FIRST ───────────────────────────────────────
  // cleanupStreamProc calls scorerSetFFmpegAlive(false) which synchronously
  // triggers recompute() → health-recovery callback.  That callback checks
  // activeStreams.has(streamId) before scheduling a restart.  By deleting here
  // first we guarantee the health-recovery path bails out, leaving this
  // function as the sole owner of the restart decision — no duplicate timers.
  activeStreams.delete(streamId);
  cleanupStreamProc(streamId, proc);
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}

  const reason = code !== null ? `exit code ${code}` : "signal";

  if (manuallyStopped.has(streamId)) {
    clearCameraLink(streamId);
    sendStatus(streamId, "idle");
    return;
  }

  // If a restart is already scheduled (e.g. hardKillAndRestart from the watchdog
  // fired a moment before FFmpeg exited), don't double-schedule.
  if (restartScheduled.has(streamId)) return;

  clearCameraLink(streamId);

  // Respect the user's auto-restart preference and the circuit breaker (same
  // guard used for source-resolution retries) so a genuinely broken source
  // doesn't hammer restarts forever — but an unexpected FFmpeg crash (e.g.
  // OOM kill, transient RTMP/network blip) should reconnect automatically
  // instead of leaving the stream dead until someone notices and clicks
  // restart manually.
  const stream = storage.getStream(streamId);
  if (stream?.autoRestart === false) {
    sendLog(streamId, `[ffmpeg] Stream stopped (${reason}) — auto-restart is off, restart manually.`);
    sendStatus(streamId, "idle");
    return;
  }
  if (!cbCanAttempt(streamId)) {
    sendLog(streamId, `[ffmpeg] Stream stopped (${reason}) — too many recent failures, backing off. Restart manually or wait for the cooldown.`);
    sendStatus(streamId, "idle");
    return;
  }

  restartScheduled.add(streamId);
  const backoffCount = restartBackoff.get(streamId) ?? 0;
  bumpBackoff(streamId);
  const delay = backoffCount < 2 ? 1000 : getBackoffDelay(streamId);
  sendLog(streamId, `[ffmpeg] Stream stopped (${reason}) — reconnecting in ${Math.round(delay / 1000)}s...`);
  sendStatus(streamId, "reconnecting");
  setTimeout(() => {
    restartScheduled.delete(streamId);
    if (manuallyStopped.has(streamId)) return;
    startStream(streamId, true).catch((e: any) => {
      sendLog(streamId, `[ffmpeg] Auto-reconnect failed: ${e?.message ?? e}`);
      sendStatus(streamId, "idle");
    });
  }, delay);
}

export function stopStream(streamId: string, keepAqmState = false) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  sendLog(streamId, "Stopping stream...");
  proc.autoRestart = false;
  // Mark as manually stopped BEFORE any async/timer operations so that any
  // pending hardKillAndRestart or handleProcessExit timers see the flag and
  // abort — this is what prevents YouTube from staying in "preparing stream"
  // after the user clicks Stop.
  manuallyStopped.add(streamId);
  eventBus.emit("STREAM_STOPPED", { streamId, manual: true });
  clearCameraLink(streamId);
  cleanupStreamProc(streamId, proc);
  scorerRemoveStream(streamId);
  // Remove from activeStreams NOW so handleProcessExit doesn't fire when FFmpeg
  // finally exits — we don't want it to re-broadcast "deleted" or try to auto-restart.
  activeStreams.delete(streamId);
  // Clean up all per-stream restart/circuit-breaker state so a re-added stream starts fresh
  resolverCBs.delete(streamId);
  restartScheduled.delete(streamId);
  restartBackoff.delete(streamId);
  tiktokQualityCache.delete(streamId);
  memRestartCooldown.delete(streamId);
  // AQM state: keepAqmState=true on internal FFmpeg restarts preserves the quality
  // degradation level so the next launch uses the same (or better) parameters.
  // keepAqmState=false on explicit user stops resets quality to original on next start.
  if (!keepAqmState) aqmStore.delete(streamId);

  // SIGKILL immediately — no graceful drain.
  // SIGTERM causes FFmpeg to flush its encoder buffer and send RTMP finalization
  // packets before exiting, meaning data keeps flowing to YouTube for up to ~2 s.
  // SIGKILL stops the process (and all I/O) at the OS level instantly.
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}

  sendStatus(streamId, "idle");
  broadcastStream(streamId, "chat_clear", {});
  // Immediately wipe chat burn messages from the server-side overlay state so
  // that a subsequent startStream() never inherits stale chat from the previous
  // session. This is the primary fix for "old chat visible on next go-live".
  updateStreamOverlays({ chatBurnMessages: [] });
  clearStreamChatState(streamId);
  sendLog(streamId, "Stream stopped");
  streamLogBuffers.delete(streamId);
  removeStreamMetrics(streamId);
  removeSceneManager(streamId);
  logger.info({ streamId }, `Stream stopped`);

  // Purge uploaded/downloaded break-video files when the last stream stops
  if (activeStreams.size === 0) {
    purgeUploadsDir();
    clearYtDownloadCache();
  }
}

export function restartStream(streamId: string) {
  sendLog(streamId, "Restarting stream (manual)...");
  // Clear the manual-stop guard so the restart is never blocked by a previous Stop.
  manuallyStopped.delete(streamId);
  // hardKillAndRestart handles: cleanup → SIGKILL → "reconnecting" status →
  // delayed startStream with cached URL.  This avoids the old stopStream() path
  // which left the proc in activeStreams, causing handleProcessExit to delete
  // the stream from storage before startStream could run again.
  hardKillAndRestart(streamId, 800, false);
}

export function toggleMute(streamId: string, muted: boolean) {
  storage.updateStream(streamId, { muted });
  const proc = activeStreams.get(streamId);
  if (!proc?.ffmpegProcess) {
    sendLog(streamId, muted ? "Audio muted (takes effect on next start)" : "Audio unmuted (takes effect on next start)");
    return;
  }
  if (proc.volumePipe) {
    // Zero-restart mute — VolumeControlPipe on pipe:6 changes gain in-place.
    // No FFmpeg reconnection, no stream interruption, no platform buffer gap.
    const gain = computeGain(muted, currentOverlayState.liveAudioMuted, globalStreamVolume);
    proc.volumePipe.setGain(gain);
    sendLog(streamId, muted ? "Audio muted (live — no stream interruption)" : "Audio unmuted (live — no stream interruption)");
  } else {
    sendLog(streamId, muted ? "Audio muted (takes effect on next start)" : "Audio unmuted (takes effect on next start)");
  }
}

export function isStreamActive(streamId: string): boolean {
  return activeStreams.has(streamId);
}

// ── Recovery snapshot ─────────────────────────────────────────────────────────
// Returns a complete read-only view of the circuit-breaker, backoff, and
// restart-lock state for a single stream.  Used by the /recovery-status route.

export interface RelayMetrics {
  state: string;
  restarts: number;
  consecutiveFailures: number;
  totalRecoveries: number;
  avgRecoveryMs: number | null;
  longestOutageMs: number;
  bytesRelayed: number;
  lastFrameAt: number | null;
  lastRecoveredAt: number | null;
  uptimeMs: number;
}

export interface RecoverySnapshot {
  streamId: string;
  timestamp: number;
  circuitBreaker: {
    state: "closed" | "open" | "probing";
    failuresInWindow: number;
    failureThreshold: number;
    windowMs: number;
    openedAt: number | null;
    cooldownMs: number;
    cooldownRemainingMs: number | null;
    probeInFlight: boolean;
  };
  backoff: {
    attemptCount: number;
    nextDelayMs: number;
    schedule: number[];
    maxDelayMs: number;
  };
  restartPending: boolean;
  manuallyStopped: boolean;
  isActive: boolean;
  relay: RelayMetrics | null;
}

export function getRecoverySnapshot(streamId: string): RecoverySnapshot {
  const now = Date.now();
  const cb = resolverCBs.get(streamId) ?? { failures: [], openedAt: null, probeInFlight: false };
  const failuresInWindow = cb.failures.filter((t) => now - t < CB_WINDOW_MS).length;
  const cooldownRemainingMs = cb.openedAt != null
    ? Math.max(0, CB_OPEN_COOLDOWN_MS - (now - cb.openedAt))
    : null;
  const cbState: RecoverySnapshot["circuitBreaker"]["state"] =
    cb.openedAt == null ? "closed"
    : cb.probeInFlight ? "probing"
    : "open";

  const attemptCount = restartBackoff.get(streamId) ?? 0;
  const nextDelayMs = BACKOFF_DELAYS_MS[Math.min(attemptCount, BACKOFF_DELAYS_MS.length - 1)];

  const relayInst = activeStreams.get(streamId)?.sourceRelay ?? null;
  const relay: RelayMetrics | null = relayInst
    ? {
        state: relayInst.getStatus(),
        restarts: relayInst.getTotalRestarts(),
        consecutiveFailures: relayInst.getConsecutiveFailures(),
        totalRecoveries: relayInst.getTotalRecoveries(),
        avgRecoveryMs: relayInst.getTotalRecoveries() > 0
          ? Math.round(relayInst.getTotalRecoveryMs() / relayInst.getTotalRecoveries())
          : null,
        longestOutageMs: relayInst.getLongestOutageMs(),
        bytesRelayed: relayInst.getBytesRelayed(),
        lastFrameAt: relayInst.getLastFrameAt(),
        lastRecoveredAt: relayInst.getLastRecoveredAt(),
        uptimeMs: relayInst.getUptimeMs(),
      }
    : null;

  return {
    streamId,
    timestamp: now,
    circuitBreaker: {
      state: cbState,
      failuresInWindow,
      failureThreshold: CB_FAILURE_THRESHOLD,
      windowMs: CB_WINDOW_MS,
      openedAt: cb.openedAt,
      cooldownMs: CB_OPEN_COOLDOWN_MS,
      cooldownRemainingMs,
      probeInFlight: cb.probeInFlight,
    },
    backoff: {
      attemptCount,
      nextDelayMs,
      schedule: BACKOFF_DELAYS_MS,
      maxDelayMs: BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1],
    },
    restartPending: restartScheduled.has(streamId),
    manuallyStopped: manuallyStopped.has(streamId),
    isActive: activeStreams.has(streamId),
    relay,
  };
}

/**
 * Returns the current AQM snapshot for a stream, or null if AQM is not active.
 * The snapshot includes stage, phase, bottleneck classification, and the current
 * active override parameters (bitrate/fps/resolution/preset).
 */
export function getAQMSnapshot(streamId: string) {
  return aqmStore.get(streamId)?.getSnapshot() ?? null;
}

export function setAQMMode(streamId: string, mode: string): boolean {
  const aqm = aqmStore.get(streamId);
  if (!aqm) return false;
  aqm.setMode(mode as any);
  return true;
}

// ── Control-plane initialisation ──────────────────────────────────────────────
// Call once from the HTTP server init (registerBintunetRoutes) after all
// functions are defined.  Sets up health-scorer callbacks and failover restart.
export function initStreamManager(): void {
  initHealthScorer(
    // Recovery callback — score < 50
    (streamId, score) => {
      if (manuallyStopped.has(streamId)) return;
      if (!activeStreams.has(streamId)) return;   // handleProcessExit already owns it
      if (restartScheduled.has(streamId)) return; // restart already pending

      const stream = storage.getStream(streamId);
      if (!stream) return;

      // Honour the user's auto-restart preference
      if (!stream.autoRestart) {
        sendLog(streamId, `[health] Score ${score}/100 — stream degraded (auto-restart is off; stop and restart manually)`);
        broadcastStream(streamId, "stream_health", { status: "degraded", score,
          message: `Health score ${score}/100 — auto-restart disabled` });
        return;
      }

      // ── Relay-stall suppression ─────────────────────────────────────────────
      // During yt-dlp reconnection / 429 backoff, health metrics (speed, fps,
      // bitrate) naturally collapse. Restarting FFmpeg when the relay is
      // already trying to recover doesn't help — the new process also has no
      // source data. This was the primary cause of permanent "video ended"
      // failures: score-38 recovery triggered a restart that hit the same 429,
      // then another restart, ad infinitum. Suppress recovery while the relay
      // is stalled; it will un-suppress when the source reconnects.
      const proc = activeStreams.get(streamId);
      if (proc?.sourceRelay?.isStalled()) {
        sendLog(
          streamId,
          `[health] Score ${score}/100 — relay reconnecting, holding restart until source recovers`,
        );
        broadcastStream(streamId, "stream_health", {
          status: "degraded",
          score,
          message: `Health ${score}/100 — waiting for source relay to reconnect`,
        });
        return;
      }

      // Health score dropped below 50 — report to dashboard but do NOT restart.
      // The health scorer uses 15–30 s sliding windows; stale samples from brief
      // source hiccups, relay reconnects, or momentary CPU spikes routinely push
      // the score below 50 even when the stream is actively recovering. Each
      // health-triggered restart records another reconnect → drops the reconnect
      // component → next trigger fires sooner → self-reinforcing restart spiral
      // that permanently kills the stream. The stall watchdog (15s for direct
      // sources, 90s for relay) and handleProcessExit already handle genuine
      // FFmpeg failures with better precision. The health scorer is now
      // informational only — it shows degraded state on the dashboard without
      // taking any action.
      sendLog(streamId, `[health] Score ${score}/100 — pipeline degraded (monitoring only, no auto-restart)`);
      broadcastStream(streamId, "stream_health", {
        status: "degraded",
        score,
        message: `Health ${score}/100 — degraded (stall watchdog handles recovery)`,
      });
    },
    // Warning callback — score 50-80
    (streamId, score, snap) => {
      broadcastStream(streamId, "stream_health", {
        status: "degraded",
        score,
        silentSeconds: 0,
        message: `Stream health warning: ${score}/100 — ${snap.status}`,
      });
    },
  );

  initFailover((streamId) => {
    if (manuallyStopped.has(streamId)) return;
    sendLog(streamId, "[failover] Source switched — restarting pipeline");
    hardKillAndRestart(streamId, 1000, true /* forceNewUrl */);
  });

  logger.info("[stream-manager] Health scorer and failover initialised");
}
