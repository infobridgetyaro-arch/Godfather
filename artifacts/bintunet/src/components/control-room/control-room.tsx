import { useState, useEffect, useCallback, useRef } from "react";
import React from "react";
import {
  Newspaper, Megaphone, Coffee, MessageSquare, BarChart2, Users,
  ChevronDown, ChevronUp, Radio, ExternalLink, Play, Square, Image,
  Monitor, Smartphone, X, Bell, Mic, MicOff, Volume2, Loader2,
  MonitorUp, MoveUpRight, Maximize2,
  Music, SkipForward, SkipBack, Pause, ListMusic, Trash2, Plus, Upload, RefreshCw,
  Radio as RadioIcon, LayoutGrid, Heart, Server,
} from "lucide-react";
import { StatsPanel } from "./stats-panel";
import { MultiViewPanel } from "./multi-view-panel";
import { AIPanel } from "./ai-panel";
import { DonationPanel, type DonationRecord } from "./donation-panel";
import { GiftPopup, type GiftEvent } from "./gift-popup";
import { YouTubeApiPanel } from "./youtube-api-panel";
import { NewsPanel } from "./news-panel";
import { SystemPanel } from "./system-panel";
import { Key } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
}

interface StreamStats {
  subs: string | null;
  viewers: string | null;
  hasChat: boolean;
}

interface Stream {
  id: string;
  status: string;
  tiktokUsername: string;
  youtubeChannelId: string;
  youtubeSourceUrl: string;
  cameraDevice: string;
  sourceType: string;
}

interface OverlayPosition {
  x: number;
  y: number;
}

interface BroadcastState {
  newsActive: boolean;
  newsText: string;
  newsTitle: string;
  newsBgColor: string;
  newsLogo: string;
  newsScrollSpeed: number;
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
  liveAudioMuted: boolean;
  chatStyle: string;
  statsActive: boolean;
  statsStyle: string;
  statsPosition: OverlayPosition;
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  subsGoal: number;
  subChartActive: boolean;
  subChartData: number[];
  subChartPosition: OverlayPosition;
  mobileSubChartPosition: OverlayPosition;
  subAlertActive: boolean;
  subAlertMessage: string;
  chatBurnActive: boolean;
  chatBurnStyle: string;
  chatBurnPosition: OverlayPosition;
  superChatMessages: Array<{ user: string; amount: string; text: string; color: string; ts: number }>;
  guestNameActive: boolean;
  guestName: string;
  guestTitle: string;
  guestStyle: string;
  guestPosition: OverlayPosition;
  mobileGuestPosition: OverlayPosition;
  bgGradientActive: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientOpacity: number;
  mobileStatsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;
  statsScale: number;
  subsScale: number;
  chatBurnScale: number;
  newsScale: number;
  adScale: number;
  guestScale: number;
  subChartScale: number;
  globalStreamVolume: number;
  breakVideoPanX: number;
  breakVideoPanY: number;
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: OverlayPosition;
  qrScanCount: number;
  qrThankYouName: string;
  qrThankYouTs: number;
  qrGlowIntensity: number;
  qrBorderStyle: string;
  qrAnimation: string;
  screenShareActive: boolean;
  screenShareMode: "pip" | "presenter" | "fullscreen";
  screenShareX: number;
  screenShareY: number;
  screenShareW: number;
  screenShareRadius: number;
  // Donation gateway
  donationTickerActive: boolean;
  donationAlertActive: boolean;
  donationTicker: Array<{ name: string; amount: string; amountKes: number; color: string; ts: number }>;
  thankYouStyle: string;
  // News ticker loop
  newsTickerLoopSecs: number;
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
  logoAnimGap: number;
}

interface ControlRoomProps {
  streams: Stream[];
  streamStats: Record<string, StreamStats>;
  streamChat: Record<string, ChatMessage[]>;
  streamProcStats?: Record<string, { cpu: number; mem: number; frames?: number; uptime?: number }>;
  onForceRefreshChat?: () => void;
}

type Tab = "ai" | "news" | "ads" | "break" | "chat" | "stats" | "subs" | "bg" | "alerts" | "mic" | "qr" | "donate" | "screen" | "music" | "stage" | "yt-api" | "system";
type EditMode = "desktop" | "mobile";

const TABS: { id: Tab; label: string; icon: React.ReactNode; accent: string }[] = [
  { id: "ai",     label: "AI",        icon: <span style={{ fontSize: 12 }}>✦</span>,  accent: "#a78bfa" },
  { id: "stats",  label: "Stats",     icon: <BarChart2 size={13} />,     accent: "#a78bfa" },
  { id: "subs",   label: "Subs",      icon: <Users size={13} />,         accent: "#818cf8" },
  { id: "chat",   label: "Chat",      icon: <MessageSquare size={13} />, accent: "#34d399" },
  { id: "news",   label: "News",      icon: <Newspaper size={13} />,     accent: "#667eea" },
  { id: "alerts", label: "Alerts",    icon: <Bell size={13} />,          accent: "#f97316" },
  { id: "ads",    label: "Ads",       icon: <Megaphone size={13} />,     accent: "#f093fb" },
  { id: "break",  label: "Break",     icon: <Coffee size={13} />,        accent: "#f59e0b" },
  { id: "bg",     label: "BG",        icon: <Image size={13} />,         accent: "#fb7185" },
  { id: "mic",    label: "Mic",       icon: <Mic size={13} />,           accent: "#10b981" },
  { id: "qr",     label: "QR",       icon: <span style={{ fontSize: 11 }}>▣</span>, accent: "#06b6d4" },
  { id: "donate", label: "SuperChat", icon: <Heart size={13} />,                      accent: "#22c55e" },
  { id: "screen", label: "Screen",  icon: <MonitorUp size={13} />,                   accent: "#818cf8" },
  { id: "music",  label: "Music",    icon: <Music size={13} />,                       accent: "#f472b6" },
  { id: "stage",  label: "Stage",    icon: <LayoutGrid size={13} />,                  accent: "#a78bfa" },
  { id: "yt-api", label: "YT Keys",  icon: <Key size={13} />,                         accent: "#ef4444" },
  { id: "system", label: "System",   icon: <Server size={13} />,                      accent: "#38bdf8" },
];

const AD_STYLES         = ["Banner", "Card", "Corner Pop", "Fullscreen", "Strip"] as const;
const BREAK_STYLES      = ["Video Play", "Countdown", "Wave", "Glass", "Neon", "Minimal", "Gradient"] as const;
const CHAT_STYLES       = ["TV", "Bubble", "Neon", "Glass", "Compact", "Toast"] as const;
const STATS_STYLES      = ["TV", "Neon", "Glass", "YouTube", "Sport"] as const;
const SUB_STYLES        = ["HUD", "Minimal", "Animated", "Card", "Goal", "Neon", "Glass", "Sport", "Cinema"] as const;
const CHAT_BURN_STYLES  = ["Bubble", "Float", "Sidebar", "Highlight", "Ticker"] as const;
const GUEST_STYLES      = ["Classic", "Neon", "Gradient", "Minimal", "Sports"] as const;
const LOGO_ANIMATIONS   = ["None", "Fade", "Slide In", "Zoom", "Bounce", "Spin"] as const;
const LOGO_BG_SHAPES    = ["circle", "rounded", "square"] as const;

/** Best-effort rgba()/hex → hex, for feeding an <input type="color"> which only accepts #rrggbb. */
function rgbaToHex(color: string): string {
  if (color.startsWith("#")) return color.length === 7 ? color : "#000000";
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return "#000000";
  const toHex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

const SUPERCHAT_TIERS = [
  { label: "$1",   min: 1,   max: 2,    color: "#1565C0" },
  { label: "$2",   min: 2,   max: 5,    color: "#006064" },
  { label: "$5",   min: 5,   max: 10,   color: "#00695C" },
  { label: "$10",  min: 10,  max: 20,   color: "#F57F17" },
  { label: "$20",  min: 20,  max: 50,   color: "#E65100" },
  { label: "$50",  min: 50,  max: 100,  color: "#AD1457" },
  { label: "$100", min: 100, max: Infinity, color: "#B71C1C" },
];

function superChatColor(amount: number): string {
  return SUPERCHAT_TIERS.find((t) => amount >= t.min && amount < t.max)?.color ?? "#1565C0";
}

async function sendBroadcastPatch(patch: Partial<BroadcastState>) {
  try {
    await fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
  } catch {}
}

// Per-field debounce buffers, keyed by the sorted set of field names in the
// patch. A drag-driven slider (size, ticker loop pause, etc.) fires onChange
// on every pixel of movement — without coalescing, each tick sends its own
// POST /api/broadcast, and slow/out-of-order responses race each other so
// the server can end up applying an intermediate drag value instead of the
// final one, making the slider "sometimes not take effect". Debouncing per
// field lets the UI update instantly (via optimistic local state) while only
// the *last* value in a burst is actually sent to the server.
const _broadcastDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const _broadcastDebounceBuffers: Record<string, Partial<BroadcastState>> = {};

async function pushBroadcast(patch: Partial<BroadcastState>, debounceMs = 0) {
  if (debounceMs <= 0) {
    await sendBroadcastPatch(patch);
    return;
  }
  const key = Object.keys(patch).sort().join(",");
  _broadcastDebounceBuffers[key] = { ..._broadcastDebounceBuffers[key], ...patch };
  if (_broadcastDebounceTimers[key]) clearTimeout(_broadcastDebounceTimers[key]);
  _broadcastDebounceTimers[key] = setTimeout(() => {
    const buffered = _broadcastDebounceBuffers[key];
    delete _broadcastDebounceBuffers[key];
    delete _broadcastDebounceTimers[key];
    if (buffered) sendBroadcastPatch(buffered);
  }, debounceMs);
}

// ── Shared UI components ────────────────────────────────────────────────────

function StylePills({ styles, current, accent, onSelect }: {
  styles: readonly string[];
  current: string;
  accent: string;
  onSelect: (s: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {styles.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          style={{
            padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${current === s ? accent : "rgba(255,255,255,0.1)"}`,
            background: current === s ? `${accent}22` : "transparent",
            color: current === s ? "#fff" : "rgba(255,255,255,0.45)",
            transition: "all 0.18s ease",
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12,
        outline: "none", fontFamily: "inherit",
      }}
    />
  );
}

function NumberInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      placeholder={placeholder}
      style={{
        flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12,
        outline: "none", fontFamily: "inherit",
      }}
    />
  );
}

function PositionSliders({ pos, onChange, label, accent }: {
  pos: OverlayPosition;
  onChange: (p: OverlayPosition) => void;
  label?: string;
  accent?: string;
}) {
  const defaultPos = useRef<OverlayPosition>(pos);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label || "Position"}
      </div>
      {(["x", "y"] as const).map((axis) => {
        const delta = pos[axis] - defaultPos.current[axis];
        return (
          <div key={axis} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 14, fontWeight: 700 }}>
                {axis.toUpperCase()}
              </span>
              <input
                type="range"
                min={0} max={100} step={1}
                value={pos[axis]}
                onChange={(e) => onChange({ ...pos, [axis]: Number(e.target.value) })}
                style={{ flex: 1, accentColor: accent || "#667eea", cursor: "pointer" }}
              />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 30, textAlign: "right" }}>
                {pos[axis]}%
              </span>
            </div>
            <div style={{ paddingLeft: 24, minHeight: 16 }}>
              {delta !== 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                  color: delta > 0 ? "#34d399" : "#f87171",
                  background: delta > 0 ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                  border: `1px solid ${delta > 0 ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                  borderRadius: 4, padding: "1px 6px",
                }}>
                  {delta > 0 ? "+" : ""}{delta}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditModeToggle({ mode, onChange }: { mode: EditMode; onChange: (m: EditMode) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, padding: "3px", borderRadius: 9, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {(["desktop", "mobile"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 9px", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${mode === m ? "rgba(167,139,250,0.6)" : "transparent"}`,
            background: mode === m ? "rgba(167,139,250,0.18)" : "transparent",
            color: mode === m ? "#d8b4fe" : "rgba(255,255,255,0.35)",
            transition: "all 0.18s ease",
          }}
        >
          {m === "desktop" ? <Monitor size={10} /> : <Smartphone size={10} />}
          {m === "desktop" ? "Desktop" : "Mobile"}
        </button>
      ))}
    </div>
  );
}

/**
 * Go Live button with 3-second countdown.
 * - Activating: shows countdown, then applies.
 * - Deactivating: applies immediately.
 */
function ToggleButton({ active, onActivate, onDeactivate, accent, countdownSecs, onCancel }: {
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  accent: string;
  countdownSecs?: number | null;
  onCancel?: () => void;
}) {
  if (countdownSecs != null && countdownSecs > 0) {
    return (
      <button
        onClick={onCancel}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
          border: "1px solid rgba(251,191,36,0.55)",
          background: "rgba(251,191,36,0.12)",
          color: "#fbbf24",
          transition: "all 0.2s ease", flexShrink: 0,
          animation: "cr-fade-in 0.2s ease",
        }}
      >
        <X size={10} />
        Going live in {countdownSecs}s — tap to cancel
      </button>
    );
  }
  return (
    <button
      onClick={() => active ? onDeactivate() : onActivate()}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${active ? "#e53e3e" : accent}`,
        background: active ? "rgba(229,62,62,0.15)" : `${accent}18`,
        color: active ? "#fc8181" : "#fff",
        transition: "all 0.2s ease", flexShrink: 0,
      }}
    >
      {active ? <><Square size={10} /> Stop</> : <><Play size={10} /> Go Live</>}
    </button>
  );
}

function LiveBadge({ label, active, accent }: { label: string; active: boolean; accent: string }) {
  if (!active) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 8,
      background: `${accent}15`, border: `1px solid ${accent}40`,
      animation: "cr-fade-in 0.3s ease",
    }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, animation: "cr-pulse 1.2s infinite" }} />
      <span style={{ color: accent, fontSize: 11, fontWeight: 700 }}>{label} is LIVE on stage</span>
    </div>
  );
}

function SizeSlider({ value, onChange, accent, max = 200 }: {
  value: number;
  onChange: (v: number) => void;
  accent?: string;
  max?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Size
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", width: 24 }}>50%</span>
        <input
          type="range"
          min={50} max={max} step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: accent || "#667eea", cursor: "pointer" }}
        />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", width: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {value}%
        </span>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
    </div>
  );
}

// Apply button with brief "Saved ✓" flash feedback
function MicApplyButton({ onClick }: { onClick: () => void }) {
  const [saved, setSaved] = React.useState(false);
  const handleClick = () => {
    onClick();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  return (
    <button
      onClick={handleClick}
      title="Apply volume to all active streams (triggers a brief ~200ms fast-restart)"
      style={{
        padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${saved ? "rgba(16,185,129,0.5)" : "rgba(167,139,250,0.4)"}`,
        background: saved ? "rgba(16,185,129,0.12)" : "rgba(167,139,250,0.12)",
        color: saved ? "#6ee7b7" : "#a78bfa",
        whiteSpace: "nowrap",
        transition: "all 0.2s ease",
      }}
    >
      {saved ? "Saved ✓" : "Apply"}
    </button>
  );
}

// ── Break Panel (inline component) ──────────────────────────────────────────

function BreakPanel({
  bs, localUpdate, update, goLive, cancelGoLive, stopOverlay, countdowns, activeStreamCount,
}: {
  bs: BroadcastState;
  localUpdate: (p: Partial<BroadcastState>) => void;
  update: (p: Partial<BroadcastState>) => void;
  goLive: (key: string, patch: Partial<BroadcastState>) => void;
  cancelGoLive: (key: string) => void;
  stopOverlay: (patch: Partial<BroadcastState>) => void;
  countdowns: Record<string, number>;
  activeStreamCount: number;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [preloadStatus, setPreloadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const preloadPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const accent = "#f59e0b";

  useEffect(() => {
    const url = (bs.breakVideoUrl ?? "").trim();
    setPreloadStatus("idle");
    if (preloadPollRef.current) { clearInterval(preloadPollRef.current); preloadPollRef.current = null; }
    if (!url || !/youtube\.com|youtu\.be/.test(url)) return;
    setPreloadStatus("loading");
    fetch("/api/break-video/preload", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => {});
    const pollOnce = async () => {
      try {
        const r = await fetch(`/api/break-video/preload-status?url=${encodeURIComponent(url)}`, { credentials: "include" });
        if (!r.ok) return;
        const d = await r.json();
        if (d.status === "ready") { setPreloadStatus("ready"); if (preloadPollRef.current) { clearInterval(preloadPollRef.current); preloadPollRef.current = null; } }
        else if (d.status === "error") { setPreloadStatus("error"); if (preloadPollRef.current) { clearInterval(preloadPollRef.current); preloadPollRef.current = null; } }
      } catch {}
    };
    void pollOnce();
    preloadPollRef.current = setInterval(pollOnce, 2500);
    return () => { if (preloadPollRef.current) clearInterval(preloadPollRef.current); };
  }, [bs.breakVideoUrl]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("video", file);
      const res = await fetch("/api/upload/break-video", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      update({ breakVideoUrl: data.url });
    } catch {
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Status + Go Live banner ─────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: "10px 14px", borderRadius: 12,
        background: bs.breakActive
          ? "linear-gradient(135deg, rgba(245,158,11,0.18), rgba(217,119,6,0.10))"
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${bs.breakActive ? "rgba(245,158,11,0.45)" : "rgba(255,255,255,0.08)"}`,
        transition: "all 0.3s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: bs.breakActive ? accent : "rgba(255,255,255,0.2)",
            boxShadow: bs.breakActive ? `0 0 10px ${accent}` : "none",
            animation: bs.breakActive ? "cr-pulse 1.4s infinite" : "none",
          }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: bs.breakActive ? "#fcd34d" : "rgba(255,255,255,0.55)", whiteSpace: "nowrap" }}>
            {bs.breakActive ? "Break is LIVE" : "Break is Off"}
          </span>
          {activeStreamCount === 0 && !bs.breakActive && (
            <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 99, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", flexShrink: 0 }}>
              No stream running
            </span>
          )}
          {bs.breakActive && (
            <span style={{ fontSize: 10, color: "#fbbf24", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {bs.breakStyle}
            </span>
          )}
        </div>
        <ToggleButton
          active={bs.breakActive}
          accent={accent}
          countdownSecs={countdowns["break"]}
          onCancel={() => cancelGoLive("break")}
          onActivate={() => goLive("break", {
            breakActive: true,
            breakText: bs.breakText,
            breakStyle: bs.breakStyle,
            breakVideoUrl: bs.breakVideoUrl,
            breakVideoMode: bs.breakVideoMode,
            breakVideoMuted: bs.breakVideoMuted,
            breakVideoPanX: bs.breakVideoPanX,
            breakVideoPanY: bs.breakVideoPanY,
            bgGradient1: bs.bgGradient1,
            bgGradient2: bs.bgGradient2,
            bgGradientOpacity: bs.bgGradientOpacity,
          })}
          onDeactivate={() => stopOverlay({ breakActive: false })}
        />
      </div>

      {/* ── Video Source ─────────────────────────────────────────────── */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "8px 14px 7px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.09em" }}>🎬 Video Source</span>
          {preloadStatus === "loading" && (
            <span style={{ fontSize: 9, color: "#93c5fd", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ animation: "cr-spin 1s linear infinite", display: "inline-block" }}>⟳</span> Pre-loading…
            </span>
          )}
          {preloadStatus === "ready"  && <span style={{ fontSize: 9, fontWeight: 700, color: "#34d399" }}>✓ Ready instantly</span>}
          {preloadStatus === "error"  && <span style={{ fontSize: 9, color: "#fbbf24" }}>⚠ Resolves on Go Live</span>}
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={bs.breakVideoUrl}
              onChange={(e) => update({ breakVideoUrl: e.target.value })}
              placeholder="Paste YouTube or video URL…"
              style={{
                flex: 1, padding: "8px 11px", borderRadius: 8, fontSize: 11,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff", outline: "none",
              }}
            />
            <input ref={fileInputRef} type="file" accept="video/*" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleUpload(f); e.target.value = ""; } }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                padding: "0 12px", borderRadius: 8, fontSize: 11, fontWeight: 700, flexShrink: 0,
                cursor: uploading ? "not-allowed" : "pointer",
                border: `1px solid rgba(245,158,11,0.35)`,
                background: "rgba(245,158,11,0.08)", color: "#fbbf24",
                opacity: uploading ? 0.5 : 1,
              }}
            >{uploading ? "⏳ Uploading…" : "📁 Upload"}</button>
          </div>

          {/* Preview */}
          {bs.breakVideoUrl && (() => {
            const ytMatch = bs.breakVideoUrl.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/);
            return ytMatch?.[1] ? (
              <div style={{ borderRadius: 8, overflow: "hidden", background: "#000" }}>
                <iframe
                  key={bs.breakVideoUrl}
                  src={`https://www.youtube.com/embed/${ytMatch[1]}?autoplay=0&controls=1`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ width: "100%", height: 160, border: "none", display: "block" }}
                />
              </div>
            ) : /youtube\.com|youtu\.be/.test(bs.breakVideoUrl) ? (
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 10, color: "#fcd34d" }}>
                YouTube link saved — yt-dlp extracts it when break goes live.
              </div>
            ) : (
              <div style={{ borderRadius: 8, overflow: "hidden", background: "#000", border: "1px solid rgba(245,158,11,0.15)" }}>
                <video key={bs.breakVideoUrl} src={bs.breakVideoUrl} controls loop
                  style={{ width: "100%", maxHeight: 150, display: "block" }} />
              </div>
            );
          })()}

          {bs.breakVideoUrl && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => update({ breakVideoUrl: "" })}
                style={{ background: "none", border: "none", fontSize: 10, color: "rgba(255,255,255,0.28)", cursor: "pointer" }}>
                ✕ Remove video
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Style & Message ───────────────────────────────────────────── */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "8px 14px 7px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.09em" }}>🎨 Style & Message</span>
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
          <TextInput value={bs.breakText} onChange={(v) => localUpdate({ breakText: v })} placeholder="Break message text…" />
          <StylePills styles={BREAK_STYLES} current={bs.breakStyle} accent={accent} onSelect={(s) => localUpdate({ breakStyle: s })} />
        </div>
      </div>

      {/* ── Background Mode ───────────────────────────────────────────── */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "8px 14px 7px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.09em" }}>📺 Background Mode</span>
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {([
              { mode: "fullscreen"  as const, icon: "⬛", label: "Full Screen", hint: "Video fills frame" },
              { mode: "live-bg"     as const, icon: "📹", label: "Live BG",     hint: "Stream in bars" },
              { mode: "gradient-bg" as const, icon: "🎨", label: "Gradient BG", hint: "Colour in bars" },
            ] as const).map(({ mode, icon, label, hint }) => (
              <button
                key={mode}
                onClick={() => update({ breakVideoMode: mode })}
                style={{
                  padding: "10px 4px", borderRadius: 10, fontSize: 10, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${bs.breakVideoMode === mode ? accent : "rgba(255,255,255,0.08)"}`,
                  background: bs.breakVideoMode === mode ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.03)",
                  color: bs.breakVideoMode === mode ? "#fcd34d" : "rgba(255,255,255,0.4)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  transition: "all 0.18s",
                }}
              >
                <span style={{ fontSize: 18 }}>{icon}</span>
                <span>{label}</span>
                <span style={{ fontSize: 8, fontWeight: 400, color: bs.breakVideoMode === mode ? "rgba(252,211,77,0.6)" : "rgba(255,255,255,0.25)" }}>{hint}</span>
              </button>
            ))}
          </div>

          {/* Gradient colour pickers (only when gradient-bg) */}
          {bs.breakVideoMode === "gradient-bg" && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              {(["bgGradient1", "bgGradient2"] as const).map((field, i) => (
                <div key={field} style={{ flex: 1 }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    BG Colour {i + 1}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="color" value={(bs as any)[field]}
                      onChange={(e) => localUpdate({ [field]: e.target.value } as any)}
                      style={{ width: 36, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", padding: 2 }} />
                    <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.35)" }}>{(bs as any)[field]}</span>
                  </div>
                </div>
              ))}
              <div style={{
                width: 44, height: 26, borderRadius: 6, flexShrink: 0,
                background: `linear-gradient(135deg, ${bs.bgGradient1}, ${bs.bgGradient2})`,
                border: "1px solid rgba(255,255,255,0.12)",
              }} />
            </div>
          )}

          {/* Video pan — only when a video URL is set */}
          {bs.breakVideoUrl && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Video Pan</span>
              {(["X", "Y"] as const).map((axis) => {
                const field = axis === "X" ? "breakVideoPanX" : "breakVideoPanY";
                return (
                  <div key={axis} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", width: 10, flexShrink: 0 }}>{axis}</span>
                    <input type="range" min={0} max={100} value={bs[field] ?? 50}
                      onChange={(e) => update({ [field]: Number(e.target.value) } as any)}
                      style={{ flex: 1, accentColor: accent }} />
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", width: 28, textAlign: "right", fontFamily: "monospace", flexShrink: 0 }}>
                      {bs[field] ?? 50}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Audio Controls ────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 7 }}>
        {([
          { label: "Video Audio", key: "breakVideoMuted" as const, onIcon: "🎥", title: "Mute/unmute break video audio in browser preview" },
          { label: "Stream Audio", key: "liveAudioMuted" as const, onIcon: "📡", title: "Mute/unmute live stream audio in RTMP output" },
        ] as const).map(({ label, key, onIcon, title }) => (
          <button
            key={key} title={title}
            onClick={() => update({ [key]: !bs[key] } as any)}
            style={{
              flex: 1, padding: "8px 6px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${bs[key] ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.1)"}`,
              background: bs[key] ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
              color: bs[key] ? "#f87171" : "rgba(255,255,255,0.45)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all 0.18s",
            }}
          >
            <span style={{ fontSize: 14 }}>{bs[key] ? "🔇" : onIcon}</span>
            {label}: <strong>{bs[key] ? "Muted" : "On"}</strong>
          </button>
        ))}
      </div>

    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ControlRoom({ streams, streamStats, streamChat, streamProcStats = {}, onForceRefreshChat }: ControlRoomProps) {

  // Force-refresh chat: call the backend refresh endpoint for each YouTube stream
  // so the server polls YouTube API immediately, then trigger local re-fetch.
  const [isRefreshingChat, setIsRefreshingChat] = useState(false);
  const [chatRefreshMessage, setChatRefreshMessage] = useState<string | null>(null);

  const handleForceRefreshChat = useCallback(async () => {
    if (isRefreshingChat) return;
    setIsRefreshingChat(true);
    setChatRefreshMessage("Checking YouTube for live status…");

    const ytStreams = streams.filter(
      (s) => s.youtubeSourceUrl || (s as any).youtubeChannelId || (s as any).sourceType === "youtube"
    );
    const ids = ytStreams.length > 0 ? ytStreams.map((s) => s.id) : streams.map((s) => s.id);

    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/streams/${id}/chat/refresh`, {
              method: "POST",
              credentials: "include",
            });
            return await res.json();
          } catch {
            return null;
          }
        })
      );

      onForceRefreshChat?.();

      const live = results.find((r) => r && r.isLive);
      if (live) {
        const viewers = live.viewers ? `${live.viewers} watching` : "viewer count unavailable";
        setChatRefreshMessage(`🔴 Channel is live — ${viewers}`);
      } else {
        const failed = results.find((r) => r && r.error && r.error !== "not_live");
        if (failed) {
          setChatRefreshMessage(`Couldn't verify live status: ${failed.error}`);
        } else {
          setChatRefreshMessage("Channel is not live right now");
        }
      }
    } catch (e: any) {
      setChatRefreshMessage(`Refresh failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setIsRefreshingChat(false);
      setTimeout(() => setChatRefreshMessage(null), 6000);
    }
  }, [streams, onForceRefreshChat, isRefreshingChat]);

  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [collapsed, setCollapsed] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("desktop");

  // Local UI state — changes here are NOT pushed to the server until Go Live is tapped
  const [bs, setBs] = useState<BroadcastState>({
    newsActive: false, newsText: "Welcome to the live stream! Stay tuned for more updates.",
    newsTitle: "", newsBgColor: "#cc0001", newsLogo: "", newsScrollSpeed: 30,
    newsStyle: "Al Jazeera", newsAnimation: "Fade",
    newsPosition: { x: 0, y: 95 },
    adActive: false, adText: "Big Sale — 50% Off Today Only!", adSub: "Use code LIVE at checkout.", adStyle: "Banner",
    adPosition: { x: 0, y: 0 },
    breakActive: false, breakText: "Be right back — taking a short break!", breakStyle: "Countdown", breakVideoUrl: "", breakVideoMode: "live-bg", breakVideoMuted: false, liveAudioMuted: false,
    chatStyle: "TV",
    statsActive: false, statsStyle: "TV", statsPosition: { x: 2, y: 2 },
    subsOverlayActive: false, subsStyle: "HUD", subsPosition: { x: 72, y: 2 }, subsGoal: 1000000,
    subChartActive: false, subChartData: [], subChartPosition: { x: 68, y: 8 }, mobileSubChartPosition: { x: 5, y: 8 },
    subAlertActive: false, subAlertMessage: "",
    chatBurnActive: false, chatBurnStyle: "Bubble", chatBurnPosition: { x: 2, y: 62 },
    superChatMessages: [],
    guestNameActive: false, guestName: "Guest Name", guestTitle: "Title / Channel", guestStyle: "Classic",
    guestPosition: { x: 2, y: 78 }, mobileGuestPosition: { x: 2, y: 78 },
    bgGradientActive: false, bgGradient1: "#6d28d9", bgGradient2: "#0891b2", bgGradientOpacity: 0.45,
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
    breakVideoPanX: 50,
    breakVideoPanY: 50,
    qrActive: false,
    qrUrl: "",
    qrTitle: "",
    qrSize: 160,
    qrPosition: { x: 88, y: 10 },
    qrScanCount: 0,
    qrThankYouName: "",
    qrThankYouTs: 0,
    qrGlowIntensity: 60,
    qrBorderStyle: "glow",
    qrAnimation: "pulse",
    screenShareActive: false,
    screenShareMode: "presenter",
    screenShareX: 60,
    screenShareY: 5,
    screenShareW: 38,
    screenShareRadius: 12,
    donationTickerActive: false,
    donationAlertActive: true,
    donationTicker: [],
    thankYouStyle: "Classic",
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
  });
  const volDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrPosDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newsPosDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SuperChat QR overlay state ───────────────────────────────────────────
  const [qrLocked,         setQrLocked]         = useState(false);
  const [qrGatewayUrl,     setQrGatewayUrl]     = useState("");
  const [qrGatewayLoading, setQrGatewayLoading] = useState(false);

  const fetchQrGatewayUrl = useCallback(async () => {
    setQrGatewayLoading(true);
    try {
      const r = await fetch("/api/gateway/url", { credentials: "include" });
      if (r.ok) {
        const d = await r.json() as { gatewayUrl?: string };
        if (d.gatewayUrl) setQrGatewayUrl(d.gatewayUrl);
      }
    } catch {}
    setQrGatewayLoading(false);
  }, []);

  useEffect(() => { void fetchQrGatewayUrl(); }, [fetchQrGatewayUrl]);

  // ── Paystack superchat payment state ─────────────────────────────────────
  type PayStatus = "idle" | "loading" | "active" | "scanned" | "paid" | "error";
  const [payStreamId, setPayStreamId] = useState("");
  const [payTitle,    setPayTitle]    = useState("Super Chat");
  const [payAmount,   setPayAmount]   = useState("");
  const [payStatus,   setPayStatus]   = useState<PayStatus>("idle");
  const [payQrUrl,    setPayQrUrl]    = useState("");
  const [payerName,   setPayerName]   = useState("");
  const [payError,    setPayError]    = useState("");

  const initiatePayment = useCallback(async () => {
    if (!payStreamId || !payAmount) return;
    setPayStatus("loading");
    setPayError("");
    try {
      const r = await fetch("/api/paystack/init", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId: payStreamId, title: payTitle || "Super Chat", amount: parseFloat(payAmount) }),
      });
      const d = await r.json() as { scanUrl?: string; error?: string };
      if (!r.ok || !d.scanUrl) {
        setPayStatus("error");
        setPayError(d.error ?? "Failed to create payment");
        return;
      }
      setPayQrUrl(d.scanUrl);
      setPayStatus("active");
    } catch {
      setPayStatus("error");
      setPayError("Network error — try again");
    }
  }, [payStreamId, payTitle, payAmount]);

  const resetPayment = useCallback(async () => {
    if (payStreamId) {
      await fetch(`/api/paystack/reset?streamId=${encodeURIComponent(payStreamId)}`, {
        method: "DELETE", credentials: "include",
      }).catch(() => {});
    }
    setPayStatus("idle");
    setPayQrUrl("");
    setPayerName("");
    setPayError("");
  }, [payStreamId]);

  // ── Screen Share WebSocket ───────────────────────────────────────────────
  const [screenActive, setScreenActive] = useState(false);
  const [screenConnecting, setScreenConnecting] = useState(false);
  const [screenReconnecting, setScreenReconnecting] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screenElapsed, setScreenElapsed] = useState(0);
  const screenWsRef = useRef<WebSocket | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenStreamAliveRef = useRef(false); // stays true while track is live
  const screenRafRef = useRef<number>(0);
  const [screenPreviewUrl, setScreenPreviewUrl] = useState<string | null>(null);

  const startScreenShare = useCallback(async () => {
    setScreenError(null);
    setScreenConnecting(true);
    try {
      if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        throw Object.assign(
          new Error("Screen capture is not available here. Open the app in a new browser tab and try again."),
          { name: "NotSupportedError" }
        );
      }

      // Some Android Chrome builds expose getDisplayMedia() (for spec
      // compliance) but silently never resolve/reject the promise and never
      // hand off to the OS screen-recorder — no dialog, no error, nothing.
      // This happens when the device/Chrome build lacks MediaProjection
      // wiring for web screen capture. Without a timeout the UI would hang
      // on "Connecting..." forever with zero feedback. Race a 10s timeout so
      // we can surface a concrete, actionable message instead.
      const chromeMatch = navigator.userAgent.match(/Chrome\/(\d+)/);
      const chromeVersion = chromeMatch ? parseInt(chromeMatch[1], 10) : null;
      const isAndroid = /Android/i.test(navigator.userAgent);

      const stream = await Promise.race<MediaStream>([
        navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 30 },
            // NOTE: do NOT set displaySurface here — passing it as a video constraint
            // filters the picker on Chrome/Edge to only show the matching surface type,
            // which blocks users from picking native app windows. Let the browser show
            // all surface types (Entire Screen, Window, Tab) and accept whatever the
            // user picks.
          } as MediaTrackConstraints,
          audio: false,
          // @ts-ignore — suppress self-tab from appearing in picker
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            reject(Object.assign(
              new Error(
                isAndroid
                  ? `No screen-capture prompt appeared after 10s. Your device's Chrome build` +
                    (chromeVersion ? ` (v${chromeVersion})` : "") +
                    ` doesn't support in-browser screen capture (Android's MediaProjection handoff isn't wired up on this device/ROM). ` +
                    `Try: 1) Update Chrome from the Play Store, 2) Make sure you're using Chrome (not Samsung Internet, Brave, or an in-app browser), ` +
                    `3) If it still doesn't prompt, this device/browser combo doesn't support web screen capture — use a desktop browser (Chrome/Firefox/Edge) instead.`
                  : "No screen-capture prompt appeared after 10s. Your browser may not support this feature — try Chrome, Firefox, or Edge on desktop."
              ),
              { name: "NoPromptTimeout" }
            ));
          }, 10000)
        ),
      ]);

      // Accept any display surface — monitor, window, or browser tab
      const videoTrack = stream.getVideoTracks()[0];

      screenStreamRef.current = stream;
      screenStreamAliveRef.current = true;

      const canvas = document.createElement("canvas");
      screenCanvasRef.current = canvas;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      // ── Elapsed-time counter ─────────────────────────────────────────────
      setScreenElapsed(0);
      if (screenElapsedRef.current) clearInterval(screenElapsedRef.current);
      screenElapsedRef.current = setInterval(() => setScreenElapsed((s) => s + 1), 1000);

      // ── Inner WS connector — called again on every reconnect ─────────────
      let reconnectDelay = 1500;
      const connectScreenWs = () => {
        if (!screenStreamAliveRef.current) return;
        setScreenReconnecting(false);

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${window.location.host}/ws-screen`);
        screenWsRef.current = ws;
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          reconnectDelay = 1500; // reset on successful open
          ws.send(JSON.stringify({ type: "screen_auth", sessionId: crypto.randomUUID() }));
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "screen_auth_ok") {
              setScreenConnecting(false);
              setScreenReconnecting(false);
              setScreenActive(true);
              update({ screenShareActive: true });

              // Initialise canvas once at stream resolution
              const waitForDimensions = () => {
                if (!video.videoWidth || !video.videoHeight) {
                  requestAnimationFrame(waitForDimensions);
                  return;
                }
                // Cap at 960px — fast enough to encode without lag
                const MAX_W = 960;
                const aspect = video.videoWidth / video.videoHeight;
                canvas.width = Math.min(video.videoWidth, MAX_W);
                canvas.height = Math.round(canvas.width / aspect);
                const ctx2d = canvas.getContext("2d", { willReadFrequently: false })!;

                // rAF loop at 24 fps — synced to display, no drift, no dropped frames
                const TARGET_FPS = 24;
                const FRAME_MS = 1000 / TARGET_FPS;
                let lastCapture = 0;
                let blobPending = false;

                const captureFrame = (now: number) => {
                  if (!screenStreamAliveRef.current) return;
                  screenRafRef.current = requestAnimationFrame(captureFrame);

                  if (now - lastCapture < FRAME_MS) return;    // rate-limit to 24 fps
                  if (ws.readyState !== WebSocket.OPEN) return;
                  if ((ws as any).bufferedAmount > 512 * 1024) return; // WS backpressure
                  if (blobPending) return;                       // skip if encoder is busy

                  lastCapture = now;
                  blobPending = true;
                  ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
                  canvas.toBlob((blob) => {
                    blobPending = false;
                    if (!blob || ws.readyState !== WebSocket.OPEN) return;
                    blob.arrayBuffer().then((ab) => {
                      if (ws.readyState === WebSocket.OPEN) ws.send(ab);
                    });
                    const url = URL.createObjectURL(blob);
                    setScreenPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
                  }, "image/jpeg", 0.75);
                };

                screenRafRef.current = requestAnimationFrame(captureFrame);
              };
              waitForDimensions();
            }
          } catch {}
        };

        ws.onerror = () => {
          // Errors always fire before onclose — onclose handles reconnect
        };

        ws.onclose = () => {
          cancelAnimationFrame(screenRafRef.current);
          screenRafRef.current = 0;

          if (!screenStreamAliveRef.current) {
            // User deliberately stopped — clean up fully
            setScreenActive(false);
            setScreenConnecting(false);
            setScreenReconnecting(false);
            return;
          }

          // Stream is still alive — auto-reconnect with backoff
          setScreenReconnecting(true);
          const delay = Math.min(reconnectDelay, 15000);
          reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
          setTimeout(connectScreenWs, delay);
        };
      };

      connectScreenWs();

      // Auto-stop when user dismisses share from the browser's native UI
      stream.getVideoTracks()[0].onended = () => stopScreenShare();

    } catch (e: any) {
      const msg =
        e?.name === "NotAllowedError" ? "Permission denied — click Allow when the browser asks." :
        e?.name === "NotSupportedError" ? e.message :
        e?.name === "NoPromptTimeout" ? e.message :
        `Error: ${e?.message ?? e}`;
      setScreenError(msg);
      setScreenConnecting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScreenShare = useCallback(() => {
    screenStreamAliveRef.current = false;
    cancelAnimationFrame(screenRafRef.current);
    screenRafRef.current = 0;
    if (screenElapsedRef.current) { clearInterval(screenElapsedRef.current); screenElapsedRef.current = null; }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    screenWsRef.current?.close();
    screenWsRef.current = null;
    setScreenActive(false);
    setScreenConnecting(false);
    setScreenReconnecting(false);
    setScreenElapsed(0);
    setScreenPreviewUrl(null);
    update({ screenShareActive: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Music player ─────────────────────────────────────────────────────────
  interface MusicTrack { id: string; title: string; url: string; isFile?: boolean; originalUrl?: string; }

  const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(70);
  const [musicBroadcast, setMusicBroadcast] = useState(false);
  const [musicBroadcastActive, setMusicBroadcastActive] = useState(false);
  const [musicProgress, setMusicProgress] = useState(0); // 0-1
  const [musicDuration, setMusicDuration] = useState(0);
  const [musicCurrentTime, setMusicCurrentTime] = useState(0);
  const [musicAddUrl, setMusicAddUrl] = useState("");
  const [musicAddTitle, setMusicAddTitle] = useState("");
  const [musicError, setMusicError] = useState<string | null>(null);

  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicCtxRef = useRef<AudioContext | null>(null);
  const musicSrcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const musicGainNodeRef = useRef<GainNode | null>(null);
  const musicProcessorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const musicWsRef = useRef<WebSocket | null>(null);
  const musicFileInputRef = useRef<HTMLInputElement | null>(null);
  const musicProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs so onerror (created once) can always access current state
  const playlistRef = useRef<MusicTrack[]>([]);
  const currentIdxRef = useRef<number | null>(null);
  const refreshTrackRef = useRef<((id: string) => Promise<void>) | null>(null);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);

  // Ensure audio element exists
  const getMusicAudio = useCallback((): HTMLAudioElement => {
    if (!musicAudioRef.current) {
      const el = new Audio();
      el.preload = "metadata";
      el.onerror = () => {
        const code = el.error?.code;
        // Auto-refresh on network / load-failure errors (codes 2 & 4)
        // These almost always mean a YouTube CDN URL expired.
        if (code === 2 || code === 4) {
          const ci = currentIdxRef.current;
          if (ci !== null) {
            const track = playlistRef.current[ci];
            if (track?.originalUrl && refreshTrackRef.current) {
              setMusicError("Track link expired — auto-refreshing…");
              setMusicPlaying(false);
              setTimeout(() => refreshTrackRef.current!(track.id), 500);
              return;
            }
          }
        }
        const msg =
          code === 1 ? "Playback aborted." :
          code === 2 ? "Network error — re-add the track to reload it." :
          code === 3 ? "Audio format not supported by your browser." :
          code === 4 ? "Track could not be loaded — tap Refresh link below." :
          "Unknown playback error.";
        setMusicError(msg);
        setMusicPlaying(false);
      };
      el.onended = () => {
        setMusicPlaying(false);
        // Auto-advance to next track
        setCurrentIdx((prev) => {
          if (prev === null) return null;
          setPlaylist((pl) => {
            const next = (prev + 1) % pl.length;
            if (pl.length > 1) {
              setTimeout(() => {
                el.src = pl[next].url;
                el.play().catch(() => {});
                setMusicPlaying(true);
                setCurrentIdx(next);
              }, 300);
            }
            return pl;
          });
          return prev;
        });
      };
      musicAudioRef.current = el;
    }
    return musicAudioRef.current;
  }, []);

  // Update volume live
  useEffect(() => {
    if (musicGainNodeRef.current) {
      musicGainNodeRef.current.gain.value = musicVolume / 100;
    }
    if (musicAudioRef.current && !musicBroadcastActive) {
      musicAudioRef.current.volume = musicVolume / 100;
    }
  }, [musicVolume, musicBroadcastActive]);

  // Progress ticker
  useEffect(() => {
    if (!musicPlaying) { if (musicProgressRef.current) clearInterval(musicProgressRef.current); return; }
    musicProgressRef.current = setInterval(() => {
      const el = musicAudioRef.current;
      if (!el || !el.duration) return;
      setMusicCurrentTime(el.currentTime);
      setMusicDuration(el.duration);
      setMusicProgress(el.currentTime / el.duration);
    }, 500);
    return () => { if (musicProgressRef.current) clearInterval(musicProgressRef.current); };
  }, [musicPlaying]);

  const playTrack = useCallback((idx: number) => {
    if (idx < 0) return;
    setPlaylist((pl) => {
      if (idx >= pl.length) return pl;
      const track = pl[idx];
      const el = getMusicAudio();
      if (musicBroadcastActive && musicCtxRef.current) {
        // Already broadcasting — just swap src
        el.src = track.url;
        el.volume = 1;
        el.play().catch(() => {});
      } else {
        el.src = track.url;
        el.volume = musicVolume / 100;
        el.play().catch(() => {});
      }
      setMusicPlaying(true);
      setCurrentIdx(idx);
      return pl;
    });
  }, [getMusicAudio, musicVolume, musicBroadcastActive]);

  const pauseTrack = useCallback(() => {
    musicAudioRef.current?.pause();
    setMusicPlaying(false);
  }, []);

  const resumeTrack = useCallback(() => {
    musicAudioRef.current?.play().catch(() => {});
    setMusicPlaying(true);
  }, []);

  const startMusicBroadcast = useCallback(async () => {
    const el = getMusicAudio();

    // Reuse the mic's AudioContext if it's alive, otherwise reuse the music's
    // own dedicated context (never close it — createMediaElementSource can only
    // be called once per element, so we must keep the same context).
    let ctx: AudioContext;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      ctx = audioCtxRef.current;
    } else if (musicCtxRef.current && musicCtxRef.current.state !== "closed") {
      ctx = musicCtxRef.current;
    } else {
      ctx = new AudioContext({ sampleRate: 44100 });
      musicCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();

    // createMediaElementSource may only be called once per element.
    // If the src node exists but belongs to a different (now-closed) context,
    // we need a fresh audio element.
    if (musicSrcNodeRef.current) {
      try { musicSrcNodeRef.current.context; } catch {
        musicSrcNodeRef.current = null;
        musicAudioRef.current = null; // let getMusicAudio() create a fresh one
      }
    }
    if (!musicSrcNodeRef.current) {
      const freshEl = getMusicAudio();
      musicSrcNodeRef.current = ctx.createMediaElementSource(freshEl);
    }

    const gain = ctx.createGain();
    gain.gain.value = musicVolume / 100;
    musicGainNodeRef.current = gain;
    musicSrcNodeRef.current.connect(gain);

    const isMicShared = ctx === audioCtxRef.current && !!processorRef.current;
    if (!isMicShared) {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Use /ws-music (dedicated route) so music never shares the mic WebSocket.
      // Sharing /ws-mic caused PCM data interleaving → scratches when mic is inactive.
      const ws = new WebSocket(`${proto}//${window.location.host}/ws-music`);
      musicWsRef.current = ws;

      // Prefer AudioWorkletNode (latest standard), fall back to ScriptProcessorNode
      let sendNode: AudioNode;
      try {
        await ctx.audioWorklet.addModule("/mic-worklet.js");
        const workletNode = new AudioWorkletNode(ctx, "pcm-sender-processor");
        workletNode.port.onmessage = (e: MessageEvent) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(e.data);
        };
        musicProcessorRef.current = workletNode;
        sendNode = workletNode;
      } catch {
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(pcm.buffer);
        };
        musicProcessorRef.current = processor;
        sendNode = processor;
      }

      gain.connect(sendNode);
      sendNode.connect(ctx.destination);

      ws.onopen = () => setMusicBroadcastActive(true);
      ws.onclose = () => { setMusicBroadcastActive(false); };
    } else {
      // Mic is active — connect music gain to existing mic send node
      if (processorRef.current) gain.connect(processorRef.current);
      setMusicBroadcastActive(true);
    }

    // When broadcasting, let the AudioContext control volume; mute HTML5 volume
    getMusicAudio().volume = 1;
  }, [getMusicAudio, musicVolume]);

  const stopMusicBroadcast = useCallback(() => {
    // Disconnect gain and processor, but keep the AudioContext and src node alive.
    // createMediaElementSource can only be called once per element — closing the
    // context would make it impossible to restart broadcast without a page reload.
    musicSrcNodeRef.current?.disconnect();
    musicGainNodeRef.current?.disconnect();
    musicGainNodeRef.current = null;
    musicProcessorRef.current?.disconnect();
    musicProcessorRef.current = null;
    musicWsRef.current?.close();
    musicWsRef.current = null;
    // musicCtxRef and musicSrcNodeRef are intentionally kept alive for re-use
    if (musicAudioRef.current) musicAudioRef.current.volume = musicVolume / 100;
    setMusicBroadcastActive(false);
    setMusicBroadcast(false);
  }, [musicVolume]);

  const [musicResolving, setMusicResolving] = useState(false);

  const isYtUrl = (u: string) =>
    /youtube\.com|youtu\.be|soundcloud\.com|twitch\.tv|vimeo\.com/.test(u);

  const addMusicUrl = useCallback(async () => {
    const url = musicAddUrl.trim();
    if (!url) return;
    setMusicError(null);

    // Direct audio file — add immediately
    if (!isYtUrl(url)) {
      const title = musicAddTitle.trim() || url.split("/").pop() || "Track";
      setPlaylist((prev) => [...prev, { id: crypto.randomUUID(), title, url }]);
      setMusicAddUrl("");
      setMusicAddTitle("");
      return;
    }

    // YouTube / SoundCloud / etc — resolve via backend
    setMusicResolving(true);
    try {
      const res = await fetch("/api/music/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setMusicError(data.error ?? "Could not resolve URL"); return; }
      const title = musicAddTitle.trim() || data.title || "Track";
      setPlaylist((prev) => [...prev, { id: crypto.randomUUID(), title, url: data.proxyUrl, originalUrl: url }]);
      setMusicAddUrl("");
      setMusicAddTitle("");
    } catch (e: any) {
      setMusicError(`Network error: ${e?.message}`);
    } finally {
      setMusicResolving(false);
    }
  }, [musicAddUrl, musicAddTitle]);

  const [refreshingTrackId, setRefreshingTrackId] = useState<string | null>(null);

  const refreshTrack = useCallback(async (trackId: string) => {
    const track = playlistRef.current.find((t) => t.id === trackId);
    if (!track?.originalUrl) return;

    setRefreshingTrackId(trackId);
    setMusicError(null);
    try {
      const res = await fetch("/api/music/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: track.originalUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setMusicError(data.error ?? "Could not refresh track"); return; }

      // Update the playlist URL
      setPlaylist((prev) => prev.map((t) => t.id === trackId ? { ...t, url: data.proxyUrl } : t));

      // If this is the currently-playing track, swap src and resume
      const ci = currentIdxRef.current;
      const idx = playlistRef.current.findIndex((t) => t.id === trackId);
      if (ci !== null && idx === ci && musicAudioRef.current) {
        musicAudioRef.current.src = data.proxyUrl;
        musicAudioRef.current.play().catch(() => {});
        setMusicPlaying(true);
        setMusicError(null);
      }
    } catch (e: any) {
      setMusicError(`Refresh failed: ${e?.message ?? "network error"}`);
    } finally {
      setRefreshingTrackId(null);
    }
  }, []);

  // Keep refreshTrackRef in sync so onerror (created once) always calls latest version
  useEffect(() => { refreshTrackRef.current = refreshTrack; }, [refreshTrack]);

  const removeTrack = useCallback((id: string) => {
    setPlaylist((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setCurrentIdx((ci) => {
        if (ci === null) return null;
        if (idx === ci) { musicAudioRef.current?.pause(); setMusicPlaying(false); return null; }
        if (idx < ci) return ci - 1;
        return ci;
      });
      return next;
    });
  }, []);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Per-element countdown: key → seconds remaining
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  // Per-element patch to push when countdown hits 0
  const pendingPatchRef = useRef<Record<string, Partial<BroadcastState>>>({});
  // Per-element revert patch (to undo optimistic update on cancel)
  const revertPatchRef = useRef<Record<string, Partial<BroadcastState>>>({});

  // Sync state from server on mount.
  // Both requests are fired in parallel (they're independent network calls —
  // there's no reason to make the dashboard wait for the first to finish
  // before starting the second). Ordering only matters for how the *results*
  // are applied: broadcast state is applied first, then overlay position on
  // top, so the API-driven position always wins and is never overwritten by
  // stale legacy values.
  useEffect(() => {
    let cancelled = false;
    const broadcastReq = fetch("/api/broadcast", { credentials: "include" }).catch(() => null);
    const newsOverlayReq = fetch("/api/news-overlay", { credentials: "include" }).catch(() => null);
    (async () => {
      const br = await broadcastReq;
      if (!cancelled && br?.ok) {
        try {
          const d = await br.json();
          setBs((prev) => ({ ...prev, ...d }));
        } catch {}
      }
      // Apply API news-overlay position after broadcast state so it is never
      // overwritten by a legacy newsPosition value from /api/broadcast.
      const nr = await newsOverlayReq;
      if (!cancelled && nr?.ok) {
        try {
          const d = await nr.json();
          if (d?.layout?.position) {
            setBs((prev) => ({
              ...prev,
              newsPosition: d.layout.position,
              mobileNewsPosition: d.layout.position,
            }));
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Clear pending news-position debounce on unmount so no stale PATCH fires
  useEffect(() => {
    return () => { if (newsPosDebRef.current) clearTimeout(newsPosDebRef.current); };
  }, []);

  // WebSocket subscriptions: donation alerts + QR scan/thank-you + gift events
  const { subscribe } = useWebSocket();
  const [latestDonation, setLatestDonation] = useState<DonationRecord | null>(null);
  const [latestGift, setLatestGift]         = useState<GiftEvent | null>(null);
  useEffect(() => {
    return subscribe("donation_alert", (msg) => {
      setLatestDonation(msg as unknown as DonationRecord);
    });
  }, [subscribe]);
  useEffect(() => {
    return subscribe("gift_received", (msg) => {
      setLatestGift(msg as unknown as GiftEvent);
    });
  }, [subscribe]);
  useEffect(() => {
    const u1 = subscribe("qr_scan", (msg) => {
      const m = msg as unknown as { count: number };
      setBs(prev => ({ ...prev, qrScanCount: m.count }));
    });
    const u2 = subscribe("qr_thank_you", (msg) => {
      const m = msg as unknown as { name: string; ts: number };
      setBs(prev => ({ ...prev, qrThankYouName: m.name, qrThankYouTs: m.ts }));
    });
    return () => { u1(); u2(); };
  }, [subscribe]);

  // Paystack WS events
  useEffect(() => {
    const u1 = subscribe("paystack_scan", () => {
      setPayStatus(prev => prev === "active" ? "scanned" : prev);
    });
    const u2 = subscribe("paystack_paid", (msg) => {
      const m = msg as unknown as { payerName?: string };
      setPayStatus(prev => (prev === "active" || prev === "scanned") ? "paid" : prev);
      setPayerName(m.payerName ?? "Someone");
    });
    return () => { u1(); u2(); };
  }, [subscribe]);

  // Stream health monitor — toast when FFmpeg goes silent mid-stream
  useEffect(() => {
    const unhealthy = new Set<string>();
    return subscribe("stream_health", (msg) => {
      const { streamId, data } = msg as { streamId: string; data: { status: string; message?: string } };
      if (!streamId) return;
      if (data.status === "degraded" && !unhealthy.has(streamId)) {
        unhealthy.add(streamId);
        toast.warning(`Stream warning`, {
          description: data.message ?? "FFmpeg output stalled — may auto-restart soon",
          duration: 8000,
          id: `health-${streamId}`,
        });
      } else if (data.status === "healthy" && unhealthy.has(streamId)) {
        unhealthy.delete(streamId);
        toast.success(`Stream recovered`, {
          description: "FFmpeg output resumed — stream is healthy",
          duration: 4000,
          id: `health-${streamId}`,
        });
      }
    });
  }, [subscribe]);

  // Tick all active countdowns every second
  useEffect(() => {
    const activeKeys = Object.keys(countdowns).filter((k) => countdowns[k] > 0);
    if (activeKeys.length === 0) return;
    const t = setTimeout(() => {
      setCountdowns((prev) => {
        const next = { ...prev };
        for (const k of activeKeys) {
          next[k] = Math.max(0, (prev[k] ?? 0) - 1);
        }
        return next;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [countdowns]);

  // Fire push when a countdown hits 0
  useEffect(() => {
    const fired = Object.keys(countdowns).filter((k) => countdowns[k] === 0);
    if (fired.length === 0) return;
    for (const k of fired) {
      const patch = pendingPatchRef.current[k];
      if (patch) {
        pushBroadcast(patch);
        delete pendingPatchRef.current[k];
        delete revertPatchRef.current[k];
      }
    }
    setCountdowns((prev) => {
      const next = { ...prev };
      for (const k of fired) delete next[k];
      return next;
    });
  }, [countdowns]);

  /**
   * Start a 3-second countdown for key, then push patch.
   * Also applies patch optimistically to local state.
   */
  const goLive = useCallback((key: string, patch: Partial<BroadcastState>) => {
    // Save revert patch (current values of the keys in patch)
    const revert: Partial<BroadcastState> = {};
    for (const k in patch) {
      (revert as any)[k] = (bs as any)[k];
    }
    revertPatchRef.current[key] = revert;
    pendingPatchRef.current[key] = patch;

    // Optimistically reflect the activation in local state
    setBs((prev) => ({ ...prev, ...patch }));
    setCountdowns((prev) => ({ ...prev, [key]: 3 }));
  }, [bs]);

  /** Cancel a pending countdown and revert the optimistic update */
  const cancelGoLive = useCallback((key: string) => {
    const revert = revertPatchRef.current[key];
    if (revert) setBs((prev) => ({ ...prev, ...revert }));
    delete pendingPatchRef.current[key];
    delete revertPatchRef.current[key];
    setCountdowns((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** Immediate push (for deactivation — always instant) */
  const stopOverlay = useCallback((patch: Partial<BroadcastState>) => {
    setBs((prev) => ({ ...prev, ...patch }));
    pushBroadcast(patch);
  }, []);

  /** Local-only state update (no server push — staged for Go Live) */
  const localUpdate = useCallback((patch: Partial<BroadcastState>) => {
    setBs((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Immediate push for non-go-live settings (stage chat style) */
  const update = useCallback((patch: Partial<BroadcastState>, debounceMs = 0) => {
    setBs((prev) => ({ ...prev, ...patch }));
    pushBroadcast(patch, debounceMs);
  }, []);

  // ── Mic WebSocket + Web Audio pipeline ──────────────────────────────────
  const [micActive, setMicActive] = useState(false);
  const [micConnecting, setMicConnecting] = useState(false);
  const [micVolumeDisplay, setMicVolumeDisplay] = useState(100);
  const [micError, setMicError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [micRetryLabel, setMicRetryLabel] = useState("");
  // Noise cancellation
  const [noiseCancelEnabled, setNoiseCancelEnabled] = useState(true);
  const [noiseGateThreshold, setNoiseGateThreshold] = useState(20); // 0-100 maps to 0-0.10

  const micWsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const micVolumeValRef = useRef(100);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micAnimRef = useRef<number | null>(null);
  const hpFilterRef = useRef<BiquadFilterNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const noiseGateNodeRef = useRef<AudioWorkletNode | null>(null);
  const noiseCancelEnabledRef = useRef(true);
  const noiseGateThresholdRef = useRef(20);

  // Sync refs so audio callbacks always see the latest value
  useEffect(() => { noiseCancelEnabledRef.current = noiseCancelEnabled; }, [noiseCancelEnabled]);
  useEffect(() => { noiseGateThresholdRef.current = noiseGateThreshold; }, [noiseGateThreshold]);

  // Live-update noise gate parameter without restarting mic
  const applyNoiseGateParam = useCallback((enabled: boolean, threshold: number) => {
    const node = noiseGateNodeRef.current;
    if (!node) return;
    const param = node.parameters.get("threshold");
    if (!param) return;
    // threshold 0 = gate fully open (disabled), 0.10 = high suppression
    param.value = enabled ? threshold / 1000 : 0;
  }, []);

  const startMic = useCallback(async () => {
    setMicError(null);
    setMicRetryLabel("");
    setMicConnecting(true);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: false,   // disabled — our compressor handles levelling
            channelCount: 1,
            sampleRate: 48000,        // broadcast standard; eliminates SRC in FFmpeg
          },
          video: false,
        });
      } catch (e: any) {
        const msg = e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError"
          ? "Microphone permission denied. Allow mic access in your browser settings and try again."
          : `Could not access mic: ${e?.message || e}`;
        setMicError(msg);
        setMicConnecting(false);
        return;
      }
      micStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 48000 }); // broadcast standard — no SRC in FFmpeg
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = micVolumeValRef.current / 100;
      micGainRef.current = gain;

      // ── Noise cancellation chain ─────────────────────────────────────────
      // High-pass filter: cut rumble / fan noise / mic handling below 100 Hz.
      // 2nd-order Butterworth (Q = 0.707) — maximally flat passband, no ringing.
      const hpFilter = ctx.createBiquadFilter();
      hpFilter.type = "highpass";
      hpFilter.frequency.value = 100;
      hpFilter.Q.value = 0.707;
      hpFilterRef.current = hpFilter;

      // Dynamics compressor: broadcast-style levelling.
      //
      // threshold -18 dB  — start compressing at a moderate speaking level
      // knee       8 dB   — soft knee keeps the onset transparent
      // ratio      3:1    — gentle ratio; 4:1 caused audible "pumping" on plosives
      // attack    3 ms    — fast enough to catch transients before they clip
      // release  200 ms   — slow release = smooth, natural decay; prevents
      //                     gain-pumping between words (the "radio duck" effect)
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 8;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.200;
      compressorRef.current = compressor;

      // Analyser for VU meter (post-processing so meter reflects cleaned signal)
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // ── WebSocket with retry ─────────────────────────────────────────────
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const MAX_RETRIES = 3;
      let attempt = 0;

      const connectWs = (): Promise<WebSocket> => new Promise((resolve, reject) => {
        attempt++;
        if (attempt > 1) setMicRetryLabel(`Attempt ${attempt}/${MAX_RETRIES}…`);
        const ws = new WebSocket(`${proto}//${window.location.host}/ws-mic`);
        micWsRef.current = ws;
        ws.onopen = () => { setMicRetryLabel(""); resolve(ws); };
        ws.onerror = () => {
          if (attempt < MAX_RETRIES) {
            setTimeout(() => connectWs().then(resolve).catch(reject), 1500);
          } else {
            reject(new Error(`Cannot connect to audio server after ${MAX_RETRIES} attempts. ` +
              `Make sure the API server (port 8080) is running and /ws-mic is reachable.`));
          }
        };
      });

      let ws: WebSocket;
      try {
        ws = await connectWs();
      } catch (e: any) {
        setMicError(e.message);
        setMicConnecting(false);
        stream.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
        ctx.close();
        audioCtxRef.current = null;
        return;
      }

      ws.onclose = () => { setMicActive(false); setMicConnecting(false); };

      // ── Audio worklets ───────────────────────────────────────────────────
      // Load noise-gate + pcm-sender worklets; graceful fallback if either fails
      let noiseGateNode: AudioWorkletNode | null = null;
      let sendNode: AudioNode;

      try {
        await Promise.all([
          ctx.audioWorklet.addModule("/mic-worklet.js"),
          ctx.audioWorklet.addModule("/mic-noise-gate-worklet.js"),
        ]);

        // Noise gate worklet
        noiseGateNode = new AudioWorkletNode(ctx, "noise-gate-processor");
        const ngParam = noiseGateNode.parameters.get("threshold");
        if (ngParam) {
          ngParam.value = noiseCancelEnabledRef.current
            ? noiseGateThresholdRef.current / 1000
            : 0;
        }
        noiseGateNodeRef.current = noiseGateNode;

        // PCM sender worklet
        const workletNode = new AudioWorkletNode(ctx, "pcm-sender-processor");
        workletNode.port.onmessage = (e: MessageEvent) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        processorRef.current = workletNode;
        sendNode = workletNode;
      } catch {
        // Fallback: ScriptProcessorNode (deprecated but widely supported)
        noiseGateNode = null;
        noiseGateNodeRef.current = null;
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(pcm.buffer);
        };
        processorRef.current = processor;
        sendNode = processor;
      }

      // ── Wire up audio graph ──────────────────────────────────────────────
      // src → gain → hpFilter → compressor → [noiseGate?] → analyser → pcmSender → destination
      src.connect(gain);
      gain.connect(hpFilter);
      hpFilter.connect(compressor);
      if (noiseGateNode) {
        compressor.connect(noiseGateNode);
        noiseGateNode.connect(analyser);
      } else {
        compressor.connect(analyser);
      }
      analyser.connect(sendNode);
      sendNode.connect(ctx.destination);

      setMicActive(true);
      setMicConnecting(false);

      // VU meter animation loop
      const vuData = new Uint8Array(analyser.frequencyBinCount);
      const updateVU = () => {
        analyser.getByteFrequencyData(vuData);
        const avg = vuData.reduce((a, b) => a + b, 0) / vuData.length;
        setMicLevel(avg / 128);
        micAnimRef.current = requestAnimationFrame(updateVU);
      };
      micAnimRef.current = requestAnimationFrame(updateVU);
    } catch (e: any) {
      setMicError(`Mic error: ${e?.message || e}`);
      setMicConnecting(false);
    }
  }, []);

  const stopMic = useCallback(() => {
    if (micAnimRef.current) { cancelAnimationFrame(micAnimRef.current); micAnimRef.current = null; }
    noiseGateNodeRef.current?.disconnect();
    noiseGateNodeRef.current = null;
    compressorRef.current?.disconnect();
    compressorRef.current = null;
    hpFilterRef.current?.disconnect();
    hpFilterRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    analyserRef.current = null;
    micGainRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micWsRef.current?.close();
    micWsRef.current = null;
    setMicActive(false);
    setMicLevel(0);
    setMicRetryLabel("");
  }, []);

  const [superChatForm, setSuperChatForm] = useState({ user: "", amount: "", text: "" });

  const posKey = (base: "statsPosition" | "subsPosition" | "chatBurnPosition" | "newsPosition" | "adPosition" | "guestPosition" | "subChartPosition") => {
    if (editMode === "desktop") return base;
    const capped = base.charAt(0).toUpperCase() + base.slice(1);
    return `mobile${capped}` as keyof BroadcastState;
  };
  const getPos = (base: "statsPosition" | "subsPosition" | "chatBurnPosition" | "newsPosition" | "adPosition" | "guestPosition" | "subChartPosition"): OverlayPosition =>
    (bs as any)[posKey(base)] as OverlayPosition;
  const setPos = (base: "statsPosition" | "subsPosition" | "chatBurnPosition" | "newsPosition" | "adPosition" | "guestPosition" | "subChartPosition") =>
    (p: OverlayPosition) => update({ [posKey(base)]: p } as any);

  const fireSuperChat = useCallback(() => {
    const amt = parseFloat(superChatForm.amount) || 0;
    const newMsg = {
      user: superChatForm.user || "Viewer",
      amount: superChatForm.amount ? `$${superChatForm.amount}` : "$5",
      text: superChatForm.text,
      color: superChatColor(amt),
      ts: Date.now(),
    };
    const next = [...(bs.superChatMessages || []), newMsg].slice(-20);
    update({ superChatMessages: next });
    setSuperChatForm({ user: "", amount: "", text: "" });
  }, [bs.superChatMessages, superChatForm, update]);

  const activeStreams = streams.filter((s) => s.status === "streaming");
  const activeStreamCount = activeStreams.length;

  if (activeStreamCount === 0) return null;

  const currentTab = TABS.find((t) => t.id === activeTab)!;
  const allChatMessages = activeStreams.flatMap((s) => streamChat[s.id] || [])
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
  const hasSubs = activeStreams.some((s) => streamStats[s.id]?.subs);
  const stageUrl = `${window.location.origin}/broadcast`;

  const positionTabs: Tab[] = ["stats", "subs", "chat", "news", "ads", "alerts"];

  // ── Pending badge ─────────────────────────────────────────────────────────
  const hasPendingCountdown = Object.keys(countdowns).length > 0;

  return (
    <div style={{
      borderRadius: 16,
      background: "linear-gradient(180deg, rgba(10,10,22,0.98) 0%, rgba(15,15,30,0.98) 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      overflow: "hidden",
      boxShadow: "0 16px 64px rgba(0,0,0,0.5)",
      marginBottom: 8,
    }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        gap: 10, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            background: "rgba(229,62,62,0.2)", border: "1px solid rgba(229,62,62,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Radio size={14} style={{ color: "#fc8181" }} />
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 12 }}>Control Room</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#e53e3e", animation: "cr-pulse 1.2s infinite" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
                {activeStreamCount} stream{activeStreamCount !== 1 ? "s" : ""} live
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setCollapsed(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 9px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${activeTab === tab.id ? tab.accent : "rgba(255,255,255,0.07)"}`,
                  background: activeTab === tab.id ? `${tab.accent}20` : "transparent",
                  color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.4)",
                  transition: "all 0.18s ease",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: activeTab === tab.id ? tab.accent : "inherit", display: "flex" }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <a
            href={stageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700,
              background: "rgba(229,62,62,0.15)", border: "1px solid rgba(229,62,62,0.35)",
              color: "#fc8181", textDecoration: "none", transition: "all 0.2s ease",
              whiteSpace: "nowrap",
            }}
          >
            <ExternalLink size={11} />
            Open Stage
          </a>

          <button
            onClick={() => setCollapsed((v) => !v)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.4)", cursor: "pointer",
            }}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      </div>

      {/* Panel body */}
      {!collapsed && (
        <div style={{ padding: "16px 18px", animation: "cr-slide-down 0.25s ease forwards" }}>

          {/* Staged changes banner */}
          {hasPendingCountdown && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)",
              fontSize: 11, color: "#fbbf24", fontWeight: 600,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24", animation: "cr-pulse 0.8s infinite" }} />
              Applying to live stream in progress…
            </div>
          )}

          {/* Desktop / Mobile toggle */}
          {positionTabs.includes(activeTab) && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <EditModeToggle mode={editMode} onChange={setEditMode} />
            </div>
          )}

          {/* ── AI CONTROLLER ── */}
          {activeTab === "ai" && (
            <AIPanel activeStreamCount={activeStreamCount} />
          )}

          {/* ── STATS ── */}
          {activeTab === "stats" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* ── Overlay style controls ── */}
              <SectionDivider label="Live Stats Badge" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                The <strong style={{ color: "#fff" }}>LIVE · subs · viewers</strong> badge that burns into the top-left of the stream.
              </div>

              {/* Style picker */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Badge Style</div>
                <StylePills styles={STATS_STYLES} current={bs.statsStyle} accent="#a78bfa" onSelect={(s) => localUpdate({ statsStyle: s })} />
              </div>

              {/* Style description */}
              <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(255,255,255,0.04)", fontSize: 11, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
                {bs.statsStyle === "TV"      && "Pill badges with dark background and red live dot — clean broadcast look with rounded corners."}
                {bs.statsStyle === "Neon"    && "Single glowing bar with neon cyan border — red LIVE text glows and stats shimmer in purple/green."}
                {bs.statsStyle === "Glass"   && "Frosted glass pills with shine effect — premium transparent look that blends with any scene."}
                {bs.statsStyle === "YouTube" && "YouTube-branded: red LIVE pill + white stat badges — instantly recognisable channel style."}
                {bs.statsStyle === "Sport"   && "Sports-broadcast style: orange LIVE tab + white stat badges with coloured borders."}
              </div>

              {/* Position + Size */}
              <PositionSliders
                pos={getPos("statsPosition")}
                label={`Badge position — ${editMode}`}
                accent="#a78bfa"
                onChange={setPos("statsPosition")}
              />
              <SizeSlider value={bs.statsScale} onChange={(v) => localUpdate({ statsScale: v })} accent="#a78bfa" />

              {/* Go live */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.statsActive}
                  accent="#a78bfa"
                  countdownSecs={countdowns["stats"]}
                  onCancel={() => cancelGoLive("stats")}
                  onActivate={() => goLive("stats", {
                    statsActive: true,
                    statsStyle: bs.statsStyle,
                    statsPosition: bs.statsPosition,
                    mobileStatsPosition: bs.mobileStatsPosition,
                    statsScale: bs.statsScale,
                  })}
                  onDeactivate={() => stopOverlay({ statsActive: false })}
                />
                <LiveBadge label={`${bs.statsStyle} stats badge`} active={bs.statsActive} accent="#a78bfa" />
              </div>

              <div style={{ padding: "9px 14px", borderRadius: 8, background: "rgba(167,139,250,0.05)", border: "1px solid rgba(167,139,250,0.12)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                The badge auto-shows when a YouTube source stream is active and subs/viewers have been fetched.
              </div>

              {/* ── Analytics panel below ── */}
              <SectionDivider label="Stream Analytics" />
              <StatsPanel streams={activeStreams} streamStats={streamStats} procStats={streamProcStats} />
            </div>
          )}

          {/* ── SUBS OVERLAY ── */}
          {activeTab === "subs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!hasSubs && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(204,0,1,0.06)", border: "1px solid rgba(204,0,1,0.18)", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  No subscriber count yet. Add a YouTube source stream to pull live sub counts automatically.
                </div>
              )}

              {/* Style picker — 5 YouTube Live display styles */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Display Style</div>
                <StylePills styles={SUB_STYLES} current={bs.subsStyle} accent="#cc0001" onSelect={(s) => localUpdate({ subsStyle: s })} />
              </div>

              {/* Style preview description */}
              <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(255,255,255,0.04)", fontSize: 11, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
                {bs.subsStyle === "HUD"      && "Compact dark strip with red accent — minimal screen space, always visible."}
                {bs.subsStyle === "Minimal"  && "Floating white count with drop shadow — no background, blends with any scene."}
                {bs.subsStyle === "Animated" && "Dark card with pulsing red top bar and live dot — eye-catching but not distracting."}
                {bs.subsStyle === "Card"     && "YouTube-style badge with play-button icon — professional channel look."}
                {bs.subsStyle === "Goal"     && "Red progress bar toward your subscriber milestone — great for sub drives."}
                {bs.subsStyle === "Neon"     && "Electric blue-to-purple gradient with cyan glow border and text shimmer — vibrant nightclub energy."}
                {bs.subsStyle === "Glass"    && "Frosted glass card with top shine and purple icon circle — premium see-through look."}
                {bs.subsStyle === "Sport"    && "Orange gradient ticker with dark SUBS stripe on the left — bold sports-broadcast panel."}
                {bs.subsStyle === "Cinema"   && "Black card with animated gold border, gold count, and star label — luxury awards-night feel."}
              </div>

              {bs.subsStyle === "Goal" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Subscriber Goal</div>
                  <NumberInput
                    value={bs.subsGoal}
                    onChange={(v) => localUpdate({ subsGoal: v })}
                    placeholder="e.g. 1000000"
                  />
                </div>
              )}

              <PositionSliders
                pos={getPos("subsPosition")}
                label={`Position — ${editMode}`}
                accent="#cc0001"
                onChange={setPos("subsPosition")}
              />
              <SizeSlider value={bs.subsScale} onChange={(v) => localUpdate({ subsScale: v })} accent="#cc0001" />

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.subsOverlayActive}
                  accent="#cc0001"
                  countdownSecs={countdowns["subs"]}
                  onCancel={() => cancelGoLive("subs")}
                  onActivate={() => goLive("subs", {
                    subsOverlayActive: true,
                    subsStyle: bs.subsStyle,
                    subsPosition: bs.subsPosition,
                    mobileSubsPosition: bs.mobileSubsPosition,
                    subsGoal: bs.subsGoal,
                    subsScale: bs.subsScale,
                  })}
                  onDeactivate={() => stopOverlay({ subsOverlayActive: false })}
                />
                <LiveBadge label={`${bs.subsStyle} sub counter`} active={bs.subsOverlayActive} accent="#cc0001" />
              </div>

              <div style={{ padding: "9px 14px", borderRadius: 8, background: "rgba(204,0,1,0.05)", border: "1px solid rgba(204,0,1,0.12)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                Style changes are staged — tap <strong style={{ color: "#cc0001" }}>Go Live</strong> to apply them with a 3-second countdown.
              </div>
            </div>
          )}

          {/* ── CHAT ── */}
          {activeTab === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* ── Live chat feed ──────────────────────────────────────────── */}
              {allChatMessages.length === 0 ? (
                <div style={{
                  padding: "12px 16px", borderRadius: 10,
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  color: "rgba(255,255,255,0.3)", fontSize: 12, textAlign: "center",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                }}>
                  <span>Waiting for YouTube live chat… (auto-refreshes every 10 s)</span>
                  <button
                    onClick={handleForceRefreshChat}
                    disabled={isRefreshingChat}
                    style={{
                      flexShrink: 0, padding: "4px 10px", borderRadius: 6,
                      background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)",
                      color: "#34d399", fontSize: 11, fontWeight: 600,
                      cursor: isRefreshingChat ? "default" : "pointer",
                      whiteSpace: "nowrap", opacity: isRefreshingChat ? 0.6 : 1,
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <RefreshCw size={11} style={isRefreshingChat ? { animation: "cr-spin 1s linear infinite" } : undefined} />
                    {isRefreshingChat ? "Refreshing…" : "Force Refresh"}
                  </button>
                </div>
              ) : (
                <div style={{
                  maxHeight: 220, overflowY: "auto",
                  display: "flex", flexDirection: "column", gap: 6,
                  padding: "10px 12px", borderRadius: 10,
                  background: "rgba(0,0,0,0.35)", border: "1px solid rgba(52,211,153,0.18)",
                }}>
                  {allChatMessages.slice(-15).map((m) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                      {m.authorPhoto && (
                        <img src={m.authorPhoto} alt="" style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1 }} />
                      )}
                      <div style={{ fontSize: 11, lineHeight: 1.45, wordBreak: "break-word" }}>
                        <span style={{
                          fontWeight: 700, marginRight: 5,
                          color: m.isOwner ? "#ffd600" : m.isModerator ? "#34d399" : m.isMember ? "#a78bfa" : "rgba(255,255,255,0.6)",
                        }}>
                          {m.authorName}
                          {m.isOwner && " 👑"}
                          {m.isModerator && !m.isOwner && " 🛡"}
                          {m.isMember && !m.isModerator && !m.isOwner && " ⭐"}
                        </span>
                        <span style={{ color: "rgba(255,255,255,0.85)" }}>{m.text}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                    <button
                      onClick={handleForceRefreshChat}
                      disabled={isRefreshingChat}
                      style={{
                        padding: "4px 10px", borderRadius: 6,
                        background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)",
                        color: "#34d399", fontSize: 11, fontWeight: 600,
                        cursor: isRefreshingChat ? "default" : "pointer",
                        opacity: isRefreshingChat ? 0.6 : 1,
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                    >
                      <RefreshCw size={11} style={isRefreshingChat ? { animation: "cr-spin 1s linear infinite" } : undefined} />
                      {isRefreshingChat ? "Refreshing…" : "Force Refresh"}
                    </button>
                  </div>
                </div>
              )}

              {chatRefreshMessage && (
                <div style={{
                  padding: "8px 14px", borderRadius: 8,
                  background: isRefreshingChat ? "rgba(255,255,255,0.05)" : "rgba(52,211,153,0.08)",
                  border: `1px solid ${isRefreshingChat ? "rgba(255,255,255,0.12)" : "rgba(52,211,153,0.25)"}`,
                  color: isRefreshingChat ? "rgba(255,255,255,0.55)" : "#34d399",
                  fontSize: 11.5, fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 7,
                }}>
                  {isRefreshingChat && <RefreshCw size={11} style={{ animation: "cr-spin 1s linear infinite" }} />}
                  {chatRefreshMessage}
                </div>
              )}

              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Choose how live chat appears on the <strong style={{ color: "#fff" }}>Stage</strong> page (browser source for OBS).
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Stage Chat Style</div>
                <StylePills
                  styles={CHAT_STYLES}
                  current={bs.chatStyle}
                  accent="#34d399"
                  onSelect={(s) => localUpdate({ chatStyle: s })}
                />
              </div>
              <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.2)" }}>
                <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, marginBottom: 4 }}>
                  {bs.chatStyle} — Staged
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  {bs.chatStyle === "TV" && "Messages slide in from the right with a professional TV lower-third look."}
                  {bs.chatStyle === "Bubble" && "iMessage-style bubbles with spring animations."}
                  {bs.chatStyle === "Neon" && "Glowing neon-colored names on a dark background."}
                  {bs.chatStyle === "Glass" && "Glassmorphism frosted cards fading in from below."}
                  {bs.chatStyle === "Compact" && "Dense news-feed list, new messages flash on entry."}
                  {bs.chatStyle === "Toast" && "Notification toasts stacking from the right, newest on top."}
                </div>
              </div>
              <button
                onClick={() => update({ chatStyle: bs.chatStyle })}
                style={{
                  alignSelf: "flex-start", padding: "6px 18px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  cursor: "pointer", border: "1px solid rgba(52,211,153,0.45)",
                  background: "rgba(52,211,153,0.12)", color: "#34d399",
                }}
              >
                Apply Style to Stage
              </button>

              <SectionDivider label="Burn chat into stream" />

              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Burn chat messages directly into the video so viewers on <strong style={{ color: "#fff" }}>YouTube &amp; Facebook</strong> see them.
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Chat Burn Style
                  {editMode === "mobile" && (
                    <span style={{ marginLeft: 6, color: "#a78bfa", fontWeight: 500 }}>(mobile layout applies)</span>
                  )}
                </div>
                <StylePills styles={CHAT_BURN_STYLES} current={bs.chatBurnStyle} accent="#34d399" onSelect={(s) => localUpdate({ chatBurnStyle: s })} />
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.14)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                {bs.chatBurnStyle === "Bubble" && (
                  <>Messenger-style bubbles · {editMode === "mobile" ? <strong style={{ color: "#34d399" }}>mobile: full-width bubbles with colour accent bar</strong> : "avatar + name + message · last 4 messages"}</>
                )}
                {bs.chatBurnStyle === "Float" && "TikTok-style · messages float upward and fade out over 5 s"}
                {bs.chatBurnStyle === "Sidebar" && (
                  <>Vertical panel · {editMode === "mobile" ? <strong style={{ color: "#34d399" }}>mobile: wide panel suited for portrait canvas</strong> : "YouTube-style feed · last 8 messages"}</>
                )}
                {bs.chatBurnStyle === "Highlight" && "Large centered popup · shows the latest single message prominently"}
                {bs.chatBurnStyle === "Ticker" && "Horizontal scrolling bar · all recent messages as a news-ticker feed"}
              </div>

              <PositionSliders
                pos={getPos("chatBurnPosition")}
                label={`Chat burn position — ${editMode}`}
                accent="#34d399"
                onChange={setPos("chatBurnPosition")}
              />
              <SizeSlider value={bs.chatBurnScale} onChange={(v) => localUpdate({ chatBurnScale: v })} accent="#34d399" />

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.chatBurnActive}
                  accent="#34d399"
                  countdownSecs={countdowns["chat"]}
                  onCancel={() => cancelGoLive("chat")}
                  onActivate={() => goLive("chat", {
                    chatBurnActive: true,
                    chatBurnStyle: bs.chatBurnStyle,
                    chatBurnPosition: bs.chatBurnPosition,
                    mobileChatBurnPosition: bs.mobileChatBurnPosition,
                    chatBurnScale: bs.chatBurnScale,
                  })}
                  onDeactivate={() => stopOverlay({ chatBurnActive: false })}
                />
                <LiveBadge label={`${bs.chatBurnStyle} chat burn`} active={bs.chatBurnActive} accent="#34d399" />
              </div>
            </div>
          )}

          {/* ── NEWS ── */}
          {activeTab === "news" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 10 }}>
                <PositionSliders
                  pos={getPos("newsPosition")}
                  label="Position"
                  accent="#667eea"
                  onChange={(p) => {
                    // pushBroadcast is the single source of truth for position.
                    // The server's /api/broadcast handler sees "newsPosition" in
                    // the body and calls updateStreamOverlays directly — so the
                    // canvas renderer gets the new XY without touching newsActive.
                    setPos("newsPosition")(p);
                  }}
                />
                <SizeSlider value={bs.newsScale} onChange={(v) => update({ newsScale: v }, 120)} accent="#667eea" max={300} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Ticker loop pause
                    </div>
                    <span style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 600 }}>
                      {bs.newsTickerLoopSecs}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5} max={60} step={5}
                    value={bs.newsTickerLoopSecs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      localUpdate({ newsTickerLoopSecs: v });
                      update({ newsTickerLoopSecs: v }, 120);
                    }}
                    style={{ width: "100%", accentColor: "#667eea", cursor: "pointer" }}
                  />
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                    How long the ticker pauses after each full loop (5s – 60s)
                  </div>
                </div>
              </div>
              <NewsPanel activeStreamCount={activeStreamCount} />
            </div>
          )}

          {/* ── ALERTS ── */}
          {activeTab === "alerts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── GUEST NAME TAG ── */}
              <SectionDivider label="Guest Name Tag" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Show a lower-third name tag for a guest speaker or featured viewer.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <TextInput value={bs.guestName} onChange={(v) => localUpdate({ guestName: v })} placeholder="Guest name…" />
                <TextInput value={bs.guestTitle} onChange={(v) => localUpdate({ guestTitle: v })} placeholder="Title / channel…" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Tag Style</div>
                <StylePills styles={GUEST_STYLES} current={bs.guestStyle} accent="#f97316" onSelect={(s) => localUpdate({ guestStyle: s })} />
              </div>
              <PositionSliders
                pos={getPos("guestPosition")}
                label={`Position — ${editMode}`}
                accent="#f97316"
                onChange={setPos("guestPosition")}
              />
              <SizeSlider value={bs.guestScale} onChange={(v) => localUpdate({ guestScale: v })} accent="#f97316" />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.guestNameActive}
                  accent="#f97316"
                  countdownSecs={countdowns["guest"]}
                  onCancel={() => cancelGoLive("guest")}
                  onActivate={() => goLive("guest", {
                    guestNameActive: true,
                    guestName: bs.guestName,
                    guestTitle: bs.guestTitle,
                    guestStyle: bs.guestStyle,
                    guestPosition: bs.guestPosition,
                    mobileGuestPosition: bs.mobileGuestPosition,
                    guestScale: bs.guestScale,
                  })}
                  onDeactivate={() => stopOverlay({ guestNameActive: false })}
                />
                <LiveBadge label={`${bs.guestStyle} name tag`} active={bs.guestNameActive} accent="#f97316" />
              </div>

              {/* ── SUB MILESTONE ALERT ── */}
              <SectionDivider label="Subscriber Alert" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Flash a timed alert banner on the stream for subscriber milestones.
              </div>
              <TextInput
                value={bs.subAlertMessage}
                onChange={(v) => localUpdate({ subAlertMessage: v })}
                placeholder="🎉 Just hit 100K subscribers!"
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    update({ subAlertActive: true, subAlertMessage: bs.subAlertMessage });
                    setTimeout(() => {
                      update({ subAlertActive: false });
                      localUpdate({ subAlertActive: false });
                    }, 5_000);
                  }}
                  disabled={!bs.subAlertMessage.trim() || bs.subAlertActive}
                  style={{
                    padding: "6px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: bs.subAlertActive || !bs.subAlertMessage.trim() ? "not-allowed" : "pointer",
                    border: "1px solid #f97316", background: "rgba(249,115,22,0.15)", color: "#fed7aa",
                    opacity: bs.subAlertMessage.trim() && !bs.subAlertActive ? 1 : 0.4, transition: "all 0.18s ease",
                  }}
                >
                  🔔 Fire Alert Now
                </button>
                {bs.subAlertActive && (
                  <button
                    onClick={() => {
                      update({ subAlertActive: false });
                      localUpdate({ subAlertActive: false });
                    }}
                    style={{
                      padding: "6px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      border: "1px solid #ef4444", background: "rgba(239,68,68,0.18)", color: "#fca5a5",
                      transition: "all 0.18s ease",
                    }}
                  >
                    ⏹ Stop Alert
                  </button>
                )}
                {bs.subAlertActive && (
                  <span style={{ fontSize: 10, color: "#f97316", fontWeight: 700, animation: "cr-pulse 1.2s ease infinite" }}>
                    ● LIVE
                  </span>
                )}
              </div>

              {/* ── SUB CHART SPARKLINE ── */}
              <SectionDivider label="Subscriber Sparkline Chart" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Show a live sparkline of subscriber count history. Data samples automatically when YouTube stats are available.
              </div>
              <PositionSliders
                pos={getPos("subChartPosition")}
                label={`Position — ${editMode}`}
                accent="#f97316"
                onChange={setPos("subChartPosition")}
              />
              <SizeSlider value={bs.subChartScale} onChange={(v) => localUpdate({ subChartScale: v })} accent="#f97316" />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.subChartActive}
                  accent="#f97316"
                  countdownSecs={countdowns["subChart"]}
                  onCancel={() => cancelGoLive("subChart")}
                  onActivate={() => goLive("subChart", {
                    subChartActive: true,
                    subChartPosition: bs.subChartPosition,
                    mobileSubChartPosition: bs.mobileSubChartPosition,
                    subChartScale: bs.subChartScale,
                  })}
                  onDeactivate={() => stopOverlay({ subChartActive: false })}
                />
                <LiveBadge label="Subscriber sparkline" active={bs.subChartActive} accent="#f97316" />
              </div>

              {/* ── SUPER CHAT ── */}
              <SectionDivider label="Super Chat" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Manually fire a Super Chat notification or let them appear automatically from YouTube chat. Notifications display for 9 seconds.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <TextInput value={superChatForm.user} onChange={(v) => setSuperChatForm((p) => ({ ...p, user: v }))} placeholder="Username…" />
                <TextInput value={superChatForm.amount} onChange={(v) => setSuperChatForm((p) => ({ ...p, amount: v }))} placeholder="Amount (e.g. 20)…" />
              </div>
              <TextInput value={superChatForm.text} onChange={(v) => setSuperChatForm((p) => ({ ...p, text: v }))} placeholder="Message (optional)…" />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {superChatForm.amount && (
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                    background: superChatColor(parseFloat(superChatForm.amount) || 0),
                    border: "1px solid rgba(255,255,255,0.2)",
                  }} />
                )}
                <button
                  onClick={fireSuperChat}
                  disabled={!superChatForm.user.trim()}
                  style={{
                    padding: "6px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                    border: "1px solid #f97316", background: "rgba(249,115,22,0.15)", color: "#fed7aa",
                    opacity: superChatForm.user.trim() ? 1 : 0.4, transition: "all 0.18s ease",
                  }}
                >
                  💬 Fire Super Chat
                </button>
                {bs.superChatMessages.length > 0 && (
                  <button
                    onClick={() => update({ superChatMessages: [] })}
                    style={{
                      padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.4)",
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SUPERCHAT_TIERS.map((t) => (
                  <div key={t.label} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 20, fontSize: 10,
                    background: `${t.color}22`, border: `1px solid ${t.color}66`, color: "#fff", fontWeight: 600,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.color }} />
                    {t.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ADS ── */}
          {activeTab === "ads" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <TextInput value={bs.adText} onChange={(v) => localUpdate({ adText: v })} placeholder="Ad headline…" />
              <TextInput value={bs.adSub} onChange={(v) => localUpdate({ adSub: v })} placeholder="Sub-caption (e.g. use code LIVE)…" />
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Style</div>
                <StylePills styles={AD_STYLES} current={bs.adStyle} accent="#f093fb" onSelect={(s) => localUpdate({ adStyle: s })} />
              </div>
              <PositionSliders
                pos={getPos("adPosition")}
                label={`Position — ${editMode}`}
                accent="#f093fb"
                onChange={setPos("adPosition")}
              />
              <SizeSlider value={bs.adScale} onChange={(v) => localUpdate({ adScale: v })} accent="#f093fb" />
              <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(240,147,251,0.06)", border: "1px solid rgba(240,147,251,0.15)", fontSize: 11, color: "rgba(255,255,255,0.38)", lineHeight: 1.5 }}>
                Text and style are staged — applied when you tap <strong style={{ color: "#f093fb" }}>Go Live</strong>.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.adActive}
                  accent="#f093fb"
                  countdownSecs={countdowns["ads"]}
                  onCancel={() => cancelGoLive("ads")}
                  onActivate={() => goLive("ads", {
                    adActive: true,
                    adText: bs.adText,
                    adSub: bs.adSub,
                    adStyle: bs.adStyle,
                    adPosition: bs.adPosition,
                    mobileAdPosition: bs.mobileAdPosition,
                    adScale: bs.adScale,
                  })}
                  onDeactivate={() => stopOverlay({ adActive: false })}
                />
                <LiveBadge label={`${bs.adStyle} ad`} active={bs.adActive} accent="#f093fb" />
              </div>
            </div>
          )}

          {/* ── BREAK ── */}
          {activeTab === "break" && (
            <BreakPanel
              bs={bs}
              localUpdate={localUpdate}
              update={update}
              goLive={goLive}
              cancelGoLive={cancelGoLive}
              stopOverlay={stopOverlay}
              countdowns={countdowns}
              activeStreamCount={activeStreamCount}
            />
          )}

          {/* ── BACKGROUND GRADIENT ── */}
          {activeTab === "bg" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* ── LOGO OVERLAY ── */}
              <SectionDivider label="Logo Overlay" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.6 }}>
                Place your channel logo on the stream. Upload a PNG (transparent background recommended).
              </div>

              {/* Logo upload */}
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {bs.logoUrl && (
                  <div style={{
                    width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <img src={bs.logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  </div>
                )}
                <label style={{
                  flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                  borderRadius: 8, border: "1px dashed rgba(251,113,133,0.4)",
                  background: "rgba(251,113,133,0.05)", cursor: "pointer",
                  color: "#fda4af", fontSize: 12, fontWeight: 600,
                }}>
                  <Upload size={13} />
                  {bs.logoUrl ? "Replace logo" : "Upload logo (PNG/SVG)"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const dataUrl = ev.target?.result as string;
                        localUpdate({ logoUrl: dataUrl });
                        update({ logoUrl: dataUrl });
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                {bs.logoUrl && (
                  <button
                    onClick={() => { localUpdate({ logoUrl: "", logoActive: false }); update({ logoUrl: "", logoActive: false }); }}
                    style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", cursor: "pointer", fontSize: 11 }}
                  >
                    Remove
                  </button>
                )}
              </div>

              {bs.logoUrl && (
                <>
                  {/* X position */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>X position</span>
                      <span style={{ fontSize: 11, color: "#fda4af", fontWeight: 600 }}>{bs.logoX}%</span>
                    </div>
                    <input type="range" min={0} max={100} step={1} value={bs.logoX}
                      onChange={(e) => { const v = Number(e.target.value); localUpdate({ logoX: v }); update({ logoX: v }); }}
                      style={{ accentColor: "#fb7185", cursor: "pointer" }} />
                  </div>

                  {/* Y position */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Y position</span>
                      <span style={{ fontSize: 11, color: "#fda4af", fontWeight: 600 }}>{bs.logoY}%</span>
                    </div>
                    <input type="range" min={0} max={90} step={1} value={bs.logoY}
                      onChange={(e) => { const v = Number(e.target.value); localUpdate({ logoY: v }); update({ logoY: v }); }}
                      style={{ accentColor: "#fb7185", cursor: "pointer" }} />
                  </div>

                  {/* Size */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Size</span>
                      <span style={{ fontSize: 11, color: "#fda4af", fontWeight: 600 }}>{bs.logoSize}px</span>
                    </div>
                    <input type="range" min={40} max={300} step={10} value={bs.logoSize}
                      onChange={(e) => { const v = Number(e.target.value); localUpdate({ logoSize: v }); update({ logoSize: v }); }}
                      style={{ accentColor: "#fb7185", cursor: "pointer" }} />
                  </div>

                  {/* Opacity */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Opacity</span>
                      <span style={{ fontSize: 11, color: "#fda4af", fontWeight: 600 }}>{bs.logoOpacity}%</span>
                    </div>
                    <input type="range" min={10} max={100} step={5} value={bs.logoOpacity}
                      onChange={(e) => { const v = Number(e.target.value); localUpdate({ logoOpacity: v }); update({ logoOpacity: v }); }}
                      style={{ accentColor: "#fb7185", cursor: "pointer" }} />
                  </div>

                  {/* Loop animation — 5 types. Each plays through once, then holds at
                      rest for the configured pause, then plays again — not a
                      continuous wobble. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Loop animation
                    </div>
                    <StylePills
                      styles={LOGO_ANIMATIONS}
                      current={bs.logoAnimation}
                      accent="#fb7185"
                      onSelect={(v) => { localUpdate({ logoAnimation: v as BroadcastState["logoAnimation"] }); update({ logoAnimation: v as BroadcastState["logoAnimation"] }); }}
                    />
                    {bs.logoAnimation !== "None" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Pause between plays</span>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                            {bs.logoAnimGap >= 60 ? "1m" : `${bs.logoAnimGap.toFixed(1)}s`}
                          </span>
                        </div>
                        <input
                          type="range" min={0} max={60} step={0.5}
                          value={bs.logoAnimGap}
                          onChange={(e) => { const v = Number(e.target.value); localUpdate({ logoAnimGap: v }); update({ logoAnimGap: v }); }}
                          style={{ accentColor: "#fb7185", cursor: "pointer" }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Background plate behind the logo */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        Background plate
                      </div>
                      <button
                        onClick={() => { const v = !bs.logoBgEnabled; localUpdate({ logoBgEnabled: v }); update({ logoBgEnabled: v }); }}
                        style={{
                          width: 36, height: 20, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)",
                          background: bs.logoBgEnabled ? "#fb7185" : "rgba(255,255,255,0.08)",
                          position: "relative", cursor: "pointer", padding: 0, transition: "background 0.2s ease",
                        }}
                        aria-label="Toggle logo background plate"
                      >
                        <span style={{
                          position: "absolute", top: 2, left: bs.logoBgEnabled ? 18 : 2,
                          width: 14, height: 14, borderRadius: "50%", background: "#fff",
                          transition: "left 0.2s ease",
                        }} />
                      </button>
                    </div>
                    {bs.logoBgEnabled && (
                      <>
                        <StylePills
                          styles={LOGO_BG_SHAPES}
                          current={bs.logoBgShape}
                          accent="#fb7185"
                          onSelect={(v) => { localUpdate({ logoBgShape: v as BroadcastState["logoBgShape"] }); update({ logoBgShape: v as BroadcastState["logoBgShape"] }); }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Color</span>
                          <input
                            type="color"
                            value={rgbaToHex(bs.logoBgColor)}
                            onChange={(e) => { const v = e.target.value; localUpdate({ logoBgColor: v }); update({ logoBgColor: v }); }}
                            style={{ width: 30, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Go Live / Stop */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <ToggleButton
                      active={bs.logoActive}
                      accent="#fb7185"
                      countdownSecs={countdowns["logo"]}
                      onCancel={() => cancelGoLive("logo")}
                      onActivate={() => goLive("logo", {
                        logoActive: true, logoUrl: bs.logoUrl,
                        logoX: bs.logoX, logoY: bs.logoY,
                        logoSize: bs.logoSize, logoOpacity: bs.logoOpacity,
                        logoBgEnabled: bs.logoBgEnabled, logoBgColor: bs.logoBgColor, logoBgShape: bs.logoBgShape,
                        logoAnimation: bs.logoAnimation, logoAnimGap: bs.logoAnimGap,
                      })}
                      onDeactivate={() => stopOverlay({ logoActive: false })}
                    />
                    <LiveBadge label="Logo overlay" active={bs.logoActive} accent="#fb7185" />
                  </div>
                </>
              )}

              <SectionDivider label="Background Gradient" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.6 }}>
                Add a gradient behind the video — visible in the letterbox bars when the source doesn't fill the full frame. Does not affect the video content itself.
              </div>

              {/* Gradient preview swatch */}
              <div style={{
                borderRadius: 12, overflow: "hidden", height: 72, position: "relative",
                background: `linear-gradient(135deg, ${bs.bgGradient1}, ${bs.bgGradient2})`,
                border: `1px solid ${bs.bgGradientActive ? "rgba(251,113,133,0.5)" : "rgba(255,255,255,0.1)"}`,
                transition: "border-color 0.3s ease",
              }}>
                {!bs.bgGradientActive && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.45)",
                    fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600,
                  }}>
                    Preview — tap Go Live to activate
                  </div>
                )}
              </div>

              {/* Color pickers */}
              <div style={{ display: "flex", gap: 10 }}>
                {(["bgGradient1", "bgGradient2"] as const).map((field, i) => (
                  <div key={field} style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Colour {i + 1}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="color"
                        value={(bs as any)[field]}
                        onChange={(e) => {
                          const val = e.target.value;
                          localUpdate({ [field]: val } as any);
                          // Always persist to server so gradient shows on next activation
                          if ((window as any).__bgDebTimer) clearTimeout((window as any).__bgDebTimer);
                          (window as any).__bgDebTimer = setTimeout(() => update({ [field]: val } as any), 400);
                        }}
                        style={{ width: 36, height: 32, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", padding: 2 }}
                      />
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                        {(bs as any)[field]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Opacity slider */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Opacity (in bars)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={0.1} max={1} step={0.05}
                    value={bs.bgGradientOpacity}
                    onChange={(e) => (bs.bgGradientActive ? update : localUpdate)({ bgGradientOpacity: Number(e.target.value) })}
                    style={{ flex: 1, accentColor: "#fb7185", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 36, textAlign: "right" }}>
                    {Math.round(bs.bgGradientOpacity * 100)}%
                  </span>
                </div>
              </div>

              <SectionDivider label="Quick presets" />

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { label: "Midnight", c1: "#0f0c29", c2: "#302b63" },
                  { label: "Sunset",   c1: "#f7971e", c2: "#c71d6f" },
                  { label: "Ocean",    c1: "#0f2027", c2: "#2c5364" },
                  { label: "Forest",   c1: "#134e5e", c2: "#71b280" },
                  { label: "Lava",     c1: "#200122", c2: "#6f0000" },
                  { label: "Neon",     c1: "#08004a", c2: "#0057ff" },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => update({ bgGradient1: preset.c1, bgGradient2: preset.c2 })}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600,
                      transition: "all 0.18s ease",
                    }}
                  >
                    <div style={{
                      width: 12, height: 12, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${preset.c1}, ${preset.c2})`,
                      border: "1px solid rgba(255,255,255,0.2)",
                    }} />
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.bgGradientActive}
                  accent="#fb7185"
                  countdownSecs={countdowns["bg"]}
                  onCancel={() => cancelGoLive("bg")}
                  onActivate={() => goLive("bg", {
                    bgGradientActive: true,
                    bgGradient1: bs.bgGradient1,
                    bgGradient2: bs.bgGradient2,
                    bgGradientOpacity: bs.bgGradientOpacity,
                  })}
                  onDeactivate={() => stopOverlay({ bgGradientActive: false })}
                />
                <LiveBadge label="Background gradient" active={bs.bgGradientActive} accent="#fb7185" />
              </div>

              <div style={{ padding: "9px 14px", borderRadius: 8, background: "rgba(251,113,133,0.06)", border: "1px solid rgba(251,113,133,0.15)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                The gradient fills the background pipe behind the video. It is visible in letterbox bars (e.g. when a portrait source is streamed to a landscape output). Break screens always cover the entire frame and take precedence.
              </div>
            </div>
          )}

          {/* ── QR / SuperChat Overlay tab ───────────────────────────────── */}
          {activeTab === "qr" && (() => {
            const qrPreviewSrc = qrGatewayUrl
              ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrGatewayUrl)}&margin=1&color=1a1a1a&bgcolor=ffffff&ecc=M`
              : "";
            const toggleOnStream = () => {
              if (!qrGatewayUrl) return;
              if (bs.qrActive) {
                localUpdate({ qrActive: false });
                update({ qrActive: false });
              } else {
                localUpdate({ qrActive: true, qrUrl: qrGatewayUrl });
                update({ qrActive: true, qrUrl: qrGatewayUrl, qrSize: bs.qrSize, qrPosition: bs.qrPosition });
              }
            };
            return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12,
                background: "linear-gradient(135deg, rgba(255,214,0,0.14) 0%, rgba(255,170,0,0.08) 100%)",
                border: "1px solid rgba(255,214,0,0.3)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>💛</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#ffd600", letterSpacing: "0.03em" }}>SuperChat QR Overlay</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Viewer scans → pays → gift plays on stream</div>
                  </div>
                </div>
                <button onClick={() => void fetchQrGatewayUrl()} title="Refresh URL" style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4 }}>
                  <RefreshCw size={12} style={{ animation: qrGatewayLoading ? "cr-spin 1s linear infinite" : "none" }} />
                </button>
              </div>

              {/* Broadcast overlay info box */}
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                📺 <strong style={{ color: "rgba(255,255,255,0.75)" }}>Viewers see the QR via your broadcast overlay.</strong> In OBS, add a Browser Source pointing to your <code style={{ color: "#a5b4fc" }}>/broadcast</code> URL — the Super Chat card appears automatically when you activate it.
              </div>

              {/* QR preview */}
              {qrGatewayLoading && (
                <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                  <RefreshCw size={22} style={{ animation: "cr-spin 1s linear infinite", color: "#ffd600" }} />
                </div>
              )}
              {!qrGatewayLoading && !qrGatewayUrl && (
                <div style={{ padding: "16px", borderRadius: 10, background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", textAlign: "center", fontSize: 11, color: "rgba(255,120,120,0.8)" }}>
                  ⚠ Gateway URL not configured — check <code style={{ color: "#fca5a5" }}>/api/gateway/url</code>
                </div>
              )}
              {!qrGatewayLoading && qrGatewayUrl && (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {/* QR thumbnail */}
                  <div style={{ padding: 8, borderRadius: 10, background: "#fff", boxShadow: "0 0 0 3px #ffd600, 0 4px 16px rgba(0,0,0,0.5)", flexShrink: 0 }}>
                    <img
                      src={qrPreviewSrc}
                      alt="SuperChat QR"
                      style={{ width: 96, height: 96, display: "block" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#ffd600", textTransform: "uppercase", letterSpacing: "0.08em" }}>💛 Super Chat QR</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", wordBreak: "break-all", lineHeight: 1.4 }}>{qrGatewayUrl}</div>

                    {/* Scan + thank-you badges */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      {bs.qrScanCount > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 99, background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)", fontSize: 10, fontWeight: 700, color: "#67e8f9" }}>
                          👁 {bs.qrScanCount} scan{bs.qrScanCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {bs.qrThankYouName && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 99, background: "rgba(255,214,0,0.15)", border: "1px solid rgba(255,214,0,0.35)", fontSize: 10, fontWeight: 700, color: "#ffd600" }}>
                          🎉 {bs.qrThankYouName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Show / Hide on stream */}
              <button
                disabled={!qrGatewayUrl}
                onClick={toggleOnStream}
                style={{
                  width: "100%", padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: qrGatewayUrl ? "pointer" : "not-allowed",
                  border: `1px solid ${bs.qrActive ? "#ffd600" : "rgba(255,255,255,0.15)"}`,
                  background: bs.qrActive ? "linear-gradient(135deg, rgba(255,214,0,0.25), rgba(255,170,0,0.18))" : "rgba(255,255,255,0.06)",
                  color: bs.qrActive ? "#ffd600" : "rgba(255,255,255,0.55)",
                  transition: "all 0.2s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: qrGatewayUrl ? 1 : 0.4,
                }}
              >
                <span style={{ fontSize: 16 }}>📺</span>
                {bs.qrActive ? "Showing on Stream — tap to Hide" : "Show SuperChat QR on Stream"}
              </button>

              {/* Size slider */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>QR Size</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#67e8f9" }}>{bs.qrSize ?? 180}px</div>
                </div>
                <input type="range" min={80} max={400} step={10}
                  value={bs.qrSize ?? 180}
                  disabled={qrLocked}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    localUpdate({ qrSize: v });
                  }}
                  onMouseUp={(e) => {
                    const v = parseInt((e.target as HTMLInputElement).value);
                    update({ qrSize: v, qrUrl: qrGatewayUrl });
                  }}
                  style={{ width: "100%", accentColor: "#06b6d4", cursor: qrLocked ? "not-allowed" : "pointer" }}
                />
              </div>

              {/* Corner presets + lock */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Quick Position</div>
                  <button
                    onClick={() => setQrLocked(l => !l)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${qrLocked ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.12)"}`,
                      background: qrLocked ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
                      color: qrLocked ? "#fca5a5" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {qrLocked ? "🔒 Locked" : "🔓 Lock"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[
                    { label: "↖ Top-Left",    pos: { x: 8,  y: 8  } },
                    { label: "↗ Top-Right",   pos: { x: 88, y: 8  } },
                    { label: "↙ Bot-Left",    pos: { x: 8,  y: 80 } },
                    { label: "↘ Bot-Right",   pos: { x: 88, y: 80 } },
                  ].map(preset => {
                    const isActive = Math.abs((bs.qrPosition?.x ?? 88) - preset.pos.x) < 4 && Math.abs((bs.qrPosition?.y ?? 8) - preset.pos.y) < 4;
                    return (
                      <button
                        key={preset.label}
                        disabled={qrLocked}
                        onClick={() => {
                          localUpdate({ qrPosition: preset.pos });
                          if (qrPosDebRef.current) clearTimeout(qrPosDebRef.current);
                          qrPosDebRef.current = setTimeout(() => update({ qrPosition: preset.pos }), 300);
                        }}
                        style={{
                          padding: "6px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                          cursor: qrLocked ? "not-allowed" : "pointer",
                          border: `1px solid ${isActive ? "#06b6d4" : "rgba(255,255,255,0.10)"}`,
                          background: isActive ? "rgba(6,182,212,0.18)" : "rgba(255,255,255,0.04)",
                          color: isActive ? "#67e8f9" : "rgba(255,255,255,0.4)",
                          transition: "all 0.15s",
                        }}
                      >{preset.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* X / Y fine sliders */}
              {["x", "y"].map(axis => (
                <div key={axis}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Position {axis.toUpperCase()}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#67e8f9" }}>{Math.round((bs.qrPosition?.[axis as "x"|"y"] ?? (axis === "x" ? 88 : 8)))}%</div>
                  </div>
                  <input type="range" min={0} max={100} step={1}
                    value={bs.qrPosition?.[axis as "x"|"y"] ?? (axis === "x" ? 88 : 8)}
                    disabled={qrLocked}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      const next = { ...(bs.qrPosition ?? { x: 88, y: 8 }), [axis]: v };
                      localUpdate({ qrPosition: next });
                    }}
                    onMouseUp={(e) => {
                      const v = parseInt((e.target as HTMLInputElement).value);
                      const next = { ...(bs.qrPosition ?? { x: 88, y: 8 }), [axis]: v };
                      if (qrPosDebRef.current) clearTimeout(qrPosDebRef.current);
                      qrPosDebRef.current = setTimeout(() => update({ qrPosition: next }), 200);
                    }}
                    style={{ width: "100%", accentColor: "#06b6d4", cursor: qrLocked ? "not-allowed" : "pointer" }}
                  />
                </div>
              ))}

              {/* ── Thank You Card Style ── */}
              <SectionDivider label="Thank You Card Style" />
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, lineHeight: 1.5 }}>
                Design shown on stream after a successful payment.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {[
                  { id: "Classic",     icon: "✅", label: "Classic",     desc: "Green checkmark card",      accent: "#22c55e" },
                  { id: "Neon",        icon: "⚡", label: "Neon",        desc: "Glowing cyan borders",      accent: "#06b6d4" },
                  { id: "Gold",        icon: "🏆", label: "Gold",        desc: "Dark gold trophy card",     accent: "#fbbf24" },
                  { id: "Celebration", icon: "🎉", label: "Celebration", desc: "Vivid gradient + sparkles", accent: "#a855f7" },
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => { localUpdate({ thankYouStyle: s.id }); update({ thankYouStyle: s.id }); }}
                    style={{
                      padding: "10px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${bs.thankYouStyle === s.id ? s.accent : "rgba(255,255,255,0.10)"}`,
                      background: bs.thankYouStyle === s.id ? `${s.accent}22` : "rgba(255,255,255,0.04)",
                      color: bs.thankYouStyle === s.id ? s.accent : "rgba(255,255,255,0.45)",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{s.icon}</span>
                    <span>{s.label}</span>
                    <span style={{ fontSize: 9, opacity: 0.7, fontWeight: 500 }}>{s.desc}</span>
                  </button>
                ))}
              </div>

              {/* Glow intensity */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>✨ Glow Intensity</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#ffd600" }}>{bs.qrGlowIntensity ?? 0}%</div>
                </div>
                <input type="range" min={0} max={100} step={5}
                  value={bs.qrGlowIntensity ?? 0}
                  onChange={(e) => { const v = parseInt(e.target.value); localUpdate({ qrGlowIntensity: v }); }}
                  onMouseUp={(e) => { const v = parseInt((e.target as HTMLInputElement).value); update({ qrGlowIntensity: v }); }}
                  style={{ width: "100%", accentColor: "#ffd600" }}
                />
              </div>

              {/* Border style */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Border Style</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {[
                    { id: "solid",  label: "— Solid"  },
                    { id: "glow",   label: "✦ Glow"   },
                    { id: "dashed", label: "--- Dashed" },
                    { id: "none",   label: "✕ None"   },
                  ].map(b => (
                    <button
                      key={b.id}
                      onClick={() => { localUpdate({ qrBorderStyle: b.id }); update({ qrBorderStyle: b.id }); }}
                      style={{
                        flex: 1, padding: "5px 3px", borderRadius: 7, fontSize: 9, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${bs.qrBorderStyle === b.id ? "#ffd600" : "rgba(255,255,255,0.10)"}`,
                        background: bs.qrBorderStyle === b.id ? "rgba(255,214,0,0.18)" : "rgba(255,255,255,0.04)",
                        color: bs.qrBorderStyle === b.id ? "#ffd600" : "rgba(255,255,255,0.4)",
                        transition: "all 0.15s",
                      }}
                    >{b.label}</button>
                  ))}
                </div>
              </div>

              {/* Animation style */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Animation</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {[
                    { id: "pulse", label: "💓 Pulse" },
                    { id: "float", label: "🌊 Float" },
                    { id: "none",  label: "⏸ Static" },
                  ].map(anim => (
                    <button
                      key={anim.id}
                      onClick={() => { localUpdate({ qrAnimation: anim.id }); update({ qrAnimation: anim.id }); }}
                      style={{
                        flex: 1, padding: "5px 4px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${bs.qrAnimation === anim.id ? "#06b6d4" : "rgba(255,255,255,0.10)"}`,
                        background: bs.qrAnimation === anim.id ? "rgba(6,182,212,0.18)" : "rgba(255,255,255,0.04)",
                        color: bs.qrAnimation === anim.id ? "#67e8f9" : "rgba(255,255,255,0.4)",
                        transition: "all 0.15s",
                      }}
                    >{anim.label}</button>
                  ))}
                </div>
              </div>

              {/* ── Paystack Superchat Payment ─────────────────────────── */}
              <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />

              <div style={{
                padding: "12px 14px", borderRadius: 12,
                background: "linear-gradient(135deg, rgba(0,200,120,0.12) 0%, rgba(0,160,100,0.06) 100%)",
                border: "1px solid rgba(0,200,120,0.28)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{ fontSize: 18 }}>💳</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "#4ade80", letterSpacing: "0.03em" }}>Paystack Direct Payment</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Generate a one-time QR — viewer scans → pays → stream notified</div>
                </div>
              </div>

              {/* Stream picker */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Stream</div>
                <select
                  value={payStreamId}
                  onChange={(e) => { setPayStreamId(e.target.value); void resetPayment(); }}
                  disabled={payStatus === "loading" || payStatus === "active" || payStatus === "scanned"}
                  style={{
                    width: "100%", padding: "7px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                    color: "#fff", cursor: "pointer", outline: "none",
                  }}
                >
                  <option value="">— pick a stream —</option>
                  {streams.filter((s: Stream) => s.status === "running" || s.status === "idle").map((s: Stream) => {
                    const label = s.sourceType === "tiktok" ? `@${s.tiktokUsername}`
                      : s.sourceType === "youtube" ? (s.youtubeSourceUrl || "YouTube")
                      : s.sourceType === "link" ? ((s as any).linkSourceUrl || "Video Link")
                      : s.cameraDevice || `Stream ${s.id.slice(0, 6)}`;
                    return <option key={s.id} value={s.id}>{label}</option>;
                  })}
                </select>
              </div>

              {/* Title + Amount */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Title</div>
                  <input
                    type="text"
                    value={payTitle}
                    onChange={(e) => setPayTitle(e.target.value)}
                    placeholder="Super Chat"
                    disabled={payStatus === "loading" || payStatus === "active" || payStatus === "scanned"}
                    style={{
                      width: "100%", padding: "7px 10px", borderRadius: 8, fontSize: 11,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                      color: "#fff", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ width: 90 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Amount</div>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0"
                    min="1"
                    disabled={payStatus === "loading" || payStatus === "active" || payStatus === "scanned"}
                    style={{
                      width: "100%", padding: "7px 10px", borderRadius: 8, fontSize: 11,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                      color: "#fff", outline: "none", boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Status pill */}
              {payStatus !== "idle" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {(["active","scanned","paid"] as const).map(s => {
                    const active = payStatus === s || (s === "active" && (payStatus === "scanned" || payStatus === "paid")) || (s === "scanned" && payStatus === "paid");
                    const isCurrent = payStatus === s;
                    const labels = { active: "⏳ Waiting", scanned: "👁 Scanned", paid: "✅ Paid" };
                    const colors = { active: "#ffd600", scanned: "#06b6d4", paid: "#4ade80" };
                    return (
                      <div key={s} style={{
                        flex: 1, padding: "5px 6px", borderRadius: 8, textAlign: "center", fontSize: 10, fontWeight: 700,
                        border: `1px solid ${active ? colors[s] + "66" : "rgba(255,255,255,0.10)"}`,
                        background: isCurrent ? colors[s] + "22" : (active ? colors[s] + "11" : "transparent"),
                        color: active ? colors[s] : "rgba(255,255,255,0.25)",
                        transition: "all 0.2s",
                      }}>{labels[s]}</div>
                    );
                  })}
                </div>
              )}

              {/* Error */}
              {payStatus === "error" && payError && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "#fca5a5" }}>
                  ⚠ {payError}
                </div>
              )}

              {/* QR display when active/scanned */}
              {(payStatus === "active" || payStatus === "scanned") && payQrUrl && (
                <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
                  <div style={{
                    padding: 10, borderRadius: 12, background: "#fff",
                    boxShadow: `0 0 0 3px ${payStatus === "scanned" ? "#06b6d4" : "#4ade80"}, 0 6px 24px rgba(0,0,0,0.6)`,
                    transition: "box-shadow 0.3s",
                  }}>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payQrUrl)}&margin=1&color=1a1a1a&bgcolor=ffffff&ecc=M`}
                      alt="Payment QR"
                      style={{ width: 140, height: 140, display: "block" }}
                    />
                  </div>
                </div>
              )}

              {/* Thank-you card */}
              {payStatus === "paid" && (
                <div style={{
                  padding: "16px", borderRadius: 12, textAlign: "center",
                  background: "linear-gradient(135deg, rgba(74,222,128,0.18), rgba(34,197,94,0.10))",
                  border: "1px solid rgba(74,222,128,0.4)",
                }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>🎉</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#4ade80" }}>Payment received!</div>
                  {payerName && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>Thank you, <strong style={{ color: "#fff" }}>{payerName}</strong>!</div>}
                </div>
              )}

              {/* Generate / Reset buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                {(payStatus === "idle" || payStatus === "error") && (
                  <button
                    disabled={!payStreamId || !payAmount}
                    onClick={() => void initiatePayment()}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: "pointer",
                      border: "1px solid rgba(74,222,128,0.5)",
                      background: (!payStreamId || !payAmount) ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg, rgba(74,222,128,0.25), rgba(34,197,94,0.18))",
                      color: (!payStreamId || !payAmount) ? "rgba(255,255,255,0.3)" : "#4ade80",
                      opacity: (!payStreamId || !payAmount) ? 0.5 : 1,
                      transition: "all 0.2s",
                    }}
                  >
                    💳 Generate Payment QR
                  </button>
                )}
                {payStatus === "loading" && (
                  <div style={{ flex: 1, padding: "10px", borderRadius: 10, textAlign: "center", fontSize: 12, color: "#4ade80", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)" }}>
                    <RefreshCw size={13} style={{ display: "inline", animation: "cr-spin 1s linear infinite", marginRight: 6 }} />
                    Creating…
                  </div>
                )}
                {(payStatus === "active" || payStatus === "scanned" || payStatus === "paid") && (
                  <button
                    onClick={() => void resetPayment()}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#f87171",
                      transition: "all 0.2s",
                    }}
                  >
                    🔄 Reset / New Payment
                  </button>
                )}
              </div>

            </div>
            );
          })()}


          {/* ── Donate tab ───────────────────────────────────────────────── */}
          {activeTab === "donate" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Overlay toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { label: "⚡ SuperChat Alert Popup", key: "donationAlertActive" as const, hint: "Animated pop-up when a SuperChat arrives" },
                    { label: "📊 SuperChat Ticker Bar",  key: "donationTickerActive" as const, hint: "Scrolling ticker showing latest supporters" },
                  ] as const
                ).map(({ label, key, hint }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{label}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{hint}</div>
                    </div>
                    <div
                      onClick={() => {
                        const next = !bs[key];
                        localUpdate({ [key]: next } as Partial<BroadcastState>);
                        update({ [key]: next } as Partial<BroadcastState>);
                      }}
                      style={{
                        width: 38, height: 20, borderRadius: 999, cursor: "pointer", position: "relative", flexShrink: 0,
                        background: bs[key] ? "#22c55e" : "rgba(255,255,255,0.12)",
                        transition: "background 0.2s",
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 2, left: bs[key] ? 20 : 2, width: 16, height: 16,
                        borderRadius: "50%", background: "#fff", transition: "left 0.2s",
                      }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* DonationPanel — live feed + QR + stats */}
              <DonationPanel
                latestDonation={latestDonation}
                donationTickerActive={bs.donationTickerActive}
                donationAlertActive={bs.donationAlertActive}
                onToggleTicker={(active) => { localUpdate({ donationTickerActive: active }); update({ donationTickerActive: active }); }}
                onToggleAlert={(active) => { localUpdate({ donationAlertActive: active }); update({ donationAlertActive: active }); }}
              />

              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)", fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                SuperChats are collected via the public <strong style={{ color: "#22c55e" }}>/gateway-payment</strong> page. Share the QR code from the QR tab or copy the link directly from the SuperChat panel.
              </div>
            </div>
          )}

          {/* ── Screen Share tab ─────────────────────────────────────── */}
          {activeTab === "screen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* iframe / no-API guard — only block when the browser genuinely
                  lacks getDisplayMedia. Modern Android Chrome (111+) DOES
                  support screen capture (it hands off to the OS's screen
                  recorder, briefly showing the home launcher / app chooser
                  before returning "Entire screen" as a capturable surface),
                  so we must not hard-block based on a mobile user-agent
                  check — only iOS Safari and old/embedded browsers truly
                  lack the API, and those fall into the branch below. */}
              {typeof navigator.mediaDevices?.getDisplayMedia !== "function" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 12, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.3)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fde68a", marginBottom: 4 }}>Open in a real browser tab</div>
                      <div style={{ fontSize: 12, color: "rgba(253,230,138,0.7)", lineHeight: 1.6 }}>
                        Screen capture is blocked inside embedded frames. Click the button below to open the dashboard in its own tab, then come back to this Screen tab.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => window.open(window.location.href, "_blank")}
                    style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.15)", color: "#fde68a" }}
                  >
                    <MonitorUp size={14} /> Open app in new tab →
                  </button>
                </div>
              ) : (
                <>
                  {/* Main control card */}
                  <div style={{
                    borderRadius: 14,
                    background: screenActive
                      ? "linear-gradient(135deg, rgba(129,140,248,0.12) 0%, rgba(99,102,241,0.08) 100%)"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${screenActive ? "rgba(129,140,248,0.35)" : "rgba(255,255,255,0.08)"}`,
                    padding: "16px",
                    display: "flex", flexDirection: "column", gap: 12,
                    transition: "all 0.25s ease",
                  }}>
                    {/* Status row */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: screenActive ? "rgba(129,140,248,0.2)" : "rgba(255,255,255,0.05)",
                          border: `1px solid ${screenActive ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.1)"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <MonitorUp size={16} color={screenActive ? "#a5b4fc" : "rgba(255,255,255,0.4)"} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: screenActive ? "#e0e7ff" : "rgba(255,255,255,0.7)" }}>
                            Screen Share
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                            {screenActive ? "Capturing & compositing at 24 fps" : "Captures your full screen as an overlay"}
                          </div>
                        </div>
                      </div>
                      {!screenActive && !screenConnecting && (
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                          When the browser's share picker opens, choose{" "}
                          <strong style={{ color: "rgba(255,255,255,0.65)" }}>"Entire Screen"</strong>{" "}
                          (not a specific tab or window) to broadcast your whole desktop.
                        </div>
                      )}
                      {screenActive && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(129,140,248,0.15)", border: "1px solid rgba(129,140,248,0.4)" }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "cr-pulse 1s infinite" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#a5b4fc", letterSpacing: "0.05em" }}>LIVE</span>
                        </div>
                      )}
                    </div>

                    {/* Live preview thumbnail */}
                    {screenPreviewUrl && (
                      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(129,140,248,0.2)", background: "#000", position: "relative" }}>
                        <img src={screenPreviewUrl} alt="Screen preview" style={{ width: "100%", display: "block" }} />
                        <div style={{ position: "absolute", bottom: 6, right: 8, padding: "2px 7px", borderRadius: 5, background: "rgba(0,0,0,0.6)", fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>24 fps</div>
                      </div>
                    )}

                    {/* Start / Stop button */}
                    <button
                      onClick={screenActive ? stopScreenShare : startScreenShare}
                      disabled={screenConnecting}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                        cursor: screenConnecting ? "default" : "pointer",
                        border: `1px solid ${screenActive ? "rgba(239,68,68,0.4)" : "rgba(129,140,248,0.5)"}`,
                        background: screenActive ? "rgba(239,68,68,0.1)" : "rgba(129,140,248,0.18)",
                        color: screenActive ? "#fca5a5" : "#a5b4fc",
                        transition: "all 0.2s ease",
                        opacity: screenConnecting ? 0.6 : 1,
                      }}
                    >
                      {screenConnecting
                        ? <><Loader2 size={15} style={{ animation: "cr-spin 1s linear infinite" }} /> Connecting to server…</>
                        : screenActive
                          ? <><MonitorUp size={15} /> Stop Screen Share</>
                          : <><MonitorUp size={15} /> Start Screen Share</>
                      }
                    </button>

                    {screenError && (
                      <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>
                        {screenError}
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
                      Clicking Start opens your browser's share picker — you'll see three tabs: <strong style={{ color: "rgba(255,255,255,0.5)" }}>Entire Screen</strong>, <strong style={{ color: "rgba(255,255,255,0.5)" }}>Window</strong>, and <strong style={{ color: "rgba(255,255,255,0.5)" }}>Tab</strong>.
                    </div>
                    <div style={{ marginTop: 8, padding: "9px 12px", borderRadius: 8, background: "rgba(129,140,248,0.07)", border: "1px solid rgba(129,140,248,0.18)", fontSize: 11, color: "rgba(200,200,255,0.55)", lineHeight: 1.6 }}>
                      <strong style={{ color: "rgba(165,180,252,0.8)" }}>App windows not appearing?</strong><br />
                      • <strong>Windows:</strong> Run Chrome as Administrator, or open Chrome settings → Privacy → Screen capture<br />
                      • <strong>macOS:</strong> System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording → enable Chrome<br />
                      • <strong>Linux (Wayland):</strong> App windows are blocked by Wayland — share the <em>Entire Screen</em> instead and move your app into view
                    </div>
                  </div>

                  {/* Display mode selector */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Display Mode</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {([
                        { mode: "presenter" as const, icon: "🖥️", label: "Presenter", desc: "Pro background" },
                        { mode: "fullscreen" as const, icon: "⬛", label: "Fullscreen", desc: "Fill the frame" },
                        { mode: "pip" as const,        icon: "📌", label: "PIP",        desc: "Corner overlay" },
                      ]).map(({ mode, icon, label, desc }) => (
                        <button
                          key={mode}
                          onClick={() => update({ screenShareMode: mode })}
                          style={{
                            flex: 1, padding: "9px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700,
                            border: `1px solid ${bs.screenShareMode === mode ? "#818cf8" : "rgba(255,255,255,0.1)"}`,
                            background: bs.screenShareMode === mode ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.03)",
                            color: bs.screenShareMode === mode ? "#a5b4fc" : "rgba(255,255,255,0.45)",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            transition: "all 0.18s ease",
                          }}
                        >
                          <span style={{ fontSize: 15 }}>{icon}</span>
                          <span>{label}</span>
                          <span style={{ fontWeight: 400, fontSize: 9, opacity: 0.65 }}>{desc}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                      {bs.screenShareMode === "presenter" && "Screen centred on a dark studio background with purple accent glow — great for tech demos and presentations."}
                      {bs.screenShareMode === "fullscreen" && "Screen fills the entire frame edge-to-edge, replacing the live video."}
                      {bs.screenShareMode === "pip" && "Floating picture-in-picture overlay. Drag the sliders below to position it."}
                    </div>
                  </div>

                  {/* PIP position controls — only shown in PIP mode */}
                  {bs.screenShareMode === "pip" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>PIP Position &amp; Size</div>

                    {/* Quick corner presets */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {([
                        { label: "↖ Top-Left",     x: 2,  y: 3  },
                        { label: "↗ Top-Right",    x: 60, y: 3  },
                        { label: "↙ Bottom-Left",  x: 2,  y: 62 },
                        { label: "↘ Bottom-Right", x: 60, y: 62 },
                      ] as const).map(({ label, x, y }) => (
                        <button
                          key={label}
                          onClick={() => {
                            localUpdate({ screenShareX: x, screenShareY: y });
                            update({ screenShareX: x, screenShareY: y });
                          }}
                          style={{
                            padding: "7px 6px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                            cursor: "pointer", border: "1px solid rgba(129,140,248,0.25)",
                            background: "rgba(129,140,248,0.08)", color: "#a5b4fc",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {[
                      { label: "X Position", key: "screenShareX" as const, min: 0, max: 95, unit: "%" },
                      { label: "Y Position", key: "screenShareY" as const, min: 0, max: 95, unit: "%" },
                      { label: "Width",      key: "screenShareW" as const, min: 5, max: 90, unit: "%" },
                      { label: "Corner Radius", key: "screenShareRadius" as const, min: 0, max: 60, unit: "px" },
                    ].map(({ label, key, min, max, unit }) => (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{label}</span>
                          <span style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700 }}>{bs[key]}{unit}</span>
                        </div>
                        <input
                          type="range" min={min} max={max} step={1}
                          value={bs[key]}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            localUpdate({ [key]: val });
                            if (screenDebRef.current) clearTimeout(screenDebRef.current);
                            screenDebRef.current = setTimeout(() => update({ [key]: val } as any), 300);
                          }}
                          style={{ width: "100%", accentColor: "#818cf8", cursor: "pointer" }}
                        />
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Corner radius for Presenter mode */}
                  {bs.screenShareMode === "presenter" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Corner Radius</span>
                      <span style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700 }}>{bs.screenShareRadius}px</span>
                    </div>
                    <input
                      type="range" min={0} max={40} step={1}
                      value={bs.screenShareRadius}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        localUpdate({ screenShareRadius: val });
                        if (screenDebRef.current) clearTimeout(screenDebRef.current);
                        screenDebRef.current = setTimeout(() => update({ screenShareRadius: val }), 300);
                      }}
                      style={{ width: "100%", accentColor: "#818cf8", cursor: "pointer" }}
                    />
                  </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Music tab ────────────────────────────────────────────── */}
          {activeTab === "music" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

              {/* ── Broadcast status banner ── */}
              <div
                onClick={() => {
                  if (musicBroadcastActive) { stopMusicBroadcast(); }
                  else { setMusicBroadcast(true); startMusicBroadcast().catch(() => {}); }
                }}
                style={{
                  margin: "0 0 10px",
                  borderRadius: 14, padding: "12px 16px",
                  display: "flex", alignItems: "center", gap: 12,
                  cursor: "pointer",
                  background: musicBroadcastActive
                    ? "linear-gradient(90deg, rgba(236,72,153,0.18) 0%, rgba(168,85,247,0.14) 100%)"
                    : "rgba(251,191,36,0.08)",
                  border: musicBroadcastActive
                    ? "1px solid rgba(244,114,182,0.4)"
                    : "1px solid rgba(251,191,36,0.35)",
                  transition: "all 0.25s ease",
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: musicBroadcastActive ? "rgba(244,114,182,0.2)" : "rgba(251,191,36,0.15)",
                  border: musicBroadcastActive ? "1.5px solid rgba(244,114,182,0.5)" : "1.5px solid rgba(251,191,36,0.4)",
                }}>
                  <RadioIcon size={16} color={musicBroadcastActive ? "#f472b6" : "#fbbf24"} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: musicBroadcastActive ? "#fce7f3" : "#fde68a", letterSpacing: "-0.01em" }}>
                    {musicBroadcastActive ? "● Music is LIVE on your stream" : "⚠ Music not in stream — tap to go live"}
                  </div>
                  <div style={{ fontSize: 10, color: musicBroadcastActive ? "rgba(252,231,243,0.6)" : "rgba(253,230,138,0.6)", marginTop: 2 }}>
                    {musicBroadcastActive ? "Audience can hear the music right now" : "Listeners cannot hear the music yet"}
                  </div>
                </div>
                <div style={{
                  width: 44, height: 26, borderRadius: 13, flexShrink: 0,
                  background: musicBroadcastActive ? "linear-gradient(90deg, #ec4899, #a855f7)" : "rgba(251,191,36,0.25)",
                  border: musicBroadcastActive ? "none" : "1px solid rgba(251,191,36,0.45)",
                  position: "relative", transition: "all 0.22s ease",
                  boxShadow: musicBroadcastActive ? "0 2px 12px rgba(236,72,153,0.5)" : "none",
                }}>
                  <div style={{
                    position: "absolute", top: 3, left: musicBroadcastActive ? 21 : 3,
                    width: 20, height: 20, borderRadius: "50%", background: "#fff",
                    transition: "left 0.22s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }} />
                </div>
              </div>

              {/* Hidden file input */}
              <input
                ref={musicFileInputRef}
                type="file"
                accept="audio/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  files.forEach((f) => {
                    const url = URL.createObjectURL(f);
                    setPlaylist((prev) => [...prev, { id: crypto.randomUUID(), title: f.name.replace(/\.[^.]+$/, ""), url, isFile: true }]);
                  });
                  e.target.value = "";
                }}
              />

              {/* ── Player card ── */}
              <div style={{
                borderRadius: 20,
                background: "linear-gradient(160deg, #0e0618 0%, #18082e 50%, #0e1a10 100%)",
                border: "1px solid rgba(244,114,182,0.15)",
                overflow: "hidden",
                boxShadow: "0 16px 56px rgba(0,0,0,0.7)",
                marginBottom: 10,
              }}>
                {/* Now playing header */}
                <div style={{
                  padding: "16px 16px 0",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  {/* Vinyl / waveform disc */}
                  <div style={{
                    width: 64, height: 64, borderRadius: "50%", flexShrink: 0, position: "relative",
                    background: musicPlaying
                      ? "conic-gradient(from 0deg, #ec4899 0%, #a855f7 33%, #3b82f6 66%, #ec4899 100%)"
                      : "conic-gradient(from 0deg, #374151 0%, #1f2937 50%, #374151 100%)",
                    boxShadow: musicPlaying ? "0 0 24px rgba(236,72,153,0.45), 0 0 60px rgba(168,85,247,0.2)" : "none",
                    animation: musicPlaying ? "music-spin 3s linear infinite" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "box-shadow 0.4s",
                  }}>
                    {/* Centre hole */}
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: "#0e0618",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      zIndex: 1,
                    }}>
                      {!musicPlaying && <Music size={10} color="rgba(244,114,182,0.5)" />}
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {currentIdx !== null && playlist[currentIdx] ? (
                      <>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: -0.4, lineHeight: 1.2, marginBottom: 4 }}>
                          {playlist[currentIdx].title}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: playlist[currentIdx].isFile ? "rgba(96,165,250,0.15)" : "rgba(244,114,182,0.15)", border: `1px solid ${playlist[currentIdx].isFile ? "rgba(96,165,250,0.3)" : "rgba(244,114,182,0.3)"}`, color: playlist[currentIdx].isFile ? "#93c5fd" : "#f9a8d4" }}>
                            {playlist[currentIdx].isFile ? "LOCAL" : "STREAM"}
                          </span>
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{currentIdx + 1} / {playlist.length}</span>
                          {musicBroadcastActive && (
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 99, background: "rgba(244,114,182,0.2)", border: "1px solid rgba(244,114,182,0.4)", color: "#f472b6", animation: "music-blink 1.4s infinite" }}>● ON AIR</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", fontStyle: "italic", lineHeight: 1.4 }}>
                        No track loaded<br />
                        <span style={{ fontSize: 11 }}>Add a track below to start</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ padding: "14px 16px 0", display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums", width: 28, textAlign: "right", flexShrink: 0, fontFamily: "monospace" }}>
                    {fmtTime(musicCurrentTime)}
                  </span>
                  <div
                    style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.06)", cursor: "pointer", position: "relative", overflow: "visible" }}
                    onClick={(e) => {
                      const el = musicAudioRef.current;
                      if (!el || !el.duration) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      el.currentTime = pct * el.duration;
                    }}
                  >
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 4, background: "linear-gradient(90deg, #ec4899, #a855f7, #3b82f6)", width: `${musicProgress * 100}%`, transition: "width 0.3s linear" }} />
                    {musicProgress > 0 && (
                      <div style={{
                        position: "absolute", top: "50%", left: `${musicProgress * 100}%`,
                        transform: "translate(-50%, -50%)",
                        width: 12, height: 12, borderRadius: "50%", background: "#fff",
                        boxShadow: "0 0 8px rgba(236,72,153,0.9), 0 0 20px rgba(168,85,247,0.5)",
                      }} />
                    )}
                  </div>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums", width: 28, flexShrink: 0, fontFamily: "monospace" }}>
                    {fmtTime(musicDuration)}
                  </span>
                </div>

                {/* Playback controls */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 16px" }}>
                  <button
                    onClick={() => { if (playlist.length === 0) return; const idx = ((currentIdx ?? 0) - 1 + playlist.length) % playlist.length; playTrack(idx); }}
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", padding: 9, borderRadius: 12, transition: "all 0.15s" }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(244,114,182,0.15)"; el.style.color = "#f9a8d4"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,255,255,0.05)"; el.style.color = "rgba(255,255,255,0.5)"; }}
                  ><SkipBack size={16} /></button>

                  <button
                    onClick={() => {
                      if (currentIdx === null && playlist.length > 0) { playTrack(0); return; }
                      musicPlaying ? pauseTrack() : resumeTrack();
                    }}
                    style={{
                      width: 56, height: 56, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: "linear-gradient(135deg, #ec4899 0%, #a855f7 60%, #3b82f6 100%)",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 6px 28px rgba(236,72,153,0.55), 0 2px 8px rgba(168,85,247,0.3)",
                      transition: "transform 0.15s, box-shadow 0.15s", flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.transform = "scale(1.08)"; el.style.boxShadow = "0 10px 40px rgba(236,72,153,0.7), 0 4px 16px rgba(168,85,247,0.4)"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.transform = "scale(1)"; el.style.boxShadow = "0 6px 28px rgba(236,72,153,0.55), 0 2px 8px rgba(168,85,247,0.3)"; }}
                  >
                    {musicPlaying ? <Pause size={22} /> : <Play size={22} style={{ marginLeft: 2 }} />}
                  </button>

                  <button
                    onClick={() => { if (playlist.length === 0) return; const idx = ((currentIdx ?? 0) + 1) % playlist.length; playTrack(idx); }}
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", padding: 9, borderRadius: 12, transition: "all 0.15s" }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(244,114,182,0.15)"; el.style.color = "#f9a8d4"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,255,255,0.05)"; el.style.color = "rgba(255,255,255,0.5)"; }}
                  ><SkipForward size={16} /></button>
                </div>

                {/* Volume + broadcast row */}
                <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Volume */}
                  <div style={{ display: "flex", alignItems: "center", gap: 9, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "8px 12px" }}>
                    <Volume2 size={13} color="rgba(244,114,182,0.6)" style={{ flexShrink: 0 }} />
                    <input
                      type="range" min={0} max={100} step={1} value={musicVolume}
                      onChange={(e) => setMusicVolume(Number(e.target.value))}
                      style={{ flex: 1, accentColor: "#f472b6", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 11, color: "#f9a8d4", fontWeight: 700, width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{musicVolume}%</span>
                  </div>

                  {/* Volume label */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Volume2 size={11} color="rgba(255,255,255,0.3)" />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Volume affects stream output</span>
                  </div>
                </div>
              </div>

              {/* ── Error display ── */}
              {musicError && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10, marginBottom: 10,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
                  display: "flex", alignItems: "flex-start", gap: 8,
                }}>
                  <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1 }}>⚠️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#fca5a5", lineHeight: 1.55 }}>{musicError}</div>
                    {currentIdx !== null && playlist[currentIdx]?.originalUrl && (
                      <button
                        onClick={() => refreshTrack(playlist[currentIdx!].id)}
                        disabled={refreshingTrackId !== null}
                        style={{
                          marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6,
                          background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
                          color: "#fca5a5", cursor: "pointer",
                        }}
                      >
                        <RefreshCw size={10} style={refreshingTrackId ? { animation: "cr-spin 1s linear infinite" } : {}} />
                        {refreshingTrackId ? "Refreshing…" : "Refresh link"}
                      </button>
                    )}
                  </div>
                  <button onClick={() => setMusicError(null)} style={{ background: "none", border: "none", color: "rgba(252,165,165,0.5)", cursor: "pointer", padding: 2, flexShrink: 0, display: "flex" }}>
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* ── Add Track section ── */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden", marginBottom: 10 }}>
                <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 6 }}>
                  <Plus size={11} color="rgba(244,114,182,0.7)" />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 700 }}>Add Track</span>
                </div>
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    type="text"
                    value={musicAddTitle}
                    onChange={(e) => setMusicAddTitle(e.target.value)}
                    placeholder="Custom title (optional)"
                    style={{ padding: "8px 11px", borderRadius: 9, fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="text"
                      value={musicAddUrl}
                      onChange={(e) => setMusicAddUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addMusicUrl(); }}
                      placeholder="YouTube or direct audio URL (.mp3, .wav…)"
                      style={{ flex: 1, padding: "8px 11px", borderRadius: 9, fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", outline: "none" }}
                    />
                    <button
                      onClick={() => addMusicUrl()}
                      disabled={!musicAddUrl.trim() || musicResolving}
                      style={{
                        display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 9,
                        fontSize: 12, fontWeight: 700, cursor: (!musicAddUrl.trim() || musicResolving) ? "not-allowed" : "pointer",
                        background: "linear-gradient(135deg, rgba(236,72,153,0.25), rgba(168,85,247,0.25))",
                        border: "1px solid rgba(244,114,182,0.3)",
                        color: "#f9a8d4", opacity: (musicAddUrl.trim() && !musicResolving) ? 1 : 0.4, whiteSpace: "nowrap",
                      }}
                    >
                      {musicResolving ? <><Loader2 size={12} style={{ animation: "cr-spin 1s linear infinite" }} /> Resolving…</> : <><Plus size={12} /> Add</>}
                    </button>
                  </div>
                  <button
                    onClick={() => musicFileInputRef.current?.click()}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                      padding: "9px 14px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(244,114,182,0.4)"; el.style.color = "#f9a8d4"; }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "rgba(255,255,255,0.12)"; el.style.color = "rgba(255,255,255,0.4)"; }}
                  >
                    <Upload size={13} /> Upload audio file
                  </button>
                </div>
              </div>

              {/* ── Playlist ── */}
              {playlist.length > 0 ? (
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 6 }}>
                    <ListMusic size={11} color="rgba(244,114,182,0.7)" />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 700, flex: 1 }}>Playlist</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", fontWeight: 600 }}>{playlist.length} track{playlist.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                    {playlist.map((track, idx) => (
                      <div
                        key={track.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: 10,
                          background: currentIdx === idx ? "linear-gradient(135deg, rgba(236,72,153,0.12) 0%, rgba(168,85,247,0.08) 100%)" : "transparent",
                          border: `1px solid ${currentIdx === idx ? "rgba(244,114,182,0.2)" : "transparent"}`,
                          cursor: "pointer", transition: "all 0.15s ease",
                        }}
                        onClick={() => playTrack(idx)}
                        onMouseEnter={(e) => { if (currentIdx !== idx) { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(255,255,255,0.04)"; } }}
                        onMouseLeave={(e) => { if (currentIdx !== idx) { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; } }}
                      >
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: currentIdx === idx ? "rgba(236,72,153,0.2)" : "rgba(255,255,255,0.04)",
                          display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s",
                        }}>
                          {currentIdx === idx && musicPlaying
                            ? <div style={{ display: "flex", gap: 1.5, alignItems: "flex-end" }}>
                                {[7, 12, 8, 11].map((h, i) => (
                                  <div key={i} style={{ width: 2.5, borderRadius: 1.5, background: "#f472b6", height: `${h}px`, animation: `cr-pulse ${0.28 + i * 0.09}s ease-in-out infinite alternate` }} />
                                ))}
                              </div>
                            : <span style={{ fontSize: 9, color: currentIdx === idx ? "#f9a8d4" : "rgba(255,255,255,0.25)", fontWeight: 700 }}>{idx + 1}</span>
                          }
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: currentIdx === idx ? 700 : 500, color: currentIdx === idx ? "#fce7f3" : "rgba(255,255,255,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {track.title}
                          </div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginTop: 1 }}>
                            {track.isFile ? "Local file" : track.originalUrl ? "YouTube / URL" : "Direct URL"}
                          </div>
                        </div>

                        {track.originalUrl && (
                          <button
                            onClick={(e) => { e.stopPropagation(); refreshTrack(track.id); }}
                            disabled={refreshingTrackId === track.id}
                            title="Re-resolve link"
                            style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4, borderRadius: 5, flexShrink: 0, color: "rgba(255,255,255,0.2)", transition: "color 0.15s" }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f472b6"; }}
                            onMouseLeave={(e) => { if (refreshingTrackId !== track.id) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.2)"; }}
                          >
                            <RefreshCw size={11} style={refreshingTrackId === track.id ? { animation: "cr-spin 1s linear infinite" } : {}} />
                          </button>
                        )}

                        <button
                          onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                          title="Remove"
                          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.15)", cursor: "pointer", display: "flex", padding: 4, borderRadius: 5, flexShrink: 0, transition: "color 0.15s" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f87171"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.15)"; }}
                        ><Trash2 size={11} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "28px 16px", color: "rgba(255,255,255,0.15)", fontSize: 12, border: "1px dashed rgba(255,255,255,0.06)", borderRadius: 14 }}>
                  <Music size={28} style={{ opacity: 0.15, margin: "0 auto 10px", display: "block" }} />
                  <div style={{ fontWeight: 600 }}>Playlist is empty</div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>Add a YouTube link or upload an audio file above</div>
                </div>
              )}

              <style>{`
                @keyframes music-spin { to { transform: rotate(360deg); } }
                @keyframes music-blink { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
              `}</style>
            </div>
          )}

          {/* ── Mic tab ─────────────────────────────────────────────────── */}
          {activeTab === "mic" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 16px" }}>

              {/* Stream volume */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 6 }}>
                  <Volume2 size={11} /> Stream Volume (Source Audio)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={0} max={100} step={1}
                    value={bs.globalStreamVolume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBs((prev) => ({ ...prev, globalStreamVolume: v }));
                    }}
                    style={{ flex: 1, accentColor: "#a78bfa", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {bs.globalStreamVolume}%
                  </span>
                  <MicApplyButton onClick={() => update({ globalStreamVolume: bs.globalStreamVolume })} />
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 4, lineHeight: 1.5 }}>
                  Drag to preview level, then tap <strong style={{ color: "rgba(167,139,250,0.7)" }}>Apply</strong> to push to active streams (brief fast-restart).
                </div>
              </div>

              <SectionDivider label="Microphone (Control Room)" />

              {/* Mic volume */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 6 }}>
                  <Mic size={11} /> Mic Volume (local gain)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={0} max={200} step={1}
                    value={micVolumeDisplay}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      micVolumeValRef.current = v;
                      if (micGainRef.current) micGainRef.current.gain.value = v / 100;
                      setMicVolumeDisplay(v);
                    }}
                    style={{ flex: 1, accentColor: "#10b981", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {micVolumeDisplay}%
                  </span>
                </div>
              </div>

              {/* Mic toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={micActive ? stopMic : (micConnecting ? undefined : startMic)}
                  disabled={micConnecting}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                    cursor: micConnecting ? "wait" : "pointer",
                    border: `1px solid ${micActive ? "#10b981" : micConnecting ? "#f59e0b" : "rgba(255,255,255,0.15)"}`,
                    background: micActive ? "rgba(16,185,129,0.15)" : micConnecting ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.05)",
                    color: micActive ? "#6ee7b7" : micConnecting ? "#fcd34d" : "rgba(255,255,255,0.55)",
                    transition: "all 0.2s ease",
                    opacity: micConnecting ? 0.8 : 1,
                  }}
                >
                  {micActive ? <><Mic size={13} /> Mic Active</>
                    : micConnecting ? <>{micRetryLabel || "Connecting…"}</>
                    : <><MicOff size={13} /> Enable Mic</>}
                </button>
                {micActive && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "cr-pulse 1s infinite" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981" }}>LIVE</span>
                  </div>
                )}
              </div>

              {/* VU Meter */}
              {(micActive || micConnecting) && (
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                    <span>VU Meter</span>
                    {micActive && (
                      <span style={{ fontSize: 10, color: micLevel > 0.6 ? "#f87171" : micLevel > 0.25 ? "#fcd34d" : "#6ee7b7", fontWeight: 700, marginLeft: 4 }}>
                        {micLevel > 0.6 ? "HOT" : micLevel > 0.1 ? "SIGNAL" : "QUIET"}
                      </span>
                    )}
                  </div>
                  <div style={{
                    display: "flex", gap: 2, alignItems: "flex-end", height: 36,
                    padding: "4px 8px", borderRadius: 8,
                    background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                    {Array.from({ length: 24 }).map((_, i) => {
                      const barThreshold = i / 24;
                      const active = micLevel > barThreshold;
                      const isHot = barThreshold > 0.75;
                      const isWarm = barThreshold > 0.5;
                      return (
                        <div
                          key={i}
                          style={{
                            flex: 1, borderRadius: 2,
                            height: `${40 + i * 2.5}%`,
                            background: active
                              ? isHot ? "#ef4444" : isWarm ? "#f59e0b" : "#10b981"
                              : "rgba(255,255,255,0.08)",
                            transition: "background 0.05s ease",
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {micError && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5" }}>
                  <span style={{ flex: 1 }}>{micError}</span>
                  {!micActive && !micConnecting && (
                    <button
                      onClick={() => { setMicError(null); startMic(); }}
                      style={{ flexShrink: 0, padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.12)", color: "#fca5a5" }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}

              {/* ── Noise Cancellation ──────────────────────────────────── */}
              <SectionDivider label="Noise Cancellation" />

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Enable toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>
                    AI Noise Gate
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 400, marginTop: 1 }}>
                      Silences background hum, fan, keyboard noise
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !noiseCancelEnabled;
                      setNoiseCancelEnabled(next);
                      applyNoiseGateParam(next, noiseGateThreshold);
                    }}
                    style={{
                      padding: "4px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${noiseCancelEnabled ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.15)"}`,
                      background: noiseCancelEnabled ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                      color: noiseCancelEnabled ? "#6ee7b7" : "rgba(255,255,255,0.4)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    {noiseCancelEnabled ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Threshold slider */}
                {noiseCancelEnabled && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        Sensitivity
                      </span>
                      <span style={{ fontSize: 10, color: "#6ee7b7", fontWeight: 700 }}>
                        {noiseGateThreshold < 15 ? "Low" : noiseGateThreshold < 40 ? "Medium" : noiseGateThreshold < 70 ? "High" : "Aggressive"}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={5} max={90} step={5}
                      value={noiseGateThreshold}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setNoiseGateThreshold(v);
                        applyNoiseGateParam(true, v);
                      }}
                      style={{ width: "100%", accentColor: "#10b981", cursor: "pointer" }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                      <span>Low (soft noise)</span>
                      <span>Aggressive (loud noise)</span>
                    </div>
                  </div>
                )}

                {/* Processing chain info */}
                <div style={{ padding: "7px 10px", borderRadius: 7, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.1)", fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.7 }}>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontWeight: 600, marginBottom: 2 }}>Processing chain (always active):</div>
                  Browser noise suppression → 80 Hz high-pass filter → dynamics compressor{noiseCancelEnabled ? " → noise gate" : ""}
                </div>
              </div>

              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.1)", fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                Your browser mic streams directly into all active broadcasts via WebSocket → PCM16 → FFmpeg. No stream restart needed to toggle on/off.
              </div>

            </div>
          )}

          {/* ── STAGE / MULTI-VIEW ── */}
          {activeTab === "stage" && (
            <MultiViewPanel streams={streams} procStats={streamProcStats} />
          )}

          {activeTab === "yt-api" && (
            <YouTubeApiPanel />
          )}

          {/* ── SYSTEM ── */}
          {activeTab === "system" && (
            <SystemPanel />
          )}

        </div>
      )}

      {/* ── Floating Screen-Share Status Widget ─────────────────────────────── */}
      {(screenActive || screenReconnecting) && (() => {
        const h = Math.floor(screenElapsed / 3600);
        const m = Math.floor((screenElapsed % 3600) / 60);
        const s = screenElapsed % 60;
        const elapsed = h > 0
          ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
          : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;

        return (
          <div style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 9999,
            width: 280,
            borderRadius: 18,
            background: "rgba(10,10,18,0.92)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: screenReconnecting
              ? "1px solid rgba(251,191,36,0.4)"
              : "1px solid rgba(129,140,248,0.35)",
            boxShadow: screenReconnecting
              ? "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(251,191,36,0.08)"
              : "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(129,140,248,0.08)",
            overflow: "hidden",
            animation: "ss-slide-up 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
            fontFamily: "inherit",
          }}>
            {/* Top bar — status row */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "13px 16px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                {/* Animated record dot */}
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: screenReconnecting ? "#fbbf24" : "#818cf8",
                  boxShadow: screenReconnecting
                    ? "0 0 0 0 rgba(251,191,36,0.4)"
                    : "0 0 0 0 rgba(129,140,248,0.4)",
                  animation: screenReconnecting ? "ss-blink 0.8s ease-in-out infinite" : "ss-ripple 1.8s ease-out infinite",
                }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: screenReconnecting ? "#fde68a" : "#e0e7ff", letterSpacing: "0.03em" }}>
                    {screenReconnecting ? "RECONNECTING…" : "SCREEN CAPTURING"}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 1 }}>
                    {screenReconnecting ? "Auto-reconnecting to server" : "Streaming to broadcast"}
                  </div>
                </div>
              </div>
              {/* Elapsed timer */}
              <div style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: 15, fontWeight: 800,
                color: screenReconnecting ? "#fde68a" : "#a5b4fc",
                letterSpacing: "0.04em",
                fontFamily: "monospace",
              }}>
                {elapsed}
              </div>
            </div>

            {/* Live preview thumbnail */}
            {screenPreviewUrl && !screenReconnecting && (
              <div style={{ position: "relative", background: "#000" }}>
                <img
                  src={screenPreviewUrl}
                  alt="Screen preview"
                  style={{ width: "100%", display: "block", maxHeight: 130, objectFit: "cover" }}
                />
                {/* Scanline overlay for that professional look */}
                <div style={{
                  position: "absolute", inset: 0,
                  background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)",
                  pointerEvents: "none",
                }} />
                {/* FPS badge */}
                <div style={{
                  position: "absolute", top: 8, left: 10,
                  padding: "2px 8px", borderRadius: 6,
                  background: "rgba(129,140,248,0.25)", backdropFilter: "blur(8px)",
                  border: "1px solid rgba(129,140,248,0.4)",
                  fontSize: 9, fontWeight: 800, color: "#c7d2fe", letterSpacing: "0.06em",
                }}>
                  20 FPS
                </div>
                <div style={{
                  position: "absolute", top: 8, right: 10,
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 6,
                  background: "rgba(239,68,68,0.22)", backdropFilter: "blur(8px)",
                  border: "1px solid rgba(239,68,68,0.35)",
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f87171", animation: "ss-blink 1s infinite" }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: "#fca5a5", letterSpacing: "0.06em" }}>LIVE</span>
                </div>
              </div>
            )}

            {/* Reconnecting progress bar */}
            {screenReconnecting && (
              <div style={{ height: 2, background: "rgba(251,191,36,0.12)" }}>
                <div style={{ height: "100%", background: "#fbbf24", animation: "ss-progress 1.5s ease-in-out infinite" }} />
              </div>
            )}

            {/* Bottom — stop button */}
            <div style={{ padding: "10px 16px 14px" }}>
              <button
                onClick={stopScreenShare}
                style={{
                  width: "100%", padding: "10px 0",
                  borderRadius: 12, fontSize: 12, fontWeight: 800,
                  cursor: "pointer", border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.12)",
                  color: "#fca5a5", letterSpacing: "0.04em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "all 0.18s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.22)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.7)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.12)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.4)";
                }}
              >
                <MonitorUp size={13} />
                Stop Screen Share
              </button>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes cr-pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        @keyframes cr-fade-in { from{opacity:0;transform:translateY(-4px);} to{opacity:1;transform:translateY(0);} }
        @keyframes cr-slide-down { from{opacity:0;transform:translateY(-6px);} to{opacity:1;transform:translateY(0);} }
        @keyframes cr-spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        @keyframes ss-slide-up { from{opacity:0;transform:translateY(20px) scale(0.96);} to{opacity:1;transform:translateY(0) scale(1);} }
        @keyframes ss-ripple {
          0%   { box-shadow: 0 0 0 0 rgba(129,140,248,0.55); }
          70%  { box-shadow: 0 0 0 8px rgba(129,140,248,0); }
          100% { box-shadow: 0 0 0 0 rgba(129,140,248,0); }
        }
        @keyframes ss-blink { 0%,100%{opacity:1;} 50%{opacity:0.25;} }
        @keyframes ss-progress { 0%{width:0%;margin-left:0;} 50%{width:60%;margin-left:20%;} 100%{width:0%;margin-left:100%;} }
      `}</style>

      {/* TikTok-style gift popup overlay — rendered above everything else */}
      <GiftPopup event={latestGift} onDismiss={() => setLatestGift(null)} />
    </div>
  );
}

