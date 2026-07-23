import { logger } from "../lib/logger.js";
import {
  getState, setState, loadPersistedState, buildDefaultState,
} from "./state-manager.js";
import {
  addTickerMessage, removeTickerMessage, clearTickerMessages,
  getTickerMessages, addBreakingNewsMessage, pruneExpired,
  updateTickerMessage,
} from "./ticker-manager.js";
import {
  createWidget, listWidgetTypes, startClockWidgets, stopClockWidgets,
} from "./widget-manager.js";
import { installBuiltinPresets } from "./preset-manager.js";
import { getTheme, listThemes } from "./theme-manager.js";
import { listAnimationPresets } from "./animation-manager.js";
import type {
  NewsOverlayState, ThemeName, AnimationPreset, WidgetType,
  TickerConfig, BreakingNewsConfig, LiveBadgeConfig, HeadlineConfig,
} from "./types.js";

type BroadcastFn = (type: string, payload: unknown) => void;
type StreamUpdaterFn = (patch: Record<string, unknown>) => void;

let _broadcast: BroadcastFn | null = null;
let _streamUpdater: StreamUpdaterFn | null = null;
let _headlineTimer: ReturnType<typeof setTimeout> | null = null;
let _pruneTimer: ReturnType<typeof setInterval> | null = null;

// ── Map NewsOverlayState → OverlayState patch for the canvas renderer ──────────

const TICKER_STYLE_MAP: Record<string, string> = {
  "CNN":        "CNN",
  "BBC":        "BBC",
  "Bloomberg":  "Bloomberg",
  "Sky News":   "Sky News",
  "CNBC":       "Bloomberg",
  "Al Jazeera": "Al Jazeera",
  "Modern":     "Neon Wire",
  "Minimal":    "Minimal",
  "Glass":      "Float Glass",
  "Election":   "CNN",
  "Fox":        "CNN",
};

const ANIM_MAP: Record<string, string> = {
  "None":       "None",
  "Fade":       "Fade",
  "Slide Left": "Slide Left",
  "Slide Right":"Slide Right",
  "Slide Up":   "Pop Up",
  "Slide Down": "Drop Down",
  "Zoom":       "Zoom",
  "Elastic":    "Elastic",
  "Bounce":     "Elastic",
  "Flip":       "Flip",
  "Typewriter": "Typewriter",
  "Blur":       "Fade",
  "Glitch":     "Glitch",
  "Pulse":      "Fade",
  "Flash":      "Glitch",
};

function mapToOverlayPatch(s: NewsOverlayState): Record<string, unknown> {
  const messages = getTickerMessages();
  const sep = s.ticker?.separator ?? "   ◆   ";
  const tickerText = messages.length
    ? messages.map(m => m.text).join(sep)
    : (s.headline?.text ?? "");

  const displayText = (s.breakingNews?.active && s.breakingNews?.overridesTicker)
    ? s.breakingNews.text
    : tickerText;

  return {
    newsActive:      s.active,
    newsText:        displayText,
    newsTitle:       s.liveBadge?.label ?? "LIVE",
    newsBgColor:     s.customColors?.primary ?? "#cc0001",
    newsStyle:       TICKER_STYLE_MAP[s.ticker?.style ?? ""] ?? "Al Jazeera",
    newsAnimation:   ANIM_MAP[s.enterAnimation ?? ""] ?? "Fade",
    newsPosition:    s.layout?.position ?? { x: 0, y: 95 },
    newsLogo:        s.logo ?? "",
    newsScrollSpeed: s.ticker?.speed ?? 30,
    // newsScale is controlled exclusively via broadcastState (control-room SizeSlider).
    // Do NOT set it here — pushToStreamRenderers would overwrite the user's slider value.
  };
}

function pushToStreamRenderers(): void {
  if (!_streamUpdater) return;
  try {
    _streamUpdater(mapToOverlayPatch(getState()));
  } catch (e) {
    logger.warn({ err: e }, "[news-overlay] stream renderer update failed");
  }
}

// ── Initialise ─────────────────────────────────────────────────────────────────

export function initNewsOverlay(broadcast: BroadcastFn, streamUpdater?: StreamUpdaterFn): void {
  _broadcast = broadcast;
  if (streamUpdater) _streamUpdater = streamUpdater;
  loadPersistedState();
  installBuiltinPresets();

  // Prune expired ticker messages every 30 s
  _pruneTimer = setInterval(() => {
    pruneExpired();
    if (getState().active) emitState();
  }, 30_000);

  // Start clock widgets if any enabled
  const { widgets } = getState();
  startClockWidgets(widgets);

  logger.info("[news-overlay] Initialised");
}

export function shutdownNewsOverlay(): void {
  stopClockWidgets();
  if (_pruneTimer) { clearInterval(_pruneTimer); _pruneTimer = null; }
  if (_headlineTimer) { clearTimeout(_headlineTimer); _headlineTimer = null; }
}

// ── Emit state to all WebSocket clients ───────────────────────────────────────

export function emitState(): void {
  if (!_broadcast) return;
  _broadcast("news-overlay", getState());
}

// ── High-level actions ─────────────────────────────────────────────────────────

export function activate(): NewsOverlayState {
  const s = setState({ active: true });
  emitState();
  pushToStreamRenderers();
  startHeadlineRotation();
  return s;
}

export function deactivate(): NewsOverlayState {
  const s = setState({ active: false });
  stopHeadlineRotation();
  emitState();
  pushToStreamRenderers();
  return s;
}

export function toggle(): NewsOverlayState {
  const { active } = getState();
  return active ? deactivate() : activate();
}

export function updateOverlay(patch: Partial<NewsOverlayState>): NewsOverlayState {
  const s = setState(patch);
  emitState();
  pushToStreamRenderers();
  // Restart clock widgets if widgets changed
  if (patch.widgets) startClockWidgets(s.widgets);
  // Restart headline rotation if headline config changed
  if (patch.headline) {
    stopHeadlineRotation();
    if (s.active) startHeadlineRotation();
  }
  return s;
}

export function applyThemeFull(themeName: ThemeName): NewsOverlayState {
  const theme = getTheme(themeName);
  const current = getState();
  const s = setState({
    theme: themeName,
    customColors: theme.colors,
    customFont: theme.font,
    customBorder: theme.border,
    customShadow: theme.shadow,
    opacity: theme.opacity,
    ticker: { ...current.ticker, style: theme.tickerStyle },
    liveBadge: { ...current.liveBadge, color: theme.colors.badge, label: theme.badgeLabel },
  });
  emitState();
  pushToStreamRenderers();
  return s;
}

// ── Ticker ─────────────────────────────────────────────────────────────────────

export function addMessage(text: string, priority = 0, expiresInMs?: number) {
  const msg = addTickerMessage(text, priority, expiresInMs);
  emitTickerEvent();
  emitState();
  if (getState().active) pushToStreamRenderers();
  return msg;
}

export function removeMessage(id: string): boolean {
  const ok = removeTickerMessage(id);
  if (ok) {
    emitTickerEvent();
    emitState();
    if (getState().active) pushToStreamRenderers();
  }
  return ok;
}

export function clearMessages(): void {
  clearTickerMessages();
  emitTickerEvent();
  emitState();
  if (getState().active) pushToStreamRenderers();
}

export function updateMessage(id: string, text: string, priority?: number): boolean {
  const ok = updateTickerMessage(id, text, priority);
  if (ok) {
    emitTickerEvent();
    emitState();
    if (getState().active) pushToStreamRenderers();
  }
  return ok;
}

export function addBreaking(text: string) {
  setState({ breakingNews: { ...getState().breakingNews, active: true, text } });
  const msg = addBreakingNewsMessage(text);
  emitState();
  pushToStreamRenderers();
  return msg;
}

export function clearBreaking(): void {
  setState({ breakingNews: { ...getState().breakingNews, active: false, text: "" } });
  emitState();
  pushToStreamRenderers();
}

export function updateTickerConfig(cfg: Partial<TickerConfig>): NewsOverlayState {
  const s = setState({ ticker: { ...getState().ticker, ...cfg } });
  emitState();
  if (s.active) pushToStreamRenderers();
  return s;
}

// ── Headline rotation ─────────────────────────────────────────────────────────

function startHeadlineRotation(): void {
  stopHeadlineRotation();
  const { headline } = getState();
  if (!headline.autoRotate || headline.headlines.length <= 1) return;
  scheduleNextHeadline();
}

function scheduleNextHeadline(): void {
  const { headline } = getState();
  if (!headline.autoRotate) return;
  _headlineTimer = setTimeout(() => {
    const { headline: h, active } = getState();
    if (!active || !h.autoRotate) return;
    const nextIndex = (h.currentIndex + 1) % h.headlines.length;
    setState({
      headline: {
        ...h,
        currentIndex: nextIndex,
        text: h.headlines[nextIndex],
      },
    });
    emitState();
    pushToStreamRenderers();
    scheduleNextHeadline();
  }, headline.durationMs);
}

function stopHeadlineRotation(): void {
  if (_headlineTimer) { clearTimeout(_headlineTimer); _headlineTimer = null; }
}

// ── Ticker WebSocket event ─────────────────────────────────────────────────────

function emitTickerEvent(): void {
  if (!_broadcast) return;
  const { ticker } = getState();
  _broadcast("news-overlay-ticker", { messages: getTickerMessages(), config: ticker });
}

// ── Introspection ──────────────────────────────────────────────────────────────

export function getCapabilities() {
  return {
    themes: listThemes(),
    animations: listAnimationPresets(),
    widgetTypes: listWidgetTypes(),
    tickerStyles: [
      "CNN", "BBC", "Bloomberg", "Fox", "Sky News", "CNBC",
      "Al Jazeera", "Modern", "Minimal", "Glass", "Election",
    ],
    tickerDirections: ["left", "right"],
  };
}
