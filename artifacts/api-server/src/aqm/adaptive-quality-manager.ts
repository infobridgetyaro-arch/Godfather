/**
 * AdaptiveQualityManager — Production-grade adaptive encoder decision engine
 *
 * Responsibilities:
 *  • Monitor FFmpeg pipeline metrics (speed, fps, cpu, memory, drops)
 *  • Classify bottlenecks with per-subsystem confidence scores
 *  • Apply progressive quality degradations when performance is sustained-poor
 *  • Prevent oscillation with hysteresis, cooldowns, and oscillation dampener
 *  • Restore quality one stage at a time on sustained recovery
 *  • Emit structured AQM dashboard logs every 20s
 *  • Expose health score (0–100) and full snapshot for the UI
 *
 * Quality Ladder (all changes require FFmpeg restart — CBR x264 constraint):
 *  Stage 0 — original quality (nominal)
 *  Stage 1 — bitrate −15%                         (60s window — most seamless)
 *  Stage 2 — bitrate −25% + fps step              (30s window)
 *  Stage 3 — resolution step-down + bitrate       (30s window)
 *  Stage 4 — fps step 2 at reduced resolution     (30s window)
 *  Stage 5 — resolution step 2 + min fps          (30s window)
 */

import { RollingWindow } from "./rolling-window.js";
import { BottleneckAnalyzer } from "./bottleneck-analyzer.js";
import { PipelineProfiler } from "./pipeline-profiler.js";
import type {
  OriginalQualityParams,
  AQMOverride,
  AQMSample,
  AQMDecision,
  AQMSnapshot,
  AQMPhase,
  AQMMode,
  AdaptationType,
  BottleneckScore,
} from "./types.js";

// ── Stage ladder ──────────────────────────────────────────────────────────────

interface StageSpec {
  stage: number;
  label: string;
  bitrateMultiplier: number;
  fpsReduction: number;
  resolutionSteps: number;
  adaptationType: AdaptationType;
  monitorWindowMs: number;
  cooldownMs: number;
}

const STAGE_LADDER: StageSpec[] = [
  {
    stage: 1,
    label: "Bitrate −15%",
    bitrateMultiplier: 0.85,
    fpsReduction: 0,
    resolutionSteps: 0,
    adaptationType: "bitrate_restart",
    monitorWindowMs: 20_000,   // 20s — fast first response; lavfi queue grows ~13 MB/s at 0.83× so
                               // 60s allowed ~780 MB to accumulate before action; 20s caps it to ~260 MB.
    cooldownMs: 90_000,
  },
  {
    stage: 2,
    label: "Bitrate −25% + FPS step",
    bitrateMultiplier: 0.75,
    fpsReduction: 1,           // one fps ladder step
    resolutionSteps: 0,
    adaptationType: "fps_restart",
    monitorWindowMs: 30_000,
    cooldownMs: 120_000,
  },
  {
    stage: 3,
    label: "Resolution step-down",
    bitrateMultiplier: 0.60,
    fpsReduction: 1,
    resolutionSteps: 1,
    adaptationType: "resolution_restart",
    monitorWindowMs: 30_000,
    cooldownMs: 180_000,
  },
  {
    stage: 4,
    label: "FPS step 2 at reduced res",
    bitrateMultiplier: 0.50,
    fpsReduction: 2,
    resolutionSteps: 1,
    adaptationType: "fps_restart",
    monitorWindowMs: 30_000,
    cooldownMs: 180_000,
  },
  {
    stage: 5,
    label: "Resolution step 2 + min fps",
    bitrateMultiplier: 0.40,
    fpsReduction: 3,
    resolutionSteps: 2,
    adaptationType: "resolution_restart",
    monitorWindowMs: 30_000,
    cooldownMs: 240_000,
  },
];

const MAX_STAGE = STAGE_LADDER.length;

// ── Speed thresholds ──────────────────────────────────────────────────────────

const SPEED_FLOOR          = 0.90;   // below this → start monitoring (Marginal zone)
const SPEED_SEVERE         = 0.80;   // Critical zone — shorten monitor window to 20s
const SPEED_CRITICAL       = 0.70;   // Deep critical — shorten monitor window to 15s
const SPEED_RECOVERY       = 1.05;   // must sustain Excellent to attempt restore
const SPEED_NOMINAL        = 0.95;   // above this (Healthy) → return to nominal phase

const RECOVERY_HOLD_MS     = 3 * 60_000;    // 3 min hold before restoring stage

// ── Oscillation guard ─────────────────────────────────────────────────────────
const OSCILLATION_WINDOW_MS  = 10 * 60_000;
const MAX_DEGRADES_IN_WINDOW = 3;
const OSCILLATION_LOCK_MS    = 5 * 60_000;

// ── Dashboard interval ────────────────────────────────────────────────────────
const DASHBOARD_INTERVAL_MS = 20_000;

// ── FPS / resolution helpers ──────────────────────────────────────────────────

const FPS_LADDER   = [15, 20, 25, 30, 60];
const FPS_LADDER60 = [15, 20, 25, 30, 60];

function stepFps(fps: number, steps: number): number {
  const ladder = fps >= 60 ? FPS_LADDER60 : [15, 20, 25, 30];
  const idx = ladder.indexOf(fps);
  if (idx < 0) return Math.max(15, fps - 5 * steps);
  return ladder[Math.max(0, idx - steps)];
}

function stepResolution(
  w: number,
  h: number,
  steps: number,
  isVertical: boolean,
): { w: number; h: number } {
  if (steps === 0) return { w, h };
  const portrait  = [{ w: 1080, h: 1920 }, { w: 720, h: 1280 }, { w: 480, h: 854 }];
  const landscape = [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }, { w: 854, h: 480 }];
  const ladder = isVertical ? portrait : landscape;
  let idx = ladder.findIndex((r) => r.w === w && r.h === h);
  if (idx < 0) idx = 0;
  const newIdx = Math.min(ladder.length - 1, idx + steps);
  return ladder[newIdx];
}

function bitrateFor(w: number, h: number, fps: number): number {
  const px = w * h;
  const is60 = fps >= 60;
  if (px >= 1_900_000) return is60 ? 6000 : 4500;
  if (px >= 900_000)  return is60 ? 3500 : 2500;
  return is60 ? 2000 : 1500;
}

// ── History entry ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  ts: number;
  action: string;
  stage: number;
  adaptationType: AdaptationType;
}

// ── AdaptiveQualityManager ─────────────────────────────────────────────────────

export class AdaptiveQualityManager {
  readonly streamId: string;
  readonly original: OriginalQualityParams;

  // mode — "auto" allows adaptive degradation; force_* locks to a fixed resolution
  private mode: AQMMode = "auto";

  // state
  private phase: AQMPhase = "nominal";
  private currentStage = 0;

  // profiler + analyzer
  private profiler = new PipelineProfiler();
  private analyzer = new BottleneckAnalyzer();

  // timing
  private monitorStartAt: number | null = null;
  private lastDegradeAt = 0;
  private recoveryHoldStart: number | null = null;
  private lastDashboardAt = 0;

  // oscillation guard
  private degradeTimestamps: number[] = [];
  private oscillationLockedUntil = 0;

  // human-readable state descriptions for dashboard
  private lastActionDesc = "None — stream just started";
  private nextActionDesc = "Monitoring encoder speed";
  private recoveryTimerDesc = "Inactive";

  private history: HistoryEntry[] = [];

  constructor(streamId: string, original: OriginalQualityParams) {
    this.streamId = streamId;
    this.original = { ...original };
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  feed(sample: AQMSample): AQMDecision {
    const logLines: string[] = [];
    let dashboardLog: string | undefined;

    // When the source relay is reconnecting, speed=0 is expected — suppress all decisions
    if (sample.relayStalled) {
      if (this.phase === "monitoring") {
        this.monitorStartAt = null;
        this.phase = "nominal";
        logLines.push("[AQM] Relay reconnecting — monitoring timer reset (speed=0 expected)");
      }
      return this.noOp(logLines);
    }

    // Feed profiler with all available signals
    this.profiler.feed({
      speed:        sample.speed,
      fps:          sample.fps,
      bitrateKbps:  sample.bitrateKbps,
      cpuPct:       sample.cpuPct,
      memMb:        sample.memMb,
      droppedFrames: sample.droppedFrames,
    });

    if (sample.reconnectCount !== undefined) {
      this.analyzer.setReconnectCount(sample.reconnectCount);
    }

    const metrics   = this.profiler.getMetrics();
    const bottlenecks = this.analyzer.analyze(metrics);
    const primary   = bottlenecks[0] ?? null;
    const now       = Date.now();

    // ── Dashboard log ─────────────────────────────────────────────────────
    if (now - this.lastDashboardAt >= DASHBOARD_INTERVAL_MS) {
      this.lastDashboardAt = now;
      dashboardLog = this.profiler.formatDashboard({
        phase: this.phase,
        stage: this.currentStage,
        maxStage: MAX_STAGE,
        bottlenecks,
        primaryBottleneck: primary,
        override: this.getCurrentOverride(),
        original: this.original,
        lastActionDesc: this.lastActionDesc,
        nextActionDesc: this.nextActionDesc,
        recoveryTimer: this.recoveryTimerDesc,
      });
    }

    // Require a few samples before making any decisions
    if (metrics.sampleCount < 3) {
      return this.noOp(logLines, dashboardLog);
    }

    // ── Force mode: skip all degradation, only collect metrics for display ─────
    if (this.mode !== "auto") {
      return this.noOp(logLines, dashboardLog);
    }

    const speed30s = metrics.speed30s;

    // ── Phase: cooldown ───────────────────────────────────────────────────
    if (this.phase === "cooldown") {
      const stageIdx = this.currentStage - 1;
      const cooldown = stageIdx >= 0 && stageIdx < STAGE_LADDER.length
        ? STAGE_LADDER[stageIdx].cooldownMs
        : 120_000;
      const elapsed = now - this.lastDegradeAt;
      const remainSec = Math.ceil((cooldown - elapsed) / 1000);

      if (elapsed < cooldown) {
        // Still in cooldown — only interrupt for critical speed during later stages
        if (speed30s < SPEED_CRITICAL && this.currentStage < MAX_STAGE && elapsed > 15_000) {
          logLines.push(
            `[AQM] Critical speed ${speed30s.toFixed(2)}x during cooldown ` +
            `(${remainSec}s remain) — escalating to Stage ${this.currentStage + 1}`,
          );
          return this.degrade(metrics, bottlenecks, logLines, dashboardLog, now);
        }
        this.nextActionDesc = `Stage ${this.currentStage + 1} possible after cooldown (${remainSec}s remaining)`;
        return this.noOp(logLines, dashboardLog);
      }

      // Cooldown elapsed — transition
      if (speed30s >= SPEED_NOMINAL) {
        this.phase = "nominal";
        this.nextActionDesc = "No action planned — speed nominal";
      } else {
        this.phase = "nominal";  // re-enter nominal to re-start monitoring
      }
    }

    // ── Recovery path ─────────────────────────────────────────────────────
    if (this.currentStage > 0) {
      if (speed30s >= SPEED_RECOVERY) {
        if (this.recoveryHoldStart === null) {
          this.recoveryHoldStart = now;
          const holdSec = Math.ceil(RECOVERY_HOLD_MS / 1000);
          this.recoveryTimerDesc = `${holdSec}s hold required at ≥ ${SPEED_RECOVERY}x`;
          this.nextActionDesc = `Restore Stage ${this.currentStage - 1} after ${holdSec}s at ≥ ${SPEED_RECOVERY}x`;
          logLines.push(
            `[AQM] Speed recovered to ${speed30s.toFixed(2)}x — ` +
            `starting ${holdSec}s hold before restoring Stage ${this.currentStage - 1}`,
          );
        } else {
          const elapsed = now - this.recoveryHoldStart;
          const remainSec = Math.ceil((RECOVERY_HOLD_MS - elapsed) / 1000);
          if (elapsed >= RECOVERY_HOLD_MS) {
            return this.restore(metrics, bottlenecks, logLines, dashboardLog, now);
          }
          this.recoveryTimerDesc = `${remainSec}s remaining until Stage ${this.currentStage - 1}`;
        }
      } else {
        if (this.recoveryHoldStart !== null) {
          logLines.push(
            `[AQM] Speed dropped to ${speed30s.toFixed(2)}x — recovery hold cancelled`,
          );
          this.recoveryHoldStart = null;
          this.recoveryTimerDesc = "Inactive (speed dropped)";
        }
      }
    }

    // ── Degradation path ──────────────────────────────────────────────────
    if (this.currentStage >= MAX_STAGE) {
      this.nextActionDesc = "At maximum degradation (Stage 5)";
      return this.noOp(logLines, dashboardLog);
    }

    // Speed must reach SPEED_NOMINAL (Healthy, ≥0.95) to cancel an active monitoring
    // window, or SPEED_FLOOR (Marginal boundary, ≥0.90) to stay in nominal with no
    // window open.  This prevents the Stable zone (0.90–0.94) from silently dropping
    // monitoring that was already started.
    if (speed30s >= SPEED_NOMINAL) {
      if (this.monitorStartAt !== null) {
        this.monitorStartAt = null;
        this.phase = "nominal";
        this.nextActionDesc = "No action planned — speed nominal";
      }
      return this.noOp(logLines, dashboardLog);
    }

    if (speed30s >= SPEED_FLOOR && this.monitorStartAt === null) {
      // Stable zone (0.90–0.94) with no active window — stay in nominal, nothing to do
      return this.noOp(logLines, dashboardLog);
    }

    // Speed is below SPEED_FLOOR (or in Stable with an active window) — oscillation guard
    if (now < this.oscillationLockedUntil) {
      const lockSec = Math.ceil((this.oscillationLockedUntil - now) / 1000);
      this.nextActionDesc = `Oscillation guard: locked for ${lockSec}s`;
      return this.noOp(logLines, dashboardLog);
    }

    // Determine effective monitoring window based on severity
    const spec = STAGE_LADDER[this.currentStage];
    let windowMs = spec.monitorWindowMs;
    if (speed30s < SPEED_CRITICAL) windowMs = Math.min(windowMs, 15_000);
    else if (speed30s < SPEED_SEVERE) windowMs = Math.min(windowMs, 20_000);

    if (this.monitorStartAt === null) {
      this.monitorStartAt = now;
      this.phase = "monitoring";
      const sec = Math.ceil(windowMs / 1000);
      const bottleneckLabel = primary ? `${primary.label} at ${primary.confidence}%` : "??";
      this.nextActionDesc = `${spec.label} in ${sec}s if speed stays < ${SPEED_FLOOR}x`;
      logLines.push(
        `[AQM] Speed ${speed30s.toFixed(2)}x below ${SPEED_FLOOR}x — starting ${sec}s window ` +
        `| bottleneck: ${bottleneckLabel} | cpu: ${metrics.cpuPct.toFixed(0)}%`,
      );
      return this.noOp(logLines, dashboardLog);
    }

    const elapsed = now - this.monitorStartAt;

    // Speed improved since window started → cancel (hysteresis)
    if (metrics.speed10s > speed30s + 0.05) {
      logLines.push(
        `[AQM] Speed improving ${speed30s.toFixed(2)}x→${metrics.speed10s.toFixed(2)}x (10s) — degrade cancelled`,
      );
      this.monitorStartAt = null;
      this.phase = "nominal";
      this.nextActionDesc = "Speed improving — monitoring cancelled";
      return this.noOp(logLines, dashboardLog);
    }

    const remainSec = Math.ceil((windowMs - elapsed) / 1000);
    if (elapsed < windowMs) {
      this.nextActionDesc = `${spec.label} in ${remainSec}s (speed: ${speed30s.toFixed(2)}x)`;
      return this.noOp(logLines, dashboardLog);
    }

    // Window elapsed — degrade
    return this.degrade(metrics, bottlenecks, logLines, dashboardLog, now);
  }

  // ── Private: apply degradation ────────────────────────────────────────────

  private degrade(
    metrics: ReturnType<PipelineProfiler["getMetrics"]>,
    bottlenecks: BottleneckScore[],
    logLines: string[],
    dashboardLog: string | undefined,
    now: number,
  ): AQMDecision {
    const stageIdx = this.currentStage;
    if (stageIdx >= STAGE_LADDER.length) return this.noOp(logLines, dashboardLog);

    const spec      = STAGE_LADDER[stageIdx];
    const nextStage = this.currentStage + 1;
    const primary   = bottlenecks[0] ?? null;

    // Compute new params
    const newBitrate = Math.round(this.original.bitrateKbps * spec.bitrateMultiplier);
    const newFps     = stepFps(this.original.fps, spec.fpsReduction);
    const newRes     = stepResolution(
      this.original.scaleW,
      this.original.scaleH,
      spec.resolutionSteps,
      this.original.isVertical,
    );

    // Previous params for changelog
    const prevBitrate = this.currentStage === 0
      ? this.original.bitrateKbps
      : Math.round(this.original.bitrateKbps * STAGE_LADDER[this.currentStage - 1].bitrateMultiplier);
    const prevFps = this.currentStage === 0
      ? this.original.fps
      : stepFps(this.original.fps, STAGE_LADDER[this.currentStage - 1].fpsReduction);
    const prevRes = this.currentStage === 0
      ? { w: this.original.scaleW, h: this.original.scaleH }
      : stepResolution(
          this.original.scaleW,
          this.original.scaleH,
          STAGE_LADDER[this.currentStage - 1].resolutionSteps,
          this.original.isVertical,
        );

    const changes: string[] = [];
    if (newBitrate !== prevBitrate) {
      const pct = Math.round((1 - newBitrate / prevBitrate) * 100);
      changes.push(`Bitrate ${prevBitrate}k → ${newBitrate}k (−${pct}%)`);
    }
    if (newFps !== prevFps) changes.push(`FPS ${prevFps} → ${newFps}`);
    if (newRes.w !== prevRes.w) changes.push(`Resolution ${prevRes.w}×${prevRes.h} → ${newRes.w}×${newRes.h}`);

    this.currentStage = nextStage;
    this.phase        = "cooldown";
    this.lastDegradeAt = now;
    this.monitorStartAt = null;
    this.recoveryHoldStart = null;
    this.recoveryTimerDesc = "Inactive";

    // Oscillation guard bookkeeping
    this.degradeTimestamps.push(now);
    const cutoff = now - OSCILLATION_WINDOW_MS;
    this.degradeTimestamps = this.degradeTimestamps.filter((t) => t > cutoff);
    if (this.degradeTimestamps.length >= MAX_DEGRADES_IN_WINDOW) {
      this.oscillationLockedUntil = now + OSCILLATION_LOCK_MS;
      const lockMin = (OSCILLATION_LOCK_MS / 60_000).toFixed(0);
      logLines.push(
        `[AQM] Oscillation dampener: ${this.degradeTimestamps.length} degrades in last ` +
        `${OSCILLATION_WINDOW_MS / 60_000}min — locking degradation for ${lockMin}min`,
      );
    }

    const bottleneckTag = primary
      ? ` | bottleneck: ${primary.label} (${primary.confidence}%)`
      : "";
    const actionDesc = `Stage 0→${nextStage} — ${spec.label}: ${changes.join(", ")}`;
    this.lastActionDesc = `Stage ${nextStage}: ${changes.join(", ")}`;
    this.nextActionDesc = nextStage < MAX_STAGE
      ? `Stage ${nextStage + 1} if speed remains below ${SPEED_FLOOR}x after cooldown`
      : "At maximum degradation — no further action";

    logLines.push(
      `[AQM] ── Stage ${nextStage}: ${spec.label} ──────────────────────────────────────`,
    );
    logLines.push(
      `[AQM] Speed: ${metrics.speed30s.toFixed(2)}x (30s) | CPU: ${metrics.cpuPct.toFixed(0)}%` +
      ` | Mem: ${metrics.memMb}MB${bottleneckTag}`,
    );
    for (const c of changes) logLines.push(`[AQM] ↓ ${c}`);
    logLines.push(
      `[AQM] Adaptation: ${this.adapterNote(spec.adaptationType)} — restarting encoder`,
    );

    const coolSec = Math.ceil(spec.cooldownMs / 1000);
    logLines.push(`[AQM] Cooldown: ${coolSec}s stabilization window follows`);

    this.history.push({
      ts: now,
      action: actionDesc,
      stage: nextStage,
      adaptationType: spec.adaptationType,
    });
    if (this.history.length > 20) this.history.splice(0, this.history.length - 20);

    return {
      shouldRestart: true,
      adaptationType: spec.adaptationType,
      logLines,
      dashboardLog,
    };
  }

  // ── Private: apply recovery ────────────────────────────────────────────────

  private restore(
    metrics: ReturnType<PipelineProfiler["getMetrics"]>,
    bottlenecks: BottleneckScore[],
    logLines: string[],
    dashboardLog: string | undefined,
    now: number,
  ): AQMDecision {
    const prevStage  = this.currentStage;
    const targetStage = prevStage - 1;

    this.currentStage    = targetStage;
    this.phase           = "cooldown";
    this.lastDegradeAt   = now;
    this.recoveryHoldStart = null;
    this.recoveryTimerDesc = "Inactive";

    const qualityTag = targetStage === 0 ? "original quality" : `Stage ${targetStage}`;
    const actionDesc = `Recovery: Stage ${prevStage} → Stage ${targetStage} — restored to ${qualityTag}`;
    this.lastActionDesc  = actionDesc;
    this.nextActionDesc  = targetStage > 0
      ? `Continue recovery to Stage ${targetStage - 1} after ${Math.ceil(RECOVERY_HOLD_MS / 1000)}s hold`
      : "Fully recovered — monitoring for further improvements";

    logLines.push(`[AQM] ↑ Recovery: Stage ${prevStage} → Stage ${targetStage} — ${qualityTag}`);
    logLines.push(
      `[AQM] Speed held ${SPEED_RECOVERY}x+ for ${Math.ceil(RECOVERY_HOLD_MS / 1000)}s — ` +
      `encoder performance stable`,
    );

    this.history.push({
      ts: now,
      action: actionDesc,
      stage: targetStage,
      adaptationType: "recovery",
    });
    if (this.history.length > 20) this.history.splice(0, this.history.length - 20);

    return {
      shouldRestart: true,
      adaptationType: "recovery",
      logLines,
      dashboardLog,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private noOp(logLines: string[], dashboardLog?: string): AQMDecision {
    return { shouldRestart: false, adaptationType: "none", logLines, dashboardLog };
  }

  private adapterNote(t: AdaptationType): string {
    switch (t) {
      case "bitrate_restart":    return "bitrate-only (CBR requires restart)";
      case "fps_restart":        return "FPS + bitrate change";
      case "resolution_restart": return "resolution + FPS + bitrate change";
      case "full_restart":       return "full parameter change";
      case "recovery":           return "quality restoration";
      default:                   return "parameter change";
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getCurrentOverride(): AQMOverride | null {
    if (this.currentStage === 0) return null;
    const stageIdx = this.currentStage - 1;
    if (stageIdx >= STAGE_LADDER.length) return null;
    const spec = STAGE_LADDER[stageIdx];
    const newFps = stepFps(this.original.fps, spec.fpsReduction);
    const newRes = stepResolution(
      this.original.scaleW,
      this.original.scaleH,
      spec.resolutionSteps,
      this.original.isVertical,
    );
    return {
      bitrateKbps: Math.round(this.original.bitrateKbps * spec.bitrateMultiplier),
      fps:         newFps,
      scaleW:      newRes.w,
      scaleH:      newRes.h,
      preset:      this.original.encoderPreset,
      stage:       this.currentStage,
    };
  }

  getSnapshot(): AQMSnapshot {
    const metrics     = this.profiler.getMetrics();
    const bottlenecks = this.analyzer.analyze(metrics);
    const healthScore = this.profiler.computeHealthScore(metrics);
    return {
      phase:             this.phase,
      stage:             this.currentStage,
      maxStage:          MAX_STAGE,
      mode:              this.mode,
      bottlenecks,
      primaryBottleneck: bottlenecks[0] ?? null,
      metrics,
      healthScore,
      override:          this.getCurrentOverride(),
      original:          { ...this.original },
      history:           this.history.slice(),
    };
  }

  // Legacy getSnapshot fields consumed by existing stream-manager telemetry broadcast
  getSnapshotLegacy(): {
    phase: AQMPhase;
    stage: number;
    bottleneck: string | null;
    override: AQMOverride | null;
  } {
    const snap = this.getSnapshot();
    return {
      phase:      snap.phase,
      stage:      snap.stage,
      bottleneck: snap.primaryBottleneck?.subsystem ?? null,
      override:   snap.override,
    };
  }

  /** Set the operating mode. "auto" enables adaptive degradation; force_* locks resolution. */
  setMode(mode: AQMMode): void {
    this.mode = mode;
    if (mode !== "auto") {
      // Reset any ongoing degradation when switching to forced mode
      this.currentStage      = 0;
      this.phase             = "nominal";
      this.monitorStartAt    = null;
      this.recoveryHoldStart = null;
      this.degradeTimestamps = [];
      this.oscillationLockedUntil = 0;
      this.lastActionDesc    = `Forced mode: ${mode}`;
      this.nextActionDesc    = "No adaptive changes — forced resolution active";
      this.recoveryTimerDesc = "Inactive";
    }
  }

  getMode(): AQMMode {
    return this.mode;
  }

  resetToOriginal(): void {
    this.currentStage      = 0;
    this.phase             = "nominal";
    this.monitorStartAt    = null;
    this.lastDegradeAt     = 0;
    this.recoveryHoldStart = null;
    this.degradeTimestamps = [];
    this.oscillationLockedUntil = 0;
    this.lastActionDesc    = "Reset to original quality";
    this.nextActionDesc    = "Monitoring encoder speed";
    this.recoveryTimerDesc = "Inactive";
  }

  /** Legacy alias kept for compatibility with stream-manager callers */
  reset(): void {
    this.resetToOriginal();
    this.profiler.reset();
  }
}
