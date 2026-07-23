import type { ThemeDefinition, ThemeName, ColorSettings, FontSettings, BorderSettings, ShadowSettings } from "./types.js";

// ── Font stacks ───────────────────────────────────────────────────────────────

const SYSTEM_SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const IMPACT_STACK = "'Arial Black', Impact, 'Haettenschweiler', sans-serif";
const MONO_STACK = "'IBM Plex Mono', 'Courier New', Courier, monospace";
const SERIF_STACK = "Georgia, 'Times New Roman', serif";
const HELVETICA_STACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const NO_SHADOW: ShadowSettings = { enabled: false, color: "rgba(0,0,0,0.5)", blur: 0, x: 0, y: 0 };
const NO_BORDER: BorderSettings = { width: 0, color: "transparent", radius: 0 };

export const THEMES: Record<ThemeName, ThemeDefinition> = {

  // ── CNN — Cinematic red/black ───────────────────────────────────────────────
  "CNN": {
    name: "CNN",
    colors: {
      primary: "#e8000a",
      secondary: "#9b0007",
      background: "rgba(10,0,0,0.97)",
      text: "#f5f5f5",
      badge: "#e8000a",
      badgeText: "#ffffff",
    },
    font: { family: IMPACT_STACK, size: 14, weight: 900, letterSpacing: 0.03 },
    border: { width: 4, color: "#e8000a", radius: 0 },
    shadow: { enabled: true, color: "rgba(232,0,10,0.35)", blur: 24, x: 0, y: -6 },
    opacity: 1,
    tickerStyle: "CNN",
    spacing: 0,
    badgeLabel: "BREAKING",
    gradientColors: ["#e8000a", "#6b0005"],
  },

  // ── BBC — Royal authority ───────────────────────────────────────────────────
  "BBC": {
    name: "BBC",
    colors: {
      primary: "#1a73e8",
      secondary: "#0d47a1",
      background: "rgba(10,14,50,0.98)",
      text: "#ffffff",
      badge: "#1a73e8",
      badgeText: "#ffffff",
    },
    font: { family: SERIF_STACK, size: 14, weight: 700, letterSpacing: 0.03 },
    border: { width: 0, color: "transparent", radius: 0 },
    shadow: { enabled: true, color: "rgba(26,115,232,0.25)", blur: 32, x: 0, y: -8 },
    opacity: 1,
    tickerStyle: "BBC",
    spacing: 4,
    badgeLabel: "LIVE COVERAGE",
    gradientColors: ["#1a73e8", "#0d3db8"],
  },

  // ── Bloomberg — Terminal / financial ────────────────────────────────────────
  "Bloomberg": {
    name: "Bloomberg",
    colors: {
      primary: "#f5a623",
      secondary: "#c07800",
      background: "rgba(6,6,6,0.99)",
      text: "rgba(255,255,255,0.88)",
      badge: "#f5a623",
      badgeText: "#000000",
    },
    font: { family: MONO_STACK, size: 13, weight: 500, letterSpacing: 0.07 },
    border: { width: 2, color: "#f5a623", radius: 0 },
    shadow: { enabled: true, color: "rgba(245,166,35,0.20)", blur: 20, x: 0, y: -4 },
    opacity: 1,
    tickerStyle: "Bloomberg",
    spacing: 0,
    badgeLabel: "MARKETS",
    gradientColors: ["#f5a623", "#b36a00"],
  },

  // ── Fox — Bold American broadcast ──────────────────────────────────────────
  "Fox": {
    name: "Fox",
    colors: {
      primary: "#003fa3",
      secondary: "#001d75",
      background: "rgba(0,5,24,0.99)",
      text: "#ffffff",
      badge: "#003fa3",
      badgeText: "#ffffff",
    },
    font: { family: IMPACT_STACK, size: 14, weight: 900, letterSpacing: 0.02 },
    border: { width: 4, color: "#003fa3", radius: 0 },
    shadow: { enabled: true, color: "rgba(0,63,163,0.30)", blur: 20, x: 0, y: -4 },
    opacity: 1,
    tickerStyle: "Fox",
    spacing: 0,
    badgeLabel: "FOX NEWS ALERT",
    gradientColors: ["#003fa3", "#001566"],
  },

  // ── Sky News — Sky-blue modern ──────────────────────────────────────────────
  "Sky News": {
    name: "Sky News",
    colors: {
      primary: "#00b4ff",
      secondary: "#0077cc",
      background: "rgba(0,12,28,0.97)",
      text: "#ffffff",
      badge: "#00b4ff",
      badgeText: "#000000",
    },
    font: { family: HELVETICA_STACK, size: 14, weight: 600, letterSpacing: 0.01 },
    border: { width: 3, color: "#00b4ff", radius: 0 },
    shadow: { enabled: true, color: "rgba(0,180,255,0.25)", blur: 28, x: 0, y: -6 },
    opacity: 1,
    tickerStyle: "Sky News",
    spacing: 0,
    badgeLabel: "SKY NEWS",
    gradientColors: ["#00b4ff", "#0057a8"],
  },

  // ── Al Jazeera — Rich international ────────────────────────────────────────
  "Al Jazeera": {
    name: "Al Jazeera",
    colors: {
      primary: "#d00000",
      secondary: "#800000",
      background: "rgba(5,5,15,0.98)",
      text: "#ffffff",
      badge: "#d00000",
      badgeText: "#ffffff",
    },
    font: { family: HELVETICA_STACK, size: 14, weight: 700, letterSpacing: 0.02 },
    border: { width: 3, color: "#d00000", radius: 0 },
    shadow: { enabled: true, color: "rgba(208,0,0,0.30)", blur: 20, x: 0, y: -4 },
    opacity: 1,
    tickerStyle: "Al Jazeera",
    spacing: 0,
    badgeLabel: "LIVE",
    gradientColors: ["#d00000", "#600000"],
  },

  // ── CNBC — Financial data ────────────────────────────────────────────────────
  "CNBC": {
    name: "CNBC",
    colors: {
      primary: "#0047b3",
      secondary: "#001f7a",
      background: "rgba(0,0,20,0.99)",
      text: "#ffffff",
      badge: "#0047b3",
      badgeText: "#ffffff",
    },
    font: { family: HELVETICA_STACK, size: 13, weight: 700, letterSpacing: 0.02 },
    border: { width: 2, color: "#0047b3", radius: 0 },
    shadow: { enabled: true, color: "rgba(0,71,179,0.28)", blur: 20, x: 0, y: -4 },
    opacity: 1,
    tickerStyle: "CNBC",
    spacing: 0,
    badgeLabel: "CNBC",
    gradientColors: ["#0047b3", "#001566"],
  },

  // ── Dark — Premium indigo / violet ──────────────────────────────────────────
  "Dark": {
    name: "Dark",
    colors: {
      primary: "#7c3aed",
      secondary: "#4f46e5",
      background: "rgba(8,8,20,0.98)",
      text: "rgba(255,255,255,0.92)",
      badge: "#7c3aed",
      badgeText: "#ffffff",
    },
    font: { family: SYSTEM_SANS, size: 13, weight: 600, letterSpacing: 0.01 },
    border: { width: 1, color: "rgba(124,58,237,0.45)", radius: 6 },
    shadow: { enabled: true, color: "rgba(124,58,237,0.25)", blur: 30, x: 0, y: -8 },
    opacity: 0.97,
    tickerStyle: "Modern",
    spacing: 0,
    badgeLabel: "LIVE",
    gradientColors: ["#7c3aed", "#4338ca"],
  },

  // ── Glass — Frosted glass premium ───────────────────────────────────────────
  "Glass": {
    name: "Glass",
    colors: {
      primary: "#60a5fa",
      secondary: "#a855f7",
      background: "rgba(255,255,255,0.07)",
      text: "rgba(255,255,255,0.95)",
      badge: "#60a5fa",
      badgeText: "#ffffff",
    },
    font: { family: SYSTEM_SANS, size: 13, weight: 600, letterSpacing: 0.01 },
    border: { width: 1, color: "rgba(255,255,255,0.15)", radius: 12 },
    shadow: { enabled: true, color: "rgba(0,0,0,0.45)", blur: 40, x: 0, y: 10 },
    opacity: 0.92,
    tickerStyle: "Glass",
    spacing: 0,
    badgeLabel: "LIVE",
    gradientColors: ["#60a5fa", "#a855f7"],
  },

  // ── Modern — Cyberpunk neon ──────────────────────────────────────────────────
  "Modern": {
    name: "Modern",
    colors: {
      primary: "#00ff88",
      secondary: "#00ccff",
      background: "rgba(0,4,16,0.99)",
      text: "#00ff88",
      badge: "#00ff88",
      badgeText: "#000000",
    },
    font: { family: MONO_STACK, size: 13, weight: 600, letterSpacing: 0.10 },
    border: { width: 2, color: "#00ff88", radius: 0 },
    shadow: { enabled: true, color: "rgba(0,255,136,0.30)", blur: 28, x: 0, y: -6 },
    opacity: 1,
    tickerStyle: "Modern",
    spacing: 0,
    badgeLabel: "WIRE",
    gradientColors: ["#00ff88", "#00ccff"],
  },

  // ── Minimal — Ultra clean ────────────────────────────────────────────────────
  "Minimal": {
    name: "Minimal",
    colors: {
      primary: "#ffffff",
      secondary: "rgba(255,255,255,0.45)",
      background: "rgba(0,0,0,0.82)",
      text: "rgba(255,255,255,0.95)",
      badge: "rgba(255,255,255,0.12)",
      badgeText: "rgba(255,255,255,0.55)",
    },
    font: { family: SYSTEM_SANS, size: 13, weight: 400, letterSpacing: 0.005 },
    border: { width: 1, color: "rgba(255,255,255,0.08)", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 0.88,
    tickerStyle: "Minimal",
    spacing: 0,
    badgeLabel: "LIVE",
    gradientColors: ["rgba(255,255,255,0.9)", "rgba(200,200,200,0.7)"],
  },

  // ── Election — Dramatic election night ──────────────────────────────────────
  "Election": {
    name: "Election",
    colors: {
      primary: "#dc2626",
      secondary: "#2563eb",
      background: "rgba(8,14,26,0.99)",
      text: "#f8fafc",
      badge: "#dc2626",
      badgeText: "#ffffff",
    },
    font: { family: IMPACT_STACK, size: 14, weight: 900, letterSpacing: 0.03 },
    border: { width: 4, color: "#dc2626", radius: 0 },
    shadow: { enabled: true, color: "rgba(220,38,38,0.35)", blur: 28, x: 0, y: -6 },
    opacity: 1,
    tickerStyle: "Election",
    spacing: 0,
    badgeLabel: "ELECTION NIGHT",
    gradientColors: ["#dc2626", "#2563eb"],
  },
};

export function getTheme(name: ThemeName): ThemeDefinition {
  return THEMES[name] ?? THEMES["Al Jazeera"];
}

export function listThemes(): ThemeName[] {
  return Object.keys(THEMES) as ThemeName[];
}

export function applyThemeDefaults(themeName: ThemeName, overrides: {
  customColors?: Partial<ColorSettings>;
  customFont?: Partial<FontSettings>;
}): { colors: ColorSettings; font: FontSettings } {
  const theme = getTheme(themeName);
  return {
    colors: { ...theme.colors, ...overrides.customColors },
    font: { ...theme.font, ...overrides.customFont },
  };
}
