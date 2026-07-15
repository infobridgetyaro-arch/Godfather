/**
 * ffmpeg-hls.ts — Multi-variant HLS command builder
 *
 * Produces a complete FFmpeg output-section argument list for adaptive bitrate
 * (ABR) HLS. Called by hls-encoder.ts after the filter_complex section that
 * produces [_video] and [_audio] labels from the source stream.
 *
 * Design decisions:
 * - Aligned GOP (keyint = fps * segmentDuration) — every segment starts on an
 *   IDR frame for all variants simultaneously, making seamless quality switching
 *   possible without buffering artifacts.
 * - sc_threshold=0 — disables scene-cut detection so FFmpeg never inserts an
 *   unexpected keyframe that misaligns GOPs across variants.
 * - independent_segments flag — every segment is self-contained (no dependency
 *   on previous segments), which is required for DASH-like ABR.
 * - delete_segments flag — FFmpeg auto-prunes segments older than
 *   hls_list_size × hls_time seconds from disk (prevents unbounded disk fill).
 * - program_date_time — embeds real-world wall-clock timestamps so players
 *   can implement DVR-style seek within the live window.
 */

export interface HlsVariant {
  name: string;
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
  maxrate: string;
  bufsize: string;
}

export type GpuAccel = "nvenc" | "vaapi" | "videotoolbox" | null;

export interface HlsOutputConfig {
  segmentDir: string;
  segmentDuration: number;
  playlistSize: number;
  variants: HlsVariant[];
  gpuAccel?: GpuAccel;
  isVertical?: boolean;
}

/**
 * Landscape variants (16:9) — standard for desktop/YouTube
 */
export const LANDSCAPE_VARIANTS: HlsVariant[] = [
  {
    name: "360p",
    width: 640,
    height: 360,
    videoBitrate: "800k",
    audioBitrate: "96k",
    maxrate: "900k",
    bufsize: "1600k",
  },
  {
    name: "720p",
    width: 1280,
    height: 720,
    videoBitrate: "2500k",
    audioBitrate: "128k",
    maxrate: "2750k",
    bufsize: "5000k",
  },
  {
    name: "1080p",
    width: 1920,
    height: 1080,
    videoBitrate: "5000k",
    audioBitrate: "192k",
    maxrate: "5500k",
    bufsize: "10000k",
  },
];

/**
 * Portrait variants (9:16) — for TikTok/mobile vertical streams
 */
export const PORTRAIT_VARIANTS: HlsVariant[] = [
  {
    name: "360p",
    width: 360,
    height: 640,
    videoBitrate: "800k",
    audioBitrate: "96k",
    maxrate: "900k",
    bufsize: "1600k",
  },
  {
    name: "720p",
    width: 720,
    height: 1280,
    videoBitrate: "2500k",
    audioBitrate: "128k",
    maxrate: "2750k",
    bufsize: "5000k",
  },
  {
    name: "1080p",
    width: 1080,
    height: 1920,
    videoBitrate: "5000k",
    audioBitrate: "192k",
    maxrate: "5500k",
    bufsize: "10000k",
  },
];

/**
 * Builds the full FFmpeg argument list for multi-variant HLS output.
 *
 * @param videoInputLabel - e.g. "0:v" or "[scaled]" — the video stream to encode
 * @param audioInputLabel - e.g. "0:a" — the audio stream to encode
 * @param fps             - frames per second (from StreamConfig)
 * @param cfg             - HLS output configuration
 */
export function buildHlsOutputArgs(
  videoInputLabel: string,
  audioInputLabel: string,
  fps: number,
  cfg: HlsOutputConfig,
): string[] {
  const { variants, segmentDir, segmentDuration, playlistSize, gpuAccel } = cfg;
  const gopSize = fps * segmentDuration; // e.g. 30fps × 4s = 120 frames
  const args: string[] = [];

  // ── Split video into N parallel streams ───────────────────────────────────
  const splitFilter = `${videoInputLabel}split=${variants.length}${variants.map((_, i) => `[hls_v${i}]`).join("")}`;
  args.push("-filter_complex", splitFilter);

  // ── Per-variant encode + scale ─────────────────────────────────────────────
  variants.forEach((v, i) => {
    // Map this variant's video and the shared audio
    args.push("-map", `[hls_v${i}]`, "-map", audioInputLabel);

    // Scale filter: pad to exact dimensions, preserve aspect ratio
    const scaleVf = [
      `scale=${v.width}:${v.height}:force_original_aspect_ratio=decrease`,
      `pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `setsar=1`,
    ].join(",");

    if (gpuAccel === "nvenc") {
      // NVIDIA NVENC hardware encoder (requires nvidia drivers + ffmpeg-nvenc)
      args.push(
        `-vf:v:${i}`, scaleVf,
        `-c:v:${i}`, "h264_nvenc",
        `-preset:v:${i}`, "p4",       // p1=fastest, p7=best quality; p4 is balanced
        `-tune:v:${i}`, "ll",
        `-rc:v:${i}`, "cbr",
        `-b:v:${i}`, v.videoBitrate,
        `-maxrate:v:${i}`, v.maxrate,
        `-bufsize:v:${i}`, v.bufsize,
        `-g:v:${i}`, String(gopSize),
        `-keyint_min:v:${i}`, String(gopSize),
        `-sc_threshold:v:${i}`, "0",
        `-r:v:${i}`, String(fps),
        `-fps_mode:v:${i}`, "cfr",
        `-pix_fmt:v:${i}`, "yuv420p",
      );
    } else if (gpuAccel === "vaapi") {
      // Intel / AMD VAAPI hardware encoder
      args.push(
        `-vf:v:${i}`, `${scaleVf},format=nv12,hwupload`,
        `-c:v:${i}`, "h264_vaapi",
        `-b:v:${i}`, v.videoBitrate,
        `-maxrate:v:${i}`, v.maxrate,
        `-g:v:${i}`, String(gopSize),
        `-keyint_min:v:${i}`, String(gopSize),
        `-r:v:${i}`, String(fps),
        `-fps_mode:v:${i}`, "cfr",
      );
    } else {
      // CPU libx264 (default — works everywhere)
      args.push(
        `-vf:v:${i}`, scaleVf,
        `-c:v:${i}`, "libx264",
        `-preset:v:${i}`, "veryfast",
        `-tune:v:${i}`, "zerolatency",
        `-b:v:${i}`, v.videoBitrate,
        `-maxrate:v:${i}`, v.maxrate,
        `-bufsize:v:${i}`, v.bufsize,
        `-profile:v:${i}`, "high",
        `-level:v:${i}`, "4.1",
        `-g:v:${i}`, String(gopSize),     // GOP = fps × segmentDuration → aligned cuts
        `-keyint_min:v:${i}`, String(gopSize),
        `-sc_threshold:v:${i}`, "0",     // no scene-cut keyframes — keeps GOPs aligned
        `-r:v:${i}`, String(fps),
        `-fps_mode:v:${i}`, "cfr",
        `-pix_fmt:v:${i}`, "yuv420p",
      );
    }

    // Per-variant audio
    args.push(
      `-c:a:${i}`, "aac",
      `-b:a:${i}`, v.audioBitrate,
      `-ar:a:${i}`, "44100",
      `-ac:a:${i}`, "2",
    );
  });

  // ── HLS muxer ─────────────────────────────────────────────────────────────
  const varStreamMap = variants
    .map((v, i) => `v:${i},a:${i},name:${v.name}`)
    .join(" ");

  args.push(
    "-f", "hls",
    "-hls_time", String(segmentDuration),
    "-hls_list_size", String(playlistSize),
    "-hls_flags", "delete_segments+independent_segments+program_date_time+append_list",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", `${segmentDir}/%v/seg%05d.ts`,
    "-master_pl_name", "master.m3u8",
    "-master_pl_publish_rate", "1",  // re-publish master every segment
    "-var_stream_map", varStreamMap,
    `${segmentDir}/%v/playlist.m3u8`,
  );

  return args;
}

/**
 * Detect GPU availability for hardware-accelerated encoding.
 * Returns null if no supported GPU is found (falls back to libx264).
 */
export async function detectGpuAccel(): Promise<GpuAccel> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    // Check for NVIDIA GPU
    await execAsync("nvidia-smi --query-gpu=name --format=csv,noheader");
    return "nvenc";
  } catch {}

  try {
    // Check for VAAPI (Intel/AMD on Linux)
    const { stdout } = await execAsync("ls /dev/dri/renderD* 2>/dev/null");
    if (stdout.trim()) return "vaapi";
  } catch {}

  return null;
}
