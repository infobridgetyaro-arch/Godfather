/**
 * Shared types for the streaming engine
 */

export type StreamStatus = "idle" | "streaming" | "error" | "reconnecting";

export type SourceType =
  | "tiktok"
  | "youtube"
  | "facebook"
  | "camera"
  | "xspace"
  | "upload"
  | "tiktok_pipe"
  | "youtube_pipe"
  | "facebook_pipe";

export type QualityPreset = "best" | "720p" | "480p";
export type RatioMode = "mobile" | "desktop";
export type EncoderPreset = "ultrafast" | "veryfast" | "faster" | "fast";

export interface StreamDimensions {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  bufsizeKbps: number;
}

export function getStreamDimensions(
  ratio: RatioMode,
  quality: QualityPreset,
  fps: number,
): StreamDimensions {
  const isVertical = ratio === "mobile";
  const isBest = quality === "best";
  const is720 = quality === "720p";

  const w = isVertical
    ? isBest ? 1080 : is720 ? 720 : 480
    : isBest ? 1920 : is720 ? 1280 : 854;

  const h = isVertical
    ? isBest ? 1920 : is720 ? 1280 : 854
    : isBest ? 1080 : is720 ? 720 : 480;

  const bitrateKbps = isBest ? 6000 : is720 ? 4000 : 2500;
  const bufsizeKbps = bitrateKbps * 2;

  return { width: w, height: h, fps, bitrateKbps, bufsizeKbps };
}

export interface ResolvedSource {
  url: string;
  sourceType: SourceType;
  resolvedAt: number;
}

export interface OutputConfig {
  label: string;
  rtmpUrl: string;
}
