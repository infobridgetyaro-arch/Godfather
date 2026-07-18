import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { Readable } from "stream";
import { execSync } from "child_process";
import { existsSync } from "fs";
import QRCode from "qrcode";
import type { GiftDef, GiftQueueItem } from "./gift-system";
import { logger } from "./lib/logger";

// ── Emoji / Unicode glyph support ────────────────────────────────────────────
// @napi-rs/canvas ships with no bundled fonts and GlobalFonts.loadSystemFonts()
// finds nothing in this container (no fontconfig-aggregated font dir), so text
// drawn with ctx.fillText() silently drops emoji and other non-Latin glyphs
// (they render as invisible/empty boxes). We register two Nix fonts:
//   1. Noto Color Emoji  — full emoji coverage
//   2. Noto Sans         — broad Unicode coverage (Arabic, CJK, Latin, etc.)
// Both are injected into every ctx.font string via ef() so all characters
// render instead of falling back to "?" placeholder boxes.
// Try to resolve a Nix store path for a package. Returns "" when Nix is not
// available on this host (e.g. plain Ubuntu runners like GitHub Actions).
function resolveNixOutPath(attr: string): string {
  try {
    return execSync(
      `nix eval --impure --raw --expr '(import <nixpkgs> {}).${attr}.outPath' 2>/dev/null`,
      { timeout: 15_000, encoding: "utf8" }
    ).trim();
  } catch {
    return "";
  }
}

// Recursively search fixed directories for a file matching one of the given
// name predicates. Used as a fallback when Nix isn't present, so we can find
// fonts installed via apt/fontconfig (e.g. `fonts-noto-color-emoji`,
// `fonts-noto-core` on Debian/Ubuntu, incl. GitHub Actions runners).
function findFontFile(dirs: string[], matches: (name: string) => boolean): string | null {
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const out = execSync(
        `find "${dir}" -type f \\( -iname '*.ttf' -o -iname '*.otf' -o -iname '*.ttc' \\) 2>/dev/null`,
        { timeout: 15_000, encoding: "utf8" }
      );
      const hit = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && matches(l.split("/").pop() || ""));
      if (hit) return hit;
    } catch {
      // ignore and try next dir
    }
  }
  return null;
}

const COMMON_FONT_DIRS = [
  "/usr/share/fonts",
  "/usr/local/share/fonts",
  "/usr/share/fonts/truetype",
  `${process.env.HOME || ""}/.local/share/fonts`,
  `${process.env.HOME || ""}/.fonts`,
];

let emojiFontRegistered = false;
(function registerEmojiFont() {
  try {
    const out = resolveNixOutPath("noto-fonts-color-emoji");
    const nixPath = out ? `${out}/share/fonts/noto/NotoColorEmoji.ttf` : "";
    const fontPath =
      nixPath && existsSync(nixPath)
        ? nixPath
        : findFontFile(COMMON_FONT_DIRS, (name) => /notocoloremoji/i.test(name));

    if (fontPath && existsSync(fontPath)) {
      const key = GlobalFonts.registerFromPath(fontPath, "Noto Color Emoji");
      emojiFontRegistered = !!key;
      if (emojiFontRegistered) {
        logger.info({ fontPath }, "[overlay] Emoji font registered");
      } else {
        logger.warn({ fontPath }, "[overlay] Emoji font registration returned no key");
      }
    } else {
      logger.warn(
        "[overlay] Noto Color Emoji font not found (checked Nix store and common Linux font dirs) — emojis will not render in overlays. Install the 'fonts-noto-color-emoji' package (apt) or 'noto-fonts-color-emoji' (Nix)."
      );
    }
  } catch (e) {
    logger.warn({ err: e }, "[overlay] Failed to register emoji font — emojis will not render in overlays");
  }
})();

let sansFontRegistered = false;
(function registerSansFont() {
  try {
    const out = resolveNixOutPath("noto-fonts");
    const nixCandidates = out
      ? [
          `${out}/share/fonts/noto/NotoSans[wdth,wght].ttf`,
          `${out}/share/fonts/truetype/noto/NotoSans-Regular.ttf`,
          `${out}/share/fonts/noto/NotoSans-Regular.ttf`,
          `${out}/share/fonts/truetype/NotoSans-Regular.ttf`,
        ]
      : [];

    let fontPath = nixCandidates.find((p) => existsSync(p)) || null;
    if (!fontPath) {
      fontPath = findFontFile(
        COMMON_FONT_DIRS,
        (name) => /notosans-regular/i.test(name) || /notosans\[/i.test(name)
      );
    }

    if (fontPath) {
      const key = GlobalFonts.registerFromPath(fontPath, "Noto Sans");
      sansFontRegistered = !!key;
      if (sansFontRegistered) {
        logger.info({ fontPath }, "[overlay] Noto Sans font registered — Unicode characters will render correctly");
      }
    }
    if (!sansFontRegistered) {
      logger.warn(
        "[overlay] Noto Sans not found (checked Nix store and common Linux font dirs) — non-Latin characters may render as '?'. Install the 'fonts-noto-core' package (apt) or 'noto-fonts' (Nix)."
      );
    }
  } catch (e) {
    logger.warn({ err: e }, "[overlay] Failed to register Noto Sans font");
  }
})();

export function isEmojiFontRegistered(): boolean {
  return emojiFontRegistered;
}

export interface OverlayPosition {
  x: number; // 0–100 % from left
  y: number; // 0–100 % from top
}

export interface ChatBurnMessage {
  name: string;
  text: string;
  color?: string;
  photo?: string;
  ts: number;
}

export interface SuperChatMessage {
  user: string;
  amount: string;
  text: string;
  color: string; // hex tier color
  ts: number;    // Date.now() when received
}

export interface OverlayState {
  // ── News ticker ──────────────────────────────────────────────────────────
  newsActive: boolean;
  newsText: string;
  newsTitle: string;     // optional header/title (shown in Lower Third, Breaking, etc.)
  newsBgColor: string;   // background/accent color for news bar (default "#cc0001")
  newsStyle: string;     // "Al Jazeera" | "CNN" | "BBC" | "Bloomberg" | "Sky News" | "Neon Wire" | "Float Glass" | "Sports" | "Cinematic" | "Gold Luxury" | "Minimal"
  newsAnimation: string; // "None"|"Fade"|"Slide Left"|"Slide Right"|"Pop Up"|"Drop Down"|"Fade Slide"|"Typewriter"|"Scramble"|"Word Reveal"|"Zoom"|"Elastic"|"Flip"|"Glitch"|"Wipe"
  newsPosition: OverlayPosition;
  newsLogo: string;      // base64 data URL for channel logo (optional; replaces "● LIVE" badge)
  newsScrollSpeed: number; // pixels-per-second multiplier (10=fast … 60=slow); default 30

  // ── Ads ──────────────────────────────────────────────────────────────────
  adActive: boolean;
  adText: string;
  adSub: string;
  adStyle: string;
  adPosition: OverlayPosition;

  // ── Break screen ─────────────────────────────────────────────────────────
  breakActive: boolean;
  breakText: string;
  breakStyle: string;

  // ── Live stats bar ───────────────────────────────────────────────────────
  statsActive: boolean;
  statsStyle: string;   // "TV" | "Neon" | "Glass" | "YouTube" | "Sport"
  statsPosition: OverlayPosition;
  subs: string | null;
  viewers: string | null;

  // ── Subscriber count overlay ─────────────────────────────────────────────
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  subsGoal: number;

  // ── Subscriber sparkline chart ───────────────────────────────────────────
  subChartActive: boolean;
  subChartData: number[];          // raw subscriber counts (last N samples)
  subChartPosition: OverlayPosition;
  mobileSubChartPosition: OverlayPosition;

  // ── Subscriber milestone alert ───────────────────────────────────────────
  subAlertActive: boolean;
  subAlertMessage: string;

  // ── Chat burn-in ─────────────────────────────────────────────────────────
  chatBurnActive: boolean;
  chatBurnStyle: string;
  chatBurnPosition: OverlayPosition;
  chatBurnMessages: ChatBurnMessage[];

  // ── Super Chat notifications ──────────────────────────────────────────────
  superChatMessages: SuperChatMessage[];

  // ── Guest name tag ────────────────────────────────────────────────────────
  guestNameActive: boolean;
  guestName: string;
  guestTitle: string;
  guestStyle: string;   // "Classic" | "Neon" | "Gradient" | "Minimal" | "Sports"
  guestPosition: OverlayPosition;
  mobileGuestPosition: OverlayPosition;

  // ── Background gradient (bg pipe — behind video) ──────────────────────────
  bgGradientActive: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientOpacity: number;

  // ── Mobile (portrait) position overrides ─────────────────────────────────
  mobileStatsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;

  // ── Element scale (50–200, 100 = actual size) ─────────────────────────────
  statsScale: number;
  subsScale: number;
  chatBurnScale: number;
  newsScale: number;
  adScale: number;
  guestScale: number;
  subChartScale: number;

  // ── Break video ──────────────────────────────────────────────────────────
  breakVideoUrl: string;
  breakVideoMode: "fullscreen" | "live-bg" | "gradient-bg";
  breakVideoPanX: number;   // 0–100; 50 = centred horizontally
  breakVideoPanY: number;   // 0–100; 50 = centred vertically

  // ── QR code overlay ───────────────────────────────────────────────────────
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: OverlayPosition;
  qrScanCount: number;
  qrThankYouActive: boolean;
  qrThankYouName: string;
  qrThankYouTs: number;
  thankYouStyle: string;

  // ── Audio mute controls ───────────────────────────────────────────────────
  liveAudioMuted: boolean;   // mute the live source audio in the RTMP stream
  breakVideoMuted: boolean;  // mute the break video audio in the browser display

  // ── Featured comment (StreamYard-style single comment highlight) ───────────
  featuredComment: { name: string; text: string; color?: string; ts: number } | null;

  // ── Screen Share PIP overlay ──────────────────────────────────────────────
  screenShareActive: boolean;
  screenShareMode: "pip" | "presenter" | "fullscreen";
  screenShareX: number;       // 0–100 % from left (pip only)
  screenShareY: number;       // 0–100 % from top  (pip only)
  screenShareW: number;       // width as % of video width (pip only)
  screenShareRadius: number;  // corner radius px (0–80)

  // ── Donation alert overlay ────────────────────────────────────────────────
  donationAlertActive: boolean;
  donationAlerts: Array<{ id: string; name: string; amount: string; amountKes: number; currency: string; message: string; color: string; ts: number }>;
  // Donation ticker (scrolling bar at bottom of frame)
  donationTickerActive: boolean;
  donationTicker: Array<{ name: string; amount: string; amountKes: number; color: string; ts: number; giftId?: string }>;
  // Gift economy system (TikTok-style)
  giftQueue: GiftQueueItem[];
  giftDisplayMode: "auto" | "minimal" | "standard" | "hype";

  // ── News ticker loop pause ──────────────────────────────────────────────
  newsTickerLoopSecs: number; // seconds to pause between loops (default 20)

  // ── Logo overlay ─────────────────────────────────────────────────────────
  logoActive: boolean;
  logoUrl: string;        // base64 data URL or http URL
  logoX: number;          // 0–100 % from left
  logoY: number;          // 0–100 % from top
  logoSize: number;       // rendered height in pixels at 1080p (scaled proportionally)
  logoOpacity: number;    // 0–100
  logoBgEnabled: boolean;      // draw a background plate behind the logo
  logoBgColor: string;         // CSS color for the background plate
  logoBgShape: "circle" | "rounded" | "square"; // background plate shape
  logoAnimation: "None" | "Fade" | "Slide In" | "Zoom" | "Bounce" | "Spin"; // looping animation
  logoAnimGap: number; // seconds to pause (holding at rest) between animation plays; 0–60

  // ── Ticker presentation mode ─────────────────────────────────────────────
  // Controls HOW the text moves (independent of the visual broadcaster style).
  // "Scroll"      — classic right-to-left horizontal scroll (default)
  // "Stationary"  — text stays fixed, no movement; messages rotate by fading
  // "Flap"        — split-flap airport-board character animation
  // "Typewriter"  — text types in left-to-right, holds, then clears
  // "Wave"        — characters bob on a sinusoidal vertical wave
  // "Carousel"    — one message slides up/fades in, holds, next message slides up
  newsTickerMode: "Scroll" | "Stationary" | "Flap" | "Typewriter" | "Wave" | "Carousel";

  // ── Social media overlay ─────────────────────────────────────────────────
  socialOverlayActive: boolean;
  socialHandles: Array<{ platform: string; handle: string; enabled: boolean }>;
  socialAnimation: "Spin" | "Slide" | "Flip" | "Pulse" | "Pop";
  socialRotateInterval: number;   // seconds per handle
  socialPosition: OverlayPosition;
  socialScale: number;
  socialStyle: "Classic" | "Glass" | "White" | "Modern" | "Neon";
}

export function defaultOverlayState(): OverlayState {
  return {
    newsActive: false,
    newsText: "Welcome to the live stream! Stay tuned for more updates.",
    newsTitle: "",
    newsBgColor: "#cc0001",
    newsStyle: "Al Jazeera",
    newsAnimation: "Fade",
    newsPosition: { x: 0, y: 95 },
    newsLogo: "",
    newsScrollSpeed: 30,
    adActive: false,
    adText: "Big Sale — 50% Off Today Only!",
    adSub: "Use code LIVE at checkout.",
    adStyle: "Banner",
    adPosition: { x: 0, y: 0 },
    breakActive: false,
    breakText: "Be right back — taking a short break!",
    breakStyle: "Countdown",
    statsActive: false,
    statsStyle: "TV",
    statsPosition: { x: 2, y: 2 },
    subs: null,
    viewers: null,
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
    chatBurnMessages: [],
    superChatMessages: [],
    guestNameActive: false,
    guestName: "Guest Name",
    guestTitle: "Title / Channel",
    guestStyle: "Classic",
    guestPosition: { x: 2, y: 78 },
    mobileGuestPosition: { x: 2, y: 78 },
    bgGradientActive: false,
    bgGradient1: "#0f0c29",
    bgGradient2: "#302b63",
    bgGradientOpacity: 1.0,
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
    liveAudioMuted: false,
    featuredComment: null,
    breakVideoMuted: false,
    breakVideoUrl: "",
    breakVideoMode: "live-bg",
    breakVideoPanX: 50,
    breakVideoPanY: 50,
    qrActive: false,
    qrUrl: "",
    qrTitle: "",
    qrSize: 160,
    qrPosition: { x: 88, y: 10 },
    qrScanCount: 0,
    qrThankYouActive: false,
    qrThankYouName: "",
    qrThankYouTs: 0,
    thankYouStyle: "Classic",
    screenShareActive: false,
    screenShareMode: "presenter",
    screenShareX: 60,
    screenShareY: 5,
    screenShareW: 38,
    screenShareRadius: 16,
    donationAlertActive: true,
    donationAlerts: [],
    donationTickerActive: false,
    donationTicker: [],
    giftQueue: [],
    giftDisplayMode: "auto",
    newsTickerLoopSecs: 20,
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
}

/**
 * renderMode:
 *   'bg'  — background pipe: only renders the gradient fill (behind video).
 *   'ui'  — UI pipe: all overlays on transparent background.
 */
export type RendererMode = "bg" | "ui";

/** Duration (seconds) for the news text entry animation */
const ANIM_DUR = 0.75;
/** How long a super chat notification is displayed (seconds) */
const SUPERCHAT_TTL = 9;
/** How long the sub alert displays (seconds after activation) */
const SUBALERT_TTL = 5;
/** How long each chat burn message stays visible (seconds) — cleared immediately on stream stop */
const CHAT_BURN_TTL_MS = 10_000;

export class OverlayRenderer {
  private canvas: ReturnType<typeof createCanvas>;
  private ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>;
  private W: number;
  private H: number;
  private state: OverlayState;
  private readable: Readable;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private t0 = 0;
  private readonly isVertical: boolean;
  private readonly renderMode: RendererMode;

  private readonly FADE_SPEED = 0.18;

  // Per-element fade alphas
  private alphas = {
    news:           0,
    ad:             0,
    break:          0,
    stats:          0,
    subs:           0,
    chatBurn:       0,
    guestName:      0,
    superChat:      0,
    subAlert:       0,
    subChart:       0,
    bgGrad:         0,
    qr:             0,
    featured:       0,
    donationAlert:  0,
    donationTicker: 0,
    giftAlert:      0,
    logo:           0,
    social:         0,
  };

  // Social overlay rotation tracking
  private socialCurrentIdx  = 0;
  private socialLastSwitchT = 0;

  private donationTickerOffset = 0;
  private donationTickerLastT  = 0;

  // External frame: when set, replaces canvas rendering (used for break video decoder)
  private externalFrame: Buffer | null = null;

  // QR code matrix cache
  private qrMatrix: boolean[][] | null = null;
  private cachedQrUrl = "";

  // Screen share PIP: last decoded JPEG frame
  private screenShareImg: import("@napi-rs/canvas").Image | null = null;
  private screenShareDecoding = false;

  // Channel logo image cache for news ticker
  private newsLogoImg: import("@napi-rs/canvas").Image | null = null;
  private newsLogoSrc: string = "";

  // Logo overlay image cache
  private logoImg: import("@napi-rs/canvas").Image | null = null;
  private logoImgSrc: string = "";

  // Avatar image cache for chat burn (profile pictures from YouTube)
  private avatarCache = new Map<string, import("@napi-rs/canvas").Image | null>();

  private _panelAlpha = 1;
  private _renderErrorCount = 0;

  // News animation tracking
  private newsAnimStartT = -100; // default → animProg = 1 (no animation on boot)

  // Logo animation tracking (entrance effect, mirrors news animation pattern)
  private logoAnimStartT = -100; // default → animProg = 1 (no animation on boot)
  private _newsAnimProg = 1;

  // Scroll offset anchors — reset when text changes so position doesn't jump
  private newsScrollStartT = 0;
  private chatScrollStartT = 0;

  // Sub alert tracking (elapsed time since alert became active)
  private subAlertStartT = -100;

  constructor(
    w: number, h: number,
    state: OverlayState,
    isVertical = false,
    renderMode: RendererMode = "ui",
  ) {
    this.W = w;
    this.H = h;
    this.state = { ...state };
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @napi-rs/canvas types conflate Canvas and SvgCanvas; runtime is correct
    this.canvas = createCanvas(w, h);
    this.ctx = this.canvas.getContext("2d");
    // highWaterMark = 2 raw RGBA frames so the pipe always has a frame queued
    // and FFmpeg never blocks waiting for the next one.
    this.readable = new Readable({ read() {}, highWaterMark: w * h * 4 * 2 });
    this.isVertical = isVertical;
    this.renderMode = renderMode;

    // Pre-seed alphas to their target values based on the initial state so that
    // a restarted renderer resumes at the correct opacity immediately — without
    // this, every FFmpeg restart causes a multi-second fade-in from 0 (3 s at
    // the 2 fps bg-pipe rate) which viewers see as the gradient "blinking out".
    if (state.bgGradientActive) {
      this.alphas.bgGrad = state.bgGradientOpacity ?? 1;
    }
    if (state.breakActive) {
      this.alphas.break = 1;
    }
    if (state.newsActive) {
      this.alphas.news = 1;
      this.newsAnimStartT = -100; // keep the "already animated" sentinel
    }
    if (state.logoActive) {
      this.alphas.logo = 1;
      this.logoAnimStartT = -100; // keep the "already animated" sentinel
    }
    if (state.adActive) {
      this.alphas.ad = 1;
    }
    if (state.statsActive && (state.subs || state.viewers)) {
      this.alphas.stats = 1;
    }
    if (state.subsOverlayActive && state.subs) {
      this.alphas.subs = 1;
    }
    if (state.chatBurnActive && state.chatBurnMessages.length > 0) {
      this.alphas.chatBurn = 1;
    }
    if (state.subChartActive) {
      this.alphas.subChart = 1;
    }
    if (state.qrActive && state.qrUrl) {
      this.alphas.qr = 1;
    }
  }

  updateState(patch: Partial<OverlayState>) {
    // Restart news animation AND scroll when text or active state changes
    if (
      (patch.newsText !== undefined && patch.newsText !== this.state.newsText) ||
      (patch.newsActive === true && !this.state.newsActive) ||
      (patch.newsAnimation !== undefined && patch.newsAnimation !== this.state.newsAnimation)
    ) {
      this.newsAnimStartT = this.elapsed();
    }
    // Restart logo entrance animation when it's (re)activated, the image
    // changes, or the animation type is changed from the control room.
    if (
      (patch.logoActive === true && !this.state.logoActive) ||
      (patch.logoUrl !== undefined && patch.logoUrl !== this.state.logoUrl && (patch.logoActive ?? this.state.logoActive)) ||
      (patch.logoAnimation !== undefined && patch.logoAnimation !== this.state.logoAnimation)
    ) {
      this.logoAnimStartT = this.elapsed();
    }
    // Reset news scroll anchor when text changes so the ticker restarts from the left
    if (patch.newsText !== undefined && patch.newsText !== this.state.newsText) {
      this.newsScrollStartT = this.elapsed();
    }
    // Reset chat scroll anchor when messages change so the ticker restarts cleanly
    if (patch.chatBurnMessages !== undefined) {
      this.chatScrollStartT = this.elapsed();
    }
    // Restart sub alert timer when newly activated
    if (patch.subAlertActive === true && !this.state.subAlertActive) {
      this.subAlertStartT = this.elapsed();
    }
    // Reload channel logo image when the src changes
    if (patch.newsLogo !== undefined && patch.newsLogo !== this.newsLogoSrc) {
      this.newsLogoSrc = patch.newsLogo;
      this.newsLogoImg = null;
      if (patch.newsLogo) {
        const raw = patch.newsLogo.replace(/^data:[^;]+;base64,/, "");
        const buf = Buffer.from(raw, "base64");
        (loadImage as (src: Buffer) => Promise<import("@napi-rs/canvas").Image>)(buf)
          .then((img) => { if (this.newsLogoSrc === patch.newsLogo) this.newsLogoImg = img; })
          .catch(() => { this.newsLogoImg = null; });
      }
    }
    // Prefetch avatar images when chat messages arrive
    if (patch.chatBurnMessages) {
      for (const msg of patch.chatBurnMessages) {
        const url = msg.photo;
        if (url && !this.avatarCache.has(url)) {
          this.avatarCache.set(url, null); // mark as loading
          (loadImage as (src: string) => Promise<import("@napi-rs/canvas").Image>)(url)
            .then((img) => { this.avatarCache.set(url, img); })
            .catch(() => { this.avatarCache.delete(url); });
        }
      }
      // Evict old entries when cache grows too large
      if (this.avatarCache.size > 120) {
        const toDelete = Array.from(this.avatarCache.keys()).slice(0, 40);
        for (const k of toDelete) this.avatarCache.delete(k);
      }
    }
    Object.assign(this.state, patch);
  }

  getStream(): Readable {
    return this.readable;
  }

  /**
   * Legacy start — pushes frames into the internal Readable so callers can
   * pipe() it. Kept for backward compatibility; prefer startWritingTo().
   */
  start(fps = 10) {
    this.running = true;
    this.t0 = Date.now();
    const intervalMs = 1000 / fps;

    const tick = () => {
      if (!this.running) return;
      const tickStart = Date.now();
      try {
        const buf = this.renderFrame();
        if (!this.readable.push(buf)) {
          // Backpressure — wait. Use removeAllListeners so stale listeners
          // never accumulate if tick() is somehow called twice.
          this.readable.removeAllListeners("resume");
          this.readable.once("resume", () => {
            if (this.running) this.timer = setTimeout(tick, intervalMs);
          });
          return;
        }
      } catch {
        // keep going on render errors
      }
      const elapsed = Date.now() - tickStart;
      this.timer = setTimeout(tick, Math.max(0, intervalMs - elapsed));
    };
    tick();
  }

  /**
   * Preferred entry-point for stream-manager: writes raw RGBA frames directly
   * to the FFmpeg pipe fd (dest = ffmpegProc.stdio[3] or [4]).
   *
   * Writing directly to the Writable eliminates the Readable → pipe() layer
   * that caused MaxListenersExceededWarning and stream death:
   *   - No intermediate Readable buffer
   *   - No fallback setTimeout racing against once("resume")
   *   - Single "drain" listener per backpressure event (self-removing via once)
   */
  startWritingTo(dest: NodeJS.WritableStream, fps = 10): void {
    this.running = true;
    this.t0 = Date.now();
    const intervalMs = 1000 / fps;
    // Maximum time to wait for a drain event before giving up and resuming.
    // Without this timeout, a stalled or slow FFmpeg pipe blocks the renderer
    // indefinitely → no new frames → stall watchdog fires → hard kill.
    const drainTimeoutMs = intervalMs * 4;

    const tick = () => {
      if (!this.running) return;
      const tickStart = Date.now();
      try {
        // Use external frame (break video) when available; otherwise render canvas.
        // Exception: gradient-bg mode composites the external frame WITH gradient bars
        // via canvas so we must call renderFrame() — it handles this case internally.
        const needsCanvas =
          this.externalFrame === null ||
          (this.state.breakVideoMode ?? "fullscreen") === "gradient-bg";
        const buf = needsCanvas ? this.renderFrame() : this.externalFrame!;
        // write() returns false when the OS pipe buffer to FFmpeg is full (backpressure).
        // We wait for drain but with a hard timeout: if drain hasn't fired within
        // drainTimeoutMs we drop this frame and resume — keeping the stall watchdog fed.
        if (!dest.write(buf)) {
          let drained = false;
          const drainTimeout = setTimeout(() => {
            if (!drained && this.running) {
              dest.removeAllListeners("drain");
              this.timer = setTimeout(tick, intervalMs);
            }
          }, drainTimeoutMs);
          dest.once("drain", () => {
            drained = true;
            clearTimeout(drainTimeout);
            if (this.running) this.timer = setTimeout(tick, intervalMs);
          });
          return;
        }
      } catch (err) {
        // log render errors but keep the pipe alive so FFmpeg doesn't stall
        this._renderErrorCount++;
        // Rate-limit to one log per 100 errors to avoid flooding
        if (this._renderErrorCount % 100 === 1) {
          logger.warn({ err, count: this._renderErrorCount }, "[overlay] Frame render error — check draw functions");
        }
      }
      const elapsed = Date.now() - tickStart;
      this.timer = setTimeout(tick, Math.max(0, intervalMs - elapsed));
    };
    tick();
  }

  /**
   * Set an external RGBA frame buffer to forward directly to FFmpeg instead of
   * rendering canvas. Used by the break-video decoder to overlay video frames
   * on pipe:4 without restarting the main FFmpeg process.
   * Pass null to resume normal canvas rendering.
   */
  setExternalFrame(frame: Buffer | null): void {
    this.externalFrame = frame;
  }

  /**
   * Accept a JPEG buffer from the browser screen-share WebSocket and decode it
   * asynchronously. The most recently decoded Image is composited by renderFrame()
   * as a PIP overlay when state.screenShareActive is true.
   */
  setScreenShareFrame(jpegBuf: Buffer): void {
    if (this.screenShareDecoding) return; // skip if still decoding previous frame
    this.screenShareDecoding = true;
    // loadImage is imported from @napi-rs/canvas at module top
    (loadImage as (src: Buffer) => Promise<import("@napi-rs/canvas").Image>)(jpegBuf)
      .then((img) => { this.screenShareImg = img; })
      .catch(() => {})
      .finally(() => { this.screenShareDecoding = false; });
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try { this.readable.destroy(); } catch {}
  }

  private elapsed(): number {
    return (Date.now() - this.t0) / 1000;
  }

  private px(pct: number, dim: number): number {
    return Math.round((pct / 100) * dim);
  }

  private pos(desktopPos: OverlayPosition, mobilePos: OverlayPosition): OverlayPosition {
    return this.isVertical ? mobilePos : desktopPos;
  }

  private stepAlpha(cur: number, target: number): number {
    if (cur < target) return Math.min(target, cur + this.FADE_SPEED);
    if (cur > target) return Math.max(0, cur - this.FADE_SPEED);
    return cur;
  }

  private withPanelAlpha(alpha: number, fn: () => void): void {
    if (alpha < 0.01) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    this._panelAlpha = alpha;
    fn();
    ctx.restore();
    this._panelAlpha = 1;
  }

  private withScaleAt(pos: OverlayPosition, mobilePos: OverlayPosition, scalePct: number, fn: () => void): void {
    if (!scalePct || scalePct === 100) { fn(); return; }
    const { ctx, W, H } = this;
    const effPos = this.pos(pos, mobilePos);
    const ax = this.px(effPos.x, W);
    const ay = this.px(effPos.y, H);
    const s = scalePct / 100;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.scale(s, s);
    ctx.translate(-ax, -ay);
    fn();
    ctx.restore();
  }

  // ── Easing helpers ─────────────────────────────────────────────────────────

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /** Draw a filled rounded rectangle path (no fill/stroke — caller does that) */
  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,       x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h,   x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,      y + h,   x, y + h - r,    r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,      y,       x + r, y,         r);
    ctx.closePath();
  }

  /** Clip to rounded rectangle region for the duration of `fn` */
  private clipRoundRect(x: number, y: number, w: number, h: number, r: number, fn: () => void) {
    const { ctx } = this;
    ctx.save();
    this.roundRect(x, y, w, h, r);
    ctx.clip();
    fn();
    ctx.restore();
  }

  private easeElastic(t: number): number {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
  }

  private easeBounce(t: number): number {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  }

  // ── Animated text helper ──────────────────────────────────────────────────

  /** Scramble chars: random ASCII resolving to correct letters with stagger */
  private _scrambleChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&?";

  /**
   * Draws text with a character-level or word-level entry animation.
   * For whole-overlay animations (Fade, Slide etc.) the caller handles ctx transform.
   * This method handles char/word anims: Typewriter, Pop-in, Letter Fade, Bounce,
   * Wipe, Scramble, Word Reveal, Zoom, Elastic, Flip, Glitch.
   * For other animations or progress >= 1, draws normally.
   */
  private drawAnimText(
    text: string, x: number, y: number,
    font: string, color: string,
    anim: string, progress: number,
  ) {
    const { ctx } = this;
    // Inject emoji/Unicode font once; reuse throughout this call.
    const efFont = this.ef(font);
    const CHAR_ANIMS = [
      "Typewriter", "Pop-in", "Letter Fade", "Bounce", "Reveal", "Wipe",
      "Scramble", "Word Reveal", "Zoom", "Elastic", "Flip", "Glitch",
    ];

    if (!CHAR_ANIMS.includes(anim) || progress >= 1) {
      ctx.font = efFont;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      return;
    }

    ctx.font = efFont;

    // ── Typewriter ────────────────────────────────────────────────────────────
    if (anim === "Typewriter") {
      const vis = Math.floor(this.easeInOut(progress) * text.length);
      ctx.fillStyle = color;
      ctx.fillText(text.slice(0, vis), x, y);
      const cursorX = x + ctx.measureText(text.slice(0, vis)).width + 2;
      const blink = (Math.floor(Date.now() / 400) % 2 === 0) ? 0.9 : 0;
      const fs = parseFloat(font) || 14;
      ctx.save();
      ctx.globalAlpha = blink * this._panelAlpha;
      ctx.fillStyle = color;
      ctx.fillRect(cursorX, y - fs * 0.8, 2, fs);
      ctx.restore();
      return;
    }

    // ── Wipe / Reveal — horizontal clip ──────────────────────────────────────
    if (anim === "Reveal" || anim === "Wipe") {
      const totalW = ctx.measureText(text).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y - 200, totalW * this.easeInOut(progress) + 1, 400);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.restore();
      return;
    }

    // ── Scramble — random chars resolving left-to-right ───────────────────────
    if (anim === "Scramble") {
      const chars = text.split("");
      const sc = this._scrambleChars;
      const now = Date.now();
      let cx = x;
      chars.forEach((ch, i) => {
        ctx.font = efFont;
        const cw = ctx.measureText(ch).width;
        // Each char resolves when its t_char > 0.5
        const t_char = Math.max(0, Math.min(1, (progress * chars.length - i)));
        if (t_char <= 0) { cx += cw; return; }
        const display = t_char >= 0.5 ? ch : sc[Math.floor((now / 80 + i * 17) % sc.length)];
        ctx.save();
        ctx.globalAlpha = Math.min(1, t_char * 2) * this._panelAlpha;
        ctx.fillStyle = t_char >= 0.5 ? color : "#00ff88";
        ctx.fillText(display, cx, y);
        ctx.restore();
        cx += cw;
      });
      return;
    }

    // ── Word Reveal — words appear one by one ─────────────────────────────────
    if (anim === "Word Reveal") {
      const words = text.split(" ");
      const visWords = Math.floor(this.easeInOut(progress) * words.length);
      let cx = x;
      words.forEach((word, i) => {
        ctx.font = efFont;
        const ww = ctx.measureText(word + " ").width;
        if (i < visWords) {
          ctx.save();
          ctx.globalAlpha = 1 * this._panelAlpha;
          ctx.fillStyle = color;
          ctx.fillText(word, cx, y);
          ctx.restore();
        } else if (i === visWords) {
          // Partial fade for current word
          const wordProg = (this.easeInOut(progress) * words.length) - visWords;
          ctx.save();
          ctx.globalAlpha = wordProg * this._panelAlpha;
          ctx.fillStyle = color;
          ctx.fillText(word, cx, y);
          ctx.restore();
        }
        cx += ww;
      });
      return;
    }

    // ── Zoom — text scales from 1.5x to 1x ────────────────────────────────────
    if (anim === "Zoom") {
      const ep = this.easeInOut(progress);
      const scale = 1.5 - ep * 0.5;
      const totalW = ctx.measureText(text).width;
      ctx.save();
      ctx.translate(x + totalW / 2, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = ep * this._panelAlpha;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
      return;
    }

    // ── Char-by-char animations: Pop-in, Letter Fade, Bounce, Elastic, Flip, Glitch ──
    const chars = text.split("");
    let cx = x;

    chars.forEach((ch, i) => {
      ctx.font = efFont;
      const cw = ctx.measureText(ch).width;
      const t_char = Math.max(0, Math.min(1, (progress * chars.length - i)));

      ctx.save();
      switch (anim) {
        case "Pop-in": {
          const scale = this.easeElastic(t_char);
          ctx.translate(cx + cw / 2, y);
          ctx.scale(scale, scale);
          ctx.globalAlpha = t_char > 0.05 ? this._panelAlpha : 0;
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ch, 0, 0);
          break;
        }
        case "Letter Fade": {
          ctx.globalAlpha = this.easeInOut(t_char) * this._panelAlpha;
          ctx.fillStyle = color;
          ctx.fillText(ch, cx, y);
          break;
        }
        case "Bounce": {
          const yOff = (1 - this.easeBounce(Math.min(1, t_char))) * (-32);
          ctx.globalAlpha = t_char > 0.05 ? this._panelAlpha : 0;
          ctx.fillStyle = color;
          ctx.fillText(ch, cx, y + yOff);
          break;
        }
        case "Elastic": {
          const scale = this.easeElastic(t_char);
          const yOff = (1 - this.easeElastic(t_char)) * 24;
          ctx.translate(cx + cw / 2, y + yOff);
          ctx.scale(scale, scale);
          ctx.globalAlpha = t_char > 0.02 ? this._panelAlpha : 0;
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ch, 0, 0);
          break;
        }
        case "Flip": {
          // Simulate vertical flip with scaleY
          const scaleY = t_char < 0.5 ? Math.abs(Math.cos(t_char * Math.PI)) : 1;
          ctx.translate(cx + cw / 2, y);
          ctx.scale(1, scaleY);
          ctx.globalAlpha = this.easeInOut(t_char) * this._panelAlpha;
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ch, 0, 0);
          break;
        }
        case "Glitch": {
          // Random x-jitter that settles
          const jitter = t_char < 0.8 ? (Math.random() - 0.5) * 8 * (1 - t_char) : 0;
          const jitterY = t_char < 0.8 ? (Math.random() - 0.5) * 4 * (1 - t_char) : 0;
          ctx.globalAlpha = this.easeInOut(Math.min(1, t_char * 1.5)) * this._panelAlpha;
          ctx.fillStyle = t_char < 0.6 ? "#00ffff" : color;
          ctx.fillText(ch, cx + jitter, y + jitterY);
          break;
        }
      }
      ctx.restore();
      cx += cw;
    });
  }

  // ── Main render frame ──────────────────────────────────────────────────────

  private renderFrame(): Buffer {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // ── BACKGROUND PIPE ──
    if (this.renderMode === "bg") {
      if (this.state.breakActive) {
        const mode = this.state.breakVideoMode ?? "live-bg";
        if (mode === "fullscreen") {
          this.ctx.fillStyle = "#000";
          this.ctx.fillRect(0, 0, this.W, this.H);
          return this.toRawRGBA();
        }
        if (mode === "gradient-bg") {
          this.withPanelAlpha(1, () => this.drawBackground());
          return this.toRawRGBA();
        }
        // "live-bg": transparent — live stream visible in letterbox bars
        return this.toRawRGBA();
      }
      const target = this.state.bgGradientActive ? (this.state.bgGradientOpacity ?? 1) : 0;
      this.alphas.bgGrad = this.stepAlpha(this.alphas.bgGrad, target);
      this.withPanelAlpha(this.alphas.bgGrad, () => this.drawBackground());
      return this.toRawRGBA();
    }

    // ── UI PIPE ──
    const t = this.elapsed();
    const wantBreak = this.state.breakActive ? 1 : 0;
    const nonBreak = 1 - this.alphas.break;

    // ── Per-message 10-second TTL: evict expired chat burn messages every frame ──
    // This guarantees the overlay always clears within 10 s even if the server
    // hasn't explicitly cleared the array (e.g. mid-stream reconnect).
    {
      const nowMs = Date.now();
      const unexpired = this.state.chatBurnMessages.filter((m) => nowMs - m.ts < CHAT_BURN_TTL_MS);
      if (unexpired.length !== this.state.chatBurnMessages.length) {
        this.state.chatBurnMessages = unexpired;
      }
    }

    // Determine if sub alert should fade out after TTL
    const subAlertAge = t - this.subAlertStartT;
    const subAlertWant = this.state.subAlertActive && subAlertAge < SUBALERT_TTL ? 1 : 0;
    // Auto-clear if TTL passed
    if (this.state.subAlertActive && subAlertAge >= SUBALERT_TTL + 0.5) {
      this.state.subAlertActive = false;
    }

    // Active super chat: most recent within TTL
    const now = Date.now();
    const activeSuperChat = [...this.state.superChatMessages]
      .filter((m) => (now - m.ts) / 1000 < SUPERCHAT_TTL)
      .sort((a, b) => b.ts - a.ts)[0] ?? null;

    this.alphas.news      = this.stepAlpha(this.alphas.news,      this.state.newsActive && !this.state.breakActive ? 1 : 0);
    this.alphas.ad        = this.stepAlpha(this.alphas.ad,        this.state.adActive && !this.state.breakActive ? 1 : 0);
    this.alphas.subs      = this.stepAlpha(this.alphas.subs,      this.state.subsOverlayActive && !!this.state.subs && !this.state.breakActive ? 1 : 0);
    this.alphas.chatBurn  = this.stepAlpha(this.alphas.chatBurn,  this.state.chatBurnActive && this.state.chatBurnMessages.length > 0 && !this.state.breakActive ? 1 : 0);
    this.alphas.stats     = this.stepAlpha(this.alphas.stats,     !!(this.state.subs || this.state.viewers) && this.state.statsActive && !this.state.breakActive ? 1 : 0);
    this.alphas.guestName = this.stepAlpha(this.alphas.guestName, this.state.guestNameActive && !this.state.breakActive ? 1 : 0);
    this.alphas.superChat = this.stepAlpha(this.alphas.superChat, activeSuperChat ? 1 : 0);
    this.alphas.subAlert  = this.stepAlpha(this.alphas.subAlert,  subAlertWant);
    // subChart shows as soon as subChartActive is true — data and subs are handled
    // gracefully inside drawSubChart (shows a "collecting…" placeholder when not ready).
    this.alphas.subChart  = this.stepAlpha(this.alphas.subChart,  this.state.subChartActive && !this.state.breakActive ? 1 : 0);
    this.alphas.break     = this.stepAlpha(this.alphas.break,     wantBreak);
    this.alphas.qr        = this.stepAlpha(this.alphas.qr,        this.state.qrActive && !!this.state.qrUrl ? 1 : 0);
    this.alphas.logo      = this.stepAlpha(this.alphas.logo,      this.state.logoActive && !!this.state.logoUrl ? 1 : 0);
    const socialHandlesActive = (this.state.socialHandles ?? []).filter(h => h.enabled).length > 0;
    this.alphas.social    = this.stepAlpha(this.alphas.social,    this.state.socialOverlayActive && socialHandlesActive && !this.state.breakActive ? 1 : 0);
    // Gift economy system + legacy donation alerts
    const now2 = Date.now();
    const activeGift = (this.state.giftQueue ?? []).find(
      (g) => now2 >= g.displayTs && now2 < g.displayTs + g.gift.durationMs,
    ) ?? null;
    const DONATION_ALERT_TTL_MS = 8_000;
    const activeDonationAlert = activeGift ? null : (this.state.donationAlerts ?? [])
      .filter((a) => (now2 - a.ts) < DONATION_ALERT_TTL_MS)
      .sort((a, b) => b.ts - a.ts)[0] ?? null;
    this.alphas.giftAlert      = this.stepAlpha(this.alphas.giftAlert,      !!(this.state.donationAlertActive && activeGift) ? 1 : 0);
    this.alphas.donationAlert  = this.stepAlpha(this.alphas.donationAlert,  !!(this.state.donationAlertActive && activeDonationAlert) ? 1 : 0);
    this.alphas.donationTicker = this.stepAlpha(this.alphas.donationTicker, !!(this.state.donationTickerActive && this.state.donationTicker && this.state.donationTicker.length > 0) ? 1 : 0);
    const FEATURED_TTL_MS = 12_000;
    const featuredAge = this.state.featuredComment ? now - this.state.featuredComment.ts : Infinity;
    this.alphas.featured  = this.stepAlpha(this.alphas.featured,  this.state.featuredComment !== null && featuredAge < FEATURED_TTL_MS && !this.state.breakActive ? 1 : 0);
    if (this.state.featuredComment && featuredAge > FEATURED_TTL_MS + 500) {
      this.state.featuredComment = null;
    }

    // ── BG gradient bars — rendered in UI pipe so they appear ON TOP of the video ──
    // The bg pipe (pipe:3) renders the same bars but sits behind the video in the
    // FFmpeg composite.  Rendering them here as well guarantees they are visible
    // regardless of whether the video fills the whole frame.
    if (!this.state.breakActive) {
      const bgTarget = this.state.bgGradientActive ? (this.state.bgGradientOpacity ?? 1) : 0;
      this.alphas.bgGrad = this.stepAlpha(this.alphas.bgGrad, bgTarget);
      if (this.alphas.bgGrad > 0.005) {
        this.withPanelAlpha(this.alphas.bgGrad, () => this.drawBackground());
      }
    }

    const { state } = this;
    this.withPanelAlpha(this.alphas.ad        * nonBreak, () => this.withScaleAt(state.adPosition, state.mobileAdPosition, state.adScale ?? 100, () => this.drawAd()));
    this.withPanelAlpha(this.alphas.news      * nonBreak, () => this.withScaleAt(state.newsPosition, state.mobileNewsPosition, state.newsScale ?? 100, () => this.drawNews(t)));
    this.withPanelAlpha(this.alphas.subs      * nonBreak, () => this.withScaleAt(state.subsPosition, state.mobileSubsPosition, state.subsScale ?? 100, () => this.drawSubsOverlay(t)));
    this.withPanelAlpha(this.alphas.chatBurn  * nonBreak, () => this.withScaleAt(state.chatBurnPosition, state.mobileChatBurnPosition, state.chatBurnScale ?? 100, () => this.drawChatBurn(t)));
    this.withPanelAlpha(this.alphas.stats     * nonBreak, () => this.withScaleAt(state.statsPosition, state.mobileStatsPosition, state.statsScale ?? 100, () => this.drawStats()));
    this.withPanelAlpha(this.alphas.subChart  * nonBreak, () => this.withScaleAt(state.subChartPosition, state.mobileSubChartPosition, state.subChartScale ?? 100, () => this.drawSubChart()));
    this.withPanelAlpha(this.alphas.guestName * nonBreak, () => this.withScaleAt(state.guestPosition, state.mobileGuestPosition, state.guestScale ?? 100, () => this.drawGuestNameTag()));
    this.withPanelAlpha(this.alphas.superChat,            () => this.drawSuperChatNotification(activeSuperChat!, t));
    this.withPanelAlpha(this.alphas.subAlert,             () => this.drawSubAlert(t));
    this.withPanelAlpha(this.alphas.break,                () => this.drawBreak(t));
    this.withPanelAlpha(this.alphas.qr,                   () => this.drawQR());
    this.withPanelAlpha(this.alphas.featured * nonBreak,  () => this.drawFeaturedComment());
    this.withPanelAlpha(this.alphas.giftAlert,                 () => { if (activeGift) this.drawGiftAlert(activeGift); });
    this.withPanelAlpha(this.alphas.donationAlert,             () => { if (activeDonationAlert) this.drawDonationAlert(activeDonationAlert, t); });
    this.withPanelAlpha(this.alphas.donationTicker * nonBreak, () => this.drawDonationTicker(t));
    this.withPanelAlpha(this.alphas.logo,                         () => this.drawLogo());
    this.withPanelAlpha(this.alphas.social * nonBreak,            () => this.drawSocialOverlay(t));

    // ── Screen share overlay (PIP / Presenter / Fullscreen) ──────────────────
    if (state.screenShareActive && this.screenShareImg) {
      const img = this.screenShareImg;
      const { ctx } = this;
      const mode = state.screenShareMode ?? "pip";

      if (mode === "fullscreen") {
        // ── Fullscreen: scale-to-fill entire canvas (cover), centred crop ────
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
        // @ts-ignore
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();

      } else if (mode === "presenter") {
        // ── Presenter: professional dark background + centred large screen ────
        ctx.save();

        // 1. Deep studio background gradient (charcoal → navy)
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, "rgba(10,12,24,0.96)");
        bg.addColorStop(1, "rgba(14,18,38,0.96)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // 2. Subtle dot-grid pattern for depth
        const dot = 2;
        const gap = 28;
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        for (let gx = gap / 2; gx < W; gx += gap) {
          for (let gy = gap / 2; gy < H; gy += gap) {
            ctx.beginPath();
            ctx.arc(gx, gy, dot / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 3. Accent glow orbs (top-left purple, bottom-right cyan)
        const orb1 = ctx.createRadialGradient(W * 0.1, H * 0.1, 0, W * 0.1, H * 0.1, W * 0.42);
        orb1.addColorStop(0, "rgba(99,102,241,0.28)");
        orb1.addColorStop(1, "rgba(99,102,241,0)");
        ctx.fillStyle = orb1;
        ctx.fillRect(0, 0, W, H);

        const orb2 = ctx.createRadialGradient(W * 0.9, H * 0.9, 0, W * 0.9, H * 0.9, W * 0.45);
        orb2.addColorStop(0, "rgba(6,182,212,0.22)");
        orb2.addColorStop(1, "rgba(6,182,212,0)");
        ctx.fillStyle = orb2;
        ctx.fillRect(0, 0, W, H);

        // 4. Screen area — 88% width, centred, maintain aspect ratio
        const maxW = Math.round(W * 0.88);
        const maxH = Math.round(H * 0.82);
        const scaleF = Math.min(maxW / img.width, maxH / img.height);
        const sw = Math.round(img.width * scaleF);
        const sh = Math.round(img.height * scaleF);
        const sx = Math.round((W - sw) / 2);
        const sy = Math.round((H - sh) / 2);
        const r = state.screenShareRadius ?? 12;

        // 4a. Shadow behind screen
        ctx.shadowColor = "rgba(0,0,0,0.75)";
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.lineTo(sx + sw - r, sy);
        ctx.arcTo(sx + sw, sy,      sx + sw, sy + r,      r);
        ctx.lineTo(sx + sw, sy + sh - r);
        ctx.arcTo(sx + sw, sy + sh, sx + sw - r, sy + sh, r);
        ctx.lineTo(sx + r,  sy + sh);
        ctx.arcTo(sx,       sy + sh, sx,       sy + sh - r, r);
        ctx.lineTo(sx,      sy + r);
        ctx.arcTo(sx,       sy,      sx + r,   sy,           r);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // 4b. Clip & draw screen
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.lineTo(sx + sw - r, sy);
        ctx.arcTo(sx + sw, sy,      sx + sw, sy + r,      r);
        ctx.lineTo(sx + sw, sy + sh - r);
        ctx.arcTo(sx + sw, sy + sh, sx + sw - r, sy + sh, r);
        ctx.lineTo(sx + r,  sy + sh);
        ctx.arcTo(sx,       sy + sh, sx,       sy + sh - r, r);
        ctx.lineTo(sx,      sy + r);
        ctx.arcTo(sx,       sy,      sx + r,   sy,           r);
        ctx.closePath();
        ctx.clip();
        // @ts-ignore
        ctx.drawImage(img, sx, sy, sw, sh);

        // 4c. Inner highlight border (glass edge)
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();

        // 4d. Outer accent glow ring (drawn outside clip)
        ctx.save();
        ctx.strokeStyle = "rgba(99,102,241,0.5)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(99,102,241,0.6)";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.lineTo(sx + sw - r, sy);
        ctx.arcTo(sx + sw, sy,      sx + sw, sy + r,      r);
        ctx.lineTo(sx + sw, sy + sh - r);
        ctx.arcTo(sx + sw, sy + sh, sx + sw - r, sy + sh, r);
        ctx.lineTo(sx + r,  sy + sh);
        ctx.arcTo(sx,       sy + sh, sx,       sy + sh - r, r);
        ctx.lineTo(sx,      sy + r);
        ctx.arcTo(sx,       sy,      sx + r,   sy,           r);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

      } else {
        // ── PIP: original small positioned overlay ────────────────────────────
        const x = this.px(state.screenShareX, W);
        const y = this.px(state.screenShareY, H);
        const w = this.px(state.screenShareW, W);
        const h = Math.round(w * (img.height / img.width));
        const r = Math.max(0, Math.min(state.screenShareRadius ?? 16, Math.min(w, h) / 2));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x,      y + h, x,      y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y,         x + r,  y,          r);
        ctx.closePath();
        ctx.clip();
        // @ts-ignore
        ctx.drawImage(img, x, y, w, h);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    return this.toRawRGBA();
  }

  // ── Raw RGBA export ─────────────────────────────────────────────────────────
  // Returns uncompressed RGBA pixel data (~0.3ms) instead of PNG (~30-80ms).
  // This eliminates the frame-pipe stall that was the root cause of sub-cuts:
  // PNG Deflate compression is variable-time and made the pipe run dry every
  // few frames, blocking FFmpeg's filter_complex and causing video PTS drift.
  private toRawRGBA(): Buffer {
    const imageData = this.ctx.getImageData(0, 0, this.W, this.H);
    // imageData.data is Uint8ClampedArray of RGBA pixels (W*H*4 bytes).
    // Buffer.from(ArrayBuffer, offset, length) creates a Buffer that shares
    // the same memory — no copy, true zero overhead.
    return Buffer.from(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    );
  }

  // ── BACKGROUND GRADIENT ─────────────────────────────────────────────────────

  private drawBackground() {
    const { ctx, W, H, state } = this;

    const hexToRgb = (hex: string): [number, number, number] => {
      const h = (hex.startsWith("#") ? hex.slice(1) : hex).padEnd(6, "0");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };

    const c1 = state.bgGradient1 || "#6d28d9";
    const c2 = state.bgGradient2 || "#0891b2";
    const [r1, g1, b1] = hexToRgb(c1);
    const [r2, g2, b2] = hexToRgb(c2);

    // Two horizontal gradient bars — top edge fades from colour1 inward,
    // bottom edge fades from colour2 inward.  The middle of the frame stays
    // transparent so the video content is never obscured.
    const barH = Math.round(H * 0.28);

    // ── Top bar: colour1 solid at top → transparent at bar bottom ───────────
    const topGrad = ctx.createLinearGradient(0, 0, 0, barH);
    topGrad.addColorStop(0,   `rgba(${r1},${g1},${b1},1)`);
    topGrad.addColorStop(1,   `rgba(${r1},${g1},${b1},0)`);
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, barH);

    // ── Bottom bar: colour2 solid at bottom → transparent at bar top ────────
    const botGrad = ctx.createLinearGradient(0, H, 0, H - barH);
    botGrad.addColorStop(0,   `rgba(${r2},${g2},${b2},1)`);
    botGrad.addColorStop(1,   `rgba(${r2},${g2},${b2},0)`);
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, H - barH, W, barH);
  }

  // ── STATS BAR ──────────────────────────────────────────────────────────────

  private drawStats() {
    const style = (this.state.statsStyle ?? "TV");
    switch (style) {
      case "Neon":    return this.drawStatsNeon();
      case "Glass":   return this.drawStatsGlass();
      case "YouTube": return this.drawStatsYouTube();
      case "Sport":   return this.drawStatsSport();
      case "TV":
      default:        return this.drawStatsTV();
    }
  }

  private drawStatsTV() {
    const { ctx, W, H, state } = this;
    if (!state.subs && !state.viewers) return;
    const effPos = this.pos(state.statsPosition, state.mobileStatsPosition);
    const x = this.px(effPos.x, W) || 14;
    const y = this.px(effPos.y, H) || 14;
    const bh = Math.max(24, Math.round(H * 0.040));
    const r = Math.round(bh * 0.30);
    const fs = Math.round(bh * 0.50);
    const labelFs = Math.round(bh * 0.33);
    const dotR = Math.round(bh * 0.18);
    const padX = Math.round(bh * 0.55);

    ctx.font = `bold ${fs}px sans-serif`;
    const liveTxtW = ctx.measureText("LIVE").width;
    const liveW = liveTxtW + padX * 2 + dotR * 2 + 8;
    ctx.fillStyle = "rgba(8,8,14,0.92)";
    this.fillRR(x, y, liveW, bh, r);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, liveW, bh, r);
    ctx.fillStyle = "#e53e3e";
    ctx.beginPath();
    ctx.arc(x + padX, y + bh / 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("LIVE", x + padX + dotR + 6, y + bh / 2);

    let cx = x + liveW + 5;
    const statBadge = (val: string, label: string, color: string) => {
      ctx.font = `bold ${Math.round(bh * 0.52)}px sans-serif`;
      const valW = ctx.measureText(val).width;
      ctx.font = `${labelFs}px sans-serif`;
      const lblW = ctx.measureText(label).width;
      const bw2 = valW + lblW + padX * 2 + 10;
      ctx.fillStyle = "rgba(8,8,14,0.92)";
      this.fillRR(cx, y, bw2, bh, r);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      this.strokeRR(cx, y, bw2, bh, r);
      ctx.font = `bold ${Math.round(bh * 0.52)}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(val, cx + padX, y + bh / 2);
      ctx.font = `${labelFs}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText(label, cx + padX + valW + 5, y + bh / 2);
      cx += bw2 + 4;
    };

    if (state.subs) statBadge(state.subs, "subs", "#a78bfa");
    if (state.viewers) statBadge(state.viewers, "viewers", "#34d399");
    ctx.textBaseline = "alphabetic";
  }

  private drawStatsNeon() {
    const { ctx, W, H, state } = this;
    if (!state.subs && !state.viewers) return;
    const effPos = this.pos(state.statsPosition, state.mobileStatsPosition);
    const x = this.px(effPos.x, W) || 14;
    const y = this.px(effPos.y, H) || 14;
    const bh = Math.max(24, Math.round(H * 0.042));
    const r = Math.round(bh * 0.35);
    const fs = Math.round(bh * 0.50);
    const labelFs = Math.round(bh * 0.32);
    const padX = Math.round(bh * 0.50);
    const t2 = this.elapsed();
    const pulse = 0.5 + 0.5 * Math.sin(t2 * 2);

    // Measure widths to size the combined badge
    ctx.font = `bold ${fs}px sans-serif`;
    let totalW = padX + ctx.measureText("LIVE").width + padX;
    if (state.subs) {
      totalW += ctx.measureText(state.subs).width + 6;
      ctx.font = `${labelFs}px sans-serif`;
      totalW += ctx.measureText(" subs").width + padX;
      ctx.font = `bold ${fs}px sans-serif`;
    }
    if (state.viewers) {
      totalW += ctx.measureText(state.viewers).width + 6;
      ctx.font = `${labelFs}px sans-serif`;
      totalW += ctx.measureText(" viewers").width + padX;
      ctx.font = `bold ${fs}px sans-serif`;
    }

    const bg = ctx.createLinearGradient(x, y, x + totalW, y);
    bg.addColorStop(0, "rgba(30,0,60,0.94)");
    bg.addColorStop(0.5, "rgba(0,20,50,0.94)");
    bg.addColorStop(1, "rgba(30,0,60,0.94)");
    ctx.fillStyle = bg;
    this.fillRR(x, y, totalW, bh, r);
    ctx.strokeStyle = `rgba(0,200,255,${0.45 + pulse * 0.40})`;
    ctx.lineWidth = 1.5;
    this.strokeRR(x, y, totalW, bh, r);

    let cx = x + padX;
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.shadowColor = `rgba(255,60,60,${0.7 + pulse * 0.3})`;
    ctx.shadowBlur = 8 + pulse * 5;
    ctx.fillStyle = "#ff5555";
    ctx.fillText("LIVE", cx, y + bh / 2);
    ctx.shadowBlur = 0;
    cx += ctx.measureText("LIVE").width + padX;

    if (state.subs) {
      const vw = ctx.measureText(state.subs).width;
      ctx.shadowColor = "rgba(167,139,250,0.7)";
      ctx.shadowBlur = 5;
      ctx.fillStyle = "#c4b5fd";
      ctx.fillText(state.subs, cx, y + bh / 2);
      ctx.shadowBlur = 0;
      cx += vw + 4;
      ctx.font = `${labelFs}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.fillText(" subs", cx, y + bh / 2);
      cx += ctx.measureText(" subs").width + padX;
      ctx.font = `bold ${fs}px sans-serif`;
    }
    if (state.viewers) {
      const vw = ctx.measureText(state.viewers).width;
      ctx.shadowColor = "rgba(52,211,153,0.7)";
      ctx.shadowBlur = 5;
      ctx.fillStyle = "#6ee7b7";
      ctx.fillText(state.viewers, cx, y + bh / 2);
      ctx.shadowBlur = 0;
      cx += vw + 4;
      ctx.font = `${labelFs}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.fillText(" viewers", cx, y + bh / 2);
    }
    ctx.textBaseline = "alphabetic";
  }

  private drawStatsGlass() {
    const { ctx, W, H, state } = this;
    if (!state.subs && !state.viewers) return;
    const effPos = this.pos(state.statsPosition, state.mobileStatsPosition);
    const x = this.px(effPos.x, W) || 14;
    const y = this.px(effPos.y, H) || 14;
    const bh = Math.max(26, Math.round(H * 0.042));
    const r = Math.round(bh * 0.38);
    const fs = Math.round(bh * 0.48);
    const labelFs = Math.round(bh * 0.30);
    const padX = Math.round(bh * 0.50);
    const dotR = Math.round(bh * 0.15);

    ctx.font = `bold ${fs}px sans-serif`;
    const liveW = ctx.measureText("LIVE").width + dotR * 2 + 10 + padX * 2;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    this.fillRR(x, y, liveW, bh, r);
    ctx.save();
    this.clipRR(x, y, liveW, bh, r);
    const shine = ctx.createLinearGradient(x, y, x, y + bh * 0.4);
    shine.addColorStop(0, "rgba(255,255,255,0.30)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, liveW, bh);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, liveW, bh, r);
    ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.arc(x + padX + dotR, y + bh / 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("LIVE", x + padX + dotR * 2 + 6, y + bh / 2);

    let cx = x + liveW + 4;
    const statPill = (val: string, label: string, color: string) => {
      ctx.font = `bold ${fs}px sans-serif`;
      const valW = ctx.measureText(val).width;
      ctx.font = `${labelFs}px sans-serif`;
      const lblW = ctx.measureText(label).width;
      const bw2 = valW + lblW + padX * 2 + 8;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      this.fillRR(cx, y, bw2, bh, r);
      ctx.save();
      this.clipRR(cx, y, bw2, bh, r);
      const sg = ctx.createLinearGradient(cx, y, cx, y + bh * 0.4);
      sg.addColorStop(0, "rgba(255,255,255,0.22)");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(cx, y, bw2, bh);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      this.strokeRR(cx, y, bw2, bh, r);
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(val, cx + padX, y + bh / 2);
      ctx.font = `${labelFs}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.50)";
      ctx.fillText(label, cx + padX + valW + 4, y + bh / 2);
      cx += bw2 + 4;
    };

    if (state.subs) statPill(state.subs, " subs", "#e9d5ff");
    if (state.viewers) statPill(state.viewers, " viewers", "#a7f3d0");
    ctx.textBaseline = "alphabetic";
  }

  private drawStatsYouTube() {
    const { ctx, W, H, state } = this;
    if (!state.subs && !state.viewers) return;
    const effPos = this.pos(state.statsPosition, state.mobileStatsPosition);
    const x = this.px(effPos.x, W) || 14;
    const y = this.px(effPos.y, H) || 14;
    const bh = Math.max(24, Math.round(H * 0.040));
    const r = Math.round(bh * 0.22);
    const fs = Math.round(bh * 0.50);
    const labelFs = Math.round(bh * 0.32);
    const padX = Math.round(bh * 0.50);

    ctx.font = `bold ${fs}px sans-serif`;
    const liveW = ctx.measureText("● LIVE").width + padX * 2;
    const liveGrad = ctx.createLinearGradient(x, y, x, y + bh);
    liveGrad.addColorStop(0, "#cc0000");
    liveGrad.addColorStop(1, "#990000");
    ctx.fillStyle = liveGrad;
    this.fillRR(x, y, liveW, bh, r);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("● LIVE", x + padX, y + bh / 2);

    let cx = x + liveW + 4;
    const ytBadge = (val: string, label: string, color: string) => {
      ctx.font = `bold ${Math.round(bh * 0.52)}px sans-serif`;
      const valW = ctx.measureText(val).width;
      ctx.font = `${labelFs}px sans-serif`;
      const lblW = ctx.measureText(label).width;
      const bw2 = valW + lblW + padX * 2 + 10;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      this.fillRR(cx, y, bw2, bh, r);
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 1;
      this.strokeRR(cx, y, bw2, bh, r);
      ctx.font = `bold ${Math.round(bh * 0.52)}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(val, cx + padX, y + bh / 2);
      ctx.font = `${labelFs}px sans-serif`;
      ctx.fillStyle = "rgba(30,30,30,0.65)";
      ctx.fillText(label, cx + padX + valW + 5, y + bh / 2);
      cx += bw2 + 4;
    };

    if (state.subs) ytBadge(state.subs, " subs", "#6d28d9");
    if (state.viewers) ytBadge(state.viewers, " viewers", "#065f46");
    ctx.textBaseline = "alphabetic";
  }

  private drawStatsSport() {
    const { ctx, W, H, state } = this;
    if (!state.subs && !state.viewers) return;
    const effPos = this.pos(state.statsPosition, state.mobileStatsPosition);
    const x = this.px(effPos.x, W) || 14;
    const y = this.px(effPos.y, H) || 14;
    const bh = Math.max(24, Math.round(H * 0.042));
    const r = Math.round(bh * 0.18);
    const fs = Math.round(bh * 0.48);
    const labelFs = Math.round(bh * 0.30);
    const padX = Math.round(bh * 0.45);
    const t2 = this.elapsed();
    const pulse = 0.5 + 0.5 * Math.sin(t2 * 2.0);

    ctx.font = `bold ${fs}px sans-serif`;
    const liveW = ctx.measureText("LIVE").width + padX * 2.5;
    const og = ctx.createLinearGradient(x, y, x + liveW, y);
    og.addColorStop(0, "#ea580c");
    og.addColorStop(1, "#dc2626");
    ctx.fillStyle = og;
    this.fillRR(x, y, liveW, bh, r);
    ctx.fillStyle = `rgba(255,255,255,${0.85 + pulse * 0.15})`;
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LIVE", x + liveW / 2, y + bh / 2);

    let cx = x + liveW + 4;
    const sportBadge = (val: string, label: string, color: string) => {
      ctx.font = `bold ${fs}px sans-serif`;
      const valW = ctx.measureText(val).width;
      ctx.font = `${labelFs}px sans-serif`;
      const lblW = ctx.measureText(label).width;
      const bw2 = valW + lblW + padX * 2 + 8;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      this.fillRR(cx, y, bw2, bh, r);
      ctx.strokeStyle = color + "55";
      ctx.lineWidth = 2;
      this.strokeRR(cx, y, bw2, bh, r);
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(val, cx + padX, y + bh / 2);
      ctx.font = `${labelFs}px sans-serif`;
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      ctx.fillText(label, cx + padX + valW + 4, y + bh / 2);
      cx += bw2 + 4;
    };

    if (state.subs) sportBadge(state.subs, " SUBS", "#7c3aed");
    if (state.viewers) sportBadge(state.viewers, " VIEWS", "#065f46");
    ctx.textBaseline = "alphabetic";
  }

  // ── SUBSCRIBER COUNT OVERLAY ───────────────────────────────────────────────

  // ── Rounded-rect primitives ────────────────────────────────────────────────
  /** Fill a rounded rectangle with the current fillStyle. */
  private fillRR(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }
  /** Stroke a rounded rectangle with the current strokeStyle. */
  private strokeRR(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.stroke();
  }
  /** Clip to a rounded rectangle — caller must ctx.save() before and ctx.restore() after. */
  private clipRR(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.clip();
  }
  // ── END rounded-rect primitives ────────────────────────────────────────────

  private drawSubsOverlay(t: number) {
    switch (this.state.subsStyle) {
      case "Minimal":  return this.drawMinimalCounter();
      case "Animated": return this.drawAnimatedCounter(t);
      case "Card":     return this.drawCardBadge();
      case "Goal":     return this.drawGoalBar();
      case "Neon":     return this.drawNeonSubCounter(t);
      case "Glass":    return this.drawGlassSubCounter();
      case "Sport":    return this.drawSportSubCounter(t);
      case "Cinema":   return this.drawCinemaSubCounter(t);
      case "HUD":
      default:         return this.drawHUDCounter();
    }
  }

  private drawMinimalCounter() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const fs = Math.round(Math.min(W, H) * (this.isVertical ? 0.07 : 0.055));
    const labelFs = Math.round(fs * 0.33);
    // Measure for pill sizing
    ctx.font = `bold ${fs}px sans-serif`;
    const numW = ctx.measureText(state.subs!).width;
    ctx.font = `bold ${labelFs}px sans-serif`;
    const lblW = ctx.measureText("SUBSCRIBERS").width;
    const padX = Math.round(fs * 0.4);
    const padY = Math.round(fs * 0.22);
    const pillW = Math.max(numW, lblW) + padX * 2;
    const pillH = fs + labelFs + Math.round(fs * 0.45) + padY * 2;
    const radius = Math.round(pillH * 0.16);
    // Frosted dark pill background
    ctx.fillStyle = "rgba(6,8,20,0.82)";
    this.fillRR(x - padX, y - padY, pillW, pillH, radius);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    this.strokeRR(x - padX, y - padY, pillW, pillH, radius);
    // Subscriber count
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.fillText(state.subs!, x, y);
    // Label
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.fillText("SUBSCRIBERS", x, y + fs + Math.round(fs * 0.14));
    ctx.textBaseline = "alphabetic";
  }

  private drawAnimatedCounter(t: number) {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.42 : 0.22));
    const bh = Math.round(H * (this.isVertical ? 0.1 : 0.1));
    const radius = Math.round(bh * 0.22);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    // Rounded dark card background
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(14,14,22,0.97)");
    bgGrad.addColorStop(1, "rgba(8,8,14,0.95)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);
    // Pulsing colored border
    ctx.strokeStyle = `rgba(204,0,1,${0.28 + pulse * 0.42})`;
    ctx.lineWidth = 2;
    this.strokeRR(x, y, bw, bh, radius);
    // Top accent stripe (clipped to card shape)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const topGrad = ctx.createLinearGradient(x, y, x + bw, y);
    topGrad.addColorStop(0, `rgba(204,0,1,${0.75 + pulse * 0.25})`);
    topGrad.addColorStop(1, `rgba(160,0,0,${0.55 + pulse * 0.2})`);
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, bw, 4);
    ctx.restore();
    // Subscriber count with soft white glow on pulse
    const fs = Math.round(bh * 0.42);
    ctx.shadowColor = `rgba(255,255,255,${pulse * 0.12})`;
    ctx.shadowBlur = pulse * 7;
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs!, x + bw / 2, y + bh * 0.44);
    ctx.shadowBlur = 0;
    // Pulsing red dot + SUBSCRIBERS label
    const labelFs = Math.round(bh * 0.2);
    ctx.font = `bold ${labelFs}px sans-serif`;
    const labelW = ctx.measureText("SUBSCRIBERS").width;
    const dotR = Math.round(labelFs * 0.38);
    const totalW = dotR * 2 + 6 + labelW;
    const lx = x + bw / 2 - totalW / 2;
    const ly = y + bh * 0.8;
    ctx.fillStyle = `rgba(204,0,1,${0.75 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(lx + dotR, ly, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBSCRIBERS", lx + dotR * 2 + 6, ly);
    ctx.textBaseline = "alphabetic";
  }

  private drawCardBadge() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.52 : 0.28));
    const bh = Math.round(H * (this.isVertical ? 0.1 : 0.11));
    const pad = Math.round(bh * 0.15);
    const iconD = Math.round(bh * 0.62);
    const radius = Math.round(bh * 0.22);
    // Rounded dark card with gradient
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(14,14,22,0.97)");
    bgGrad.addColorStop(1, "rgba(8,8,14,0.95)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);
    // Card border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);
    // Bottom accent gradient stripe (clipped to card)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const bottomGrad = ctx.createLinearGradient(x, y, x + bw, y);
    bottomGrad.addColorStop(0, "rgba(204,0,1,0.9)");
    bottomGrad.addColorStop(1, "rgba(150,0,0,0.5)");
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(x, y + bh - 3, bw, 3);
    ctx.restore();
    // Red circular play-button icon with glow
    const cx2 = x + pad + iconD / 2;
    const cy2 = y + bh / 2;
    ctx.fillStyle = "#cc0001";
    ctx.beginPath();
    ctx.arc(cx2, cy2, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    // Subtle inner shine on icon
    const iconShine = ctx.createRadialGradient(cx2 - iconD * 0.15, cy2 - iconD * 0.18, 0, cx2, cy2, iconD / 2);
    iconShine.addColorStop(0, "rgba(255,255,255,0.18)");
    iconShine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = iconShine;
    ctx.beginPath();
    ctx.arc(cx2, cy2, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    // Triangle play mark
    const tw = Math.round(iconD * 0.38);
    const th = Math.round(iconD * 0.44);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(cx2 - tw * 0.35 + 2, cy2 - th / 2);
    ctx.lineTo(cx2 - tw * 0.35 + 2 + tw, cy2);
    ctx.lineTo(cx2 - tw * 0.35 + 2, cy2 + th / 2);
    ctx.closePath();
    ctx.fill();
    // Text area
    const tx = x + pad + iconD + Math.round(bh * 0.12);
    const labelFs = Math.round(bh * 0.2);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SUBSCRIBERS", tx, y + bh * 0.13);
    const numFs = Math.round(bh * 0.42);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs!, tx, y + bh * 0.62);
    ctx.textBaseline = "alphabetic";
  }

  private drawHUDCounter() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bh = Math.max(24, Math.round(H * (this.isVertical ? 0.045 : 0.038)));
    const radius = Math.round(bh / 2); // Full pill shape
    const numFs = Math.round(bh * 0.46);
    const labelFs = Math.round(bh * 0.27);
    ctx.font = `bold ${numFs}px sans-serif`;
    const numW = ctx.measureText(state.subs!).width;
    ctx.font = `bold ${labelFs}px sans-serif`;
    const labelW = ctx.measureText("SUBS").width;
    const innerPad = Math.round(bh * 0.55);
    const dividerX = numW + innerPad * 1.8; // where red section ends
    const bw = dividerX + labelW + innerPad;
    // Pill background (dark right section)
    ctx.fillStyle = "rgba(8,8,14,0.93)";
    this.fillRR(x, y, bw, bh, radius);
    // Left red section (clipped to pill)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const redGrad = ctx.createLinearGradient(x, y, x + dividerX, y);
    redGrad.addColorStop(0, "rgba(200,0,0,0.92)");
    redGrad.addColorStop(1, "rgba(160,0,0,0.78)");
    ctx.fillStyle = redGrad;
    ctx.fillRect(x, y, dividerX, bh);
    // Thin vertical divider
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + dividerX, y + bh * 0.18, 1, bh * 0.64);
    ctx.restore();
    // Pill border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);
    // Count (in red section)
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs!, x + dividerX / 2, y + bh / 2);
    // "SUBS" label (in dark section)
    ctx.fillStyle = "rgba(255,255,255,0.52)";
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.fillText("SUBS", x + dividerX + (bw - dividerX) / 2, y + bh / 2);
    ctx.textBaseline = "alphabetic";
  }

  private drawGoalBar() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.55 : 0.3));
    const bh = Math.round(H * (this.isVertical ? 0.085 : 0.075));
    const rawSubs = (state.subs || "0").replace(/,/g, "");
    let currentNum = parseFloat(rawSubs);
    if (rawSubs.endsWith("M")) currentNum *= 1_000_000;
    else if (rawSubs.endsWith("K")) currentNum *= 1_000;
    const progress = Math.min(1, currentNum / Math.max(1, state.subsGoal));
    const pct = Math.round(progress * 100);
    const goalFmt = this.formatGoal(state.subsGoal);
    const pad = Math.round(bh * 0.18);
    const radius = Math.round(bh * 0.22);
    // Rounded dark card with gradient background
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(14,14,22,0.97)");
    bgGrad.addColorStop(1, "rgba(8,8,14,0.95)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);
    // Card border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);
    // Top accent stripe (clipped to rounded card)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const topGrad = ctx.createLinearGradient(x, y, x + bw, y);
    topGrad.addColorStop(0, "rgba(204,0,1,0.92)");
    topGrad.addColorStop(1, "rgba(150,0,0,0.55)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, bw, 3);
    ctx.restore();
    // Top row: count + goal + percentage
    const fs = Math.round(bh * 0.3);
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.fillText(rawSubs, x + pad, y + bh * 0.1);
    const numW = ctx.measureText(rawSubs).width;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `${Math.round(fs * 0.78)}px sans-serif`;
    ctx.fillText(` / ${goalFmt} goal`, x + pad + numW, y + bh * 0.13);
    ctx.fillStyle = "#ff4444";
    ctx.font = `bold ${Math.round(fs * 0.75)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(`${pct}%`, x + bw - pad, y + bh * 0.1);
    // Progress bar — rounded track + rounded fill
    const barY = Math.round(y + bh * 0.58);
    const barH = Math.max(4, Math.round(bh * 0.18));
    const barX = x + pad;
    const barW = bw - pad * 2;
    const barR = Math.round(barH / 2);
    // Track (rounded pill)
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    this.fillRR(barX, barY, barW, barH, barR);
    // Fill (gradient rounded pill)
    if (progress > 0) {
      const fillW = Math.max(barH, Math.round(barW * progress));
      const fg = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
      fg.addColorStop(0, "#cc0001");
      fg.addColorStop(1, "#ff4444");
      ctx.fillStyle = fg;
      this.fillRR(barX, barY, fillW, barH, barR);
    }
    // SUBSCRIBERS label
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `bold ${Math.round(fs * 0.62)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("SUBSCRIBERS", x + pad, y + bh - Math.round(bh * 0.06));
    ctx.textBaseline = "alphabetic";
  }

  // ── NEW SUB OVERLAY STYLES ─────────────────────────────────────────────────

  private drawNeonSubCounter(t: number) {
    const { ctx, W, H, state } = this;
    if (!state.subs) return;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.44 : 0.24));
    const bh = Math.round(H * (this.isVertical ? 0.10 : 0.09));
    const radius = Math.round(bh * 0.30);
    const pulse  = 0.5 + 0.5 * Math.sin(t * 1.8);
    const pulse2 = 0.5 + 0.5 * Math.sin(t * 2.4 + 1);

    // Neon gradient background
    const bgGrad = ctx.createLinearGradient(x, y, x + bw, y + bh);
    bgGrad.addColorStop(0, `rgba(88,28,220,${0.82 + pulse * 0.08})`);
    bgGrad.addColorStop(0.5, `rgba(0,160,255,${0.78 + pulse2 * 0.08})`);
    bgGrad.addColorStop(1, `rgba(88,28,220,${0.82 + pulse * 0.08})`);
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);

    // Inner glow border
    ctx.strokeStyle = `rgba(0,220,255,${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    this.strokeRR(x, y, bw, bh, radius);
    // Outer soft glow
    ctx.strokeStyle = `rgba(140,80,255,${0.20 + pulse2 * 0.18})`;
    ctx.lineWidth = 5;
    this.strokeRR(x - 2, y - 2, bw + 4, bh + 4, radius + 2);

    // Count
    const numFs = Math.round(bh * 0.44);
    ctx.shadowColor = `rgba(0,220,255,${0.7 + pulse * 0.3})`;
    ctx.shadowBlur = 10 + pulse * 7;
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs, x + bw / 2, y + bh * 0.41);
    ctx.shadowBlur = 0;

    // Label
    const labelFs = Math.round(bh * 0.22);
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.fillStyle = `rgba(180,230,255,0.80)`;
    ctx.fillText("SUBSCRIBERS", x + bw / 2, y + bh * 0.78);
    ctx.textBaseline = "alphabetic";
  }

  private drawGlassSubCounter() {
    const { ctx, W, H, state } = this;
    if (!state.subs) return;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.46 : 0.26));
    const bh = Math.round(H * (this.isVertical ? 0.10 : 0.09));
    const radius = Math.round(bh * 0.30);
    const pad    = Math.round(bh * 0.15);
    const iconD  = Math.round(bh * 0.55);

    // Frosted glass background
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(255,255,255,0.22)");
    bgGrad.addColorStop(1, "rgba(255,255,255,0.07)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);

    // Top shine for glass effect
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const shine = ctx.createLinearGradient(x, y, x, y + bh * 0.38);
    shine.addColorStop(0, "rgba(255,255,255,0.35)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, bw, bh);
    ctx.restore();

    // Glass border
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    this.strokeRR(x, y, bw, bh, radius);

    // Purple icon circle
    const cxI = x + pad + iconD / 2;
    const cyI = y + bh / 2;
    ctx.fillStyle = "rgba(139,92,246,0.88)";
    ctx.beginPath();
    ctx.arc(cxI, cyI, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    // Person icon
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cxI, cyI - iconD * 0.15, iconD * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cxI, cyI + iconD * 0.20, iconD * 0.25, iconD * 0.20, 0, 0, Math.PI);
    ctx.fill();

    // Text area
    const tx = x + pad + iconD + Math.round(bh * 0.10);
    const labelFs = Math.round(bh * 0.20);
    ctx.fillStyle = "rgba(255,255,255,0.58)";
    ctx.font = `${labelFs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SUBSCRIBERS", tx, y + bh * 0.12);
    const numFs = Math.round(bh * 0.44);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.shadowColor = "rgba(139,92,246,0.55)";
    ctx.shadowBlur = 6;
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs, tx, y + bh * 0.63);
    ctx.shadowBlur = 0;
    ctx.textBaseline = "alphabetic";
  }

  private drawSportSubCounter(t: number) {
    const { ctx, W, H, state } = this;
    if (!state.subs) return;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.48 : 0.28));
    const bh = Math.round(H * (this.isVertical ? 0.075 : 0.068));
    const radius  = Math.round(bh * 0.22);
    const pulse   = 0.5 + 0.5 * Math.sin(t * 1.5);
    const stripeW = Math.round(bw * 0.32);

    // Orange gradient background
    const bgGrad = ctx.createLinearGradient(x, y, x + bw, y);
    bgGrad.addColorStop(0, "#e65100");
    bgGrad.addColorStop(0.5, "#ff6d00");
    bgGrad.addColorStop(1, "#e65100");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);

    // Left dark stripe (clipped)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    // Top sheen
    const sheenGrad = ctx.createLinearGradient(x, y, x, y + bh);
    sheenGrad.addColorStop(0, "rgba(255,255,255,0.18)");
    sheenGrad.addColorStop(0.45, "rgba(255,255,255,0)");
    ctx.fillStyle = sheenGrad;
    ctx.fillRect(x, y, bw, bh);
    // Dark stripe
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x, y, stripeW, bh);
    ctx.restore();

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + stripeW, y + bh * 0.15);
    ctx.lineTo(x + stripeW, y + bh * 0.85);
    ctx.stroke();

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);

    // SUBS label + dot in left stripe
    const liveFs = Math.round(bh * 0.38);
    const dotR   = Math.round(bh * 0.09);
    ctx.fillStyle = `rgba(255,255,255,${0.80 + pulse * 0.20})`;
    ctx.beginPath();
    ctx.arc(x + stripeW * 0.22, y + bh / 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${liveFs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBS", x + stripeW * 0.62, y + bh / 2);

    // Count in right section
    const numFs = Math.round(bh * 0.44);
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.fillText(state.subs, x + stripeW + (bw - stripeW) / 2, y + bh / 2);
    ctx.textBaseline = "alphabetic";
  }

  private drawCinemaSubCounter(t: number) {
    const { ctx, W, H, state } = this;
    if (!state.subs) return;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.46 : 0.26));
    const bh = Math.round(H * (this.isVertical ? 0.10 : 0.09));
    const radius = Math.round(bh * 0.25);
    const pulse  = 0.5 + 0.5 * Math.sin(t * 1.2);

    // Dark cinema background
    const bgGrad = ctx.createLinearGradient(x, y, x + bw, y + bh);
    bgGrad.addColorStop(0, "rgba(20,15,5,0.97)");
    bgGrad.addColorStop(1, "rgba(10,8,3,0.99)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);

    // Gold glow border
    ctx.strokeStyle = `rgba(255,196,0,${0.45 + pulse * 0.40})`;
    ctx.lineWidth = 2;
    this.strokeRR(x, y, bw, bh, radius);

    // Gold top accent stripe (clipped)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const goldGrad = ctx.createLinearGradient(x, y, x + bw, y);
    goldGrad.addColorStop(0, `rgba(255,215,0,${0.9 + pulse * 0.1})`);
    goldGrad.addColorStop(0.5, "rgba(255,230,100,0.95)");
    goldGrad.addColorStop(1, `rgba(200,160,0,0.9)`);
    ctx.fillStyle = goldGrad;
    ctx.fillRect(x, y, bw, 3);
    ctx.restore();

    // Gold count with glow
    const numFs = Math.round(bh * 0.42);
    ctx.shadowColor = `rgba(255,196,0,${0.4 + pulse * 0.35})`;
    ctx.shadowBlur = 8 + pulse * 5;
    ctx.fillStyle = "#ffd700";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs, x + bw / 2, y + bh * 0.41);
    ctx.shadowBlur = 0;

    // Stars + SUBSCRIBERS label
    const labelFs = Math.round(bh * 0.21);
    ctx.font = `${labelFs}px sans-serif`;
    ctx.fillStyle = `rgba(255,196,0,${0.50 + pulse * 0.15})`;
    ctx.fillText("★ SUBSCRIBERS ★", x + bw / 2, y + bh * 0.78);
    ctx.textBaseline = "alphabetic";
  }

  private formatGoal(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
    return String(n);
  }

  // ── SUB CHART (sparkline) ──────────────────────────────────────────────────

  private drawSubChart() {
    const { ctx, W, H, state } = this;
    const data = state.subChartData;

    const effPos = this.pos(state.subChartPosition, state.mobileSubChartPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.38 : 0.22));
    const bh = Math.round(H * (this.isVertical ? 0.12 : 0.1));

    // Background — always drawn so the card is visible even before data arrives.
    const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    bg.addColorStop(0, "rgba(15,12,41,0.9)");
    bg.addColorStop(1, "rgba(48,43,99,0.85)");
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(167,139,250,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);

    // Label row
    const labelH = Math.round(bh * 0.28);
    const labelFs = Math.round(labelH * 0.55);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `${labelFs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBSCRIBERS", bx + 6, by + labelH / 2);
    ctx.fillStyle = "#a78bfa";
    ctx.font = `bold ${Math.round(labelFs * 1.1)}px sans-serif`;
    ctx.textAlign = "right";
    // subs may be null before the first YouTube API poll — show "—" as placeholder.
    ctx.fillText(state.subs ?? "—", bx + bw - 6, by + labelH / 2);

    // Sparkline — only drawn once there are ≥2 data points.
    // Before that, show a "Collecting data…" hint so the card looks intentional.
    if (data.length < 2) {
      const hintFs = Math.round(labelFs * 0.85);
      ctx.fillStyle = "rgba(167,139,250,0.5)";
      ctx.font = `${hintFs}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Collecting data…", bx + bw / 2, by + labelH + (bh - labelH) / 2);
      return;
    }

    // Sparkline
    const chartY = by + labelH + 2;
    const chartH = bh - labelH - 6;
    const chartW = bw - 8;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const ptX = (i: number) => bx + 4 + (i / (data.length - 1)) * chartW;
    const ptY = (v: number) => chartY + chartH - ((v - min) / range) * chartH * 0.85;

    // Gradient fill under line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptX(0), chartY + chartH);
    data.forEach((v, i) => ctx.lineTo(ptX(i), ptY(v)));
    ctx.lineTo(ptX(data.length - 1), chartY + chartH);
    ctx.closePath();
    const fillG = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
    fillG.addColorStop(0, "rgba(167,139,250,0.35)");
    fillG.addColorStop(1, "rgba(167,139,250,0.0)");
    ctx.fillStyle = fillG;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(ptX(i), ptY(v)) : ctx.lineTo(ptX(i), ptY(v)));
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = Math.max(1.5, Math.round(bh * 0.025));
    ctx.lineJoin = "round";
    ctx.stroke();

    // End dot
    const lastX = ptX(data.length - 1);
    const lastY = ptY(data[data.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, Math.round(bh * 0.06), 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  }

  // ── SUB ALERT ──────────────────────────────────────────────────────────────

  private drawSubAlert(t: number) {
    const { ctx, W, H, state } = this;
    if (!state.subAlertMessage) return;

    const age = t - this.subAlertStartT;
    const fadeIn  = Math.min(1, age / 0.4);
    const fadeOut = age > SUBALERT_TTL - 0.6 ? Math.max(0, 1 - (age - (SUBALERT_TTL - 0.6)) / 0.5) : 1;
    const alpha   = fadeIn * fadeOut;
    const scale   = 0.85 + 0.15 * this.easeElastic(Math.min(1, age / 0.4));

    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.55));
    const bh = Math.round(H * 0.1);
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.38);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bw / 2), -(bh / 2));

    // Box
    const g = ctx.createLinearGradient(0, 0, bw, bh);
    g.addColorStop(0, "rgba(255,177,0,0.95)");
    g.addColorStop(1, "rgba(255,100,0,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, bw, bh);

    // Bell emoji-replacement: yellow circle
    const bellSz = Math.round(bh * 0.55);
    const bellX = Math.round(bh * 0.3);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(bellX, bh / 2, bellSz / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bellSz * 0.6)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🔔", bellX, bh / 2);

    // Message
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.33)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const msgX = bh * 0.7;
    let msg = state.subAlertMessage;
    while (msg.length > 4 && ctx.measureText(msg).width > bw - msgX - 12)
      msg = msg.slice(0, -4) + "…";
    ctx.fillText(msg, msgX, bh / 2);
    ctx.restore();
  }

  // ── SUPER CHAT NOTIFICATION ────────────────────────────────────────────────

  private drawSuperChatNotification(sc: SuperChatMessage, t: number) {
    if (!sc) return;
    const { ctx, W, H } = this;
    const ageMs = Date.now() - sc.ts;
    const ageSec = ageMs / 1000;

    const fadeIn  = Math.min(1, ageSec / 0.4);
    const fadeOut = ageSec > SUPERCHAT_TTL - 0.8 ? Math.max(0, 1 - (ageSec - (SUPERCHAT_TTL - 0.8)) / 0.7) : 1;
    const alpha   = fadeIn * fadeOut;
    const scale   = 0.85 + 0.15 * this.easeElastic(Math.min(1, ageSec / 0.35));

    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.5));
    const bh = Math.round(H * (this.isVertical ? 0.16 : 0.14));
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.5);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bw / 2), -(bh / 2));

    // Header band (tier color)
    ctx.fillStyle = sc.color || "#1565C0";
    ctx.fillRect(0, 0, bw, Math.round(bh * 0.38));

    // Body (darker tint)
    ctx.fillStyle = "rgba(10,10,25,0.94)";
    ctx.fillRect(0, Math.round(bh * 0.38), bw, bh - Math.round(bh * 0.38));

    // Left accent stripe
    ctx.fillStyle = sc.color || "#1565C0";
    ctx.fillRect(0, 0, 4, bh);

    // Amount badge
    const fs1 = Math.round(bh * 0.22);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs1}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(sc.amount, 12, bh * 0.19);

    // "Super Chat" label
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `${Math.round(fs1 * 0.75)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("Super Chat", bw - 10, bh * 0.19);

    // User name
    const fs2 = Math.round(bh * 0.22);
    ctx.fillStyle = sc.color || "#81b0ff";
    ctx.font = `bold ${fs2}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(sc.user, 12, bh * 0.56);

    // Message
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `${Math.round(fs2 * 0.85)}px sans-serif`;
    let msg = sc.text || "";
    while (msg.length > 4 && ctx.measureText(msg).width > bw - 22) msg = msg.slice(0, -4) + "…";
    ctx.fillText(msg, 12, bh * 0.8);

    ctx.restore();
  }

  // ── GUEST NAME TAG ─────────────────────────────────────────────────────────

  private drawGuestNameTag() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.guestPosition, state.mobileGuestPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.82 : 0.42));
    const bh = Math.round(H * 0.1);
    const nameFs = Math.round(bh * 0.38);
    const titleFs = Math.round(bh * 0.24);

    switch (state.guestStyle) {
      case "Neon": {
        ctx.fillStyle = "rgba(4,4,20,0.9)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#00fff0";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.shadowColor = "#00fff0";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#00fff0";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(state.guestName, bx + 14, by + bh * 0.12);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0,255,240,0.55)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.fillText(state.guestTitle, bx + 14, by + bh * 0.58);
        break;
      }
      case "Gradient": {
        const g = ctx.createLinearGradient(bx, by, bx + bw, by);
        g.addColorStop(0, "rgba(102,126,234,0.93)");
        g.addColorStop(1, "rgba(118,75,162,0.88)");
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(state.guestName, bx + 14, by + bh * 0.1);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.fillText(state.guestTitle, bx + 14, by + bh * 0.56);
        break;
      }
      case "Minimal": {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(0,0,0,0.95)";
        ctx.shadowBlur = 12;
        ctx.fillText(state.guestName, bx, by);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.95)";
        ctx.shadowBlur = 8;
        ctx.fillText(state.guestTitle, bx, by + nameFs + 4);
        ctx.shadowBlur = 0;
        break;
      }
      case "Sports": {
        const accentH = Math.round(bh * 0.45);
        ctx.fillStyle = "#e53e3e";
        ctx.fillRect(bx, by, bw, accentH);
        ctx.fillStyle = "rgba(0,0,0,0.92)";
        ctx.fillRect(bx, by + accentH, bw, bh - accentH);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.round(accentH * 0.7)}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(state.guestName.toUpperCase(), bx + 12, by + accentH / 2);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = `bold ${Math.round((bh - accentH) * 0.55)}px sans-serif`;
        ctx.fillText(state.guestTitle.toUpperCase(), bx + 12, by + accentH + (bh - accentH) / 2);
        break;
      }
      case "Classic":
      default: {
        // Dark bar with left red stripe
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#cc0001";
        ctx.fillRect(bx, by, 5, bh);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(state.guestName, bx + 16, by + bh * 0.1);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.fillText(state.guestTitle, bx + 16, by + bh * 0.57);
        break;
      }
    }
  }

  // ── CHAT BURN-IN ───────────────────────────────────────────────────────────

  // ── Emoji font helper ────────────────────────────────────────────────────
  /**
   * Inject 'Noto Color Emoji' into a CSS font shorthand string so emoji
   * glyphs render correctly via the registered Noto font. No-op when the
   * font was not successfully registered at startup.
   *
   * Input:  "700 14px sans-serif"
   * Output: "700 14px 'Noto Color Emoji', sans-serif"
   */
  private ef(font: string): string {
    if (!emojiFontRegistered && !sansFontRegistered) return font;
    const families = [
      emojiFontRegistered ? "'Noto Color Emoji'" : null,
      sansFontRegistered  ? "'Noto Sans'"        : null,
    ].filter(Boolean).join(", ");
    return font.replace(/(\d+px\s+)/, `$1${families}, `);
  }

  // ── Word-wrap helper ──────────────────────────────────────────────────────
  /**
   * Split `text` into at most `maxLines` lines where each line fits within
   * `maxWidth` canvas pixels (measured with the CURRENT ctx.font).
   * The last line is truncated with "…" if the message is longer.
   */
  private wrapTextToLines(
    ctx: { measureText(t: string): { width: number } },
    text: string,
    maxWidth: number,
    maxLines = 2,
  ): string[] {
    if (ctx.measureText(text).width <= maxWidth) return [text];
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && cur) {
        lines.push(cur);
        if (lines.length >= maxLines) {
          // Hit the line limit — mark the last line as truncated
          let last = lines[lines.length - 1];
          while (last.length > 4 && ctx.measureText(last + "…").width > maxWidth)
            last = last.slice(0, -2);
          lines[lines.length - 1] = last + "…";
          return lines;
        }
        cur = word;
      } else {
        cur = candidate;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ── Glass-card & avatar helpers (used by all chat burn styles) ─────────────

  /**
   * Draw a professional frosted-glass card.
   * Layers: drop-shadow → dark base → white frost → top shine
   *         → optional accent colour wash → crisp border.
   */
  private fillGlassCard(
    x: number, y: number, w: number, h: number, r: number,
    accentColor?: string,
  ): void {
    const { ctx } = this;
    // 1 — drop shadow
    ctx.save();
    ctx.shadowColor  = "rgba(0,0,0,0.60)";
    ctx.shadowBlur   = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "rgba(10,8,20,0.72)";
    this.fillRR(x, y, w, h, r);
    ctx.restore();
    // 2 — white frost overlay
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    this.fillRR(x, y, w, h, r);
    // 3 — top shine + optional accent wash (clipped)
    ctx.save();
    this.clipRR(x, y, w, h, r);
    const shine = ctx.createLinearGradient(x, y, x, y + h * 0.42);
    shine.addColorStop(0, "rgba(255,255,255,0.15)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, w, h);
    if (accentColor) {
      const wash = ctx.createLinearGradient(x, 0, x + w * 0.45, 0);
      wash.addColorStop(0, accentColor + "22");
      wash.addColorStop(1, "transparent");
      ctx.fillStyle = wash;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    // 4 — border
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth   = 1;
    this.strokeRR(x, y, w, h, r);
  }

  /**
   * Draw a circular profile avatar.
   * Uses the cached YouTube profile picture when available; falls back to a
   * radial-gradient initial-letter placeholder otherwise.
   */
  private drawAvatarCircle(
    cx: number, cy: number, r: number,
    msg: Pick<ChatBurnMessage, "name" | "photo" | "color">,
  ): void {
    const { ctx } = this;
    const ac     = msg.color || "#06b6d4";
    const cached = msg.photo ? this.avatarCache.get(msg.photo) : undefined;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    if (cached) {
      ctx.drawImage(cached, cx - r, cy - r, r * 2, r * 2);
    } else {
      // Gradient placeholder with first initial
      const g = ctx.createRadialGradient(
        cx - r * 0.25, cy - r * 0.25, 0,
        cx, cy, r,
      );
      g.addColorStop(0, ac + "ee");
      g.addColorStop(1, ac + "77");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle    = "#fff";
      ctx.font         = `bold ${Math.round(r * 0.88)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((msg.name[0] || "?").toUpperCase(), cx, cy);
    }
    ctx.restore();

    // Coloured ring
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = cached ? `${ac}66` : `${ac}cc`;
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // ────────────────────────────────────────────────────────────────────────────

  private drawChatBurn(t: number) {
    const style = this.state.chatBurnStyle;
    if (this.isVertical) {
      switch (style) {
        case "Float":     return this.drawFloatChat();
        case "Sidebar":   return this.drawSidebarChatMobile();
        case "Highlight": return this.drawHighlightChat();
        case "Ticker":    return this.drawTickerChat(t);
        case "Bubble":
        default:          return this.drawBubbleChatMobile();
      }
    }
    switch (style) {
      case "Float":     return this.drawFloatChat();
      case "Sidebar":   return this.drawSidebarChat();
      case "Highlight": return this.drawHighlightChat();
      case "Ticker":    return this.drawTickerChat(t);
      case "Bubble":
      default:          return this.drawBubbleChat();
    }
  }

  private drawBubbleChat() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-6);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);

    const rowH         = Math.round(H * 0.074);
    const gap          = Math.round(H * 0.009);
    const cardW        = Math.round(W * 0.44);
    const radius       = Math.round(rowH * 0.44); // pill-like curves
    const avatarR      = Math.round(rowH * 0.32);
    const padL         = Math.round(rowH * 0.22);
    const avatarX      = bx + padL + avatarR;
    const textX        = avatarX + avatarR + Math.round(rowH * 0.18);
    const nameFontSize = Math.round(rowH * 0.28);
    const fontSize     = Math.round(rowH * 0.28);

    ctx.textBaseline = "middle";
    const msgFont  = this.ef(`${fontSize}px sans-serif`);
    const nameFont = this.ef(`700 ${nameFontSize}px sans-serif`);
    const msgAvail = cardW - (textX - bx) - Math.round(rowH * 0.2);

    const allLines = msgs.map(msg => {
      ctx.font = msgFont;
      return this.wrapTextToLines(ctx, msg.text, msgAvail, 2);
    });

    let currentY = by;
    msgs.forEach((msg, i) => {
      const lines     = allLines[i];
      const multiLine = lines.length > 1;
      const cardH     = multiLine ? Math.round(rowH * 1.62) : rowH;
      const my        = currentY;
      currentY       += cardH + gap;
      if (my + cardH > H) return;

      const ac = msg.color || "#06b6d4";
      const cy = my + rowH / 2;

      // Frosted glass card
      this.fillGlassCard(bx, my, cardW, cardH, radius, ac);

      // Thin left accent bar (3 px, clipped to card corner)
      ctx.save();
      this.clipRR(bx, my, 5 + radius, cardH, radius);
      ctx.fillStyle = ac;
      ctx.fillRect(bx, my, 5, cardH);
      ctx.restore();

      // Avatar circle (real photo or gradient initial)
      this.drawAvatarCircle(avatarX, cy, avatarR, msg);

      // Name
      ctx.font      = nameFont;
      ctx.textAlign = "left";
      ctx.fillStyle = ac;
      const maxNameW = Math.round(cardW * 0.36);
      let dName = msg.name;
      while (dName.length > 2 && ctx.measureText(dName).width > maxNameW)
        dName = dName.slice(0, -2) + "…";
      ctx.fillText(dName, textX, my + rowH * 0.30);

      // Message text (word-wrapped, up to 2 lines, emoji-aware)
      ctx.font      = msgFont;
      ctx.fillStyle = "rgba(240,243,255,0.96)";
      if (multiLine) {
        const step   = Math.round(fontSize * 1.38);
        const firstY = my + rowH * 0.70;
        lines.forEach((line, li) => ctx.fillText(line, textX, firstY + li * step));
      } else {
        ctx.fillText(lines[0], textX, my + rowH * 0.70);
      }
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawBubbleChatMobile() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-6);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bx     = this.px(effPos.x, W);
    const by     = this.px(effPos.y, H);
    const cardW  = Math.round(W * 0.90);
    const rowH   = Math.round(H * 0.046);
    const gap    = Math.round(H * 0.007);
    const radius = Math.round(rowH * 0.44);
    const fontSize = Math.round(rowH * 0.36);
    const padX   = Math.round(rowH * 0.30);
    const avatarR = Math.round(rowH * 0.30);

    ctx.textBaseline = "middle";
    const nameFontStr = this.ef(`bold ${fontSize}px sans-serif`);
    const msgFontStr  = this.ef(`${Math.round(fontSize * 0.90)}px sans-serif`);
    // Left padding: padX + avatar diameter + small gap
    const leftPad = padX + avatarR * 2 + Math.round(rowH * 0.14);

    const preparedMsgs = msgs.map(msg => {
      ctx.font = nameFontStr;
      const nameStr = msg.name + ": ";
      const nameW   = ctx.measureText(nameStr).width;
      ctx.font = msgFontStr;
      const avail = cardW - leftPad - padX - nameW;
      const lines = this.wrapTextToLines(ctx, msg.text, avail, 2);
      return { msg, nameStr, nameW, lines };
    });

    let currentY = by;
    preparedMsgs.forEach(({ msg, nameStr, nameW, lines }) => {
      const multiLine = lines.length > 1;
      const cardH     = multiLine ? Math.round(rowH * 1.58) : rowH;
      const my        = currentY;
      currentY       += cardH + gap;
      if (my + cardH > H) return;

      const ac = msg.color || "#06b6d4";
      const cy = my + (multiLine ? rowH / 2 : cardH / 2);

      // Frosted glass card
      this.fillGlassCard(bx, my, cardW, cardH, radius, ac);

      // Avatar on left edge
      const avatarX = bx + padX + avatarR;
      this.drawAvatarCircle(avatarX, cy, avatarR, msg);

      // Name + first message line inline
      const txStart = bx + leftPad;
      ctx.font      = nameFontStr;
      ctx.textAlign = "left";
      ctx.fillStyle = ac;
      ctx.fillText(nameStr, txStart, cy);

      ctx.fillStyle = "rgba(240,243,255,0.96)";
      ctx.font      = msgFontStr;
      ctx.fillText(lines[0], txStart + nameW, cy);

      if (multiLine) {
        const line2Y = my + rowH + Math.round(rowH * 0.38);
        ctx.fillText(lines[1], txStart, line2Y);
      }
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawFloatChat() {
    const { ctx, W, H, state } = this;
    const now         = Date.now();
    const effPos      = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const baseX       = this.px(effPos.x, W);
    const baseY       = this.px(effPos.y, H);
    const lifetimeSec = 6.0;
    const fontSize    = Math.round(H * 0.036);
    const padX        = Math.round(fontSize * 0.65);
    const avatarR     = Math.round(fontSize * 0.55);
    const cardH       = Math.max(avatarR * 2 + 6, fontSize + Math.round(fontSize * 0.55));
    const radius      = Math.round(cardH * 0.48); // near-pill

    for (const msg of state.chatBurnMessages) {
      const ageSec = (now - msg.ts) / 1000;
      if (ageSec > lifetimeSec) continue;

      const hash   = [...msg.name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const spread = (hash % 13) / 12;
      const mx     = baseX + Math.round(spread * Math.min(W * 0.40, W - baseX - fontSize * 10));
      const rise   = (ageSec / lifetimeSec) * H * 0.24;
      const my     = baseY - Math.round(rise);

      const fadeStart = lifetimeSec * 0.62;
      const alpha     = ageSec > fadeStart
        ? 1 - (ageSec - fadeStart) / (lifetimeSec - fadeStart)
        : 1;
      if (alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = this._panelAlpha * alpha;

      const ac = msg.color || "#a78bfa";

      // Measure text widths to size the pill
      ctx.font = this.ef(`bold ${fontSize}px sans-serif`);
      const nameLabel  = `${msg.name}: `;
      const nameLabelW = ctx.measureText(nameLabel).width;
      ctx.font = this.ef(`${Math.round(fontSize * 0.92)}px sans-serif`);
      const msgW    = ctx.measureText(msg.text).width;
      const cardW   = avatarR * 2 + padX * 0.6 + nameLabelW + msgW + padX * 1.5;
      const cardTop = my - Math.round(cardH / 2);
      const cardLeft = mx - padX;

      // Frosted glass pill card
      this.fillGlassCard(cardLeft, cardTop, cardW, cardH, radius, ac);

      // Avatar circle left
      const avatarCX = cardLeft + padX * 0.7 + avatarR;
      const avatarCY = cardTop + cardH / 2;
      this.drawAvatarCircle(avatarCX, avatarCY, avatarR, msg);

      const textStartX = cardLeft + padX * 0.7 + avatarR * 2 + Math.round(fontSize * 0.18);

      // Username
      ctx.font         = this.ef(`bold ${fontSize}px sans-serif`);
      ctx.textAlign    = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle    = ac;
      ctx.fillText(nameLabel, textStartX, avatarCY);

      // Message
      ctx.font      = this.ef(`${Math.round(fontSize * 0.92)}px sans-serif`);
      ctx.fillStyle = "rgba(240,243,255,0.96)";
      ctx.fillText(msg.text, textStartX + nameLabelW, avatarCY);

      ctx.restore();
    }
    ctx.textBaseline = "alphabetic";
  }

  private drawSidebarChat() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-9);
    if (!msgs.length) return;
    const effPos  = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const panelW  = Math.round(W * 0.30);
    const px2     = this.px(effPos.x, W);
    const py2     = this.px(effPos.y, H);
    const headerH = Math.round(H * 0.036);
    const lineH   = Math.round(H * 0.056);
    const avatarR = Math.round(lineH * 0.32);
    // Fix: use the MAXIMUM message count (9) for height so the panel size is
    // constant — it no longer grows as new messages arrive.  Messages that
    // don't fit are clipped by the rounded-rect clip applied below.
    const MAX_SIDEBAR_MSGS = 9;
    const panelH  = Math.min(H - py2 - 8, headerH + MAX_SIDEBAR_MSGS * lineH + 18);
    const fontSize = Math.round(lineH * 0.36);
    const radius   = Math.round(panelH * 0.04);

    // Frosted glass panel
    this.fillGlassCard(px2, py2, panelW, panelH, radius);

    // Header — warm red gradient (clipped to top of panel)
    ctx.save();
    this.clipRR(px2, py2, panelW, panelH, radius);
    const hGrad = ctx.createLinearGradient(px2, py2, px2 + panelW, py2);
    hGrad.addColorStop(0, "rgba(220,50,50,0.92)");
    hGrad.addColorStop(0.6, "rgba(170,20,20,0.85)");
    hGrad.addColorStop(1, "rgba(120,10,10,0.72)");
    ctx.fillStyle = hGrad;
    ctx.fillRect(px2, py2, panelW, headerH);
    // Header shine
    const hShine = ctx.createLinearGradient(px2, py2, px2, py2 + headerH);
    hShine.addColorStop(0, "rgba(255,255,255,0.18)");
    hShine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hShine;
    ctx.fillRect(px2, py2, panelW, headerH);
    ctx.restore();

    // Header label
    ctx.fillStyle    = "#fff";
    ctx.font         = `800 ${Math.round(headerH * 0.50)}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = "rgba(0,0,0,0.55)";
    ctx.shadowBlur   = 4;
    ctx.fillText("● LIVE CHAT", px2 + panelW / 2, py2 + headerH / 2);
    ctx.shadowBlur   = 0;

    msgs.forEach((msg, i) => {
      const my = py2 + headerH + 9 + i * lineH;
      if (my + lineH > py2 + panelH - 4) return;

      // Row separator
      if (i > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(px2 + 10, my - 1, panelW - 20, 1);
      }

      const ac       = msg.color || "#ff6b6b";
      const avatarCX = px2 + 10 + avatarR;
      const avatarCY = my + lineH / 2;

      // Profile avatar
      this.drawAvatarCircle(avatarCX, avatarCY, avatarR, msg);

      // Name
      const nameX = px2 + 10 + avatarR * 2 + 6;
      ctx.font         = `700 ${fontSize}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle    = ac;
      const nameStr  = msg.name + ":";
      let dName      = nameStr;
      const maxNameW = Math.round(panelW * 0.40);
      while (dName.length > 3 && ctx.measureText(dName).width > maxNameW)
        dName = dName.slice(0, -2) + "…";
      ctx.fillText(dName, nameX, avatarCY);
      const nameW = ctx.measureText(dName).width;

      // Message
      ctx.fillStyle = "rgba(235,240,255,0.88)";
      ctx.font      = `${Math.round(fontSize * 0.90)}px sans-serif`;
      const available = panelW - 14 - (nameX - px2) - nameW - 5;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available)
        txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, nameX + nameW + 4, avatarCY);
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawSidebarChatMobile() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-7);
    if (!msgs.length) return;
    const effPos  = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const panelW  = Math.round(W * 0.90);
    const px2     = this.px(effPos.x, W);
    const py2     = this.px(effPos.y, H);
    const headerH = Math.round(H * 0.030);
    const lineH   = Math.round(H * 0.043);
    const avatarR = Math.round(lineH * 0.30);
    // Fix: size the panel for max messages (7) so it stays a constant height
    // regardless of how many messages are currently showing.
    const MAX_SIDEBAR_MSGS_MOBILE = 7;
    const panelH  = headerH + MAX_SIDEBAR_MSGS_MOBILE * (lineH + 3) + 12;
    const fontSize = Math.round(lineH * 0.36);
    const radius   = 12;

    // Frosted glass panel
    this.fillGlassCard(px2, py2, panelW, panelH, radius);

    // Header — red gradient
    ctx.save();
    this.clipRR(px2, py2, panelW, panelH, radius);
    const hg = ctx.createLinearGradient(px2, py2, px2 + panelW, py2);
    hg.addColorStop(0, "rgba(220,50,50,0.92)");
    hg.addColorStop(1, "rgba(130,10,10,0.78)");
    ctx.fillStyle = hg;
    ctx.fillRect(px2, py2, panelW, headerH);
    const hs = ctx.createLinearGradient(px2, py2, px2, py2 + headerH);
    hs.addColorStop(0, "rgba(255,255,255,0.16)");
    hs.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hs;
    ctx.fillRect(px2, py2, panelW, headerH);
    ctx.restore();

    // Header label
    ctx.fillStyle    = "#fff";
    ctx.font         = `800 ${Math.round(headerH * 0.50)}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("● LIVE CHAT", px2 + panelW / 2, py2 + headerH / 2);

    msgs.forEach((msg, i) => {
      const my       = py2 + headerH + 6 + i * (lineH + 3);
      const ac       = msg.color || "#ff6b6b";
      const avatarCX = px2 + 10 + avatarR;
      const avatarCY = my + lineH / 2;

      // Profile avatar
      this.drawAvatarCircle(avatarCX, avatarCY, avatarR, msg);

      // Name
      const nameX = px2 + 10 + avatarR * 2 + 5;
      ctx.font         = `700 ${fontSize}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle    = ac;
      const nameStr = msg.name + ":";
      let dName     = nameStr;
      while (dName.length > 3 && ctx.measureText(dName).width > panelW * 0.36)
        dName = dName.slice(0, -2) + "…";
      ctx.fillText(dName, nameX, avatarCY);
      const nameW = ctx.measureText(dName).width;

      ctx.fillStyle = "rgba(235,240,255,0.88)";
      ctx.font      = `${Math.round(fontSize * 0.90)}px sans-serif`;
      const available = panelW - 14 - (nameX - px2) - nameW - 5;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available)
        txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, nameX + nameW + 4, avatarCY);
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawHighlightChat() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages;
    if (!msgs.length) return;
    const msg    = msgs[msgs.length - 1];
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bw     = this.isVertical ? Math.round(W * 0.90) : Math.round(W * 0.56);
    const bh     = Math.round(H * 0.140);
    const bx     = this.px(effPos.x, W);
    const by     = this.px(effPos.y, H);
    const radius = Math.round(bh * 0.16);
    const ac     = msg.color || "#a78bfa";

    // Frosted glass card
    this.fillGlassCard(bx, by, bw, bh, radius, ac);

    // "NEW MESSAGE" badge row
    const badgeFs = Math.round(bh * 0.12);
    const dotR    = Math.round(badgeFs * 0.42);
    ctx.save();
    ctx.shadowColor = `${ac}cc`;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = ac;
    ctx.beginPath();
    ctx.arc(bx + 18 + dotR, by + bh * 0.10 + dotR, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle    = "rgba(255,255,255,0.82)";
    ctx.font         = `700 ${badgeFs}px sans-serif`;
    ctx.textAlign    = "left";
    ctx.textBaseline = "top";
    ctx.fillText("NEW MESSAGE", bx + 18 + dotR * 2 + 5, by + bh * 0.08);

    // Large avatar
    const avatarR  = Math.round(bh * 0.26);
    const avatarCX = bx + avatarR + 18;
    const avatarCY = by + bh * 0.65;
    this.drawAvatarCircle(avatarCX, avatarCY, avatarR, msg);

    // Username
    const textX = bx + avatarR * 2 + 34;
    const fs1   = Math.round(bh * 0.20);
    ctx.font         = `800 ${fs1}px sans-serif`;
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = ac;
    ctx.fillText(msg.name, textX, by + bh * 0.46);

    // Message text
    const fs2   = Math.round(bh * 0.22);
    ctx.font     = `${fs2}px sans-serif`;
    ctx.fillStyle = "rgba(240,243,255,0.97)";
    ctx.textBaseline = "top";
    const maxTxtW = bw - (textX - bx) - 16;
    let txt = msg.text;
    while (txt.length > 3 && ctx.measureText(txt).width > maxTxtW)
      txt = txt.slice(0, -4) + "…";
    ctx.fillText(txt, textX, by + bh * 0.61);
    ctx.textBaseline = "alphabetic";
  }

  /**
   * "Ticker" style — redesigned as a compact glass-card list.
   * Shows the 5 most recent, non-expired messages stacked vertically.
   * Oldest cards fade to 55 % opacity; newest is fully opaque.
   * No scrolling — messages appear instantly and expire after CHAT_BURN_TTL_MS.
   */
  private drawTickerChat(_t: number) {
    const { ctx, W, H, state } = this;

    // Filter out expired messages and take the 5 most recent
    const nowMs     = Date.now();
    const unexpired = state.chatBurnMessages.filter(m => nowMs - m.ts < CHAT_BURN_TTL_MS);
    const msgs      = unexpired.slice(-5);
    if (!msgs.length) return;

    const effPos  = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bx      = this.px(effPos.x, W);
    const by      = this.px(effPos.y, H);
    const cardW   = this.isVertical ? Math.round(W * 0.90) : Math.round(W * 0.46);
    const cardH   = Math.round(H * (this.isVertical ? 0.052 : 0.060));
    const gap     = Math.round(H * 0.008);
    const radius  = Math.round(cardH * 0.44); // pill-like
    const avatarR = Math.round(cardH * 0.30);
    const padX    = Math.round(cardH * 0.22);
    const fontSize = Math.round(cardH * 0.30);

    ctx.textBaseline = "middle";

    msgs.forEach((msg, i) => {
      // Oldest → 55 % opacity, newest → 100 %
      const fade = msgs.length === 1 ? 1 : 0.55 + (i / (msgs.length - 1)) * 0.45;
      const my   = by + i * (cardH + gap);
      if (my + cardH > H) return;

      const ac = msg.color || "#06b6d4";

      ctx.save();
      ctx.globalAlpha *= fade;

      // Frosted glass card
      this.fillGlassCard(bx, my, cardW, cardH, radius, ac);

      // Profile avatar
      const avatarCX = bx + padX + avatarR;
      const avatarCY = my + cardH / 2;
      this.drawAvatarCircle(avatarCX, avatarCY, avatarR, msg);

      // Name
      const nameX = bx + padX + avatarR * 2 + 7;
      ctx.font      = this.ef(`700 ${fontSize}px sans-serif`);
      ctx.textAlign = "left";
      ctx.fillStyle = ac;
      const maxNameW = Math.round(cardW * 0.28);
      let dName = msg.name;
      while (dName.length > 2 && ctx.measureText(dName).width > maxNameW)
        dName = dName.slice(0, -2) + "…";
      ctx.fillText(dName, nameX, avatarCY);
      const nameW = ctx.measureText(dName).width;

      // Separator dot between name and message
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.beginPath();
      ctx.arc(nameX + nameW + 8, avatarCY, 2, 0, Math.PI * 2);
      ctx.fill();

      // Message text
      ctx.font      = this.ef(`${Math.round(fontSize * 0.94)}px sans-serif`);
      ctx.fillStyle = "rgba(240,243,255,0.96)";
      const available = cardW - (nameX - bx) - nameW - 22 - padX;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available)
        txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, nameX + nameW + 18, avatarCY);

      ctx.restore();
    });

    ctx.textBaseline = "alphabetic";
  }

  // ── NEWS ───────────────────────────────────────────────────────────────────

  private drawNews(t: number) {
    const { state } = this;
    const animProg = Math.min(1, (t - this.newsAnimStartT) / ANIM_DUR);
    this._newsAnimProg = animProg;
    const anim = state.newsAnimation || "Fade";

    // Character/word-level animations — whole-overlay transform is skipped for these
    const CHAR_ANIMS = [
      "Typewriter", "Pop-in", "Letter Fade", "Bounce", "Reveal", "Wipe",
      "Scramble", "Word Reveal", "Zoom", "Elastic", "Flip", "Glitch",
    ];
    const isCharAnim = CHAR_ANIMS.includes(anim);

    const effPos = this.pos(state.newsPosition, state.mobileNewsPosition);
    const xBase = this.px(effPos.x, this.W);
    const yBase = this.px(effPos.y, this.H);

    const { ctx, W, H } = this;
    ctx.save();

    // Apply whole-overlay entry animations (skip for char-level anims)
    if (animProg < 1 && !isCharAnim) {
      const ep = this.easeInOut(animProg);
      switch (anim) {
        // Classic directional slides
        case "Fade":
          ctx.globalAlpha *= ep;
          break;
        case "Slide Left":
        case "←":
          ctx.translate((1 - ep) * W * 0.5, 0);
          break;
        case "Slide Right":
        case "→":
          ctx.translate(-(1 - ep) * W * 0.5, 0);
          break;
        case "Pop Up":
        case "↓":
          ctx.translate(0, (1 - ep) * 80);
          break;
        case "Drop Down":
          ctx.translate(0, -(1 - ep) * 80);
          break;
        case "↙":
          ctx.translate((1 - ep) * W * 0.3, -(1 - ep) * 50);
          break;
        case "↗":
          ctx.translate(-(1 - ep) * W * 0.3, (1 - ep) * 50);
          break;
        // Combined animations
        case "Fade Slide":
          ctx.globalAlpha *= ep;
          ctx.translate(0, (1 - ep) * 40);
          break;
        // Zoom in then settle
        case "Zoom": {
          const scale = 0.7 + ep * 0.3;
          ctx.globalAlpha *= ep;
          ctx.translate(W / 2, H / 2);
          ctx.scale(scale, scale);
          ctx.translate(-W / 2, -H / 2);
          break;
        }
        // Elastic overshoot from below
        case "Elastic": {
          const off = (1 - this.easeElastic(ep)) * 60;
          ctx.translate(0, off);
          break;
        }
        // Vertical flip (scaleY 0 → 1)
        case "Flip": {
          const scaleY = ep;
          ctx.translate(0, H / 2);
          ctx.scale(1, scaleY);
          ctx.translate(0, -H / 2);
          ctx.globalAlpha *= Math.min(1, ep * 2);
          break;
        }
        // Glitch horizontal jitter settling to position
        case "Glitch": {
          const settle = ep;
          const jitter = settle < 0.85 ? (Math.random() - 0.5) * 12 * (1 - settle) : 0;
          ctx.translate(jitter, 0);
          ctx.globalAlpha *= Math.min(1, ep * 1.5);
          break;
        }
      }
    }

    // ── Presentation mode overrides (motion style) ───────────────────────────
    const tickerMode = state.newsTickerMode ?? "Scroll";
    if (tickerMode === "Stationary")  { this.drawTickerStationary(t, yBase); ctx.restore(); return; }
    if (tickerMode === "Flap")        { this.drawTickerFlap(t, yBase);        ctx.restore(); return; }
    if (tickerMode === "Typewriter")  { this.drawTickerTypewriterMode(t, yBase); ctx.restore(); return; }
    if (tickerMode === "Wave")        { this.drawTickerWave(t, yBase);        ctx.restore(); return; }
    if (tickerMode === "Carousel")    { this.drawTickerCarousel(t, yBase);    ctx.restore(); return; }

    // ── Route to the correct broadcaster style ────────────────────────────────
    switch (state.newsStyle) {
      case "CNN":          this.drawTickerCNN(t, yBase); break;
      case "BBC":          this.drawTickerBBC(t, yBase); break;
      case "Bloomberg":    this.drawTickerBloomberg(t, yBase); break;
      case "Sky News":     this.drawTickerSkyNews(t, yBase); break;
      case "Neon Wire":    this.drawTickerNeonWire(t, yBase); break;
      case "Float Glass":  this.drawTickerFloatGlass(t, yBase); break;
      case "Sports":       this.drawTickerSports(t, yBase); break;
      case "Cinematic":    this.drawTickerCinematic(t, yBase); break;
      case "Gold Luxury":  this.drawTickerGoldLuxury(t, yBase); break;
      case "Minimal":      this.drawTickerMinimal(t, yBase); break;
      // Legacy style names (backward compat)
      case "Breaking":     this.drawBreaking(yBase); break;
      case "Lower Third":  this.drawLowerThird(xBase, yBase); break;
      case "Spotlight":    this.drawSpotlight(); break;
      case "Pop-up":       this.drawNewsPopup(); break;
      case "Scroll Banner": this.drawScrollBanner(t, yBase); break;
      // Al Jazeera = default + explicit
      case "Al Jazeera":
      case "Ticker":
      case "Crawl":
      default:             this.drawTickerAlJazeera(t, yBase); break;
    }

    ctx.restore();
  }

  // ── Shared ticker scroll helper ────────────────────────────────────────────
  /** Pixel-per-second speed from the user's newsScrollSpeed setting (10=fast … 60=slow) */
  private tickerPxPerSec(): number {
    const spd = this.state.newsScrollSpeed || 30;
    // Map: speed=10 → W/8 px/s (very fast), speed=60 → W/48 px/s (slow)
    return this.W / (spd * 0.4 + 4);
  }

  /**
   * Returns the accent/highlight colour for the currently selected Visual Theme
   * (state.newsStyle).  Used by all motion modes so the Visual Theme applies
   * regardless of which Motion Style is active.
   * If the user has also set a custom newsBgColor that overrides the default,
   * that colour takes priority.
   */
  private themeAccentColor(): string {
    // User explicit override always wins
    if (this.state.newsBgColor && this.state.newsBgColor !== "#cc0001") {
      return this.state.newsBgColor;
    }
    // Per-theme defaults that match their scroll-mode appearance
    switch (this.state.newsStyle) {
      case "CNN":          return "#cc0000";
      case "BBC":          return "#bb1919";
      case "Bloomberg":    return "#ff6600";
      case "Sky News":     return "#0369a1";
      case "Neon Wire":    return "#00ff88";
      case "Float Glass":  return "#60a5fa";
      case "Sports":       return "#f59e0b";
      case "Cinematic":    return "#e8d5a3";
      case "Gold Luxury":  return "#d4af37";
      case "Minimal":      return "#ffffff";
      case "Al Jazeera":
      default:             return this.state.newsBgColor || "#cc0001";
    }
  }

  /**
   * Draw seamlessly looping text inside a clipped region.
   * After each full scroll the text pauses for TICKER_PAUSE_SECS before
   * starting the next scroll. textY is the baseline Y for ctx.fillText.
   */
  private static readonly TICKER_PAUSE_SECS = 20;

  private drawScrollText(
    areaX: number, areaY: number, areaW: number, areaH: number,
    clipR: number, textY: number,
    text: string, font: string, color: string,
    t: number, startT: number,
  ) {
    const { ctx } = this;
    ctx.font = this.ef(font);
    const sep  = "   ◆   ";
    const unit = text + sep;
    const tw   = ctx.measureText(unit).width || 1;
    const speed = this.tickerPxPerSec();

    // Single-pass: text enters from the RIGHT edge of the ticker area,
    // scrolls LEFT until it fully exits the LEFT edge, then waits
    // TICKER_PAUSE_SECS before starting the next pass.
    // Total scroll distance = areaW (to cross the visible band) + tw (to fully exit left).
    const scrollDist     = areaW + tw;
    const scrollDuration = scrollDist / speed;
    const cycleDuration  = scrollDuration + (this.state.newsTickerLoopSecs ?? 20);
    const cycleElapsed   = (t - startT) % cycleDuration;

    if (cycleElapsed >= scrollDuration) return; // pause phase — draw nothing

    const x = areaX + areaW - cycleElapsed * speed;

    this.clipRoundRect(areaX, areaY, areaW, areaH, clipR, () => {
      ctx.fillStyle    = color;
      ctx.textAlign    = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(unit, x, textY);
    });
  }

  // ── 1. Al Jazeera style — squared badge, red left block, clean bold text ───
  private drawTickerAlJazeera(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(38, Math.round(H * 0.062));
    const accent = state.newsBgColor || "#cc0001";
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // Full dark bar — sharp edges (Al Jazeera style, no radius)
    ctx.fillStyle = "rgba(4,4,12,0.96)";
    ctx.fillRect(0, y, W, bh);

    // 3px red bottom stripe
    ctx.fillStyle = accent;
    ctx.fillRect(0, y + bh - 3, W, 3);

    // Left badge — solid accent block
    const badgeW = this.newsLogoImg ? Math.round(bh * 2.2) : Math.round(bh * 2.4);
    ctx.fillStyle = accent;
    ctx.fillRect(0, y, badgeW, bh);

    // Badge content
    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.14);
      const maxH = bh - pad * 2;
      const sc   = Math.min(maxH / img.height, (badgeW - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, badgeW, bh); ctx.clip();
      ctx.drawImage(img, Math.round((badgeW - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "● LIVE").toUpperCase();
      ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.round(bh * 0.31)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, badgeW / 2, y + bh / 2);
    }

    // Thin white separator
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(badgeW, y + bh * 0.12, 1, bh * 0.76);

    // Scrolling text
    const areaX = badgeW + 14; const areaW = W - areaX - 8;
    const fs = Math.round(bh * 0.34);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, 0,
      y + bh / 2, state.newsText, `600 ${fs}px sans-serif`,
      "rgba(240,240,240,0.97)", t, this.newsScrollStartT);
  }

  // ── 2. CNN style — charcoal bar, bold scarlet badge, heavy uppercase text ──
  private drawTickerCNN(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(40, Math.round(H * 0.066));
    const accent = state.newsBgColor || "#c00000";
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // Deep charcoal bar
    ctx.fillStyle = "rgba(18,18,22,0.97)";
    ctx.fillRect(0, y, W, bh);

    // Red top line (thin)
    ctx.fillStyle = accent;
    ctx.fillRect(0, y, W, 3);

    // Bold rectangular badge — left edge flush
    const bw2 = this.newsLogoImg ? Math.round(bh * 2.0) : Math.round(bh * 2.2);
    const g   = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, accent); g.addColorStop(1, `${accent}cc`);
    ctx.fillStyle = g; ctx.fillRect(0, y + 3, bw2, bh - 3);

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.15);
      const maxH = bh - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, bw2, bh); ctx.clip();
      ctx.drawImage(img, Math.round((bw2 - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "CNN").toUpperCase();
      ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.round(bh * 0.36)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 3;
      ctx.fillText(label, bw2 / 2, y + bh / 2 + 1);
      ctx.shadowBlur = 0;
    }

    // ▸ triangle pointer on right edge of badge
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(bw2, y + 3); ctx.lineTo(bw2 + 14, y + bh / 2); ctx.lineTo(bw2, y + bh);
    ctx.fill();

    // Separator gap — use pointer as separator
    const areaX = bw2 + 18; const areaW = W - areaX - 8;
    const fs    = Math.round(bh * 0.33);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, 0,
      y + bh / 2, state.newsText, `700 ${fs}px sans-serif`,
      "rgba(240,240,240,0.97)", t, this.newsScrollStartT);
  }

  // ── 3. BBC style — navy/dark bar, BBC red pill, tight white text ────────────
  private drawTickerBBC(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(38, Math.round(H * 0.062));
    const accent = state.newsBgColor || "#bb1919";
    const r      = Math.round(bh * 0.16);   // subtle rounding
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // Dark bar with slight blue tint (BBC look)
    ctx.fillStyle = "rgba(6,10,28,0.97)";
    this.roundRect(0, y, W, bh, r); ctx.fill();

    // 4px vertical accent stripe on far left
    ctx.fillStyle = accent; ctx.fillRect(0, y, 4, bh);

    // Badge — compact pill with rounded corners
    const bw2 = this.newsLogoImg ? Math.round(bh * 1.8) : Math.round(bh * 1.7);
    const bx  = 10; const by = y + Math.round(bh * 0.12);
    const bH2 = Math.round(bh * 0.76);
    this.roundRect(bx, by, bw2, bH2, Math.round(bH2 * 0.3));
    ctx.fillStyle = accent; ctx.fill();

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bH2 * 0.15);
      const maxH = bH2 - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); this.roundRect(bx, by, bw2, bH2, Math.round(bH2 * 0.3)); ctx.clip();
      ctx.drawImage(img, bx + Math.round((bw2 - dw) / 2), by + Math.round((bH2 - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "BBC NEWS").toUpperCase();
      ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.round(bH2 * 0.40)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bx + bw2 / 2, by + bH2 / 2);
    }

    // Separator
    const sepX = bx + bw2 + 10;
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(sepX, y + bh * 0.15, 1, bh * 0.70);

    // Scrolling text
    const areaX = sepX + 10; const areaW = W - areaX - 8;
    const fs    = Math.round(bh * 0.32);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, Math.max(0, r - 2),
      y + bh / 2, state.newsText, `600 ${fs}px sans-serif`,
      "rgba(230,230,235,0.97)", t, this.newsScrollStartT);
  }

  // ── 4. Bloomberg style — matte black, amber/gold, financial terminal feel ──
  private drawTickerBloomberg(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(36, Math.round(H * 0.058));
    const accent = state.newsBgColor || "#f59e0b";
    const y      = yBase > 0 ? Math.min(H - bh - 4, yBase) : H - bh - 4;

    // Matte near-black bar
    ctx.fillStyle = "rgba(8,8,10,0.98)";
    ctx.fillRect(0, y, W, bh);

    // Thin top gold line
    const lineG = ctx.createLinearGradient(0, 0, W, 0);
    lineG.addColorStop(0, accent); lineG.addColorStop(0.5, "#fde68a"); lineG.addColorStop(1, accent);
    ctx.fillStyle = lineG; ctx.fillRect(0, y, W, 2);

    // Badge — gold angled block
    const bw2 = this.newsLogoImg ? Math.round(bh * 2.1) : Math.round(bh * 2.4);
    ctx.fillStyle = accent;
    ctx.fillRect(0, y + 2, bw2, bh - 2);

    // Angled right edge for dynamic look
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(bw2, y + 2); ctx.lineTo(bw2 + 12, y + 2);
    ctx.lineTo(bw2, y + bh); ctx.fill();

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.12);
      const maxH = bh - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, bw2, bh); ctx.clip();
      ctx.drawImage(img, Math.round((bw2 - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "BLOOMBERG").toUpperCase();
      ctx.fillStyle = "#000"; ctx.font = `900 ${Math.round(bh * 0.29)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bw2 / 2, y + bh / 2 + 1);
    }

    // Text area — monospaced feel
    const areaX = bw2 + 16; const areaW = W - areaX - 8;
    const fs    = Math.round(bh * 0.33);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, 0,
      y + bh / 2, state.newsText, `600 ${fs}px "Courier New", monospace`,
      "#f5e08a", t, this.newsScrollStartT);
  }

  // ── 5. Sky News — sky blue + white, clean modern British broadcast ──────────
  private drawTickerSkyNews(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(40, Math.round(H * 0.066));
    const accent = state.newsBgColor || "#0072bc";
    const r      = Math.round(bh * 0.30);
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // White/light-grey main bar (Sky look: light not dark)
    this.roundRect(0, y, W, bh, r);
    ctx.fillStyle = "rgba(240,245,250,0.97)"; ctx.fill();

    // Thin blue top accent
    this.clipRoundRect(0, y, W, 4, r, () => {
      ctx.fillStyle = accent; ctx.fillRect(0, y, W, 4);
    });

    // Left sky-blue rounded badge
    const bw2 = this.newsLogoImg ? Math.round(bh * 2.0) : Math.round(bh * 2.2);
    this.roundRect(4, y + 4, bw2, bh - 8, Math.round((bh - 8) * 0.35));
    const bg2 = ctx.createLinearGradient(4, y, 4, y + bh);
    bg2.addColorStop(0, accent); bg2.addColorStop(1, `${accent}dd`);
    ctx.fillStyle = bg2; ctx.fill();

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.14);
      const maxH = (bh - 8) - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); this.roundRect(4, y + 4, bw2, bh - 8, Math.round((bh - 8) * 0.35)); ctx.clip();
      ctx.drawImage(img, 4 + Math.round((bw2 - dw) / 2), y + 4 + Math.round(((bh - 8) - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "SKY NEWS").toUpperCase();
      ctx.fillStyle = "#fff"; ctx.font = `800 ${Math.round(bh * 0.30)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, 4 + bw2 / 2, y + bh / 2);
    }

    const sepX = 4 + bw2 + 8;
    ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(sepX, y + bh * 0.15, 1, bh * 0.70);

    const areaX = sepX + 10; const areaW = W - areaX - 8;
    const fs    = Math.round(bh * 0.32);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, Math.max(0, r - 2),
      y + bh / 2, state.newsText, `600 ${fs}px sans-serif`,
      "rgba(10,10,30,0.95)", t, this.newsScrollStartT);
  }

  // ── 6. Neon Wire — dark bar, neon cyan glow border, sci-fi feel ────────────
  private drawTickerNeonWire(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(38, Math.round(H * 0.062));
    const accent = state.newsBgColor || "#00ffcc";
    const r      = Math.round(bh * 0.30);
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // Dark semi-transparent bar
    this.roundRect(0, y, W, bh, r);
    ctx.fillStyle = "rgba(2,10,22,0.95)"; ctx.fill();

    // Neon glow border
    this.roundRect(0, y, W, bh, r);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    ctx.shadowColor = accent; ctx.shadowBlur = 8;
    ctx.stroke(); ctx.shadowBlur = 0;

    // Animated scan line
    const scanPos = ((t * 0.3) % 1) * W;
    const scanG = ctx.createLinearGradient(scanPos - 60, 0, scanPos + 60, 0);
    scanG.addColorStop(0, "transparent");
    scanG.addColorStop(0.5, `${accent}30`);
    scanG.addColorStop(1, "transparent");
    this.clipRoundRect(0, y, W, bh, r, () => {
      ctx.fillStyle = scanG; ctx.fillRect(0, y, W, bh);
    });

    // Left neon badge
    const bw2 = this.newsLogoImg ? Math.round(bh * 1.9) : Math.round(bh * 2.1);
    this.roundRect(6, y + 5, bw2, bh - 10, Math.round((bh - 10) * 0.4));
    ctx.fillStyle = `${accent}22`; ctx.fill();
    this.roundRect(6, y + 5, bw2, bh - 10, Math.round((bh - 10) * 0.4));
    ctx.strokeStyle = accent; ctx.lineWidth = 1;
    ctx.shadowColor = accent; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.15);
      const maxH = (bh - 10) - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); this.roundRect(6, y + 5, bw2, bh - 10, Math.round((bh - 10) * 0.4)); ctx.clip();
      ctx.drawImage(img, 6 + Math.round((bw2 - dw) / 2), y + 5 + Math.round(((bh - 10) - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "◈ LIVE").toUpperCase();
      ctx.fillStyle = accent; ctx.font = `700 ${Math.round(bh * 0.29)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = accent; ctx.shadowBlur = 6;
      ctx.fillText(label, 6 + bw2 / 2, y + bh / 2);
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = `${accent}30`; ctx.fillRect(6 + bw2 + 8, y + bh * 0.15, 1, bh * 0.70);

    const areaX = 6 + bw2 + 14; const areaW = W - areaX - 10;
    const fs    = Math.round(bh * 0.32);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, Math.max(0, r - 2),
      y + bh / 2, state.newsText, `600 ${fs}px sans-serif`,
      accent, t, this.newsScrollStartT);
  }

  // ── 7. Float Glass — frosted glass, semi-transparent, elegant ──────────────
  private drawTickerFloatGlass(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(42, Math.round(H * 0.068));
    const accent = state.newsBgColor || "#818cf8";
    const r      = Math.round(bh * 0.38);
    const margin = 12;
    const y      = yBase > 0 ? Math.min(H - bh - margin, yBase) : H - bh - margin;

    // Frosted glass base
    this.roundRect(margin, y, W - margin * 2, bh, r);
    ctx.fillStyle = "rgba(255,255,255,0.13)"; ctx.fill();

    // Glass shimmer highlight along top
    this.clipRoundRect(margin, y, W - margin * 2, bh / 2, r, () => {
      const shimG = ctx.createLinearGradient(0, y, 0, y + bh / 2);
      shimG.addColorStop(0, "rgba(255,255,255,0.22)");
      shimG.addColorStop(1, "rgba(255,255,255,0.04)");
      ctx.fillStyle = shimG; ctx.fillRect(margin, y, W - margin * 2, bh / 2);
    });

    // Subtle border
    this.roundRect(margin, y, W - margin * 2, bh, r);
    ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1; ctx.stroke();

    // Left badge (translucent accent)
    const bw2 = this.newsLogoImg ? Math.round(bh * 1.8) : Math.round(bh * 2.0);
    const bx  = margin + 6; const by = y + 5; const bH2 = bh - 10;
    this.roundRect(bx, by, bw2, bH2, Math.round(bH2 * 0.38));
    ctx.fillStyle = `${accent}55`; ctx.fill();
    this.roundRect(bx, by, bw2, bH2, Math.round(bH2 * 0.38));
    ctx.strokeStyle = `${accent}99`; ctx.lineWidth = 1; ctx.stroke();

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bH2 * 0.15);
      const maxH = bH2 - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); this.roundRect(bx, by, bw2, bH2, Math.round(bH2 * 0.38)); ctx.clip();
      ctx.drawImage(img, bx + Math.round((bw2 - dw) / 2), by + Math.round((bH2 - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "◆ LIVE").toUpperCase();
      ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(bH2 * 0.40)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bx + bw2 / 2, by + bH2 / 2);
    }

    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.fillRect(bx + bw2 + 8, y + bh * 0.18, 1, bh * 0.64);

    const areaX = bx + bw2 + 14; const areaW = W - margin - areaX - 10;
    const fs    = Math.round(bh * 0.32);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, Math.max(0, r - 2),
      y + bh / 2, state.newsText, `600 ${fs}px sans-serif`,
      "rgba(255,255,255,0.96)", t, this.newsScrollStartT);
  }

  // ── 8. Sports — bold orange/red gradient, aggressive sports ticker ──────────
  private drawTickerSports(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(44, Math.round(H * 0.070));
    const accent = state.newsBgColor || "#ea580c";
    const y      = yBase > 0 ? Math.min(H - bh - 4, yBase) : H - bh - 4;

    // Full gradient bar — orange to dark red
    const barG = ctx.createLinearGradient(0, y, W, y + bh);
    barG.addColorStop(0, accent); barG.addColorStop(0.6, "#7f1d1d"); barG.addColorStop(1, "#1c1c1c");
    ctx.fillStyle = barG; ctx.fillRect(0, y, W, bh);

    // Dark band at bottom
    ctx.fillStyle = "rgba(0,0,0,0.30)"; ctx.fillRect(0, y + bh - 6, W, 6);

    // Diagonal slash badge
    const bw2 = this.newsLogoImg ? Math.round(bh * 2.0) : Math.round(bh * 2.3);
    ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, y, bw2, bh);

    // Slash accent on right of badge
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(bw2 - 8, y); ctx.lineTo(bw2 + 14, y); ctx.lineTo(bw2 + 6, y + bh);
    ctx.lineTo(bw2 - 16, y + bh); ctx.fill();

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.12);
      const maxH = bh - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, bw2, bh); ctx.clip();
      ctx.drawImage(img, Math.round((bw2 - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "⚡ SPORTS").toUpperCase();
      ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.round(bh * 0.32)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4;
      ctx.fillText(label, bw2 / 2, y + bh / 2);
      ctx.shadowBlur = 0;
    }

    const areaX = bw2 + 22; const areaW = W - areaX - 8;
    const fs    = Math.round(bh * 0.35);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, 0,
      y + bh / 2, state.newsText, `800 ${fs}px sans-serif`,
      "rgba(255,255,255,0.97)", t, this.newsScrollStartT);
  }

  // ── 9. Cinematic — near-black, gold hairline, letter-spaced elegance ────────
  private drawTickerCinematic(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(38, Math.round(H * 0.062));
    const accent = state.newsBgColor || "#c9a84c";
    const y      = yBase > 0 ? Math.min(H - bh - 4, yBase) : H - bh - 4;

    // Matte near-black bar
    ctx.fillStyle = "rgba(8,6,4,0.97)"; ctx.fillRect(0, y, W, bh);

    // Gold hairline top and bottom
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = accent; ctx.fillRect(0, y + bh - 1, W, 1);

    // Left logo/label area — minimal
    const bw2 = this.newsLogoImg ? Math.round(bh * 1.9) : Math.round(bh * 2.0);
    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.16);
      const maxH = bh - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, bw2, bh); ctx.clip();
      ctx.drawImage(img, Math.round((bw2 - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "LIVE").toUpperCase();
      ctx.fillStyle = accent; ctx.font = `300 ${Math.round(bh * 0.28)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      // Draw label with manual letter spacing for cinematic look
      const chars2 = label.split("");
      const totalLW = chars2.reduce((acc, c) => { ctx.font = `300 ${Math.round(bh * 0.28)}px sans-serif`; return acc + ctx.measureText(c).width + 3; }, 0);
      let lx = bw2 / 2 - totalLW / 2;
      chars2.forEach((c) => {
        ctx.font = `300 ${Math.round(bh * 0.28)}px sans-serif`;
        ctx.fillText(c, lx, y + bh / 2);
        lx += ctx.measureText(c).width + 3;
      });
    }

    // Gold hairline separator
    ctx.fillStyle = accent; ctx.fillRect(bw2, y + bh * 0.20, 1, bh * 0.60);

    const areaX = bw2 + 16; const areaW = W - areaX - 16;
    const fs    = Math.round(bh * 0.30);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, 0,
      y + bh / 2, state.newsText, `300 ${fs}px sans-serif`,
      "#d4bfa0", t, this.newsScrollStartT);
  }

  // ── 10. Gold Luxury — black bar, gradient gold badge, premium feel ──────────
  private drawTickerGoldLuxury(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(40, Math.round(H * 0.065));
    const r      = Math.round(bh * 0.26);
    const accent = state.newsBgColor || "#d4a017";
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // Rich black bar
    this.roundRect(0, y, W, bh, r);
    const barG = ctx.createLinearGradient(0, y, 0, y + bh);
    barG.addColorStop(0, "rgba(16,12,4,0.98)"); barG.addColorStop(1, "rgba(8,6,2,0.98)");
    ctx.fillStyle = barG; ctx.fill();

    // Gold gradient border
    this.roundRect(0, y, W, bh, r);
    const borderG2 = ctx.createLinearGradient(0, y, W, y + bh);
    borderG2.addColorStop(0, `${accent}88`); borderG2.addColorStop(0.5, "#fff5cc88");
    borderG2.addColorStop(1, `${accent}44`);
    ctx.strokeStyle = borderG2; ctx.lineWidth = 1.5; ctx.stroke();

    // Gold badge with inner shine
    const bw2 = this.newsLogoImg ? Math.round(bh * 2.0) : Math.round(bh * 2.2);
    this.roundRect(0, y, bw2, bh, r);
    const goldG = ctx.createLinearGradient(0, y, bw2, y + bh);
    goldG.addColorStop(0, "#fde68a"); goldG.addColorStop(0.3, accent);
    goldG.addColorStop(0.7, "#b8860b"); goldG.addColorStop(1, accent);
    ctx.fillStyle = goldG; ctx.fill();

    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.14);
      const maxH = bh - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); this.roundRect(0, y, bw2, bh, r); ctx.clip();
      ctx.drawImage(img, Math.round((bw2 - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "★ LIVE").toUpperCase();
      ctx.fillStyle = "#0a0600"; ctx.font = `900 ${Math.round(bh * 0.30)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bw2 / 2, y + bh / 2 + 1);
    }

    ctx.fillStyle = `${accent}55`; ctx.fillRect(bw2 + 1, y + bh * 0.15, 1, bh * 0.70);

    const areaX = bw2 + 14; const areaW = W - areaX - 10;
    const fs    = Math.round(bh * 0.32);
    this.drawScrollText(areaX, y + 2, areaW, bh - 4, Math.max(0, r - 2),
      y + bh / 2, state.newsText, `600 ${fs}px sans-serif`,
      "#f5e08a", t, this.newsScrollStartT);
  }

  // ── 11. Minimal — ultra-thin, barely-there, clean ──────────────────────────
  private drawTickerMinimal(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(28, Math.round(H * 0.044));
    const accent = state.newsBgColor || "#94a3b8";
    const y      = yBase > 0 ? Math.min(H - bh - 4, yBase) : H - bh - 4;

    // Near-invisible bar
    ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(0, y, W, bh);

    // 1px accent top line
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 1);

    // Tiny label on left
    const bw2 = this.newsLogoImg ? Math.round(bh * 1.8) : Math.round(bh * 1.6);
    if (this.newsLogoImg) {
      const img = this.newsLogoImg;
      const pad = Math.round(bh * 0.16);
      const maxH = bh - pad * 2;
      const sc = Math.min(maxH / img.height, (bw2 - pad * 2) / img.width);
      const dw = Math.round(img.width * sc); const dh = Math.round(img.height * sc);
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, bw2, bh); ctx.clip();
      ctx.drawImage(img, Math.round((bw2 - dw) / 2), y + Math.round((bh - dh) / 2), dw, dh);
      ctx.restore();
    } else {
      const label = (state.newsTitle || "LIVE").toUpperCase();
      ctx.fillStyle = accent; ctx.font = `600 ${Math.round(bh * 0.35)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, bw2 / 2, y + bh / 2);
    }

    ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(bw2 + 1, y + bh * 0.20, 1, bh * 0.60);

    const areaX = bw2 + 10; const areaW = W - areaX - 6;
    const fs    = Math.round(bh * 0.38);
    this.drawScrollText(areaX, y, areaW, bh, 0,
      y + bh / 2, state.newsText, `400 ${fs}px sans-serif`,
      "rgba(220,220,220,0.82)", t, this.newsScrollStartT);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── TICKER PRESENTATION MODES (motion styles, independent of visual theme) ─
  // Each uses the Al Jazeera base visual (dark bar) so the motion is front-stage.
  // ══════════════════════════════════════════════════════════════════════════

  /** Stationary — text is fixed, no scrolling. Messages rotate by cross-fade every HOLD_SECS. */
  private drawTickerStationary(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(40, Math.round(H * 0.065));
    const accent = this.themeAccentColor();
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    ctx.fillStyle = "rgba(4,4,12,0.95)"; ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 3);

    // Left label badge
    const bw = Math.round(bh * 2.0);
    ctx.fillStyle = accent; ctx.fillRect(0, y, bw, bh);
    const label = (state.newsTitle || "LIVE").toUpperCase();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(bh * 0.36)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bw / 2, y + bh / 2);

    // Fixed text centered in remaining area — no scrolling
    const HOLD_SECS = 6;
    const cycle = Math.floor(t / HOLD_SECS);
    const phase = (t % HOLD_SECS) / HOLD_SECS;
    // Fade in 0-0.15, hold 0.15-0.85, fade out 0.85-1.0
    const fadeAlpha = phase < 0.15 ? phase / 0.15 : phase > 0.85 ? (1 - phase) / 0.15 : 1;
    const lines = state.newsText.split(/\s{3,}|\s*[◆|·★]\s*/).filter(Boolean);
    const lineIdx = lines.length > 0 ? cycle % lines.length : 0;
    const displayText = lines[lineIdx] ?? state.newsText;
    const areaX = bw + 16, areaW = W - areaX - 16;
    const fs = Math.round(bh * 0.38);
    ctx.save();
    ctx.globalAlpha *= fadeAlpha;
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    // Truncate to fit
    let txt = displayText;
    while (ctx.measureText(txt).width > areaW && txt.length > 4) txt = txt.slice(0, -4) + "…";
    ctx.fillText(txt, areaX, y + bh / 2);
    ctx.restore();
  }

  /** Flap — split-flap departure-board animation per character. */
  private drawTickerFlap(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(42, Math.round(H * 0.068));
    const accent = this.themeAccentColor();
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    // Dark charcoal background with amber accent stripe
    ctx.fillStyle = "rgba(10,8,4,0.97)"; ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 2);
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(0, y + bh / 2, W, 1); // center crease

    // Label
    const bw = Math.round(bh * 2.0);
    ctx.fillStyle = "rgba(20,16,8,0.98)"; ctx.fillRect(0, y, bw, bh);
    ctx.fillStyle = accent; ctx.fillRect(bw, y, 2, bh);
    const label = (state.newsTitle || "NEWS").toUpperCase();
    ctx.fillStyle = accent; ctx.font = `700 ${Math.round(bh * 0.34)}px monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bw / 2, y + bh / 2);

    // Flap character animation: each char independently flips to its target
    const CHARS_PER_SEC = 18; // how many chars resolve per second
    const CYCLE_SECS = 12;    // full message hold before next cycle starts
    const cycleT = t % CYCLE_SECS;
    const flapChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?-/";

    const text = state.newsText.toUpperCase().slice(0, 60);
    const areaX = bw + 14; const areaW = W - areaX - 10;
    const fs = Math.round(bh * 0.40);
    ctx.font = `700 ${fs}px monospace`;
    const charW = ctx.measureText("M").width;
    const maxChars = Math.floor(areaW / (charW + 2));
    const displayText = text.slice(0, maxChars).padEnd(maxChars, " ");

    displayText.split("").forEach((targetChar, i) => {
      const resolved = cycleT * CHARS_PER_SEC > i;
      const charProgress = Math.min(1, Math.max(0, (cycleT * CHARS_PER_SEC - i)));
      const cx = areaX + i * (charW + 2);
      if (cx + charW > areaX + areaW) return;

      // Card background for each character
      ctx.fillStyle = "rgba(20,18,12,0.92)"; ctx.fillRect(cx - 1, y + 2, charW + 2, bh - 4);
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1; ctx.strokeRect(cx - 1, y + 2, charW + 2, bh - 4);

      let display: string;
      if (!resolved) {
        display = flapChars[Math.floor((Date.now() / 60 + i * 7) % flapChars.length)];
      } else if (charProgress < 1) {
        // Mid-flip: show a random char half the time (simulating flip)
        display = charProgress > 0.5 ? targetChar : flapChars[Math.floor((Date.now() / 40 + i * 3) % flapChars.length)];
      } else {
        display = targetChar;
      }

      // Flip transform
      const flipScaleY = resolved && charProgress < 1 ? Math.abs(Math.cos(charProgress * Math.PI)) : 1;
      ctx.save();
      ctx.globalAlpha *= (resolved || cycleT > 0.1 ? 1 : 0.3);
      ctx.fillStyle = resolved ? "#fff" : accent;
      ctx.font = `700 ${fs}px monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.translate(cx + charW / 2, y + bh / 2);
      ctx.scale(1, Math.max(0.05, flipScaleY));
      ctx.fillText(display, 0, 0);
      ctx.restore();
    });
  }

  /** Typewriter mode — text types in left-to-right, holds, then fades. */
  private drawTickerTypewriterMode(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(40, Math.round(H * 0.065));
    const accent = this.themeAccentColor();
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    ctx.fillStyle = "rgba(2,6,12,0.97)"; ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 2);

    // Label
    const bw = Math.round(bh * 2.0);
    ctx.fillStyle = accent; ctx.fillRect(0, y, bw, bh);
    const label = (state.newsTitle || "LIVE").toUpperCase();
    ctx.fillStyle = "rgba(2,6,12,0.97)"; ctx.font = `700 ${Math.round(bh * 0.36)}px monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bw / 2, y + bh / 2);

    const CHARS_PER_SEC = 22;
    const HOLD_SECS = 4;
    const FADE_SECS = 0.6;
    const text = state.newsText;
    const typeTime = text.length / CHARS_PER_SEC;
    const totalCycle = typeTime + HOLD_SECS + FADE_SECS;
    const cycleT = t % totalCycle;
    const areaX = bw + 14; const areaW = W - areaX - 10;
    const fs = Math.round(bh * 0.38);
    ctx.font = `600 ${fs}px monospace`;

    const visChars = Math.min(text.length, Math.floor(cycleT * CHARS_PER_SEC));
    const fadeAlpha = cycleT > typeTime + HOLD_SECS ? Math.max(0, 1 - (cycleT - typeTime - HOLD_SECS) / FADE_SECS) : 1;

    let typedText = text.slice(0, visChars);
    // Truncate to fit area
    while (typedText.length > 1 && ctx.measureText(typedText).width > areaW - 20) typedText = typedText.slice(0, -1);

    ctx.save();
    ctx.globalAlpha *= fadeAlpha;
    ctx.fillStyle = "#e2f8ff";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(typedText, areaX, y + bh / 2);

    // Blinking cursor
    const blink = cycleT < typeTime + HOLD_SECS && Math.floor(Date.now() / 520) % 2 === 0;
    if (blink) {
      const tw = ctx.measureText(typedText).width;
      ctx.fillStyle = accent;
      ctx.fillRect(areaX + tw + 3, y + bh * 0.2, 2, bh * 0.6);
    }
    ctx.restore();
  }

  /** Wave — each character bobs on a sinusoidal vertical wave. */
  private drawTickerWave(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(42, Math.round(H * 0.068));
    const accent = this.themeAccentColor();
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    ctx.fillStyle = "rgba(6,3,12,0.95)"; ctx.fillRect(0, y, W, bh);
    // Gradient top line
    const g = ctx.createLinearGradient(0, y, W, y);
    g.addColorStop(0, accent); g.addColorStop(0.5, "#06b6d4"); g.addColorStop(1, accent);
    ctx.fillStyle = g; ctx.fillRect(0, y, W, 2);

    const bw = Math.round(bh * 2.0);
    ctx.fillStyle = "rgba(6,3,12,0.98)"; ctx.fillRect(0, y, bw, bh);
    ctx.fillStyle = accent; ctx.fillRect(bw, y, 2, bh);
    const label = (state.newsTitle || "LIVE").toUpperCase();
    ctx.fillStyle = accent; ctx.font = `700 ${Math.round(bh * 0.36)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bw / 2, y + bh / 2);

    // Scroll + wave: text scrolls right-to-left while characters bob sinusoidally
    const areaX = bw + 12; const areaW = W - areaX - 8;
    const speed = this.tickerPxPerSec();
    const text = state.newsText + "   ◆   ";
    const fs = Math.round(bh * 0.36);
    ctx.font = this.ef(`600 ${fs}px sans-serif`);
    const totalW = ctx.measureText(text).width;
    const scrollDist = areaW + totalW;
    const scrollDur = scrollDist / speed;
    const cycleDur = scrollDur + (state.newsTickerLoopSecs ?? 20);
    const cycleEl = (t - this.newsScrollStartT) % cycleDur;
    if (cycleEl >= scrollDur) return; // pause phase
    const scrollX = areaX + areaW - cycleEl * speed;

    const WAVE_AMP = bh * 0.18;
    const WAVE_FREQ = 0.008;
    const WAVE_SPEED = 2.5;

    ctx.save();
    ctx.beginPath(); ctx.rect(areaX, y, areaW, bh); ctx.clip();
    let cx = scrollX;
    const baseY = y + bh / 2;
    text.split("").forEach((ch, i) => {
      ctx.font = this.ef(`600 ${fs}px sans-serif`);
      const cw = ctx.measureText(ch).width;
      if (cx + cw > areaX && cx < areaX + areaW) {
        const waveY = Math.sin(cx * WAVE_FREQ + t * WAVE_SPEED) * WAVE_AMP;
        const hue = (i * 5 + t * 30) % 360;
        const pct = (i % 8) / 8;
        ctx.fillStyle = pct < 0.5 ? "#fff" : `hsl(${hue},90%,78%)`;
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(ch, cx, baseY + waveY);
      }
      cx += cw;
    });
    ctx.restore();
  }

  /** Carousel — messages pop up one at a time, centred in the bar. */
  private drawTickerCarousel(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(44, Math.round(H * 0.070));
    const accent = this.themeAccentColor();
    const y      = yBase > 0 ? Math.min(H - bh - 6, yBase) : H - bh - 6;

    ctx.fillStyle = "rgba(4,2,8,0.96)"; ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = accent; ctx.fillRect(0, y, W, 2);
    ctx.fillStyle = "rgba(236,72,153,0.08)"; ctx.fillRect(0, y + 2, W, bh - 2);

    const bw = Math.round(bh * 2.0);
    ctx.fillStyle = accent; ctx.fillRect(0, y, bw, bh);
    const label = (state.newsTitle || "LIVE").toUpperCase();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(bh * 0.36)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bw / 2, y + bh / 2);

    const HOLD_SECS = 5;
    const TRANS_SECS = 0.4;
    const cycle = Math.floor(t / (HOLD_SECS + TRANS_SECS));
    const cyclePhase = t % (HOLD_SECS + TRANS_SECS);
    const isTransitioning = cyclePhase > HOLD_SECS;
    const transProgress = isTransitioning ? (cyclePhase - HOLD_SECS) / TRANS_SECS : 0;
    const easeP = this.easeInOut(transProgress);

    const lines = state.newsText.split(/\s{3,}|\s*[◆|·★]\s*/).filter(Boolean);
    const curIdx  = cycle % Math.max(1, lines.length);
    const nextIdx = (cycle + 1) % Math.max(1, lines.length);
    const curText  = lines[curIdx]  ?? state.newsText;
    const nextText = lines[nextIdx] ?? state.newsText;

    const areaX = bw + 10; const areaW = W - areaX - 10;
    const fs = Math.round(bh * 0.38);
    ctx.font = `600 ${fs}px sans-serif`;
    const slideY = easeP * (bh + 4);

    const drawCarouselText = (txt: string, offY: number, alpha: number) => {
      let s = txt;
      ctx.font = `600 ${fs}px sans-serif`;
      while (ctx.measureText(s).width > areaW && s.length > 4) s = s.slice(0, -4) + "…";
      ctx.save();
      ctx.beginPath(); ctx.rect(areaX, y, areaW, bh); ctx.clip();
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(s, areaX, y + bh / 2 + offY);
      ctx.restore();
    };

    if (isTransitioning) {
      drawCarouselText(curText,  -slideY, 1 - easeP);
      drawCarouselText(nextText, bh - slideY, easeP);
    } else {
      drawCarouselText(curText, 0, 1);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── END TICKER PRESENTATION MODES ────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  private drawBreaking(yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(52, Math.round(H * 0.076));
    const r      = Math.round(bh * 0.28);
    const accent = state.newsBgColor || "#e5000a";

    const badgeW  = Math.round(W * (this.isVertical ? 0.30 : 0.16));
    const cardGap = 8;
    const cardX   = cardGap;
    const cardW   = W - cardGap * 2;
    const y       = yBase > 0 ? Math.min(H - bh - 8, yBase) : H - bh - 8;

    // ── Outer card with rounded corners ──────────────────────────────────
    this.roundRect(cardX, y, cardW, bh, r);
    ctx.fillStyle = "rgba(8,8,16,0.95)";
    ctx.fill();

    // Subtle outer glow stroke
    this.roundRect(cardX, y, cardW, bh, r);
    ctx.strokeStyle = `${accent}44`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // ── Left accent badge (rounded on both sides) ─────────────────────────
    const badgeX = cardX + 6;
    const badgeH = bh - 12;
    const badgeY = y + 6;
    this.roundRect(badgeX, badgeY, badgeW, badgeH, Math.round(badgeH * 0.3));
    const badgeG = ctx.createLinearGradient(badgeX, badgeY, badgeX, badgeY + badgeH);
    badgeG.addColorStop(0, accent);
    badgeG.addColorStop(1, `${accent}cc`);
    ctx.fillStyle = badgeG;
    ctx.fill();

    // Badge label
    const badgeLabel = (state.newsTitle || "BREAKING").toUpperCase().slice(0, 12);
    ctx.fillStyle    = "#fff";
    ctx.font         = `900 ${Math.round(badgeH * 0.30)}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = "rgba(0,0,0,0.5)";
    ctx.shadowBlur   = 4;
    ctx.fillText(badgeLabel, badgeX + badgeW / 2, badgeY + badgeH / 2);
    ctx.shadowBlur   = 0;

    // ── Separator line ─────────────────────────────────────────────────────
    const sepX = badgeX + badgeW + 8;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(sepX, y + bh * 0.15, 1, bh * 0.70);

    // ── Main news text ─────────────────────────────────────────────────────
    const textX  = sepX + 14;
    const maxTW  = cardX + cardW - textX - 12;
    const font   = `bold ${Math.round(bh * 0.31)}px sans-serif`;
    ctx.font     = font;
    let txt      = state.newsText;
    while (txt.length > 4 && ctx.measureText(txt).width > maxTW) txt = txt.slice(0, -4) + "…";
    this.drawAnimText(txt, textX, y + bh / 2, font, "rgba(240,240,240,0.97)", state.newsAnimation, this._newsAnimProg);
  }

  private drawLowerThird(xBase: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const accent  = state.newsBgColor || "#e5000a";
    const bw      = Math.round(W * (this.isVertical ? 0.90 : 0.62));
    const titleH  = Math.max(24, Math.round(H * 0.042));
    const mainH   = Math.max(36, Math.round(H * 0.064));
    const totalH  = titleH + mainH;
    const r       = Math.round(titleH * 0.38);
    const x       = xBase || 0;
    const y       = yBase > 0 ? Math.min(H - totalH - 8, yBase) : H - totalH - Math.round(H * 0.055);

    // ── Title row (accent color, rounded top corners only) ───────────────
    ctx.save();
    this.roundRect(x, y, bw, titleH + r, r);
    ctx.clip();
    const tg = ctx.createLinearGradient(x, y, x + bw, y);
    tg.addColorStop(0, accent);
    tg.addColorStop(1, `${accent}cc`);
    ctx.fillStyle = tg;
    ctx.fillRect(x, y, bw, titleH + r);
    ctx.restore();

    ctx.fillStyle    = "#fff";
    ctx.font         = `900 ${Math.round(titleH * 0.50)}px sans-serif`;
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = "rgba(0,0,0,0.35)";
    ctx.shadowBlur   = 3;
    const titleStr   = (state.newsTitle || "LIVE UPDATE").toUpperCase();
    ctx.fillText(titleStr, x + 12, y + titleH / 2);
    ctx.shadowBlur   = 0;

    // ── Main row (dark glass, rounded bottom + overlapping top clip) ──────
    ctx.save();
    this.roundRect(x, y + titleH, bw, mainH + r, r);
    ctx.clip();
    ctx.fillStyle = "rgba(8,8,18,0.96)";
    ctx.fillRect(x, y + titleH, bw, mainH + r);

    // Left accent stripe inside main bar
    ctx.fillStyle = accent;
    ctx.fillRect(x, y + titleH, 4, mainH + r);
    ctx.restore();

    // Main text (clip to visible mainH, not the overlapping r)
    const mainFont = `bold ${Math.round(mainH * 0.36)}px sans-serif`;
    this.clipRoundRect(x + 4, y + titleH, bw - 4, mainH, r - 2, () => {
      this.drawAnimText(state.newsText, x + 18, y + titleH + mainH / 2, mainFont, "rgba(240,240,240,0.97)", state.newsAnimation, this._newsAnimProg);
    });
  }

  private drawSpotlight() {
    const { ctx, W, H, state } = this;
    const accent = state.newsBgColor || "#e5000a";

    // Cinematic vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.65);
    vg.addColorStop(0, "rgba(0,0,0,0.28)");
    vg.addColorStop(1, "rgba(0,0,0,0.84)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Wrap text into lines
    const fs    = Math.round(Math.min(W, H) * 0.054);
    const font  = `bold ${fs}px sans-serif`;
    ctx.font    = font;
    const maxTW = W * 0.70;
    const words = state.newsText.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(test).width > maxTW) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);

    const lh     = fs * 1.40;
    const cardW  = Math.round(W * (this.isVertical ? 0.85 : 0.72));
    const cardH  = Math.round(lh * lines.length + fs * 2.2);
    const cardX  = Math.round((W - cardW) / 2);
    const cardY  = Math.round(H / 2 - cardH / 2);
    const cardR  = Math.round(cardH * 0.12);

    // Frosted card background
    this.roundRect(cardX, cardY, cardW, cardH, cardR);
    ctx.fillStyle = "rgba(6,6,18,0.82)";
    ctx.fill();

    // Accent border stroke
    this.roundRect(cardX, cardY, cardW, cardH, cardR);
    ctx.strokeStyle = `${accent}66`;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Top accent strip (clipped to card top edge)
    this.clipRoundRect(cardX, cardY, cardW, 4, 2, () => {
      const sg = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
      sg.addColorStop(0, accent); sg.addColorStop(1, `${accent}55`);
      ctx.fillStyle = sg;
      ctx.fillRect(cardX, cardY, cardW, 4);
    });

    // Text lines
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    const startY     = cardY + cardH / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => {
      this.drawAnimText(l, W / 2, startY + i * lh, font, "#fff", state.newsAnimation, this._newsAnimProg);
    });
  }

  /** Floating centered alert card */
  private drawNewsPopup() {
    const { ctx, W, H, state } = this;
    const accent  = state.newsBgColor || "#667eea";
    const bw      = Math.round(W * (this.isVertical ? 0.88 : 0.62));
    const bh      = Math.round(H * 0.13);
    const bx      = Math.round((W - bw) / 2);
    const by      = Math.round(H * 0.40);
    const r       = Math.round(bh * 0.22);

    // Outer glow ring
    ctx.shadowColor = `${accent}66`;
    ctx.shadowBlur  = 22;
    this.roundRect(bx, by, bw, bh, r);
    ctx.fillStyle = "transparent";
    ctx.fill();
    ctx.shadowBlur = 0;

    // Main card
    this.roundRect(bx, by, bw, bh, r);
    const bg = ctx.createLinearGradient(bx, by, bx, by + bh);
    bg.addColorStop(0, "rgba(12,10,44,0.97)");
    bg.addColorStop(1, "rgba(24,18,68,0.94)");
    ctx.fillStyle = bg;
    ctx.fill();

    // Gradient border stroke
    this.roundRect(bx, by, bw, bh, r);
    const borderG = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    borderG.addColorStop(0, `${accent}cc`);
    borderG.addColorStop(0.5, "#a78bfa88");
    borderG.addColorStop(1, `${accent}44`);
    ctx.strokeStyle = borderG;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Top accent bar
    this.clipRoundRect(bx, by, bw, 4, 2, () => {
      const tg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      tg.addColorStop(0, accent); tg.addColorStop(1, "#a78bfa");
      ctx.fillStyle = tg;
      ctx.fillRect(bx, by, bw, 4);
    });

    // Centered text
    const font = `bold ${Math.round(bh * 0.33)}px sans-serif`;
    ctx.font         = font;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    let txt          = state.newsText;
    while (txt.length > 4 && ctx.measureText(txt).width > bw - 32) txt = txt.slice(0, -4) + "…";
    this.drawAnimText(txt, bx + bw / 2, by + bh / 2 + 2, font, "#fff", state.newsAnimation, this._newsAnimProg);
  }

  /** Gradient scroll banner — visually distinct, full-width gradient band */
  private drawScrollBanner(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh     = Math.max(42, Math.round(H * 0.065));
    const r      = Math.round(bh * 0.26);
    const y      = yBase > 0 ? Math.min(H - bh, yBase) : H - bh;
    const accent = state.newsBgColor || "#667eea";

    // Full-width gradient band
    this.clipRoundRect(0, y, W, bh, 0, () => {
      const g = ctx.createLinearGradient(0, y, W, y + bh);
      g.addColorStop(0,   `${accent}f0`);
      g.addColorStop(0.4, "rgba(118,75,162,0.92)");
      g.addColorStop(1,   "rgba(200,80,192,0.90)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, bh);
    });

    // Rounded pill badge on left
    const badgeW = Math.round(W * (this.isVertical ? 0.22 : 0.10));
    const badgeX = 8;
    const badgeH = bh - 10;
    const badgeY = y + 5;
    this.roundRect(badgeX, badgeY, badgeW, badgeH, Math.round(badgeH * 0.40));
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.fill();

    ctx.fillStyle    = "#fff";
    ctx.font         = `900 ${Math.round(badgeH * 0.36)}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✦ LIVE", badgeX + badgeW / 2, badgeY + badgeH / 2);

    // Seamlessly scrolling text
    const textX = badgeX + badgeW + 14;
    const textW = W - textX - 8;
    const fs    = Math.round(bh * 0.34);
    this.drawScrollText(textX, y + 2, textW, bh - 4, Math.max(0, r - 2),
      y + bh / 2, state.newsText, `bold ${fs}px sans-serif`,
      "rgba(255,255,255,0.95)", t, this.newsScrollStartT);
  }

  // ── ADS ────────────────────────────────────────────────────────────────────

  private drawAd() {
    const { state } = this;
    const effPos = this.pos(state.adPosition, state.mobileAdPosition);
    const y = this.px(effPos.y, this.H);
    const bh = Math.max(44, Math.round(this.H * 0.068));
    switch (state.adStyle) {
      case "Corner Pop":  return this.drawCornerAd();
      case "Fullscreen":
      case "Card":        return this.drawFullscreenAd();
      case "Strip":       return this.drawStripAd(y, bh);
      default:            return this.drawBannerAd(y, bh);
    }
  }

  private drawBannerAd(y: number, bh: number) {
    const { ctx, W, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#667eea"); g.addColorStop(0.5, "#764ba2"); g.addColorStop(1, "#c850c0");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, bh);
    const bw = Math.round(W * 0.09);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(10, y + bh * 0.2, bw, bh * 0.6);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.27)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SPONSORED", 14, y + bh / 2);
    ctx.font = `bold ${Math.round(bh * 0.33)}px sans-serif`;
    ctx.fillText(state.adText, bw + 24, y + bh * 0.36);
    ctx.font = `${Math.round(bh * 0.24)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(state.adSub, bw + 24, y + bh * 0.66);
  }

  private drawStripAd(y: number, bh: number) {
    const { ctx, W, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#38ef7d"); g.addColorStop(1, "#11998e");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.35)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.adText, W / 2, y + bh / 2);
  }

  private drawCornerAd() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.adPosition, state.mobileAdPosition);
    const bw = Math.round(W * 0.24);
    const bh = Math.round(bw * 0.55);
    const x = this.px(effPos.x, W) || (W - bw - 16);
    const y = this.px(effPos.y, H) || 70;
    ctx.fillStyle = "rgba(246,211,101,0.93)";
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.3)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(state.adText, x + 10, y + 8);
    ctx.font = `${Math.round(bh * 0.22)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Limited time only", x + 10, y + bh * 0.5);
  }

  private drawFullscreenAd() {
    const { ctx, W, H, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0f0c29"); g.addColorStop(0.5, "#302b63"); g.addColorStop(1, "#24243e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.052);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.adText, W / 2, H * 0.44);
    ctx.font = `${Math.round(fs * 0.65)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(state.adSub, W / 2, H * 0.57);
  }

  // ── BREAK SCREEN ───────────────────────────────────────────────────────────

  private drawBreak(t: number) {
    switch (this.state.breakStyle) {
      case "Video":
      case "Video Play": return; // fully transparent — break video shows through
      case "Neon":     return this.drawNeonBreak(t);
      case "Glass":    return this.drawGlassBreak(t);
      case "Wave":     return this.drawWaveBreak(t);
      case "Minimal":  return this.drawMinimalBreak(t);
      case "Gradient": return this.drawGradientBreak(t);
      default:         return this.drawCountdownBreak(t);
    }
  }

  private countdown(t: number): string {
    const s = Math.max(0, 300 - Math.floor(t));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  }

  private drawCountdownBreak(t: number) {
    const { ctx, W, H, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0f0c29"); g.addColorStop(1, "#302b63");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.font = `${Math.round(fs * 0.24)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
    const bw = W * 0.5, bx = (W - bw) / 2, by = H * 0.7;
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(bx, by, bw, 4);
    const g2 = ctx.createLinearGradient(bx, by, bx + bw, by);
    g2.addColorStop(0, "#667eea"); g2.addColorStop(1, "#a78bfa");
    ctx.fillStyle = g2;
    ctx.fillRect(bx, by, bw * Math.max(0, 300 - Math.floor(t)) / 300, 4);
  }

  private drawNeonBreak(t: number) {
    const { ctx, W, H, state } = this;
    ctx.fillStyle = "#04040c"; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#00fff0"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "#00fff0"; ctx.shadowBlur = 20;
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.round(fs * 0.22)}px sans-serif`;
    ctx.fillStyle = "rgba(0,255,240,0.65)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
  }

  private drawGlassBreak(t: number) {
    const { ctx, W, H, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#4158d0"); g.addColorStop(0.46, "#c850c0"); g.addColorStop(1, "#ffcc70");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const bw = W * 0.55, bh = H * 0.38, bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.fillStyle = "rgba(0,0,0,0.52)"; ctx.fillRect(bx, by, bw, bh);
    const fs = Math.round(Math.min(W, H) * 0.09);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.font = `${Math.round(fs * 0.27)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
  }

  private drawWaveBreak(t: number) {
    const { ctx, W, H, state } = this;
    ctx.fillStyle = "#0f2027"; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.font = `${Math.round(fs * 0.23)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
  }

  private drawMinimalBreak(t: number) {
    const { ctx, W, H, state } = this;
    ctx.fillStyle = "#0a0a12"; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H / 2);
    ctx.font = `${Math.round(fs * 0.23)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(state.breakText, W / 2, H / 2 + fs * 0.85);
  }

  private drawGradientBreak(t: number) {
    const { ctx, W, H, state } = this;
    // Animated gradient: shift hue over time
    const cycle = (Math.sin(t * 0.4) + 1) / 2; // 0-1 oscillating
    const r1 = Math.round(102 + cycle * 80),  g1 = 126,  b1 = Math.round(234 - cycle * 60);
    const r2 = Math.round(240 - cycle * 80), g2 = Math.round(147 + cycle * 40), b2 = 251;
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, `rgb(${r1},${g1},${b1})`);
    grad.addColorStop(0.5, `rgb(${Math.round((r1+r2)/2)},${Math.round((g1+g2)/2)},${Math.round((b1+b2)/2)})`);
    grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Rotating light sweep
    const sweep = ctx.createRadialGradient(
      W * (0.3 + 0.4 * Math.cos(t * 0.3)), H * 0.4, 0,
      W * (0.3 + 0.4 * Math.cos(t * 0.3)), H * 0.4, W * 0.7,
    );
    sweep.addColorStop(0, "rgba(255,255,255,0.18)");
    sweep.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, W, H);

    // Text
    const fs = Math.round(Math.min(W, H) * 0.092);
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#fff"; ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.44);
    ctx.shadowBlur = 0;

    ctx.font = `${Math.round(fs * 0.26)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);

    // Pill badge
    const bw = Math.min(W * 0.4, 260), bh = fs * 0.55, bx = (W - bw) / 2, by = H * 0.70;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    const r = bh / 2;
    ctx.beginPath();
    ctx.moveTo(bx + r, by); ctx.lineTo(bx + bw - r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.lineTo(bx + bw - r, by + bh); ctx.lineTo(bx + r, by + bh);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(fs * 0.22)}px sans-serif`;
    ctx.fillText("Be right back!", W / 2, by + bh / 2);
  }

  // ── QR Code overlay ──────────────────────────────────────────────────────

  private getQrMatrix(url: string): boolean[][] | null {
    if (!url) return null;
    if (url === this.cachedQrUrl && this.qrMatrix) return this.qrMatrix;
    try {
      const data = QRCode.create(url, { errorCorrectionLevel: "M" });
      const size = data.modules.size;
      const matrix: boolean[][] = [];
      for (let r = 0; r < size; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < size; c++) {
          row.push(!!data.modules.get(r, c));
        }
        matrix.push(row);
      }
      this.cachedQrUrl = url;
      this.qrMatrix = matrix;
      return matrix;
    } catch {
      return null;
    }
  }

  private strokeRoundRect(
    x: number, y: number, w: number, h: number, r: number,
    color: string, lineWidth: number,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.stroke();
  }

  private fillRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }

  private fillTopRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }

  private fillBottomRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }

  private drawQR(): void {
    const { ctx, W, H, state } = this;
    if (!state.qrUrl) return;

    const t      = this.elapsed();
    const size   = state.qrSize ?? 160;
    const pos    = state.qrPosition ?? { x: 88, y: 10 };
    const cx     = this.px(pos.x, W);
    const cy     = this.px(pos.y, H);
    const bob    = Math.sin(t * 1.1) * 2.5;

    // ── Thank-you mode: donor just paid — show for 10 s ─────────────────────
    const THANK_DUR_MS = 10_000;
    const thankAge = (state.qrThankYouActive && state.qrThankYouTs)
      ? (Date.now() - state.qrThankYouTs) : Infinity;
    if (thankAge < THANK_DUR_MS && state.qrThankYouName) {
      this.drawQRThankYou(cx, cy + bob, size, state.qrThankYouName, thankAge, THANK_DUR_MS, state.thankYouStyle ?? "Classic");
      return;
    }

    // ── Normal QR mode ────────────────────────────────────────────────────────
    const matrix = this.getQrMatrix(state.qrUrl);
    if (!matrix) return;

    const n        = matrix.length;
    const cellSize = size / n;
    const pad      = Math.max(8, Math.round(size * 0.055));
    const labelH   = Math.round(size * 0.24);
    const footerH  = Math.round(size * 0.18);  // scan-count footer
    const cornerR  = Math.round(size * 0.09);
    const totalW   = size + pad * 2;
    const totalH   = labelH + size + pad * 2 + footerH;

    ctx.save();
    ctx.translate(cx, cy + bob);

    const left = -Math.round(totalW / 2);
    const top  = -Math.round(totalH / 2);

    // Drop shadow
    ctx.shadowColor   = "rgba(0,0,0,0.45)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetY = 5;

    // Orange card (full background)
    ctx.fillStyle = "#FF813F";
    this.fillRoundRect(left, top, totalW, totalH, cornerR);

    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetY = 0;

    // Header tint
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    this.fillTopRoundRect(left, top, totalW, labelH, cornerR);

    // Header text
    const labelText = (state.qrTitle && state.qrTitle.trim())
      ? state.qrTitle.trim() : "SUPER CHAT";
    const labelFS = Math.max(11, Math.round(labelH * 0.33));
    ctx.fillStyle    = "#fff";
    ctx.font         = `800 ${labelFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, 0, top + Math.round(labelH / 2));

    // White QR panel (plain rect between header and footer)
    const qrPanelTop = top + labelH;
    const qrPanelH   = size + pad * 2;
    ctx.fillStyle = "#fff";
    ctx.fillRect(left + 2, qrPanelTop, totalW - 4, qrPanelH);

    // QR cells
    ctx.fillStyle = "#1a1a1a";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          const cellX = left + 2 + pad + Math.round(c * cellSize);
          const cellY = qrPanelTop + pad + Math.round(r * cellSize);
          const cs    = Math.max(1, Math.ceil(cellSize));
          ctx.fillRect(cellX, cellY, cs, cs);
        }
      }
    }

    // Subtle divider above footer
    const footerTop = qrPanelTop + qrPanelH;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(left + pad, footerTop, totalW - pad * 2, 1);

    // Scan count footer (on orange background from fillRoundRect)
    const scanCount = state.qrScanCount ?? 0;
    const scanLabel = scanCount === 0
      ? "Scan to donate"
      : scanCount === 1 ? "1 Scan \u2713" : `${scanCount.toLocaleString()} Scans \u2713`;
    const footerFS  = Math.max(9, Math.round(footerH * 0.42));
    ctx.fillStyle   = "#fff";
    ctx.font        = `700 ${footerFS}px sans-serif`;
    ctx.textAlign   = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scanLabel, 0, footerTop + footerH / 2);

    ctx.restore();
  }

  private drawQRThankYou(
    cx: number, cy: number, size: number,
    name: string, ageMs: number, durMs: number,
    style = "Classic",
  ): void {
    const { ctx } = this;
    const FADE_IN_MS  = 350;
    const FADE_OUT_MS = 800;
    const fadeIn  = Math.min(1, ageMs / FADE_IN_MS);
    const fadeOut = ageMs > durMs - FADE_OUT_MS
      ? Math.max(0, 1 - (ageMs - (durMs - FADE_OUT_MS)) / FADE_OUT_MS) : 1;
    const alpha  = fadeIn * fadeOut;
    const scaleV = 0.82 + 0.18 * this.easeElastic(Math.min(1, ageMs / 420));

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(cx, cy);
    ctx.scale(scaleV, scaleV);

    if (style === "Neon") {
      this._drawThankYouNeon(size, name, ageMs);
    } else if (style === "Gold") {
      this._drawThankYouGold(size, name);
    } else if (style === "Celebration") {
      this._drawThankYouCelebration(size, name, ageMs);
    } else {
      this._drawThankYouClassic(size, name);
    }

    ctx.restore();
  }

  private _thankYouCard(cardW: number, cardH: number, cornerR: number, bgStyle: string) {
    const { ctx } = this;
    const left = -Math.round(cardW / 2);
    const top  = -Math.round(cardH / 2);
    ctx.shadowColor   = "rgba(0,0,0,0.6)";
    ctx.shadowBlur    = 32;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = bgStyle;
    this.fillRoundRect(left, top, cardW, cardH, cornerR);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    return { left, top };
  }

  private _drawThankYouClassic(size: number, name: string) {
    const { ctx } = this;
    const cardW = Math.round(size * 1.5);
    const cardH = Math.round(size * 0.90);
    const cornerR = Math.round(cardH * 0.09);
    const { left, top } = this._thankYouCard(cardW, cardH, cornerR, "#021a07");

    // Top stripe
    ctx.fillStyle = "#22c55e";
    this.fillTopRoundRect(left, top, cardW, Math.round(cardH * 0.055), cornerR);

    // Checkmark circle
    const circleR = Math.round(cardH * 0.17);
    const circleY = top + Math.round(cardH * 0.30);
    ctx.beginPath(); ctx.arc(0, circleY, circleR, 0, Math.PI * 2);
    ctx.fillStyle = "#22c55e"; ctx.fill();
    const ck = circleR * 0.48;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, circleR * 0.18);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-ck * 0.55, circleY); ctx.lineTo(-ck * 0.08, circleY + ck * 0.58); ctx.lineTo(ck * 0.62, circleY - ck * 0.52);
    ctx.stroke();

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const subFS = Math.round(cardH * 0.11);
    ctx.fillStyle = "#22c55e"; ctx.font = `700 ${subFS}px sans-serif`;
    ctx.fillText("Payment Received!", 0, top + Math.round(cardH * 0.60));
    const nameFS = Math.round(cardH * 0.16);
    ctx.fillStyle = "#fff"; ctx.font = `800 ${nameFS}px sans-serif`;
    let dn = name;
    while (dn.length > 4 && ctx.measureText(`Thank you, ${dn}!`).width > cardW - 28) dn = dn.slice(0, -3) + "…";
    ctx.fillText(`Thank you, ${dn}!`, 0, top + Math.round(cardH * 0.77));
    ctx.font = `${Math.round(nameFS * 0.8)}px sans-serif`;
    ctx.fillText("💚", 0, top + Math.round(cardH * 0.91));
  }

  private _drawThankYouNeon(size: number, name: string, ageMs: number) {
    const { ctx } = this;
    const cardW = Math.round(size * 1.6);
    const cardH = Math.round(size * 0.92);
    const cornerR = Math.round(cardH * 0.10);
    const { left, top } = this._thankYouCard(cardW, cardH, cornerR, "#030a1a");

    // Animated neon border (glow pulse)
    const pulse = 0.6 + 0.4 * Math.sin(ageMs / 400);
    ctx.shadowColor = `rgba(0,210,255,${0.7 * pulse})`;
    ctx.shadowBlur = Math.round(18 * pulse);
    ctx.strokeStyle = `rgba(0,210,255,${0.85 * pulse})`;
    ctx.lineWidth = 2.5;
    this.strokeRR(left, top, cardW, cardH, cornerR);
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";

    // Cyan lightning bolt icon
    const iconY = top + Math.round(cardH * 0.28);
    const iconFS = Math.round(cardH * 0.28);
    ctx.font = `${iconFS}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("⚡", 0, iconY);

    // "Payment Received!" in neon cyan
    const subFS = Math.round(cardH * 0.11);
    ctx.shadowColor = "rgba(0,210,255,0.8)"; ctx.shadowBlur = 8;
    ctx.fillStyle = "#00d2ff"; ctx.font = `700 ${subFS}px sans-serif`;
    ctx.fillText("PAYMENT RECEIVED", 0, top + Math.round(cardH * 0.58));
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";

    // Name text
    const nameFS = Math.round(cardH * 0.155);
    ctx.fillStyle = "#ffffff"; ctx.font = `800 ${nameFS}px sans-serif`;
    let dn = name;
    while (dn.length > 4 && ctx.measureText(`Thank you, ${dn}!`).width > cardW - 28) dn = dn.slice(0, -3) + "…";
    ctx.fillText(`Thank you, ${dn}!`, 0, top + Math.round(cardH * 0.76));

    // Bottom neon accent line
    const lineY = top + Math.round(cardH * 0.91);
    const grd = ctx.createLinearGradient(left, 0, left + cardW, 0);
    grd.addColorStop(0, "transparent"); grd.addColorStop(0.5, "#00d2ff"); grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.fillRect(left + Math.round(cardW * 0.1), lineY, Math.round(cardW * 0.8), 2);
  }

  private _drawThankYouGold(size: number, name: string) {
    const { ctx } = this;
    const cardW = Math.round(size * 1.55);
    const cardH = Math.round(size * 0.92);
    const cornerR = Math.round(cardH * 0.09);
    const { left, top } = this._thankYouCard(cardW, cardH, cornerR, "#0d0a00");

    // Gold gradient overlay
    const grd = ctx.createLinearGradient(left, top, left + cardW, top + cardH);
    grd.addColorStop(0, "rgba(251,191,36,0.18)");
    grd.addColorStop(0.5, "rgba(253,224,71,0.08)");
    grd.addColorStop(1, "rgba(217,119,6,0.20)");
    ctx.fillStyle = grd; this.fillRoundRect(left, top, cardW, cardH, cornerR);

    // Gold border
    ctx.strokeStyle = "rgba(251,191,36,0.65)"; ctx.lineWidth = 2;
    this.strokeRR(left, top, cardW, cardH, cornerR);

    // Trophy icon
    const iconY = top + Math.round(cardH * 0.26);
    ctx.font = `${Math.round(cardH * 0.30)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🏆", 0, iconY);

    // "PAYMENT RECEIVED" in gold
    const subFS = Math.round(cardH * 0.105);
    ctx.shadowColor = "rgba(253,224,71,0.7)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "#fbbf24"; ctx.font = `700 ${subFS}px sans-serif`;
    ctx.fillText("PAYMENT RECEIVED", 0, top + Math.round(cardH * 0.58));
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";

    // Name text
    const nameFS = Math.round(cardH * 0.155);
    ctx.fillStyle = "#fef3c7"; ctx.font = `800 ${nameFS}px sans-serif`;
    let dn = name;
    while (dn.length > 4 && ctx.measureText(`Thank you, ${dn}!`).width > cardW - 28) dn = dn.slice(0, -3) + "…";
    ctx.fillText(`Thank you, ${dn}!`, 0, top + Math.round(cardH * 0.77));

    // Stars row
    ctx.font = `${Math.round(cardH * 0.10)}px sans-serif`;
    ctx.fillText("✦  ✦  ✦", 0, top + Math.round(cardH * 0.91));
  }

  private _drawThankYouCelebration(size: number, name: string, ageMs: number) {
    const { ctx } = this;
    const cardW = Math.round(size * 1.6);
    const cardH = Math.round(size * 0.95);
    const cornerR = Math.round(cardH * 0.09);
    const { left, top } = this._thankYouCard(cardW, cardH, cornerR, "#0d0118");

    // Vivid gradient fill
    const grd = ctx.createLinearGradient(left, top, left + cardW, top + cardH);
    grd.addColorStop(0, "rgba(168,85,247,0.35)");
    grd.addColorStop(0.5, "rgba(236,72,153,0.22)");
    grd.addColorStop(1, "rgba(99,102,241,0.30)");
    ctx.fillStyle = grd; this.fillRoundRect(left, top, cardW, cardH, cornerR);

    // Gradient border
    const borderGrd = ctx.createLinearGradient(left, top, left + cardW, top);
    borderGrd.addColorStop(0, "#a855f7"); borderGrd.addColorStop(0.5, "#ec4899"); borderGrd.addColorStop(1, "#6366f1");
    ctx.strokeStyle = borderGrd; ctx.lineWidth = 2.5;
    this.strokeRR(left, top, cardW, cardH, cornerR);

    // Sparkle particles (static based on known positions)
    const sparks = [
      { x: left + cardW * 0.1, y: top + cardH * 0.15, s: 0.8 },
      { x: left + cardW * 0.88, y: top + cardH * 0.12, s: 1.0 },
      { x: left + cardW * 0.05, y: top + cardH * 0.75, s: 0.7 },
      { x: left + cardW * 0.93, y: top + cardH * 0.72, s: 0.9 },
    ];
    ctx.font = `${Math.round(cardH * 0.10)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const twinkle = 0.5 + 0.5 * Math.sin(ageMs / 300);
    for (const sp of sparks) {
      ctx.globalAlpha = (0.5 + 0.5 * twinkle) * this._panelAlpha;
      ctx.fillText("✦", sp.x, sp.y);
    }
    ctx.globalAlpha = this._panelAlpha;

    // Party popper icon
    const iconY = top + Math.round(cardH * 0.25);
    ctx.font = `${Math.round(cardH * 0.28)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🎉", 0, iconY);

    // "THANK YOU" in vivid gradient text (approximate with bright pink)
    const subFS = Math.round(cardH * 0.11);
    ctx.shadowColor = "rgba(236,72,153,0.8)"; ctx.shadowBlur = 10;
    ctx.fillStyle = "#f0abfc"; ctx.font = `700 ${subFS}px sans-serif`;
    ctx.fillText("PAYMENT RECEIVED!", 0, top + Math.round(cardH * 0.57));
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";

    // Name text
    const nameFS = Math.round(cardH * 0.155);
    ctx.fillStyle = "#ffffff"; ctx.font = `800 ${nameFS}px sans-serif`;
    let dn = name;
    while (dn.length > 4 && ctx.measureText(`Thank you, ${dn}!`).width > cardW - 28) dn = dn.slice(0, -3) + "…";
    ctx.fillText(`Thank you, ${dn}!`, 0, top + Math.round(cardH * 0.76));

    // Confetti row
    ctx.font = `${Math.round(cardH * 0.11)}px sans-serif`;
    ctx.fillText("🎊  🎊  🎊", 0, top + Math.round(cardH * 0.91));
  }

  private drawFeaturedComment() {
    const { ctx, W, H, state } = this;
    if (!state.featuredComment) return;
    const msg = state.featuredComment;

    const isV = H > W;
    const cardW  = Math.round(W * (isV ? 0.90 : 0.60));
    const baseFS = Math.round(H * (isV ? 0.030 : 0.038));
    const nameFS = Math.round(baseFS * 0.80);
    const tagFS  = Math.round(baseFS * 0.62);
    const padH   = Math.round(baseFS * 1.1);
    const padV   = Math.round(baseFS * 0.7);
    const accentW = Math.round(baseFS * 0.28);
    const labelH  = Math.round(tagFS * 1.6);
    const contentH = padV + nameFS + Math.round(baseFS * 0.2) + baseFS + padV;
    const cardH    = labelH + contentH;

    const x = Math.round(W * (isV ? 0.05 : 0.03));
    const y = Math.round(H * (isV ? 0.72 : 0.75));

    const accentColor = msg.color || "#ff2244";

    ctx.save();

    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;

    // Main card background
    ctx.fillStyle = "rgba(8, 8, 18, 0.92)";
    const r = Math.round(baseFS * 0.55);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + cardW - r, y);
    ctx.quadraticCurveTo(x + cardW, y, x + cardW, y + r);
    ctx.lineTo(x + cardW, y + cardH - r);
    ctx.quadraticCurveTo(x + cardW, y + cardH, x + cardW - r, y + cardH);
    ctx.lineTo(x + r, y + cardH);
    ctx.quadraticCurveTo(x, y + cardH, x, y + cardH - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    // Top label bar
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + cardW - r, y);
    ctx.quadraticCurveTo(x + cardW, y, x + cardW, y + r);
    ctx.lineTo(x + cardW, y + labelH);
    ctx.lineTo(x, y + labelH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    // Label text: "💬 Featured Comment"
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${tagFS}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("💬  Featured Comment", x + padH, y + labelH / 2);

    // Left accent bar (content area)
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y + labelH, accentW, contentH);

    // Author name
    ctx.font = `bold ${nameFS}px sans-serif`;
    ctx.fillStyle = accentColor;
    ctx.textBaseline = "top";
    ctx.fillText(msg.name, x + accentW + padH, y + labelH + padV);

    // Message text — wrap to card width
    const maxTW = cardW - accentW - padH * 2;
    ctx.font = `${baseFS}px sans-serif`;
    ctx.fillStyle = "#f0f0f0";
    let txt = msg.text;
    while (txt.length > 4 && ctx.measureText(txt).width > maxTW) {
      txt = txt.slice(0, -4) + "…";
    }
    ctx.fillText(txt, x + accentW + padH, y + labelH + padV + nameFS + Math.round(baseFS * 0.2));

    ctx.restore();
  }

  // ── GIFT ALERT SYSTEM (TikTok-style) ────────────────────────────────────────

  private async ensureLogoImg(): Promise<void> {
    const src = this.state.logoUrl;
    if (!src || src === this.logoImgSrc) return;
    try {
      const { loadImage } = await import("@napi-rs/canvas");
      this.logoImg = await loadImage(src);
      this.logoImgSrc = src;
    } catch {
      this.logoImg = null;
    }
  }

  /** Logo background plate — drawn behind the image when logoBgEnabled is on. */
  private drawLogoBg(x: number, y: number, w: number, h: number, shape: OverlayState["logoBgShape"], color: string): void {
    const { ctx } = this;
    const padX = w * 0.18;
    const padY = h * 0.18;
    const bx = x - padX, by = y - padY, bw = w + padX * 2, bh = h + padY * 2;
    ctx.save();
    ctx.fillStyle = color;
    if (shape === "circle") {
      const r = Math.max(bw, bh) / 2;
      const cx = bx + bw / 2, cy = by + bh / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === "square") {
      ctx.fillRect(bx, by, bw, bh);
    } else {
      // rounded (default)
      this.roundRect(bx, by, bw, bh, Math.min(bw, bh) * 0.16);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawLogo(): void {
    const { ctx, W, H, state } = this;
    if (!state.logoActive || !state.logoUrl) return;
    // Load logo image asynchronously (fire-and-forget, shows on next frame)
    void this.ensureLogoImg();
    const img = this.logoImg;
    if (!img || !img.width || !img.height) return;
    const targetH = (state.logoSize ?? 120) * (H / 1080);
    const targetW = (img.width / img.height) * targetH;
    const x = (state.logoX ?? 85) / 100 * W;
    const y = (state.logoY ?? 3) / 100 * H;
    const opacity = (state.logoOpacity ?? 100) / 100;
    const cx = x, cy = y + targetH / 2; // anchor used for scale/rotate transforms

    // ── Play → pause → replay animation ─────────────────────────────────────
    // Each animation plays through once over a fixed, professional-feeling
    // duration (ANIM_DUR), always starting and ending at the logo's resting
    // state, then holds at rest for `logoAnimGap` seconds before playing
    // again. `dt` is seconds since the logo was (re)activated and grows
    // without bound; `phase` is where we are within the current play+pause
    // cycle, so the whole thing repeats indefinitely.
    const t = this.elapsed();
    const dt = Math.max(0, t - this.logoAnimStartT);
    const anim = state.logoAnimation || "Fade";
    const actionDur = ANIM_DUR; // fixed length of a single play-through
    const gap = Math.max(0, Math.min(60, state.logoAnimGap ?? 2.5)); // user-controlled pause, up to 1 minute
    const cycle = actionDur + gap;
    const phase = cycle > 0 ? dt % cycle : 0;
    const progress = Math.min(1, phase / actionDur); // 0→1 while playing, clamped at 1 during the pause
    const eased = this.easeInOut(progress);

    let animAlpha = 1, animScale = 1, animRotate = 0, animOffsetX = 0, animOffsetY = 0;
    if (anim === "Fade") {
      // Dips down then eases back to full — a single "blink" pulse that
      // rests at full opacity once the play-through finishes.
      animAlpha = 1 - Math.sin(progress * Math.PI) * 0.65;
    } else if (anim === "Slide In") {
      // Slides in from off to the side and settles at rest.
      animOffsetX = (1 - eased) * targetW * 0.9;
    } else if (anim === "Zoom") {
      // Zooms in from slightly small and settles at full size.
      animScale = 0.55 + eased * 0.45;
    } else if (anim === "Bounce") {
      // Classic overshoot-and-settle bounce-in.
      const b = progress < 1
        ? 1 - Math.pow(2, -8 * progress) * Math.cos(progress * 11)
        : 1;
      animScale = Math.max(0, b);
    } else if (anim === "Spin") {
      // One full rotation per play-through, landing back at rest orientation.
      animRotate = progress * Math.PI * 2;
    }
    // "None" leaves all animation values at their defaults (static logo).

    ctx.save();
    ctx.globalAlpha = (this._panelAlpha ?? 1) * opacity * animAlpha;
    ctx.translate(cx + animOffsetX, cy + animOffsetY);
    ctx.rotate(animRotate);
    ctx.scale(animScale, animScale);
    ctx.translate(-cx, -cy);

    if (state.logoBgEnabled) {
      this.drawLogoBg(x - targetW / 2, y, targetW, targetH, state.logoBgShape || "rounded", state.logoBgColor || "rgba(0,0,0,0.55)");
    }
    // Subtle drop shadow for legibility
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur  = 12;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    // @ts-ignore
    ctx.drawImage(img, x - targetW / 2, y, targetW, targetH);
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── SOCIAL MEDIA OVERLAY ─────────────────────────────────────────────────
  // Rotating branded card showing platform logo + @handle with 5 animations.
  // ══════════════════════════════════════════════════════════════════════════

  private static readonly SOCIAL_PLATFORMS: Record<string, { bg: string; accent: string; icon: string }> = {
    TikTok:    { bg: "#010101",   accent: "#ee1d52", icon: "♪" },
    Instagram: { bg: "#833ab4",   accent: "#f77737", icon: "◉" },
    Facebook:  { bg: "#1877F2",   accent: "#0d5bb5", icon: "f" },
    YouTube:   { bg: "#FF0000",   accent: "#990000", icon: "▶" },
    X:         { bg: "#14171a",   accent: "#1d9bf0", icon: "✕" },
    Twitter:   { bg: "#14171a",   accent: "#1d9bf0", icon: "✕" },
    Twitch:    { bg: "#9146FF",   accent: "#6441a5", icon: "◈" },
    Snapchat:  { bg: "#FFFC00",   accent: "#FFEC00", icon: "◕" },
    LinkedIn:  { bg: "#0A66C2",   accent: "#004182", icon: "in" },
    Discord:   { bg: "#5865F2",   accent: "#4752c4", icon: "◇" },
  };

  private drawSocialOverlay(t: number): void {
    const { ctx, W, H, state } = this;
    const handles = (state.socialHandles ?? []).filter(h => h.enabled);
    if (handles.length === 0) return;

    // ── Timing ──────────────────────────────────────────────────────────────
    // Each card pops IN, holds for the configured duration, then pops OUT.
    // A short silent gap separates consecutive cards so there is always a
    // clean pause between them rather than an instant swap.
    const INTERVAL = Math.max(4, state.socialRotateInterval ?? 8);
    const IN_DUR   = 0.52;   // slide-in seconds
    const OUT_DUR  = 0.52;   // slide-out seconds
    const GAP      = 0.75;   // silent gap (nothing on screen) at end of cycle
    // Total visible window (in + hold + out).  Must fit inside INTERVAL - GAP.
    const SHOW_DUR = Math.max(IN_DUR + OUT_DUR + 0.4, INTERVAL - GAP);

    // Advance card index
    if (this.socialLastSwitchT === 0) this.socialLastSwitchT = t;
    if ((t - this.socialLastSwitchT) >= INTERVAL) {
      this.socialCurrentIdx  = (this.socialCurrentIdx + 1) % handles.length;
      this.socialLastSwitchT = t;
    }

    const phaseT = t - this.socialLastSwitchT;   // 0 … INTERVAL

    // During the silent gap at the end of the cycle — draw nothing.
    if (phaseT >= SHOW_DUR) return;

    // Slide-progress: 0 = fully off-screen left, 1 = fully on-screen.
    let slide = 1.0;
    if (phaseT < IN_DUR) {
      // Sliding in — elastic bounce for a lively pop
      const p = phaseT / IN_DUR;
      slide   = this.easeElastic(p);
    } else if (phaseT >= SHOW_DUR - OUT_DUR) {
      // Sliding out — clean ease-in so it snaps away quickly
      const p = (phaseT - (SHOW_DUR - OUT_DUR)) / OUT_DUR;
      slide   = 1 - this.easeInOut(p);
    }

    // Hold progress: 0→1 during the visible hold phase (used for progress bar).
    const holdStart  = IN_DUR;
    const holdEnd    = SHOW_DUR - OUT_DUR;
    const holdLength = Math.max(0.01, holdEnd - holdStart);
    const holdP      = Math.min(1, Math.max(0, (phaseT - holdStart) / holdLength));

    const cur      = handles[this.socialCurrentIdx];
    const platform = OverlayRenderer.SOCIAL_PLATFORMS[cur.platform] ?? { bg: "#333", accent: "#fff", icon: "◎" };
    const isSnap   = cur.platform === "Snapchat";

    // ── Card geometry ────────────────────────────────────────────────────────
    const sc      = (state.socialScale ?? 100) / 100;
    const pos     = state.socialPosition ?? { x: 2, y: 82 };
    const cardH   = Math.round(H * 0.095 * sc);
    const slabW   = Math.round(cardH * 1.08);   // square platform icon slab
    const bodyW   = Math.round(W  * 0.255 * sc); // text body width
    const totalW  = slabW + bodyW;
    const r       = Math.round(cardH * 0.13);
    const progH   = Math.max(3, Math.round(cardH * 0.042)); // progress strip

    const baseX   = (pos.x / 100) * W;
    const baseY   = (pos.y / 100) * H;
    // slide=0 → card completely off-screen to the left; slide=1 → at baseX
    const offX    = (1 - Math.max(0, Math.min(1.05, slide))) * -(totalW + baseX + 24);
    const px      = baseX + offX;
    const py      = baseY;

    ctx.save();
    ctx.globalAlpha *= this._panelAlpha;

    const cardStyle = (state.socialStyle ?? "Classic") as string;
    const padL      = slabW + 11;
    const maxTxtW   = bodyW - (padL - slabW) - 12;

    // Pre-truncate handle text (shared across all styles)
    let displayHandle = cur.handle.startsWith("@") ? cur.handle : `@${cur.handle}`;
    ctx.font = `800 ${Math.round(cardH * 0.385)}px sans-serif`;
    while (ctx.measureText(displayHandle).width > maxTxtW && displayHandle.length > 3) {
      displayHandle = displayHandle.slice(0, -4) + "…";
    }

    // ── Drop shadow ──────────────────────────────────────────────────────────
    ctx.shadowColor   = "rgba(0,0,0,0.55)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 6;

    if (cardStyle === "Glass") {
      // ── GLASS — frosted semi-transparent card ───────────────────────────────
      const glassR = Math.round(cardH * 0.36);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      this.fillRoundRect(px, py, totalW, cardH, glassR);
      ctx.shadowBlur = 0;
      // Subtle platform tint on left zone
      ctx.fillStyle = platform.accent + "44";
      this.fillRoundRect(px, py, slabW, cardH, glassR);
      ctx.fillRect(px + glassR, py, slabW - glassR, cardH);
      // White border
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.lineWidth   = 1.5;
      this.strokeRoundRect(px, py, totalW, cardH, glassR, "rgba(255,255,255,0.32)", 1.5);
      // Icon
      ctx.fillStyle    = "#fff";
      ctx.font         = `900 ${Math.round(cardH * 0.50)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(platform.icon, px + slabW / 2, py + cardH / 2);
      // Platform label
      ctx.fillStyle    = "rgba(255,255,255,0.60)";
      ctx.font         = `700 ${Math.round(cardH * 0.22)}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(cur.platform.toUpperCase(), px + padL, py + Math.round(cardH * 0.13));
      // Handle
      ctx.fillStyle    = "#ffffff";
      ctx.font         = `800 ${Math.round(cardH * 0.385)}px sans-serif`;
      ctx.textBaseline = "bottom";
      ctx.fillText(displayHandle, px + padL, py + cardH - Math.round(cardH * 0.13) - progH);
      // Progress bar
      if (phaseT >= holdStart && phaseT < holdEnd) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(px + slabW, py + cardH - progH, bodyW, progH);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(px + slabW, py + cardH - progH, Math.round(bodyW * (1 - holdP)), progH);
      }

    } else if (cardStyle === "White") {
      // ── WHITE — clean white card, platform accent slab ──────────────────────
      const whiteR = Math.round(cardH * 0.22);
      // Full white card first
      ctx.fillStyle = "#ffffff";
      this.fillRoundRect(px, py, totalW, cardH, whiteR);
      ctx.shadowBlur = 0;
      // Platform accent slab (rounded left, square right, blending into white)
      ctx.fillStyle = platform.bg;
      this.fillRoundRect(px, py, slabW + whiteR, cardH, whiteR);
      ctx.fillRect(px + slabW, py, whiteR, cardH);
      // Icon
      ctx.fillStyle    = isSnap ? "#000" : "#fff";
      ctx.font         = `900 ${Math.round(cardH * 0.50)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(platform.icon, px + slabW / 2, py + cardH / 2);
      // Platform label (on white body)
      ctx.fillStyle    = "rgba(0,0,0,0.38)";
      ctx.font         = `700 ${Math.round(cardH * 0.22)}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(cur.platform.toUpperCase(), px + padL, py + Math.round(cardH * 0.12));
      // Handle (dark)
      ctx.fillStyle    = "#111111";
      ctx.font         = `800 ${Math.round(cardH * 0.385)}px sans-serif`;
      ctx.textBaseline = "bottom";
      ctx.fillText(displayHandle, px + padL, py + cardH - Math.round(cardH * 0.12) - progH);
      // Progress bar (platform accent color)
      if (phaseT >= holdStart && phaseT < holdEnd) {
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(px + slabW, py + cardH - progH, bodyW, progH);
        ctx.fillStyle = platform.accent;
        ctx.fillRect(px + slabW, py + cardH - progH, Math.round(bodyW * (1 - holdP)), progH);
      }

    } else if (cardStyle === "Modern") {
      // ── MODERN — full platform gradient, pill shape, no slab divide ─────────
      const pillR  = Math.round(cardH * 0.50);  // perfect pill
      const grad   = ctx.createLinearGradient(px, py, px + totalW, py + cardH);
      grad.addColorStop(0, platform.bg);
      grad.addColorStop(1, platform.accent + "cc");
      ctx.fillStyle = grad;
      this.fillRoundRect(px, py, totalW, cardH, pillR);
      ctx.shadowBlur = 0;
      // Icon (left zone)
      ctx.fillStyle    = isSnap ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.90)";
      ctx.font         = `900 ${Math.round(cardH * 0.48)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(platform.icon, px + slabW / 2, py + cardH / 2);
      // Platform label
      ctx.fillStyle    = isSnap ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)";
      ctx.font         = `700 ${Math.round(cardH * 0.21)}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(cur.platform.toUpperCase(), px + slabW + 8, py + Math.round(cardH * 0.12));
      // Handle
      ctx.fillStyle    = isSnap ? "#111" : "#ffffff";
      ctx.font         = `800 ${Math.round(cardH * 0.385)}px sans-serif`;
      ctx.textBaseline = "bottom";
      ctx.fillText(displayHandle, px + slabW + 8, py + cardH - Math.round(cardH * 0.12) - progH);
      // Progress bar (white)
      if (phaseT >= holdStart && phaseT < holdEnd) {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(px + slabW, py + cardH - progH, bodyW, progH);
        ctx.fillStyle = "rgba(255,255,255,0.70)";
        ctx.fillRect(px + slabW, py + cardH - progH, Math.round(bodyW * (1 - holdP)), progH);
      }

    } else if (cardStyle === "Neon") {
      // ── NEON — deep dark bg, glowing border, neon-coloured text ────────────
      const neonR = Math.round(cardH * 0.22);
      ctx.fillStyle = "rgba(4,4,16,0.95)";
      this.fillRoundRect(px, py, totalW, cardH, neonR);
      ctx.shadowBlur = 0;
      // Glowing border
      this.strokeRoundRect(px, py, totalW, cardH, neonR, platform.accent, 2.5);
      ctx.shadowBlur  = 18;
      ctx.shadowColor = platform.accent;
      ctx.strokeStyle = platform.accent;
      ctx.lineWidth   = 2.5;
      this.strokeRoundRect(px, py, totalW, cardH, neonR, platform.accent, 2.5);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
      // Subtle left accent zone
      ctx.fillStyle = platform.accent + "1a";
      this.fillRoundRect(px, py, slabW + neonR, cardH, neonR);
      ctx.fillRect(px + neonR, py, slabW - neonR, cardH);
      // Icon (neon glow)
      ctx.shadowBlur  = 12;
      ctx.shadowColor = platform.accent;
      ctx.fillStyle   = platform.accent;
      ctx.font         = `900 ${Math.round(cardH * 0.50)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(platform.icon, px + slabW / 2, py + cardH / 2);
      ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
      // Divider line
      ctx.fillStyle = platform.accent;
      ctx.fillRect(px + slabW - 2, py + Math.round(cardH * 0.18), 2, Math.round(cardH * 0.64));
      // Platform label (dim accent)
      ctx.fillStyle    = platform.accent + "99";
      ctx.font         = `700 ${Math.round(cardH * 0.22)}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(cur.platform.toUpperCase(), px + padL, py + Math.round(cardH * 0.11));
      // Handle (full neon glow)
      ctx.shadowBlur  = 10;
      ctx.shadowColor = platform.accent;
      ctx.fillStyle   = platform.accent;
      ctx.font         = `800 ${Math.round(cardH * 0.385)}px sans-serif`;
      ctx.textBaseline = "bottom";
      ctx.fillText(displayHandle, px + padL, py + cardH - Math.round(cardH * 0.12) - progH);
      ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
      // Progress bar (neon glow)
      if (phaseT >= holdStart && phaseT < holdEnd) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(px + slabW, py + cardH - progH, bodyW, progH);
        ctx.shadowBlur = 6; ctx.shadowColor = platform.accent;
        ctx.fillStyle  = platform.accent;
        ctx.fillRect(px + slabW, py + cardH - progH, Math.round(bodyW * (1 - holdP)), progH);
        ctx.shadowBlur = 0;
      }

    } else {
      // ── CLASSIC (default) — dark slab + gradient body ───────────────────────
      ctx.shadowColor   = "rgba(0,0,0,0.60)";
      ctx.shadowBlur    = 22;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 7;
      // Platform slab (rounded left corners)
      ctx.fillStyle = platform.bg;
      this.fillRoundRect(px, py, slabW + r, cardH, r);
      ctx.fillRect(px + slabW, py, r, cardH);
      // Body (dark gradient, rounded right corners)
      ctx.shadowBlur = 0;
      const grad = ctx.createLinearGradient(px + slabW, py, px + totalW, py);
      grad.addColorStop(0, "rgba(10,10,22,0.97)");
      grad.addColorStop(1, "rgba(26,24,44,0.94)");
      ctx.fillStyle = grad;
      this.fillRoundRect(px + slabW, py, bodyW, cardH, r);
      ctx.fillRect(px + slabW, py, r, cardH);
      // Accent divider
      ctx.fillStyle   = platform.accent;
      ctx.shadowBlur  = 8; ctx.shadowColor = platform.accent;
      ctx.fillRect(px + slabW - 2, py + Math.round(cardH * 0.18), 3, Math.round(cardH * 0.64));
      ctx.shadowBlur  = 0; ctx.shadowColor = "transparent";
      // Icon
      ctx.fillStyle    = isSnap ? "#000" : "#fff";
      ctx.font         = `900 ${Math.round(cardH * 0.50)}px sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(platform.icon, px + slabW / 2, py + cardH / 2);
      // Platform label
      ctx.fillStyle    = isSnap ? "rgba(0,0,0,0.40)" : "rgba(255,255,255,0.38)";
      ctx.font         = `700 ${Math.round(cardH * 0.22)}px sans-serif`;
      ctx.textAlign    = "left";
      ctx.textBaseline = "top";
      ctx.fillText(cur.platform.toUpperCase(), px + padL, py + Math.round(cardH * 0.11));
      // Handle
      ctx.fillStyle    = isSnap ? "#111" : "#ffffff";
      ctx.font         = `800 ${Math.round(cardH * 0.385)}px sans-serif`;
      ctx.textBaseline = "bottom";
      ctx.fillText(displayHandle, px + padL, py + cardH - Math.round(cardH * 0.12) - progH);
      // Progress bar
      if (phaseT >= holdStart && phaseT < holdEnd) {
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(px + slabW, py + cardH - progH, bodyW, progH);
        ctx.fillStyle   = platform.accent;
        ctx.globalAlpha = ctx.globalAlpha * 0.85;
        ctx.fillRect(px + slabW, py + cardH - progH, Math.round(bodyW * (1 - holdP)), progH);
      }
    }

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════

  private drawGiftAlert(item: GiftQueueItem): void {
    const ageMs = Date.now() - item.displayTs;
    const dur   = item.gift.durationMs;
    const FADE_IN  = 380;
    const FADE_OUT = 650;
    const fadeIn  = Math.min(1, ageMs / FADE_IN);
    const fadeOut = ageMs > dur - FADE_OUT
      ? Math.max(0, 1 - (ageMs - (dur - FADE_OUT)) / FADE_OUT) : 1;
    const alpha = fadeIn * fadeOut * this._panelAlpha;
    if (alpha < 0.01) return;
    const mode = this.state.giftDisplayMode === "auto"
      ? item.gift.displayMode : this.state.giftDisplayMode;
    switch (mode) {
      case "minimal":  this.drawGiftMinimal(item, ageMs, alpha);  break;
      case "standard": this.drawGiftStandard(item, ageMs, alpha); break;
      case "hype":     this.drawGiftHype(item, ageMs, alpha);     break;
    }
  }

  private drawGiftParticles(
    cx: number, cy: number,
    gift: GiftDef, ageMs: number, durMs: number, maxRadius: number,
  ): void {
    const { ctx } = this;
    const progress = Math.min(1, ageMs / durMs);
    const FADE_START = 0.52;
    ctx.save();
    for (let i = 0; i < gift.particleCount; i++) {
      const phase  = i / gift.particleCount;
      const orbit  = ageMs * 0.0015 * (i % 2 === 0 ? 1 : -1.3);
      const angle  = phase * Math.PI * 2 + orbit;
      const spread = maxRadius * Math.pow(Math.min(1, progress * 1.7), 0.52);
      const wobble = Math.sin(ageMs * 0.004 + i * 2.3) * spread * 0.11;
      const px     = cx + Math.cos(angle) * (spread + wobble);
      const py     = cy + Math.sin(angle) * (spread + wobble) * 0.72;
      const fade   = progress > FADE_START
        ? Math.max(0, 1 - (progress - FADE_START) / (1 - FADE_START)) : 1;
      const size   = Math.max(1.5, (2.5 + Math.sin(i * 1.7 + ageMs * 0.006) * 1.5) * fade);
      const color  = i % 3 === 0 ? gift.primaryColor : (i % 3 === 1 ? gift.accentColor : gift.glowColor);
      ctx.globalAlpha = fade * 0.82;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawGiftMinimal(item: GiftQueueItem, ageMs: number, alpha: number): void {
    const { ctx, W, H } = this;
    const { gift } = item;
    const cardW   = Math.round(W * (this.isVertical ? 0.62 : 0.27));
    const cardH   = Math.round(H * 0.095);
    const cornerR = Math.round(cardH * 0.22);
    const slideP  = this.easeElastic(Math.min(1, ageMs / 420));
    const cardX   = W - cardW - Math.round(W * 0.018) - (1 - slideP) * (cardW + 10);
    const cardY   = Math.round(H * 0.055);
    const cy      = cardY + cardH / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.shadowColor   = gift.glowColor;
    ctx.shadowBlur    = 20;
    ctx.fillStyle     = "rgba(4, 6, 24, 0.93)";
    this.fillRoundRect(cardX, cardY, cardW, cardH, cornerR);
    ctx.shadowBlur    = 0;
    ctx.shadowColor   = "transparent";

    this.strokeRoundRect(cardX, cardY, cardW, cardH, cornerR, gift.primaryColor, 2);

    ctx.fillStyle = gift.primaryColor;
    this.fillRoundRect(cardX, cardY, 4, cardH, 2);

    const iconFS = Math.round(cardH * 0.52);
    ctx.font         = `${iconFS}px sans-serif`;
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(gift.icon, cardX + 10, cy);

    const nameFS = Math.round(cardH * 0.20);
    ctx.fillStyle = gift.accentColor;
    ctx.font      = `700 ${nameFS}px sans-serif`;
    ctx.fillText(gift.name, cardX + 10 + iconFS + 6, cy - cardH * 0.14);

    ctx.fillStyle = "#ffffff";
    ctx.font      = `${nameFS}px sans-serif`;
    ctx.fillText((item.donorName.split(" ")[0] ?? item.donorName), cardX + 10 + iconFS + 6, cy + cardH * 0.13);

    ctx.fillStyle    = gift.primaryColor;
    ctx.font         = `700 ${nameFS}px sans-serif`;
    ctx.textAlign    = "right";
    ctx.fillText(item.amount, cardX + cardW - 8, cy);

    if (item.comboCount > 1) {
      const comboFS = Math.round(cardH * 0.19);
      ctx.fillStyle   = "#ff6b35";
      ctx.font        = `800 ${comboFS}px sans-serif`;
      ctx.shadowColor = "#ff6b35";
      ctx.shadowBlur  = 10;
      ctx.fillText(`\uD83D\uDD25${item.comboCount}x`, cardX + cardW - 8, cy + cardH * 0.32);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
    }

    this.drawGiftParticles(cardX + cardW, cy, gift, ageMs, item.gift.durationMs, cardH * 0.9);
    ctx.restore();
  }

  private drawGiftStandard(item: GiftQueueItem, ageMs: number, alpha: number): void {
    const { ctx, W, H } = this;
    const { gift } = item;
    const cardW   = Math.round(W * (this.isVertical ? 0.88 : 0.54));
    const cardH   = Math.round(H * 0.14);
    const cornerR = Math.round(cardH * 0.17);
    const scaleP  = this.easeElastic(Math.min(1, ageMs / 420));
    const scale   = 0.82 + 0.18 * scaleP;
    const cardCX  = W / 2;
    const cardCY  = H * (this.isVertical ? 0.60 : 0.65);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cardCX, cardCY);
    ctx.scale(scale, scale);
    ctx.translate(-cardCX, -cardCY);

    const cardX = cardCX - cardW / 2;
    const cardY = cardCY - cardH / 2;

    ctx.shadowColor   = gift.glowColor;
    ctx.shadowBlur    = 32;
    ctx.fillStyle     = "rgba(3, 5, 20, 0.93)";
    this.fillRoundRect(cardX, cardY, cardW, cardH, cornerR);
    ctx.shadowBlur    = 0;
    ctx.shadowColor   = "transparent";

    this.strokeRoundRect(cardX, cardY, cardW, cardH, cornerR, gift.primaryColor, 2.5);

    const stripH = Math.round(cardH * 0.07);
    ctx.fillStyle = gift.primaryColor;
    this.fillTopRoundRect(cardX, cardY, cardW, stripH, cornerR);

    const tierLabel = gift.tier === "university" ? "\uD83C\uDF93 UNIVERSITY" : gift.tier === "gold" ? "\uD83E\uDD47 GOLD" : "\uD83E\uDD48 SILVER";
    const tierFS    = Math.round(cardH * 0.11);
    ctx.fillStyle   = gift.accentColor;
    ctx.font        = `700 ${tierFS}px sans-serif`;
    ctx.textAlign   = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(tierLabel, cardX + cardW - 10, cardY + stripH / 2);

    const iconFS = Math.round(cardH * 0.58);
    const iconX  = cardX + Math.round(cardH * 0.48);
    const iconCY = cardY + cardH * 0.55;
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 28;
    ctx.font         = `${iconFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(gift.icon, iconX, iconCY);
    ctx.fillText(gift.icon, iconX, iconCY);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const textX  = iconX + iconFS * 0.68;
    const nameFS = Math.round(cardH * 0.18);
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = gift.primaryColor;
    ctx.font        = `800 ${nameFS}px sans-serif`;
    ctx.textAlign   = "left";
    ctx.fillText(gift.name, textX, cardY + cardH * 0.33);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const donorFS = Math.round(cardH * 0.22);
    let donor = item.donorName;
    ctx.font = `700 ${donorFS}px sans-serif`;
    while (donor.length > 3 && ctx.measureText(donor).width > cardX + cardW - textX - 20) {
      donor = donor.slice(0, -4) + "\u2026";
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(donor, textX, cardY + cardH * 0.57);

    ctx.fillStyle = gift.accentColor;
    ctx.font      = `700 ${Math.round(cardH * 0.18)}px sans-serif`;
    ctx.fillText(item.amount, textX, cardY + cardH * 0.78);

    if (item.comboCount > 1) {
      ctx.fillStyle   = "#ff6b35";
      ctx.font        = `800 ${Math.round(cardH * 0.19)}px sans-serif`;
      ctx.textAlign   = "right";
      ctx.shadowColor = "#ff6b35";
      ctx.shadowBlur  = 14;
      ctx.fillText(`\uD83D\uDD25 ${item.comboCount}x`, cardX + cardW - 10, cardY + cardH * 0.72);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
    }

    ctx.restore();
    ctx.save();
    ctx.globalAlpha = alpha;
    this.drawGiftParticles(cardCX, cardCY, gift, ageMs, item.gift.durationMs, cardH * 1.3);
    ctx.restore();
  }

  private drawGiftHype(item: GiftQueueItem, ageMs: number, alpha: number): void {
    const { ctx, W, H } = this;
    const { gift } = item;
    const cx = W / 2;
    const cy = H * (this.isVertical ? 0.40 : 0.42);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Dark vignette
    const vigGrad = ctx.createRadialGradient(cx, H * 0.5, 0, cx, H * 0.5, Math.max(W, H) * 0.75);
    vigGrad.addColorStop(0, "rgba(0,0,0,0.0)");
    vigGrad.addColorStop(0.45, "rgba(0,0,0,0.55)");
    vigGrad.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W, H);

    // Glow rings
    for (let i = 0; i < 3; i++) {
      const phase  = ((i / 3) + ageMs * 0.00042) % 1;
      const ringR  = Math.min(W, H) * 0.42 * phase;
      const rAlpha = (1 - phase) * 0.40;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, ringR), 0, Math.PI * 2);
      ctx.strokeStyle = gift.primaryColor;
      ctx.lineWidth   = Math.max(1, 4.5 * (1 - phase));
      ctx.globalAlpha = alpha * rAlpha;
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;

    // Large icon (elastic pop-in)
    const iconP     = this.easeElastic(Math.min(1, ageMs / 520));
    const iconScale = 0.55 + 0.45 * iconP;
    const iconFS    = Math.round(Math.min(W, H) * (this.isVertical ? 0.24 : 0.21));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(iconScale, iconScale);
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 70;
    ctx.font         = `${iconFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(gift.icon, 0, 0);
    ctx.fillText(gift.icon, 0, 0);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";
    ctx.restore();

    // Text animates in with short delay
    const textFade = Math.min(1, Math.max(0, ageMs - 220) / 280);
    ctx.globalAlpha = alpha * textFade;

    const labelFS = Math.round(H * (this.isVertical ? 0.038 : 0.042));
    ctx.fillStyle    = gift.primaryColor;
    ctx.font         = `800 ${labelFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = gift.glowColor;
    ctx.shadowBlur   = 24;
    ctx.fillText(`${gift.icon} ${gift.name.toUpperCase()} ${gift.icon}`, cx, cy - iconFS * 0.62);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const donorFS = Math.round(H * (this.isVertical ? 0.048 : 0.052));
    ctx.fillStyle    = "#ffffff";
    ctx.font         = `800 ${donorFS}px sans-serif`;
    ctx.shadowColor  = "rgba(0,0,0,0.85)";
    ctx.shadowBlur   = 12;
    ctx.fillText(item.donorName, cx, cy + iconFS * 0.60);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const amountFS = Math.round(H * (this.isVertical ? 0.034 : 0.038));
    ctx.font        = `700 ${amountFS}px sans-serif`;
    const amountW   = ctx.measureText(item.amount).width;
    const pillW     = amountW + 40;
    const pillH     = amountFS * 1.6;
    const pillY     = cy + iconFS * 0.60 + donorFS * 0.72;
    ctx.fillStyle   = gift.primaryColor;
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 18;
    this.fillRoundRect(cx - pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";
    ctx.fillStyle   = "#ffffff";
    ctx.fillText(item.amount, cx, pillY);

    if (item.comboCount > 1) {
      const comboFS = Math.round(H * 0.046);
      ctx.fillStyle   = "#ff6b35";
      ctx.font        = `800 ${comboFS}px sans-serif`;
      ctx.shadowColor = "#ff6b35";
      ctx.shadowBlur  = 24;
      ctx.fillText(`\uD83D\uDD25 ${item.comboCount}x COMBO!`, cx, pillY + pillH * 0.9);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
    }

    ctx.globalAlpha = alpha;
    this.drawGiftParticles(cx, cy, gift, ageMs, item.gift.durationMs, Math.min(W, H) * 0.44);
    ctx.restore();
  }

  // ── DONATION ALERT (legacy fallback) ─────────────────────────────────────────

  private drawDonationAlert(
    d: { name: string; amount: string; amountKes: number; color: string; message: string; ts: number },
    _t: number,
  ) {
    const { ctx, W, H } = this;
    const ageSec = (Date.now() - d.ts) / 1000;
    const ALERT_TTL = 8;
    const fadeIn  = Math.min(1, ageSec / 0.4);
    const fadeOut = ageSec > ALERT_TTL - 0.8 ? Math.max(0, 1 - (ageSec - (ALERT_TTL - 0.8)) / 0.7) : 1;
    const alpha   = fadeIn * fadeOut;
    const scale   = 0.85 + 0.15 * this.easeElastic(Math.min(1, ageSec / 0.35));

    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.52));
    const bh = Math.round(H * (this.isVertical ? 0.15 : 0.13));
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.35);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bw / 2), -(bh / 2));

    const accentColor = d.color || "#22c55e";

    // Header band
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, bw, Math.round(bh * 0.38));

    // Body
    ctx.fillStyle = "rgba(5,30,10,0.94)";
    ctx.fillRect(0, Math.round(bh * 0.38), bw, bh - Math.round(bh * 0.38));

    // Left accent stripe
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, 4, bh);

    // Amount
    const fs1 = Math.round(bh * 0.22);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs1}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(d.amount, 12, bh * 0.19);

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.round(fs1 * 0.7)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("\u{1F49A}  Donation", bw - 10, bh * 0.19);

    // Donor name
    const fs2 = Math.round(bh * 0.22);
    ctx.fillStyle = accentColor;
    ctx.font = `bold ${fs2}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(d.name, 12, bh * 0.56);

    // Message
    if (d.message) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `${Math.round(fs2 * 0.82)}px sans-serif`;
      let msg = d.message;
      while (msg.length > 4 && ctx.measureText(msg).width > bw - 22) msg = msg.slice(0, -4) + "\u2026";
      ctx.fillText(msg, 12, bh * 0.8);
    }

    ctx.restore();
  }

  // ── DONATION TICKER ─────────────────────────────────────────────────────────

  private drawDonationTicker(_t: number) {
    const { ctx, W, H, state } = this;
    if (!state.donationTicker || state.donationTicker.length === 0) return;

    const tickerH  = Math.round(H * 0.038);
    const tickerY  = Math.round(H * (this.isVertical ? 0.88 : 0.90));
    const fontSize = Math.round(tickerH * 0.55);
    const PX       = 28;
    const SPEED    = 80; // px/s

    ctx.save();
    ctx.fillStyle = "rgba(5,30,10,0.88)";
    ctx.fillRect(0, tickerY, W, tickerH);

    const badgeW = Math.round(W * 0.14);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(0, tickerY, badgeW, tickerH);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u{1F49A} DONATIONS", badgeW / 2, tickerY + tickerH / 2);

    const items = state.donationTicker.slice(0, 10).map(d => `${d.name}  ${d.amount}`);
    const fullText = items.join("   \u00B7   ") + "      ";

    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const textW = ctx.measureText(fullText).width;

    const elapsed = this.elapsed();
    const dt = this.donationTickerLastT > 0 ? elapsed - this.donationTickerLastT : 0;
    this.donationTickerOffset = (this.donationTickerOffset + SPEED * dt) % (textW + PX);
    this.donationTickerLastT = elapsed;

    ctx.save();
    ctx.beginPath();
    ctx.rect(badgeW, tickerY, W - badgeW, tickerH);
    ctx.clip();
    const x = badgeW + PX - this.donationTickerOffset;
    ctx.fillText(fullText, x, tickerY + tickerH / 2);
    ctx.fillText(fullText, x + textW + PX, tickerY + tickerH / 2);
    ctx.restore();

    ctx.restore();
  }
}
