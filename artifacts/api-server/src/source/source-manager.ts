/**
 * Source Manager — Centralized source URL resolution and lifecycle
 *
 * Single responsibility: given a stream config, resolve the input URL
 * or determine the pipe mode. Handles all source types independently.
 *
 * Uses circuit breaker + URL cache to prevent thundering herd on failures.
 */

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { logger } from "../lib/logger";
import { config } from "../engine/config-service";
import { YTDLP_BIN } from "../lib/ytdlp";
import { normaliseYouTubeUrl } from "../youtube-source";
import type { StreamConfig } from "../schema";
import type { ResolvedSource, SourceType } from "../engine/types";

// ── URL Cache ─────────────────────────────────────────────────────────────────

const urlCache = new Map<string, ResolvedSource>();

export function getCachedUrl(streamId: string): ResolvedSource | null {
  const entry = urlCache.get(streamId);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > config.urlCacheTtlMs) {
    urlCache.delete(streamId);
    return null;
  }
  return entry;
}

export function setCachedUrl(streamId: string, source: ResolvedSource): void {
  urlCache.set(streamId, source);
}

export function invalidateCachedUrl(streamId: string): void {
  urlCache.delete(streamId);
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

interface CBState {
  failures: number[];
  openedAt: number | null;
  probeInFlight: boolean;
}

const resolverCBs = new Map<string, CBState>();

export function getCBState(streamId: string): CBState {
  if (!resolverCBs.has(streamId)) {
    resolverCBs.set(streamId, { failures: [], openedAt: null, probeInFlight: false });
  }
  return resolverCBs.get(streamId)!;
}

export function cbCanAttempt(streamId: string): boolean {
  const cb = getCBState(streamId);
  if (!cb.openedAt) return true;
  const now = Date.now();
  if (now - cb.openedAt >= config.cbOpenCooldownMs && !cb.probeInFlight) {
    cb.probeInFlight = true;
    return true;
  }
  return false;
}

export function cbRecordSuccess(streamId: string): void {
  const cb = getCBState(streamId);
  cb.failures = [];
  cb.openedAt = null;
  cb.probeInFlight = false;
}

export function cbRecordFailure(streamId: string): void {
  const cb = getCBState(streamId);
  const now = Date.now();
  cb.probeInFlight = false;
  cb.failures.push(now);
  cb.failures = cb.failures.filter((t) => now - t < config.cbWindowMs);
  if (!cb.openedAt && cb.failures.length >= config.cbFailureThreshold) {
    cb.openedAt = now;
    logger.warn({ streamId, failures: cb.failures.length },
      "[circuit-breaker] OPEN — suspending URL resolution for 10 min");
  } else if (cb.openedAt) {
    cb.openedAt = now;
    logger.warn({ streamId }, "[circuit-breaker] Probe failed — extending cooldown");
  }
}

export function clearCBState(streamId: string): void {
  resolverCBs.delete(streamId);
}

export function getCBSnapshot(streamId: string) {
  const now = Date.now();
  const cb = getCBState(streamId);
  const failuresInWindow = cb.failures.filter((t) => now - t < config.cbWindowMs).length;
  const cooldownRemainingMs = cb.openedAt != null
    ? Math.max(0, config.cbOpenCooldownMs - (now - cb.openedAt))
    : null;
  const state: "closed" | "open" | "probing" =
    cb.openedAt == null ? "closed"
    : cb.probeInFlight ? "probing"
    : "open";
  return {
    state,
    failuresInWindow,
    failureThreshold: config.cbFailureThreshold,
    windowMs: config.cbWindowMs,
    openedAt: cb.openedAt,
    cooldownMs: config.cbOpenCooldownMs,
    cooldownRemainingMs,
    probeInFlight: cb.probeInFlight,
  };
}

// ── Definitively-failed error codes ──────────────────────────────────────────

const DEFINITIVE_ERRORS = new Set([
  "NOT_LIVE", "LIVE_ENDED", "PRIVATE_ACCOUNT", "PRIVATE_VIDEO",
  "REGION_RESTRICTED", "GEO_RESTRICTED", "AGE_RESTRICTED",
  "MEMBERS_ONLY", "SCHEDULED", "UNAVAILABLE",
]);

export function isDefinitiveError(code: string | undefined): boolean {
  return !!code && DEFINITIVE_ERRORS.has(code);
}

// ── URL resolution ────────────────────────────────────────────────────────────

export async function resolveSourceUrl(
  stream: StreamConfig,
  forceRefresh = false,
): Promise<ResolvedSource> {
  const { id: streamId, sourceType } = stream;

  // Local sources — no external resolver
  if (sourceType === "upload") {
    const filePath = stream.uploadedVideoPath || "";
    if (!filePath) throw new Error("No video file uploaded. Please upload a video file first.");
    if (!fs.existsSync(filePath)) throw new Error(`Uploaded video file not found: ${filePath}`);
    return { url: filePath, sourceType: "upload", resolvedAt: Date.now() };
  }

  if (sourceType === "camera") {
    const device = stream.cameraDevice || "";
    const isPlaceholder = device === "" || device === "/dev/video0";
    if (device === "__browser__" || isPlaceholder) {
      return { url: "__browser__", sourceType: "camera", resolvedAt: Date.now() };
    }
    return { url: device, sourceType: "camera", resolvedAt: Date.now() };
  }

  // Circuit breaker gate
  if (!cbCanAttempt(streamId)) {
    const cb = getCBState(streamId);
    const remainMs = Math.max(0, config.cbOpenCooldownMs - (Date.now() - (cb.openedAt ?? 0)));
    const remainMin = Math.ceil(remainMs / 60_000);
    throw new Error(
      `[circuit-breaker] URL resolution suspended — too many failures. Resuming in ~${remainMin} min.`,
    );
  }

  try {
    const result = await _resolveSourceUrl(stream, forceRefresh);
    cbRecordSuccess(streamId);
    return result;
  } catch (e: any) {
    if (!isDefinitiveError(e.code)) {
      cbRecordFailure(streamId);
    }
    throw e;
  }
}

async function _resolveSourceUrl(
  stream: StreamConfig,
  forceRefresh: boolean,
): Promise<ResolvedSource> {
  const { id: streamId, sourceType } = stream;

  if (!forceRefresh) {
    const cached = getCachedUrl(streamId);
    if (cached && cached.sourceType === (sourceType as SourceType)) {
      logger.info({ streamId, sourceType }, "[source] Reusing cached input URL");
      return cached;
    }
  }

  if (sourceType === "youtube") {
    const input = (stream.youtubeSourceUrl || "").trim();
    if (!input) throw new Error("YouTube source URL or handle is required");
    if (input.includes(".m3u8")) {
      const resolved: ResolvedSource = { url: input, sourceType: "youtube", resolvedAt: Date.now() };
      setCachedUrl(streamId, resolved);
      return resolved;
    }
    // Pipe mode — yt-dlp spawned separately, piped to FFmpeg stdin
    return { url: "pipe:0", sourceType: "youtube_pipe", resolvedAt: Date.now() };
  }

  if (sourceType === "facebook") {
    const input = (stream.facebookSourceUrl || "").trim();
    if (!input) throw new Error("Facebook Live URL or username is required");
    // Pipe mode — yt-dlp spawned separately, piped to FFmpeg stdin
    return { url: "pipe:0", sourceType: "facebook_pipe", resolvedAt: Date.now() };
  }

  if (sourceType === "xspace") {
    const spaceUrl = stream.xspaceUrl || "";
    if (!spaceUrl) throw new Error("X Space URL is required");
    const audioUrl = await getXSpaceAudioUrl(spaceUrl);
    const resolved: ResolvedSource = { url: audioUrl, sourceType: "xspace" as SourceType, resolvedAt: Date.now() };
    setCachedUrl(streamId, resolved);
    return resolved;
  }

  // TikTok — pipe mode
  if (!stream.tiktokUsername) throw new Error("TikTok username is required");
  return { url: "pipe:0", sourceType: "tiktok_pipe", resolvedAt: Date.now() };
}

// ── X Space audio extraction ──────────────────────────────────────────────────

async function getXSpaceAudioUrl(spaceUrl: string): Promise<string> {
  const xCookiesPath = path.join(process.cwd(), "x-cookies.txt");
  const cookiesArgs = fs.existsSync(xCookiesPath) ? ["--cookies", xCookiesPath] : [];
  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [0, 3_000, 9_000, 27_000];
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const delay = BACKOFF_MS[attempt - 1] ?? 27_000;
    if (delay > 0) {
      logger.info({ spaceUrl, attempt, delayMs: delay }, "[xspace] Waiting before retry...");
      await new Promise<void>((r) => setTimeout(r, delay));
    }

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const ytdlp = spawn(YTDLP_BIN, [
          "--no-config", "-g", "--no-playlist",
          "-f", "bestaudio", "--no-warnings",
          "--socket-timeout", "20",
          ...cookiesArgs,
          spaceUrl,
        ]);

        let stdout = "";
        let stderr = "";
        ytdlp.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        ytdlp.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
        const timer = setTimeout(() => {
          try { ytdlp.kill("SIGKILL"); } catch {}
          reject(new Error("yt-dlp timed out after 30s"));
        }, 30_000);

        ytdlp.on("close", (code) => {
          clearTimeout(timer);
          const audioUrl = stdout.trim().split("\n")[0]?.trim();
          if (code === 0 && audioUrl) resolve(audioUrl);
          else reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(0, 300)}`));
        });

        ytdlp.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          reject(new Error(err.code === "ENOENT" ? "yt-dlp is not installed" : err.message));
        });
      });

      logger.info({ spaceUrl, attempt }, "[xspace] HLS audio URL extracted successfully");
      return url;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      const isFatal = lastError.includes("is not installed") ||
        lastError.includes("Space has ended") ||
        lastError.includes("not found") ||
        lastError.includes("does not exist");
      logger.warn({ spaceUrl, attempt, error: lastError }, `[xspace] Attempt ${attempt}/${MAX_ATTEMPTS} failed`);
      if (isFatal || attempt === MAX_ATTEMPTS) break;
    }
  }
  throw new Error(`Failed to extract X Space audio after ${MAX_ATTEMPTS} attempts. Last: ${lastError}`);
}

// ── TikTok page URL builder ───────────────────────────────────────────────────

export function buildTikTokPageUrl(username: string): string {
  return `https://www.tiktok.com/@${username}/live`;
}

export function buildYouTubePageUrl(youtubeSourceUrl: string): string {
  return normaliseYouTubeUrl(youtubeSourceUrl.trim());
}

/**
 * Normalise a Facebook Live URL to a canonical HTTPS URL for yt-dlp.
 *
 * yt-dlp's Facebook extractor ONLY works with URLs that include a numeric
 * video ID.  Bare profile/page URLs (facebook.com/pagename) always redirect
 * to the login page and produce "Unsupported URL" errors.
 *
 * Accepted inputs:
 *  - Full URL with scheme containing a video ID
 *      https://www.facebook.com/watch/live/?v=123456789012345
 *      https://www.facebook.com/PAGE/videos/123456789012345
 *  - Scheme-less version of the above  (facebook.com/watch/live/?v=…)
 *  - Plain numeric video ID            → facebook.com/video.php?v=ID
 *
 * Returns null for bare usernames/page names that cannot be resolved.
 */
export function normaliseFacebookUrl(input: string): string | null {
  const trimmed = input.trim();

  // Plain numeric video ID
  if (/^\d+$/.test(trimmed)) return `https://www.facebook.com/video.php?v=${trimmed}`;

  // Add scheme to scheme-less domain URLs
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(?:www\.)?facebook\.com\//i.test(trimmed) || /^fb\.watch\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;

  if (!withScheme) return null; // bare username — cannot resolve without login

  // Only accept URLs that contain a numeric video ID, otherwise yt-dlp will
  // fail: profile pages redirect to login, which yt-dlp cannot handle.
  const hasVideoId = /[?&/]v=\d+|\/videos\/\d+|\/video\/\d+|video\.php\?.*v=\d+/i.test(withScheme);
  if (!hasVideoId) return null;

  return withScheme;
}
