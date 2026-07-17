/**
 * hls-encoder.ts — Adaptive Bitrate HLS encoder
 *
 * Manages a SEPARATE lightweight FFmpeg process per stream that reads from
 * the same source URL the RTMP encoder uses, and outputs multi-variant HLS
 * segments to disk. The HLS process is completely independent of the RTMP
 * pipeline — if HLS fails, RTMP continues unaffected.
 *
 * Segment output path: /tmp/hls/{streamId}/{variantName}/seg00001.ts
 * Master playlist:     /tmp/hls/{streamId}/master.m3u8
 *
 * When R2_ENDPOINT + CDN_BASE_URL are configured, HlsUploader watches the
 * segment directory and pushes every new file to Cloudflare R2 / S3.
 * Viewers then read from the CDN — the origin server never serves video.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "./lib/logger";
import {
  buildHlsOutputArgs,
  detectGpuAccel,
  LANDSCAPE_VARIANTS,
  PORTRAIT_VARIANTS,
  type GpuAccel,
} from "./ffmpeg-hls";
import { HlsUploader } from "./hls-uploader";
import type { StreamConfig } from "./schema";

interface HlsProcess {
  ffmpeg: ChildProcess;
  uploader?: HlsUploader;
  segmentDir: string;
  startedAt: number;
}

const activeHlsEncoders = new Map<string, HlsProcess>();
const HLS_BASE_DIR = process.env.HLS_SEGMENT_DIR || "/tmp/hls";

let cachedGpu: GpuAccel | undefined;

async function getGpu(): Promise<GpuAccel> {
  if (cachedGpu !== undefined) return cachedGpu;
  cachedGpu = await detectGpuAccel();
  if (cachedGpu) logger.info({ gpu: cachedGpu }, "[hls] GPU acceleration detected");
  else logger.info("[hls] No GPU detected — using libx264");
  return cachedGpu;
}

/**
 * Build the FFmpeg input arguments for the HLS encoder.
 * Mirrors the input section of buildFFmpegArgs() in stream-manager.ts but
 * simplified — HLS encoder does NOT need overlay pipes, mic pipes, or the
 * volume-control pipe. It just reads the source video+audio.
 */
function buildHlsInputArgs(
  inputUrl: string,
  sourceType: string,
  stream: StreamConfig,
): string[] {
  const args: string[] = ["-loglevel", "warning", "-stats"];
  const fps = parseInt(stream.fps || "30");

  if (sourceType === "camera" && inputUrl === "__browser__") {
    // Browser camera streams are not HLS-encodable (stdin pipe, single process)
    throw new Error("Browser camera source not supported for HLS output");
  }

  if (sourceType === "upload") {
    const shouldLoop = stream.uploadedVideoLoop !== false;
    if (shouldLoop) args.push("-stream_loop", "-1");
    args.push("-re", "-thread_queue_size", "4096", "-fflags", "+genpts", "-i", inputUrl);
    return args;
  }

  if (sourceType === "camera") {
    const isNetwork =
      inputUrl.startsWith("rtsp://") ||
      inputUrl.startsWith("rtsps://") ||
      inputUrl.startsWith("http://") ||
      inputUrl.startsWith("https://");
    if (isNetwork) {
      args.push(
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_on_network_error", "1",
        "-reconnect_delay_max", "5",
        "-rw_timeout", "10000000",
        "-thread_queue_size", "4096",
        "-i", inputUrl,
      );
    } else {
      args.push(
        "-f", "v4l2", "-framerate", String(fps),
        "-thread_queue_size", "4096",
        "-i", inputUrl,
      );
    }
    return args;
  }

  if (sourceType === "youtube") {
    args.push(
      "-headers", [
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept: */*",
        "Referer: https://www.youtube.com/",
      ].join("\r\n") + "\r\n",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_delay_max", "5",
      "-tls_verify", "0",
      "-rw_timeout", "10000000",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
    );
    return args;
  }

  // TikTok HLS (default)
  args.push(
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_on_network_error", "1",
    "-reconnect_at_eof", "1",
    "-reconnect_delay_max", "5",
    "-rw_timeout", "10000000",
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "-referer", "https://www.tiktok.com/",
    "-thread_queue_size", "4096",
    "-fflags", "+genpts+discardcorrupt",
    "-i", inputUrl,
  );
  return args;
}

/**
 * Start HLS encoding for a stream. Spawns a second lightweight FFmpeg process
 * that reads from the same source URL and writes multi-variant HLS to disk.
 * Also starts HlsUploader to push segments to R2/S3 if configured.
 */
export async function startHlsEncoder(
  streamId: string,
  inputUrl: string,
  sourceType: string,
  stream: StreamConfig,
): Promise<void> {
  // Stop any existing HLS encoder for this stream first
  stopHlsEncoder(streamId);

  const segmentDir = path.join(HLS_BASE_DIR, streamId);
  const isVertical = stream.ratio === "mobile";
  const fps = parseInt(stream.fps || "30");
  const segmentDuration = 4;   // 4s segments — standard HLS
  const playlistSize = 6;      // keep 6 segments in live playlist (~24s window)

  // Create variant subdirectories
  const variants = isVertical ? PORTRAIT_VARIANTS : LANDSCAPE_VARIANTS;
  fs.mkdirSync(segmentDir, { recursive: true });
  variants.forEach((v) => fs.mkdirSync(path.join(segmentDir, v.name), { recursive: true }));

  const gpuAccel = await getGpu();

  // Build input args
  let inputArgs: string[];
  try {
    inputArgs = buildHlsInputArgs(inputUrl, sourceType, stream);
  } catch (e: any) {
    logger.warn({ streamId, err: e.message }, "[hls] Cannot start encoder");
    return;
  }

  // Build output args
  const outputArgs = buildHlsOutputArgs(
    "0:v", "0:a",
    fps,
    { segmentDir, segmentDuration, playlistSize, variants, gpuAccel, isVertical },
  );

  const ffmpegArgs = [
    ...inputArgs,
    "-threads", "2",
    ...outputArgs,
  ];

  logger.info({ streamId, variants: variants.map((v) => v.name), gpu: gpuAccel || "cpu" }, "[hls] Starting encoder");

  const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let gotSegments = false;

  ffmpegProc.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (!line) return;
    if (line.startsWith("frame=") || line.startsWith("size=")) {
      if (!gotSegments) {
        gotSegments = true;
        logger.info({ streamId }, "[hls] Encoder producing frames");
      }
      return;
    }
    logger.warn({ streamId, ffmpeg: line }, "[hls] FFmpeg");
  });

  ffmpegProc.on("exit", (code, signal) => {
    logger.info({ streamId, code, signal }, "[hls] Encoder exited");
    const proc = activeHlsEncoders.get(streamId);
    if (proc?.ffmpeg === ffmpegProc) {
      proc.uploader?.stop();
      activeHlsEncoders.delete(streamId);
    }
  });

  ffmpegProc.on("error", (err) => {
    logger.error({ streamId, err: err.message }, "[hls] FFmpeg spawn error");
    activeHlsEncoders.delete(streamId);
  });

  // Start uploader if R2 is configured
  let uploader: HlsUploader | undefined;
  if (process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.CDN_BASE_URL) {
    uploader = new HlsUploader(streamId, segmentDir);
    uploader.start();
    logger.info({ streamId, url: uploader.masterPlaylistUrl() }, "[hls] CDN upload active");
  } else {
    logger.info({ streamId, local: `${segmentDir}/master.m3u8` }, "[hls] Local HLS only (no R2 configured)");
  }

  activeHlsEncoders.set(streamId, {
    ffmpeg: ffmpegProc,
    uploader,
    segmentDir,
    startedAt: Date.now(),
  });
}

/**
 * Stop HLS encoding and upload for a stream.
 */
export function stopHlsEncoder(streamId: string): void {
  const proc = activeHlsEncoders.get(streamId);
  if (!proc) return;

  proc.uploader?.stop();
  try { proc.ffmpeg.kill("SIGTERM"); } catch {}
  setTimeout(() => {
    try { proc.ffmpeg.kill("SIGKILL"); } catch {}
  }, 3000);

  activeHlsEncoders.delete(streamId);
  logger.info({ streamId }, "[hls] Encoder stopped");
}

/**
 * Get the CDN master playlist URL for a stream (if HLS is active).
 */
export function getHlsPlaylistUrl(streamId: string): string | null {
  const proc = activeHlsEncoders.get(streamId);
  if (!proc?.uploader) return null;
  return proc.uploader.masterPlaylistUrl();
}

/**
 * Get the local filesystem master playlist path for a stream.
 */
export function getLocalHlsPath(streamId: string): string | null {
  const proc = activeHlsEncoders.get(streamId);
  if (!proc) return null;
  return path.join(proc.segmentDir, "master.m3u8");
}

/**
 * List all active HLS encoder stream IDs.
 */
export function getActiveHlsStreams(): string[] {
  return [...activeHlsEncoders.keys()];
}
