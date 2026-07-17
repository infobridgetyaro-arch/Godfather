/**
 * FallbackPipeManager — RTMP Session Keepalive via Fallback Scene Injection
 *
 * Sits transparently between SourceRelay and the main FFmpeg process stdin.
 * When the real source (streamlink / yt-dlp) stops producing data — due to
 * a network drop, platform hiccup, or reconnect backoff — the main FFmpeg
 * would ordinarily block on stdin, produce no frames, and trigger the
 * rw_timeout on the RTMP output, causing Facebook/Instagram to end the live.
 *
 * This class prevents that by detecting the data gap and immediately injecting
 * a fallback MPEG-TS scene (black screen + "Reconnecting..." overlay) into
 * the main FFmpeg stdin so encoding continues uninterrupted.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 *  SourceRelay  →  FallbackPipeManager.proxyStdin  →  realStdin (FFmpeg pipe:0)
 *                         ↑ if source silent for FALLBACK_TRIGGER_MS:
 *  FallbackFFmpeg ─────────┘  (black frame + "Reconnecting..." MPEG-TS)
 *
 * ── Transitions ──────────────────────────────────────────────────────────────
 *  real data flowing  →  pass-through mode  →  main FFmpeg encodes live source
 *  source silent 3s   →  fallback active    →  fallback FFmpeg feeds main FFmpeg
 *  source resumes     →  stabilize 1.5s     →  pass-through mode restored
 *
 * ── Timestamp continuity ─────────────────────────────────────────────────────
 *  The main FFmpeg's -fps_mode cfr and aresample=async=8000 absorb the
 *  timestamp discontinuity when switching between real MPEG-TS and fallback
 *  MPEG-TS, exactly as they do for normal SourceRelay reconnects.
 *  The RTMP connection is never closed — Facebook/Instagram never see a gap.
 *
 * ── Backpressure ─────────────────────────────────────────────────────────────
 *  realStdin drain events are forwarded to proxyStdin so SourceRelay's
 *  stdout pause/resume mechanism works correctly with no changes to SourceRelay.
 */

import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import { logger } from "../lib/logger";

/** How long after the last real source byte before fallback starts (ms). */
const FALLBACK_TRIGGER_MS = 3_000;

/**
 * Stabilization window after real data returns before cutting the fallback (ms).
 * Avoids rapid toggling if the source reconnects and immediately hiccups again.
 */
const FALLBACK_STOP_DELAY_MS = 1_500;

export interface FallbackPipeOptions {
  streamId: string;
  /** Output video width (matches main encoder canvas). */
  width: number;
  /** Output video height (matches main encoder canvas). */
  height: number;
  /** Output frames per second (matches main encoder). */
  fps: number;
  /** Called once when fallback scene first becomes active (source dropped). */
  onFallbackActive?: () => void;
  /** Called once when fallback scene is deactivated (source restored). */
  onFallbackInactive?: () => void;
}

// ── ProxyWritable ─────────────────────────────────────────────────────────────

/**
 * Minimal WritableStream duck-type that SourceRelay writes to.
 * Delegates actual I/O to FallbackPipeManager._onSourceWrite() so the manager
 * can decide whether to pass data through or silently drop it during fallback.
 * Extends EventEmitter so on('drain') / removeListener('drain') work natively.
 */
class ProxyWritable extends EventEmitter {
  constructor(private readonly mgr: FallbackPipeManager) {
    super();
    this.setMaxListeners(20);
  }

  write(chunk: Buffer): boolean {
    return this.mgr._onSourceWrite(chunk);
  }
}

// ── FallbackPipeManager ───────────────────────────────────────────────────────

export class FallbackPipeManager {
  private readonly streamId: string;
  private readonly realStdin: NodeJS.WritableStream;
  private readonly opts: FallbackPipeOptions;

  /** WritableStream proxy exposed to SourceRelay. */
  readonly proxyStdin: ProxyWritable;

  private stopped = false;
  private fallbackActive = false;
  private fallbackProc: ChildProcess | null = null;
  private lastRealDataAt: number = Date.now();
  private checkTimer: NodeJS.Timeout | null = null;
  private fallbackStopTimer: NodeJS.Timeout | null = null;

  /**
   * Set to true just before intentionally killing the fallback FFmpeg (source
   * recovered or stream stopped). The exit handler checks this flag to avoid
   * restarting the process — the root cause of the "fallback never stops" bug
   * was that _killFallback() nulled this.fallbackProc before the kill, making
   * the `this.fallbackProc !== proc` guard always evaluate to true (null !== proc).
   */
  private intentionalKill = false;

  /**
   * True while onFallbackActive has already been called for the current silence
   * episode. Prevents repeated calls to the callback when the fallback FFmpeg
   * process restarts internally (e.g. after a drawtext failure retry).
   */
  private callbackFired = false;

  /**
   * Consecutive unexpected-exit count for the fallback FFmpeg.
   * Resets to 0 when the fallback stops normally (source recovered).
   * If it reaches MAX_FALLBACK_CRASHES we give up rather than looping forever.
   */
  private fallbackCrashCount = 0;
  private static readonly MAX_FALLBACK_CRASHES = 5;

  /** Listener forwarding drain events from realStdin → proxyStdin. */
  private _forwardDrain: (() => void) | null = null;

  constructor(realStdin: NodeJS.WritableStream, opts: FallbackPipeOptions) {
    this.realStdin = realStdin;
    this.opts = opts;
    this.streamId = opts.streamId;
    this.proxyStdin = new ProxyWritable(this);

    // Forward drain events so SourceRelay's backpressure mechanism works.
    this._forwardDrain = () => { this.proxyStdin.emit("drain"); };
    (realStdin as any).on?.("drain", this._forwardDrain);
  }

  /** Begin monitoring data flow and activating fallback on silence. */
  start(): void {
    if (this.stopped) return;
    this.lastRealDataAt = Date.now();
    this.checkTimer = setInterval(() => this._check(), 1_000);
    logger.debug({ streamId: this.streamId }, "[fallback-pipe] Monitor started");
  }

  /** Permanently stop: kill fallback FFmpeg and remove all listeners. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
    if (this.fallbackStopTimer) { clearTimeout(this.fallbackStopTimer); this.fallbackStopTimer = null; }
    if (this._forwardDrain) {
      try { (this.realStdin as any).removeListener?.("drain", this._forwardDrain); } catch {}
      this._forwardDrain = null;
    }
    this._killFallback();
    logger.debug({ streamId: this.streamId }, "[fallback-pipe] Stopped");
  }

  /** True when a fallback scene is currently being injected. */
  isFallbackActive(): boolean { return this.fallbackActive; }

  // ── Called by ProxyWritable ─────────────────────────────────────────────────

  /** @internal — called by ProxyWritable.write(); do not call directly. */
  _onSourceWrite(chunk: Buffer): boolean {
    this.lastRealDataAt = Date.now();

    if (this.fallbackActive) {
      // Source has resumed — schedule deactivation of fallback.
      this._scheduleStopFallback();
      // Drop this chunk while transitioning to avoid interleaving the two streams.
      return true;
    }

    // Normal pass-through.
    return (this.realStdin as any).write?.(chunk) ?? true;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _check(): void {
    if (this.stopped || this.fallbackActive) return;
    const silentMs = Date.now() - this.lastRealDataAt;
    if (silentMs >= FALLBACK_TRIGGER_MS) {
      this._activateFallback(true /* tryText */);
    }
  }

  /**
   * Start the fallback FFmpeg process.
   * @param tryText - attempt to render "Reconnecting..." text overlay.
   *   Falls back to a plain black frame if the drawtext filter fails.
   */
  private _activateFallback(tryText: boolean): void {
    if (this.fallbackActive || this.stopped) return;
    this.fallbackActive = true;
    this.lastRealDataAt = Date.now(); // prevent _check from re-triggering immediately

    // Fire onFallbackActive exactly once per source-silence episode, not once
    // per FFmpeg process spawn (the process may restart internally on retry).
    if (!this.callbackFired) {
      this.callbackFired = true;
      const { width, height, fps } = this.opts;
      logger.info(
        { streamId: this.streamId, width, height, fps, tryText },
        "[fallback-pipe] Source silent — activating fallback scene (RTMP kept alive)",
      );
      this.opts.onFallbackActive?.();
    }

    const { width, height, fps } = this.opts;
    const fontSize = Math.max(24, Math.round(Math.min(width, height) / 20));
    const boxPad   = Math.max(8, Math.round(fontSize / 3));

    const vfArgs: string[] = ["format=yuv420p"];
    if (tryText) {
      vfArgs.unshift(
        `drawtext=text='Reconnecting...':x=(w-tw)/2:y=(h-th)/2-${fontSize}:` +
        `fontsize=${fontSize}:fontcolor=white@0.9:` +
        `box=1:boxcolor=black@0.5:boxborderw=${boxPad}`,
      );
    }

    const args = [
      "-hide_banner", "-loglevel", "error",
      // Infinite black video
      "-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=${fps}`,
      // Infinite silence — anullsrc is the correct lavfi source (aevalsrc uses
      // different param names and would fail with exit 8 on 'r' option)
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-vf", vfArgs.join(","),
      // Low-CPU H.264 (stillimage: skips motion estimation on identical frames)
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "stillimage",
      "-b:v", "150k",
      "-r", String(fps),
      "-g", String(fps * 2),
      "-c:a", "aac",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "2",
      // MPEG-TS output matches streamlink/yt-dlp container format
      "-f", "mpegts",
      "pipe:1",
    ];

    const proc = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"], // pipe stderr so we can log failures
    });

    this.fallbackProc = proc;
    let producedAnyData = false;
    const stderrLines: string[] = [];

    proc.stdout?.on("data", (chunk: Buffer) => {
      producedAnyData = true;
      if (!this.fallbackActive || this.stopped) return;
      try { (this.realStdin as any).write(chunk); } catch {}
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) stderrLines.push(line);
      // Keep only the last 5 lines to avoid unbounded growth
      if (stderrLines.length > 5) stderrLines.splice(0, stderrLines.length - 5);
    });

    proc.on("error", (err: Error) => {
      logger.warn(
        { streamId: this.streamId, err: err.message },
        "[fallback-pipe] Fallback FFmpeg spawn error",
      );
    });

    proc.on("exit", (code, signal) => {
      // Intentional kill (source recovered or stream stopped) — do not restart.
      if (this.intentionalKill) {
        this.intentionalKill = false;
        return;
      }

      // Superseded by a newer proc instance — ignore.
      if (this.fallbackProc !== proc) return;
      this.fallbackProc = null;

      if (!this.fallbackActive || this.stopped) return;

      // If text rendering caused the failure (no data produced), retry without it.
      if (tryText && !producedAnyData) {
        logger.warn(
          { streamId: this.streamId, code, stderr: stderrLines.join(" | ") },
          "[fallback-pipe] Text fallback failed — retrying with plain black frame",
        );
        this.fallbackActive = false;
        this.fallbackCrashCount = 0; // text→plain is not a crash, reset counter
        setTimeout(() => {
          if (!this.stopped && !this.fallbackActive) this._activateFallback(false);
        }, 100);
        return;
      }

      // Unexpected exit — apply circuit breaker before restarting.
      this.fallbackCrashCount++;
      if (this.fallbackCrashCount >= FallbackPipeManager.MAX_FALLBACK_CRASHES) {
        logger.error(
          { streamId: this.streamId, code, signal, crashes: this.fallbackCrashCount, stderr: stderrLines.join(" | ") },
          "[fallback-pipe] Fallback FFmpeg crashed too many times — giving up to protect main stream",
        );
        // Deactivate cleanly so the main stream is not disrupted further.
        this.fallbackActive = false;
        this.callbackFired = false;
        this.fallbackCrashCount = 0;
        return;
      }

      logger.warn(
        { streamId: this.streamId, code, signal, crash: this.fallbackCrashCount, stderr: stderrLines.join(" | ") },
        "[fallback-pipe] Fallback FFmpeg exited unexpectedly — restarting",
      );
      this.fallbackActive = false;
      // Exponential backoff: 200ms, 400ms, 800ms, 1600ms…
      const delay = Math.min(200 * Math.pow(2, this.fallbackCrashCount - 1), 5_000);
      setTimeout(() => {
        if (!this.stopped && !this.fallbackActive) this._activateFallback(false);
      }, delay);
    });
  }

  private _scheduleStopFallback(): void {
    if (this.fallbackStopTimer) return; // already scheduled
    this.fallbackStopTimer = setTimeout(() => {
      this.fallbackStopTimer = null;
      this._killFallback();
      this.fallbackActive = false;
      // Reset so onFallbackActive fires again if the source drops a second time.
      this.callbackFired = false;
      this.fallbackCrashCount = 0;
      logger.info(
        { streamId: this.streamId },
        "[fallback-pipe] Source restored — returning to live feed",
      );
      this.opts.onFallbackInactive?.();
    }, FALLBACK_STOP_DELAY_MS);
  }

  private _killFallback(): void {
    if (this.fallbackStopTimer) {
      clearTimeout(this.fallbackStopTimer);
      this.fallbackStopTimer = null;
    }
    const proc = this.fallbackProc;
    this.fallbackProc = null;
    if (proc) {
      // Signal the exit handler not to restart before killing.
      this.intentionalKill = true;
      try { proc.kill("SIGKILL"); } catch {}
    }
  }
}
