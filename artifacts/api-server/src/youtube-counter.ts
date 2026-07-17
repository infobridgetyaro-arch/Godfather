import { storage } from "./storage";
import { broadcastStream, updateStreamOverlays, getCurrentOverlayState } from "./stream-manager";
import { logger } from "./lib/logger";

// ── Multi-key pool ──────────────────────────────────────────────────────────
// Add keys as Replit Secrets named YOUTUBE_API_KEY1, YOUTUBE_API_KEY2, …
// up to YOUTUBE_API_KEY10.  When one key's daily quota is exhausted the server
// automatically rotates to the next available key — no restart required.
//
// Legacy formats also accepted (merged in, duplicates removed):
//   YOUTUBE_API_KEY      — single key (original format)
//   YOUTUBE_API_KEYS     — comma-separated list
const apiKeys: string[] = (() => {
  const seen = new Set<string>();
  const keys: string[] = [];
  const add = (k: string | undefined) => {
    if (k && k.trim() && !seen.has(k.trim())) {
      seen.add(k.trim());
      keys.push(k.trim());
    }
  };

  // Numbered keys take priority (YOUTUBE_API_KEY1 … YOUTUBE_API_KEY10)
  for (let i = 1; i <= 10; i++) {
    add(process.env[`YOUTUBE_API_KEY${i}`]);
  }

  // Legacy: comma-separated list
  const multi = process.env.YOUTUBE_API_KEYS;
  if (multi) multi.split(",").forEach(add);

  // Legacy: single key
  add(process.env.YOUTUBE_API_KEY);
  add(process.env.GOOGLE_API_KEY);

  return keys;
})();

logger.info(
  { keyCount: apiKeys.length },
  `[youtube] Loaded ${apiKeys.length} API key(s) — will rotate automatically on quota exhaustion`
);

let currentKeyIndex = 0;
// Reset exhaustion at midnight (keys refill daily at midnight Pacific)
const exhaustedUntil = new Map<number, number>(); // index → timestamp when quota resets

function scheduleExhaustionReset() {
  const now = new Date();
  // YouTube quota resets at midnight Pacific (UTC-8 or UTC-7 DST) = 08:00 UTC
  const nextReset = new Date();
  nextReset.setUTCHours(8, 0, 0, 0);
  if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const ms = nextReset.getTime() - now.getTime();
  setTimeout(() => {
    exhaustedUntil.clear();
    logger.info("[youtube] Quota reset — all API keys are available again");
    scheduleExhaustionReset();
  }, ms);
}
scheduleExhaustionReset();

function getYouTubeApiKey(): string {
  if (apiKeys.length === 0) return "";
  return apiKeys[currentKeyIndex] ?? "";
}

/**
 * Mark current key as exhausted and rotate to the next available one.
 * Returns true if a fresh key is now active, false if all keys are exhausted.
 */
function rotateApiKey(): boolean {
  exhaustedUntil.set(currentKeyIndex, Date.now());
  logger.warn(
    { exhaustedKey: currentKeyIndex + 1, totalKeys: apiKeys.length },
    `[youtube] API key #${currentKeyIndex + 1} quota exhausted — rotating to next key`
  );
  for (let i = 1; i <= apiKeys.length; i++) {
    const next = (currentKeyIndex + i) % apiKeys.length;
    if (!exhaustedUntil.has(next)) {
      currentKeyIndex = next;
      logger.info(
        { activeKey: next + 1, totalKeys: apiKeys.length },
        `[youtube] Switched to API key #${next + 1} of ${apiKeys.length}`
      );
      return true;
    }
  }
  logger.error(
    { totalKeys: apiKeys.length },
    `[youtube] All ${apiKeys.length} API key(s) exhausted — add more keys (YOUTUBE_API_KEY1, YOUTUBE_API_KEY2 …) or wait for midnight reset`
  );
  return false;
}

function isQuotaExhausted(): boolean {
  return exhaustedUntil.size === apiKeys.length && apiKeys.length > 0;
}

let warnedNoApiKey = false;
function warnMissingApiKeyOnce(): void {
  if (warnedNoApiKey) return;
  warnedNoApiKey = true;
  logger.warn(
    "YOUTUBE_API_KEYS (or YOUTUBE_API_KEY) is not set — live chat, viewer count, and subscriber " +
    "count will not work. Add YOUTUBE_API_KEY to your environment secrets " +
    "(console.cloud.google.com → APIs → YouTube Data API v3)."
  );
}

interface ChannelStats {
  subs: string | null;
  viewers: string | null;
  liveChatId: string | null;
  lastFetch: number;
  error: "quota" | "not_found" | "api_error" | null;
}

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
  superChatAmount: string | null;
}

const statsCache = new Map<string, ChannelStats>();
const chatPageTokens = new Map<string, string | null>();
// YouTube tells us exactly when to poll next via pollingIntervalMillis.
// We store it per chatId and drive polling with setTimeout (not setInterval).
const chatPollingIntervals = new Map<string, number>();
// Conservative polling to protect quota — a single key has 10,000 units/day.
// liveChatMessages.list costs 5 units/call; at 8 s minimum that is ≤ 2,250 units/hour
// so each key lasts comfortably ≥ 2 hours before approaching exhaustion.
const DEFAULT_CHAT_POLL_MS = 10_000; // 10 s default (YouTube hint overrides if larger)
const MIN_CHAT_POLL_MS     =  8_000; //  8 s floor   — never poll faster than this

const lastSearchAt = new Map<string, number>();
// search.list costs 100 quota units per call — throttle to once per 2 hours.
// Viewer counts stay fresh via videos.list (1–2 units) on each stats cycle.
const SEARCH_INTERVAL_MS = 120 * 60 * 1000; // 2 hours

// Cache videoId per channelId so videos.list can fetch viewers without search.list
const cachedVideoIds = new Map<string, string | null>(); // channelId → videoId

const burnSentMessageIds = new Map<string, Set<string>>();

const subChartData: number[] = [];
const MAX_CHART_SAMPLES = 60;

interface ChatCache { messages: ChatMessage[]; fetchedAt: number }
const chatResultCache = new Map<string, ChatCache>();
const CHAT_CACHE_TTL = 2_500;

// Tracks which chatIds already have an active recursive poll chain.
// Prevents seedChatPollers() from spawning duplicate chains every 30 s.
const activeChatPollers = new Set<string>();

let pollingInterval: NodeJS.Timeout | null = null;
let chatInterval: NodeJS.Timeout | null = null;
let chartBroadcastInterval: NodeJS.Timeout | null = null;
let statsPolling = false;

const FETCH_TIMEOUT_MS = 8000;

function formatCount(num: number): string {
  // Show the full subscriber/viewer number with thousands separators
  // (e.g. "12,345") instead of an abbreviated "12.3K" — the overlay and
  // dashboard should always reflect the exact count.
  return num.toLocaleString("en-US");
}

// Reasons from the YouTube Data API v3 error body that mean the daily quota
// is actually used up — anything else (invalid key, API not enabled, etc.)
// should NOT be treated as exhaustion.
const QUOTA_EXHAUSTED_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

async function fetchWithKeyRotation(
  buildUrl: (key: string) => string,
  label: string
): Promise<{ res: Response; data: any } | null> {
  const triedKeys = new Set<number>();
  while (triedKeys.size < apiKeys.length) {
    const key = getYouTubeApiKey();
    if (!key) return null;
    const url = buildUrl(key);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

      if (res.status === 429) {
        // 429 is always a rate/quota issue — rotate
        const body: any = await res.json().catch(() => ({}));
        const reason = body?.error?.errors?.[0]?.reason ?? "rateLimitExceeded";
        logger.warn({ label, status: 429, keyIndex: currentKeyIndex, reason }, "[youtube] Rate limit — rotating key");
        recordApiRequest(false, `429: ${reason}`);
        triedKeys.add(currentKeyIndex);
        const rotated = rotateApiKey();
        if (!rotated) return null;
        continue;
      }

      if (res.status === 403) {
        // Read the body to find out WHY it's a 403 before deciding to rotate
        const body: any = await res.json().catch(() => ({}));
        const reason: string = body?.error?.errors?.[0]?.reason ?? "unknown";
        const isQuota = QUOTA_EXHAUSTED_REASONS.has(reason);
        if (isQuota) {
          logger.warn({ label, status: 403, keyIndex: currentKeyIndex, reason }, "[youtube] Quota exhausted — rotating key");
          recordApiRequest(false, `403 quota: ${reason}`);
          triedKeys.add(currentKeyIndex);
          const rotated = rotateApiKey();
          if (!rotated) return null;
          continue;
        } else {
          // Not a quota issue — key is invalid, API not enabled, restrictions, etc.
          // Do NOT mark as exhausted; just report the error and stop.
          logger.error(
            { label, status: 403, keyIndex: currentKeyIndex, reason, message: body?.error?.message },
            "[youtube] API key error (not quota) — check that YouTube Data API v3 is enabled and the key has no IP/referrer restrictions"
          );
          recordApiRequest(false, `403 key error: ${reason} — ${body?.error?.message ?? "check key settings"}`);
          return null;
        }
      }

      const data = await res.json();
      recordApiRequest(true);
      return { res, data };
    } catch (e) {
      logger.warn({ label, err: e }, "[youtube] Fetch error");
      recordApiRequest(false, e instanceof Error ? e.message : "network error");
      return null;
    }
  }
  return null;
}

async function fetchChannelStats(channelId: string): Promise<ChannelStats> {
  const apiKey = getYouTubeApiKey();
  const prev = statsCache.get(channelId);

  if (!apiKey) {
    warnMissingApiKeyOnce();
    return { subs: null, viewers: null, liveChatId: null, lastFetch: Date.now(), error: "api_error" };
  }

  if (isQuotaExhausted()) {
    return {
      subs: prev?.subs ?? null,
      viewers: prev?.viewers ?? null,
      liveChatId: prev?.liveChatId ?? null,
      lastFetch: Date.now(),
      error: "quota",
    };
  }

  let subs: string | null = prev?.subs ?? null;
  let viewers: string | null = prev?.viewers ?? null;
  let liveChatId: string | null = prev?.liveChatId ?? null;
  let error: ChannelStats["error"] = prev?.error ?? null;

  // --- Subscriber count (channels.list = 1 quota unit) — with auto key rotation ---
  const chanResult = await fetchWithKeyRotation(
    (key) => `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${key}`,
    "channels.list"
  );

  if (!chanResult) {
    error = "quota";
  } else if (!chanResult.res.ok) {
    logger.warn({ channelId, status: chanResult.res.status }, "[youtube] Channel stats API error");
    error = "api_error";
  } else {
    const subCount = chanResult.data.items?.[0]?.statistics?.subscriberCount;
    if (subCount !== undefined) {
      subs = formatCount(parseInt(subCount, 10));
      error = null;
      logger.info({ channelId, subs }, "[youtube] Subscriber count fetched");
    } else {
      logger.warn({ channelId }, "[youtube] Channel not found — verify channel ID");
      error = "not_found";
    }
  }

  // --- Live video & viewer count (throttled) ---
  // search.list = 100 quota units → run at most once per SEARCH_INTERVAL_MS
  // videos.list = 1–2 quota units  → run every poll cycle using the cached videoId
  const now = Date.now();
  const lastSearch = lastSearchAt.get(channelId) ?? 0;
  const shouldSearch = now - lastSearch >= SEARCH_INTERVAL_MS;

  if (shouldSearch && !isQuotaExhausted()) {
    lastSearchAt.set(channelId, now);
    try {
      logger.info({ channelId }, "[youtube] Running search.list for live video (100 quota units)");
      const searchResult = await fetchWithKeyRotation(
        (key) => `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${key}`,
        "search.list"
      );

      if (!searchResult) {
        if (error !== "quota") error = "quota";
      } else if (!searchResult.res.ok) {
        logger.warn({ channelId }, "[youtube] Live search API error");
      } else {
        const videoId: string | null = searchResult.data.items?.[0]?.id?.videoId ?? null;
        cachedVideoIds.set(channelId, videoId);
        if (!videoId) {
          logger.info({ channelId }, "[youtube] No active live video found");
          liveChatId = null;
          viewers = null;
        }
      }
    } catch (e) {
      logger.warn({ channelId, err: e }, "[youtube] search.list failed");
    }
  } else {
    const nextIn = Math.round((SEARCH_INTERVAL_MS - (now - lastSearch)) / 1000);
    logger.debug({ channelId, nextSearchIn: nextIn + "s" }, "[youtube] Skipping search.list — using cached videoId");
  }

  // --- Fresh viewer count via videos.list (1–2 quota units) every poll cycle ---
  const videoId = cachedVideoIds.get(channelId) ?? null;
  if (videoId && !isQuotaExhausted()) {
    try {
      const vidResult = await fetchWithKeyRotation(
        (key) => `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${key}`,
        "videos.list"
      );
      if (vidResult?.res.ok) {
        const details = vidResult.data.items?.[0]?.liveStreamingDetails;
        if (details?.concurrentViewers !== undefined) {
          viewers = formatCount(parseInt(details.concurrentViewers, 10));
        }
        if (details?.activeLiveChatId) {
          liveChatId = details.activeLiveChatId;
        }
      }
    } catch (e) {
      logger.warn({ channelId, err: e }, "[youtube] videos.list viewer fetch failed");
    }
  }

  const result: ChannelStats = { subs, viewers, liveChatId, lastFetch: Date.now(), error };
  statsCache.set(channelId, result);
  return result;
}

export async function fetchLiveChat(streamId: string, chatId: string): Promise<ChatMessage[]> {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    warnMissingApiKeyOnce();
    return [];
  }
  if (isQuotaExhausted()) {
    return chatResultCache.get(chatId)?.messages ?? [];
  }

  const cached = chatResultCache.get(chatId);
  if (cached && Date.now() - cached.fetchedAt < CHAT_CACHE_TTL) {
    return cached.messages;
  }

  const pageToken = chatPageTokens.get(chatId) ?? undefined;

  const result = await fetchWithKeyRotation((key) => {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", chatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("key", key);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    return url.toString();
  }, "liveChat.messages");

  if (!result || !result.res.ok) {
    return chatResultCache.get(chatId)?.messages ?? [];
  }

  const data = result.data;
  if (data.nextPageToken) {
    chatPageTokens.set(chatId, data.nextPageToken);
  }
  // Honour YouTube's own polling hint — it tells us exactly when new messages
  // will be available, so we use it to drive the next poll via setTimeout.
  if (typeof data.pollingIntervalMillis === "number" && data.pollingIntervalMillis > 0) {
    chatPollingIntervals.set(chatId, Math.max(data.pollingIntervalMillis, MIN_CHAT_POLL_MS));
  }

  const messages: ChatMessage[] = (data.items ?? []).map((item: any) => {
    // Build the display text.  For regular text messages, YouTube populates
    // snippet.displayMessage which already contains Unicode emoji.
    // For messages that include custom YouTube emoji (paid memberships etc.)
    // we reassemble the text from the structured "runs" array so that the
    // shortcode (e.g. ":_wave:") is included rather than being silently dropped.
    let text = item.snippet?.displayMessage ?? "";
    const runs: any[] | undefined =
      item.snippet?.textMessageEvent?.messageText?.runs ??
      item.snippet?.superChatEvent?.userComment?.runs;
    if (Array.isArray(runs) && runs.length) {
      const rebuilt = runs.map((run: any) => {
        if (typeof run.text === "string") return run.text;
        if (run.emoji) {
          // Prefer the first shortcut (":_wave:"), fall back to emojiId or "?"
          return run.emoji.shortcuts?.[0] ?? run.emoji.emojiId ?? "?";
        }
        return "";
      }).join("");
      if (rebuilt.trim()) text = rebuilt;
    }
    return {
      id: item.id,
      authorName: item.authorDetails?.displayName ?? "Unknown",
      authorPhoto: item.authorDetails?.profileImageUrl ?? "",
      text,
      publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
      isMember: item.authorDetails?.isChatSponsor ?? false,
      isModerator: item.authorDetails?.isChatModerator ?? false,
      isOwner: item.authorDetails?.isChatOwner ?? false,
      superChatAmount: item.snippet?.superChatDetails?.amountDisplayString ?? null,
    };
  });

  chatResultCache.set(chatId, { messages, fetchedAt: Date.now() });
  return messages;
}

/**
 * Bypass the TTL cache and immediately fetch the latest chat messages.
 * Safe to call concurrently — deduplicated by the existing fetchLiveChat logic.
 */
export async function forceRefreshLiveChat(streamId: string, chatId: string): Promise<ChatMessage[]> {
  chatResultCache.delete(chatId);
  return fetchLiveChat(streamId, chatId);
}

/**
 * Return the most-recently cached chat messages for a chatId WITHOUT
 * making any YouTube API calls.
 *
 * Use this in REST endpoints that serve the frontend — the background
 * scheduleChatPoll chain is the ONLY source that should call the YouTube
 * API for chat.  Letting REST endpoints also call fetchLiveChat caused
 * duplicate YouTube API quota consumption because every frontend poll
 * (every 5 s from the camera page) bypassed the 2.5 s TTL cache and hit
 * YouTube directly in parallel with the already-running background poller.
 */
export function getCachedChatMessages(chatId: string): ChatMessage[] {
  return chatResultCache.get(chatId)?.messages ?? [];
}

export function getLiveStats(streamId: string): { subs: string | null; viewers: string | null } {
  const stream = storage.getStream(streamId);
  if (!stream?.youtubeChannelId) return { subs: null, viewers: null };
  const cached = statsCache.get(stream.youtubeChannelId);
  return { subs: cached?.subs ?? null, viewers: cached?.viewers ?? null };
}

export function getLiveChatId(streamId: string): string | null {
  const stream = storage.getStream(streamId);
  if (!stream?.youtubeChannelId) return null;
  return statsCache.get(stream.youtubeChannelId)?.liveChatId ?? null;
}

/**
 * Force an immediate, un-throttled live-status + chat check for one stream's
 * channel. Used by the "Force Refresh" button — a plain triggerStatsPollNow()
 * is not enough because fetchChannelStats() skips the search.list call (the
 * one that actually detects whether the channel is live) unless the 30-min
 * SEARCH_INTERVAL_MS throttle window has elapsed. That made "Force Refresh"
 * silently no-op / return stale data whenever it was clicked less than 30 min
 * after the last automatic poll — exactly when a user is most likely to
 * click it (right after going live, or after YouTube briefly hiccups).
 */
export async function forceLiveStatusRefresh(streamId: string): Promise<ChannelStats | null> {
  const stream = storage.getStream(streamId);
  const channelId = stream?.youtubeChannelId;
  if (!channelId) return null;

  // Bypass the search.list throttle and the cached-video-id short-circuit so
  // this call always re-checks live status from scratch.
  lastSearchAt.delete(channelId);
  cachedVideoIds.delete(channelId);

  const stats = await fetchChannelStats(channelId);
  const streamsForChannel = storage.getStreams().filter((s) => s.youtubeChannelId === channelId);
  for (const s of streamsForChannel) {
    broadcastStream(s.id, "stats", {
      subs: stats.subs,
      viewers: stats.viewers,
      hasChat: !!stats.liveChatId,
      error: stats.error ?? null,
    });
  }
  updateStreamOverlays({ subs: stats.subs, viewers: stats.viewers });
  if (stats.liveChatId) seedChatPollers();
  return stats;
}

export function triggerStatsPollNow(): void {
  if (statsPolling) return;
  statsPolling = true;
  const streams = storage.getStreams();
  const seen = new Set<string>();
  const tasks = streams
    .filter((s) => s.youtubeChannelId && !seen.has(s.youtubeChannelId))
    .map(async (stream) => {
      seen.add(stream.youtubeChannelId!);
      try {
        const stats = await fetchChannelStats(stream.youtubeChannelId!);
        const streamsForChannel = storage.getStreams().filter(
          (s) => s.youtubeChannelId === stream.youtubeChannelId
        );
        for (const s of streamsForChannel) {
          broadcastStream(s.id, "stats", {
            subs: stats.subs,
            viewers: stats.viewers,
            hasChat: !!stats.liveChatId,
          });
        }
        updateStreamOverlays({ subs: stats.subs, viewers: stats.viewers });
      } catch (e) {
        logger.warn({ channelId: stream.youtubeChannelId, err: e }, "[youtube] Immediate stats poll error");
      }
    });
  Promise.all(tasks).finally(() => { statsPolling = false; });
}

// setTimeout-based recursive poller — respects YouTube's pollingIntervalMillis.
// activeChatPollers guards against duplicate chains: seedChatPollers runs every
// 30 s but must NOT spawn a second chain for a chatId that already has one.
// Hoisted to module scope (not nested in startLiveCountPolling) so it can also
// be triggered immediately from primeLiveDetection() right after GO LIVE.
const scheduleChatPoll = (chatId: string, streamId: string, delayMs: number) => {
  // Exit if global polling was stopped
  if (!chatInterval) { activeChatPollers.delete(chatId); return; }
  // Exit if this chatId was removed from active pollers (e.g. stream stopped)
  if (!activeChatPollers.has(chatId) && delayMs > 0) return;
  activeChatPollers.add(chatId);
  setTimeout(() => {
    if (!chatInterval) { activeChatPollers.delete(chatId); return; }
    // Guard: if the chatId was cleared by clearStreamChatState, exit the chain.
    if (!activeChatPollers.has(chatId)) return;
    (async () => {
      try {
        // Guard: skip broadcast/overlay update if the stream is no longer active.
        // Prevents stale pollers from re-injecting chat after stopStream().
        const streamStatus = storage.getStream(streamId)?.status;
        if (!streamStatus || streamStatus === "idle" || streamStatus === "error") {
          activeChatPollers.delete(chatId);
          logger.info({ streamId, chatId }, "[chat] Stream idle — stopping chat poller chain");
          return;
        }

        const messages = await fetchLiveChat(streamId, chatId);
        if (messages.length > 0) {
          broadcastStream(streamId, "chat", messages);
          logger.info({ streamId, chatId, count: messages.length }, "[chat] Broadcast chat messages via WebSocket");

          if (!burnSentMessageIds.has(streamId)) burnSentMessageIds.set(streamId, new Set());
          const sentIds = burnSentMessageIds.get(streamId)!;
          const newBurnMsgs = messages.filter((m) => !sentIds.has(m.id));
          if (newBurnMsgs.length > 0) {
            newBurnMsgs.forEach((m) => sentIds.add(m.id));
            if (sentIds.size > 2000) {
              const oldest = Array.from(sentIds).slice(0, 500);
              oldest.forEach((id) => sentIds.delete(id));
            }
            const receiveTs = Date.now();
            const incoming = newBurnMsgs.slice(-10).map((m) => ({
              name: m.authorName,
              text: m.text,
              photo: m.authorPhoto || undefined,
              color: m.isModerator ? "#34d399" : m.isMember ? "#a78bfa" : undefined,
              ts: receiveTs,
            }));
            const CHAT_BURN_MAX = 20;
            const currentMessages = getCurrentOverlayState().chatBurnMessages ?? [];
            const accumulated = [...currentMessages, ...incoming].slice(-CHAT_BURN_MAX);
            const currentState = getCurrentOverlayState();
            if (!currentState.chatBurnActive) {
              logger.info({ streamId, newMessages: incoming.length }, "[chat-burn] New chat messages received but chatBurnActive=false — enable via Chat tab to show overlay");
            } else {
              logger.info({ streamId, newMessages: incoming.length, totalInWindow: accumulated.length }, "[chat-burn] Dispatching chat burn messages to overlay");
            }
            updateStreamOverlays({ chatBurnMessages: accumulated });
          }
        }
      } catch (e) {
        logger.warn({ streamId, err: e }, "Chat poll error");
      }
      // Re-schedule using the interval YouTube told us (or default)
      const next = chatPollingIntervals.get(chatId) ?? DEFAULT_CHAT_POLL_MS;
      scheduleChatPoll(chatId, streamId, next);
    })();
  }, delayMs);
};

// Seed: kick off a poll per active stream. Skips chatIds already being polled
// to prevent duplicate recursive chains from accumulating over time.
// Exported so primeLiveDetection() can trigger it immediately once a liveChatId
// is resolved, instead of waiting for the ambient 30 s re-seed interval.
export const seedChatPollers = () => {
  const streams = storage.getStreams();
  for (const stream of streams) {
    if (!stream.youtubeChannelId) continue;
    const chatId = statsCache.get(stream.youtubeChannelId)?.liveChatId;
    if (!chatId) continue;
    if (activeChatPollers.has(chatId)) continue; // already running — skip
    logger.info({ streamId: stream.id, chatId }, "[chat] Starting chat poller for stream");
    scheduleChatPoll(chatId, stream.id, 0); // start immediately (delay=0)
  }
};

/**
 * Called right when a stream goes live (GO LIVE). Subscriber count works via
 * channels.list regardless of live status, so it's already cached from the
 * ambient poller and shows up instantly. Viewers + chat, however, depend on
 * YouTube's search.list resolving the *active live video* — which is throttled
 * to once every 30 min per channel (SEARCH_INTERVAL_MS) to conserve quota.
 * If that last search happened before the broadcast went live, viewers/chat
 * would otherwise stay blank for up to 30 minutes.
 *
 * This forces a fresh search.list lookup right away and retries a few times
 * with backoff (YouTube can take a few seconds to mark a broadcast "live"),
 * broadcasting stats + kicking off the chat poller as soon as it resolves.
 */
export function primeLiveDetection(streamId: string, channelId: string | null | undefined): void {
  if (!channelId) return;

  // Bypass the 30-min search throttle so search.list runs again immediately.
  lastSearchAt.delete(channelId);
  cachedVideoIds.delete(channelId);

  const retryDelaysMs = [0, 4_000, 9_000, 15_000, 25_000, 40_000];
  let attempt = 0;

  const attemptFetch = async () => {
    try {
      const stats = await fetchChannelStats(channelId);
      const streamsForChannel = storage.getStreams().filter((s) => s.youtubeChannelId === channelId);
      for (const s of streamsForChannel) {
        broadcastStream(s.id, "stats", {
          subs: stats.subs,
          viewers: stats.viewers,
          hasChat: !!stats.liveChatId,
          error: stats.error ?? null,
        });
      }
      updateStreamOverlays({ subs: stats.subs, viewers: stats.viewers });

      if (stats.liveChatId) {
        logger.info(
          { streamId, chatId: stats.liveChatId, attempt },
          "[youtube] Live video detected after GO LIVE — starting chat/viewer updates immediately"
        );
        seedChatPollers();
        return; // found it — stop retrying
      }
    } catch (e) {
      logger.warn({ streamId, channelId, err: e }, "[youtube] primeLiveDetection fetch error");
    }

    attempt++;
    if (attempt < retryDelaysMs.length) {
      setTimeout(attemptFetch, retryDelaysMs[attempt]);
    } else {
      logger.info(
        { streamId, channelId },
        "[youtube] Live video not detected yet after GO LIVE retries — will pick up on next 60s ambient poll"
      );
    }
  };

  attemptFetch();
}

export function startLiveCountPolling() {
  if (pollingInterval) return;

  const poll = async () => {
    if (statsPolling) return;
    statsPolling = true;
    try {
      const streams = storage.getStreams();
      const seen = new Set<string>();

      for (const stream of streams) {
        if (!stream.youtubeChannelId || seen.has(stream.youtubeChannelId)) continue;
        seen.add(stream.youtubeChannelId);

        try {
          const stats = await fetchChannelStats(stream.youtubeChannelId);
          const streamsForChannel = storage.getStreams().filter(
            (s) => s.youtubeChannelId === stream.youtubeChannelId
          );
          for (const s of streamsForChannel) {
            broadcastStream(s.id, "stats", {
              subs: stats.subs,
              viewers: stats.viewers,
              hasChat: !!stats.liveChatId,
              error: stats.error ?? null,
            });
          }
          if (stats.subs) {
            const cleanSubs = stats.subs.replace(/,/g, "");
            let rawNum = parseFloat(cleanSubs);
            if (cleanSubs.endsWith("M")) rawNum *= 1_000_000;
            else if (cleanSubs.endsWith("K")) rawNum *= 1_000;
            if (!isNaN(rawNum)) {
              subChartData.push(rawNum);
              if (subChartData.length > MAX_CHART_SAMPLES)
                subChartData.splice(0, subChartData.length - MAX_CHART_SAMPLES);
            }
          }
          updateStreamOverlays({ subs: stats.subs, viewers: stats.viewers, subChartData: [...subChartData] });
          // If we just resolved a liveChatId, immediately seed a chat poller
          // rather than waiting up to 30 s for the next seedChatPollers interval.
          if (stats.liveChatId) {
            for (const s of streamsForChannel) {
              if (!activeChatPollers.has(stats.liveChatId)) {
                logger.info({ streamId: s.id, chatId: stats.liveChatId }, "[chat] liveChatId resolved — starting chat poller immediately");
                scheduleChatPoll(stats.liveChatId, s.id, 0);
              }
            }
          }
        } catch (e) {
          logger.warn({ channelId: stream.youtubeChannelId, err: e }, "Stats poll error");
        }
      }
    } finally {
      statsPolling = false;
    }
  };

  poll();
  pollingInterval = setInterval(poll, 60_000); // 60 s — channels.list (1 unit) + videos.list (1–2 units) per cycle

  // ── Re-broadcast cached stats every 10 s so the chart animates live ──────
  // No new API calls — just push what we already have so the frontend chart
  // gets a fresh data point and the animated numbers keep moving smoothly.
  chartBroadcastInterval = setInterval(() => {
    const streams = storage.getStreams();
    const seen = new Set<string>();
    for (const stream of streams) {
      if (!stream.youtubeChannelId || seen.has(stream.youtubeChannelId)) continue;
      seen.add(stream.youtubeChannelId);
      const cached = statsCache.get(stream.youtubeChannelId);
      if (!cached) continue;
      const streamsForChannel = storage.getStreams().filter(
        (s) => s.youtubeChannelId === stream.youtubeChannelId
      );
      for (const s of streamsForChannel) {
        broadcastStream(s.id, "stats", {
          subs: cached.subs,
          viewers: cached.viewers,
          hasChat: !!cached.liveChatId,
          error: cached.error ?? null,
        });
      }
    }
    if (subChartData.length > 0) {
      updateStreamOverlays({ subChartData: [...subChartData] });
    }
  }, 10_000);

  // scheduleChatPoll / seedChatPollers are module-scope functions (defined above
  // startLiveCountPolling) so primeLiveDetection() can also trigger them immediately.
  seedChatPollers();

  // Re-seed every 30 s to pick up newly added streams / newly resolved chatIds
  // (each individual chatId is already being polled by its own setTimeout chain above)
  chatInterval = setInterval(seedChatPollers, 30_000);
}

export function stopLiveCountPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
  if (chartBroadcastInterval) { clearInterval(chartBroadcastInterval); chartBroadcastInterval = null; }
  activeChatPollers.clear();
}

/**
 * Clear ephemeral chat state for a single stream when it stops.
 * Scoped to the stream's own chatId so multi-stream sessions are unaffected.
 * Called by stream-manager on both manual stop and auto-restart paths.
 */
export function clearStreamChatState(streamId: string): void {
  // Per-stream dedup set — always clear by streamId
  burnSentMessageIds.delete(streamId);

  // chatPageTokens / chatResultCache / activeChatPollers are keyed by chatId.
  // Resolve the chatId from statsCache (in-memory, no API call) and delete
  // only that stream's entries so other concurrent streams keep their state.
  const stream = storage.getStream(streamId);
  if (stream?.youtubeChannelId) {
    const chatId = statsCache.get(stream.youtubeChannelId)?.liveChatId;
    if (chatId) {
      chatPageTokens.delete(chatId);
      chatResultCache.delete(chatId);
      // Remove from active pollers so the recursive chain self-terminates
      // on its next scheduled tick (the chatId guard in scheduleChatPoll fires).
      activeChatPollers.delete(chatId);
      logger.info({ streamId, chatId }, "[youtube] Chat state cleared — ready for next stream");
      return;
    }
  }
  logger.info({ streamId }, "[youtube] Chat state cleared (no chatId resolved)");
}

/** Exposed for the /api/youtube/key-status debug endpoint */
export function getApiKeyStatus(): { total: number; active: number; exhausted: number[]; currentIndex: number } {
  return {
    total: apiKeys.length,
    active: currentKeyIndex,
    exhausted: Array.from(exhaustedUntil.keys()),
    currentIndex: currentKeyIndex,
  };
}

// ── Per-key detailed telemetry ───────────────────────────────────────────────
interface KeyTelemetry {
  totalRequests: number;
  requestTimestamps: number[];  // rolling window for req/min
  errorsTotal: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMsg: string | null;
}
const keyTelemetry: Map<number, KeyTelemetry> = new Map();
const startedAt = Date.now();

const eventLog: Array<{ ts: number; type: "rotate" | "exhaust" | "error" | "success"; keyIndex: number; msg: string }> = [];

function getTelemetry(idx: number): KeyTelemetry {
  if (!keyTelemetry.has(idx)) {
    keyTelemetry.set(idx, {
      totalRequests: 0,
      requestTimestamps: [],
      errorsTotal: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
  }
  return keyTelemetry.get(idx)!;
}

export function recordApiRequest(success: boolean, errorMsg?: string) {
  const idx = currentKeyIndex;
  const t   = getTelemetry(idx);
  const now = Date.now();
  t.totalRequests++;
  t.requestTimestamps.push(now);
  // Keep only last 2 minutes for rolling window
  const cutoff = now - 120000;
  t.requestTimestamps = t.requestTimestamps.filter((ts) => ts > cutoff);
  if (success) {
    t.lastSuccessAt = now;
    // If this key was previously marked exhausted but a call just succeeded,
    // the quota has actually reset (or it was a false-positive exhaustion).
    // Auto-clear it so the panel reflects the real working state immediately.
    if (exhaustedUntil.has(idx)) {
      exhaustedUntil.delete(idx);
      eventLog.push({ ts: now, type: "success", keyIndex: idx, msg: `Key #${idx + 1}: quota auto-recovered on successful response` });
      logger.info({ keyIndex: idx + 1 }, "[youtube] Key exhaustion auto-cleared after successful API response");
    } else if (t.totalRequests % 50 === 1) {
      eventLog.push({ ts: now, type: "success", keyIndex: idx, msg: `Key #${idx + 1}: ${t.totalRequests} requests served` });
    }
  } else {
    t.errorsTotal++;
    t.lastErrorAt  = now;
    t.lastErrorMsg = errorMsg || "Unknown error";
    eventLog.push({ ts: now, type: "error", keyIndex: idx, msg: `Key #${idx + 1}: ${errorMsg || "error"}` });
  }
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

export function recordKeyRotation(reason: string) {
  const now = Date.now();
  const idx = currentKeyIndex;
  eventLog.push({ ts: now, type: "rotate", keyIndex: idx, msg: `Rotated to Key #${idx + 1}: ${reason}` });
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

export function forceRotateToKey(targetIndex: number): boolean {
  if (targetIndex < 0 || targetIndex >= apiKeys.length) return false;
  if (exhaustedUntil.has(targetIndex)) return false;
  currentKeyIndex = targetIndex;
  recordKeyRotation(`Manual switch to Key #${targetIndex + 1}`);
  return true;
}

/**
 * Manually clear the exhausted status for one or all keys.
 * Useful when keys were wrongly marked exhausted (e.g. due to a non-quota
 * 403 error like an invalid key or API-not-enabled response) or when the
 * operator wants to force-activate a key before the midnight reset.
 */
export function clearKeyExhaustion(targetIndex?: number): { cleared: number[] } {
  const cleared: number[] = [];
  if (targetIndex === undefined) {
    // Clear all
    const keys = Array.from(exhaustedUntil.keys());
    exhaustedUntil.clear();
    cleared.push(...keys);
    logger.info({ cleared }, "[youtube] All key exhaustion states cleared manually");
  } else {
    if (exhaustedUntil.has(targetIndex)) {
      exhaustedUntil.delete(targetIndex);
      cleared.push(targetIndex);
      logger.info({ keyIndex: targetIndex }, `[youtube] Key #${targetIndex + 1} exhaustion cleared manually`);
    }
  }
  // If the current key was exhausted, make it active again
  if (cleared.includes(currentKeyIndex) || exhaustedUntil.size === 0) {
    const firstAvail = apiKeys.findIndex((_, i) => !exhaustedUntil.has(i));
    if (firstAvail >= 0) currentKeyIndex = firstAvail;
  }
  return { cleared };
}

function computeHealthScore(idx: number): number {
  if (exhaustedUntil.has(idx)) return 0;
  const t = keyTelemetry.get(idx);
  if (!t || t.totalRequests === 0) return 100;
  const errorRate = t.totalRequests > 0 ? t.errorsTotal / t.totalRequests : 0;
  const now = Date.now();
  const recentReqs = t.requestTimestamps.filter((ts) => ts > now - 60000).length;
  const ratePenalty = recentReqs > 45 ? Math.min(30, (recentReqs - 45) * 2) : 0;
  return Math.max(0, Math.round(100 - errorRate * 100 - ratePenalty));
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 6) + "••••••••" + key.slice(-4);
}

export function getDetailedApiStatus() {
  const now = Date.now();
  // Compute quota reset (midnight Pacific = 08:00 UTC)
  const nextReset = new Date();
  nextReset.setUTCHours(8, 0, 0, 0);
  if (nextReset.getTime() <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const quotaResetAt = nextReset.getTime();

  const keys = apiKeys.map((_, idx) => {
    const t = keyTelemetry.get(idx);
    const recentReqs = t
      ? t.requestTimestamps.filter((ts) => ts > now - 60000).length
      : 0;
    return {
      index: idx,
      masked: maskApiKey(apiKeys[idx]),
      isActive: idx === currentKeyIndex && !exhaustedUntil.has(idx),
      isExhausted: exhaustedUntil.has(idx),
      totalRequests: t?.totalRequests ?? 0,
      requestsLastMinute: recentReqs,
      errorsTotal: t?.errorsTotal ?? 0,
      lastSuccessAt: t?.lastSuccessAt ?? null,
      lastErrorAt: t?.lastErrorAt ?? null,
      lastErrorMsg: t?.lastErrorMsg ?? null,
      quotaResetAt: exhaustedUntil.has(idx) ? quotaResetAt : null,
      healthScore: computeHealthScore(idx),
    };
  });

  const totalRequests = keys.reduce((s, k) => s + k.totalRequests, 0);
  const totalErrors   = keys.reduce((s, k) => s + k.errorsTotal, 0);

  return {
    totalKeys: apiKeys.length,
    activeKeyIndex: currentKeyIndex,
    allExhausted: exhaustedUntil.size === apiKeys.length && apiKeys.length > 0,
    quotaResetAt,
    keys,
    totalRequestsAllKeys: totalRequests,
    totalErrors,
    uptimeSec: Math.round((now - startedAt) / 1000),
    eventLog: [...eventLog],
  };
}
