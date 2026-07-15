import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import type { NewsOverlayState } from "./types.js";
import { getTickerMessages, getDefaultTickerConfig } from "./ticker-manager.js";
import { getTheme } from "./theme-manager.js";

const DATA_DIR = path.resolve(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "news-overlay-state.json");

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function buildDefaultState(): NewsOverlayState {
  return {
    active: false,
    previewMode: false,

    theme: "Al Jazeera",

    customColors: {
      primary: "#cc0001",
      secondary: "#990000",
      background: "rgba(4,4,12,0.96)",
      text: "#ffffff",
      badge: "#cc0001",
      badgeText: "#ffffff",
    },
    customFont: {
      family: "Arial, sans-serif",
      size: 14,
      weight: 600,
      letterSpacing: 0.02,
    },
    customBorder: { width: 0, color: "transparent", radius: 0 },
    customShadow: { enabled: false, color: "rgba(0,0,0,0.5)", blur: 0, x: 0, y: 0 },
    opacity: 1,

    layout: { position: { x: 0, y: 95 }, width: 0, height: 0, zIndex: 30, scale: 100 },

    logo: "",
    logoUrl: "",

    liveBadge: { visible: true, label: "LIVE", pulse: true, color: "#cc0001" },

    headline: {
      text: "Welcome to the live stream! Stay tuned for more updates.",
      animation: "Slide Up",
      durationMs: 6000,
      autoRotate: false,
      headlines: [
        "Welcome to the live stream! Stay tuned for more updates.",
        "Thanks for watching — subscribe for more content!",
      ],
      currentIndex: 0,
    },

    breakingNews: {
      active: false,
      text: "BREAKING NEWS",
      flashInterval: 800,
      overridesTicker: false,
    },

    ticker: getDefaultTickerConfig(),
    tickerMessages: [],

    widgets: [],

    enterAnimation: "Slide Up",
    exitAnimation: "Slide Down",
    animationDurationMs: 500,
  };
}

let _state: NewsOverlayState = buildDefaultState();

export function getState(): NewsOverlayState {
  return { ..._state, tickerMessages: getTickerMessages() };
}

export function setState(patch: Partial<NewsOverlayState>): NewsOverlayState {
  _state = deepMerge(_state as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>) as unknown as NewsOverlayState;
  persistState();
  return getState();
}

export function resetState(): NewsOverlayState {
  _state = buildDefaultState();
  persistState();
  return getState();
}

export function applyTheme(themeName: NewsOverlayState["theme"]): NewsOverlayState {
  const theme = getTheme(themeName);
  return setState({
    theme: themeName,
    customColors: theme.colors,
    customFont: theme.font,
    customBorder: theme.border,
    customShadow: theme.shadow,
    opacity: theme.opacity,
    ticker: { ..._state.ticker, style: theme.tickerStyle },
    liveBadge: { ..._state.liveBadge, color: theme.colors.badge, label: theme.badgeLabel },
  });
}

// ── Persistence ────────────────────────────────────────────────────────────────

let _saveTimeout: ReturnType<typeof setTimeout> | null = null;

function persistState(): void {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    try {
      ensureDir();
      const { tickerMessages: _tm, ...toSave } = _state;
      fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), "utf-8");
    } catch (err) {
      logger.warn({ err }, "[news-overlay] Failed to persist state");
    }
  }, 300);
}

export function loadPersistedState(): void {
  try {
    ensureDir();
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const saved = JSON.parse(raw) as Partial<NewsOverlayState>;
    _state = deepMerge(buildDefaultState() as unknown as Record<string, unknown>, saved as Record<string, unknown>) as unknown as NewsOverlayState;
    logger.info("[news-overlay] Loaded persisted state");
  } catch (err) {
    logger.warn({ err }, "[news-overlay] Failed to load persisted state — using defaults");
    _state = buildDefaultState();
  }
}

// ── Deep merge utility ─────────────────────────────────────────────────────────

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== null && sv !== undefined && typeof sv === "object" && !Array.isArray(sv) &&
        tv !== null && tv !== undefined && typeof tv === "object" && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result;
}
