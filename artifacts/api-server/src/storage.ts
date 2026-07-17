import { randomUUID } from "crypto";
import type { StreamConfig, InsertStream } from "./schema";

export interface IStorage {
  getStreams(): StreamConfig[];
  getStream(id: string): StreamConfig | undefined;
  createStream(data: InsertStream): StreamConfig;
  updateStream(id: string, data: Partial<StreamConfig>): StreamConfig | undefined;
  deleteStream(id: string): boolean;
}

export class MemStorage implements IStorage {
  protected streams: Map<string, StreamConfig> = new Map();

  getStreams(): StreamConfig[] {
    return Array.from(this.streams.values());
  }

  getStream(id: string): StreamConfig | undefined {
    return this.streams.get(id);
  }

  createStream(data: InsertStream): StreamConfig {
    const id = randomUUID();
    return this._buildAndStore(id, data);
  }

  /**
   * Create a stream with a specific ID (used when restoring from Redis/DB).
   * Does not overwrite an existing stream with the same ID.
   */
  createStreamWithId(stream: StreamConfig): void {
    if (!this.streams.has(stream.id)) {
      this.streams.set(stream.id, stream);
    }
  }

  updateStream(id: string, data: Partial<StreamConfig>): StreamConfig | undefined {
    const stream = this.streams.get(id);
    if (!stream) return undefined;
    const normalized = { ...data };
    if (typeof normalized.tiktokUsername === "string") {
      normalized.tiktokUsername = normalized.tiktokUsername.replace(/^@+/, "").trim();
    }
    const updated = { ...stream, ...normalized, id };
    this.streams.set(id, updated);
    return updated;
  }

  deleteStream(id: string): boolean {
    return this.streams.delete(id);
  }

  protected _buildAndStore(id: string, data: InsertStream): StreamConfig {
    const stream: StreamConfig = {
      id,
      sourceType: data.sourceType || "tiktok",
      tiktokUsername: (data.tiktokUsername || "").replace(/^@+/, "").trim(),
      youtubeSourceUrl: data.youtubeSourceUrl || "",
      facebookSourceUrl: data.facebookSourceUrl || "",
      linkSourceUrl: (data as any).linkSourceUrl || "",
      cameraDevice: data.cameraDevice || "/dev/video0",
      xspaceUrl: data.xspaceUrl || "",
      xspaceImageUrl: data.xspaceImageUrl || "",
      xspaceVideoPath: data.xspaceVideoPath || "",
      uploadedVideoPath: data.uploadedVideoPath || "",
      uploadedVideoLoop: data.uploadedVideoLoop ?? true,
      youtubeStreamKey: data.youtubeStreamKey || "",
      facebookRtmpUrl: data.facebookRtmpUrl || "",
      instagramStreamKey: data.instagramStreamKey || "",
      tiktokStreamKey: data.tiktokStreamKey || "",
      youtubeChannelId: data.youtubeChannelId || "",
      ratio: data.ratio || "mobile",
      quality: data.quality || "best",
      aqmMode: (data as any).aqmMode || "auto",
      fps: data.fps || "30",
      muted: data.muted ?? false,
      autoRestart: data.autoRestart ?? false,
      micEnabled: data.micEnabled ?? false,
      micDevice: data.micDevice || "",
      encoderPreset: (data as any).encoderPreset || "veryfast",
      autoReconnect: data.autoReconnect ?? true,
      maxReconnectMinutes: data.maxReconnectMinutes ?? null,
      status: "idle",
    };
    this.streams.set(id, stream);
    return stream;
  }
}

export const storage = new MemStorage();
