/**
 * Output Manager — Independent RTMP output management
 *
 * Tracks the health of each RTMP destination independently.
 * Failure of one output triggers a targeted reconnect attempt without
 * stopping delivery to healthy outputs.
 *
 * In the current FFmpeg tee-muxer architecture, all outputs share one
 * encoder process — the manager tracks failure state so the caller
 * can decide to do a clean restart (re-establishing all RTMP sessions)
 * vs. waiting for tee to recover a single output.
 */

import { logger } from "../lib/logger";
import { eventBus } from "../engine/event-bus";
import type { StreamConfig } from "../schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutputDestination {
  label: string;
  rtmpUrl: string;
  failedAt: number | null;
  recoveredAt: number | null;
  failCount: number;
}

// ── Build output list from stream config ─────────────────────────────────────

export function buildOutputList(stream: StreamConfig): OutputDestination[] {
  const outputs: OutputDestination[] = [];

  if (stream.youtubeStreamKey) {
    outputs.push({
      label: "YouTube",
      rtmpUrl: `rtmp://a.rtmp.youtube.com/live2/${stream.youtubeStreamKey}`,
      failedAt: null, recoveredAt: null, failCount: 0,
    });
  }
  if (stream.facebookRtmpUrl) {
    outputs.push({
      label: "Facebook",
      rtmpUrl: `rtmps://live-api-s.facebook.com:443/rtmp/${stream.facebookRtmpUrl}`,
      failedAt: null, recoveredAt: null, failCount: 0,
    });
  }
  if (stream.instagramStreamKey) {
    outputs.push({
      label: "Instagram",
      rtmpUrl: `rtmps://live-upload.instagram.com:443/live/${stream.instagramStreamKey}`,
      failedAt: null, recoveredAt: null, failCount: 0,
    });
  }
  if (stream.tiktokStreamKey) {
    outputs.push({
      label: "TikTok",
      rtmpUrl: `rtmp://push.tiktokv.com/live/${stream.tiktokStreamKey}`,
      failedAt: null, recoveredAt: null, failCount: 0,
    });
  }

  return outputs;
}

export function getRtmpUrls(outputs: OutputDestination[]): string[] {
  return outputs.map((o) => o.rtmpUrl);
}

// ── Failure tracking ──────────────────────────────────────────────────────────

export class OutputTracker {
  private outputs: Map<string, OutputDestination> = new Map();
  private readonly streamId: string;

  constructor(streamId: string, destinations: OutputDestination[]) {
    this.streamId = streamId;
    for (const dest of destinations) {
      this.outputs.set(dest.rtmpUrl, { ...dest });
    }
  }

  recordFailure(rtmpUrl: string, reason: string): void {
    const dest = this.findByUrl(rtmpUrl);
    if (!dest) return;
    dest.failedAt = Date.now();
    dest.failCount++;
    logger.warn({ streamId: this.streamId, label: dest.label, reason }, "[output] RTMP output failed");
    eventBus.emit("OUTPUT_FAILED", { streamId: this.streamId, destination: dest.label, reason });
  }

  recordRecovery(rtmpUrl: string): void {
    const dest = this.findByUrl(rtmpUrl);
    if (!dest) return;
    dest.recoveredAt = Date.now();
    dest.failedAt = null;
    logger.info({ streamId: this.streamId, label: dest.label }, "[output] RTMP output recovered");
    eventBus.emit("OUTPUT_RECOVERED", { streamId: this.streamId, destination: dest.label });
  }

  getFailedOutputs(): OutputDestination[] {
    return [...this.outputs.values()].filter((o) => o.failedAt !== null);
  }

  getAllOutputs(): OutputDestination[] {
    return [...this.outputs.values()];
  }

  hasAnyFailed(): boolean {
    return this.getFailedOutputs().length > 0;
  }

  private findByUrl(url: string): OutputDestination | undefined {
    for (const [, dest] of this.outputs) {
      if (dest.rtmpUrl === url) return dest;
    }
    return undefined;
  }
}
