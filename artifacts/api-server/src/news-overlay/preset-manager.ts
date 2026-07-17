import fs from "fs";
import path from "path";
import { logger } from "../lib/logger.js";
import type { NewsOverlayPreset, NewsOverlayState } from "./types.js";

const PRESETS_DIR = path.resolve(process.cwd(), ".data");
const PRESETS_FILE = path.join(PRESETS_DIR, "news-overlay-presets.json");

function ensureDir(): void {
  if (!fs.existsSync(PRESETS_DIR)) fs.mkdirSync(PRESETS_DIR, { recursive: true });
}

export function loadPresets(): NewsOverlayPreset[] {
  try {
    ensureDir();
    if (!fs.existsSync(PRESETS_FILE)) return [];
    const raw = fs.readFileSync(PRESETS_FILE, "utf-8");
    return JSON.parse(raw) as NewsOverlayPreset[];
  } catch (err) {
    logger.warn({ err }, "[news-overlay] Failed to load presets");
    return [];
  }
}

function savePresets(presets: NewsOverlayPreset[]): void {
  try {
    ensureDir();
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), "utf-8");
  } catch (err) {
    logger.warn({ err }, "[news-overlay] Failed to save presets");
  }
}

export function createPreset(name: string, description: string, state: Partial<NewsOverlayState>): NewsOverlayPreset {
  const presets = loadPresets();
  const preset: NewsOverlayPreset = {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    description: description.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    state,
  };
  presets.push(preset);
  savePresets(presets);
  return preset;
}

export function updatePreset(id: string, updates: { name?: string; description?: string; state?: Partial<NewsOverlayState> }): NewsOverlayPreset | null {
  const presets = loadPresets();
  const idx = presets.findIndex(p => p.id === id);
  if (idx === -1) return null;
  presets[idx] = {
    ...presets[idx],
    ...updates,
    state: { ...presets[idx].state, ...(updates.state ?? {}) },
    updatedAt: Date.now(),
  };
  savePresets(presets);
  return presets[idx];
}

export function deletePreset(id: string): boolean {
  const presets = loadPresets();
  const filtered = presets.filter(p => p.id !== id);
  if (filtered.length === presets.length) return false;
  savePresets(filtered);
  return true;
}

export function getPreset(id: string): NewsOverlayPreset | null {
  return loadPresets().find(p => p.id === id) ?? null;
}

export function listPresets(): NewsOverlayPreset[] {
  return loadPresets().sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Built-in presets (auto-installed on first run) ────────────────────────────

export const BUILTIN_PRESETS: Array<{ name: string; description: string; state: Partial<NewsOverlayState> }> = [
  {
    name: "CNN Breaking",
    description: "CNN-style breaking news with red accent",
    state: {
      theme: "CNN",
      ticker: { style: "CNN", direction: "left", speed: 25, paused: false, separator: "   ⚡   " },
      breakingNews: { active: true, text: "BREAKING NEWS", flashInterval: 800, overridesTicker: false },
      liveBadge: { visible: true, label: "LIVE", pulse: true, color: "#cc0001" },
      enterAnimation: "Slide Up",
    },
  },
  {
    name: "Bloomberg Finance",
    description: "Bloomberg-style financial ticker",
    state: {
      theme: "Bloomberg",
      ticker: { style: "Bloomberg", direction: "left", speed: 20, paused: false, separator: "  |  " },
      breakingNews: { active: false, text: "", flashInterval: 800, overridesTicker: false },
      liveBadge: { visible: true, label: "MARKETS", pulse: false, color: "#f59e0b" },
      enterAnimation: "Fade",
    },
  },
  {
    name: "BBC World News",
    description: "BBC-style professional news ticker",
    state: {
      theme: "BBC",
      ticker: { style: "BBC", direction: "left", speed: 30, paused: false, separator: "  ·  " },
      breakingNews: { active: false, text: "", flashInterval: 800, overridesTicker: false },
      liveBadge: { visible: true, label: "LIVE COVERAGE", pulse: false, color: "#0057ff" },
      enterAnimation: "Fade",
    },
  },
  {
    name: "Minimal Clean",
    description: "Subtle, minimal overlay for professional broadcasts",
    state: {
      theme: "Minimal",
      ticker: { style: "Minimal", direction: "left", speed: 35, paused: false, separator: "   ·   " },
      breakingNews: { active: false, text: "", flashInterval: 800, overridesTicker: false },
      liveBadge: { visible: false, label: "LIVE", pulse: false, color: "#ffffff" },
      enterAnimation: "Fade",
    },
  },
  {
    name: "Election Night",
    description: "High-contrast election results style",
    state: {
      theme: "Election",
      ticker: { style: "Election", direction: "left", speed: 20, paused: false, separator: "  ★  " },
      breakingNews: { active: true, text: "ELECTION NIGHT COVERAGE", flashInterval: 600, overridesTicker: false },
      liveBadge: { visible: true, label: "ELECTION NIGHT", pulse: true, color: "#ef4444" },
      enterAnimation: "Glitch",
    },
  },
];

export function installBuiltinPresets(): void {
  const existing = loadPresets();
  if (existing.length > 0) return;
  for (const bp of BUILTIN_PRESETS) {
    createPreset(bp.name, bp.description, bp.state);
  }
  logger.info("[news-overlay] Installed built-in presets");
}
