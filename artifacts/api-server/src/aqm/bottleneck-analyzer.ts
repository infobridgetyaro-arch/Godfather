/**
 * BottleneckAnalyzer — Confidence-based pipeline bottleneck detection
 *
 * Evaluates each subsystem independently using observable signals from FFmpeg
 * and the host process. Each subsystem produces a 0–100 confidence score.
 * The primary bottleneck is the highest-confidence subsystem.
 *
 * Never reports "unknown" — falls back to "cpu_encoder" at minimum confidence.
 */

import type { BottleneckScore, BottleneckSubsystem, PipelineMetrics } from "./types.js";

// ── Overlay complexity hints ───────────────────────────────────────────────────
// Stream-manager populates this via setOverlayHints() so the analyzer knows
// how many expensive features are active.
export interface OverlayHints {
  newsTickerActive: boolean;
  chatBurnActive: boolean;
  statsOverlayActive: boolean;
  subscriberOverlayActive: boolean;
  adBannerActive: boolean;
  breakActive: boolean;
  gradientActive: boolean;
}

const DEFAULT_HINTS: OverlayHints = {
  newsTickerActive: false,
  chatBurnActive: false,
  statsOverlayActive: false,
  subscriberOverlayActive: false,
  adBannerActive: false,
  breakActive: false,
  gradientActive: true,
};

// ── Analyzer ──────────────────────────────────────────────────────────────────

export class BottleneckAnalyzer {
  private hints: OverlayHints = { ...DEFAULT_HINTS };
  private lastRtmpReconnects = 0;

  setOverlayHints(h: Partial<OverlayHints>): void {
    this.hints = { ...this.hints, ...h };
  }

  setReconnectCount(n: number): void {
    this.lastRtmpReconnects = n;
  }

  analyze(metrics: PipelineMetrics): BottleneckScore[] {
    const scores: BottleneckScore[] = [
      this.scoreCpuEncoder(metrics),
      this.scoreFilterGraph(metrics),
      this.scoreOverlayRender(metrics),
      this.scoreScaling(metrics),
      this.scoreNetwork(metrics),
      this.scoreInputStarvation(metrics),
      this.scoreMemory(metrics),
      this.scoreDecoder(metrics),
      this.scoreAudio(metrics),
    ];

    scores.sort((a, b) => b.confidence - a.confidence);

    if (scores[0].confidence === 0) {
      scores[0] = this.fallbackCpuEncoder(metrics);
    }

    return scores;
  }

  // ── CPU Encoder Overload ────────────────────────────────────────────────────
  private scoreCpuEncoder(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "cpu_encoder";
    const evidence: string[] = [];
    let score = 0;

    const speed = m.speed30s;
    const cpu = m.cpuPct;

    if (speed < 0.85) {
      score += 35;
      evidence.push(`Speed ${speed.toFixed(2)}x below 0.85x threshold`);
    }
    if (speed < 0.75) {
      score += 20;
      evidence.push(`Speed critically low (${speed.toFixed(2)}x)`);
    }
    if (cpu > 65) {
      score += 20;
      evidence.push(`CPU ${cpu.toFixed(0)}% exceeds 65% threshold`);
    }
    if (cpu > 80) {
      score += 15;
      evidence.push(`CPU ${cpu.toFixed(0)}% critically high`);
    }
    if (cpu > 90) {
      score += 10;
      evidence.push(`CPU ${cpu.toFixed(0)}% near saturation`);
    }
    if (m.speedTrend === "degrading") {
      score += 10;
      evidence.push("Speed trend: degrading");
    }

    if (speed >= 0.95 && cpu >= 80) {
      score = Math.max(0, score - 25);
      evidence.push("Speed near-normal despite high CPU — encoder keeping up");
    }

    return {
      label: "CPU Encoder Overload",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Filter Graph Overload ───────────────────────────────────────────────────
  private scoreFilterGraph(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "filter_graph";
    const evidence: string[] = [];
    let score = 0;

    const speed = m.speed30s;
    const cpu = m.cpuPct;

    const overlayCount =
      (this.hints.newsTickerActive ? 1 : 0) +
      (this.hints.chatBurnActive ? 1 : 0) +
      (this.hints.statsOverlayActive ? 1 : 0) +
      (this.hints.subscriberOverlayActive ? 1 : 0) +
      (this.hints.adBannerActive ? 1 : 0) +
      (this.hints.breakActive ? 1 : 0);

    if (speed < 0.85 && overlayCount >= 2) {
      score += 30;
      evidence.push(`${overlayCount} overlay layers active — high filter complexity`);
    }
    if (speed < 0.85 && overlayCount >= 3) {
      score += 20;
      evidence.push("3+ concurrent overlays — significant filter graph load");
    }
    if (speed < 0.85 && cpu > 75) {
      score += 20;
      evidence.push("High CPU with filter graph — possible filter bottleneck");
    }
    if (this.hints.chatBurnActive && this.hints.newsTickerActive) {
      score += 15;
      evidence.push("Chat burn + news ticker require per-frame text rasterization");
    }
    if (this.hints.breakActive && this.hints.gradientActive) {
      score += 10;
      evidence.push("Break decoder + gradient both active — dual video decode");
    }

    if (overlayCount === 0) score = 0;

    return {
      label: "Filter Graph Overload",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Overlay Rendering ───────────────────────────────────────────────────────
  private scoreOverlayRender(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "overlay_render";
    const evidence: string[] = [];
    let score = 0;

    const animatedCount =
      (this.hints.newsTickerActive ? 1 : 0) +
      (this.hints.chatBurnActive ? 1 : 0) +
      (this.hints.statsOverlayActive ? 1 : 0);

    if (animatedCount >= 2 && m.speed30s < 0.90) {
      score += 25;
      evidence.push(`${animatedCount} animated overlays at 25fps — CPU canvas rendering`);
    }
    if (this.hints.chatBurnActive && m.cpuPct > 60) {
      score += 20;
      evidence.push("Chat burn-in with per-frame text layout and alpha blending");
    }
    if (this.hints.newsTickerActive && m.cpuPct > 55) {
      score += 15;
      evidence.push("News ticker active — animated scroll requires frequent redraws");
    }
    if (animatedCount === 0) score = 0;

    return {
      label: "Overlay Rendering",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Scaling ─────────────────────────────────────────────────────────────────
  private scoreScaling(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "scaling";
    const evidence: string[] = [];
    let score = 0;

    if (m.speed30s < 0.85 && m.cpuPct > 50) {
      score += 15;
      evidence.push("Potential scale filter contribution at high resolution");
    }

    return {
      label: "Scaling",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Network Congestion ──────────────────────────────────────────────────────
  private scoreNetwork(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "network";
    const evidence: string[] = [];
    let score = 0;

    const bitrateRatio = m.bitrate30s > 0
      ? m.bitrate30s / Math.max(m.bitrate30s, 1500)
      : 1.0;

    if (m.speed30s >= 0.92 && m.dropRate30s > 0.5) {
      score += 40;
      evidence.push(`Drop rate ${m.dropRate30s.toFixed(1)}/s with normal speed — network drops`);
    }
    if (m.speed30s >= 0.90 && bitrateRatio < 0.70) {
      score += 35;
      evidence.push("Bitrate well below target despite healthy speed — network throttle");
    }
    if (this.lastRtmpReconnects >= 3) {
      score += 30;
      evidence.push(`${this.lastRtmpReconnects} RTMP reconnects — unstable upload connection`);
    }
    if (this.lastRtmpReconnects >= 1 && m.speed30s >= 0.88) {
      score += 20;
      evidence.push("RTMP reconnects with acceptable speed — likely network issue");
    }

    return {
      label: "Network Congestion",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Input Starvation ────────────────────────────────────────────────────────
  private scoreInputStarvation(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "input_starvation";
    const evidence: string[] = [];
    let score = 0;

    if (m.fps30s < 10 && m.cpuPct < 50) {
      score += 50;
      evidence.push(`FPS ${m.fps30s.toFixed(1)} very low with low CPU — source not producing frames`);
    }
    if (m.fps30s > 0 && m.fps30s < 15 && m.speed30s > 0.95) {
      score += 35;
      evidence.push("Encoder waiting for frames — source is the bottleneck");
    }
    if (m.fps10s < m.fps30s * 0.5 && m.fps30s > 0) {
      score += 25;
      evidence.push("Sudden FPS drop — source starvation or relay hiccup");
    }

    return {
      label: "Input Starvation",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Memory Pressure ─────────────────────────────────────────────────────────
  private scoreMemory(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "memory";
    const evidence: string[] = [];
    let score = 0;

    if (m.memMb > 3000) {
      score += 50;
      evidence.push(`Memory ${m.memMb}MB exceeds 3GB — heavy memory pressure`);
    } else if (m.memMb > 2000) {
      score += 30;
      evidence.push(`Memory ${m.memMb}MB elevated — approaching pressure zone`);
    } else if (m.memMb > 1500) {
      score += 15;
      evidence.push(`Memory ${m.memMb}MB moderate usage`);
    }

    if (m.memMb > 2000 && m.speed30s < 0.85) {
      score += 25;
      evidence.push("High memory with slow speed — possible swap pressure");
    }

    return {
      label: "Memory Pressure",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Decoder Overload ────────────────────────────────────────────────────────
  private scoreDecoder(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "decoder";
    const evidence: string[] = [];
    let score = 0;

    if (m.fps10s < m.fps30s * 0.7 && m.cpuPct > 60) {
      score += 20;
      evidence.push("FPS drop with high CPU — possible decoder contention");
    }
    if (this.hints.breakActive) {
      score += 10;
      evidence.push("Break decoder running alongside main decoder");
    }

    return {
      label: "Decoder Overload",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Audio Processing ────────────────────────────────────────────────────────
  private scoreAudio(m: PipelineMetrics): BottleneckScore {
    const subsystem: BottleneckSubsystem = "audio";
    const evidence: string[] = [];
    let score = 0;

    if (m.cpuPct > 50 && m.speed30s < 0.90) {
      score += 5;
      evidence.push("Audio processing contributes marginally at high CPU loads");
    }

    return {
      label: "Audio Processing",
      subsystem,
      confidence: Math.min(100, Math.max(0, score)),
      evidence,
    };
  }

  // ── Fallback ─────────────────────────────────────────────────────────────────
  private fallbackCpuEncoder(m: PipelineMetrics): BottleneckScore {
    return {
      label: "CPU Encoder Overload",
      subsystem: "cpu_encoder",
      confidence: 10,
      evidence: [`Speed ${m.speed30s.toFixed(2)}x — defaulting to encoder as likely cause`],
    };
  }
}
