/**
 * YouTube Live Stream Extractor
 *
 * Production-ready resolver with:
 * - Channel URL parsing (handle, /c/, /user/, /channel/, direct video IDs)
 * - Smart error classification (live status, age restriction, members-only, geo, scheduled)
 * - 5-tier fallback chain: streamlink → tv_embedded → mweb → ios → android+web
 * - Automatic retries with exponential backoff on transient failures
 * - FFmpeg cookie header builder for authenticated CDN access
 * - Detailed structured logging
 */

import { spawn } from "child_process";
import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./lib/logger";
import { getOAuth2AuthArgs } from "./oauth2-manager";
import { YTDLP_BIN } from "./lib/ytdlp";

// ── Cookies path resolution ────────────────────────────────────────────────────
//
// Priority (highest → lowest):
//   1. YOUTUBE_COOKIES_PATH  — explicit path to an existing cookies file on the runner
//   2. YOUTUBE_COOKIES_B64   — base64-encoded Netscape cookies.txt content (GitHub Actions secret)
//   3. cookies.txt in cwd    — file uploaded via the dashboard Settings page
//
// GitHub Actions setup (recommended for CI):
//   a) In Chrome/Firefox, install "Get cookies.txt LOCALLY" and export cookies for youtube.com
//   b) Base64-encode: base64 -w 0 cookies.txt > cookies.b64   (Linux/Mac)
//      On Windows:  certutil -encode cookies.txt cookies.b64
//   c) Add the result as a repository secret named  YOUTUBE_COOKIES_B64
//   d) Pass it to the server step:
//        env:
//          YOUTUBE_COOKIES_B64: ${{ secrets.YOUTUBE_COOKIES_B64 }}

const COOKIES_TMP_PATH = path.join(os.tmpdir(), "yt-cookies.txt");

function _resolveStartupCookiesPath(): string {
  const envPath = process.env["YOUTUBE_COOKIES_PATH"];
  if (envPath) {
    if (fs.existsSync(envPath)) {
      logger.info(`[youtube] Using cookies from YOUTUBE_COOKIES_PATH: ${envPath}`);
      return envPath;
    }
    logger.warn(`[youtube] YOUTUBE_COOKIES_PATH set but file not found: ${envPath}`);
  }

  const b64 = process.env["YOUTUBE_COOKIES_B64"];
  if (b64) {
    try {
      const decoded = Buffer.from(b64.trim(), "base64").toString("utf-8");

      // Validate before writing — base64 decode never throws so corrupt secrets
      // silently produce binary garbage that yt-dlp rejects and crashes on.
      // A valid Netscape cookies.txt must contain the standard header line OR
      // at least one non-comment tab-separated line with exactly 7 fields.
      const lines = decoded.split("\n");
      const hasNetscapeHeader =
        decoded.includes("# Netscape HTTP Cookie File") ||
        decoded.includes("# HTTP Cookie File");
      const hasValidDataLine = lines
        .filter((l) => l.trim() && !l.startsWith("#"))
        .some((l) => l.split("\t").length === 7);

      if (!hasNetscapeHeader && !hasValidDataLine) {
        logger.warn(
          "[youtube] YOUTUBE_COOKIES_B64 decoded but content does not look like a " +
          "Netscape cookies.txt file (missing header + no valid tab-separated lines). " +
          "Ignoring — stream will proceed without cookies. " +
          "To fix: export cookies.txt from your browser (Netscape format) and base64-encode it.",
        );
      } else {
        fs.writeFileSync(COOKIES_TMP_PATH, decoded, "utf-8");
        logger.info("[youtube] YOUTUBE_COOKIES_B64 decoded → cookies written to tmp, yt-dlp authenticated");
        return COOKIES_TMP_PATH;
      }
    } catch (err) {
      logger.warn({ err }, "[youtube] Failed to decode YOUTUBE_COOKIES_B64 — will try without cookies");
    }
  }

  return path.join(process.cwd(), "cookies.txt");
}

const _startupCookiesPath = _resolveStartupCookiesPath();

/**
 * Returns the effective path to the YouTube cookies file.
 * Checks env vars on every call so that a freshly uploaded dashboard cookies.txt
 * is picked up without a server restart.
 */
export function getCookiesPath(): string {
  // If startup resolved a CI path (env var), keep it for the session
  if (_startupCookiesPath !== path.join(process.cwd(), "cookies.txt")) {
    return _startupCookiesPath;
  }
  // Otherwise re-resolve each time so newly uploaded files take effect immediately
  const envPath = process.env["YOUTUBE_COOKIES_PATH"];
  if (envPath && fs.existsSync(envPath)) return envPath;
  return path.join(process.cwd(), "cookies.txt");
}

// ── In-process cache: YouTube URL → downloaded temp file path ────────────────
const ytDownloadCache = new Map<string, string>();

export function clearYtDownloadCache(): void {
  for (const [, filePath] of ytDownloadCache.entries()) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  ytDownloadCache.clear();
}

// ── Error classification ──────────────────────────────────────────────────────

export type YouTubeErrorCode =
  | "NOT_LIVE"
  | "LIVE_ENDED"
  | "SCHEDULED"
  | "AGE_RESTRICTED"
  | "MEMBERS_ONLY"
  | "GEO_RESTRICTED"
  | "PRIVATE_VIDEO"
  | "LOGIN_REQUIRED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "TOOL_NOT_FOUND"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class YouTubeStreamError extends Error {
  constructor(
    message: string,
    public readonly code: YouTubeErrorCode,
    public readonly method?: string,
  ) {
    super(message);
    this.name = "YouTubeStreamError";
  }
}

function classifyYouTubeError(stderr: string, fallback: string, method: string): YouTubeStreamError {
  const low = stderr.toLowerCase();

  if (
    low.includes("is not currently live") ||
    low.includes("not live") ||
    low.includes("no streams") ||
    low.includes("no active streams") ||
    low.includes("is offline") ||
    low.includes("this live event has ended")
  ) {
    return new YouTubeStreamError(
      "The YouTube channel is not currently live.",
      "NOT_LIVE",
      method,
    );
  }
  if (
    low.includes("live event has ended") ||
    low.includes("stream has ended") ||
    low.includes("live event is over")
  ) {
    return new YouTubeStreamError("This YouTube live event has ended.", "LIVE_ENDED", method);
  }
  if (
    low.includes("scheduled") ||
    low.includes("upcoming") ||
    low.includes("will begin") ||
    low.includes("premieres") ||
    low.includes("premiere")
  ) {
    return new YouTubeStreamError(
      "This stream is scheduled for the future. It is not live yet.",
      "SCHEDULED",
      method,
    );
  }
  if (
    low.includes("age-restricted") ||
    low.includes("age restricted") ||
    low.includes("confirm your age")
  ) {
    return new YouTubeStreamError(
      "This stream is age-restricted. Upload cookies.txt with a logged-in YouTube account.",
      "AGE_RESTRICTED",
      method,
    );
  }
  if (
    low.includes("member") ||
    low.includes("membership") ||
    low.includes("members only") ||
    low.includes("join this channel") ||
    low.includes("channel membership")
  ) {
    return new YouTubeStreamError(
      "This stream is members-only. A YouTube channel membership is required to access it.",
      "MEMBERS_ONLY",
      method,
    );
  }
  if (
    low.includes("not available in your country") ||
    low.includes("geo") ||
    low.includes("country") ||
    low.includes("region") ||
    low.includes("georestrict")
  ) {
    return new YouTubeStreamError(
      "This stream is geo-restricted and not available from the server's current location.",
      "GEO_RESTRICTED",
      method,
    );
  }
  if (low.includes("private video") || low.includes("private stream")) {
    return new YouTubeStreamError(
      "This video is private and cannot be accessed without an authorized account.",
      "PRIVATE_VIDEO",
      method,
    );
  }
  if (
    low.includes("sign in") ||
    low.includes("not a bot") ||
    low.includes("confirm you") ||
    low.includes("bot detection") ||
    low.includes("please log in") ||
    low.includes("login required")
  ) {
    const hasCookiesNow = fs.existsSync(getCookiesPath());
    const cookiesHint = hasCookiesNow
      ? "Your cookies.txt is uploaded but YouTube still requires sign-in — the cookies may be expired or missing auth tokens (SID, SAPISID). Export fresh cookies from a logged-in Chrome/Firefox session using a browser extension like 'Get cookies.txt LOCALLY'."
      : "YouTube requires sign-in (bot detection). Fix options: " +
        "(1) Dashboard → Settings → Cookies: upload a cookies.txt (Netscape format) from a logged-in YouTube account. " +
        "(2) CI/GitHub Actions: set the YOUTUBE_COOKIES_B64 environment variable to a base64-encoded cookies.txt " +
        "(base64 -w 0 cookies.txt) and pass it as a secret. " +
        "Use the 'Get cookies.txt LOCALLY' browser extension to export cookies.";
    return new YouTubeStreamError(cookiesHint, "LOGIN_REQUIRED", method);
  }
  if (
    low.includes("429") ||
    low.includes("too many requests") ||
    low.includes("rate limit") ||
    low.includes("http error 429")
  ) {
    return new YouTubeStreamError(
      "YouTube is rate-limiting requests (429). Wait 30 seconds and try again.",
      "RATE_LIMITED",
      method,
    );
  }
  if (
    low.includes("video unavailable") ||
    low.includes("removed by") ||
    low.includes("no longer available") ||
    low.includes("account has been terminated")
  ) {
    return new YouTubeStreamError(
      "This YouTube video or channel is unavailable.",
      "UNAVAILABLE",
      method,
    );
  }
  if (low.includes("timed out") || low.includes("timeout") || low === "timeout") {
    return new YouTubeStreamError(
      "Request timed out while fetching YouTube stream.",
      "TIMEOUT",
      method,
    );
  }
  if (
    low.includes("connection refused") ||
    low.includes("network") ||
    low.includes("name or service not known")
  ) {
    return new YouTubeStreamError(
      `Network error: ${stderr.slice(0, 200)}`,
      "NETWORK_ERROR",
      method,
    );
  }

  return new YouTubeStreamError(
    stderr ? `${method}: ${stderr.slice(0, 300)}` : fallback,
    "UNKNOWN",
    method,
  );
}

// ── Cookies helpers ───────────────────────────────────────────────────────────

export function getCookiesArgs(): string[] {
  const cookiesPath = getCookiesPath();
  return fs.existsSync(cookiesPath) ? ["--cookies", cookiesPath] : [];
}

export function getCookiesConfigured(): boolean {
  return fs.existsSync(getCookiesPath());
}

/**
 * Returns yt-dlp args to download a YouTube live stream directly to stdout (pipe mode).
 *
 * WHY: yt-dlp resolves HLS URLs that embed a Proof-of-Origin Token (POT) bound to the
 * authenticated browser session. When FFmpeg makes raw HTTP requests using that URL,
 * YouTube's CDN rejects segment fetches because the POT/session context doesn't match a
 * real browser. Piping yt-dlp's output to FFmpeg stdin keeps yt-dlp in control of all
 * CDN requests (manifest refresh, segment auth, token rotation) — FFmpeg just receives
 * a clean MPEG-TS stream and never touches the CDN directly.
 */
/**
 * Returns streamlink CLI args to pipe a YouTube live stream directly to FFmpeg stdin.
 * streamlink speaks YouTube's native streaming API and does not require a
 * Proof-of-Origin Token (POT) for public live streams, making it far more
 * reliable than yt-dlp's web/tv_embedded/ios clients for server-side use.
 *
 * WHY streamlink over yt-dlp for pipe mode:
 * - yt-dlp resolves HLS segment URLs but then its internal FFmpeg fetches them.
 *   That internal FFmpeg subprocess doesn't inherit yt-dlp's cookie/session context,
 *   so YouTube CDN returns 403 Forbidden on rqh=1 (Proof-of-Origin) segments.
 * - streamlink uses a dedicated YouTube plugin that keeps all segment fetches
 *   inside its own session — no POT validation issues for public live streams.
 */
export function getYouTubeStreamlinkPipeArgs(pageUrl: string): string[] {
  const cookiesPath = getCookiesPath();
  const hasCookies = fs.existsSync(cookiesPath);
  return [
    "--stdout",
    "--loglevel", "warning",
    "--retry-streams", "5",
    "--retry-max", "5",
    "--retry-open", "5",
    ...(hasCookies ? ["--http-cookie-jar", cookiesPath] : []),
    pageUrl,
    "best/1080p60/1080p/720p60/720p/480p/360p/worst",
  ];
}

export function getYouTubeYtdlpPipeArgs(pageUrl: string): string[] {
  // Streams the YouTube live source as MPEG-TS to stdout so FFmpeg can read it on stdin.
  //
  // Client selection: ios + android don't require a Proof-of-Origin Token (POT) for
  // public live streams. tv_embedded was removed — it is unsupported in yt-dlp 2026+.
  //
  // Downloader: we intentionally do NOT pass --downloader native here.
  // The native downloader with --hls-use-mpegts caused yt-dlp's internal FFmpeg to
  // fetch HLS segments without session/cookie context, producing HTTP 403 on rqh=1
  // segments. yt-dlp's default downloader passes cookies and headers to its internal
  // FFmpeg via -headers, so CDN authentication works correctly.
  //
  // Format: prefer pre-muxed HLS itags (91-95) to avoid an A+V merge step.
  //
  // --no-config: prevents yt-dlp from reading system/user config files that may
  // contain unsupported --compat-options (e.g. no-keepalive) in this environment.
  const cookiesPath = getCookiesPath();
  const hasCookies = fs.existsSync(cookiesPath);
  return [
    "--no-config",
    "--no-playlist",
    "--no-check-certificate",
    "--socket-timeout", "30",
    "--extractor-args", "youtube:player_client=ios,android",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    // Start at the live edge, not the beginning of the DVR window.
    "--no-live-from-start",
    // Prefer pre-muxed HLS itags (91-95) — no internal A+V merge needed.
    "-f", "93/94/95/92/91/best[protocol^=m3u8][vcodec!*=none][acodec!*=none]/best[protocol^=m3u8]/best",
    "-o", "-",
    ...(hasCookies ? ["--cookies", cookiesPath] : []),
    pageUrl,
  ];
}

/**
 * Returns authentication args for yt-dlp, preferring OAuth2 token over cookies.txt.
 * OAuth2 is the recommended approach — one-time browser sign-in, no file management.
 */
export function getAuthArgs(): string[] {
  const oauth2 = getOAuth2AuthArgs();
  if (oauth2.length) return oauth2;
  return getCookiesArgs();
}

/**
 * Reads cookies.txt (Netscape format) and builds a Cookie header string for FFmpeg.
 */
export function getYouTubeFFmpegCookieHeader(): string {
  const cookiesPath = getCookiesPath();
  if (!fs.existsSync(cookiesPath)) return "";

  try {
    const lines = fs.readFileSync(cookiesPath, "utf-8").split("\n");
    const pairs: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split("\t");
      if (parts.length < 7) continue;
      const domain = parts[0];
      const name = parts[5];
      const value = parts[6];
      if (
        name && value &&
        (domain.includes("youtube.com") || domain.includes("google.com"))
      ) {
        pairs.push(`${name}=${value}`);
      }
    }
    return pairs.length > 0 ? `Cookie: ${pairs.join("; ")}\r\n` : "";
  } catch {
    return "";
  }
}

// ── URL normalisation & channel ID resolution ─────────────────────────────────

/**
 * Normalise any YouTube input to a canonical HTTPS URL.
 *
 * Handles:
 *  - Full URLs (https://www.youtube.com/...)
 *  - @handles        → /live page (auto-detects current live stream)
 *  - /channel/UCxxx  → channel live
 *  - /c/ChannelName  → channel live
 *  - /user/Username  → channel live
 *  - 11-char video IDs
 *  - Plain channel names (assumed handle)
 */
export function normaliseYouTubeUrl(input: string): string {
  const url = input.trim();

  // Already a full URL
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  // Handle starts with @
  if (url.startsWith("@")) return `https://www.youtube.com/${url}/live`;

  // 11-char video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return `https://www.youtube.com/watch?v=${url}`;

  // /channel/, /c/, /user/ paths without domain
  if (url.startsWith("/channel/") || url.startsWith("/c/") || url.startsWith("/user/")) {
    return `https://www.youtube.com${url}/live`;
  }

  // Plain username or channel name — assume @handle format
  return `https://www.youtube.com/@${url}/live`;
}

/**
 * Extract channel ID or handle from a YouTube URL for logging/display.
 */
export function extractChannelIdentifier(url: string): string {
  const normalized = normaliseYouTubeUrl(url);
  const match = normalized.match(/youtube\.com\/(?:@([^/?]+)|channel\/([^/?]+)|c\/([^/?]+)|user\/([^/?]+))/);
  if (!match) return url;
  return (match[1] && `@${match[1]}`) || match[2] || match[3] || match[4] || url;
}

// ── yt-dlp subprocess helpers ─────────────────────────────────────────────────

function spawnYtdlp(
  args: string[],
  method: string,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, args);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new YouTubeStreamError(`${method} timed out`, "TIMEOUT", method));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n").filter((l) => l.startsWith("http"));
      if (code === 0 && lines[0]) {
        resolve(lines[0]);
      } else {
        reject(classifyYouTubeError(
          stderr.trim(),
          `${method}: no URL found (exit ${code})`,
          method,
        ));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new YouTubeStreamError(
          "yt-dlp is not installed. Install with: pip install yt-dlp",
          "TOOL_NOT_FOUND",
          method,
        ));
      } else {
        reject(classifyYouTubeError(err.message, `spawn error: ${err.message}`, method));
      }
    });
  });
}

// ── Tier 0: yt-dlp web client with cookies (only when cookies configured) ────
// The "web" player client is the most authentic YouTube client and works best
// with cookies.txt — it mimics a real browser session. Placed first so that
// when the user has uploaded cookies this is the very first attempt.

function tier0_webWithCookies(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "20",
    "--extractor-args", "youtube:player_client=web",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:web+cookies", 35_000);
}

// ── Tier 1: streamlink ────────────────────────────────────────────────────────

function tier1_streamlink(pageUrl: string): Promise<string> {
  const cookiesPath = getCookiesPath();
  const hasCookies = fs.existsSync(cookiesPath);

  return new Promise((resolve, reject) => {
    const proc = spawn("streamlink", [
      "--stream-url",
      "--http-timeout", "20",
      "--http-header", "User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "--http-header", "Accept-Language=en-US,en;q=0.9",
      ...(hasCookies ? ["--http-cookie-jar", cookiesPath] : []),
      pageUrl,
      "best",
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new YouTubeStreamError("streamlink timed out", "TIMEOUT", "streamlink"));
    }, 35_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(classifyYouTubeError(stderr.trim() || `exit ${code}`, "streamlink failed", "streamlink"));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new YouTubeStreamError("streamlink not installed", "TOOL_NOT_FOUND", "streamlink"));
      } else {
        reject(classifyYouTubeError(err.message, "streamlink spawn error", "streamlink"));
      }
    });
  });
}

// ── Tier 2: yt-dlp tv_embedded (no PO Token, cookie-free) ────────────────────

function tier2_tvEmbedded(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "--extractor-args", "youtube:player_client=tv_embedded",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:tv_embedded");
}

// ── Tier 3: yt-dlp mweb ──────────────────────────────────────────────────────

function tier3_mweb(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "--extractor-args", "youtube:player_client=mweb",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:mweb");
}

// ── Tier 4: yt-dlp ios ───────────────────────────────────────────────────────

function tier4_ios(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "--extractor-args", "youtube:player_client=ios",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:ios");
}

// ── Tier 5: yt-dlp multi-client (last resort) ────────────────────────────────

function tier5_multiClient(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const hasAuth = getAuthArgs().length > 0;
  const clientList = hasAuth
    ? "ios,mweb,web_creator,android,android_embedded,web"
    : "ios,mweb,android,android_embedded,tv_embedded";
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "20",
    "--extractor-args", `youtube:player_client=${clientList}`,
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:multi-client", 35_000);
}

// ── Tier 6: yt-dlp android ───────────────────────────────────────────────────
// Android client often bypasses bot detection — YouTube treats it as a trusted app.

function tier6_android(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "--extractor-args", "youtube:player_client=android",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:android");
}

// ── Tier 7: yt-dlp android_embedded ─────────────────────────────────────────
// Embedded client used in third-party apps — different bot-check path.

function tier7_androidEmbedded(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "--extractor-args", "youtube:player_client=android_embedded",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:android_embedded");
}

// ── Tier 8: yt-dlp web_creator ───────────────────────────────────────────────
// YouTube Studio creator-side client — rarely blocked, works on public live streams.

function tier8_webCreator(pageUrl: string, format: string, isLive: boolean): Promise<string> {
  const args = [
    "--no-config",
    "--no-playlist",
    "-f", format,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "15",
    "--extractor-args", "youtube:player_client=web_creator",
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getAuthArgs(),
  ];
  if (isLive) args.push("--no-live-from-start");
  args.push(pageUrl);
  return spawnYtdlp(args, "yt-dlp:web_creator");
}

// ── URL health check ──────────────────────────────────────────────────────────

export function checkYouTubeStreamHealth(
  url: string,
  timeoutMs = 10_000,
): Promise<{ healthy: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ healthy: false, reason: "Health check timed out" });
    }, timeoutMs);

    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const isHls = url.includes(".m3u8");

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: isHls ? "GET" : "HEAD",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Referer: "https://www.youtube.com/",
            "Accept-Language": "en-US,en;q=0.9",
          },
          timeout: timeoutMs - 1000,
        },
        (res) => {
          clearTimeout(timer);
          if (!isHls) {
            resolve({ healthy: res.statusCode !== undefined && res.statusCode < 400, reason: res.statusCode !== undefined && res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined });
            res.destroy();
            return;
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => { body += c; if (body.length > 32768) res.destroy(); });
          res.on("end", () => {
            if (res.statusCode !== undefined && res.statusCode >= 400) {
              resolve({ healthy: false, reason: `HTTP ${res.statusCode}` });
              return;
            }
            const hasSegments = body.includes(".ts") || body.includes(".m4s") || body.includes("EXTINF") || body.includes("EXT-X-STREAM-INF");
            resolve({ healthy: hasSegments, reason: hasSegments ? undefined : "Manifest has no playable segments" });
          });
          res.on("error", (e) => resolve({ healthy: false, reason: e.message }));
        },
      );
      req.on("timeout", () => { req.destroy(); clearTimeout(timer); resolve({ healthy: false, reason: "Connection timed out" }); });
      req.on("error", (e) => { clearTimeout(timer); resolve({ healthy: false, reason: e.message }); });
      req.end();
    } catch (e: any) {
      clearTimeout(timer);
      resolve({ healthy: false, reason: e.message });
    }
  });
}

// ── Retry helper ──────────────────────────────────────────────────────────────

/**
 * Run an async operation up to maxAttempts times, waiting delayMs between each.
 * Only retries on transient errors (TIMEOUT, RATE_LIMITED, UNKNOWN, NETWORK_ERROR).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  isRetryable: (e: Error) => boolean,
): Promise<T> {
  let lastError!: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (attempt < maxAttempts && isRetryable(e)) {
        const backoff = delayMs * Math.pow(2, attempt - 1);
        logger.warn({ attempt, maxAttempts, delayMs: backoff }, "[youtube] Transient error — retrying");
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

function isTransient(e: Error): boolean {
  if (e instanceof YouTubeStreamError) {
    return ["TIMEOUT", "RATE_LIMITED", "UNKNOWN", "NETWORK_ERROR"].includes(e.code);
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface YouTubeFetchResult {
  url: string;
  resolvedBy: string;
}

/**
 * Main YouTube live URL resolver.
 *
 * 5-tier fallback chain (fastest / most reliable first):
 *   1. streamlink          — no bot detection, no POT requirement
 *   2. yt-dlp tv_embedded  — TV embedded client, no rqh/POT in URL
 *   3. yt-dlp mweb         — mobile web, works for most channels
 *   4. yt-dlp ios          — iOS client, good for age-gated content
 *   5. yt-dlp multi-client — last resort, tries ios+mweb+android together
 *
 * Definitive errors (NOT_LIVE, MEMBERS_ONLY, PRIVATE_VIDEO, SCHEDULED, etc.)
 * short-circuit the cascade immediately.
 */
export async function getYouTubeStreamUrl(input: string): Promise<string> {
  const pageUrl = normaliseYouTubeUrl(input);
  const ident = extractChannelIdentifier(input);
  const logTag = `[youtube:${ident}]`;

  const definitive = new Set<YouTubeErrorCode>([
    "NOT_LIVE", "LIVE_ENDED", "MEMBERS_ONLY", "PRIVATE_VIDEO",
    "SCHEDULED", "AGE_RESTRICTED", "UNAVAILABLE",
  ]);

  const format = "b[protocol^=m3u8]/b[ext=mp4]/b";
  const hasCookies = getCookiesConfigured() || getAuthArgs().length > 0;

  type Tier = { name: string; fn: () => Promise<string> };
  const tiers: Tier[] = [
    // When cookies/OAuth2 are configured, try the web client first — it is the
    // most authentic client and works best with a real logged-in session.
    ...(hasCookies ? [{ name: "web+cookies", fn: () => tier0_webWithCookies(pageUrl, format, true) }] : []),
    { name: "streamlink",        fn: () => tier1_streamlink(pageUrl) },
    { name: "tv_embedded",       fn: () => tier2_tvEmbedded(pageUrl, format, true) },
    { name: "mweb",              fn: () => tier3_mweb(pageUrl, format, true) },
    { name: "ios",               fn: () => tier4_ios(pageUrl, format, true) },
    { name: "android",           fn: () => tier6_android(pageUrl, format, true) },
    { name: "android_embedded",  fn: () => tier7_androidEmbedded(pageUrl, format, true) },
    { name: "web_creator",       fn: () => tier8_webCreator(pageUrl, format, true) },
    { name: "multi-client",      fn: () => tier5_multiClient(pageUrl, format, true) },
  ];

  let lastError: YouTubeStreamError | null = null;

  for (const tier of tiers) {
    try {
      const url = await withRetry(tier.fn, 2, 3000, isTransient);
      logger.info({ ident, tier: tier.name }, `${logTag} URL resolved via ${tier.name}`);
      return url;
    } catch (e: any) {
      const err = e instanceof YouTubeStreamError
        ? e
        : classifyYouTubeError(e.message ?? "", "Unknown error", tier.name);

      logger.warn({ ident, tier: tier.name, code: err.code, msg: err.message.slice(0, 150) }, `${logTag} Tier failed`);

      // Short-circuit on definitive errors
      if (definitive.has(err.code)) throw err;

      // Skip remaining tiers if tools aren't installed
      if (err.code === "TOOL_NOT_FOUND" && tier.name === "streamlink") {
        logger.warn(`${logTag} streamlink not installed — skipping to yt-dlp tiers`);
        continue;
      }

      lastError = err;
    }
  }

  throw new YouTubeStreamError(
    lastError?.message || `Could not get YouTube stream URL for ${ident}. Is the channel live and publicly accessible?`,
    lastError?.code ?? "UNKNOWN",
    "all-tiers",
  );
}

/**
 * Humanised yt-dlp error message (legacy helper used by download functions).
 */
export function humaniseYtdlpError(stderr: string, fallback: string): string {
  return classifyYouTubeError(stderr, fallback, "yt-dlp").message;
}

/**
 * Gets the direct CDN video URL for a YouTube VOD (not a live stream).
 * Uses tv_embedded first (no POT, no cookies), falls back to mweb/ios.
 */
export async function getYouTubeVideoDirectUrl(input: string): Promise<string> {
  const url = input.trim();
  const vodfmt = "18/b[height<=480][ext=mp4]/b[height<=720][ext=mp4]/worst[ext=mp4]/worst";

  // Tier 1: tv_embedded (no cookie / no POT required)
  try {
    return await tier2_tvEmbedded(url, vodfmt, false);
  } catch {}

  // Tier 2: mweb
  try {
    return await tier3_mweb(url, vodfmt, false);
  } catch {}

  // Tier 3: ios
  try {
    return await tier4_ios(url, vodfmt, false);
  } catch {}

  // Tier 4: multi-client
  const clientList = getCookiesConfigured()
    ? "ios,mweb,web_creator,android,web"
    : "mweb,android";

  return spawnYtdlp([
    "--no-config",
    "--no-playlist",
    "-f", vodfmt,
    "--get-url",
    "--no-check-certificate",
    "--socket-timeout", "20",
    "--extractor-args", `youtube:player_client=${clientList}`,
    "--add-header", "Accept-Language:en-US,en;q=0.9",
    ...getCookiesArgs(),
    url,
  ], "yt-dlp:vod-multi", 25_000);
}

/**
 * Downloads a YouTube (or any yt-dlp-supported) video to a local temp mp4.
 * Used as last resort when direct-URL approach fails (DASH streams, etc.).
 * Results are cached per URL.
 */
export async function downloadYouTubeVideoToTemp(
  input: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const url = input.trim();

  const cached = ytDownloadCache.get(url);
  if (cached && fs.existsSync(cached)) {
    onProgress?.("Using cached download — starting playback immediately");
    return cached;
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const destPath = path.join(uploadsDir, `break_yt_${Date.now()}.mp4`);

  const playerClients = getCookiesConfigured()
    ? "tv_embedded,ios,mweb,web_creator,android,web"
    : "tv_embedded,ios,mweb,android";

  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [
      "--no-config",
      "--no-playlist",
      "-f", "b[height<=720][ext=mp4]/b[height<=480][ext=mp4]/b[height<=720]/b[height<=480]/b",
      "--merge-output-format", "mp4",
      "--no-check-certificate",
      "--socket-timeout", "30",
      "--extractor-args", `youtube:player_client=${playerClients}`,
      "--add-header", "Accept-Language:en-US,en;q=0.9",
      ...getCookiesArgs(),
      "-o", destPath,
      url,
    ]);

    let stderrBuf = "";
    proc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString();
      stderrBuf += line;
      const trimmed = line.trim();
      if (onProgress && trimmed && (
        trimmed.startsWith("[download]") ||
        trimmed.startsWith("[Merger]") ||
        trimmed.startsWith("[ffmpeg]")
      )) {
        onProgress(trimmed.slice(0, 120));
      }
    });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      try { fs.unlinkSync(destPath); } catch {}
      reject(new Error("Download timed out after 120 seconds. Try a shorter video or upload the file instead."));
    }, 120_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(destPath)) {
        ytDownloadCache.set(url, destPath);
        resolve(destPath);
      } else {
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error(humaniseYtdlpError(
          stderrBuf.trim(),
          `yt-dlp could not download the video (exit ${code}). Is the video public?`,
        )));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed. Install with: pip install yt-dlp"));
      } else {
        reject(err);
      }
    });
  });
}
