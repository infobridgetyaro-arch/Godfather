export type TickerStyle =
  | "CNN" | "BBC" | "Bloomberg" | "Fox" | "Sky News" | "CNBC"
  | "Al Jazeera" | "Modern" | "Minimal" | "Glass" | "Election";

export type ThemeName =
  | "CNN" | "BBC" | "Bloomberg" | "Fox" | "Sky News" | "Al Jazeera" | "CNBC"
  | "Dark" | "Glass" | "Modern" | "Minimal" | "Election";

export type AnimationPreset =
  | "None" | "Slide Left" | "Slide Right" | "Slide Up" | "Slide Down"
  | "Fade" | "Zoom" | "Elastic" | "Bounce" | "Flip"
  | "Typewriter" | "Blur" | "Glitch" | "Pulse" | "Flash";

export type TickerDirection = "left" | "right";

export type WidgetType =
  | "clock" | "date" | "weather" | "temperature" | "wind"
  | "cpu" | "ram" | "network" | "bitrate" | "fps"
  | "stock" | "currency" | "crypto" | "gas"
  | "election" | "sports" | "viewers";

export interface WidgetPosition {
  x: number; // 0–100 %
  y: number; // 0–100 %
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  enabled: boolean;
  position: WidgetPosition;
  settings: Record<string, unknown>;
}

export interface FontSettings {
  family: string;
  size: number;      // px
  weight: number;    // 100–900
  letterSpacing: number; // em
}

export interface ColorSettings {
  primary: string;   // accent / brand
  secondary: string; // secondary accent
  background: string;
  text: string;
  badge: string;
  badgeText: string;
}

export interface BorderSettings {
  width: number;
  color: string;
  radius: number;
}

export interface ShadowSettings {
  enabled: boolean;
  color: string;
  blur: number;
  x: number;
  y: number;
}

export interface ThemeDefinition {
  name: ThemeName;
  colors: ColorSettings;
  font: FontSettings;
  border: BorderSettings;
  shadow: ShadowSettings;
  opacity: number;        // 0–1
  tickerStyle: TickerStyle;
  spacing: number;        // px gap between elements
  badgeLabel: string;
}

export interface TickerMessage {
  id: string;
  text: string;
  priority: number;        // higher = shown first; breaking=100
  addedAt: number;         // Date.now()
  expiresAt?: number;      // optional TTL
}

export interface TickerConfig {
  style: TickerStyle;
  direction: TickerDirection;
  speed: number;           // 10 (fast) … 60 (slow), maps to seconds per screen-width
  paused: boolean;
  separator: string;
}

export interface HeadlineConfig {
  text: string;
  animation: AnimationPreset;
  durationMs: number;      // how long headline shows before transitioning
  autoRotate: boolean;
  headlines: string[];     // queue of headlines to rotate
  currentIndex: number;
}

export interface BreakingNewsConfig {
  active: boolean;
  text: string;
  flashInterval: number;   // ms between flashes
  overridesTicker: boolean;
}

export interface LiveBadgeConfig {
  visible: boolean;
  label: string;            // "LIVE" | custom
  pulse: boolean;
  color: string;
}

export interface NewsOverlayLayout {
  position: { x: number; y: number }; // % from top-left
  width: number;                        // % of viewport width (0 = full)
  height: number;                       // px (0 = auto)
  zIndex: number;
  scale: number;                        // 50–200 (100 = actual size)
}

export interface NewsOverlayState {
  // ── Visibility ────────────────────────────────────────────────────────────
  active: boolean;
  previewMode: boolean;

  // ── Theme ──────────────────────────────────────────────────────────────────
  theme: ThemeName;
  customColors: ColorSettings;
  customFont: FontSettings;
  customBorder: BorderSettings;
  customShadow: ShadowSettings;
  opacity: number;

  // ── Layout ─────────────────────────────────────────────────────────────────
  layout: NewsOverlayLayout;

  // ── Logo ───────────────────────────────────────────────────────────────────
  logo: string;               // base64 data URL or empty
  logoUrl: string;            // remote URL alternative

  // ── Live Badge ──────────────────────────────────────────────────────────────
  liveBadge: LiveBadgeConfig;

  // ── Headline ────────────────────────────────────────────────────────────────
  headline: HeadlineConfig;

  // ── Breaking News ────────────────────────────────────────────────────────────
  breakingNews: BreakingNewsConfig;

  // ── Ticker ───────────────────────────────────────────────────────────────────
  ticker: TickerConfig;
  tickerMessages: TickerMessage[];

  // ── Widgets ──────────────────────────────────────────────────────────────────
  widgets: WidgetConfig[];

  // ── Animation ────────────────────────────────────────────────────────────────
  enterAnimation: AnimationPreset;
  exitAnimation: AnimationPreset;
  animationDurationMs: number;
}

export interface NewsOverlayPreset {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  state: Partial<NewsOverlayState>;
}

// ── WebSocket events ──────────────────────────────────────────────────────────

export interface NewsOverlayEvent {
  type: "news-overlay";
  payload: NewsOverlayState;
}

export interface NewsOverlayTickerEvent {
  type: "news-overlay-ticker";
  payload: { messages: TickerMessage[]; config: TickerConfig };
}

export interface NewsOverlayHeadlineEvent {
  type: "news-overlay-headline";
  payload: HeadlineConfig;
}
