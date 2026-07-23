import type { TickerMessage, TickerConfig, TickerStyle, TickerDirection } from "./types.js";

let _messages: TickerMessage[] = [];

export const TICKER_SEPARATORS: Record<TickerStyle, string> = {
  "CNN":       "   ⚡   ",
  "BBC":       "  ·  ",
  "Bloomberg": "  |  ",
  "Fox":       "   ◆   ",
  "Sky News":  "  ●  ",
  "CNBC":      "  ▸  ",
  "Al Jazeera":"   ◆   ",
  "Modern":    "  ◆  ",
  "Minimal":   "   ·   ",
  "Glass":     "  ◆  ",
  "Election":  "  ★  ",
};

export function addTickerMessage(text: string, priority = 0, expiresInMs?: number): TickerMessage {
  const msg: TickerMessage = {
    id: `ticker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: text.trim(),
    priority,
    addedAt: Date.now(),
    expiresAt: expiresInMs ? Date.now() + expiresInMs : undefined,
  };
  _messages.push(msg);
  _messages.sort((a, b) => b.priority - a.priority);
  return msg;
}

export function removeTickerMessage(id: string): boolean {
  const before = _messages.length;
  _messages = _messages.filter(m => m.id !== id);
  return _messages.length < before;
}

export function updateTickerMessage(id: string, text: string, priority?: number): boolean {
  const m = _messages.find(m => m.id === id);
  if (!m) return false;
  m.text = text.trim();
  if (priority !== undefined) m.priority = priority;
  return true;
}

export function clearTickerMessages(): void {
  _messages = [];
}

export function getTickerMessages(): TickerMessage[] {
  pruneExpired();
  return [..._messages];
}

export function pruneExpired(): void {
  const now = Date.now();
  _messages = _messages.filter(m => !m.expiresAt || m.expiresAt > now);
}

export function buildTickerText(style: TickerStyle): string {
  pruneExpired();
  const sep = TICKER_SEPARATORS[style] ?? "   ◆   ";
  if (_messages.length === 0) return "";
  return _messages.map(m => m.text).join(sep);
}

export function addBreakingNewsMessage(text: string): TickerMessage {
  return addTickerMessage(`⚡ BREAKING: ${text}`, 100);
}

export function setTickerConfig(config: Partial<TickerConfig>): TickerConfig {
  return { ..._defaultConfig, ...config };
}

const _defaultConfig: TickerConfig = {
  style: "Al Jazeera",
  direction: "left",
  speed: 30,
  paused: false,
  separator: "   ◆   ",
};

export function getDefaultTickerConfig(): TickerConfig {
  return { ..._defaultConfig };
}

export function listTickerStyles(): TickerStyle[] {
  return Object.keys(TICKER_SEPARATORS) as TickerStyle[];
}

export function speedToSeconds(speed: number, textLength: number): number {
  // speed 10 = very fast (~8s for 100 chars), 60 = slow (~48s)
  const base = speed * 0.4 + 4;
  const charFactor = Math.max(1, textLength / 80);
  return base * charFactor;
}
