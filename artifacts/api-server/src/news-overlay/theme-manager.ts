import type { ThemeDefinition, ThemeName, ColorSettings, FontSettings, BorderSettings, ShadowSettings } from "./types.js";

const BASE_FONT: FontSettings = { family: "Arial, sans-serif", size: 14, weight: 600, letterSpacing: 0.02 };
const NO_SHADOW: ShadowSettings = { enabled: false, color: "rgba(0,0,0,0.5)", blur: 0, x: 0, y: 0 };
const NO_BORDER: BorderSettings = { width: 0, color: "transparent", radius: 0 };

export const THEMES: Record<ThemeName, ThemeDefinition> = {
  "CNN": {
    name: "CNN",
    colors: { primary: "#cc0001", secondary: "#8b0000", background: "#0d0d0d", text: "#f0f0f0", badge: "#cc0001", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 700 },
    border: NO_BORDER,
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "CNN",
    spacing: 0,
    badgeLabel: "BREAKING",
  },
  "BBC": {
    name: "BBC",
    colors: { primary: "#0057ff", secondary: "#003db3", background: "#1a1a2e", text: "#ffffff", badge: "#0057ff", badgeText: "#ffffff" },
    font: { family: "Georgia, serif", size: 14, weight: 700, letterSpacing: 0.04 },
    border: NO_BORDER,
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "BBC",
    spacing: 3,
    badgeLabel: "LIVE COVERAGE",
  },
  "Bloomberg": {
    name: "Bloomberg",
    colors: { primary: "#f59e0b", secondary: "#d97706", background: "#0c0c0c", text: "rgba(255,255,255,0.88)", badge: "#f59e0b", badgeText: "#000000" },
    font: { family: "monospace", size: 13, weight: 500, letterSpacing: 0.06 },
    border: { width: 2, color: "#f59e0b", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "Bloomberg",
    spacing: 0,
    badgeLabel: "MARKETS",
  },
  "Fox": {
    name: "Fox",
    colors: { primary: "#003399", secondary: "#002277", background: "#000033", text: "#ffffff", badge: "#003399", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 800, letterSpacing: 0.01 },
    border: { width: 3, color: "#003399", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "Fox",
    spacing: 0,
    badgeLabel: "FOX NEWS ALERT",
  },
  "Sky News": {
    name: "Sky News",
    colors: { primary: "#0ea5e9", secondary: "#0369a1", background: "rgba(0,0,0,0.92)", text: "#ffffff", badge: "#0ea5e9", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 600 },
    border: { width: 2, color: "#0ea5e9", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "Sky News",
    spacing: 0,
    badgeLabel: "SKY NEWS",
  },
  "Al Jazeera": {
    name: "Al Jazeera",
    colors: { primary: "#cc0001", secondary: "#990000", background: "rgba(4,4,12,0.96)", text: "#ffffff", badge: "#cc0001", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 700 },
    border: { width: 3, color: "#cc0001", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "Al Jazeera",
    spacing: 0,
    badgeLabel: "LIVE",
  },
  "CNBC": {
    name: "CNBC",
    colors: { primary: "#003399", secondary: "#0044cc", background: "#000022", text: "#ffffff", badge: "#003399", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 700, size: 13 },
    border: { width: 2, color: "#003399", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 1,
    tickerStyle: "CNBC",
    spacing: 0,
    badgeLabel: "CNBC",
  },
  "Dark": {
    name: "Dark",
    colors: { primary: "#6366f1", secondary: "#4f46e5", background: "rgba(10,10,20,0.97)", text: "rgba(255,255,255,0.9)", badge: "#6366f1", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 600 },
    border: { width: 1, color: "rgba(99,102,241,0.4)", radius: 4 },
    shadow: { enabled: true, color: "rgba(99,102,241,0.2)", blur: 20, x: 0, y: -4 },
    opacity: 0.97,
    tickerStyle: "Modern",
    spacing: 0,
    badgeLabel: "LIVE",
  },
  "Glass": {
    name: "Glass",
    colors: { primary: "#667eea", secondary: "#764ba2", background: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.92)", badge: "#667eea", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 600 },
    border: { width: 1, color: "rgba(255,255,255,0.14)", radius: 12 },
    shadow: { enabled: true, color: "rgba(0,0,0,0.4)", blur: 32, x: 0, y: 8 },
    opacity: 0.9,
    tickerStyle: "Glass",
    spacing: 0,
    badgeLabel: "LIVE",
  },
  "Modern": {
    name: "Modern",
    colors: { primary: "#00ff88", secondary: "#00cc66", background: "rgba(0,4,16,0.97)", text: "#00ff88", badge: "#00ff88", badgeText: "#000000" },
    font: { family: "monospace", size: 13, weight: 600, letterSpacing: 0.1 },
    border: { width: 2, color: "#00ff88", radius: 0 },
    shadow: { enabled: true, color: "#00ff8835", blur: 24, x: 0, y: -6 },
    opacity: 1,
    tickerStyle: "Modern",
    spacing: 0,
    badgeLabel: "WIRE",
  },
  "Minimal": {
    name: "Minimal",
    colors: { primary: "#ffffff", secondary: "rgba(255,255,255,0.5)", background: "rgba(0,0,0,0.88)", text: "#ffffff", badge: "rgba(255,255,255,0.15)", badgeText: "rgba(255,255,255,0.6)" },
    font: { ...BASE_FONT, weight: 400, letterSpacing: 0.01 },
    border: { width: 1, color: "rgba(255,255,255,0.10)", radius: 0 },
    shadow: NO_SHADOW,
    opacity: 0.88,
    tickerStyle: "Minimal",
    spacing: 0,
    badgeLabel: "LIVE",
  },
  "Election": {
    name: "Election",
    colors: { primary: "#ef4444", secondary: "#3b82f6", background: "#0f172a", text: "#f8fafc", badge: "#ef4444", badgeText: "#ffffff" },
    font: { ...BASE_FONT, weight: 800, size: 15, letterSpacing: 0.02 },
    border: { width: 3, color: "#ef4444", radius: 0 },
    shadow: { enabled: true, color: "rgba(239,68,68,0.3)", blur: 20, x: 0, y: 0 },
    opacity: 1,
    tickerStyle: "Election",
    spacing: 0,
    badgeLabel: "ELECTION NIGHT",
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
