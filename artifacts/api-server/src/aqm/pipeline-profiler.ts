/**
 * PipelineProfiler — Rolling pipeline performance tracker
 *
 * Maintains 10s / 30s / 60s rolling averages for all observable pipeline
 * metrics (speed, fps, bitrate, drops, CPU, memory).
 *
 * Computes an overall pipeline health score (0–100) and generates the
 * structured AQM dashboard log block every call to formatDashboard().
 */

import { RollingWindow } from "./rolling-window.js";
import type { PipelineMetrics, AQMOverride, OriginalQualityParams, AQMPhase, BottleneckScore, AdaptationType } from "./types.js";

export interface DashboardState {
  phase: AQMPhase;
  stage: number;
  maxStage: number;
  bottlenecks: BottleneckScore[];
  primaryBottleneck: BottleneckScore | null;
  override: AQMOverride | null;
  original: OriginalQualityParams;
  lastActionDesc: string;
  nextActionDesc: string;
  recoveryTimer: string;
}

export class PipelineProfiler {
  private speedWindow = new RollingWindow(120_000);
  private fpsWindow   = new RollingWindow(120_000);
  private bitrateWindow = new RollingWindow(120_000);
  private dropWindow  = new RollingWindow(120_000);

  private lastCpuPct = 0;
  private lastMemMb  = 0;
  private lastDropTotal = 0;
  private dropRateBucket: Array<{ delta: number; ts: number }> = [];

  feed(sample: {
    speed: number;
    fps?: number;
    bitrateKbps?: number;
    cpuPct?: number;
    memMb?: number;
    droppedFrames?: number;
  }): void {
    if (sample.speed > 0) this.speedWindow.push(sample.speed);
    if (sample.fps !== undefined && sample.fps > 0) this.fpsWindow.push(sample.fps);
    if (sample.bitrateKbps !== undefined && sample.bitrateKbps > 0) this.bitrateWindow.push(sample.bitrateKbps);
    if (sample.cpuPct !== undefined) this.lastCpuPct = sample.cpuPct;
    if (sample.memMb !== undefined) this.lastMemMb = sample.memMb;

    if (sample.droppedFrames !== undefined) {
      const delta = Math.max(0, sample.droppedFrames - this.lastDropTotal);
      this.lastDropTotal = sample.droppedFrames;
      if (delta > 0) {
        const now = Date.now();
        this.dropRateBucket.push({ delta, ts: now });
        const cutoff = now - 30_000;
        this.dropRateBucket = this.dropRateBucket.filter((e) => e.ts >= cutoff);
      }
    }
  }

  getMetrics(): PipelineMetrics {
    const dropTotal = this.dropRateBucket.reduce((s, e) => s + e.delta, 0);
    const dropRate30s = dropTotal / 30;  // drops per second over 30s window

    return {
      speed10s:  this.speedWindow.average(10_000),
      speed30s:  this.speedWindow.average(30_000),
      speed60s:  this.speedWindow.average(60_000),
      fps10s:    this.fpsWindow.average(10_000),
      fps30s:    this.fpsWindow.average(30_000),
      fps60s:    this.fpsWindow.average(60_000),
      bitrate30s: this.bitrateWindow.average(30_000),
      cpuPct:    this.lastCpuPct,
      memMb:     this.lastMemMb,
      dropRate30s,
      speedTrend: this.speedWindow.trend(60_000),
      sampleCount: this.speedWindow.count(30_000),
    };
  }

  /**
   * Pipeline health score 0–100 based on observable encoder metrics.
   * Used for operator dashboards — separate from the stream health scorer
   * which tracks RTMP-level health.
   */
  computeHealthScore(metrics: PipelineMetrics): number {
    let score = 100;

    // Speed (50 pts)
    const speed = metrics.speed30s;
    if (speed < 0.70) score -= 50;
    else if (speed < 0.80) score -= 35;
    else if (speed < 0.90) score -= 20;
    else if (speed < 0.95) score -= 10;
    else if (speed < 1.00) score -= 5;

    // CPU (20 pts)
    const cpu = metrics.cpuPct;
    if (cpu > 90) score -= 20;
    else if (cpu > 80) score -= 12;
    else if (cpu > 70) score -= 6;
    else if (cpu > 60) score -= 2;

    // Memory (10 pts)
    const mem = metrics.memMb;
    if (mem > 3000) score -= 10;
    else if (mem > 2000) score -= 5;
    else if (mem > 1500) score -= 2;

    // Drop rate (10 pts)
    if (metrics.dropRate30s > 2.0) score -= 10;
    else if (metrics.dropRate30s > 1.0) score -= 6;
    else if (metrics.dropRate30s > 0.3) score -= 3;

    // Speed trend (10 pts)
    if (metrics.speedTrend === "degrading") score -= 10;
    else if (metrics.speedTrend === "improving") score += 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate the full AQM status dashboard log block.
   * Matches the specification format exactly.
   */
  formatDashboard(state: DashboardState): string {
    const m = this.getMetrics();
    const healthScore = this.computeHealthScore(m);

    const fmtPct = (v: number) => `${v.toFixed(0)}%`;
    const fmtSpeed = (v: number) => `${v.toFixed(2)}x`;
    const fmtFps = (v: number) => v > 0 ? `${v.toFixed(0)}` : "—";
    const bar = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

    // Subsystem health labels — 5-level encoder speed classification
    const encoderStatus =
      m.speed30s >= 1.05 ? "Excellent" :
      m.speed30s >= 0.95 ? "Healthy" :
      m.speed30s >= 0.90 ? "Stable" :
      m.speed30s >= 0.80 ? "Marginal" : "Critical";
    const decoderStatus = m.fps30s > 15 ? "Healthy" : "Slow";
    const networkStatus = state.bottlenecks.find(b => b.subsystem === "network" && b.confidence > 30)
      ? "Congested" : "Healthy";

    const filterLoad = state.bottlenecks.find(b => b.subsystem === "filter_graph");
    const scalingLoad = state.bottlenecks.find(b => b.subsystem === "scaling");
    const overlayLoad = state.bottlenecks.find(b => b.subsystem === "overlay_render");
    const audioLoad   = state.bottlenecks.find(b => b.subsystem === "audio");

    const primaryName = state.primaryBottleneck
      ? `${state.primaryBottleneck.label} (${state.primaryBottleneck.confidence}%)`
      : "None detected";

    const bitrateTag = state.override
      ? `${state.override.bitrateKbps}k (AQM Stage ${state.stage}/${state.maxStage})`
      : `${state.original.bitrateKbps}k (original)`;

    const lines: string[] = [
      bar,
      `AQM STATUS`,
      ``,
      `Input FPS:          ${fmtFps(m.fps10s)}`,
      `Output FPS:         ${fmtFps(m.fps30s)}`,
      `Encoder Speed:      ${fmtSpeed(m.speed30s)}`,
      ``,
      `CPU:                ${fmtPct(m.cpuPct)}`,
      `Memory:             ${m.memMb > 0 ? m.memMb + " MB" : "—"}`,
      `GPU:                0%`,
      ``,
      `Decoder:            ${decoderStatus}`,
      `Encoder:            ${encoderStatus}`,
      `Filters:            ${filterLoad ? fmtPct(filterLoad.confidence) : "0%"}`,
      `Scaling:            ${scalingLoad ? fmtPct(scalingLoad.confidence) : "0%"}`,
      `Overlays:           ${overlayLoad ? fmtPct(overlayLoad.confidence) : "0%"}`,
      `Audio:              ${audioLoad ? fmtPct(audioLoad.confidence) : "0%"}`,
      `Network:            ${networkStatus}`,
      ``,
      `Quality Stage:      ${state.stage}/${state.maxStage}`,
      `Active Bitrate:     ${bitrateTag}`,
      `Pipeline Health:    ${healthScore}/100`,
      ``,
    ];

    if (state.primaryBottleneck && state.primaryBottleneck.confidence > 10) {
      lines.push(`Detected Bottleneck:`);
      lines.push(`${primaryName}`);
      if (state.primaryBottleneck.evidence.length > 0) {
        lines.push(`Evidence: ${state.primaryBottleneck.evidence.slice(0, 2).join("; ")}`);
      }
      lines.push(``);
    }

    if (state.bottlenecks.length > 1) {
      lines.push(`Confidence Scores:`);
      for (const b of state.bottlenecks.slice(0, 6)) {
        const dots = ".".repeat(Math.max(1, 30 - b.label.length));
        lines.push(`${b.label} ${dots} ${b.confidence}%`);
      }
      lines.push(``);
    }

    lines.push(`Current Action:`);
    lines.push(state.lastActionDesc || "None — monitoring encoder performance");
    lines.push(``);
    lines.push(`Next Planned Action:`);
    lines.push(state.nextActionDesc || "No action planned — speed nominal");
    lines.push(``);
    lines.push(`Recovery Timer:`);
    lines.push(state.recoveryTimer);
    lines.push(bar);

    return lines.map((l) => `[AQM] ${l}`).join("\n");
  }

  reset(): void {
    this.speedWindow.clear();
    this.fpsWindow.clear();
    this.bitrateWindow.clear();
    this.dropWindow.clear();
    this.lastCpuPct = 0;
    this.lastMemMb  = 0;
    this.lastDropTotal = 0;
    this.dropRateBucket = [];
  }
}
