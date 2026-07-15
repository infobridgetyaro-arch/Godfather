/**
 * FFmpeg Args Builder — Pure function that constructs FFmpeg command arguments
 *
 * Extracted from stream-manager.ts to give it a single responsibility.
 * Completely stateless — given config + resolved inputs, returns args[].
 *
 * Input layout (pipe indices):
 *   pipe:0  stdin   — source video (browser camera WebM / tiktok_pipe / youtube_pipe)
 *   pipe:3  stdio[3] — background gradient RGBA (2fps)
 *   pipe:4  stdio[4] — UI overlay RGBA (25fps)
 *   pipe:5  stdio[5] — browser mic PCM16 mono 44100 Hz
 *   pipe:6  stdio[6] — volume control f32le stereo 48000 Hz
 */

import { config } from "../engine/config-service";
import { getStreamDimensions } from "../engine/types";
import type { StreamConfig } from "../schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

function bitrateStr(kbps: number): string { return `${kbps}k`; }

// ── Source input args ─────────────────────────────────────────────────────────

export function buildSourceInputArgs(
  stream: StreamConfig,
  inputUrl: string,
  resolvedSourceType: string,
  tiktokCookiesPath: string | null,
  xspaceVideoPath?: string,
  xspaceImageUrl?: string,
): string[] {
  const args: string[] = [];
  const isXSpace  = stream.sourceType === "xspace";
  const isUpload  = stream.sourceType === "upload";
  const isCamera  = stream.sourceType === "camera" && inputUrl !== "__browser__";
  const isBrowser = inputUrl === "__browser__";
  const isPipe    = resolvedSourceType === "tiktok_pipe" || resolvedSourceType === "youtube_pipe";
  const fps       = parseInt(stream.fps || "30", 10);

  args.push("-hide_banner", "-loglevel", "warning", "-stats");

  if (isBrowser) {
    // Browser camera: WebM from stdin (pipe:0)
    args.push("-f", "webm", "-i", "pipe:0");
  } else if (isPipe || isXSpace) {
    // Pipe mode: stdin for TikTok/YouTube relay; direct URL for xSpace HLS
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-i", inputUrl === "pipe:0" ? "pipe:0" : inputUrl,
    );
  } else if (isUpload) {
    if (stream.uploadedVideoLoop) {
      args.push("-stream_loop", "-1");
    }
    args.push("-re", "-i", inputUrl);
  } else if (isCamera) {
    args.push("-f", "v4l2", "-i", inputUrl);
  } else {
    // YouTube HLS direct / TikTok direct
    const cookieArgs: string[] = [];
    if (tiktokCookiesPath) {
      cookieArgs.push("-cookies", `Cookie: ${tiktokCookiesPath}`);
    }
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      ...cookieArgs,
      "-i", inputUrl,
    );
  }

  return args;
}

// ── Full FFmpeg args ──────────────────────────────────────────────────────────

export interface BuildFFmpegArgsOptions {
  stream: StreamConfig;
  inputUrl: string;
  resolvedSourceType: string;
  outputs: string[];
  tiktokCookiesPath?: string | null;
  xspaceVideoPath?: string;
  xspaceImageUrl?: string;
}

export function buildFFmpegArgs(opts: BuildFFmpegArgsOptions): string[] {
  const { stream, inputUrl, resolvedSourceType, outputs, tiktokCookiesPath, xspaceVideoPath, xspaceImageUrl } = opts;
  const fps      = parseInt(stream.fps || "30", 10);
  const quality  = stream.quality || "best";
  const ratio    = stream.ratio || "mobile";
  const dims     = getStreamDimensions(ratio as any, quality as any, fps);
  const { width: scaleW, height: scaleH, bitrateKbps } = dims;
  const bufsizeKbps = bitrateKbps * 2;
  const bitrate  = bitrateStr(bitrateKbps);
  const bufsize  = bitrateStr(bufsizeKbps);

  const isXSpace  = stream.sourceType === "xspace";
  const isBrowser = inputUrl === "__browser__";
  const isUpload  = stream.sourceType === "upload";
  const isPipe    = resolvedSourceType === "tiktok_pipe" || resolvedSourceType === "youtube_pipe";
  const hasXSpaceBg = !!(xspaceVideoPath || xspaceImageUrl);

  const args: string[] = [];

  args.push("-hide_banner", "-loglevel", "warning", "-stats");

  // ── Input 0: video source ─────────────────────────────────────────────────
  if (isBrowser) {
    args.push("-f", "webm", "-i", "pipe:0");
  } else if (isPipe) {
    args.push(
      "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      "-i", "pipe:0",
    );
  } else if (stream.sourceType === "upload") {
    if (stream.uploadedVideoLoop) args.push("-stream_loop", "-1");
    args.push("-re", "-i", inputUrl);
  } else if (stream.sourceType === "camera" && inputUrl !== "__browser__") {
    args.push("-f", "v4l2", "-i", inputUrl);
  } else {
    args.push(
      "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
      "-i", inputUrl,
    );
  }

  // ── Input 1: black background (fallback under gradient) ───────────────────
  args.push(
    "-f", "lavfi",
    "-i", `color=black:s=${scaleW}x${scaleH}:r=${fps}`,
  );

  // ── Input 2: silence (audio fallback) ─────────────────────────────────────
  args.push("-f", "lavfi", "-i", "aevalsrc=0:c=stereo:r=48000");

  // ── Input 3: background gradient pipe (pipe:3) ────────────────────────────
  args.push(
    "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${scaleW}x${scaleH}`,
    "-r", `${config.bgRendererFps}`,
    "-i", "pipe:3",
  );

  // ── Input 4: UI overlay pipe (pipe:4) ─────────────────────────────────────
  args.push(
    "-f", "rawvideo", "-pix_fmt", "rgba",
    "-s", `${scaleW}x${scaleH}`,
    "-r", `${config.uiRendererFps}`,
    "-i", "pipe:4",
  );

  // ── Input 5: mic PCM16 mono (pipe:5) ─────────────────────────────────────
  args.push(
    "-f", "s16le", "-ar", `${config.micSampleRate}`, "-ac", "1",
    "-i", "pipe:5",
  );

  // ── Input 6: volume control f32le stereo (pipe:6) ────────────────────────
  args.push(
    "-f", "f32le", "-ar", `${config.volSampleRate}`, "-ac", "2",
    "-i", "pipe:6",
  );

  // ── Input 7: X Space background media (optional) ─────────────────────────
  if (isXSpace && hasXSpaceBg) {
    const bgSrc = xspaceVideoPath || xspaceImageUrl!;
    if (xspaceVideoPath) {
      args.push("-stream_loop", "-1");
    }
    args.push("-i", bgSrc);
  }

  // ── Mic noise filter ───────────────────────────────────────────────────────
  //
  // Chain rationale (applied in order):
  //
  //  aformat          — convert PCM16 mono to fltp stereo so every downstream
  //                     filter runs on float samples (no intermediate conversions)
  //
  //  highpass f=100   — remove sub-bass rumble / desk-handling / HVAC drone.
  //                     100 Hz is the safe floor for voice; 80 Hz (old value)
  //                     was letting through enough sub-bass energy to trigger
  //                     the compressor unnecessarily.
  //
  //  afftdn nf=-20 nt=w om=o
  //                   — spectral noise reduction.
  //                     nf=-20  : noise floor at −20 dBFS (was −25 — too
  //                               aggressive, caused metallic "radio" artefacts
  //                               aka musical noise).
  //                     nt=w    : white-noise model; better for broadband hiss
  //                               from mic pre-amps than the default pink model.
  //                     om=o    : output the cleaned signal only (not mixed
  //                               with a residual noise estimate).
  //
  //  acompressor      — broadcast-grade dynamic range control on the FFmpeg
  //                     side, applied *after* spectral denoising so the
  //                     compressor doesn't act on noise-floor bursts.
  //                     threshold -22 dBFS  : start compressing just above
  //                                           typical noise floor.
  //                     ratio     3:1       : gentle; 4:1 was causing pumping.
  //                     attack    5 ms      : fast enough to catch plosives.
  //                     release  100 ms     : smooth tail decay.
  //                     makeup    2 dB      : modest level restore.
  //                     knee      6 dB      : soft knee for transparent onset.
  //
  const micClean = [
    `[5:a]aformat=sample_fmts=fltp:channel_layouts=stereo`,
    `highpass=f=100`,
    `afftdn=nf=-20:nt=w:om=o`,
    `acompressor=threshold=-22dB:ratio=3:attack=5:release=100:makeup=2dB:knee=6dB`,
    `[_mic]`,
  ].join(",");

  // ── Audio filter graph ────────────────────────────────────────────────────
  let audioFilter: string;
  if (isXSpace || isBrowser || stream.sourceType === "upload") {
    audioFilter = [
      micClean,
      `[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_srcFin]`,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=2:normalize=0[_rawA]`,
      `[_rawA]aresample=48000:async=${config.audioAsyncSamples}:min_hard_comp=0.100000[_audio]`,
    ].join(";");
  } else {
    audioFilter = [
      `[2:a][0:a]amix=inputs=2:duration=first:dropout_transition=10:normalize=0[_srcRaw]`,
      `[6:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_vol]`,
      `[_srcRaw][_vol]amultiply[_srcFin]`,
      micClean,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=10:normalize=0[_rawA]`,
      `[_rawA]aresample=48000:async=${config.audioAsyncSamples}:min_hard_comp=0.100000[_audio]`,
    ].join(";");
  }

  // ── Video filter graph ────────────────────────────────────────────────────
  let filterGraph: string;

  if (isXSpace) {
    if (hasXSpaceBg) {
      filterGraph = [
        `[3:v]format=rgba[_bg]`,
        `[1:v][_bg]overlay=0:0:format=auto[_base]`,
        `[7:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2,format=rgba[_img]`,
        `[_base][_img]overlay=0:0:format=auto[_baseImg]`,
        `[4:v]format=rgba[_ui]`,
        `[_baseImg][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
        audioFilter,
      ].join(";");
    } else {
      filterGraph = [
        `[3:v]format=rgba[_bg]`,
        `[1:v][_bg]overlay=0:0:format=auto[_base]`,
        `[4:v]format=rgba[_ui]`,
        `[_base][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
        audioFilter,
      ].join(";");
    }
  } else {
    const videoSrcFilter = [
      `[0:v]format=yuva420p`,
      `scale=${scaleW}:-2:flags=fast_bilinear`,
      `pad=${scaleW}:'if(lte(ih,${scaleH}),${scaleH},ih)':0:'if(lte(ih,${scaleH}),(${scaleH}-ih)/2,0)':color=black@0`,
      `crop=${scaleW}:${scaleH}:0:'if(gte(ih,${scaleH}),(ih-${scaleH})/2,0)'`,
      `setsar=1[_src]`,
    ].join(",");

    filterGraph = [
      videoSrcFilter,
      `[3:v]format=rgba[_bg]`,
      `[1:v][_bg]overlay=0:0:format=auto[_base]`,
      `[_base][_src]overlay=0:0:format=auto:eof_action=repeat[_composed]`,
      `[4:v]format=rgba[_ui]`,
      `[_composed][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
      audioFilter,
    ].join(";");
  }

  args.push("-filter_complex", filterGraph);
  args.push("-map", "[_final]");
  args.push("-map", "[_audio]");

  // ── Video encoder ─────────────────────────────────────────────────────────
  const encoderPreset = (stream.encoderPreset as string) || "ultrafast";
  args.push(
    "-c:v", "libx264",
    "-preset", encoderPreset,
    "-tune", "zerolatency",
    "-b:v", bitrate,
    "-minrate", bitrate,
    "-maxrate", bitrate,
    "-bufsize", bufsize,
    "-profile:v", "high",
    "-level", "4.1",
    "-bf", "0",
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt", "yuv420p",
    "-g", String(fps * 2),
    "-keyint_min", String(fps * 2),
    "-sc_threshold", "0",
    "-r", String(fps),
    "-fps_mode", "cfr",
    "-flags", "+global_header",
  );

  // ── Audio encoder ─────────────────────────────────────────────────────────
  args.push(
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "48000",
    "-ac", "2",
    "-profile:a", "aac_low",
  );

  // ── RTMP tee output ───────────────────────────────────────────────────────
  args.push("-avoid_negative_ts", "make_zero");
  const rtmpBuf = config.rtmpBufferMs;
  const rwTimeout = config.rtmpRwTimeoutUs;
  const teeOutputs = outputs
    .map((o) => `[f=flv:flvflags=no_duration_filesize:rtmp_live=1:rtmp_buffer=${rtmpBuf}:rw_timeout=${rwTimeout}]${o}`)
    .join("|");
  args.push("-f", "tee", teeOutputs);

  return args;
}
