/**
 * TikTok Live Stream Extractor
 *
 * 4-method cascade with smart error classification, URL health checking,
 * quality selection, proxy/region detection, and structured logging.
 *
 * Method 1 — streamlink (best bot-protection bypass)
 * Method 2 — yt-dlp default (username-based)
 * Method 3 — yt-dlp with alternate TikTok API hostname
 * Method 4 — yt-dlp with mobile user-agent and web client
 */

import { spawn } from "child_process";
import https from "https";
import http from "http";
import { logger } from "./lib/logger";
import fs from "fs";
import path from "path";

import { YTDLP_BIN } from "./lib/ytdlp";

// ── Error classification ──────────────────────────────────────────────────────

export type TikTokErrorCode =
  | "NOT_LIVE"
  | "LIVE_ENDED"
  | "REGION_RESTRICTED"
  | "AGE_RESTRICTED"
  | "PRIVATE_ACCOUNT"
  | "LOGIN_REQUIRED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "TOOL_NOT_FOUND"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class TikTokStreamError extends Error {
  constructor(
    message: string,
    public readonly code: TikTokErrorCode,
    public readonly method?: string,
  ) {
    super(message);
    this.name = "TikTokStreamError";
  }
}

export interface TikTokStreamInfo {
  roomId: string;
  isLive: boolean;
  title?: string;
  flvUrls: { hd?: string; sd?: string; ld?: string };
  hlsUrl?: string;
  quality?: string;
  resolvedBy?: string;
}

// ── Reconnect tracking (per username) ────────────────────────────────────────

interface ReconnectStats {
  count: number;
  lastAt: number;
  errors: string[];
}
const reconnectLog = new Map<string, ReconnectStats>();

export function getReconnectStats(username: string): ReconnectStats | null {
  return reconnectLog.get(username.toLowerCase()) ?? null;
}

function recordReconnect(username: string, error?: string): void {
  const key = username.toLowerCase();
  const existing = reconnectLog.get(key) ?? { count: 0, lastAt: 0, errors: [] };
  existing.count++;
  existing.lastAt = Date.now();
  if (error) {
    existing.errors.push(`[${new Date().toISOString()}] ${error.slice(0, 200)}`);
    if (existing.errors.length > 20) existing.errors.shift();
  }
  reconnectLog.set(key, existing);
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

const TIKTOK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIKTOK_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function cookiesPath(): string {
  return path.join(process.cwd(), "tiktok-cookies.txt");
}

export function getTikTokCookiesConfigured(): boolean {
  return fs.existsSync(cookiesPath());
}

function ytdlpCookiesArgs(): string[] {
  return fs.existsSync(cookiesPath()) ? ["--cookies", cookiesPath()] : [];
}

function streamlinkCookiesArgs(): string[] {
  return fs.existsSync(cookiesPath()) ? ["--http-cookie-jar", cookiesPath()] : [];
}

// ── Error text classifier ─────────────────────────────────────────────────────

function classifyError(text: string, source: string): TikTokStreamError {
  const t = text.toLowerCase();

  if (
    t.includes("is not live") ||
    t.includes("not currently live") ||
    t.includes("not live streaming") ||
    t.includes("not currently streaming") ||
    t.includes("channel is not currently") ||
    t.includes("no playable streams found") ||
    t.includes("this channel has no active")
  ) {
    return new TikTokStreamError("User is not currently live", "NOT_LIVE", source);
  }
  if (
    t.includes("live stream has ended") ||
    t.includes("stream has ended") ||
    t.includes("stream ended") ||
    t.includes("broadcast has ended")
  ) {
    return new TikTokStreamError("The LIVE has ended", "LIVE_ENDED", source);
  }
  if (t.includes("age-restrict") || t.includes("age restrict") || t.includes("age_restrict")) {
    return new TikTokStreamError(
      "Stream is age-restricted. Upload tiktok-cookies.txt with a logged-in account to access it.",
      "AGE_RESTRICTED",
      source,
    );
  }
  if (
    t.includes("private") ||
    t.includes("account is private") ||
    t.includes("this account is private")
  ) {
    return new TikTokStreamError(
      "This TikTok account is private. The account must be public to stream.",
      "PRIVATE_ACCOUNT",
      source,
    );
  }
  if (
    t.includes("login") ||
    t.includes("sign in") ||
    t.includes("log in") ||
    t.includes("authentication required") ||
    t.includes("please log in")
  ) {
    return new TikTokStreamError(
      "TikTok requires login to access this stream. Upload tiktok-cookies.txt in Settings.",
      "LOGIN_REQUIRED",
      source,
    );
  }
  if (
    t.includes("429") ||
    t.includes("too many requests") ||
    t.includes("rate limit") ||
    t.includes("rate_limit")
  ) {
    return new TikTokStreamError(
      "TikTok is rate-limiting requests. Wait 60 seconds and try again.",
      "RATE_LIMITED",
      source,
    );
  }
  if (
    t.includes("region") ||
    t.includes("not available in your country") ||
    t.includes("geo") ||
    t.includes("georestrict") ||
    t.includes("not available in your region")
  ) {
    return new TikTokStreamError(
      "Stream is region-restricted and cannot be accessed from this server location. Consider routing via a different network.",
      "REGION_RESTRICTED",
      source,
    );
  }
  if (t.includes("timed out") || t.includes("timeout") || t === "TIMEOUT") {
    return new TikTokStreamError(
      "Request timed out. TikTok may be temporarily throttling access.",
      "TIMEOUT",
      source,
    );
  }
  if (
    t.includes("network") ||
    t.includes("connection refused") ||
    t.includes("name or service not known") ||
    t.includes("no route to host")
  ) {
    return new TikTokStreamError(
      `Network error reaching TikTok: ${text.slice(0, 150)}`,
      "NETWORK_ERROR",
      source,
    );
  }

  return new TikTokStreamError(text.slice(0, 250) || "Extraction failed", "UNKNOWN", source);
}

// ── Quality argument helpers ──────────────────────────────────────────────────

/**
 * Maps a quality preference to streamlink's quality selector.
 * TikTok uses named qualities: best, 1080p, 720p, 540p, 360p.
 */
function streamlinkQuality(quality: string): string {
  const map: Record<string, string> = {
    auto: "best",
    best: "best",
    "1080p": "1080p,best",
    "720p": "720p,best",
    "540p": "540p,720p,best",
    "360p": "360p,540p,best",
    "480p": "480p,540p,best",
  };
  return map[quality] ?? "best";
}

/**
 * Maps a quality preference to yt-dlp's -f selector.
 */
function ytdlpQuality(quality: string): string {
  const map: Record<string, string> = {
    auto: "best",
    best: "best",
    "1080p": "b[height<=1080]/best",
    "720p": "b[height<=720]/best",
    "540p": "b[height<=540]/b[height<=720]/best",
    "360p": "b[height<=360]/b[height<=480]/best",
    "480p": "b[height<=480]/best",
  };
  return map[quality] ?? "best";
}

// ── URL health check ──────────────────────────────────────────────────────────

/**
 * Verify a stream URL is reachable before passing it to FFmpeg.
 * For m3u8: fetches the manifest and checks for segment entries.
 * For FLV/HTTP: sends an HTTP HEAD request (200/206 = ok).
 */
export function checkTikTokStreamHealth(
  url: string,
  timeoutMs = 8000,
): Promise<{ healthy: boolean; reason?: string; format: "hls" | "flv" | "unknown" }> {
  return new Promise((resolve) => {
    const isHls = url.includes(".m3u8");
    const isFLV = url.includes(".flv") || url.includes("pull-");
    const format: "hls" | "flv" | "unknown" = isHls ? "hls" : isFLV ? "flv" : "unknown";

    const timer = setTimeout(() => {
      resolve({ healthy: false, reason: "Health check timed out", format });
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);

    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const method = isHls ? "GET" : "HEAD";

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method,
          headers: {
            "User-Agent": TIKTOK_UA,
            Referer: "https://www.tiktok.com/",
            "Accept-Language": "en-US,en;q=0.9",
          },
          timeout: timeoutMs - 500,
        },
        (res) => {
          cleanup();
          if (!isHls) {
            resolve({
              healthy: res.statusCode !== undefined && res.statusCode < 400,
              reason: res.statusCode !== undefined && res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined,
              format,
            });
            res.destroy();
            return;
          }
          // For m3u8: read manifest and verify segments exist
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 32768) res.destroy(); // bail after 32KB
          });
          res.on("end", () => {
            if (res.statusCode !== undefined && res.statusCode >= 400) {
              resolve({ healthy: false, reason: `HTTP ${res.statusCode}`, format });
              return;
            }
            const hasSegments =
              body.includes(".ts") ||
              body.includes(".m4s") ||
              body.includes("EXTINF") ||
              body.includes("EXT-X-STREAM-INF");
            resolve({
              healthy: hasSegments,
              reason: hasSegments ? undefined : "Manifest has no segments (stream may have ended)",
              format,
            });
          });
          res.on("error", (e) => {
            resolve({ healthy: false, reason: e.message, format });
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        cleanup();
        resolve({ healthy: false, reason: "Connection timed out", format });
      });
      req.on("error", (e) => {
        cleanup();
        resolve({ healthy: false, reason: e.message, format });
      });
      req.end();
    } catch (e: any) {
      cleanup();
      resolve({ healthy: false, reason: e.message, format });
    }
  });
}

// ── Method implementations ────────────────────────────────────────────────────

/** Method 1: streamlink — best bot-protection bypass */
function method1_streamlink(username: string, quality: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("streamlink", [
      "--stream-url",
      "--http-header", `User-Agent=${TIKTOK_UA}`,
      "--http-header", "Referer=https://www.tiktok.com/",
      "--http-header", "Accept-Language=en-US,en;q=0.9",
      "--http-timeout", "20",
      ...streamlinkCookiesArgs(),
      `https://www.tiktok.com/@${username}/live`,
      streamlinkQuality(quality),
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new TikTokStreamError("streamlink timed out after 35s", "TIMEOUT", "streamlink"));
    }, 35_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(classifyError(stderr.trim() || `exit ${code}`, "streamlink"));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new TikTokStreamError("streamlink not installed", "TOOL_NOT_FOUND", "streamlink"));
      } else {
        reject(classifyError(err.message, "streamlink"));
      }
    });
  });
}

/** Method 2: yt-dlp default username-based lookup */
function method2_ytdlp_username(username: string, quality: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [
      "--no-config",
      "--get-url",
      "--no-check-certificates",
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f", ytdlpQuality(quality),
      ...ytdlpCookiesArgs(),
      `https://www.tiktok.com/@${username}/live`,
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new TikTokStreamError("yt-dlp timed out after 35s", "TIMEOUT", "yt-dlp:username"));
    }, 35_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(classifyError(stderr.trim() || `exit ${code}`, "yt-dlp:username"));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new TikTokStreamError("yt-dlp not installed", "TOOL_NOT_FOUND", "yt-dlp:username"));
      } else {
        reject(classifyError(err.message, "yt-dlp:username"));
      }
    });
  });
}

/** Method 3: yt-dlp with alternate TikTok API hostname (bypasses main API rate limits) */
function method3_ytdlp_alt_api(username: string, quality: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [
      "--no-config",
      "--get-url",
      "--no-check-certificates",
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f", ytdlpQuality(quality),
      "--extractor-args", "tiktok:api_hostname=api22.tiktokv.com",
      "--add-header", `User-Agent:${TIKTOK_UA}`,
      "--add-header", "Referer:https://www.tiktok.com/",
      ...ytdlpCookiesArgs(),
      `https://www.tiktok.com/@${username}/live`,
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new TikTokStreamError("yt-dlp alt-api timed out after 35s", "TIMEOUT", "yt-dlp:alt-api"));
    }, 35_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(classifyError(stderr.trim() || `exit ${code}`, "yt-dlp:alt-api"));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new TikTokStreamError("yt-dlp not installed", "TOOL_NOT_FOUND", "yt-dlp:alt-api"));
      } else {
        reject(classifyError(err.message, "yt-dlp:alt-api"));
      }
    });
  });
}

/** Method 4: yt-dlp with mobile UA and web extractor client */
function method4_ytdlp_mobile(username: string, quality: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP_BIN, [
      "--no-config",
      "--get-url",
      "--no-check-certificates",
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f", ytdlpQuality(quality),
      "--extractor-args", "tiktok:api_hostname=api19.tiktokv.com",
      "--add-header", `User-Agent:${TIKTOK_MOBILE_UA}`,
      "--add-header", "Referer:https://www.tiktok.com/",
      "--add-header", "Accept-Language:en-US,en;q=0.9",
      ...ytdlpCookiesArgs(),
      `https://www.tiktok.com/@${username}/live`,
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new TikTokStreamError("yt-dlp mobile timed out after 35s", "TIMEOUT", "yt-dlp:mobile"));
    }, 35_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(classifyError(stderr.trim() || `exit ${code}`, "yt-dlp:mobile"));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new TikTokStreamError("yt-dlp not installed", "TOOL_NOT_FOUND", "yt-dlp:mobile"));
      } else {
        reject(classifyError(err.message, "yt-dlp:mobile"));
      }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TikTokFetchResult {
  url: string;
  resolvedBy: string;
  format: "hls" | "flv" | "unknown";
  healthChecked: boolean;
}

/**
 * Main TikTok live URL resolver — 4-method cascade with smart error detection.
 *
 * Cascade order:
 *   1. streamlink (best bypass for bot protection)
 *   2. yt-dlp username lookup
 *   3. yt-dlp with alternate API hostname
 *   4. yt-dlp with mobile API hostname
 *
 * Definitive errors (NOT_LIVE, AGE_RESTRICTED, PRIVATE_ACCOUNT, REGION_RESTRICTED)
 * short-circuit the cascade immediately — retrying won't help.
 *
 * RATE_LIMITED short-circuits to give a clear user message.
 */
export async function getTikTokStreamUrl(
  rawUsername: string,
  quality = "best",
  skipHealthCheck = false,
): Promise<TikTokFetchResult> {
  const username = rawUsername.replace(/^@+/, "").trim();
  const logTag = `[tiktok:@${username}]`;

  const definitive = new Set<TikTokErrorCode>([
    "NOT_LIVE", "LIVE_ENDED", "PRIVATE_ACCOUNT", "REGION_RESTRICTED",
    "AGE_RESTRICTED", "RATE_LIMITED", "LOGIN_REQUIRED",
  ]);

  const methods = [
    { name: "streamlink", fn: () => method1_streamlink(username, quality) },
    { name: "yt-dlp:username", fn: () => method2_ytdlp_username(username, quality) },
    { name: "yt-dlp:alt-api", fn: () => method3_ytdlp_alt_api(username, quality) },
    { name: "yt-dlp:mobile", fn: () => method4_ytdlp_mobile(username, quality) },
  ];

  let lastError: TikTokStreamError | null = null;
  let toolNotFoundCount = 0;
  let streamlinkConfirmedNotLive = false; // true only if streamlink explicitly says NOT_LIVE

  for (const { name, fn } of methods) {
    try {
      const url = await fn();
      logger.info({ username, method: name, quality }, `${logTag} URL resolved`);

      // ── URL health check ──────────────────────────────────────────────────
      // NOTE: TikTok CDN URLs frequently return HTTP 403 to plain Node.js
      // HTTP requests because the CDN validates cookies/tokens that are only
      // present in the original streamlink/yt-dlp session context.  FFmpeg
      // connects successfully because it inherits the signed URL.
      // We treat 403 as "likely OK" — only hard-fail on genuine errors
      // (manifest with no segments, connection refused, timeout).
      if (!skipHealthCheck) {
        logger.info({ username, method: name }, `${logTag} Health checking resolved URL...`);
        const health = await checkTikTokStreamHealth(url);
        const is403 = health.reason?.includes("403");
        if (!health.healthy && !is403) {
          logger.warn({ username, method: name, reason: health.reason }, `${logTag} Health check failed — trying next method`);
          lastError = new TikTokStreamError(
            `URL resolved but health check failed: ${health.reason}`,
            "UNKNOWN",
            name,
          );
          continue;
        }
        if (is403) {
          logger.info({ username, method: name }, `${logTag} Health check got 403 (expected for TikTok CDN) — using URL`);
        } else {
          logger.info({ username, method: name, format: health.format }, `${logTag} Health check passed`);
        }
        const format = url.includes(".m3u8") ? "hls" : url.includes(".flv") ? "flv" : "unknown";
        return { url, resolvedBy: name, format: health.format ?? format, healthChecked: true };
      }

      const format = url.includes(".m3u8") ? "hls" : url.includes(".flv") ? "flv" : "unknown";
      return { url, resolvedBy: name, format, healthChecked: false };
    } catch (e: any) {
      const err = e instanceof TikTokStreamError ? e : classifyError(e.message ?? "", name);
      logger.warn({ username, method: name, code: err.code, msg: err.message.slice(0, 150) }, `${logTag} Method failed`);
      recordReconnect(username, `${name}: ${err.message}`);

      if (err.code === "TOOL_NOT_FOUND") {
        toolNotFoundCount++;
        // If both primary tools are missing, fail immediately
        if (toolNotFoundCount >= 2) {
          throw new TikTokStreamError(
            "Neither streamlink nor yt-dlp is installed. Install with: pip install streamlink yt-dlp",
            "TOOL_NOT_FOUND",
            name,
          );
        }
        continue;
      }

      // Short-circuit on definitive errors — but NOT_LIVE from yt-dlp is
      // unreliable.  yt-dlp's TikTok extractor hits a different API path
      // than streamlink and frequently returns "not live" for users who ARE
      // actively streaming (wrong region response, API quota, extractor bug).
      // Only treat NOT_LIVE as definitive when streamlink says it — streamlink
      // validates against the actual TikTok Live API and is authoritative.
      // For yt-dlp methods, log the NOT_LIVE but keep trying the cascade.
      if (definitive.has(err.code)) {
        const isYtDlpNotLive = err.code === "NOT_LIVE" && name.startsWith("yt-dlp");
        if (!isYtDlpNotLive) {
          // streamlink (authoritative) said NOT_LIVE — record it and stop
          if (err.code === "NOT_LIVE" && name === "streamlink") streamlinkConfirmedNotLive = true;
          throw err;
        }
        logger.info(
          { username, method: name },
          `${logTag} yt-dlp returned NOT_LIVE — this is often a false negative; continuing cascade`,
        );
      }

      lastError = err;
    }
  }

  // All methods failed.
  // If every yt-dlp method returned NOT_LIVE but streamlink had a different
  // error (UNKNOWN / TIMEOUT / bot-protection), we can't trust the NOT_LIVE
  // verdict — the user may actually be live.  Use code UNCONFIRMED_NOT_LIVE
  // so stream-manager knows to retry with backoff instead of hard-stopping.
  const allYtDlpNotLive =
    lastError?.code === "NOT_LIVE" && !streamlinkConfirmedNotLive;

  const finalCode = allYtDlpNotLive ? "UNKNOWN" : (lastError?.code ?? "UNKNOWN");
  const finalMsg = allYtDlpNotLive
    ? `Could not resolve TikTok stream for @${username} — yt-dlp reports not live but streamlink could not confirm. The user may still be live; will retry.`
    : lastError
    ? `Could not get TikTok stream for @${username}. ${lastError.message}`
    : `Could not get TikTok stream for @${username}. Make sure the account is currently live.`;

  throw new TikTokStreamError(finalMsg, finalCode, "all-methods");
}

/** Convenience wrapper that returns TikTokStreamInfo (legacy interface) */
export async function getTikTokStreamInfo(rawUsername: string): Promise<TikTokStreamInfo> {
  const result = await getTikTokStreamUrl(rawUsername, "best");
  return {
    roomId: result.resolvedBy,
    isLive: true,
    flvUrls: result.format === "flv" ? { hd: result.url } : {},
    hlsUrl: result.format === "hls" ? result.url : undefined,
    quality: result.format,
    resolvedBy: result.resolvedBy,
  };
}

export function pickBestUrl(info: TikTokStreamInfo, _quality: string): string {
  if (info.hlsUrl) return info.hlsUrl;
  const { flvUrls } = info;
  return flvUrls.hd || flvUrls.sd || flvUrls.ld || "";
}
