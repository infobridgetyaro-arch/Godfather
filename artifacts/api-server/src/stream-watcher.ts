/**
 * Stream Watcher — Auto-refresh polling for TikTok and YouTube
 *
 * When a creator is not live yet, the watcher polls every 30 seconds.
 * The moment the stream comes online, it broadcasts a "stream_live" event
 * via WebSocket so the frontend can display it or auto-start the stream.
 *
 * Each stream can be independently watched/unwatched.
 * Logs are stored per-username/URL for debugging.
 */

import { logger } from "./lib/logger";
import {
  getTikTokStreamUrl,
  checkTikTokStreamHealth,
  TikTokStreamError,
} from "./tiktok-extractor";
import {
  getYouTubeStreamUrl,
  normaliseYouTubeUrl,
  extractChannelIdentifier,
  YouTubeStreamError,
} from "./youtube-source";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WatcherStatus =
  | "polling"      // actively polling — creator not yet live
  | "live"         // creator is live — URL resolved
  | "error"        // persistent error after maxRetries
  | "stopped";     // manually stopped

export type SourceType = "tiktok" | "youtube";

export interface WatchEntry {
  streamId: string;
  sourceType: SourceType;
  /** @username for TikTok, channel URL/handle for YouTube */
  identifier: string;
  status: WatcherStatus;
  resolvedUrl?: string;
  resolvedBy?: string;
  lastChecked?: number;
  nextCheckAt?: number;
  consecutiveErrors: number;
  totalPolls: number;
  startedAt: number;
  logs: string[];
}

type BroadcastFn = (streamId: string, type: string, data: unknown) => void;
type GlobalBroadcastFn = (type: string, data: unknown) => void;

// ── Module state ──────────────────────────────────────────────────────────────

const watchers = new Map<string, WatchEntry>();
const intervals = new Map<string, NodeJS.Timeout>();

let _broadcast: BroadcastFn = () => {};
let _globalBroadcast: GlobalBroadcastFn = () => {};

/** Must be called once at startup with the broadcast functions from stream-manager */
export function initWatcher(
  broadcastStream: BroadcastFn,
  broadcastGlobal: GlobalBroadcastFn,
): void {
  _broadcast = broadcastStream;
  _globalBroadcast = broadcastGlobal;
}

// ── Logging ───────────────────────────────────────────────────────────────────

const MAX_LOGS = 50;
const POLL_INTERVAL_MS = 30_000;
const MAX_ERRORS_BEFORE_STOP = 10; // ~5 minutes of consecutive failures → pause

function watcherLog(entry: WatchEntry, msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  entry.logs.push(line);
  if (entry.logs.length > MAX_LOGS) entry.logs.shift();
  logger.info({ streamId: entry.streamId, identifier: entry.identifier }, `[watcher] ${msg}`);
}

// ── Poll logic ────────────────────────────────────────────────────────────────

async function pollOnce(entry: WatchEntry): Promise<void> {
  entry.totalPolls++;
  entry.lastChecked = Date.now();

  try {
    let resolvedUrl: string;
    let resolvedBy: string;

    if (entry.sourceType === "tiktok") {
      const result = await getTikTokStreamUrl(entry.identifier, "best", true);
      resolvedUrl = result.url;
      resolvedBy = result.resolvedBy;
    } else {
      resolvedUrl = await getYouTubeStreamUrl(entry.identifier);
      resolvedBy = "youtube-resolver";
    }

    // Creator is live!
    entry.status = "live";
    entry.resolvedUrl = resolvedUrl;
    entry.resolvedBy = resolvedBy;
    entry.consecutiveErrors = 0;
    watcherLog(entry, `✓ Now LIVE! URL resolved via ${resolvedBy}`);

    // Broadcast to all WebSocket clients
    _broadcast(entry.streamId, "watcher_live", {
      streamId: entry.streamId,
      identifier: entry.identifier,
      sourceType: entry.sourceType,
      resolvedUrl,
      resolvedBy,
    });
    _globalBroadcast("watcher_live", {
      streamId: entry.streamId,
      identifier: entry.identifier,
    });

    // Stop polling — stream is live
    stopWatching(entry.streamId);
  } catch (e: any) {
    const code =
      e instanceof TikTokStreamError
        ? e.code
        : e instanceof YouTubeStreamError
        ? e.code
        : "UNKNOWN";

    const isNotLive = code === "NOT_LIVE" || code === "LIVE_ENDED" || code === "SCHEDULED";
    entry.consecutiveErrors = isNotLive ? 0 : entry.consecutiveErrors + 1;

    const shortMsg = e.message?.slice(0, 120) ?? "unknown error";
    watcherLog(entry, `Poll #${entry.totalPolls}: ${isNotLive ? "not live yet" : shortMsg} (${code})`);

    // Broadcast status update to frontend
    _broadcast(entry.streamId, "watcher_status", {
      streamId: entry.streamId,
      status: entry.status,
      identifier: entry.identifier,
      lastChecked: entry.lastChecked,
      nextCheckAt: Date.now() + POLL_INTERVAL_MS,
      totalPolls: entry.totalPolls,
      consecutiveErrors: entry.consecutiveErrors,
      errorCode: code,
      message: isNotLive ? `@${entry.identifier} is not live yet` : shortMsg,
    });

    // Pause watcher after too many non-NOT_LIVE errors (e.g. region block, login required)
    if (!isNotLive && entry.consecutiveErrors >= MAX_ERRORS_BEFORE_STOP) {
      entry.status = "error";
      watcherLog(entry, `⚠ Paused after ${entry.consecutiveErrors} consecutive errors: ${shortMsg}`);
      _broadcast(entry.streamId, "watcher_status", {
        streamId: entry.streamId,
        status: "error",
        identifier: entry.identifier,
        errorCode: code,
        message: `Watcher paused: ${shortMsg}`,
      });
      stopWatching(entry.streamId);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start watching a stream. Polls every 30 seconds until it goes live.
 * If already watching, resets and restarts.
 */
export function startWatching(
  streamId: string,
  sourceType: SourceType,
  identifier: string,
): WatchEntry {
  // Clean up any existing watcher for this stream
  stopWatching(streamId);

  const entry: WatchEntry = {
    streamId,
    sourceType,
    identifier: identifier.replace(/^@+/, "").trim(),
    status: "polling",
    consecutiveErrors: 0,
    totalPolls: 0,
    startedAt: Date.now(),
    logs: [],
  };

  watchers.set(streamId, entry);
  watcherLog(entry, `Started watching ${sourceType === "tiktok" ? "@" : ""}${entry.identifier} — polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately, then on interval
  pollOnce(entry).catch(() => {});
  const interval = setInterval(() => {
    if (entry.status === "polling") {
      entry.nextCheckAt = Date.now() + POLL_INTERVAL_MS;
      pollOnce(entry).catch(() => {});
    }
  }, POLL_INTERVAL_MS);

  intervals.set(streamId, interval);
  return entry;
}

/** Stop watching a stream. Safe to call even if not watching. */
export function stopWatching(streamId: string): void {
  const interval = intervals.get(streamId);
  if (interval) {
    clearInterval(interval);
    intervals.delete(streamId);
  }
  const entry = watchers.get(streamId);
  if (entry && entry.status === "polling") {
    entry.status = "stopped";
    watcherLog(entry, "Watcher stopped");
  }
}

/** Get the current watcher entry for a stream, or null. */
export function getWatcherEntry(streamId: string): WatchEntry | null {
  return watchers.get(streamId) ?? null;
}

/** Get all active watcher entries. */
export function getAllWatchers(): WatchEntry[] {
  return [...watchers.values()];
}

/** Returns true if a stream is currently being watched. */
export function isWatching(streamId: string): boolean {
  const entry = watchers.get(streamId);
  return entry?.status === "polling";
}

/** Remove a watcher entirely from the registry. */
export function removeWatcher(streamId: string): void {
  stopWatching(streamId);
  watchers.delete(streamId);
}
