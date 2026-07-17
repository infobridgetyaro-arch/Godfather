/**
 * SourceRelay — Self-Healing Live Source Pipe Manager
 *
 * Maintains a continuous data pipe from a live page URL (TikTok / YouTube / X Space)
 * to FFmpeg's stdin WITHOUT ever closing the stdin stream.
 *
 * ─── KEY PRINCIPLE ──────────────────────────────────────────────────────────
 * Store only PERMANENT live page URLs — never temporary CDN URLs.
 *   ✓  https://www.tiktok.com/@username/live
 *   ✓  https://www.youtube.com/@channel/live
 *   ✗  https://pull-live-f4.tiktokcdn.com/stream/abc123.flv?auth=...
 *
 * ─── LIFECYCLE ──────────────────────────────────────────────────────────────
 *  start()  → detect streamlink version → spawn streamlink --stdout
 *           → pipe data to FFmpeg stdin via .on('data') + .write()  ← NEVER .end()
 *           → NETWORK/SOURCE failure → exponential backoff → respawn
 *           → CONFIG error (bad flags, missing binary) → fail permanently, do NOT retry
 *  stop()   → kill source process, do NOT touch stdin (caller's responsibility)
 *
 * ─── WHY NOT .pipe() ────────────────────────────────────────────────────────
 * Node's readable.pipe(writable) calls writable.end() when the source stream
 * ends. That closes FFmpeg's stdin → FFmpeg processes EOF → exits → RTMP
 * disconnect. We use manual .write() instead to keep stdin alive across
 * source process restarts.
 *
 * ─── STREAMLINK VERSION COMPATIBILITY ───────────────────────────────────────
 * Streamlink 7.x renamed several flags:
 *   OLD (≤5.x)              NEW (7.x+)
 *   --hls-segment-timeout   --stream-segment-timeout
 *   --hls-timeout           --stream-timeout
 *   --http-cookie-jar       (removed — pass --http-cookie KEY=VALUE individually)
 *
 * The relay detects the installed version at startup and logs it.
 * On exit code 2 ("unrecognized arguments"), it fails permanently instead of
 * retrying — this is a configuration error, not a network failure.
 */

import { spawn, exec, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "./lib/logger";
import { YTDLP_BIN } from "./lib/ytdlp";
import { getCookiesArgs } from "./youtube-source";
import { promisify } from "util";

const execAsync = promisify(exec);

// ── spawnCollect ──────────────────────────────────────────────────────────────

/**
 * Run a command via spawn (NO shell — args are passed as an array, never
 * concatenated into a shell string). Collects all stdout + stderr and resolves
 * when the process exits or the timeout fires.
 *
 * Use this instead of execAsync / exec whenever args may contain characters
 * that are special in sh (parentheses, quotes, dollar signs, etc.).
 * Most notably: User-Agent strings such as
 *   "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
 * contain "(" which sh parses as a subshell — causing the error
 *   /bin/sh: Syntax error: "(" unexpected
 * when passed through exec/execAsync.
 */
function spawnCollect(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      return reject(e);
    }

    let stdout = "";
    let stderr = "";
    // settled guards against the race where timeout fires and then "exit" fires
    // (or vice-versa), which would call resolve/reject twice on the same Promise.
    let settled = false;
    const settle = (value: { stdout: string; stderr: string; exitCode: number | null }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      settle({ stdout, stderr, exitCode: null });
    }, timeoutMs);

    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      settle({ stdout, stderr, exitCode: code });
    });
  });
}

// ── Timing constants ──────────────────────────────────────────────────────────

/**
 * Exponential backoff schedule (ms) for consecutive NETWORK / SOURCE failures.
 * ±10% jitter is applied at runtime to prevent synchronized reconnect storms.
 * Config errors (bad flags, ENOENT) do NOT use this — they fail permanently.
 */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

/**
 * How many HTTP 403 errors must appear in yt-dlp stderr (within a single
 * spawn session) before we classify them as "signed HLS URLs have expired"
 * and immediately kill + re-extract.
 *
 * yt-dlp logs one WARNING per retry attempt on the same stale segment URL.
 * A threshold of 3 catches the pattern within seconds while avoiding false
 * positives from a single transient 403 that resolves on the next retry.
 */
const HTTP_403_THRESHOLD = 3;

/**
 * Delay (ms) before re-spawning after an HTTP 403 URL-expiry kill.
 *
 * This is intentionally short (not exponential backoff) because the source is
 * still live — we are simply fetching a fresh signed URL, not recovering from
 * a genuine outage.  A 500 ms pause is enough for the network stack to settle.
 */
const HTTP_403_RETRY_DELAY_MS = 500;

/**
 * Recovery deadline (ms): if the relay has not produced its first frame within
 * this window after a reconnect starts, the stall watchdog in stream-manager
 * treats it as a genuine failure and performs a controlled FFmpeg restart.
 *
 * While the relay is "reconnecting"/"recovering", stream-manager's frame-stall
 * watchdog is suppressed (see watchdog-coordinator's relay-aware suppression),
 * and FFmpeg's stdin (pipe:0) is kept open but fed zero bytes. Because [0:v]
 * feeds directly into the video filter chain with no fallback branch (unlike
 * audio, which mixes in silence via amix), a stalled source freezes the ENTIRE
 * composited output — video AND audio, to every RTMP destination — for as
 * long as this deadline allows.
 *
 * This was previously 90_000 (90 s), which let a single slow reconnect (e.g.
 * a few exponential-backoff retries) freeze the live output for up to a
 * minute and a half with no video reaching any platform. The 8 s RTMP send
 * buffer downstream can only absorb sub-10s gaps, so anything beyond that
 * surfaced to viewers as buffering and to YouTube Studio as "no data" followed
 * by a reconnect. Lowered to 20 s — long enough for the fast 403/URL-refresh
 * path (≤5s) and the first couple of backoff retries (5s, 15s) to succeed,
 * short enough that a genuine stall triggers a hard FFmpeg restart (which
 * re-establishes the RTMP session cleanly) well before it becomes visible
 * as sustained buffering.
 */
const RECOVERY_DEADLINE_MS = 20_000;

/**
 * How many consecutive failures trigger a "source may be offline" warning.
 */
const WARN_AFTER_FAILURES = 5;

/**
 * How many consecutive immediate-403 restarts (none of which produced any
 * data) before we escalate to normal _scheduleRetry() backoff.
 *
 * A genuine URL-expiry 403 resolves on the next spawn (data flows within
 * seconds of re-extraction).  If this many fast-path restarts pass without
 * a single byte arriving the 403 is not URL expiry — it is an auth/geo/
 * private-stream error that exponential backoff + the failure budget must
 * handle.  Setting this to 5 gives ~2.5 s of fast attempts before escalating.
 */
const MAX_CONSECUTIVE_403_RESTARTS = 5;

/**
 * Default maximum consecutive network/source failures before the relay
 * transitions to "failed" state and triggers a full pipeline restart.
 * Set high so transient rate-limiting (HTTP 429) or brief platform outages
 * never give up — the relay's own backoff (capped at 60 s) keeps retrying
 * indefinitely until data flows again.
 */
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 999;

/**
 * Startup watchdog (ms): if no bytes arrive after spawning, treat as offline.
 */
const STARTUP_TIMEOUT_MS = 60_000;

/**
 * Health monitoring interval (ms).
 */
const HEALTH_INTERVAL_MS = 10_000;

/**
 * Mid-stream data stall threshold (ms).
 *
 * If the source process is in "running" state but no bytes have arrived within
 * this window, the process is considered hung (open connection, no data) and is
 * killed so the relay can respawn and re-extract a fresh stream URL.
 *
 * This is distinct from the startup watchdog (which only fires before the very
 * first byte) — this catches the case where streamlink/yt-dlp connects
 * successfully, data flows for a while, then stops without the process exiting.
 *
 * 30 s gives CDN segment boundaries a safe grace period:
 *   - TikTok HLS segments are typically 4–8 s
 *   - YouTube live HLS segments are typically 5–10 s and CDN hiccups commonly
 *     cause 10–20 s pauses — a 15 s threshold was causing false-positive kills
 *     that looked like instability/reconnects but were actually normal CDN gaps.
 * 30 s catches genuine hangs quickly enough that the relay can recover without
 * the stream-manager's 90-second stall watchdog triggering a full FFmpeg restart.
 */
const MID_STREAM_STALL_MS = 60_000;

/**
 * Early-warning threshold (ms) for mid-stream stall detection.
 *
 * When elapsed silence exceeds this value but has not yet reached
 * MID_STREAM_STALL_MS, isDataStalled() returns true so callers (stream-manager
 * AQM feed) can suppress quality-reduction decisions.  The AQM incorrectly
 * classifies a hung input (speed=0) as a CPU bottleneck and degrades quality —
 * suppressing it during the early stall window prevents unnecessary restarts.
 *
 * 15 s aligns with the YouTube HLS segment boundary (5–10 s) plus one retry
 * cycle, so a single CDN hiccup that yt-dlp is already retrying internally
 * won't trigger AQM suppression until we are confident data is truly absent.
 * With --fragment-retries 10 + --socket-timeout 20 added to yt-dlp args,
 * internal retries can span up to ~40 s — the 60 s stall kills yt-dlp only
 * after it has exhausted all retries on its own.
 */
const MID_STREAM_DATA_WARN_MS = 15_000;

// ── Version detection ─────────────────────────────────────────────────────────

interface StreamlinkInfo {
  version: string;
  major: number;
}

let cachedStreamlinkInfo: StreamlinkInfo | null = null;

/**
 * Detect installed streamlink version (cached after first call).
 * Returns null if streamlink is not installed or version cannot be determined.
 */
async function detectStreamlink(): Promise<StreamlinkInfo | null> {
  if (cachedStreamlinkInfo) return cachedStreamlinkInfo;
  try {
    const { stdout } = await execAsync("streamlink --version", { timeout: 8_000 });
    // Output: "streamlink 7.1.3" or similar
    const match = stdout.trim().match(/streamlink\s+(\d+)\.(\d+)/i);
    if (!match) return null;
    const info: StreamlinkInfo = {
      version: match[0].replace(/^streamlink\s+/i, ""),
      major: parseInt(match[1], 10),
    };
    cachedStreamlinkInfo = info;
    return info;
  } catch {
    return null;
  }
}

// ── Config-error detection ────────────────────────────────────────────────────

/**
 * Returns true if the process exit looks like a configuration error
 * (bad flags, binary not found) rather than a network/source failure.
 * Configuration errors should NOT be retried.
 */
function isConfigError(exitCode: number | null, stderr: string): boolean {
  if (exitCode === 2) return true; // argparse exit code for unrecognized arguments
  if (/unrecognized argument|invalid choice|error: argument/i.test(stderr)) return true;
  return false;
}

/**
 * Sentinel returned by _resolveStreamlinkQuality when streamlink itself is
 * broken/misconfigured (bad flags, binary not installed). The caller must
 * call _fatal() and NOT fall back to yt-dlp — retrying a bad command or
 * a missing binary forever would waste the retry budget.
 *
 * Distinct from `null` (channel offline / no streams), where yt-dlp fallback
 * is the appropriate next step.
 */
const STREAMLINK_CONFIG_ERROR: unique symbol = Symbol("streamlink_config_error");

// ── Types ─────────────────────────────────────────────────────────────────────

export type RelayStatus =
  | "starting"            // relay created, first spawn not yet begun
  | "waiting_for_source"  // first spawn running, no bytes received yet (startup window)
  | "running"             // bytes are flowing to FFmpeg stdin
  | "reconnecting"        // source exited, waiting in backoff before next spawn
  | "recovering"          // spawn running after reconnect, waiting for first byte
  | "failed"              // hit maxConsecutiveFailures or config error — stop retrying
  | "stopped";            // stop() was called

export interface RelayEvent {
  type: "log" | "warn" | "status" | "health" | "fatal";
  message?: string;
  status?: RelayStatus;
  bytesRelayed?: number;
  kbps?: number;
  consecutiveFailures?: number;
  totalRestarts?: number;
  /** Set on status="running" after a reconnect: ms from disconnect to first frame. */
  recoveryMs?: number;
}

export interface SourceRelayOptions {
  streamId: string;
  /** "tiktok" | "tiktok_pipe" | "youtube" | "youtube_pipe" | "xspace" */
  sourceType: string;
  /**
   * The PERMANENT live page URL. Never a CDN URL.
   *   TikTok:  "https://www.tiktok.com/@username/live"
   *   YouTube: "https://www.youtube.com/@channel/live"
   */
  pageUrl: string;
  /** Quality preference: "best" | "720p" | "480p" */
  quality: string;
  /**
   * Pre-resolved streamlink quality name from a previous session.
   * When provided, the initial `streamlink --json` probe is skipped so the
   * relay spawns immediately instead of spending 10–30 s on the quality query.
   * Stored externally (stream-manager) so it survives hardKillAndRestart.
   */
  cachedQuality?: string | null;
  /**
   * FFmpeg's stdin WritableStream.
   * The relay writes data here and NEVER calls .end() on it.
   */
  ffmpegStdin: NodeJS.WritableStream;
  /** Called for every relay event (logs, status changes, health). */
  onEvent: (event: RelayEvent) => void;
  /**
   * How many consecutive network/source failures before the relay transitions
   * to "failed" state and stops retrying. Defaults to 20.
   * The caller's onEvent will receive { type: "fatal" } at this threshold.
   */
  maxConsecutiveFailures?: number;
  /**
   * Whether the relay should automatically reconnect after a source/network
   * failure. Defaults to true. When false, the relay behaves as it did
   * before auto-reconnect existed: the first failure is treated as fatal
   * and the stream is stopped, requiring a manual restart.
   */
  autoReconnect?: boolean;
  /**
   * Maximum total wall-clock time (minutes) the relay is allowed to spend
   * retrying before giving up and declaring the stream permanently failed.
   * `null`/undefined means no time limit — retries continue indefinitely
   * (subject to maxConsecutiveFailures) using the capped exponential backoff.
   */
  maxReconnectMinutes?: number | null;
}

// ── SourceRelay class ─────────────────────────────────────────────────────────

export class SourceRelay {
  private readonly streamId: string;
  private readonly sourceType: string;
  private readonly pageUrl: string;
  private readonly quality: string;
  private readonly ffmpegStdin: NodeJS.WritableStream;
  private readonly onEvent: (event: RelayEvent) => void;

  private proc: ChildProcess | null = null;
  private stopped = false;
  private permanentlyFailed = false;
  private consecutiveFailures = 0;
  private totalRestarts = 0;
  private bytesRelayed = 0;
  private lastByteSnapshot = 0;
  private lastHealthAt = Date.now();
  private status: RelayStatus = "starting";
  private retryTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  // Guard: prevents two concurrent _spawn() calls (e.g. from the startup watchdog
  // firing at the same time the exit handler schedules a retry).  Set to true for
  // the entire duration of the async quality-probe + process-launch phase; reset
  // to false as soon as the child process is running (or on any error path).
  private _spawning = false;
  // Backpressure: when FFmpeg stdin signals "drain needed" we pause the source
  // process stdout to prevent unbounded buffer growth. Without this, a slow
  // FFmpeg encoder causes streamlink/yt-dlp stdout to buffer GBs in memory,
  // ultimately triggering OOM or causing Node.js to fall behind real-time.
  private _stdinDraining = false;
  // Single drain listener attached once to ffmpegStdin for the lifetime of
  // this relay instance. Stored so we can removeListener in stop() to avoid
  // the EventEmitter leak that accumulates on reconnect cycles if the listener
  // were re-registered every time the source process reconnects.
  private _drainListener: (() => void) | null = null;
  // The currently live source process, needed by the drain listener to resume
  // stdout without capturing a stale closure from an earlier spawn.
  private _currentProc: ChildProcess | null = null;
  // Cached result from the first successful streamlink quality probe.
  // Re-probing on every reconnect adds 10–30 s of FFmpeg stdin starvation
  // per restart cycle.  During that probe window the RTMP rw_timeout (20 s)
  // fires, hardKillAndRestart bumps the backoff, and the stream spirals into
  // the 120-second backoff level — causing YouTube Studio's "not receiving
  // enough video" warning at ~2 minutes.  Caching the quality eliminates the
  // probe delay on all reconnects after the first successful one.
  private cachedResolvedQuality: string | null = null;

  // ── Recovery state machine ──────────────────────────────────────────────────
  // Timestamps for computing recovery duration and enforcing the deadline.
  private reconnectStartedAt: number | null = null;
  private recoveryDeadline: number | null = null;
  // Cumulative recovery stats exposed via getters for the dashboard API.
  private totalRecoveries = 0;
  private longestOutageMs = 0;
  private totalRecoveryMs = 0;
  private lastFrameAt: number | null = null;
  private lastRecoveredAt: number | null = null;
  private readonly createdAt = Date.now();
  private readonly maxConsecutiveFailures: number;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectMs: number | null;
  // Wall-clock timestamp of the first failure in the current reconnect streak.
  // Reset to null whenever data flows (successful reconnect) so a fresh
  // maxReconnectMs window starts on the next failure streak.
  private _reconnectStreakStartedAt: number | null = null;
  // Counts consecutive immediate-403 restarts that produced no data. Reset to
  // 0 whenever data flows. When this reaches MAX_CONSECUTIVE_403_RESTARTS the
  // 403 is not URL expiry — escalate to normal backoff + failure budget.
  private _consecutive403Restarts = 0;

  // ── Mid-stream stall tracking ───────────────────────────────────────────────
  // Updated on every data chunk while status === "running". Reset to null when
  // the proc is killed (mid-stream stall handler or stop()) so the next spawn
  // starts fresh. Used by _startHealthMonitor() to detect hung source processes
  // that are still running but have stopped sending data.
  private lastDataReceivedAt: number | null = null;

  constructor(opts: SourceRelayOptions) {
    this.streamId = opts.streamId;
    this.sourceType = opts.sourceType;
    this.pageUrl = opts.pageUrl;
    this.quality = opts.quality;
    this.ffmpegStdin = opts.ffmpegStdin;
    this.onEvent = opts.onEvent;
    this.maxConsecutiveFailures = opts.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    this.autoReconnect = opts.autoReconnect ?? true;
    this.maxReconnectMs =
      opts.maxReconnectMinutes != null ? opts.maxReconnectMinutes * 60_000 : null;
    // Seed from the externally persisted cache (survives hardKillAndRestart).
    if (opts.cachedQuality) this.cachedResolvedQuality = opts.cachedQuality;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Begin the relay. Detects streamlink version then spawns the source process. */
  start(): void {
    this._log(`[relay:${this.sourceType}] Starting — URL: ${this.pageUrl}`);
    this._setStatus("starting");
    this._startHealthMonitor();

    // ── Register exactly ONE drain listener for the lifetime of this relay ──
    // Attaching inside _spawn() (called on every reconnect) would accumulate
    // one listener per reconnect cycle, causing MaxListenersExceededWarning and
    // spurious resume() calls from stale closures. We attach once here so the
    // listener count stays constant regardless of how many times the source
    // process reconnects. stop() removes it.
    this._drainListener = () => {
      this._stdinDraining = false;
      const cur = this._currentProc;
      if (!this.stopped && cur && !cur.killed) {
        try { cur.stdout?.resume(); } catch {}
      }
    };
    (this.ffmpegStdin as any)?.on?.("drain", this._drainListener);

    // Detect streamlink version first, then spawn
    detectStreamlink().then((info) => {
      if (this.stopped) return;
      if (info) {
        this._log(`[relay] streamlink ${info.version} detected`);
      } else {
        this._log(`[relay] streamlink not found or version unknown — attempting spawn anyway`);
      }
      this._spawn().catch((err) => {
        this._warn(`[relay] Unexpected spawn error: ${err?.message ?? err}`);
        this._scheduleRetry();
      });
    });
  }

  /**
   * Permanently stop the relay.
   * Kills the source process. Does NOT close ffmpegStdin.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this._setStatus("stopped");
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    // Remove the single drain listener registered in start() to avoid
    // a stale handler accumulating if the relay is restarted externally.
    if (this._drainListener) {
      try { (this.ffmpegStdin as any)?.removeListener?.("drain", this._drainListener); } catch {}
      this._drainListener = null;
    }
    this._stdinDraining = false;
    this._currentProc = null;
    this._kill(this.proc);
    this.proc = null;
  }

  getStatus(): RelayStatus { return this.status; }
  getTotalRestarts(): number { return this.totalRestarts; }
  getBytesRelayed(): number { return this.bytesRelayed; }
  /** Returns the resolved quality name once a probe has succeeded, else null. */
  getCachedQuality(): string | null { return this.cachedResolvedQuality; }

  // ── Recovery observability ─────────────────────────────────────────────────

  /**
   * True while the relay is in a transient non-running state (reconnecting or
   * recovering). Stream-manager uses this to suppress watchdog restarts during
   * expected reconnect gaps.
   */
  isStalled(): boolean {
    return this.status === "reconnecting" || this.status === "recovering";
  }

  /**
   * True when reconnectStartedAt + RECOVERY_DEADLINE_MS has elapsed without
   * a first frame being received. The stall watchdog escalates to an FFmpeg
   * restart when this returns true.
   */
  isRecoveryDeadlineExceeded(): boolean {
    return this.recoveryDeadline !== null && Date.now() > this.recoveryDeadline;
  }

  /**
   * True when the relay is nominally "running" but no bytes have arrived for
   * longer than MID_STREAM_DATA_WARN_MS (15 s).
   *
   * This is an early-warning signal — the mid-stream stall handler in
   * _startHealthMonitor() will kill + respawn the source process at
   * MID_STREAM_STALL_MS (30 s), but callers should start suppressing
   * quality-reduction decisions as soon as this returns true.  Without this,
   * the AQM incorrectly classifies a hung streamlink pipe (speed=0 from
   * FFmpeg's perspective) as a CPU bottleneck and degrades quality parameters
   * that have no effect on the actual problem.
   */
  isDataStalled(): boolean {
    if (this.status !== "running") return false;
    if (this.lastDataReceivedAt === null) return false;
    return Date.now() - this.lastDataReceivedAt > MID_STREAM_DATA_WARN_MS;
  }

  getReconnectStartedAt(): number | null { return this.reconnectStartedAt; }
  getConsecutiveFailures(): number { return this.consecutiveFailures; }
  getTotalRecoveries(): number { return this.totalRecoveries; }
  getLongestOutageMs(): number { return this.longestOutageMs; }
  getTotalRecoveryMs(): number { return this.totalRecoveryMs; }
  getLastFrameAt(): number | null { return this.lastFrameAt; }
  getLastRecoveredAt(): number | null { return this.lastRecoveredAt; }
  /** Milliseconds since this relay instance was created. */
  getUptimeMs(): number { return Date.now() - this.createdAt; }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _setStatus(s: RelayStatus, meta?: { recoveryMs?: number }): void {
    if (this.status === s) return;
    this.status = s;
    this.onEvent({
      type: "status",
      status: s,
      totalRestarts: this.totalRestarts,
      consecutiveFailures: this.consecutiveFailures,
      recoveryMs: meta?.recoveryMs,
    });
  }

  private _log(msg: string): void {
    this.onEvent({ type: "log", message: msg });
    logger.info({ streamId: this.streamId }, msg);
  }

  private _warn(msg: string): void {
    this.onEvent({ type: "warn", message: msg });
    logger.warn({ streamId: this.streamId }, msg);
  }

  private _fatal(msg: string): void {
    this.permanentlyFailed = true;
    this._setStatus("failed");
    this.onEvent({ type: "fatal", message: msg });
    logger.error({ streamId: this.streamId }, msg);
  }

  private _kill(proc: ChildProcess | null): void {
    if (!proc) return;
    try { proc.kill("SIGKILL"); } catch {}
  }

  // ── Stream quality resolution ──────────────────────────────────────────────

  /**
   * Query streamlink for available stream names on the given URL, then pick
   * the most appropriate quality.
   *
   * Return values:
   *   string                  — a valid quality name; proceed with streamlink
   *   null                    — channel offline / no streams; yt-dlp fallback is appropriate
   *   STREAMLINK_CONFIG_ERROR — bad flags or binary not installed; caller must _fatal(),
   *                            NOT fall back to yt-dlp (retrying a broken command is useless)
   */
  private async _resolveStreamlinkQuality(
    url: string,
    extraArgs: string[] = [],
  ): Promise<string | null | typeof STREAMLINK_CONFIG_ERROR> {
    this._log(`[relay] Querying available streams for: ${url}`);

    // IMPORTANT: use spawnCollect (array args, NO shell) — NOT execAsync.
    // execAsync runs via `sh -c` and concatenates args into a shell string.
    // User-Agent values contain "(" which sh parses as a subshell, causing:
    //   /bin/sh: Syntax error: "(" unexpected
    // spawnCollect passes each arg as a separate array element, bypassing sh.
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    try {
      const result = await spawnCollect(
        "streamlink",
        ["--json", ...extraArgs, url],
        30_000,
      );
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (e: any) {
      // ENOENT → streamlink is not installed; treat as permanent config error.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this._warn(`[relay] streamlink binary not found — cannot probe TikTok streams`);
        return STREAMLINK_CONFIG_ERROR;
      }
      stdout = "";
      stderr = e.message ?? String(e);
    }

    // ── Detect configuration / installation errors early ─────────────────────
    // Exit code 2 = argparse "unrecognized arguments"; stderr patterns also
    // cover older streamlink versions that don't use exit code 2 consistently.
    // These must NOT fall back to yt-dlp — the command itself is broken.
    if (isConfigError(exitCode, stderr)) {
      const errorLine = stderr
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /error|unrecognized/i.test(l)) ?? stderr.trim().slice(0, 200);
      this._warn(
        `[relay] Streamlink configuration error (exit ${exitCode}): ${errorLine}`,
      );
      return STREAMLINK_CONFIG_ERROR;
    }

    // Try to parse JSON regardless of exit code — streamlink sometimes exits 1
    // but still emits valid JSON with an "error" field when the channel is offline.
    let parsed: { streams?: Record<string, unknown>; error?: string } | null = null;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Not JSON — fall through to stderr analysis
    }

    // Explicit offline/unavailable report from JSON
    if (parsed?.error) {
      this._warn(`[relay] Streamlink reported: ${parsed.error}`);
      return null;
    }

    const streams = parsed?.streams ?? {};
    const names = Object.keys(streams);

    if (names.length === 0) {
      // No JSON streams — analyse stderr to give a clear reason
      const offlinePatterns =
        /no playable streams|channel.*offline|not live|unavailable|no streams found|could not find/i;
      if (offlinePatterns.test(stderr)) {
        this._warn(
          `[relay] Channel is offline or unavailable. ` +
          `Streamlink said: ${stderr.trim().split("\n").slice(-3).join(" | ")}`,
        );
      } else if (stderr.trim()) {
        this._warn(`[relay] No streams returned. Stderr: ${stderr.trim().slice(0, 300)}`);
      } else {
        this._warn(`[relay] No streams returned (empty response). Channel may be offline.`);
      }
      return null;
    }

    // Log all available names so operators can diagnose quality issues
    this._log(`[relay] Available streams: ${names.join(", ")}`);

    // 1. "best" alias — always prefer it when present
    if (names.includes("best")) {
      this._log(`[relay] Selected quality: best`);
      return "best";
    }

    // 2. User's requested quality — exact match
    if (this.quality && names.includes(this.quality)) {
      this._log(`[relay] Selected quality: ${this.quality} (user preference)`);
      return this.quality;
    }

    // 3. Fallback: highest real quality (exclude aliases like "worst"/"audio_only")
    const aliases = new Set(["worst", "best", "audio_only"]);
    const realStreams = names.filter((n) => !aliases.has(n));
    const chosen = realStreams.length > 0
      ? realStreams[realStreams.length - 1]   // last is typically highest quality
      : names[names.length - 1];

    if (this.quality && !names.includes(this.quality)) {
      this._warn(
        `[relay] Requested quality "${this.quality}" not available. ` +
        `Falling back to "${chosen}". Available: ${names.join(", ")}`,
      );
    } else {
      this._log(`[relay] Selected quality: ${chosen}`);
    }
    return chosen;
  }

  // ── Spawn args per source type ─────────────────────────────────────────────

  private _getSpawnArgs(resolvedQuality: string): { cmd: string; args: string[] } | null {
    const st = this.sourceType;
    if (st === "tiktok" || st === "tiktok_pipe") return this._tikTokArgs(resolvedQuality);
    if (st === "youtube" || st === "youtube_pipe") return this._youTubeArgs(resolvedQuality);
    if (st === "facebook" || st === "facebook_pipe") return this._facebookArgs(resolvedQuality);
    if (st === "xspace") return this._xSpaceArgs();
    if (st === "link_pipe") return this._linkArgs(resolvedQuality);
    return null;
  }

  /** Sentinel value used when streamlink returns no streams and we fall back to yt-dlp. */
  private static readonly YTDLP_TIKTOK_FALLBACK = "__ytdlp_tiktok_fallback__";

  private _tikTokArgs(resolvedQuality: string): { cmd: string; args: string[] } {
    // When streamlink's quality probe returned no streams, _spawn sets this
    // sentinel and we transparently switch to yt-dlp for the same TikTok URL.
    if (resolvedQuality === SourceRelay.YTDLP_TIKTOK_FALLBACK) {
      return this._tikTokYtdlpArgs();
    }

    // Extract bare username from the permanent page URL
    const username = this.pageUrl
      .replace(/.*tiktok\.com\/@?/, "")
      .replace(/\/.*$/, "")
      .replace(/^@/, "");

    return {
      cmd: "streamlink",
      args: [
        "--stdout",
        "--loglevel", "warning",
        "--http-header",
        "User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "--http-header", "Referer=https://www.tiktok.com/",
        "--http-header", "Accept-Language=en-US,en;q=0.9",
        "--http-timeout", "20",
        "--stream-segment-timeout", "15",
        "--stream-timeout", "60",
        "--retry-streams", "10",
        "--retry-max", "10",
        "--retry-open", "5",
        // hls-live-edge 2 (was 3): fetch segments one step closer to the live
        // head. At edge=3 TikTok's CDN introduces a ~6-9s additional delay
        // between the segment being muxed and streamlink delivering it, which
        // stalls FFmpeg stdin during normal operation and manifests as speed
        // dipping below 1.0x at every segment boundary.
        "--hls-live-edge", "2",
        // hls-segment-stream-data: begin piping each HLS segment to stdout as
        // soon as bytes arrive, rather than waiting for the full segment to be
        // fetched. Reduces per-segment latency by ~1-2s and prevents the stdin
        // stall that causes FFmpeg speed to drop during segment transitions.
        "--hls-segment-stream-data",
        `https://www.tiktok.com/@${username}/live`,
        resolvedQuality,
      ],
    };
  }

  /**
   * yt-dlp fallback args for TikTok live.
   *
   * Used when streamlink's quality probe returns no streams — either because
   * the TikTok plugin is incompatible with the installed streamlink version,
   * or because the live feed URL format changed.
   *
   * yt-dlp supports TikTok live via its own extractor and does not require
   * a separate quality-probe step: `best` resolves internally in one session.
   *
   * --hls-use-mpegts  — write MPEG-TS to stdout so FFmpeg receives a
   *                     continuous seekable byte-stream across HLS segments.
   * --no-progress     — suppress the progress bar but keep WARNING/ERROR lines
   *                     visible in stderr for the relay's log handler.
   */
  private _tikTokYtdlpArgs(): { cmd: string; args: string[] } {
    const username = this.pageUrl
      .replace(/.*tiktok\.com\/@?/, "")
      .replace(/\/.*$/, "")
      .replace(/^@/, "");
    const url = `https://www.tiktok.com/@${username}/live`;

    const qualityMap: Record<string, string> = {
      best:   "best[protocol^=m3u8]/best",
      "720p": "best[height<=720][protocol^=m3u8]/best[height<=720]/best",
      "480p": "best[height<=480][protocol^=m3u8]/best[height<=480]/best",
      "360p": "best[height<=360][protocol^=m3u8]/best[height<=360]/best",
      "240p": "best[height<=240][protocol^=m3u8]/best[height<=240]/best",
    };
    const formatSelector = qualityMap[this.quality] ?? qualityMap["best"];

    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--extractor-retries", "5",
        "--retry-sleep", "extractor:exp=1:10",
        "-f", formatSelector,
        "--hls-use-mpegts",
        "--socket-timeout", "30",
        "-o", "-",
        url,
      ],
    };
  }

  private _youTubeArgs(formatSelector: string): { cmd: string; args: string[] } {
    // yt-dlp is used for YouTube live instead of streamlink because:
    //
    //  1. YouTube rate-limits rapid manifest requests (403/429). The previous
    //     streamlink two-step flow (quality probe → playback spawn) made two
    //     manifest requests in quick succession, reliably triggering rate limits.
    //     yt-dlp resolves and streams in one session, eliminating that problem.
    //
    //  2. Streamlink's YouTube plugin does not attach Referer/Origin headers
    //     when fetching HLS segments, causing 403s on segment CDN requests.
    //     yt-dlp handles segment-level auth headers internally.
    //
    //  3. yt-dlp handles rqh token rotation and the signed-URL expiry cycle
    //     internally — no separate quality-probe request is needed.
    //
    // ── Flag rationale ───────────────────────────────────────────────────────
    //
    // --no-live-from-start   — CRITICAL for reconnect stability. Without this,
    //                          yt-dlp starts from the beginning of the YouTube
    //                          DVR window (can be hours back) and must download/
    //                          skip all that content before reaching the live
    //                          edge. On a reconnect this delays the first live
    //                          frame by minutes and causes YouTube Studio to
    //                          flag "not receiving enough video".
    //
    // --extractor-args       — ios + android clients do not require nsig solving
    //   player_client=ios,     (no JS runtime needed) and return live HLS
    //   android                streams reliably. Avoids the "web" client which
    //                          needs quickjs/node for signature decoding.
    //
    // --no-progress          — suppresses the download progress bar but keeps
    //                          all WARNING and ERROR lines visible in stderr so
    //                          the relay's stderr handler can log 429s, format
    //                          errors, and offline signals. (--no-warnings would
    //                          hide the "HTTP 429" warning that explains WHY
    //                          "No video formats found!" happens.)
    //
    // --extractor-retries 5  — retry the m3u8 manifest fetch up to 5× when it
    //                          returns 429/503. Without this, a single transient
    //                          rate-limit response immediately causes "No video
    //                          formats found!" and the relay must restart.
    //
    // --retries 10           — retry individual HTTP requests (segment fetches,
    //                          manifest refreshes) up to 10× before giving up.
    //                          Handles transient CDN hiccups without a full
    //                          yt-dlp restart.
    //
    // --fragment-retries 10  — retry individual HLS fragment (segment) downloads
    //                          up to 10× on failure. YouTube CDN occasionally
    //                          returns transient errors on a single segment;
    //                          with the default (no retries), a single bad
    //                          segment immediately terminates the session.
    //
    // --retry-sleep          — exponential backoff between extractor retries:
    //   extractor:exp=1:10     1 s → 2 s → 4 s → 8 s → 10 s cap.
    //
    // --hls-use-mpegts       — write an MPEG-TS container to stdout so FFmpeg
    //                          receives a single seekable byte-stream across
    //                          HLS segment boundaries (no atom-level rewrite).
    //
    // --socket-timeout 20    — per-connection socket timeout (seconds). Lower
    //                          than the old 30 s so a hung CDN connection is
    //                          detected and retried faster (--retries 10 absorbs
    //                          the cost without causing a full session restart).
    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        // Start at the live edge, not the beginning of the DVR window.
        // Without this, every reconnect starts hours behind live.
        "--no-live-from-start",
        // ios + android don't need nsig solving; more stable for live streams.
        "--extractor-args", "youtube:player_client=ios,android",
        "--extractor-retries", "5",
        "--retries", "10",
        "--fragment-retries", "10",
        "--retry-sleep", "extractor:exp=1:10",
        "-f", formatSelector,
        "--hls-use-mpegts",
        "--socket-timeout", "20",
        // Pass browser-compatible headers so YouTube CDN accepts HLS segment
        // requests.  yt-dlp forwards these to its internal segment downloader.
        // Referer and Origin satisfy YouTube's CDN hotlink-protection checks;
        // the User-Agent prevents bot-detection headers from triggering extra
        // challenge layers on segment URLs.
        "--add-header", "Referer:https://www.youtube.com/",
        "--add-header", "Origin:https://www.youtube.com",
        "--add-header", "Accept-Language:en-US,en;q=0.9",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        // Include cookies if configured — reduces CDN 403s significantly on
        // cloud/VPS IPs where YouTube applies stricter bot-detection to
        // unauthenticated requests.
        ...getCookiesArgs(),
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  /**
   * Derive a yt-dlp format selector from the user's quality preference.
   *
   * We do NOT pre-query yt-dlp (that would make a second manifest request,
   * risking a 429 rate limit). Instead we build a cascading selector that
   * the single streaming invocation resolves internally.
   *
   * Protocol selector uses `^=m3u8` ("starts with m3u8") rather than
   * `=m3u8_native` (exact match) so it also accepts the plain `m3u8` protocol
   * variant. If no m3u8 stream passes the height filter, the `/best` fallback
   * picks whatever yt-dlp considers best — combined with `--hls-use-mpegts`
   * this is still piped as MPEG-TS even when it's an HLS stream.
   */
  private _youTubeFormatSelector(): string {
    // Format selector strategy:
    //  1. Prefer pre-muxed HLS itags (91-95, protocol m3u8) with both video+audio
    //     in one stream — avoids an A+V merge step and is the most stable pipe target.
    //  2. Fall back to any HLS stream with video+audio if no height-constrained one exists.
    //  3. Last resort: whatever yt-dlp considers "best" regardless of protocol.
    //
    // [vcodec!*=none][acodec!*=none] ensures we get a pre-muxed stream (both
    // video and audio tracks present) rather than a video-only or audio-only format
    // that would require an extra merge pass and is much less stable for live piping.
    const qualityMap: Record<string, string> = {
      best:   "best[protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[protocol^=m3u8]/best",
      "720p": "best[height<=720][protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[height<=720][protocol^=m3u8]/best[height<=720]/best",
      "480p": "best[height<=480][protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[height<=480][protocol^=m3u8]/best[height<=480]/best",
      "360p": "best[height<=360][protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[height<=360][protocol^=m3u8]/best[height<=360]/best",
      "240p": "best[height<=240][protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[height<=240][protocol^=m3u8]/best[height<=240]/best",
    };
    const sel = qualityMap[this.quality] ?? qualityMap["best"];
    this._log(`[relay] YouTube format selector: ${sel}`);
    return sel;
  }

  /**
   * yt-dlp args for Facebook Live.
   *
   * Facebook live streams are served as HLS or DASH. yt-dlp's facebook extractor
   * handles both formats automatically. We pipe MPEG-TS to stdout so FFmpeg can
   * read it on stdin (pipe:0) without an intermediate file.
   *
   * --no-live-from-start  — start at the live edge, not the beginning of the DVR.
   * --hls-use-mpegts      — write a single seekable MPEG-TS byte-stream across
   *                         HLS segment boundaries (avoids atom-level rewriting).
   * --socket-timeout 30   — per-connection timeout; Facebook CDN is slightly
   *                         slower than YouTube's, so we give it a bit more headroom.
   */
  private _facebookArgs(_formatSelector: string): { cmd: string; args: string[] } {
    // Facebook only serves DASH with SEPARATE video + audio tracks — there are
    // no pre-muxed combined streams.  yt-dlp must download both tracks and mux
    // them, which introduces at least one full DASH segment worth of lag (2-6 s)
    // plus whatever the CDN's suggestedPresentationDelay is (~10-20 s).
    //
    // To minimise the lag we add on top of that floor:
    //  1. Prefer HLS first (lower latency if Facebook ever serves it).
    //  2. For DASH, prefer 360p (smallest bitrate tier) so each segment
    //     downloads as fast as possible, reducing the mux buffer wait.
    //  3. Fall back to higher quality only if lower tiers aren't available.
    const qualityMap: Record<string, string> = {
      // HLS first (pre-muxed, single stream, lowest latency).
      // 360p DASH next  — smaller segments download faster → less mux lag.
      // 480p/720p DASH  — larger, higher latency, used only if lower not available.
      best:   [
        "best[protocol^=m3u8][vcodec!*=none][acodec!*=none]",
        "best[protocol^=m3u8]",
        "bestvideo[height<=360][vcodec!*=none]+bestaudio[acodec!*=none]",
        "bestvideo[height<=480][vcodec!*=none]+bestaudio[acodec!*=none]",
        "bestvideo[vcodec!*=none]+bestaudio[acodec!*=none]",
        "best",
      ].join("/"),
      "720p": [
        "best[protocol^=m3u8][height<=720][vcodec!*=none][acodec!*=none]",
        "bestvideo[height<=720][vcodec!*=none]+bestaudio[acodec!*=none]",
        "best[height<=720]",
        "best",
      ].join("/"),
      "480p": [
        "best[protocol^=m3u8][height<=480][vcodec!*=none][acodec!*=none]",
        "bestvideo[height<=480][vcodec!*=none]+bestaudio[acodec!*=none]",
        "best[height<=480]",
        "best",
      ].join("/"),
    };
    const sel = qualityMap[this.quality] ?? qualityMap["best"];

    // Cookies resolution (priority order):
    //   1. FACEBOOK_COOKIES_B64 — base64-encoded Netscape cookies.txt set as a
    //      Replit Secret (or any env var).  Always decoded and written to a temp
    //      file on every call so that rotated secrets take effect immediately
    //      without a server restart.
    //   2. facebook-cookies.txt in the project root — uploaded manually.
    let cookiesArgs: string[] = [];
    const fbB64 = process.env["FACEBOOK_COOKIES_B64"];
    if (fbB64) {
      try {
        const tmpPath = "/tmp/fb-yt-dlp-cookies.txt";
        // Always rewrite — ensures rotated env var takes effect immediately.
        fs.writeFileSync(tmpPath, Buffer.from(fbB64.trim(), "base64").toString("utf-8"), "utf-8");
        cookiesArgs = ["--cookies", tmpPath];
      } catch (err) {
        logger.warn({ err }, "[facebook] Failed to decode FACEBOOK_COOKIES_B64 — continuing without cookies");
      }
    } else {
      const cookiesPath = path.join(process.cwd(), "facebook-cookies.txt");
      if (fs.existsSync(cookiesPath)) {
        cookiesArgs = ["--cookies", cookiesPath];
      }
    }

    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--no-live-from-start",
        "--extractor-retries", "5",
        "--retries", "10",
        "--fragment-retries", "10",
        "--retry-sleep", "extractor:exp=1:10",
        "-f", sel,
        "--hls-use-mpegts",
        // --concurrent-fragments 4: Facebook DASH delivers video and audio as
        // separate tracks.  yt-dlp downloads both simultaneously when this is
        // set.  Without it, sequential track downloads introduce a mux lag of
        // one full segment duration (4–6 s) that repeats every segment cycle,
        // showing up as periodic video freezes while audio continues.
        "--concurrent-fragments", "4",
        // --buffer-size 128K: yt-dlp reads from Facebook's CDN in 128 KB chunks.
        // The previous 16 K value caused very frequent small reads; at Facebook
        // CDN edge latency (~80–120 ms RTT) this meant yt-dlp spent more time
        // in round-trips than receiving data, starving the muxer between chunks
        // and causing micro-stutters in the video track.  128 K keeps per-read
        // overhead low while still flushing promptly to FFmpeg stdin.
        "--buffer-size", "128K",
        "--socket-timeout", "30",
        "--add-header", "Referer:https://www.facebook.com/",
        "--add-header", "Origin:https://www.facebook.com",
        "--add-header", "Accept-Language:en-US,en;q=0.9",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ...cookiesArgs,
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  /**
   * Generic video-link args — yt-dlp with broad site support.
   *
   * Supports any URL that yt-dlp can extract: YouTube, Facebook, Twitch,
   * Vimeo, Twitter/X, TikTok, Dailymotion, and thousands of other sites.
   *
   * When the pasted URL points to YouTube or youtu.be, we apply the same
   * iOS/Android player-client override that _youTubeArgs uses.  This is
   * critical for cloud / CI environments:
   *
   *  • player_client=ios,android — these mobile clients do NOT require
   *    nsig/signature solving (no JS runtime needed), so the "No supported
   *    JavaScript runtime could be found" warning disappears entirely.
   *    They also bypass the "Sign in to confirm you're not a bot" block
   *    that YouTube applies to the default web client on server IPs.
   *
   *  • getCookiesArgs() — if YOUTUBE_COOKIES_B64 or a local cookies file
   *    is present, pass it through.  Cookies make bot-detection errors far
   *    less likely on cloud IPs even without a JS runtime.
   *
   * Non-YouTube URLs (Twitch, Vimeo, Twitter/X, direct HLS/MP4, …) use
   * the generic yt-dlp args — no extractor-specific overrides needed.
   */
  private _linkArgs(quality: string): { cmd: string; args: string[] } {
    const isYouTube = /youtube\.com|youtu\.be/i.test(this.pageUrl);

    // ── Format selectors ─────────────────────────────────────────────────────
    // YouTube: prefer pre-muxed HLS streams (no A+V merge step, most stable
    // for live piping); cascade down by height then fall back to "best".
    // Other sites: simpler cascade; most sites only serve pre-muxed streams.
    const ytQualityMap: Record<string, string> = {
      best:   "best[protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[protocol^=m3u8]/best",
      "720p": "best[height<=720][protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[height<=720][protocol^=m3u8]/best[height<=720]/best",
      "480p": "best[height<=480][protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[height<=480][protocol^=m3u8]/best[height<=480]/best",
      "360p": "best[height<=360][protocol^=m3u8]/best[height<=360]/best",
      "240p": "best[height<=240][protocol^=m3u8]/best[height<=240]/best",
    };
    const genericQualityMap: Record<string, string> = {
      best:   "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
      "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
      "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
      "360p": "bestvideo[height<=360]+bestaudio/best[height<=360]/best",
      "240p": "bestvideo[height<=240]+bestaudio/best[height<=240]/best",
    };
    const formatSelector = isYouTube
      ? (ytQualityMap[quality] ?? ytQualityMap["best"])
      : (genericQualityMap[quality] ?? genericQualityMap["best"]);

    // ── Site-specific extras ─────────────────────────────────────────────────
    // YouTube on cloud IPs: use iOS/Android player client (no JS runtime) and
    // browser-compatible headers to satisfy CDN hotlink-protection checks.
    const youTubeExtras: string[] = isYouTube ? [
      "--extractor-args", "youtube:player_client=ios,android",
      "--add-header", "Referer:https://www.youtube.com/",
      "--add-header", "Origin:https://www.youtube.com",
      "--add-header", "Accept-Language:en-US,en;q=0.9",
      "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...getCookiesArgs(),
    ] : [];

    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--no-live-from-start",
        "--extractor-retries", "5",
        "--retries", "10",
        "--fragment-retries", "10",
        "--retry-sleep", "extractor:exp=1:10",
        ...youTubeExtras,
        "-f", formatSelector,
        "--hls-use-mpegts",
        "--socket-timeout", "20",
        "--buffer-size", "64K",
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  private _xSpaceArgs(): { cmd: string; args: string[] } {
    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "-f", "bestaudio",
        "--no-warnings",
        "--socket-timeout", "20",
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  // ── Core spawn / retry loop ────────────────────────────────────────────────

  private async _spawn(): Promise<void> {
    if (this.stopped || this.permanentlyFailed) return;

    // ── Concurrency guard ─────────────────────────────────────────────────────
    // Prevents a second _spawn() from starting while the async quality-probe is
    // still running (10–30 s for TikTok streamlink --json). Without this, a
    // startup-watchdog timeout firing while the probe is in progress would launch
    // a second streamlink process that writes interleaved bytes to FFmpeg stdin.
    if (this._spawning) {
      this._warn("[relay] Concurrent spawn request ignored — already in progress");
      return;
    }
    this._spawning = true;

    // Transition to the appropriate spawn-phase state before the quality probe.
    // totalRestarts > 0 means _scheduleRetry() has run at least once, so this
    // is a reconnect spawn → "recovering". The very first spawn is "waiting_for_source".
    this._setStatus(this.totalRestarts > 0 ? "recovering" : "waiting_for_source");

    // ── Quality / format-selector resolution ──────────────────────────────────
    //
    //  TikTok  → streamlink: query `streamlink --json` to discover available
    //            stream names at runtime, then spawn with the resolved name.
    //            This avoids passing invalid quality strings.
    //
    //  YouTube → yt-dlp: derive a cascading yt-dlp format selector directly
    //            from the user's quality preference WITHOUT a pre-query.
    //            A separate "probe then play" flow triggers YouTube rate limits
    //            (429) because two manifest requests arrive from the same IP in
    //            rapid succession. yt-dlp resolves and streams in one session.
    //
    //  xspace / other → no quality resolution needed; yt-dlp handles it.
    //
    let resolvedQuality = "best";
    const st = this.sourceType;
    const isTikTokSource = st === "tiktok" || st === "tiktok_pipe";
    const isYouTubeSource = st === "youtube" || st === "youtube_pipe";
    const isFacebookSource = st === "facebook" || st === "facebook_pipe";
    const isLinkSource = st === "link_pipe";

    if (isTikTokSource) {
      // On reconnects, reuse the quality resolved during the first successful
      // probe.  Re-probing via `streamlink --json` on every reconnect takes
      // 10–30 s, which starves FFmpeg stdin long enough for the RTMP
      // rw_timeout (20 s) to fire, triggering hardKillAndRestart and pushing
      // the exponential backoff up to the 120-second level.  That 2-minute
      // reconnecting gap is exactly what YouTube Studio flags as "not receiving
      // enough video".  Skipping the probe on reconnects keeps the restart
      // time under 2 s so YouTube never sees a significant data gap.
      if (this.cachedResolvedQuality !== null) {
        this._log(`[relay] Reconnect — reusing cached quality "${this.cachedResolvedQuality}" (skipping probe)`);
        resolvedQuality = this.cachedResolvedQuality;
      } else {
        const username = this.pageUrl
          .replace(/.*tiktok\.com\/@?/, "")
          .replace(/\/.*$/, "")
          .replace(/^@/, "");
        const queryUrl = `https://www.tiktok.com/@${username}/live`;

        const extraArgs = [
          "--http-header",
          "User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "--http-header", "Referer=https://www.tiktok.com/",
        ];

        const quality = await this._resolveStreamlinkQuality(queryUrl, extraArgs);
        if (this.stopped || this.permanentlyFailed) { this._spawning = false; return; }

        if (quality === STREAMLINK_CONFIG_ERROR) {
          // Bad flags or streamlink not installed — permanent failure, do NOT retry.
          // Falling back to yt-dlp here would mask the misconfiguration and waste
          // the retry budget on a fundamentally broken command.
          this._spawning = false;
          this._fatal(
            `[relay] Streamlink is misconfigured or not installed. ` +
            `Fix the streamlink installation/flags, then restart the stream.`,
          );
          return;
        } else if (quality === null) {
          // Streamlink returned no streams (channel offline or plugin mismatch) —
          // fall back to yt-dlp which has its own TikTok extractor. If the channel
          // is truly offline, yt-dlp also fails fast and the exit handler retries.
          this._log(`[relay] Streamlink no streams — switching to yt-dlp fallback for TikTok`);
          resolvedQuality = SourceRelay.YTDLP_TIKTOK_FALLBACK;
        } else {
          // Cache so future reconnects skip this 10–30 s probe entirely.
          this.cachedResolvedQuality = quality;
          resolvedQuality = quality;
        }
      }

    } else if (isYouTubeSource) {
      // Build yt-dlp format selector from user preference — no pre-query.
      resolvedQuality = this._youTubeFormatSelector();
    } else if (isFacebookSource) {
      // Facebook: yt-dlp handles format resolution internally — no pre-query.
      resolvedQuality = this.quality || "best";
    } else if (isLinkSource) {
      // Generic link: yt-dlp resolves format internally — no pre-query needed.
      resolvedQuality = this.quality || "best";
    }

    const spawnArgs = this._getSpawnArgs(resolvedQuality);
    if (!spawnArgs) {
      this._spawning = false;
      this._fatal(`[relay] Unknown source type "${this.sourceType}" — cannot spawn`);
      return;
    }

    const { cmd, args } = spawnArgs;

    // Log the full command so the user can diagnose flag issues
    this._log(`[relay:${this.sourceType}] $ ${cmd} ${args.join(" ")}`);

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      this._spawning = false;
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this._fatal(
          `[relay] "${cmd}" not found. ` +
          `Install with: pip install ${cmd === "streamlink" ? "streamlink" : "yt-dlp"}`,
        );
      } else {
        this._warn(`[relay] Failed to launch ${cmd}: ${e.message}`);
        this._scheduleRetry();
      }
      return;
    }

    // Process launched — release the spawn lock so future retries are not blocked.
    // Handlers below are set up synchronously; the lock is only needed to guard
    // the async quality-probe phase above against concurrent entry.
    this._spawning = false;

    const thisProc = proc;
    this.proc = proc;
    // Track the current process so the single drain listener in start() can
    // resume this specific proc's stdout without holding a stale closure.
    this._currentProc = proc;
    // Reset draining state for this new spawn — a previous proc may have left
    // it stuck in draining=true if it exited before its drain event fired.
    this._stdinDraining = false;

    let gotData = false;
    // Accumulate full stderr for error classification on exit.
    // Capped at 50 KB to prevent unbounded growth on long-running sessions.
    let stderrFull = "";
    let sessionBytes = 0;
    const spawnedAt = Date.now();

    // ── Per-spawn HTTP 403 detection state ────────────────────────────────────
    // Tracks repeated HTTP 403 errors from yt-dlp stderr so we can detect when
    // YouTube HLS signed segment URLs have expired mid-stream and immediately
    // kill + re-extract instead of waiting for yt-dlp to exhaust its own retries
    // on a stale URL it can never succeed with.
    let http403Count = 0;
    let http403FirstAt = 0;
    let http403RestartScheduled = false;

    // ── Startup watchdog ─────────────────────────────────────────────────────
    // RACE FIX: null this.proc BEFORE calling _scheduleRetry() so the exit
    // handler (triggered by _kill()) sees this.proc !== thisProc and bails out
    // without scheduling a second retry.  Combined with _scheduleRetry()'s own
    // timer-cancellation guard, this eliminates the double-spawn race entirely.
    const startupWatchdog = setTimeout(() => {
      if (!gotData && this.proc === thisProc && !this.stopped) {
        this._warn(
          `[relay] No data received after ${STARTUP_TIMEOUT_MS / 1000}s — ` +
          `source may not be live. Will retry.`,
        );
        this.proc = null;        // ← must come before _kill so exit handler bails
        this._currentProc = null;
        this._stdinDraining = false;
        this._kill(thisProc);
        this._scheduleRetry();
      }
    }, STARTUP_TIMEOUT_MS);

    // ── stdout → FFmpeg stdin ─────────────────────────────────────────────────
    // CRITICAL: .write() not .pipe() — keeps stdin open across source restarts.
    //
    // Backpressure handling: Node.js Writable.write() returns false when the
    // internal highWaterMark buffer is full (default 16 KB).  Without pausing
    // the readable source when this happens, streamlink/yt-dlp stdout data
    // piles up in memory (unbounded) and Node.js falls behind real-time,
    // which manifests as speed < 1.0x in FFmpeg stats.
    //
    // When stdin signals backpressure (write() returns false):
    //   1. Pause the source process stdout so it stops emitting chunks.
    //   2. The single drain listener registered in start() resumes it via
    //      this._currentProc — no per-spawn listener accumulation.
    //
    // This keeps the relay pipe non-blocking and prevents memory growth.
    proc.stdout?.on("data", (chunk: Buffer) => {
      // ── Mid-stream stall: track last received byte time on every chunk ──────
      // Updated unconditionally so the health monitor can detect when data stops
      // flowing mid-stream (not just on first-byte arrival).
      this.lastDataReceivedAt = Date.now();

      if (!gotData) {
        gotData = true;
        clearTimeout(startupWatchdog);
        this.consecutiveFailures = 0;
        // Data is flowing — the reconnect streak (used for maxReconnectMinutes)
        // is over. Reset it so the next failure starts a fresh time budget.
        this._reconnectStreakStartedAt = null;
        // Data is flowing — this was a genuine URL-expiry recovery (or a clean
        // first spawn). Reset the 403-restart guardrail so the fast-path stays
        // available for the next expiry cycle without hitting the escalation cap.
        this._consecutive403Restarts = 0;
        this.lastFrameAt = Date.now();

        // ── Frame-based recovery confirmation ────────────────────────────────
        // Declare recovery only when the first real data chunk arrives from the
        // new process — not when Streamlink connects or the quality probe ends.
        const wasRecovering = this.status === "recovering";
        let recoveryMs: number | undefined;

        if (wasRecovering && this.reconnectStartedAt !== null) {
          recoveryMs = Date.now() - this.reconnectStartedAt;
          this.totalRecoveries++;
          this.totalRecoveryMs += recoveryMs;
          if (recoveryMs > this.longestOutageMs) this.longestOutageMs = recoveryMs;
          this.lastRecoveredAt = Date.now();
          logger.info(
            {
              streamId: this.streamId,
              recoveryMs,
              restarts: this.totalRestarts,
              consecutiveFailures: 0,
            },
            `[relay] state=running recovery=${(recoveryMs / 1000).toFixed(1)}s`,
          );
          this._log(
            `[relay:${this.sourceType}] ✓ Recovered in ${(recoveryMs / 1000).toFixed(1)}s` +
            ` (reconnect #${this.totalRestarts}, consecutive failures reset)` +
            ` — first chunk: ${chunk.length} B`,
          );
        } else {
          this._log(
            `[relay:${this.sourceType}] ✓ Source connected — piping to FFmpeg stdin` +
            ` (first chunk: ${chunk.length} B)`,
          );
        }

        // Clear reconnect timing state before emitting the "running" status event.
        this.reconnectStartedAt = null;
        this.recoveryDeadline = null;
        this._setStatus("running", recoveryMs !== undefined ? { recoveryMs } : undefined);
      }

      sessionBytes += chunk.length;
      this.bytesRelayed += chunk.length;

      try {
        const stdin = this.ffmpegStdin as any;
        if (stdin && !stdin.destroyed && stdin.writable) {
          // write() returns false when the internal buffer is full → backpressure.
          const canContinue = stdin.write(chunk);
          if (!canContinue && !this._stdinDraining) {
            this._stdinDraining = true;
            // Pause this proc's stdout to prevent buffer growth.
            // The drain listener in start() resumes it via this._currentProc.
            try { thisProc.stdout?.pause(); } catch {}
          }
        }
      } catch {
        // FFmpeg exited — stream manager will call stop() shortly
      }
    });

    // ── stderr collection ─────────────────────────────────────────────────────
    proc.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      // Cap at 50 KB to prevent unbounded growth on long-running sessions with
      // verbose streamlink/yt-dlp output.  Error-classification reads only the
      // tail anyway, and the most recent lines are always preserved by the cap.
      if (stderrFull.length < 50_000) stderrFull += text;

      // Stream stderr lines to the log in real time, filtered by relevance.
      // Patterns cover both streamlink and yt-dlp output styles.
      const lines = text.split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const isSignificant =
          // General error/warning indicators
          /error|warning|failed|cannot|unable|unavailable/i.test(t) ||
          // Streamlink-specific offline/stream signals
          /not live|no streams|no playable streams/i.test(t) ||
          // yt-dlp YouTube-specific signals
          /no video formats found|this (video|channel) is (unavailable|not available)|private video|members.only|geo.?restrict|sign in to confirm|HTTP Error 40[0-9]/i.test(t);

        if (isSignificant) {
          this._warn(`[relay:${cmd}] ${t}`);
        } else {
          logger.debug({ streamId: this.streamId, src: cmd }, t);
        }

        // ── HTTP 403 detection (YouTube HLS signed URL expiry) ───────────────
        // yt-dlp logs "WARNING: [youtube] HTTP Error 403" when a CDN segment
        // URL has expired. It retries the SAME stale URL internally — we need
        // to kill the process and force fresh URL extraction from scratch.
        //
        // We only act on this for YouTube sources because TikTok and X Space
        // 403s have different root causes and are handled by normal backoff.
        if (
          isYouTubeSource &&
          !http403RestartScheduled &&
          /HTTP Error 403|HTTP 403|403: Forbidden/i.test(t)
        ) {
          const now = Date.now();
          if (http403Count === 0) http403FirstAt = now;
          http403Count++;

          // Classify the failure phase from the log line for clearer diagnostics.
          // Extraction phase: yt-dlp is still resolving the manifest URL.
          // Playlist phase:   yt-dlp is fetching the m3u8 index.
          // Segment phase:    yt-dlp is downloading .ts / .m4s fragments (most common).
          const phase =
            /\[youtube\].*download|extractor/i.test(t)  ? "extraction" :
            /manifest|playlist|\.m3u8/i.test(t)         ? "playlist"   :
            /fragment|\.ts\b|\.m4s\b|segment/i.test(t)  ? "segment"    :
            gotData                                       ? "segment"    :
                                                           "extraction";

          this._warn(
            `[relay:yt-dlp] HTTP 403 #${http403Count} (phase=${phase}, ` +
            `${Math.round((now - http403FirstAt) / 1000)}s since first 403) — ` +
            `HLS signed URL may have expired`,
          );

          if (http403Count >= HTTP_403_THRESHOLD) {
            http403RestartScheduled = true;

            // ── Cloud / CI IP-restriction detection ──────────────────────────
            // YouTube frequently range-blocks cloud provider IP addresses at the
            // segment level.  When running in CI / cloud, a 403 restart loop is
            // expected and a distinct warning helps operators distinguish "URL
            // expired" (fixable by re-extraction) from "IP blocked" (requires a
            // residential IP or proxy).  We still continue retrying — if the IP
            // is blocked, consecutive failures will eventually hit maxConsecutive-
            // Failures and escalate; we do NOT treat it as permanent here.
            const inCi = !!(
              process.env.GITHUB_ACTIONS ||
              process.env.CI ||
              process.env.CLOUD_RUN_SERVICE ||
              process.env.AWS_LAMBDA_FUNCTION_NAME ||
              process.env.KUBERNETES_SERVICE_HOST
            );
            if (inCi) {
              this._warn(
                `[relay] HTTP 403 in cloud/CI environment ` +
                `(${process.env.GITHUB_ACTIONS ? "GitHub Actions" : "CI/cloud"} detected) — ` +
                `YouTube frequently range-blocks cloud provider IP addresses. ` +
                `Segment-level 403s from a cloud IP may not be fixable by re-extraction alone. ` +
                `Consider a residential proxy, VPN with home IP, or a non-cloud host.`,
              );
            }

            this._warn(
              `[relay] ${http403Count} HTTP 403 errors in ` +
              `${Math.round((now - http403FirstAt) / 1000)}s — ` +
              `terminating stale yt-dlp session and forcing fresh HLS URL extraction (no backoff)`,
            );

            if (this.proc === thisProc && !this.stopped) {
              // Null proc BEFORE kill so the exit handler sees proc !== thisProc
              // and bails without scheduling a competing _scheduleRetry().
              this.proc = null;
              if (this._currentProc === thisProc) {
                this._currentProc = null;
                this._stdinDraining = false;
              }
              this._kill(thisProc);
              // Bypass exponential backoff — the source is still live, we just
              // need a fresh signed URL. _scheduleImmediate403Retry() does NOT
              // increment consecutiveFailures so a URL-expiry cycle cannot drain
              // the retry budget.
              this._scheduleImmediate403Retry();
            }
          }
        }
      }
    });

    // ── process error (e.g. ENOENT after spawn) ───────────────────────────────
    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(startupWatchdog);
      if (this.proc !== thisProc || this.stopped) return;
      this.proc = null;
      if (this._currentProc === thisProc) {
        this._currentProc = null;
        this._stdinDraining = false;
      }

      if (err.code === "ENOENT") {
        this._fatal(
          `[relay] "${cmd}" not found. ` +
          `Install with: pip install ${cmd === "streamlink" ? "streamlink" : "yt-dlp"}`,
        );
      } else {
        this._warn(`[relay] Process error: ${err.message}`);
        this._scheduleRetry();
      }
    });

    // ── process exit ──────────────────────────────────────────────────────────
    proc.on("exit", (code, signal) => {
      clearTimeout(startupWatchdog);
      if (this.proc !== thisProc || this.stopped) return;
      this.proc = null;
      // Clear current proc reference and draining state — the drain listener in
      // start() will be a no-op for this dead process. _stdinDraining=false ensures
      // the next spawn starts with a clean backpressure state even if the previous
      // proc exited mid-drain before its drain event could fire.
      if (this._currentProc === thisProc) {
        this._currentProc = null;
        this._stdinDraining = false;
      }

      const uptimeSec = Math.round((Date.now() - spawnedAt) / 1000);
      const kbRelayed = Math.round(sessionBytes / 1024);

      // ── Config error detection: fail permanently, do NOT retry ────────────
      // Exit code 2 is argparse's standard exit for unrecognized arguments.
      // Retrying an invalid command is pointless and wastes the retry budget.
      if (isConfigError(code, stderrFull)) {
        // Find the most useful error line from stderr
        const errorLine = stderrFull
          .split("\n")
          .map((l) => l.trim())
          .find((l) => /error|unrecognized/i.test(l)) ?? stderrFull.trim().slice(0, 200);
        this._fatal(
          `[relay] Configuration error (exit ${code}) — stopping retries.\n` +
          `  Command: ${cmd} ${args.join(" ")}\n` +
          `  Error: ${errorLine}\n` +
          `  Fix: check that the flags above are valid for your installed streamlink version.`,
        );
        return;
      }

      // ── Network / source failure: retry with backoff ───────────────────────
      if (gotData) {
        this._warn(
          `[relay:${this.sourceType}] Source exited after ${uptimeSec}s ` +
          `(${kbRelayed} KB relayed, code=${code}, signal=${signal}) — reconnecting`,
        );
      } else {
        this._warn(
          `[relay:${this.sourceType}] Source exited before sending data ` +
          `(code=${code}, signal=${signal}, uptime=${uptimeSec}s) — will retry`,
        );
      }

      this._scheduleRetry();
    });
  }

  // ── Retry scheduling (network/source failures only) ────────────────────────

  private _scheduleRetry(): void {
    if (this.stopped || this.permanentlyFailed) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.consecutiveFailures++;
    this.totalRestarts++;

    // ── Auto-reconnect disabled by the user for this stream ──────────────────
    if (!this.autoReconnect) {
      this._fatal("[relay] Source failed — auto-reconnect is disabled for this stream. Restart manually.");
      return;
    }

    // ── Failure budget: give up only after sustained, repeated failures ──────
    // maxConsecutiveFailures defaults to 999 (see DEFAULT_MAX_CONSECUTIVE_FAILURES)
    // so transient outages/rate-limits never give up — only a truly dead source
    // (offline for the entire backoff-capped retry window) reaches this branch.
    if (this.consecutiveFailures > this.maxConsecutiveFailures) {
      this._fatal(
        `[relay] Source failed ${this.consecutiveFailures} times in a row — ` +
        `giving up. Restart the stream manually.`,
      );
      return;
    }

    // ── Time budget: give up after maxReconnectMs of continuous retrying ─────
    // Marks the start of the current failure streak on the first failure, then
    // fails permanently once the streak has run longer than the configured
    // per-stream limit. Reset to null whenever data flows again (see stdout
    // handler), so each new outage gets a fresh time budget.
    if (this.maxReconnectMs != null) {
      if (this._reconnectStreakStartedAt == null) {
        this._reconnectStreakStartedAt = Date.now();
      } else if (Date.now() - this._reconnectStreakStartedAt > this.maxReconnectMs) {
        this._fatal(
          `[relay] Source has not recovered after ${Math.round(this.maxReconnectMs / 60_000)} minute(s) ` +
          `of retrying — giving up. Restart the stream manually.`,
        );
        return;
      }
    }

    if (this.consecutiveFailures === WARN_AFTER_FAILURES) {
      this._warn(
        `[relay] ${this.consecutiveFailures} consecutive failures — source may be offline. ` +
        `Still auto-reconnecting in the background.`,
      );
    }

    // ── Exponential backoff with jitter ───────────────────────────────────────
    const baseDelay = BACKOFF_MS[Math.min(this.consecutiveFailures - 1, BACKOFF_MS.length - 1)];
    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1); // ±10%
    const delay = Math.max(250, Math.round(baseDelay + jitter));

    this._warn(
      `[relay] Source failed (consecutive=${this.consecutiveFailures}) — ` +
      `auto-reconnecting in ${Math.round(delay / 1000)}s`,
    );
    this._setStatus("reconnecting");

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopped || this.permanentlyFailed) return;
      this._spawn().catch((err) => {
        this._warn(`[relay] Unexpected spawn error during auto-reconnect: ${err?.message ?? err}`);
      });
    }, delay);
  }

  // ── Immediate 403 retry (YouTube HLS URL expiry) ──────────────────────────

  /**
   * Schedule an immediate re-spawn to force fresh HLS URL extraction.
   *
   * Called when repeated HTTP 403 errors on HLS segments indicate that
   * YouTube's signed CDN URLs have expired mid-stream.  This is fundamentally
   * different from a genuine network failure:
   *
   *  - The source stream IS still live.
   *  - yt-dlp simply needs a new session to obtain fresh signed URLs.
   *  - Applying exponential backoff would delay re-extraction by 1–60 s for
   *    no benefit — the fresh URLs are available immediately after a new
   *    yt-dlp session re-extracts the manifest.
   *
   * Key differences vs _scheduleRetry():
   *  ✗ Does NOT increment consecutiveFailures — URL expiry is not a source
   *    failure, and accumulating failures would drain the retry budget.
   *  ✓ Uses HTTP_403_RETRY_DELAY_MS (500 ms) instead of exponential backoff.
   *  ✓ Increments totalRestarts for observability.
   *  ✓ Still respects stopped / permanentlyFailed guards.
   */
  private _scheduleImmediate403Retry(): void {
    if (this.stopped || this.permanentlyFailed) return;

    // Cancel any existing retry timer — if a competing path (startup watchdog,
    // exit handler) already scheduled one, replace it with the 403 fast-path.
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }

    this._consecutive403Restarts++;

    // ── Guardrail: escalate persistent 403s to normal backoff ────────────────
    // A genuine signed-URL expiry resolves within the next spawn: data flows,
    // and _consecutive403Restarts resets to 0 in the stdout handler.
    // If we reach MAX_CONSECUTIVE_403_RESTARTS restarts without any data, the
    // 403 is not URL-expiry (could be geo-block, auth failure, private stream).
    // Hand off to _scheduleRetry() so it increments consecutiveFailures and
    // the failure budget drives eventual escalation to "failed".
    if (this._consecutive403Restarts > MAX_CONSECUTIVE_403_RESTARTS) {
      this._warn(
        `[relay] ${this._consecutive403Restarts} consecutive 403 restarts without data — ` +
        `not a URL-expiry issue. Escalating to normal backoff (failure budget applies).`,
      );
      this._scheduleRetry();
      return;
    }

    this.totalRestarts++;
    // NOTE: consecutiveFailures intentionally NOT incremented here.
    // URL expiry is a transient CDN state, not a source connectivity failure.

    this.reconnectStartedAt = Date.now();
    this.recoveryDeadline = this.reconnectStartedAt + RECOVERY_DEADLINE_MS;
    this._setStatus("reconnecting");

    this._log(
      `[relay] Immediate re-extraction scheduled in ${HTTP_403_RETRY_DELAY_MS}ms ` +
      `(403 URL-expiry recovery — consecutiveFailures=${this.consecutiveFailures} unchanged)`,
    );

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped && !this.permanentlyFailed) {
        this._spawn().catch((err) => {
          this._warn(`[relay] Unexpected spawn error after 403 recovery: ${err?.message ?? err}`);
          this._scheduleRetry();
        });
      }
    }, HTTP_403_RETRY_DELAY_MS);
  }

  // ── Health monitoring ───────────────────────────────────────────────────────

  private _startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      if (this.stopped) return;
      const now = Date.now();
      const elapsedSec = (now - this.lastHealthAt) / 1000;
      const bytesDelta = this.bytesRelayed - this.lastByteSnapshot;
      const kbps = elapsedSec > 0 ? Math.round((bytesDelta * 8) / 1000 / elapsedSec) : 0;

      this.lastByteSnapshot = this.bytesRelayed;
      this.lastHealthAt = now;

      this.onEvent({
        type: "health",
        bytesRelayed: this.bytesRelayed,
        kbps,
        consecutiveFailures: this.consecutiveFailures,
        totalRestarts: this.totalRestarts,
        status: this.status,
      });

      // ── Mid-stream data stall detection ──────────────────────────────────────
      // Checks whether the source process is running but has stopped sending data.
      // This catches the case where streamlink/yt-dlp keeps its process alive but
      // the CDN connection has silently stalled (no EOF, no error — just no bytes).
      //
      // The startup watchdog (STARTUP_TIMEOUT_MS) only fires before the first byte
      // arrives.  Once gotData=true inside _spawn() that watchdog is cleared, so
      // mid-stream hangs go undetected without this check.
      //
      // Action: kill the hung process and call _scheduleRetry() so the relay
      // re-extracts a fresh stream URL and resumes piping to FFmpeg stdin — without
      // touching FFmpeg stdin itself (no .end()), preserving the RTMP session.
      if (
        this.status === "running" &&
        !this.permanentlyFailed &&
        this.lastDataReceivedAt !== null
      ) {
        const silentMs = now - this.lastDataReceivedAt;
        if (silentMs >= MID_STREAM_STALL_MS) {
          this._warn(
            `[relay] Mid-stream data stall — no bytes for ${Math.round(silentMs / 1000)}s ` +
            `(source process alive but sending nothing). Killing and re-extracting...`,
          );
          // Null lastDataReceivedAt before kill so the next spawn begins with a
          // clean slate and doesn't immediately re-fire the stall handler.
          this.lastDataReceivedAt = null;
          // Null proc BEFORE kill so the exit handler sees proc !== stuckProc
          // and bails without scheduling a competing _scheduleRetry().
          const stuckProc = this.proc;
          this.proc = null;
          if (this._currentProc === stuckProc) {
            this._currentProc = null;
            this._stdinDraining = false;
          }
          this._kill(stuckProc);
          this._scheduleRetry();
        }
      }
    }, HEALTH_INTERVAL_MS);
  }
}
