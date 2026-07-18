import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "./lib/logger";
import { YTDLP_BIN } from "./lib/ytdlp";
import type { Server } from "http";
import { WebSocketServer } from "ws";
import session from "express-session";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import { storage } from "./storage";
import { insertStreamSchema } from "./schema";
import {
  startStream,
  stopStream,
  restartStream,
  toggleMute,
  addWSClient,
  broadcastGlobal,
  broadcastStream,
  updateStreamOverlays,
  setCameraLink,
  clearCameraLink,
  feedMicAudio,
  updateStreamVolume,
  writeToBrowserCamera,
  browserCameraStreams,
  getStreamLogBuffers,
  setScreenShareFrameForAll,
  preloadBreakVideo,
  getBreakVideoPreloadStatus,
  initStreamManager,
  getHealthSnapshot,
  getAllHealthSnapshots,
  getRecoverySnapshot,
  getAQMSnapshot,
  setAQMMode,
  setFailoverChain,
  getFailoverChain,
  getAllChains,
  removeFailoverChain,
  getCurrentSource,
  resetToPrimary,
  buildDefaultChain,
  getPreviewCachedUrl,
  setPreviewCachedUrl,
} from "./stream-manager";
import { triggerFailover } from "./source-failover";
import {
  startOAuth2Flow,
  cancelOAuth2Flow,
  clearOAuth2Token,
  getOAuth2State,
  isOAuth2Authenticated,
} from "./oauth2-manager";
import { getTikTokStreamUrl } from "./tiktok-extractor";
import { getYouTubeStreamUrl } from "./youtube-source";
import { startLiveCountPolling, stopLiveCountPolling, getLiveChatId, fetchLiveChat, forceRefreshLiveChat, getCachedChatMessages, getLiveStats, triggerStatsPollNow, forceLiveStatusRefresh, getApiKeyStatus, getDetailedApiStatus, forceRotateToKey, clearKeyExhaustion } from "./youtube-counter";
import type { OverlayPosition } from "./overlay-renderer";
import { registerDonationGateway, setDonationCallback, getGatewayPaymentUrl, getQRScanCount, getGiftQueue } from "./donation-gateway";
import type { GiftQueueItem } from "./gift-system";
import {
  startWatching,
  stopWatching,
  getWatcherEntry,
  getAllWatchers,
  removeWatcher,
  initWatcher,
} from "./stream-watcher";
import {
  computeLayout,
  computePiPLayout,
  getCurrentLayout,
  layoutToPixels,
} from "./layout-engine";
import {
  checkTikTokStreamHealth,
  getTikTokCookiesConfigured,
  getReconnectStats,
} from "./tiktok-extractor";
import {
  checkYouTubeStreamHealth,
  getCookiesConfigured as getYTCookiesConfigured,
} from "./youtube-source";
import { initNewsOverlay, newsOverlayRouter, updateOverlay as updateNewsOverlay, getState as getNewsOverlayState, setState as setNewsOverlayState } from "./news-overlay/index.js";
import sectionsRouter from "./sections/routes.js";
import { getSystemMetrics } from "./engine/metrics-service";
import { getOrCreateSceneManager } from "./scene/scene-manager";

interface BroadcastState {
  newsActive: boolean;
  newsText: string;
  newsTitle: string;
  newsBgColor: string;
  newsStyle: string;
  newsAnimation: string;
  newsPosition: OverlayPosition;
  adActive: boolean;
  adText: string;
  adSub: string;
  adStyle: string;
  adPosition: OverlayPosition;
  breakActive: boolean;
  breakText: string;
  breakStyle: string;
  breakVideoUrl: string;
  breakVideoMode: "fullscreen" | "live-bg" | "gradient-bg";
  breakVideoMuted: boolean;
  breakVideoPanX: number;
  breakVideoPanY: number;
  liveAudioMuted: boolean;
  chatStyle: string;
  statsActive: boolean;
  statsStyle: string;
  statsPosition: OverlayPosition;
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  subsGoal: number;
  // Sub sparkline chart
  subChartActive: boolean;
  subChartData: number[];
  subChartPosition: OverlayPosition;
  mobileSubChartPosition: OverlayPosition;
  // Sub milestone alert
  subAlertActive: boolean;
  subAlertMessage: string;
  chatBurnActive: boolean;
  chatBurnStyle: string;
  chatBurnPosition: OverlayPosition;
  // Super chat
  superChatMessages: Array<{ user: string; amount: string; text: string; color: string; ts: number }>;
  // Guest name tag
  guestNameActive: boolean;
  guestName: string;
  guestTitle: string;
  guestStyle: string;
  guestPosition: OverlayPosition;
  mobileGuestPosition: OverlayPosition;
  // Background gradient
  bgGradientActive: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientOpacity: number;
  // Mobile (portrait) position overrides
  mobileStatsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;
  // Element scale (50–200, 100 = actual size)
  statsScale: number;
  subsScale: number;
  chatBurnScale: number;
  newsScale: number;
  adScale: number;
  guestScale: number;
  subChartScale: number;
  globalStreamVolume: number;
  // QR code overlay
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: { x: number; y: number };
  qrScanCount: number;
  qrThankYouName: string;
  qrThankYouTs: number;
  // Featured comment (StreamYard-style single highlighted comment)
  featuredComment: { name: string; text: string; color?: string; ts: number } | null;
  // Screen share PIP overlay
  screenShareActive: boolean;
  screenShareMode: "pip" | "presenter" | "fullscreen";
  screenShareX: number;
  screenShareY: number;
  screenShareW: number;
  screenShareRadius: number;
  // Donation gateway
  donationTickerActive: boolean;
  donationAlertActive: boolean;
  donationTicker: Array<{ name: string; amount: string; amountKes: number; color: string; ts: number; giftId?: string }>;
  giftDisplayMode: "auto" | "minimal" | "standard" | "hype";
  newsLogo: string;
  newsScrollSpeed: number;
  newsTickerLoopSecs: number;
  thankYouStyle: string;
  // Logo overlay
  logoActive: boolean;
  logoUrl: string;
  logoX: number;
  logoY: number;
  logoSize: number;
  logoOpacity: number;
  logoBgEnabled: boolean;
  logoBgColor: string;
  logoBgShape: "circle" | "rounded" | "square";
  logoAnimation: "None" | "Fade" | "Slide In" | "Zoom" | "Bounce" | "Spin";
  logoAnimGap: number; // seconds to pause between animation plays; 0–60
  // Ticker presentation mode
  newsTickerMode: "Scroll" | "Stationary" | "Flap" | "Typewriter" | "Wave" | "Carousel";
  // Social media overlay
  socialOverlayActive: boolean;
  socialHandles: Array<{ platform: string; handle: string; enabled: boolean }>;
  socialAnimation: "Spin" | "Slide" | "Flip" | "Pulse" | "Pop";
  socialRotateInterval: number;
  socialPosition: { x: number; y: number };
  socialScale: number;
  socialStyle: "Classic" | "Glass" | "White" | "Modern" | "Neon";
}

let broadcastState: BroadcastState = {
  newsActive: false,
  newsText: "Welcome to the live stream! Stay tuned for more updates.",
  newsTitle: "",
  newsBgColor: "#cc0001",
  newsStyle: "Ticker",
  newsAnimation: "Fade",
  newsPosition: { x: 0, y: 95 },
  adActive: false,
  adText: "Big Sale — 50% Off Today Only!",
  adSub: "Use code LIVE at checkout.",
  adStyle: "Banner",
  adPosition: { x: 0, y: 0 },
  breakActive: false,
  breakText: "Be right back — taking a short break!",
  breakStyle: "Countdown",
  breakVideoUrl: "",
  breakVideoMode: "live-bg",
  breakVideoMuted: false,
  breakVideoPanX: 50,
  breakVideoPanY: 50,
  liveAudioMuted: false,
  chatStyle: "TV",
  statsActive: false,
  statsStyle: "TV",
  statsPosition: { x: 2, y: 2 },
  subsOverlayActive: false,
  subsStyle: "HUD",
  subsPosition: { x: 72, y: 2 },
  subsGoal: 1000000,
  subChartActive: false,
  subChartData: [],
  subChartPosition: { x: 68, y: 8 },
  mobileSubChartPosition: { x: 5, y: 8 },
  subAlertActive: false,
  subAlertMessage: "",
  chatBurnActive: false,
  chatBurnStyle: "Bubble",
  chatBurnPosition: { x: 2, y: 62 },
  superChatMessages: [],
  guestNameActive: false,
  guestName: "Guest Name",
  guestTitle: "Title / Channel",
  guestStyle: "Classic",
  guestPosition: { x: 2, y: 78 },
  mobileGuestPosition: { x: 2, y: 78 },
  bgGradientActive: false,
  bgGradient1: "#6d28d9",
  bgGradient2: "#0891b2",
  bgGradientOpacity: 0.45,
  mobileStatsPosition: { x: 2, y: 2 },
  mobileSubsPosition: { x: 60, y: 2 },
  mobileChatBurnPosition: { x: 2, y: 55 },
  mobileNewsPosition: { x: 0, y: 92 },
  mobileAdPosition: { x: 0, y: 0 },
  statsScale: 100,
  subsScale: 100,
  chatBurnScale: 100,
  newsScale: 100,
  adScale: 100,
  guestScale: 100,
  subChartScale: 100,
  globalStreamVolume: 100,
  qrActive: false,
  qrUrl: "",
  qrTitle: "",
  qrSize: 160,
  qrPosition: { x: 88, y: 10 },
  qrScanCount: 0,
  qrThankYouName: "",
  qrThankYouTs: 0,
  featuredComment: null,
  screenShareActive: false,
  screenShareMode: "presenter",
  screenShareX: 60,
  screenShareY: 5,
  screenShareW: 38,
  screenShareRadius: 16,
  donationTickerActive: false,
  donationAlertActive: true,
  donationTicker: [],
  giftDisplayMode: "auto",
  newsLogo: "",
  newsScrollSpeed: 30,
  newsTickerLoopSecs: 20,
  thankYouStyle: "Classic",
  logoActive: false,
  logoUrl: "",
  logoX: 85,
  logoY: 3,
  logoSize: 120,
  logoOpacity: 100,
  logoBgEnabled: false,
  logoBgColor: "rgba(0,0,0,0.55)",
  logoBgShape: "rounded",
  logoAnimation: "Fade",
  logoAnimGap: 2.5,
  newsTickerMode: "Scroll",
  socialOverlayActive: false,
  socialHandles: [],
  socialAnimation: "Spin",
  socialRotateInterval: 8,
  socialPosition: { x: 2, y: 82 },
  socialScale: 100,
  socialStyle: "Classic",
};

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
// Purge leftover break-video files (prefix "break-") but NOT stream-source videos (prefix "stream-")
try {
  fs.readdirSync(uploadDir).forEach((f) => {
    if (f !== ".gitkeep" && f.startsWith("break-")) {
      try { fs.unlinkSync(path.join(uploadDir, f)); } catch {}
    }
  });
} catch {}

const multerStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `break-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Separate multer config for stream-source video uploads (preserved across restarts)
const streamVideoStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    cb(null, `stream-${Date.now()}-${safeName}${ext}`);
  },
});
const uploadStreamVideo = multer({
  storage: streamVideoStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ts"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// multer for X Space background media — accepts images AND videos
const xspaceMediaStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    cb(null, `xspace-${Date.now()}-${safeName}${ext}`);
  },
});
const uploadXspaceMedia = multer({
  storage: xspaceMediaStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

const PASSWORD = process.env.BINTUNET_PASSWORD || "bintunet";

let inviteToken: string = crypto.randomBytes(6).toString("hex");

// ── Token-based auth store (persists in memory, survives cookie issues) ──────
const authTokens = new Set<string>();

function generateAuthToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  authTokens.add(token);
  return token;
}

function revokeAuthToken(token: string): void {
  authTokens.delete(token);
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers["authorization"];
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export async function registerBintunetRoutes(
  httpServer: Server,
  app: Express
): Promise<void> {
  const MemoryStore = (await import("memorystore")).default(session);

  app.use(
    session({
      secret: (() => {
        const s = process.env.SESSION_SECRET;
        if (!s) throw new Error("SESSION_SECRET environment variable is required but was not set.");
        return s;
      })(),
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    })
  );

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.session?.authenticated) { next(); return; }
    const token = extractBearerToken(req);
    if (token && authTokens.has(token)) { next(); return; }
    res.status(401).json({ message: "Unauthorized" });
  }

  function buildInviteUrl(req: Request): string {
    const proto =
      (req.get("x-forwarded-proto") as string | undefined)?.split(",")[0].trim() ||
      req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    return `${proto}://${host}/join?token=${inviteToken}`;
  }

  app.post("/api/auth/login", (req: Request, res: Response): void => {
    const { password } = req.body;
    if (password === PASSWORD) {
      req.session.authenticated = true;
      const token = generateAuthToken();
      res.json({ success: true, token });
      return;
    }
    res.status(401).json({ message: "Invalid password" });
  });

  app.get("/api/auth/check", (req: Request, res: Response): void => {
    if (req.session?.authenticated) { res.json({ authenticated: true }); return; }
    const token = extractBearerToken(req);
    if (token && authTokens.has(token)) { res.json({ authenticated: true }); return; }
    res.status(401).json({ authenticated: false });
  });

  app.post("/api/auth/logout", (req: Request, res: Response): void => {
    const token = extractBearerToken(req);
    if (token) revokeAuthToken(token);
    req.session.destroy(() => { res.json({ success: true }); });
  });

  app.get("/api/invite", requireAuth, (req: Request, res: Response): void => {
    res.json({ token: inviteToken, url: buildInviteUrl(req) });
  });

  app.post(
    "/api/invite/regenerate",
    requireAuth,
    (req: Request, res: Response): void => {
      inviteToken = crypto.randomBytes(6).toString("hex");
      res.json({ token: inviteToken, url: buildInviteUrl(req) });
    }
  );

  app.post("/api/invite/claim", (req: Request, res: Response): void => {
    const { token } = req.body;
    if (!token || token !== inviteToken) {
      res.status(401).json({ message: "Invalid or expired invite link." });
      return;
    }
    req.session.authenticated = true;
    const authToken = generateAuthToken();
    res.json({ success: true, token: authToken });
  });

  // ── Generate a camera-guest token for an invite-authenticated user ─────────
  // Uses the sentinel streamId "__multiview__" — no FFmpeg stream, just WebRTC relay.
  app.post(
    "/api/invite/camera-token",
    requireAuth,
    (req: Request, res: Response): void => {
      const token = crypto.randomBytes(12).toString("hex");
      cameraTokens.set(token, { streamId: "__multiview__", expires: Date.now() + 24 * 60 * 60 * 1000 });
      const proto =
        (req.get("x-forwarded-proto") as string | undefined)?.split(",")[0].trim() ||
        req.protocol;
      const host = req.get("x-forwarded-host") || req.get("host");
      res.json({ token, url: `${proto}://${host}/camera/${token}` });
    }
  );

  app.get("/api/streams", requireAuth, (_req: Request, res: Response): void => {
    res.json(storage.getStreams());
  });

  // Quick diagnostic endpoint — call this to check your API key and channel ID immediately.
  // GET /api/youtube/test-stats?channelId=UCxxxxxx
  app.get("/api/youtube/test-stats", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const channelId = String(req.query.channelId ?? "").trim();
    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || "";

    if (!apiKey) {
      res.status(503).json({ ok: false, error: "YOUTUBE_API_KEY is not set on the server" });
      return;
    }
    if (!channelId) {
      res.status(400).json({ ok: false, error: "channelId query param required" });
      return;
    }

    try {
      const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await r.json() as any;

      if (!r.ok) {
        res.json({ ok: false, httpStatus: r.status, apiError: body?.error?.message, hint: r.status === 403 ? "API key not authorised — make sure YouTube Data API v3 is enabled in Google Cloud Console" : "Check channel ID and API key" });
        return;
      }

      const item = body.items?.[0];
      if (!item) {
        res.json({ ok: false, httpStatus: 200, itemCount: 0, hint: "Channel not found — the ID you entered does not exist on YouTube. Double-check the ID." });
        return;
      }

      res.json({
        ok: true,
        channelId: item.id,
        title: item.snippet?.title,
        subscribers: item.statistics?.subscriberCount,
        hiddenSubscriberCount: item.statistics?.hiddenSubscriberCount,
        totalViews: item.statistics?.viewCount,
        thumbnail: item.snippet?.thumbnails?.default?.url,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/youtube/key-status — shows how many API keys are configured and which are exhausted
  app.get("/api/youtube/key-status", requireAuth, (_req: Request, res: Response): void => {
    res.json(getApiKeyStatus());
  });

  // GET /api/youtube/detailed-status — per-key telemetry for the API management dashboard
  app.get("/api/youtube/detailed-status", requireAuth, (_req: Request, res: Response): void => {
    res.json(getDetailedApiStatus());
  });

  // POST /api/youtube/force-rotate — manually switch to a specific key by index
  app.post("/api/youtube/force-rotate", requireAuth, (req: Request, res: Response): void => {
    const idx = Number(req.body?.index ?? -1);
    const ok  = forceRotateToKey(idx);
    res.json({ ok, activeIndex: ok ? idx : undefined });
  });

  // POST /api/youtube/clear-exhaustion — manually un-mark exhausted key(s)
  // Body: { index?: number }  — omit index to clear ALL keys
  app.post("/api/youtube/clear-exhaustion", requireAuth, (req: Request, res: Response): void => {
    const rawIdx = req.body?.index;
    const targetIndex = rawIdx !== undefined && rawIdx !== null ? Number(rawIdx) : undefined;
    const result = clearKeyExhaustion(targetIndex);
    res.json({ ok: true, cleared: result.cleared });
  });

  // Resolve a YouTube handle (e.g. @officialjaydaniels or custom URL) → channel ID.
  // GET /api/youtube/resolve-handle?handle=@officialjaydaniels
  app.get("/api/youtube/resolve-handle", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const raw = String(req.query.handle ?? "").trim();
    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || "";

    if (!apiKey) {
      res.status(503).json({ ok: false, error: "YOUTUBE_API_KEY is not set" });
      return;
    }
    if (!raw) {
      res.status(400).json({ ok: false, error: "handle query param required" });
      return;
    }

    // Accept: @handle, handle (without @), full channel URL, or UC… ID (passthrough)
    let handle = raw;
    // Strip URL prefix if pasted as full URL
    const urlMatch = raw.match(/youtube\.com\/@([^/?#]+)/);
    if (urlMatch) handle = "@" + urlMatch[1];
    // If it's already a channel ID, passthrough
    if (/^UC[\w-]{22}$/.test(handle)) {
      // It's already a valid channel ID — just verify it
      const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(handle)}&key=${apiKey}`, { signal: AbortSignal.timeout(8000) });
      const body = await r.json() as any;
      if (!r.ok) { res.json({ ok: false, error: body?.error?.message ?? "API error", quota: r.status === 403 || r.status === 429 }); return; }
      const item = body.items?.[0];
      if (!item) { res.json({ ok: false, error: "Channel ID not found" }); return; }
      res.json({ ok: true, channelId: item.id, title: item.snippet?.title, thumbnail: item.snippet?.thumbnails?.default?.url, subscribers: item.statistics?.subscriberCount });
      return;
    }
    // Ensure handle starts with @
    if (!handle.startsWith("@")) handle = "@" + handle;

    try {
      const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await r.json() as any;
      if (!r.ok) {
        res.json({ ok: false, error: body?.error?.message ?? "API error", quota: r.status === 403 || r.status === 429 });
        return;
      }
      const item = body.items?.[0];
      if (!item) {
        res.json({ ok: false, error: `Handle "${handle}" not found on YouTube` });
        return;
      }
      res.json({
        ok: true,
        channelId: item.id,
        title: item.snippet?.title,
        thumbnail: item.snippet?.thumbnails?.default?.url,
        subscribers: item.statistics?.subscriberCount,
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Verify a YouTube channel URL/handle and return name + thumbnail + resolved ID.
  // Used by the frontend "Verify Channel" button before saving.
  app.post("/api/youtube/verify-channel", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { url } = req.body as { url?: string };
    if (!url?.trim()) {
      res.status(400).json({ message: "url is required" });
      return;
    }
    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!apiKey) {
      res.status(503).json({ message: "YOUTUBE_API_KEY is not configured on the server" });
      return;
    }

    const raw = url.trim();
    const TIMEOUT = 8000;

    // Build a list of API calls to try, in order:
    // 1. Direct UC... ID  2. /channel/UCxxx  3. @handle  4. /c/ or /user/
    type ApiParams = Record<string, string>;
    const attempts: ApiParams[] = [];

    if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw)) {
      attempts.push({ id: raw });
    }
    const channelMatch = raw.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (channelMatch) attempts.push({ id: channelMatch[1] });

    const handleMatch = raw.match(/\/@([^/?&#\s]+)/) || raw.match(/^@([^/?&#\s]+)$/);
    if (handleMatch) attempts.push({ forHandle: `@${handleMatch[1]}` });

    const usernameMatch = raw.match(/\/(?:c|user)\/([^/?&#\s]+)/);
    if (usernameMatch) attempts.push({ forUsername: usernameMatch[1] });

    if (attempts.length === 0) {
      res.status(400).json({ message: "Could not detect a channel in that URL. Try a URL like youtube.com/@channelname or paste the channel ID directly." });
      return;
    }

    for (const params of attempts) {
      try {
        const qs = new URLSearchParams({ part: "id,snippet", key: apiKey, ...params });
        const apiRes = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?${qs}`,
          { signal: AbortSignal.timeout(TIMEOUT) }
        );
        if (!apiRes.ok) continue;
        const data = await apiRes.json() as any;
        const item = data.items?.[0];
        if (!item) continue;
        res.json({
          channelId: item.id,
          title: item.snippet?.title ?? null,
          thumbnail: item.snippet?.thumbnails?.default?.url ?? null,
          customUrl: item.snippet?.customUrl ?? null,
        });
        return;
      } catch {
        continue;
      }
    }

    res.status(404).json({ message: "Channel not found. Make sure the channel exists and your YOUTUBE_API_KEY is enabled for YouTube Data API v3." });
  });

  // Resolve any YouTube URL or bare handle to a UC... channel ID.
  // Handles all modern URL formats:
  //   /channel/UCxxxxxx          → regex, no API call
  //   /@handle  or  @handle      → channels?forHandle=
  //   /c/name   or  /user/name   → channels?forUsername=
  // Returns null if the ID cannot be determined.
  async function resolveYouTubeChannelId(raw: string): Promise<string | null> {
    if (!raw) return null;

    // 1. Already a bare UC... ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw.trim())) return raw.trim();

    // 2. /channel/UCxxxxxx in the URL
    const channelMatch = raw.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (channelMatch) return channelMatch[1];

    const apiKey = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY || "";

    // 3. @handle — either in URL path or bare string
    const handleMatch = raw.match(/\/@([^/?&#\s]+)/) || raw.match(/^@([^/?&#\s]+)$/);
    if (handleMatch) {
      if (!apiKey) {
        logger.warn("Cannot resolve YouTube @handle — YOUTUBE_API_KEY not set");
        return null;
      }
      try {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=%40${encodeURIComponent(handleMatch[1])}&key=${apiKey}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = await res.json() as any;
          const id = data.items?.[0]?.id ?? null;
          if (id) return id;
        }
      } catch (e) {
        logger.warn({ handle: handleMatch[1], err: e }, "Failed to resolve YouTube @handle");
      }
      return null;
    }

    // 4. /c/name or /user/name  → forUsername lookup
    const usernameMatch = raw.match(/\/(?:c|user)\/([^/?&#\s]+)/);
    if (usernameMatch) {
      if (!apiKey) {
        logger.warn("Cannot resolve YouTube username — YOUTUBE_API_KEY not set");
        return null;
      }
      try {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(usernameMatch[1])}&key=${apiKey}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (res.ok) {
          const data = await res.json() as any;
          const id = data.items?.[0]?.id ?? null;
          if (id) return id;
        }
      } catch (e) {
        logger.warn({ username: usernameMatch[1], err: e }, "Failed to resolve YouTube username");
      }
      return null;
    }

    return null;
  }

  app.post("/api/streams", requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const body = { ...req.body };
      // Auto-fill youtubeChannelId from the source URL when not provided
      if (body.youtubeSourceUrl && !body.youtubeChannelId) {
        const resolved = await resolveYouTubeChannelId(body.youtubeSourceUrl);
        if (resolved) body.youtubeChannelId = resolved;
      }
      const data = insertStreamSchema.parse(body);
      const stream = storage.createStream(data);
      res.json(stream);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch(
    "/api/streams/:id",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const body = { ...req.body };
      // Auto-fill youtubeChannelId from the source URL when not explicitly provided
      if (body.youtubeSourceUrl && !body.youtubeChannelId) {
        const resolved = await resolveYouTubeChannelId(body.youtubeSourceUrl);
        if (resolved) body.youtubeChannelId = resolved;
      }
      const stream = storage.updateStream(String(req.params.id), body);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      // If youtubeChannelId was just set or changed, immediately resolve the
      // liveChatId so chat burn-in starts within seconds (not up to 60 s).
      if (body.youtubeChannelId && stream.youtubeChannelId) {
        triggerStatsPollNow();
      }
      res.json(stream);
    }
  );

  app.delete(
    "/api/streams/:id",
    requireAuth,
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      // stopStream removes from activeStreams; safe to call even if not running.
      try { stopStream(id); } catch {}
      const deleted = storage.deleteStream(id);
      if (!deleted) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      // Notify all frontends to remove the card and purge local data.
      broadcastStream(id, "deleted", {});
      res.json({ success: true });
    }
  );

  app.post(
    "/api/streams/:id/start",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }

      // Return 200 immediately — URL resolution (streamlink / yt-dlp) can take
      // 5–15 s and we don't want the UI button frozen while it runs.
      // The UI follows progress via WebSocket status/log events.
      res.json({ success: true });

      // Fire start in background; errors surface as stream log messages.
      startStream(id).catch((e: any) => {
        logger.warn({ streamId: id, err: e.message }, "startStream background error");
      });
    }
  );

  app.post(
    "/api/streams/:id/stop",
    requireAuth,
    (req: Request, res: Response): void => {
      try {
        const id = String(req.params.id);
        // Stop FFmpeg. stopStream() also calls sendStatus(id, "idle") internally
        // so the frontend receives a "status" → "idle" WebSocket event.
        stopStream(id);
        // Keep the stream card — only reset its status to idle so the user can
        // see their stream config (RTMP key, title, platform) after stopping.
        // Do NOT delete the stream or broadcast "deleted".
        storage.updateStream(id, { status: "idle" });
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.post(
    "/api/streams/:id/restart",
    requireAuth,
    (req: Request, res: Response): void => {
      try {
        restartStream(String(req.params.id));
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.post(
    "/api/streams/:id/mute",
    requireAuth,
    (req: Request, res: Response): void => {
      try {
        const { muted } = req.body;
        toggleMute(String(req.params.id), muted);
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  // ── Upload a video file as the stream source ──────────────────────────────
  app.post(
    "/api/streams/:id/upload-video",
    requireAuth,
    uploadStreamVideo.single("video"),
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: "No video file received or unsupported format (mp4, webm, mov, avi, mkv, m4v, ts)." });
        return;
      }
      // Delete old stream video for this stream if one exists and is different
      if (stream.uploadedVideoPath && stream.uploadedVideoPath !== req.file.path) {
        try { if (fs.existsSync(stream.uploadedVideoPath)) fs.unlinkSync(stream.uploadedVideoPath); } catch {}
      }
      storage.updateStream(id, { uploadedVideoPath: req.file.path });
      res.json({
        success: true,
        path: req.file.path,
        filename: req.file.originalname,
        size: req.file.size,
      });
    }
  );

  // Upload X Space background media (image or video — looped, muted)
  app.post(
    "/api/streams/:id/upload-xspace-media",
    requireAuth,
    uploadXspaceMedia.single("media"),
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) { res.status(404).json({ message: "Stream not found" }); return; }
      if (!req.file) {
        res.status(400).json({ message: "No file received or unsupported format (mp4, webm, mov, jpg, png, gif, webp)." });
        return;
      }
      if (stream.xspaceVideoPath && stream.xspaceVideoPath !== req.file.path) {
        try { if (fs.existsSync(stream.xspaceVideoPath)) fs.unlinkSync(stream.xspaceVideoPath); } catch {}
      }
      storage.updateStream(id, { xspaceVideoPath: req.file.path });
      res.json({ success: true, path: req.file.path, filename: req.file.originalname, size: req.file.size });
    }
  );

  // Delete X Space background media
  app.delete(
    "/api/streams/:id/upload-xspace-media",
    requireAuth,
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) { res.status(404).json({ message: "Stream not found" }); return; }
      if (stream.xspaceVideoPath) {
        try { if (fs.existsSync(stream.xspaceVideoPath)) fs.unlinkSync(stream.xspaceVideoPath); } catch {}
        storage.updateStream(id, { xspaceVideoPath: "" });
      }
      res.json({ success: true });
    }
  );

  // Delete uploaded stream video
  app.delete(
    "/api/streams/:id/upload-video",
    requireAuth,
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) { res.status(404).json({ message: "Stream not found" }); return; }
      if (stream.uploadedVideoPath) {
        try { if (fs.existsSync(stream.uploadedVideoPath)) fs.unlinkSync(stream.uploadedVideoPath); } catch {}
        storage.updateStream(id, { uploadedVideoPath: "" });
      }
      res.json({ success: true });
    }
  );

  app.get(
    "/api/streams/:id/preview",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stream = storage.getStream(String(req.params.id));
        if (!stream) { res.status(404).json({ message: "Stream not found" }); return; }

        // Reuse a recently resolved URL (same cache the live encoder uses) so
        // repeated/refreshed preview requests skip the 5-30s yt-dlp/streamlink
        // resolution and appear near-instantly. Entries expire after 10 min.
        const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";
        if (!forceRefresh) {
          const cached = getPreviewCachedUrl(stream.id);
          if (cached && (cached.sourceType === "youtube" || cached.sourceType === "tiktok")) {
            const isHlsCached = cached.url.includes(".m3u8");
            res.json({
              isLive: true,
              hlsUrl: isHlsCached ? cached.url : null,
              flvUrl: isHlsCached ? null : cached.url,
              sourceType: cached.sourceType,
              cached: true,
            });
            return;
          }
        }

        // ── YouTube source ────────────────────────────────────────────────────
        if (stream.sourceType === "youtube") {
          if (!stream.youtubeSourceUrl) {
            res.status(400).json({ message: "No YouTube URL set", isLive: false }); return;
          }
          try {
            // Race against a 6-second timeout so the frontend can fall back to
            // YouTube's built-in embed quickly instead of waiting for all yt-dlp tiers.
            const url = await Promise.race<string>([
              getYouTubeStreamUrl(stream.youtubeSourceUrl),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Preview timeout — using YouTube embed player")), 6000)
              ),
            ]);
            setPreviewCachedUrl(stream.id, url, "youtube");
            const isHls = url.includes(".m3u8");
            res.json({ isLive: true, hlsUrl: isHls ? url : null, flvUrl: isHls ? null : url, sourceType: "youtube" });
          } catch (e: any) {
            const msg: string = e.message || "";
            res.status(400).json({ message: msg, isLive: msg.includes("not live") || msg.includes("NOT_LIVE") ? false : null });
          }
          return;
        }

        // ── TikTok source ─────────────────────────────────────────────────────
        if (!stream.tiktokUsername) {
          res.status(400).json({ message: "No TikTok username set", isLive: false }); return;
        }
        const tiktokResult = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
        setPreviewCachedUrl(stream.id, tiktokResult.url, "tiktok");
        const isHls = tiktokResult.format === "hls" || tiktokResult.url.includes(".m3u8");
        res.json({ isLive: true, hlsUrl: isHls ? tiktokResult.url : null, flvUrl: isHls ? null : tiktokResult.url, sourceType: "tiktok" });
      } catch (e: any) {
        res.status(400).json({ message: e.message, isLive: false });
      }
    }
  );

  app.get(
    "/api/preview/:username",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const ttkResult = await getTikTokStreamUrl(String(req.params.username), "best");
        const isHls = ttkResult.format === "hls" || ttkResult.url.includes(".m3u8");
        res.json({
          isLive: true,
          hlsUrl: isHls ? ttkResult.url : null,
          flvUrl: isHls ? null : ttkResult.url,
          title: null,
          roomId: ttkResult.resolvedBy,
        });
      } catch (e: any) {
        res.status(400).json({ message: e.message, isLive: false });
      }
    }
  );

  // ── Resolve a preview source (TikTok username → HLS, YouTube URL → embed) ──
  app.post(
    "/api/preview/resolve",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { type, value } = req.body as { type?: string; value?: string };
      if (!type || !value) { res.status(400).json({ message: "type and value required" }); return; }

      if (type === "tiktok") {
        const username = value.replace(/^@/, "").trim();
        try {
          const tkRes = await getTikTokStreamUrl(username, "best");
          const isHls = tkRes.format === "hls" || tkRes.url.includes(".m3u8");
          res.json({ type: isHls ? "hls" : "none", url: isHls ? tkRes.url : null });
        } catch (e: any) {
          res.status(400).json({ message: e.message || "User not live or not found" });
        }
        return;
      }

      if (type === "youtube") {
        const ytMatch = value.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
        const videoId = ytMatch?.[1];
        if (!videoId) { res.status(400).json({ message: "Could not extract YouTube video ID" }); return; }
        res.json({
          type: "youtube-embed",
          url: null,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1`,
        });
        return;
      }

      if (type === "hls") {
        const url = value.trim();
        if (!url.includes(".m3u8") && !url.startsWith("http")) {
          res.status(400).json({ message: "URL must be a valid HLS .m3u8 link" }); return;
        }
        res.json({ type: "hls", url });
        return;
      }

      res.status(400).json({ message: "Unknown type" });
    }
  );

  // ── Multiscreen: Apply a source to live stream (split-screen intent) ────────
  app.post(
    "/api/multiscreen/apply",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { sourceKind, url, embedUrl, label } = req.body as {
        sourceKind?: string; url?: string; embedUrl?: string; label?: string;
      };
      if (!sourceKind) { res.status(400).json({ message: "sourceKind required" }); return; }
      // Broadcast to all WebSocket clients so the control room can react
      broadcastGlobal("multiscreen_apply", {
        sourceKind, url, embedUrl, label,
        appliedAt: Date.now(),
      });
      res.json({ ok: true, message: "Source applied to live stream" });
    }
  );

  // ── Monitor Preview — works for all source types ───────────────────────────
  app.get(
    "/api/streams/:id/monitor-preview",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const stream = storage.getStream(String(req.params.id));
      if (!stream) { res.status(404).json({ type: "none" }); return; }

      if (stream.sourceType === "tiktok" && stream.tiktokUsername) {
        try {
          const monRes = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
          const isHls = monRes.format === "hls" || monRes.url.includes(".m3u8");
          res.json({ type: isHls ? "hls" : "none", url: isHls ? monRes.url : null, embedUrl: null });
        } catch {
          res.json({ type: "none", url: null, embedUrl: null });
        }
        return;
      }

      if (stream.sourceType === "youtube" && stream.youtubeSourceUrl) {
        const ytMatch = stream.youtubeSourceUrl.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
        const videoId = ytMatch?.[1];
        if (videoId) {
          res.json({
            type: "youtube-embed",
            url: null,
            embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1`,
          });
        } else {
          res.json({ type: "none", url: null, embedUrl: null });
        }
        return;
      }

      if (stream.sourceType === "upload" && stream.uploadedVideoPath) {
        const filename = path.basename(stream.uploadedVideoPath);
        res.json({ type: "file", url: `/api/uploads/${filename}`, embedUrl: null });
        return;
      }

      res.json({ type: "none", url: null, embedUrl: null });
    }
  );

  // ── Break Video Preload ─────────────────────────────────────────────────────
  app.post(
    "/api/break-video/preload",
    requireAuth,
    (req: Request, res: Response): void => {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== "string") {
        res.status(400).json({ message: "url required" });
        return;
      }
      preloadBreakVideo(url.trim());
      res.json({ message: "preload started" });
    }
  );

  app.get(
    "/api/break-video/preload-status",
    requireAuth,
    (req: Request, res: Response): void => {
      const url = String(req.query.url ?? "");
      if (!url) { res.status(400).json({ message: "url required" }); return; }
      const entry = getBreakVideoPreloadStatus(url);
      if (!entry) { res.json({ status: "idle" }); return; }
      res.json({ status: entry.status, error: entry.error });
    }
  );

  const cameraTokens = new Map<string, { streamId: string; expires: number }>();

  app.get(
    "/api/streams/:id/camera-token",
    requireAuth,
    (req: Request, res: Response): void => {
      const streamId = String(req.params.id);
      const stream = storage.getStream(streamId);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      const token = crypto.randomBytes(12).toString("hex");
      cameraTokens.set(token, { streamId, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      const proto =
        (req.get("x-forwarded-proto") as string | undefined)?.split(",")[0].trim() ||
        req.protocol;
      const host = req.get("x-forwarded-host") || req.get("host");
      const url = `${proto}://${host}/camera/${token}`;
      setCameraLink(streamId, url);
      res.json({ token, url });
    }
  );

  app.get(
    "/api/camera/:token",
    async (req: Request, res: Response): Promise<void> => {
      const entry = cameraTokens.get(String(req.params.token));
      if (!entry || Date.now() > entry.expires) {
        res.status(404).json({ message: "Invalid or expired camera link" });
        return;
      }
      const stream = storage.getStream(entry.streamId);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      res.json({
        streamId: entry.streamId,
        youtubeChannelId: stream.youtubeChannelId,
        status: stream.status,
        sourceType: stream.sourceType,
      });
    }
  );

  app.get(
    "/api/streams/:id/chat",
    requireAuth,
    (req: Request, res: Response): void => {
      const streamId = String(req.params.id);
      const chatId = getLiveChatId(streamId);
      if (!chatId) {
        res.json({ messages: [], hasChat: false });
        return;
      }
      // Return cached messages only — the background scheduleChatPoll chain
      // is the sole source that calls the YouTube API for chat.  Calling
      // fetchLiveChat() here caused quota exhaustion: every frontend poll
      // (5 s from the camera page) triggered a fresh YouTube API call in
      // parallel with the already-running background poller.
      const messages = getCachedChatMessages(chatId);
      res.json({ messages, hasChat: true });
    }
  );

  app.post(
    "/api/streams/:id/chat/refresh",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const streamId = String(req.params.id);
      const stream = storage.getStream(streamId);
      if (!stream?.youtubeChannelId) {
        res.json({ messages: [], hasChat: false, refreshed: true, error: "no_channel" });
        return;
      }
      // Force an un-throttled live-status re-check (bypasses the 30-min
      // search.list throttle that a plain triggerStatsPollNow() respects —
      // that throttle was the main reason Force Refresh appeared to "fail":
      // it silently kept serving stale/no-chat state if clicked less than
      // 30 min after the last automatic poll).
      let stats;
      try {
        stats = await forceLiveStatusRefresh(streamId);
      } catch (e: any) {
        res.status(400).json({ message: e?.message ?? "Failed to check live status", refreshed: false });
        return;
      }
      const chatId = getLiveChatId(streamId);
      if (!chatId) {
        res.json({
          messages: [],
          hasChat: false,
          refreshed: true,
          isLive: false,
          subs: stats?.subs ?? null,
          viewers: stats?.viewers ?? null,
          error: stats?.error ?? "not_live",
        });
        return;
      }
      try {
        const messages = await forceRefreshLiveChat(streamId, chatId);
        res.json({
          messages,
          hasChat: true,
          refreshed: true,
          isLive: true,
          subs: stats?.subs ?? null,
          viewers: stats?.viewers ?? null,
        });
      } catch (e: any) {
        res.status(400).json({ message: e.message, refreshed: true });
      }
    }
  );

  app.get(
    "/api/camera/:token/chat",
    (req: Request, res: Response): void => {
      const entry = cameraTokens.get(String(req.params.token));
      if (!entry || Date.now() > entry.expires) {
        res.status(404).json({ message: "Invalid or expired camera link" });
        return;
      }
      const chatId = getLiveChatId(entry.streamId);
      if (!chatId) {
        res.json({ messages: [], hasChat: false });
        return;
      }
      // Cache-only — never call YouTube API from REST endpoints.
      // The background scheduleChatPoll already polls at the interval YouTube
      // recommends (8–10 s).  Calling fetchLiveChat() here doubled quota usage
      // because the camera page polls this endpoint every 5 s.
      const messages = getCachedChatMessages(chatId);
      res.json({ messages, hasChat: true });
    }
  );

  app.get(
    "/api/camera/:token/stats",
    async (req: Request, res: Response): Promise<void> => {
      const entry = cameraTokens.get(String(req.params.token));
      if (!entry || Date.now() > entry.expires) {
        res.status(404).json({ message: "Invalid or expired camera link" });
        return;
      }
      const stream = storage.getStream(entry.streamId);
      const { subs, viewers } = getLiveStats(entry.streamId);
      res.json({
        subs,
        viewers,
        status: stream?.status ?? "idle",
      });
    }
  );

  // ── Broadcast state ──────────────────────────────────────────────────────
  app.get("/api/broadcast", (_req: Request, res: Response): void => {
    res.json(broadcastState);
  });

  app.post("/api/broadcast", requireAuth, (req: Request, res: Response): void => {
    broadcastState = { ...broadcastState, ...req.body };
    broadcastGlobal("broadcast", broadcastState);

    // Propagate stream volume immediately (triggers fast FFmpeg restart on all active streams)
    if (req.body.globalStreamVolume !== undefined) {
      updateStreamVolume(broadcastState.globalStreamVolume);
    }

    // Build the overlay patch from the current broadcast state.
    // newsLogo is intentionally excluded unless the request body explicitly
    // changed it: the logo is a base64 data URI (often 50–200 KB) and
    // updateState compares it character-by-character on every call.  Including
    // it on every slider drag / toggle would block the Node.js event loop for
    // several milliseconds each time, causing brief RTMP send-buffer stalls.
    // NOTE: newsActive / newsText / newsTitle / newsBgColor / newsStyle /
    // newsAnimation / newsPosition / newsScrollSpeed / newsLogo are NOT
    // included here. They are owned exclusively by the news-overlay module
    // (see news-overlay/overlay-manager.ts, driven by /api/news-overlay/*
    // routes from news-panel.tsx). Including stale defaults from
    // `broadcastState` here was overwriting the live news overlay state
    // (turning it OFF) on every unrelated control-room change — e.g. a
    // volume slider drag would silently deactivate the news ticker mid-air.
    // `newsScale` and `newsTickerLoopSecs` remain here because those two
    // fields are genuinely controlled from the control room, not the news
    // panel.
    const overlayPatch: Parameters<typeof updateStreamOverlays>[0] = {
      adActive:               broadcastState.adActive,
      adText:                 broadcastState.adText,
      adSub:                  broadcastState.adSub,
      adStyle:                broadcastState.adStyle,
      adPosition:             broadcastState.adPosition,
      breakActive:            broadcastState.breakActive,
      breakText:              broadcastState.breakText,
      breakStyle:             broadcastState.breakStyle,
      breakVideoUrl:          broadcastState.breakVideoUrl,
      breakVideoMode:         broadcastState.breakVideoMode,
      breakVideoPanX:         broadcastState.breakVideoPanX,
      breakVideoPanY:         broadcastState.breakVideoPanY,
      liveAudioMuted:         broadcastState.liveAudioMuted,
      breakVideoMuted:        broadcastState.breakVideoMuted,
      statsActive:            broadcastState.statsActive,
      statsStyle:             broadcastState.statsStyle,
      statsPosition:          broadcastState.statsPosition,
      subsOverlayActive:      broadcastState.subsOverlayActive,
      subsStyle:              broadcastState.subsStyle,
      subsPosition:           broadcastState.subsPosition,
      subsGoal:               broadcastState.subsGoal,
      subChartActive:         broadcastState.subChartActive,
      subChartData:           broadcastState.subChartData,
      subChartPosition:       broadcastState.subChartPosition,
      mobileSubChartPosition: broadcastState.mobileSubChartPosition,
      subAlertActive:         broadcastState.subAlertActive,
      subAlertMessage:        broadcastState.subAlertMessage,
      chatBurnActive:         broadcastState.chatBurnActive,
      chatBurnStyle:          broadcastState.chatBurnStyle,
      chatBurnPosition:       broadcastState.chatBurnPosition,
      superChatMessages:      broadcastState.superChatMessages,
      guestNameActive:        broadcastState.guestNameActive,
      guestName:              broadcastState.guestName,
      guestTitle:             broadcastState.guestTitle,
      guestStyle:             broadcastState.guestStyle,
      guestPosition:          broadcastState.guestPosition,
      mobileGuestPosition:    broadcastState.mobileGuestPosition,
      bgGradientActive:       broadcastState.bgGradientActive,
      bgGradient1:            broadcastState.bgGradient1,
      bgGradient2:            broadcastState.bgGradient2,
      bgGradientOpacity:      broadcastState.bgGradientOpacity,
      mobileStatsPosition:    broadcastState.mobileStatsPosition,
      mobileSubsPosition:     broadcastState.mobileSubsPosition,
      mobileChatBurnPosition: broadcastState.mobileChatBurnPosition,
      mobileNewsPosition:     broadcastState.mobileNewsPosition,
      mobileAdPosition:       broadcastState.mobileAdPosition,
      statsScale:             broadcastState.statsScale,
      subsScale:              broadcastState.subsScale,
      chatBurnScale:          broadcastState.chatBurnScale,
      newsScale:              broadcastState.newsScale,
      adScale:                broadcastState.adScale,
      guestScale:             broadcastState.guestScale,
      subChartScale:          broadcastState.subChartScale,
      qrActive:               broadcastState.qrActive,
      qrUrl:                  broadcastState.qrUrl,
      qrTitle:                broadcastState.qrTitle,
      qrSize:                 broadcastState.qrSize,
      qrPosition:             broadcastState.qrPosition,
      qrScanCount:            getQRScanCount(),
      qrThankYouActive:       (Date.now() - broadcastState.qrThankYouTs) < 11_000 && !!broadcastState.qrThankYouName,
      qrThankYouName:         broadcastState.qrThankYouName,
      qrThankYouTs:           broadcastState.qrThankYouTs,
      featuredComment:        broadcastState.featuredComment,
      screenShareActive:      broadcastState.screenShareActive,
      screenShareMode:        broadcastState.screenShareMode,
      screenShareX:           broadcastState.screenShareX,
      screenShareY:           broadcastState.screenShareY,
      screenShareW:           broadcastState.screenShareW,
      screenShareRadius:      broadcastState.screenShareRadius,
      donationTickerActive:   broadcastState.donationTickerActive,
      donationAlertActive:    broadcastState.donationAlertActive,
      donationTicker:         broadcastState.donationTicker,
      giftDisplayMode:        broadcastState.giftDisplayMode,
      giftQueue:              getGiftQueue(),
      thankYouStyle:          broadcastState.thankYouStyle,
      newsTickerLoopSecs:     broadcastState.newsTickerLoopSecs ?? 20,
      logoActive:             broadcastState.logoActive,
      logoX:                  broadcastState.logoX,
      logoY:                  broadcastState.logoY,
      logoSize:               broadcastState.logoSize,
      logoOpacity:            broadcastState.logoOpacity,
      logoBgEnabled:          broadcastState.logoBgEnabled,
      logoBgColor:            broadcastState.logoBgColor,
      logoBgShape:            broadcastState.logoBgShape,
      logoAnimation:          broadcastState.logoAnimation,
      logoAnimGap:            broadcastState.logoAnimGap,
      newsTickerMode:         broadcastState.newsTickerMode ?? "Scroll",
      socialOverlayActive:    broadcastState.socialOverlayActive,
      socialHandles:          broadcastState.socialHandles ?? [],
      socialAnimation:        broadcastState.socialAnimation ?? "Spin",
      socialRotateInterval:   broadcastState.socialRotateInterval ?? 8,
      socialPosition:         broadcastState.socialPosition ?? { x: 2, y: 82 },
      socialScale:            broadcastState.socialScale ?? 100,
      socialStyle:            broadcastState.socialStyle ?? "Classic",
    };
    // Only pass newsLogo when it was explicitly included in this request body.
    // This avoids a multi-millisecond base64 string comparison in updateState
    // on every unrelated control-room change (position drags, toggles, etc.).
    if (req.body && typeof req.body === "object" && "newsLogo" in req.body) {
      overlayPatch.newsLogo = broadcastState.newsLogo;
    }
    // logoUrl can also be a large base64 string — only pass it when explicitly changed
    if (req.body && typeof req.body === "object" && "logoUrl" in req.body) {
      overlayPatch.logoUrl = broadcastState.logoUrl;
    }
    updateStreamOverlays(overlayPatch);

    // Propagate newsPosition to the canvas renderers when the control-room
    // position sliders change. newsPosition is intentionally excluded from
    // overlayPatch above (to avoid overwriting news-overlay module state on
    // every unrelated broadcast change), but it MUST reach the renderer when
    // the user explicitly moves the XY sliders in the news section.
    //
    // We push DIRECTLY to updateStreamOverlays instead of going through
    // updateNewsOverlay / pushToStreamRenderers, because mapToOverlayPatch
    // always includes newsActive:s.active — if news was activated via the
    // legacy broadcast state (not the news panel), s.active would be false,
    // which would silently disable the overlay mid-stream on every position drag.
    if (req.body && typeof req.body === "object" && "newsPosition" in req.body) {
      updateStreamOverlays({
        newsPosition:       broadcastState.newsPosition,
        mobileNewsPosition: broadcastState.mobileNewsPosition,
      });
      // Also persist the position into the news-overlay API state so it
      // survives page reloads and preset saves — but don't re-push to
      // stream renderers (that's already done above).
      const currentNewsState = getNewsOverlayState();
      setNewsOverlayState({
        layout: { ...currentNewsState.layout, position: broadcastState.newsPosition },
      });
    }

    res.json(broadcastState);
  });

  // ── Social Overlay API ────────────────────────────────────────────────────

  // GET /api/social-overlay — return current social overlay state
  app.get("/api/social-overlay", requireAuth, (_req: Request, res: Response): void => {
    res.json({
      active:          broadcastState.socialOverlayActive,
      handles:         broadcastState.socialHandles ?? [],
      animation:       broadcastState.socialAnimation ?? "Spin",
      rotateInterval:  broadcastState.socialRotateInterval ?? 8,
      position:        broadcastState.socialPosition ?? { x: 2, y: 82 },
      scale:           broadcastState.socialScale ?? 100,
      style:           broadcastState.socialStyle ?? "Classic",
    });
  });

  // PATCH /api/social-overlay — update settings
  app.patch("/api/social-overlay", requireAuth, (req: Request, res: Response): void => {
    const b = req.body ?? {};
    if (typeof b.active            === "boolean") broadcastState.socialOverlayActive   = b.active;
    if (typeof b.animation         === "string")  broadcastState.socialAnimation        = b.animation as typeof broadcastState.socialAnimation;
    if (typeof b.rotateInterval    === "number")  broadcastState.socialRotateInterval   = Math.max(2, Math.min(60, b.rotateInterval));
    if (b.position && typeof b.position.x === "number") broadcastState.socialPosition   = b.position;
    if (typeof b.scale             === "number")  broadcastState.socialScale            = Math.max(50, Math.min(200, b.scale));
    if (typeof b.style             === "string")  broadcastState.socialStyle            = b.style as typeof broadcastState.socialStyle;
    updateStreamOverlays({
      socialOverlayActive:  broadcastState.socialOverlayActive,
      socialHandles:        broadcastState.socialHandles,
      socialAnimation:      broadcastState.socialAnimation,
      socialRotateInterval: broadcastState.socialRotateInterval,
      socialPosition:       broadcastState.socialPosition,
      socialScale:          broadcastState.socialScale,
      socialStyle:          broadcastState.socialStyle,
    });
    res.json({ ok: true });
  });

  // POST /api/social-overlay/handles — add a handle
  app.post("/api/social-overlay/handles", requireAuth, (req: Request, res: Response): void => {
    const { platform, handle } = req.body ?? {};
    if (!platform || !handle) { res.status(400).json({ error: "platform and handle required" }); return; }
    const entry = { platform: String(platform).trim(), handle: String(handle).trim(), enabled: true };
    broadcastState.socialHandles = [...(broadcastState.socialHandles ?? []), entry];
    updateStreamOverlays({ socialHandles: broadcastState.socialHandles });
    res.json({ ok: true, handles: broadcastState.socialHandles });
  });

  // PATCH /api/social-overlay/handles/:idx — update a handle
  app.patch("/api/social-overlay/handles/:idx", requireAuth, (req: Request, res: Response): void => {
    const idx = parseInt(String(req.params.idx), 10);
    const handles = broadcastState.socialHandles ?? [];
    if (isNaN(idx) || idx < 0 || idx >= handles.length) { res.status(404).json({ error: "not found" }); return; }
    const b = req.body ?? {};
    if (typeof b.enabled  === "boolean") handles[idx].enabled  = b.enabled;
    if (typeof b.handle   === "string")  handles[idx].handle   = b.handle.trim();
    if (typeof b.platform === "string")  handles[idx].platform = b.platform.trim();
    updateStreamOverlays({ socialHandles: handles });
    res.json({ ok: true, handles });
  });

  // DELETE /api/social-overlay/handles/:idx — remove a handle
  app.delete("/api/social-overlay/handles/:idx", requireAuth, (req: Request, res: Response): void => {
    const idx = parseInt(String(req.params.idx), 10);
    const handles = broadcastState.socialHandles ?? [];
    if (isNaN(idx) || idx < 0 || idx >= handles.length) { res.status(404).json({ error: "not found" }); return; }
    broadcastState.socialHandles = handles.filter((_, i) => i !== idx);
    updateStreamOverlays({ socialHandles: broadcastState.socialHandles });
    res.json({ ok: true, handles: broadcastState.socialHandles });
  });

  // ── Music URL resolve + proxy ─────────────────────────────────────────────
  // Store the original source URL (not the CDN URL) — the CDN URL is session-
  // tied and returns 403 when fetched outside yt-dlp's own session. Instead,
  // re-invoke yt-dlp at proxy time and pipe its stdout straight to the client.
  const musicProxyTokens = new Map<string, { originalUrl: string; title: string }>();

  app.post("/api/music/resolve", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { url } = req.body as { url?: string };
    if (!url?.trim()) { res.status(400).json({ error: "url is required" }); return; }

    const { spawn } = await import("child_process");
    const { getCookiesArgs } = await import("./youtube-source");
    const cookieArgs = getCookiesArgs();

    // Only fetch the title — no CDN URL needed at resolve time
    const args = [
      "--no-config",
      "--get-title",
      "--no-playlist",
      "--no-check-certificate",
      "--socket-timeout", "20",
      "--extractor-args", "youtube:player_client=ios,mweb,android;formats=missing_pot",
      ...cookieArgs,
      url.trim(),
    ];

    let stdout = "";
    let stderr = "";

    const proc = spawn(YTDLP_BIN, args);
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") { res.status(500).json({ error: "yt-dlp is not installed on the server." }); }
      else { res.status(500).json({ error: err.message }); }
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        const msg = stderr.includes("Sign in") ? "YouTube requires sign-in. Upload a cookies.txt file in the Cookies tab." :
                    stderr.includes("not a bot") ? "YouTube bot-detection triggered. Try uploading a cookies.txt file." :
                    `yt-dlp exited with code ${code}: ${stderr.slice(0, 300)}`;
        res.status(500).json({ error: msg });
        return;
      }

      const title = stdout.trim() || "Unknown Track";
      const token = crypto.randomUUID();
      musicProxyTokens.set(token, { originalUrl: url.trim(), title });
      // Auto-expire after 24 hours (token points to original URL, always fresh)
      setTimeout(() => musicProxyTokens.delete(token), 24 * 60 * 60 * 1000);

      res.json({ proxyUrl: `/api/music/proxy/${token}`, title });
    });
  });

  // Stream audio by piping yt-dlp stdout directly — avoids the 403 that occurs
  // when Node fetch() tries to use a session-tied CDN URL from a different session.
  // NOTE: no requireAuth here — the UUID token IS the credential. The audio element
  // uses crossOrigin="anonymous" so it sends no cookies; requireAuth would always 401.
  app.get("/api/music/proxy/:token", (req: Request, res: Response): void => {
    const entry = musicProxyTokens.get(String(req.params.token));
    if (!entry) {
      res.status(404).json({ error: "Track not found or session expired. Re-add the track." });
      return;
    }

    import("child_process").then(({ spawn }) => {
      import("./youtube-source").then(({ getCookiesArgs }) => {
        const cookieArgs = getCookiesArgs();
        const args = [
          "--no-config",
          "--no-playlist",
          "--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
          "--no-check-certificate",
          "--socket-timeout", "30",
          "--extractor-args", "youtube:player_client=ios,mweb,android;formats=missing_pot",
          "--output", "-",          // pipe audio bytes to stdout
          "--quiet",                // silence progress to stderr
          ...cookieArgs,
          entry.originalUrl,
        ];

        const ytdlp = spawn(YTDLP_BIN, args);

        // Detect format from first chunk to set Content-Type
        let headersSent = false;
        const setHeaders = (chunk: Buffer) => {
          if (headersSent) return;
          headersSent = true;
          // Sniff magic bytes: ftyp M4A = 0x66747970, WebM = 0x1a45dfa3
          let ct = "audio/mp4";
          if (chunk.length >= 4 && chunk[0] === 0x1a && chunk[1] === 0x45) ct = "audio/webm";
          res.setHeader("Content-Type", ct);
          res.setHeader("Accept-Ranges", "none");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Transfer-Encoding", "chunked");
        };

        ytdlp.stdout.on("data", (chunk: Buffer) => {
          setHeaders(chunk);
          if (!res.writableEnded) res.write(chunk);
        });

        ytdlp.stderr.on("data", (d: Buffer) => {
          const line = d.toString();
          // Only log actual errors, not progress
          if (line.includes("ERROR") || line.includes("error")) {
            console.error("[music-proxy] yt-dlp:", line.trim());
          }
        });

        ytdlp.on("close", (code) => {
          if (!headersSent && !res.headersSent) {
            res.status(502).json({ error: code !== 0 ? "yt-dlp failed to stream audio. Check server logs." : "Empty audio stream." });
          } else if (!res.writableEnded) {
            res.end();
          }
        });

        ytdlp.on("error", (err: NodeJS.ErrnoException) => {
          if (!res.headersSent) {
            res.status(500).json({ error: err.code === "ENOENT" ? "yt-dlp is not installed." : err.message });
          }
        });

        // Kill yt-dlp when client disconnects (e.g. user pauses or closes tab)
        req.on("close", () => {
          if (!ytdlp.killed) ytdlp.kill("SIGTERM");
        });
      });
    });
  });

  // ── Break video upload ────────────────────────────────────────────────────
  app.post(
    "/api/upload/break-video",
    requireAuth,
    upload.single("video"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No video file provided or unsupported format." });
        return;
      }
      const fileUrl = `/api/uploads/${req.file.filename}`;
      res.json({ url: fileUrl, filename: req.file.filename, size: req.file.size });
    }
  );

  app.get("/api/uploads/:filename", (req: Request, res: Response): void => {
    const filename = path.basename(String(req.params.filename));
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: "File not found" });
      return;
    }
    res.sendFile(filePath);
  });

  // ── Cookie file validator ──────────────────────────────────────────────────
  type CookieValidationResult = {
    valid: boolean;
    format: boolean;
    found: string[];
    missing: string[];
    message: string;
    detail?: string;
  };

  function validateNetscapeCookies(
    filePath: string,
    requiredTokens: string[],
    platform: "youtube" | "tiktok" | "x.com"
  ): CookieValidationResult {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      return { valid: false, format: false, found: [], missing: requiredTokens, message: "Could not read the uploaded file." };
    }

    const lines = raw.split("\n");
    const hasHeader = lines.some((l) => l.trim().startsWith("# Netscape HTTP Cookie File") || l.trim().startsWith("# HTTP Cookie File"));

    if (!hasHeader) {
      return {
        valid: false,
        format: false,
        found: [],
        missing: requiredTokens,
        message: "Invalid file format — this does not appear to be a Netscape HTTP Cookie File.",
        detail: "The file must start with '# Netscape HTTP Cookie File'. Use the 'Get cookies.txt LOCALLY' browser extension to export the correct format.",
      };
    }

    const cookieNames = new Set<string>();
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const parts = t.split("\t");
      if (parts.length >= 7) {
        cookieNames.add(parts[5].trim());
      }
    }

    const found = requiredTokens.filter((t) => cookieNames.has(t));
    const missing = requiredTokens.filter((t) => !cookieNames.has(t));
    const valid = missing.length === 0;

    if (!valid) {
      const platformLabel = platform === "youtube" ? "YouTube" : "TikTok";
      return {
        valid: false,
        format: true,
        found,
        missing,
        message: `Your cookies.txt is uploaded but ${platformLabel} still requires sign-in — the cookies may be expired or missing auth tokens (${missing.join(", ")}).`,
        detail: "Export fresh cookies from a logged-in Chrome/Firefox session using a browser extension like 'Get cookies.txt LOCALLY'. Make sure you are signed in before exporting.",
      };
    }

    return {
      valid: true,
      format: true,
      found,
      missing: [],
      message: platform === "youtube"
        ? "YouTube cookies verified — auth tokens found and applied."
        : "TikTok cookies verified — auth tokens found and applied.",
    };
  }

  // ── YouTube Cookies management ─────────────────────────────────────────────
  // Cookies are stored as cookies.txt (Netscape format) at <cwd>/cookies.txt.
  // They allow yt-dlp to bypass bot detection and age restrictions on YouTube.
  const cookiesUpload = multer({ dest: uploadDir });
  const cookiesPath = path.join(process.cwd(), "cookies.txt");

  const YT_REQUIRED_TOKENS = ["SID", "SAPISID", "SSID", "HSID", "APISID"];

  app.get("/api/settings/cookies", requireAuth, (_req: Request, res: Response): void => {
    const configured = fs.existsSync(cookiesPath);
    if (configured) {
      const validation = validateNetscapeCookies(cookiesPath, YT_REQUIRED_TOKENS, "youtube");
      const mtime = fs.statSync(cookiesPath).mtime;
      const ageDays = Math.floor((Date.now() - mtime.getTime()) / 86_400_000);
      res.json({ configured, validation, lastModified: mtime.toISOString(), ageDays });
    } else {
      res.json({ configured });
    }
  });

  app.post(
    "/api/settings/cookies",
    requireAuth,
    cookiesUpload.single("cookies"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No cookies file provided" });
        return;
      }
      fs.renameSync(req.file.path, cookiesPath);
      const validation = validateNetscapeCookies(cookiesPath, YT_REQUIRED_TOKENS, "youtube");
      res.json({ ok: validation.valid, saved: true, validation });
    }
  );

  app.delete("/api/settings/cookies", requireAuth, (_req: Request, res: Response): void => {
    if (fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
    res.json({ ok: true, message: "Cookies removed" });
  });

  // ── TikTok Cookies management ──────────────────────────────────────────────
  // Separate cookies.txt for TikTok (tiktok.com domain cookies).
  // Used by streamlink (--http-cookie-jar) and yt-dlp (--cookies).
  const tikTokCookiesUpload = multer({ dest: uploadDir });
  const tikTokCookiesPath = path.join(process.cwd(), "tiktok-cookies.txt");

  const TIKTOK_REQUIRED_TOKENS = ["sessionid"];

  app.get("/api/settings/tiktok-cookies", requireAuth, (_req: Request, res: Response): void => {
    const configured = fs.existsSync(tikTokCookiesPath);
    if (configured) {
      const validation = validateNetscapeCookies(tikTokCookiesPath, TIKTOK_REQUIRED_TOKENS, "tiktok");
      const mtime = fs.statSync(tikTokCookiesPath).mtime;
      const ageDays = Math.floor((Date.now() - mtime.getTime()) / 86_400_000);
      res.json({ configured, validation, lastModified: mtime.toISOString(), ageDays });
    } else {
      res.json({ configured });
    }
  });

  app.post(
    "/api/settings/tiktok-cookies",
    requireAuth,
    tikTokCookiesUpload.single("cookies"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No cookies file provided" });
        return;
      }
      fs.renameSync(req.file.path, tikTokCookiesPath);
      const validation = validateNetscapeCookies(tikTokCookiesPath, TIKTOK_REQUIRED_TOKENS, "tiktok");
      res.json({ ok: validation.valid, saved: true, validation });
    }
  );

  app.delete("/api/settings/tiktok-cookies", requireAuth, (_req: Request, res: Response): void => {
    if (fs.existsSync(tikTokCookiesPath)) fs.unlinkSync(tikTokCookiesPath);
    res.json({ ok: true, message: "TikTok cookies removed" });
  });

  // ── X (Twitter) Cookies management ────────────────────────────────────────
  // Separate cookies.txt for X/Twitter (x.com / twitter.com domain cookies).
  // Used by yt-dlp (--cookies) when extracting X Space audio URLs.
  const xCookiesUpload = multer({ dest: uploadDir });
  const xCookiesPath = path.join(process.cwd(), "x-cookies.txt");

  const X_REQUIRED_TOKENS = ["auth_token", "ct0"];

  app.get("/api/settings/x-cookies", requireAuth, (_req: Request, res: Response): void => {
    const configured = fs.existsSync(xCookiesPath);
    if (configured) {
      const validation = validateNetscapeCookies(xCookiesPath, X_REQUIRED_TOKENS, "x.com");
      const mtime = fs.statSync(xCookiesPath).mtime;
      const ageDays = Math.floor((Date.now() - mtime.getTime()) / 86_400_000);
      res.json({ configured, validation, lastModified: mtime.toISOString(), ageDays });
    } else {
      res.json({ configured });
    }
  });

  app.post(
    "/api/settings/x-cookies",
    requireAuth,
    xCookiesUpload.single("cookies"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No cookies file provided" });
        return;
      }
      fs.renameSync(req.file.path, xCookiesPath);
      const validation = validateNetscapeCookies(xCookiesPath, X_REQUIRED_TOKENS, "x.com");
      res.json({ ok: validation.valid, saved: true, validation });
    }
  );

  app.delete("/api/settings/x-cookies", requireAuth, (_req: Request, res: Response): void => {
    if (fs.existsSync(xCookiesPath)) fs.unlinkSync(xCookiesPath);
    res.json({ ok: true, message: "X cookies removed" });
  });

  // ── Connected camera guests (for WebRTC multi-view relay) ────────────────
  const connectedCamGuests = new Map<string, { ws: any; streamId: string; guestName: string }>();
  // Guests waiting for host approval
  const pendingCamGuests = new Map<string, { ws: any; streamId: string; guestName: string }>();

  app.get("/api/cam-guests", requireAuth, (_req: Request, res: Response): void => {
    const connected = Array.from(connectedCamGuests.entries()).map(([guestId, g]) => ({
      guestId, streamId: g.streamId, guestName: g.guestName, pending: false,
    }));
    const pending = Array.from(pendingCamGuests.entries()).map(([guestId, g]) => ({
      guestId, streamId: g.streamId, guestName: g.guestName, pending: true,
    }));
    res.json([...connected, ...pending]);
  });

  app.post("/api/cam-guests/:guestId/approve", requireAuth, (req: Request, res: Response): void => {
    const guestId = String(req.params.guestId);
    const entry = pendingCamGuests.get(guestId);
    if (!entry) { res.status(404).json({ message: "Guest not found in waiting room" }); return; }
    pendingCamGuests.delete(guestId);
    connectedCamGuests.set(guestId, entry);
    if (entry.ws.readyState === 1) {
      entry.ws.send(JSON.stringify({ type: "cam_approved" }));
    }
    const payload = JSON.stringify({ type: "cam_guest_join", guestId, streamId: entry.streamId, guestName: entry.guestName });
    for (const client of wss.clients) {
      if ((client as any).readyState === 1) (client as any).send(payload);
    }
    res.json({ success: true });
  });

  app.post("/api/cam-guests/:guestId/reject", requireAuth, (req: Request, res: Response): void => {
    const guestId = String(req.params.guestId);
    const entry = pendingCamGuests.get(guestId);
    if (!entry) { res.status(404).json({ message: "Guest not found" }); return; }
    pendingCamGuests.delete(guestId);
    if (entry.ws.readyState === 1) {
      entry.ws.send(JSON.stringify({ type: "cam_rejected", message: "The host declined your request to join." }));
    }
    const payload = JSON.stringify({ type: "cam_guest_leave", guestId });
    for (const client of wss.clients) {
      if ((client as any).readyState === 1) (client as any).send(payload);
    }
    res.json({ success: true });
  });

  // Use noServer:true for all WebSocket servers and route upgrades manually.
  // If multiple WebSocketServer instances share the same httpServer via the
  // `server` option, the ws library calls abortHandshake() when a path
  // doesn't match — destroying the socket before the correct server handles it.
  const wss      = new WebSocketServer({ noServer: true });
  const micWss   = new WebSocketServer({ noServer: true });
  const musicWss = new WebSocketServer({ noServer: true });
  const camWss   = new WebSocketServer({ noServer: true });
  const screenWss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const route = (target: typeof wss) => {
      target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
    };
    if (pathname === "/ws")         return route(wss);
    if (pathname === "/ws-mic")     return route(micWss);
    if (pathname === "/ws-music")   return route(musicWss);
    if (pathname === "/ws-cam")     return route(camWss);
    if (pathname === "/ws-screen")  return route(screenWss);
    socket.destroy();
  });

  wss.on("connection", (ws) => {
    addWSClient(ws);
    if (ws.readyState === ws.OPEN) {
      // Send current broadcast state so stage page syncs instantly
      ws.send(JSON.stringify({ type: "broadcast", streamId: null, data: broadcastState }));
      // Replay buffered logs for all active streams so a page-refresh doesn't lose history
      for (const [streamId, lines] of getStreamLogBuffers()) {
        for (const data of lines) {
          ws.send(JSON.stringify({ type: "log", streamId, data }));
        }
      }
      // Send currently connected guests so multi-view panel can populate immediately
      const guestsList = Array.from(connectedCamGuests.entries()).map(([guestId, g]) => ({
        guestId, streamId: g.streamId, guestName: g.guestName,
      }));
      if (guestsList.length > 0) {
        ws.send(JSON.stringify({ type: "cam_guests_list", guests: guestsList }));
      }
      // Send pending guests (waiting room)
      const pendingList = Array.from(pendingCamGuests.entries()).map(([guestId, g]) => ({
        guestId, streamId: g.streamId, guestName: g.guestName,
      }));
      if (pendingList.length > 0) {
        ws.send(JSON.stringify({ type: "cam_guests_pending_list", guests: pendingList }));
      }
    }

    // Relay admin→guest WebRTC signaling + respond to client heartbeat pings
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString());
        // Respond to client heartbeat pings so the client knows the connection is alive
        if (msg.type === "ping") {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (msg.type === "rtc_offer" && msg.guestId && msg.sdp) {
          const guest = connectedCamGuests.get(msg.guestId) ?? pendingCamGuests.get(msg.guestId);
          if (guest && guest.ws.readyState === 1) {
            guest.ws.send(JSON.stringify({ type: "rtc_offer", sdp: msg.sdp }));
          }
        }
        if (msg.type === "rtc_ice_admin" && msg.guestId && msg.candidate) {
          const guest = connectedCamGuests.get(msg.guestId) ?? pendingCamGuests.get(msg.guestId);
          if (guest && guest.ws.readyState === 1) {
            guest.ws.send(JSON.stringify({ type: "rtc_ice", candidate: msg.candidate }));
          }
        }
      } catch {}
    });
  });

  // ── /ws-mic — browser microphone → FFmpeg pipe:5 (PCM16 mono 44100 Hz) ──
  micWss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        feedMicAudio(data as Buffer);
      }
    });
  });

  // ── /ws-music — browser music player → FFmpeg pipe:5 (PCM16 mono 44100 Hz)
  // Dedicated route so music never shares the mic WebSocket — prevents audio
  // interleaving artefacts (scratches) when mic is inactive.
  musicWss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        feedMicAudio(data as Buffer);
      }
    });
  });

  // ── /ws-screen — browser screen-share JPEG frames → uiRenderer PIP ──────
  screenWss.on("connection", (ws) => {
    let authenticated = false;
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (authenticated) setScreenShareFrameForAll(data as Buffer);
        return;
      }
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "screen_auth" && msg.sessionId) {
          authenticated = true;
          ws.send(JSON.stringify({ type: "screen_auth_ok" }));
        }
      } catch {}
    });
    ws.on("close", () => { authenticated = false; });
  });

  // ── /ws-cam — browser camera WebM → FFmpeg stdin + WebRTC multi-view ───
  camWss.on("connection", (ws) => {
    let camStreamId: string | null = null;
    let authenticated = false;
    let currentGuestId: string | null = null;

    const broadcastToAdmins = (msg: object) => {
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if ((client as any).readyState === 1) (client as any).send(payload);
      }
    };

    const isMultiviewGuest = () => camStreamId === "__multiview__";

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (authenticated && camStreamId && !isMultiviewGuest()) writeToBrowserCamera(camStreamId, data as Buffer);
        return;
      }
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "cam_auth") {
          const entry = cameraTokens.get(String(msg.token));
          if (!entry || Date.now() > entry.expires) {
            ws.send(JSON.stringify({ type: "cam_auth_fail", message: "Invalid or expired camera link" }));
            return;
          }
          authenticated = true;
          camStreamId = entry.streamId;
          const stream = storage.getStream(entry.streamId);
          ws.send(JSON.stringify({ type: "cam_auth_ok", streamId: entry.streamId, streamStatus: stream?.status || "idle" }));
          return;
        }

        if (!authenticated || !camStreamId) return;

        // Guest announces they're joining — auto-approved immediately, no host approval needed
        if (msg.type === "cam_join") {
          const guestId = crypto.randomUUID();
          currentGuestId = guestId;
          const guestName = String(msg.guestName || "Guest").slice(0, 50);
          connectedCamGuests.set(guestId, { ws, streamId: camStreamId, guestName });
          broadcastToAdmins({ type: "cam_guest_joined", guestId, streamId: camStreamId, guestName });
          ws.send(JSON.stringify({ type: "cam_approved", guestId }));
          return;
        }

        // Update guest display name after join
        if (msg.type === "cam_guest_name" && currentGuestId) {
          const guestName = String(msg.guestName || "Guest").slice(0, 50);
          const entry = connectedCamGuests.get(currentGuestId);
          if (entry) {
            entry.guestName = guestName;
            broadcastToAdmins({ type: "cam_guest_update", guestId: currentGuestId, guestName });
          }
          return;
        }

        // Relay WebRTC answer from guest → admin dashboards
        if (msg.type === "rtc_answer" && msg.sdp && currentGuestId) {
          broadcastToAdmins({ type: "rtc_answer", guestId: currentGuestId, sdp: msg.sdp });
          return;
        }

        // Relay ICE candidates from guest → admin dashboards
        if (msg.type === "rtc_ice" && msg.candidate && currentGuestId) {
          broadcastToAdmins({ type: "rtc_ice_guest", guestId: currentGuestId, candidate: msg.candidate });
          return;
        }

        if (msg.type === "cam_start") {
          if (!isMultiviewGuest()) {
            browserCameraStreams.add(camStreamId);
            const stream = storage.getStream(camStreamId);
            if (stream) {
              startStream(camStreamId).catch((e: any) => {
                ws.send(JSON.stringify({ type: "cam_error", message: e.message }));
              });
            }
          } else {
            ws.send(JSON.stringify({ type: "cam_auth_ok", streamId: "__multiview__", streamStatus: "idle" }));
          }
        }

        if (msg.type === "cam_stop") {
          if (!isMultiviewGuest()) {
            browserCameraStreams.delete(camStreamId);
            stopStream(camStreamId);
          }
          ws.send(JSON.stringify({ type: "cam_stopped" }));
        }
      } catch {}
    });

    ws.on("close", () => {
      if (currentGuestId) {
        const wasConnected = connectedCamGuests.delete(currentGuestId);
        const wasPending = pendingCamGuests.delete(currentGuestId);
        if (wasConnected || wasPending) {
          broadcastToAdmins({ type: "cam_guest_leave", guestId: currentGuestId });
        }
      }
      if (camStreamId && !isMultiviewGuest()) {
        browserCameraStreams.delete(camStreamId);
        stopStream(camStreamId);
      }
    });
  });

  // ── AI Stream Controller ─────────────────────────────────────────────────
  import("./ai-assistant").then(({ processAIMessage }) => {
    app.post(
      "/api/ai/chat",
      requireAuth,
      async (req: Request, res: Response): Promise<void> => {
        try {
          const { message, history = [] } = req.body as {
            message: string;
            history: { role: "user" | "assistant"; content: string }[];
          };
          if (!message?.trim()) {
            res.status(400).json({ error: "message required" });
            return;
          }
          // Inject current broadcast state as context so AI knows what's active
          const ctx = [
            broadcastState.breakActive ? "break=ON" : "break=OFF",
            broadcastState.newsActive ? `news=ON:"${broadcastState.newsText}"` : "news=OFF",
            broadcastState.adActive ? "ad=ON" : "ad=OFF",
            broadcastState.chatBurnActive ? "chat=ON" : "chat=OFF",
            broadcastState.statsActive ? "stats=ON" : "stats=OFF",
            broadcastState.subsOverlayActive ? "subs=ON" : "subs=OFF",
            broadcastState.liveAudioMuted ? "streamAudio=MUTED" : "streamAudio=ON",
            `vol=${broadcastState.globalStreamVolume ?? 100}`,
          ].join(" | ");

          const streams = storage.getStreams();
          const streamCtx = streams.map((s: import("./schema").StreamConfig, i: number) =>
            `stream${i + 1}:${s.sourceType}/${s.tiktokUsername || s.youtubeSourceUrl || s.cameraDevice || "unnamed"}(${s.status})`
          ).join(", ");

          const enrichedMessage = `${message}\n\n[dashboard: ${ctx}]\n[streams: ${streamCtx || "none"}]`;

          const result = await processAIMessage(enrichedMessage, history);

          // Execute action server-side if present
          if (result.action) {
            const { type, params } = result.action;
            const p = params as Record<string, unknown>;

            const patch: Partial<typeof broadcastState> = {};

            if (type === "go_break") {
              patch.breakActive = true;
            } else if (type === "stop_break") {
              patch.breakActive = false;
            } else if (type === "set_break_text") {
              patch.breakText = String(p.text ?? "");
            } else if (type === "set_break_style") {
              patch.breakStyle = String(p.style ?? "Countdown");
            } else if (type === "enable_news") {
              patch.newsActive = true;
              if (p.text) patch.newsText = String(p.text);
              if (p.style) patch.newsStyle = String(p.style);
            } else if (type === "disable_news") {
              patch.newsActive = false;
            } else if (type === "set_news_text") {
              patch.newsText = String(p.text ?? "");
            } else if (type === "set_news_style") {
              patch.newsStyle = String(p.style ?? "Ticker");
            } else if (type === "set_news_color") {
              patch.newsBgColor = String(p.color ?? "#cc0001");
            } else if (type === "enable_ad") {
              patch.adActive = true;
              if (p.text) patch.adText = String(p.text);
              if (p.sub) patch.adSub = String(p.sub);
            } else if (type === "disable_ad") {
              patch.adActive = false;
            } else if (type === "set_ad_text") {
              patch.adText = String(p.text ?? "");
            } else if (type === "set_ad_sub") {
              patch.adSub = String(p.sub ?? "");
            } else if (type === "enable_stats") {
              patch.statsActive = true;
            } else if (type === "disable_stats") {
              patch.statsActive = false;
            } else if (type === "enable_subs") {
              patch.subsOverlayActive = true;
            } else if (type === "disable_subs") {
              patch.subsOverlayActive = false;
            } else if (type === "set_subs_goal") {
              patch.subsGoal = Number(p.goal ?? 1000000);
            } else if (type === "enable_chat") {
              patch.chatBurnActive = true;
            } else if (type === "disable_chat") {
              patch.chatBurnActive = false;
            } else if (type === "set_chat_style") {
              patch.chatBurnStyle = String(p.style ?? "Bubble");
            } else if (type === "enable_gradient") {
              patch.bgGradientActive = true;
            } else if (type === "disable_gradient") {
              patch.bgGradientActive = false;
            } else if (type === "set_gradient") {
              if (p.color1) patch.bgGradient1 = String(p.color1);
              if (p.color2) patch.bgGradient2 = String(p.color2);
            } else if (type === "mute_stream_audio") {
              patch.liveAudioMuted = true;
            } else if (type === "unmute_stream_audio") {
              patch.liveAudioMuted = false;
            } else if (type === "mute_break_video") {
              patch.breakVideoMuted = true;
            } else if (type === "unmute_break_video") {
              patch.breakVideoMuted = false;
            } else if (type === "set_volume") {
              patch.globalStreamVolume = Math.max(0, Math.min(100, Number(p.volume ?? 100)));
            } else if (type === "start_stream") {
              const target = String(p.target ?? "");
              const allStreams = storage.getStreams();
              if (target === "all") {
                allStreams.forEach((s) => startStream(s.id).catch(() => {}));
              } else {
                const idx = parseInt(target) - 1;
                if (allStreams[idx]) startStream(allStreams[idx].id).catch(() => {});
              }
            } else if (type === "stop_stream") {
              const target = String(p.target ?? "");
              const allStreams = storage.getStreams();
              if (target === "all") {
                allStreams.forEach((s) => stopStream(s.id));
              } else {
                const idx = parseInt(target) - 1;
                if (allStreams[idx]) stopStream(allStreams[idx].id);
              }
            } else if (type === "restart_stream") {
              const target = String(p.target ?? "");
              const allStreams = storage.getStreams();
              const idx = parseInt(target) - 1;
              if (allStreams[idx]) restartStream(allStreams[idx].id);
            } else if (type === "set_ticker_loop") {
              patch.newsTickerLoopSecs = Math.max(5, Math.min(120, Number(p.secs ?? 20)));
            } else if (type === "enable_logo") {
              patch.logoActive = true;
            } else if (type === "disable_logo") {
              patch.logoActive = false;
            } else if (type === "set_logo_position") {
              if (p.x !== undefined) patch.logoX = Math.max(0, Math.min(100, Number(p.x)));
              if (p.y !== undefined) patch.logoY = Math.max(0, Math.min(90, Number(p.y)));
            } else if (type === "set_logo_size") {
              patch.logoSize = Math.max(40, Math.min(300, Number(p.size ?? 120)));
            } else if (type === "set_logo_opacity") {
              patch.logoOpacity = Math.max(10, Math.min(100, Number(p.opacity ?? 100)));
            } else if (type === "set_logo_background") {
              patch.logoBgEnabled = !!p.enabled;
              if (p.color !== undefined) patch.logoBgColor = String(p.color);
              const allowedShapes = ["circle", "rounded", "square"];
              if (p.shape !== undefined && allowedShapes.includes(String(p.shape))) {
                patch.logoBgShape = p.shape as typeof broadcastState.logoBgShape;
              }
            } else if (type === "set_logo_animation") {
              const allowedAnims = ["None", "Fade", "Slide In", "Zoom", "Bounce", "Spin"];
              const a = String(p.animation ?? "Fade");
              if (allowedAnims.includes(a)) patch.logoAnimation = a as typeof broadcastState.logoAnimation;
              if (p.duration !== undefined) {
                patch.logoAnimGap = Math.max(0, Math.min(60, Number(p.duration)));
              }
            } else if (type === "set_news_speed") {
              patch.newsScrollSpeed = Math.max(5, Math.min(200, Number(p.speed ?? 30)));
            } else if (type === "news_overlay_enable") {
              import("./news-overlay/index.js").then(({ updateOverlay }) => updateOverlay({ active: true })).catch(() => {});
            } else if (type === "news_overlay_disable") {
              import("./news-overlay/index.js").then(({ updateOverlay }) => updateOverlay({ active: false })).catch(() => {});
            } else if (type === "news_overlay_set_theme") {
              import("./news-overlay/index.js").then(({ applyThemeFull }) => applyThemeFull(String(p.theme ?? "CNN") as Parameters<typeof applyThemeFull>[0])).catch(() => {});
            } else if (type === "news_overlay_add_ticker") {
              import("./news-overlay/index.js").then(({ addNewsTickerMessage }) => addNewsTickerMessage(String(p.text ?? ""), Number(p.priority ?? 0))).catch(() => {});
            } else if (type === "news_overlay_clear_ticker") {
              import("./news-overlay/index.js").then(({ clearNewsTickerMessages }) => clearNewsTickerMessages()).catch(() => {});
            } else if (type === "news_overlay_set_headline") {
              import("./news-overlay/index.js").then(({ updateOverlay, getState }) => {
                const cur = getState();
                updateOverlay({ headline: { ...cur.headline, text: String(p.text ?? "") } });
              }).catch(() => {});
            } else if (type === "news_overlay_breaking") {
              import("./news-overlay/index.js").then(({ activateBreakingNews }) => activateBreakingNews(String(p.text ?? "BREAKING NEWS"))).catch(() => {});
            } else if (type === "news_overlay_stop_breaking") {
              import("./news-overlay/index.js").then(({ deactivateBreakingNews }) => deactivateBreakingNews()).catch(() => {});
            } else if (type === "news_overlay_ticker_speed") {
              import("./news-overlay/index.js").then(({ updateTickerConfig }) => updateTickerConfig({ speed: Math.max(5, Math.min(100, Number(p.speed ?? 30))) })).catch(() => {});
            } else if (type === "news_overlay_add_headlines") {
              import("./news-overlay/index.js").then(({ updateOverlay, getState }) => {
                const cur = getState();
                const newHeadlines = Array.isArray(p.headlines) ? p.headlines.map(String) : [String(p.headlines ?? "")];
                updateOverlay({ headline: { ...cur.headline, headlines: [...cur.headline.headlines, ...newHeadlines], autoRotate: true } });
              }).catch(() => {});
            } else if (type === "set_screen_mode") {
              const allowed = ["pip", "presenter", "fullscreen"];
              const mode = String(p.mode ?? "pip");
              if (allowed.includes(mode)) patch.screenShareMode = mode as typeof broadcastState.screenShareMode;
            }

            if (Object.keys(patch).length > 0) {
              broadcastState = { ...broadcastState, ...patch };
              broadcastGlobal("broadcast", broadcastState);
              // Only forward the legacy news-* fields when this AI command
              // actually targeted the news ticker. Otherwise they carry stale
              // `broadcastState` defaults that would stomp on the live
              // news-overlay module state (see news-overlay/overlay-manager.ts),
              // silently switching the news ticker OFF whenever an unrelated
              // AI command (e.g. "mute the mic") is run.
              const isNewsCommand = [
                "enable_news", "disable_news", "set_news_text",
                "set_news_style", "set_news_color",
              ].includes(type);
              updateStreamOverlays({
                ...(isNewsCommand ? {
                  newsActive: broadcastState.newsActive,
                  newsText: broadcastState.newsText,
                  newsTitle: broadcastState.newsTitle,
                  newsBgColor: broadcastState.newsBgColor,
                  newsStyle: broadcastState.newsStyle,
                  newsAnimation: broadcastState.newsAnimation,
                  newsPosition: broadcastState.newsPosition,
                } : {}),
                adActive: broadcastState.adActive,
                adText: broadcastState.adText,
                adSub: broadcastState.adSub,
                adStyle: broadcastState.adStyle,
                adPosition: broadcastState.adPosition,
                breakActive: broadcastState.breakActive,
                breakText: broadcastState.breakText,
                breakStyle: broadcastState.breakStyle,
                breakVideoUrl: broadcastState.breakVideoUrl,
                breakVideoMode: broadcastState.breakVideoMode,
                breakVideoPanX: broadcastState.breakVideoPanX,
                breakVideoPanY: broadcastState.breakVideoPanY,
                liveAudioMuted: broadcastState.liveAudioMuted,
                breakVideoMuted: broadcastState.breakVideoMuted,
                statsActive: broadcastState.statsActive,
                statsPosition: broadcastState.statsPosition,
                subsOverlayActive: broadcastState.subsOverlayActive,
                subsStyle: broadcastState.subsStyle,
                subsPosition: broadcastState.subsPosition,
                subsGoal: broadcastState.subsGoal,
                subChartActive: broadcastState.subChartActive,
                subChartData: broadcastState.subChartData,
                subChartPosition: broadcastState.subChartPosition,
                mobileSubChartPosition: broadcastState.mobileSubChartPosition,
                subAlertActive: broadcastState.subAlertActive,
                subAlertMessage: broadcastState.subAlertMessage,
                chatBurnActive: broadcastState.chatBurnActive,
                chatBurnStyle: broadcastState.chatBurnStyle,
                chatBurnPosition: broadcastState.chatBurnPosition,
                superChatMessages: broadcastState.superChatMessages,
                guestNameActive: broadcastState.guestNameActive,
                guestName: broadcastState.guestName,
                guestTitle: broadcastState.guestTitle,
                guestStyle: broadcastState.guestStyle,
                guestPosition: broadcastState.guestPosition,
                mobileGuestPosition: broadcastState.mobileGuestPosition,
                bgGradientActive: broadcastState.bgGradientActive,
                bgGradient1: broadcastState.bgGradient1,
                bgGradient2: broadcastState.bgGradient2,
                bgGradientOpacity: broadcastState.bgGradientOpacity,
                mobileStatsPosition: broadcastState.mobileStatsPosition,
                mobileSubsPosition: broadcastState.mobileSubsPosition,
                mobileChatBurnPosition: broadcastState.mobileChatBurnPosition,
                mobileNewsPosition: broadcastState.mobileNewsPosition,
                mobileAdPosition: broadcastState.mobileAdPosition,
                statsScale: broadcastState.statsScale,
                subsScale: broadcastState.subsScale,
                chatBurnScale: broadcastState.chatBurnScale,
                newsScale: broadcastState.newsScale,
                adScale: broadcastState.adScale,
                guestScale: broadcastState.guestScale,
                subChartScale: broadcastState.subChartScale,
                qrActive: broadcastState.qrActive,
                qrUrl: broadcastState.qrUrl,
                qrTitle: broadcastState.qrTitle,
                qrSize: broadcastState.qrSize,
                qrPosition: broadcastState.qrPosition,
                qrScanCount: getQRScanCount(),
                qrThankYouActive: (Date.now() - broadcastState.qrThankYouTs) < 11_000 && !!broadcastState.qrThankYouName,
                qrThankYouName: broadcastState.qrThankYouName,
                qrThankYouTs: broadcastState.qrThankYouTs,
                featuredComment: broadcastState.featuredComment,
                screenShareActive: broadcastState.screenShareActive,
                screenShareMode: broadcastState.screenShareMode,
                screenShareX: broadcastState.screenShareX,
                screenShareY: broadcastState.screenShareY,
                screenShareW: broadcastState.screenShareW,
                screenShareRadius: broadcastState.screenShareRadius,
                donationTickerActive: broadcastState.donationTickerActive,
                donationAlertActive:  broadcastState.donationAlertActive,
                thankYouStyle:        broadcastState.thankYouStyle,
                donationTicker:       broadcastState.donationTicker,
                giftDisplayMode:      broadcastState.giftDisplayMode,
                giftQueue:            getGiftQueue(),
                newsTickerLoopSecs:   broadcastState.newsTickerLoopSecs,
                logoActive:           broadcastState.logoActive,
                logoUrl:              broadcastState.logoUrl,
                logoX:                broadcastState.logoX,
                logoY:                broadcastState.logoY,
                logoSize:             broadcastState.logoSize,
                logoOpacity:          broadcastState.logoOpacity,
                logoBgEnabled:        broadcastState.logoBgEnabled,
                logoBgColor:          broadcastState.logoBgColor,
                logoBgShape:          broadcastState.logoBgShape,
                logoAnimation:        broadcastState.logoAnimation,
                logoAnimGap:     broadcastState.logoAnimGap,
              });
              // Broadcast updated state back so frontend syncs
              broadcastGlobal("broadcast", broadcastState);
            }
          }

          res.json(result);
        } catch (e: any) {
          res.status(500).json({ error: e.message ?? "AI error" });
        }
      }
    );
  });

  // ── Donation Gateway ──────────────────────────────────────────────────────
  registerDonationGateway(app);

  // Maintain a queue of active donation alerts to push to overlay renderers
  let donationAlertQueue: Array<{ id: string; name: string; amount: string; amountKes: number; currency: string; message: string; color: string; ts: number }> = [];

  setDonationCallback((donation) => {
    // Trim expired alerts (> 30 s) then append new one
    donationAlertQueue = [
      ...donationAlertQueue.filter(a => Date.now() - a.ts < 30000),
      { id: donation.id, name: donation.name, amount: donation.amount, amountKes: donation.amountKes, currency: donation.currency, message: donation.message, color: donation.color, ts: donation.ts },
    ].slice(-10);

    // Prepend to donation ticker (most recent first), keep last 20
    broadcastState.donationTicker = [
      { name: donation.name, amount: donation.amount, amountKes: donation.amountKes, color: donation.color, ts: donation.ts },
      ...broadcastState.donationTicker,
    ].slice(0, 20);

    // Track QR thank-you state in broadcastState so new streams pick it up
    broadcastState.qrThankYouName = donation.name.split(" ")[0] ?? donation.name;
    broadcastState.qrThankYouTs   = donation.ts;

    // Push directly to all active overlay renderers (no stream restart needed)
    updateStreamOverlays({
      donationAlerts:       donationAlertQueue,
      donationTicker:       broadcastState.donationTicker,
      donationTickerActive: broadcastState.donationTickerActive,
      donationAlertActive:  broadcastState.donationAlertActive,
    });
  });

  // Auto-populate QR code URL with the donation gateway URL on startup
  // (only if the user has not set a custom QR URL yet)
  const gatewayUrl = getGatewayPaymentUrl();
  if (gatewayUrl && !broadcastState.qrUrl) {
    broadcastState.qrUrl   = gatewayUrl;
    broadcastState.qrTitle = "SUPER CHAT";
  }


  // ── Paystack payment QR flow ──────────────────────────────────────────────

  const PAYSTACK_BASE = "https://api.paystack.co";
  const FETCH_TIMEOUT_MS = 12000;

  function paystackHeaders() {
    const key = process.env["PAYSTACK_SECRET_KEY"];
    if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
    return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  async function fetchWithTimeout(url: string, opts: RequestInit, ms = FETCH_TIMEOUT_MS): Promise<globalThis.Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await globalThis.fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const paymentSessions = new Map<string, {
    reference: string;
    amount: number;
    currency: string;
    title: string;
    status: "active" | "scanned" | "paid";
    payerName: string | null;
    payerEmail: string | null;
    createdAt: number;
  }>();

  const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
  const RATE_LIMIT_WINDOW = 60_000;
  const RATE_LIMIT_MAX    = 20;

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitMap.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
  }

  setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW * 2;
    for (const [ip, e] of rateLimitMap) { if (e.windowStart < cutoff) rateLimitMap.delete(ip); }
    const sessionCutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [sid, sess] of paymentSessions) { if (sess.createdAt < sessionCutoff) paymentSessions.delete(sid); }
  }, 5 * 60 * 1000);

  app.post("/api/paystack/init", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "Too many payment requests. Please wait a minute." });
      return;
    }
    const { title, amount, streamId, currency } = req.body as {
      title?: string; amount?: number; streamId?: string; currency?: string;
    };
    if (!amount || !streamId) { res.status(400).json({ error: "amount and streamId required" }); return; }
    if (amount <= 0 || amount > 100_000) { res.status(400).json({ error: "amount must be between 0 and 100,000" }); return; }
    const amountSmallest = Math.round(amount * 100);
    const useCurrency = (currency ?? process.env["PAYSTACK_CURRENCY"] ?? "NGN").toUpperCase();
    const reference = `bnpay_${streamId.slice(0, 8)}_${Date.now()}`;
    const email = `viewer_${Date.now()}@bintupay.live`;
    const host = process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : `http://localhost:${process.env["PORT"] || 8080}`;
    const callbackUrl = `${host}/api/paystack/paid?ref=${reference}&sid=${encodeURIComponent(streamId)}`;
    try {
      const txBody: Record<string, unknown> = {
        email,
        amount: amountSmallest,
        reference,
        callback_url: callbackUrl,
        metadata: {
          stream_id: streamId,
          title: title || "Live Stream Payment",
          custom_fields: [
            { display_name: "Stream", variable_name: "stream_id", value: streamId },
            { display_name: "Title",  variable_name: "payment_title", value: title || "Payment" },
          ],
        },
      };
      if (process.env["PAYSTACK_CURRENCY"]) {
        txBody["currency"] = process.env["PAYSTACK_CURRENCY"].toUpperCase();
      }
      const r = await fetchWithTimeout(`${PAYSTACK_BASE}/transaction/initialize`, {
        method: "POST",
        headers: paystackHeaders(),
        body: JSON.stringify(txBody),
      });
      const data = await r.json() as unknown as {
        status: boolean;
        message?: string;
        data?: { authorization_url: string; reference: string };
      };
      if (!data.status || !data.data) {
        res.status(502).json({ error: data.message ?? "Paystack rejected the request", paystackStatus: data.status });
        return;
      }
      paymentSessions.set(streamId, {
        reference, amount: amountSmallest, currency: useCurrency, title: title || "Payment",
        status: "active", payerName: null, payerEmail: null, createdAt: Date.now(),
      });
      const scanUrl = `${host}/api/paystack/scan?ref=${encodeURIComponent(reference)}&sid=${encodeURIComponent(streamId)}&to=${encodeURIComponent(data.data.authorization_url)}`;
      res.json({ reference, currency: useCurrency, checkoutUrl: data.data.authorization_url, scanUrl });
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "AbortError") {
        res.status(504).json({ error: "Paystack API timed out. Try again." });
      } else {
        res.status(500).json({ error: e instanceof Error ? e.message : "Unexpected error" });
      }
    }
  });

  app.get("/api/paystack/scan", (req: Request, res: Response): void => {
    const { ref, sid, to } = req.query as { ref?: string; sid?: string; to?: string };
    if (sid && paymentSessions.has(sid)) {
      const sess = paymentSessions.get(sid)!;
      if (sess.reference === ref && sess.status === "active") {
        sess.status = "scanned";
        broadcastGlobal("paystack_scan", { streamId: sid, reference: ref });
      }
    }
    if (to) { res.redirect(decodeURIComponent(to)); }
    else { res.send("Redirecting to payment…"); }
  });

  app.get("/api/paystack/paid", async (req: Request, res: Response): Promise<void> => {
    const { ref, sid } = req.query as { ref?: string; sid?: string };
    if (!ref || !sid) { res.send("<h2>Payment complete. Return to the stream.</h2>"); return; }
    try {
      const r = await fetchWithTimeout(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(ref)}`, {
        headers: paystackHeaders(),
      });
      const data = await r.json() as unknown as {
        status: boolean;
        data?: { status: string; customer?: { first_name?: string; last_name?: string; email?: string } };
      };
      if (data.status && data.data?.status === "success") {
        const customer = data.data.customer;
        const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || customer?.email || "Someone";
        const sess = paymentSessions.get(sid);
        if (sess) { sess.status = "paid"; sess.payerName = name; sess.payerEmail = customer?.email || null; }
        broadcastGlobal("paystack_paid", { streamId: sid, reference: ref, payerName: name });
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Thank you!</title><style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#fff}h1{font-size:2rem;margin-bottom:8px}p{color:rgba(255,255,255,0.6);font-size:1.1rem}</style></head><body><h1>🎉 Thank you, ${name}!</h1><p>Your payment was received. You can close this tab.</p></body></html>`);
      } else {
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment</title><style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#fff}</style></head><body><h2>Payment pending or not confirmed yet.</h2><p>Please contact the streamer if you believe this is an error.</p></body></html>`);
      }
    } catch {
      res.send("<h2>Payment verification error. Please contact the streamer.</h2>");
    }
  });

  app.post("/api/paystack/webhook",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response): void => {
      const sig = req.headers["x-paystack-signature"] as string | undefined;
      const key = process.env["PAYSTACK_SECRET_KEY"];
      if (key && sig) {
        const expected = crypto.createHmac("sha512", key).update(req.body as Buffer).digest("hex");
        if (expected !== sig) { res.status(401).send("Bad signature"); return; }
      }
      res.sendStatus(200);
      try {
        const evt = JSON.parse((req.body as Buffer).toString()) as {
          event: string;
          data?: {
            reference?: string;
            status?: string;
            metadata?: { stream_id?: string };
            customer?: { first_name?: string; last_name?: string; email?: string };
          };
        };
        if (evt.event === "charge.success") {
          const sid = evt.data?.metadata?.stream_id;
          const ref = evt.data?.reference;
          const customer = evt.data?.customer;
          const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || customer?.email || "Someone";
          if (sid) {
            const sess = paymentSessions.get(sid);
            if (sess && ref === sess.reference) { sess.status = "paid"; sess.payerName = name; sess.payerEmail = customer?.email || null; }
            broadcastGlobal("paystack_paid", { streamId: sid, reference: ref, payerName: name });
          }
        }
      } catch {}
    }
  );

  app.get("/api/paystack/status", requireAuth, (req: Request, res: Response): void => {
    const { streamId } = req.query as { streamId?: string };
    if (!streamId || !paymentSessions.has(streamId)) { res.json({ status: "none" }); return; }
    const sess = paymentSessions.get(streamId)!;
    res.json({ status: sess.status, payerName: sess.payerName, reference: sess.reference, title: sess.title, amount: sess.amount, currency: sess.currency });
  });

  app.delete("/api/paystack/reset", requireAuth, (req: Request, res: Response): void => {
    const { streamId } = req.query as { streamId?: string };
    if (streamId) paymentSessions.delete(streamId);
    res.json({ ok: true });
  });

  // ── News Overlay module ────────────────────────────────────────────────────
  // Pass updateStreamOverlays so the news overlay API can push directly into the
  // canvas renderer (pipe:4 → FFmpeg) when activated — not just to browser WS clients.
  initNewsOverlay(broadcastGlobal, (patch) => updateStreamOverlays(patch as Parameters<typeof updateStreamOverlays>[0]));
  app.use("/api/news-overlay", requireAuth, newsOverlayRouter);

  // ── Sections module ────────────────────────────────────────────────────────
  // Full CRUD for named content sections with emoji / Unicode support.
  app.use("/api/sections", requireAuth, sectionsRouter);

  // ── Stream manager: health scorer + failover init ─────────────────────────
  initStreamManager();

  // ── Watcher & Layout initialisation ──────────────────────────────────────
  initWatcher(broadcastStream, broadcastGlobal);

  // ── Stream Watcher routes ─────────────────────────────────────────────────

  /** GET /api/streams/watcher/status — list all active watchers */
  app.get("/api/streams/watcher/status", requireAuth, (_req: Request, res: Response): void => {
    const all = getAllWatchers().map((e) => ({
      streamId: e.streamId,
      sourceType: e.sourceType,
      identifier: e.identifier,
      status: e.status,
      resolvedUrl: e.resolvedUrl,
      resolvedBy: e.resolvedBy,
      lastChecked: e.lastChecked,
      nextCheckAt: e.nextCheckAt,
      consecutiveErrors: e.consecutiveErrors,
      totalPolls: e.totalPolls,
      startedAt: e.startedAt,
    }));
    res.json(all);
  });

  /** GET /api/streams/:id/watcher — get watcher status for a specific stream */
  app.get("/api/streams/:id/watcher", requireAuth, (req: Request, res: Response): void => {
    const entry = getWatcherEntry(String(req.params.id));
    if (!entry) { res.json({ watching: false }); return; }
    res.json({
      watching: true,
      streamId: entry.streamId,
      sourceType: entry.sourceType,
      identifier: entry.identifier,
      status: entry.status,
      resolvedUrl: entry.resolvedUrl,
      resolvedBy: entry.resolvedBy,
      lastChecked: entry.lastChecked,
      nextCheckAt: entry.nextCheckAt,
      consecutiveErrors: entry.consecutiveErrors,
      totalPolls: entry.totalPolls,
      startedAt: entry.startedAt,
      logs: entry.logs,
    });
  });

  /** POST /api/streams/:id/watch — start watching (auto-poll until live) */
  app.post("/api/streams/:id/watch", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

    const { sourceType, identifier } = req.body as {
      sourceType?: string;
      identifier?: string;
    };

    const resolvedType = (sourceType ?? stream.sourceType ?? "tiktok") as "tiktok" | "youtube";
    const resolvedId = identifier
      ?? (resolvedType === "tiktok" ? stream.tiktokUsername : stream.youtubeSourceUrl)
      ?? "";

    if (!resolvedId) {
      res.status(400).json({ error: "identifier required (username for TikTok, URL/handle for YouTube)" });
      return;
    }

    const entry = startWatching(streamId, resolvedType, resolvedId);
    res.json({
      ok: true,
      streamId: entry.streamId,
      sourceType: entry.sourceType,
      identifier: entry.identifier,
      status: entry.status,
    });
  });

  /** DELETE /api/streams/:id/watch — stop watching */
  app.delete("/api/streams/:id/watch", requireAuth, (req: Request, res: Response): void => {
    removeWatcher(String(req.params.id));
    res.json({ ok: true });
  });

  // ── Layout Engine routes ──────────────────────────────────────────────────

  /** GET /api/layout — get the current computed layout */
  app.get("/api/layout", requireAuth, (_req: Request, res: Response): void => {
    res.json(getCurrentLayout());
  });

  /** POST /api/layout/compute — recompute layout for a given set of stream IDs */
  app.post("/api/layout/compute", requireAuth, (req: Request, res: Response): void => {
    const { streamIds, mode } = req.body as {
      streamIds?: string[];
      mode?: "auto" | "pip";
    };

    if (!Array.isArray(streamIds) || streamIds.length === 0) {
      res.status(400).json({ error: "streamIds[] required" });
      return;
    }

    const layout = mode === "pip" && streamIds.length === 2
      ? computePiPLayout(streamIds[0], streamIds[1])
      : computeLayout(streamIds);

    res.json(layout);
  });

  /** GET /api/layout/pixels — layout converted to pixel coordinates */
  app.get("/api/layout/pixels", requireAuth, (req: Request, res: Response): void => {
    const { w, h } = req.query as { w?: string; h?: string };
    const outW = parseInt(w ?? "1280", 10);
    const outH = parseInt(h ?? "720", 10);
    if (isNaN(outW) || isNaN(outH) || outW <= 0 || outH <= 0) {
      res.status(400).json({ error: "w and h must be positive integers" });
      return;
    }
    const px = layoutToPixels(getCurrentLayout(), outW, outH);
    res.json({ layout: getCurrentLayout(), pixels: px, outputW: outW, outputH: outH });
  });

  // ── Stream health check routes ────────────────────────────────────────────

  /** GET /api/streams/:id/health — check the resolved URL health */
  app.get("/api/streams/:id/health", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

    const { url } = req.query as { url?: string };
    const targetUrl = url ?? "";

    if (!targetUrl) {
      res.status(400).json({ error: "url query parameter required" });
      return;
    }

    const sourceType = stream.sourceType ?? "tiktok";
    try {
      const result = sourceType === "youtube"
        ? await checkYouTubeStreamHealth(targetUrl)
        : await checkTikTokStreamHealth(targetUrl);

      res.json({ streamId, url: targetUrl, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /** GET /api/streams/:id/reconnect-stats — TikTok reconnect history */
  app.get("/api/streams/:id/reconnect-stats", requireAuth, (req: Request, res: Response): void => {
    const stream = storage.getStream(String(req.params.id));
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const username = stream.tiktokUsername ?? "";
    const stats = getReconnectStats(username);
    res.json(stats ?? { count: 0, lastAt: null, errors: [] });
  });

  /** GET /api/streams/tools/status — check if streamlink and yt-dlp are installed */
  app.get("/api/streams/tools/status", requireAuth, async (_req: Request, res: Response): Promise<void> => {
    const check = (tool: string): Promise<{ installed: boolean; version?: string }> =>
      new Promise((resolve) => {
        const proc = require("child_process").spawn(tool, ["--version"]);
        let out = "";
        proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { out += d.toString(); });
        proc.on("close", (code: number) => {
          resolve({ installed: code === 0, version: out.split("\n")[0]?.trim().slice(0, 80) });
        });
        proc.on("error", () => resolve({ installed: false }));
      });

    const [streamlink, ytdlp, ffmpeg] = await Promise.all([
      check("streamlink"),
      check("yt-dlp"),
      check("ffmpeg"),
    ]);

    res.json({
      streamlink,
      ytdlp,
      ffmpeg,
      tikTokCookies: getTikTokCookiesConfigured(),
      youtubeCookies: getYTCookiesConfigured(),
    });
  });

  startLiveCountPolling();
  httpServer.on("close", stopLiveCountPolling);

  // ══════════════════════════════════════════════════════════════════════════
  // Health Scoring & Source Failover API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/streams/:id/recovery-status
   * Returns the full recovery pipeline state for a stream:
   * circuit-breaker (state, failures, cooldown), exponential backoff level,
   * restart-lock flag, and the current health-scorer snapshot — all in one
   * response so the dashboard can render a complete recovery panel.
   */
  app.get("/api/streams/:id/recovery-status", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

    const recovery = getRecoverySnapshot(streamId);
    const health = getHealthSnapshot(streamId);

    res.json({ ...recovery, health: health ?? null });
  });

  /**
   * GET /api/streams/:id/health-score
   * Returns the live 0-100 health snapshot for a stream.
   * Includes score, status label, component breakdown, and live metrics.
   */
  app.get("/api/streams/:id/health-score", requireAuth, (req: Request, res: Response): void => {
    const stream = storage.getStream(String(req.params.id));
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const snap = getHealthSnapshot(String(req.params.id));
    if (!snap) {
      res.json({
        streamId: String(req.params.id),
        score: 0,
        status: "idle",
        message: "Stream not currently active",
        components: { ffmpegAlive: 0, bitrateStable: 0, fpsStable: 0, reconnectRate: 0, rtmpErrors: 0 },
        metrics: { currentBitrateKbps: 0, targetBitrateKbps: 0, currentFps: 0, reconnectCount: 0, reconnectsInWindow: 0, lastRtmpErrorAt: null, lastUpdatedAt: Date.now() },
      });
      return;
    }
    res.json(snap);
  });

  /**
   * GET /api/streams/:id/aqm
   * Returns the current Adaptive Quality Manager state for a stream.
   * Includes stage (0=nominal, 1-5=degraded), phase, bottleneck classification,
   * and the active quality override (bitrate/fps/resolution/preset).
   */
  app.get("/api/streams/:id/aqm", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params["id"]);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const snap = getAQMSnapshot(streamId);
    if (!snap) {
      res.json({ streamId, stage: 0, phase: "nominal", bottleneck: null, override: null, message: "AQM not active (stream not running)" });
      return;
    }
    res.json({ streamId, ...snap });
  });

  /**
   * POST /api/streams/:id/aqm/mode
   * Set the Adaptive Output Quality Controller mode for a running stream.
   * Body: { mode: "auto" | "force_4k" | "force_1440p" | "force_1080p" | "force_720p" |
   *               "force_540p" | "force_480p" | "force_360p" | "force_240p" }
   *
   * - "auto": AQM dynamically adjusts resolution based on CPU/network performance.
   * - "force_*": Locks output to a fixed resolution; AQM collects metrics but never degrades.
   *
   * Also persists aqmMode to storage so it survives stream restarts.
   */
  app.post("/api/streams/:id/aqm/mode", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params["id"]);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }

    const VALID_MODES = ["auto", "force_4k", "force_1440p", "force_1080p", "force_720p", "force_540p", "force_480p", "force_360p", "force_240p"];
    const { mode } = req.body as { mode?: string };
    if (!mode || !VALID_MODES.includes(mode)) {
      res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}` });
      return;
    }

    // Persist the mode to storage so it survives restarts
    storage.updateStream(streamId, { aqmMode: mode as any });

    // Apply to the live AQM instance if the stream is currently running
    const applied = setAQMMode(streamId, mode);

    const snap = getAQMSnapshot(streamId);
    res.json({
      ok: true,
      streamId,
      mode,
      applied,
      resolution: snap?.override
        ? `${snap.override.scaleW}×${snap.override.scaleH}`
        : "original",
      message: applied
        ? `AQM mode set to "${mode}" on live stream`
        : `AQM mode saved — will apply on next stream start`,
    });
  });

  /**
   * GET /api/health/all
   * Returns health snapshots for all currently active streams.
   */
  app.get("/api/health/all", requireAuth, (_req: Request, res: Response): void => {
    res.json(getAllHealthSnapshots());
  });

  // ── Failover chain routes ─────────────────────────────────────────────────

  /**
   * GET /api/streams/:id/failover
   * Returns the current failover chain configuration for a stream.
   */
  app.get("/api/streams/:id/failover", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const chain = getFailoverChain(streamId);
    const current = getCurrentSource(streamId);
    res.json({ streamId, chain, currentSource: current });
  });

  /**
   * POST /api/streams/:id/failover/chain
   * Set a failover chain for a stream.
   * Body: { sources: FailoverSource[], stableResetMs?: number }
   */
  app.post("/api/streams/:id/failover/chain", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const { sources, stableResetMs } = req.body;
    if (!Array.isArray(sources) || sources.length === 0) {
      res.status(400).json({ error: "sources must be a non-empty array" }); return;
    }
    setFailoverChain(streamId, sources, stableResetMs);
    res.json({ ok: true, chainLength: sources.length });
  });

  /**
   * POST /api/streams/:id/failover/chain/auto
   * Auto-build a failover chain from the stream's current configuration.
   * Body: { fallbackVideoPath?: string }
   */
  app.post("/api/streams/:id/failover/chain/auto", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const { fallbackVideoPath } = req.body ?? {};
    const sources = buildDefaultChain(streamId, fallbackVideoPath);
    if (!sources.length) { res.status(400).json({ error: "Could not build chain from current config" }); return; }
    setFailoverChain(streamId, sources);
    res.json({ ok: true, sources });
  });

  /**
   * DELETE /api/streams/:id/failover/chain
   * Remove the failover chain for a stream.
   */
  app.delete("/api/streams/:id/failover/chain", requireAuth, (req: Request, res: Response): void => {
    removeFailoverChain(String(req.params.id));
    res.json({ ok: true });
  });

  /**
   * POST /api/streams/:id/failover/trigger
   * Manually trigger failover to the next source in the chain.
   * Body: { reason?: string }
   */
  app.post("/api/streams/:id/failover/trigger", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const reason = req.body?.reason ?? "manual";
    const didFailover = triggerFailover(streamId, reason);
    if (!didFailover) {
      res.status(409).json({ error: "No failover chain configured, or already at last source" }); return;
    }
    const current = getCurrentSource(streamId);
    res.json({ ok: true, currentSource: current });
  });

  /**
   * POST /api/streams/:id/failover/reset
   * Reset the failover chain back to the primary source.
   */
  app.post("/api/streams/:id/failover/reset", requireAuth, (req: Request, res: Response): void => {
    const streamId = String(req.params.id);
    const stream = storage.getStream(streamId);
    if (!stream) { res.status(404).json({ error: "Stream not found" }); return; }
    const didReset = resetToPrimary(streamId, "manual");
    if (!didReset) {
      res.json({ ok: true, message: "Already on primary source — no change" }); return;
    }
    res.json({ ok: true, message: "Reset to primary source and restarting pipeline" });
  });

  /**
   * GET /api/failover/all
   * Returns failover chain status for all streams.
   */
  app.get("/api/failover/all", requireAuth, (_req: Request, res: Response): void => {
    res.json(getAllChains());
  });

  // ══════════════════════════════════════════════════════════════════════════
  // YouTube OAuth2 Device-Code Authentication
  // Alternative to cookies.txt — sign in once from any browser, token persists.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/youtube/oauth2/status
   * Returns current OAuth2 state: idle | pending | authenticated | failed
   */
  app.get("/api/youtube/oauth2/status", requireAuth, (_req: Request, res: Response): void => {
    const state = getOAuth2State();
    res.json({ ...state, configured: isOAuth2Authenticated() });
  });

  /**
   * POST /api/youtube/oauth2/start
   * Starts the yt-dlp OAuth2 device-code flow.
   * Returns { deviceUrl, userCode } — user opens deviceUrl on any browser and signs in.
   * The background process keeps running until auth completes.
   */
  app.post("/api/youtube/oauth2/start", requireAuth, async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await startOAuth2Flow();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/youtube/oauth2/cancel
   * Cancels an in-progress OAuth2 flow.
   */
  app.post("/api/youtube/oauth2/cancel", requireAuth, (_req: Request, res: Response): void => {
    cancelOAuth2Flow();
    res.json({ ok: true });
  });

  /**
   * DELETE /api/youtube/oauth2
   * Clears the saved OAuth2 token, requiring re-authentication.
   */
  app.delete("/api/youtube/oauth2", requireAuth, (_req: Request, res: Response): void => {
    clearOAuth2Token();
    res.json({ ok: true, message: "OAuth2 token cleared" });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Metrics — System-wide and per-stream metrics endpoint
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/metrics
   * Returns system-wide metrics: CPU, RAM, uptime, per-stream fps/bitrate/speed.
   */
  app.get("/api/metrics", requireAuth, (_req: Request, res: Response): void => {
    res.json(getSystemMetrics());
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scene Manager — OBS-style scene system per stream
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/scenes/:streamId
   * Returns all scenes and the active scene for a stream.
   */
  app.get("/api/scenes/:streamId", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    res.json(mgr.toJSON());
  });

  /**
   * POST /api/scenes/:streamId
   * Creates a new scene. Body: { label: string, layers?: [...] }
   */
  app.post("/api/scenes/:streamId", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const { label, layers } = req.body ?? {};
    if (!label || typeof label !== "string") {
      res.status(400).json({ error: "label is required" });
      return;
    }
    const mgr = getOrCreateSceneManager(streamId);
    const scene = mgr.createScene(label, layers);
    res.json({ ok: true, scene });
  });

  /**
   * PUT /api/scenes/:streamId/:sceneId
   * Updates scene metadata. Body: { label?, overlaySnapshot? }
   */
  app.put("/api/scenes/:streamId/:sceneId", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const sceneId = req.params["sceneId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    const ok = mgr.updateScene(sceneId, req.body ?? {});
    if (!ok) { res.status(404).json({ error: "Scene not found" }); return; }
    res.json({ ok: true });
  });

  /**
   * DELETE /api/scenes/:streamId/:sceneId
   * Deletes a scene (default scene cannot be deleted).
   */
  app.delete("/api/scenes/:streamId/:sceneId", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const sceneId = req.params["sceneId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    const ok = mgr.deleteScene(sceneId);
    if (!ok) { res.status(400).json({ error: "Cannot delete this scene" }); return; }
    res.json({ ok: true });
  });

  /**
   * POST /api/scenes/:streamId/:sceneId/activate
   * Switches the active scene. Applies the scene's overlay snapshot without restarting FFmpeg.
   */
  app.post("/api/scenes/:streamId/:sceneId/activate", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const sceneId = req.params["sceneId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    const overlayPatch = mgr.switchTo(sceneId);
    if (overlayPatch === null && !mgr.getScene(sceneId)) {
      res.status(404).json({ error: "Scene not found" });
      return;
    }
    if (overlayPatch) {
      updateStreamOverlays(overlayPatch as any);
    }
    res.json({ ok: true, activeSceneId: sceneId, overlayPatchApplied: !!overlayPatch });
  });

  /**
   * POST /api/scenes/:streamId/:sceneId/layers
   * Adds a layer to a scene. Body: { type, label, visible, position, properties, zIndex }
   */
  app.post("/api/scenes/:streamId/:sceneId/layers", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const sceneId = req.params["sceneId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    const layer = mgr.addLayer(sceneId, req.body ?? {});
    if (!layer) { res.status(404).json({ error: "Scene not found" }); return; }
    res.json({ ok: true, layer });
  });

  /**
   * PUT /api/scenes/:streamId/:sceneId/layers/:layerId
   * Updates a layer's properties (visibility, position, etc.).
   */
  app.put("/api/scenes/:streamId/:sceneId/layers/:layerId", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const sceneId = req.params["sceneId"] as string;
    const layerId = req.params["layerId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    const ok = mgr.updateLayer(sceneId, layerId, req.body ?? {});
    if (!ok) { res.status(404).json({ error: "Layer not found" }); return; }
    res.json({ ok: true });
  });

  /**
   * DELETE /api/scenes/:streamId/:sceneId/layers/:layerId
   * Removes a layer from a scene.
   */
  app.delete("/api/scenes/:streamId/:sceneId/layers/:layerId", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const sceneId = req.params["sceneId"] as string;
    const layerId = req.params["layerId"] as string;
    const mgr = getOrCreateSceneManager(streamId);
    const ok = mgr.removeLayer(sceneId, layerId);
    if (!ok) { res.status(404).json({ error: "Layer not found" }); return; }
    res.json({ ok: true });
  });

  /**
   * PUT /api/scenes/:streamId/transition
   * Sets the scene transition style. Body: { type: "cut"|"fade"|"slide", durationMs: number }
   */
  app.put("/api/scenes/:streamId/transition", requireAuth, (req: Request, res: Response): void => {
    const streamId = req.params["streamId"] as string;
    const { type, durationMs } = req.body ?? {};
    if (!["cut", "fade", "slide"].includes(type)) {
      res.status(400).json({ error: "type must be cut, fade, or slide" });
      return;
    }
    const mgr = getOrCreateSceneManager(streamId);
    mgr.setTransition({ type, durationMs: durationMs ?? 0 });
    res.json({ ok: true });
  });
}
