export type AQMMode =
  | "auto"
  | "force_4k"
  | "force_1440p"
  | "force_1080p"
  | "force_720p"
  | "force_540p"
  | "force_480p"
  | "force_360p"
  | "force_240p";

export interface OriginalQualityParams {
  bitrateKbps: number;
  fps: number;
  scaleW: number;
  scaleH: number;
  quality: string;
  isVertical: boolean;
  encoderPreset: string;
}

export interface AQMOverride {
  bitrateKbps: number;
  fps: number;
  scaleW: number;
  scaleH: number;
  preset: string;
  stage: number;
}

export interface AQMSample {
  speed: number;
  fps?: number;
  bitrateKbps?: number;
  targetBitrateKbps?: number;
  droppedFrames?: number;
  cpuPct?: number;
  memMb?: number;
  relayStalled?: boolean;
  reconnectCount?: number;
}

// ── Bottleneck subsystems ─────────────────────────────────────────────────────

export type BottleneckSubsystem =
  | "cpu_encoder"
  | "filter_graph"
  | "overlay_render"
  | "scaling"
  | "network"
  | "input_starvation"
  | "memory"
  | "decoder"
  | "audio";

export interface BottleneckScore {
  label: string;
  subsystem: BottleneckSubsystem;
  confidence: number;  // 0–100
  evidence: string[];  // human-readable reasoning
}

// ── Pipeline metrics ──────────────────────────────────────────────────────────

export type SpeedTrend = "improving" | "stable" | "degrading";

export interface PipelineMetrics {
  speed10s: number;
  speed30s: number;
  speed60s: number;
  fps10s: number;
  fps30s: number;
  fps60s: number;
  bitrate30s: number;
  cpuPct: number;
  memMb: number;
  dropRate30s: number;  // drops per second over 30s window
  speedTrend: SpeedTrend;
  sampleCount: number;
}

// ── Adaptation type ───────────────────────────────────────────────────────────

export type AdaptationType =
  | "none"
  | "bitrate_restart"      // bitrate-only — CBR requires restart
  | "fps_restart"          // FPS reduction
  | "resolution_restart"   // resolution step-down
  | "full_restart"         // multiple params changed
  | "recovery";            // quality restoration

// ── AQM phase and decision ────────────────────────────────────────────────────

export type AQMPhase = "nominal" | "monitoring" | "cooldown" | "recovering";

export interface AQMDecision {
  shouldRestart: boolean;
  adaptationType: AdaptationType;
  logLines: string[];
  dashboardLog?: string;   // emitted every ~20s — full AQM status block
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface AQMSnapshot {
  phase: AQMPhase;
  stage: number;
  maxStage: number;
  mode: AQMMode;
  bottlenecks: BottleneckScore[];
  primaryBottleneck: BottleneckScore | null;
  metrics: PipelineMetrics;
  healthScore: number;
  override: AQMOverride | null;
  original: OriginalQualityParams;
  history: Array<{ ts: number; action: string; stage: number; adaptationType: AdaptationType }>;
}

// Legacy alias so existing callers that import AQMBottleneck still compile
export type AQMBottleneck = BottleneckSubsystem | "unknown";
