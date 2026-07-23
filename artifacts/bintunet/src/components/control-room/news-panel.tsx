import { useState, useEffect, useRef, useCallback } from "react";
import { getAuthToken } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

type ThemeName =
  | "CNN" | "BBC" | "Bloomberg" | "Fox" | "Sky News" | "Al Jazeera" | "CNBC"
  | "Dark" | "Glass" | "Modern" | "Minimal" | "Election";

type AnimationPreset =
  | "None" | "Slide Left" | "Slide Right" | "Slide Up" | "Slide Down"
  | "Fade" | "Zoom" | "Elastic" | "Bounce" | "Flip"
  | "Typewriter" | "Blur" | "Glitch" | "Pulse" | "Flash";

type TickerStyle =
  | "CNN" | "BBC" | "Bloomberg" | "Fox" | "Sky News" | "CNBC"
  | "Al Jazeera" | "Modern" | "Minimal" | "Glass" | "Election";

type OverlayVariant = "glass" | "flat" | "broadcast";
type ColorMode = "dark" | "light";
type TickerMotion = "Scroll" | "Stationary" | "Flap" | "Typewriter" | "Wave" | "Carousel";

interface TickerMessage {
  id: string; text: string; priority: number; addedAt: number; expiresAt?: number;
}

interface NewsOverlayState {
  active: boolean;
  theme: ThemeName;
  overlayVariant: OverlayVariant;
  colorMode: ColorMode;
  customColors: { primary: string; secondary: string; background: string; text: string; badge: string; badgeText: string };
  customFont: { family: string; size: number; weight: number; letterSpacing: number };
  customBorder: { width: number; color: string; radius: number };
  customShadow: { enabled: boolean; color: string; blur: number; x: number; y: number };
  opacity: number;
  gradientEnabled: boolean;
  gradientColors: [string, string];
  layout: { position: { x: number; y: number }; width: number; height: number; zIndex: number; scale: number };
  logo: string; logoUrl: string;
  liveBadge: { visible: boolean; label: string; pulse: boolean; color: string };
  headline: { text: string; animation: AnimationPreset; durationMs: number; autoRotate: boolean; headlines: string[]; currentIndex: number };
  breakingNews: { active: boolean; text: string; flashInterval: number; overridesTicker: boolean };
  ticker: { style: TickerStyle; direction: "left" | "right"; speed: number; paused: boolean; separator: string };
  tickerMessages: TickerMessage[];
  tickerMotion: TickerMotion;
  widgets: Array<{ id: string; type: string; enabled: boolean; position: { x: number; y: number }; settings: Record<string, unknown> }>;
  enterAnimation: AnimationPreset;
  exitAnimation: AnimationPreset;
  animationDurationMs: number;
  previewMode: boolean;
}

interface NewsOverlayPreset {
  id: string; name: string; description: string; createdAt: number; updatedAt: number;
  state: Partial<NewsOverlayState>;
}

// ── API helpers ────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/news-overlay${path}`, { credentials: "include", headers: authHeaders(), ...opts });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function apiPatch(path: string, body: unknown) {
  return apiFetch(path, { method: "PATCH", body: JSON.stringify(body) });
}

async function apiPost(path: string, body?: unknown) {
  return apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
}

async function apiDelete(path: string) {
  const res = await fetch(`/api/news-overlay${path}`, { method: "DELETE", credentials: "include", headers: authHeaders() });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
  return res.json();
}

// ── Shared Motion Engine ───────────────────────────────────────────────────────
// ONE animation map shared by every overlay theme. All themes enter/exit the
// same way — only the visual skin differs. No per-theme animation overrides.

const MOTION_ENGINE: Record<AnimationPreset, string> = {
  "None":        "",
  "Fade":        "me-fade 0.5s ease both",
  "Slide Up":    "me-slideup 0.45s cubic-bezier(0.22,1,0.36,1) both",
  "Slide Down":  "me-slidedown 0.45s cubic-bezier(0.22,1,0.36,1) both",
  "Slide Left":  "me-slideleft 0.45s cubic-bezier(0.22,1,0.36,1) both",
  "Slide Right": "me-slideright 0.45s cubic-bezier(0.22,1,0.36,1) both",
  "Zoom":        "me-zoom 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
  "Elastic":     "me-elastic 0.75s cubic-bezier(0.22,1,0.36,1) both",
  "Bounce":      "me-bounce 0.75s ease both",
  "Flip":        "me-flip 0.5s cubic-bezier(0.22,1,0.36,1) both",
  "Typewriter":  "me-typewriter 0.8s steps(28,end) both",
  "Blur":        "me-blur 0.55s ease both",
  "Glitch":      "me-glitch 0.65s ease both",
  "Pulse":       "me-pulsein 0.5s ease both",
  "Flash":       "me-flash 0.55s ease both",
};

const MOTION_ENGINE_KEYFRAMES = `
  @keyframes me-fade        { from{opacity:0} to{opacity:1} }
  @keyframes me-slideup     { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes me-slidedown   { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes me-slideleft   { from{transform:translateX(48px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes me-slideright  { from{transform:translateX(-48px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes me-zoom        { from{transform:scale(0.82);opacity:0} to{transform:scale(1);opacity:1} }
  @keyframes me-elastic     { 0%{transform:translateY(44px);opacity:0} 55%{transform:translateY(-7px);opacity:1} 75%{transform:translateY(3px)} 90%{transform:translateY(-1px)} 100%{transform:translateY(0)} }
  @keyframes me-bounce      { 0%{transform:translateY(44px);opacity:0} 45%{transform:translateY(-9px);opacity:1} 65%{transform:translateY(4px)} 82%{transform:translateY(-2px)} 100%{transform:translateY(0)} }
  @keyframes me-flip        { from{transform:scaleY(0);opacity:0;transform-origin:bottom} to{transform:scaleY(1);opacity:1;transform-origin:bottom} }
  @keyframes me-typewriter  { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0% 0 0)} }
  @keyframes me-blur        { from{filter:blur(14px);opacity:0} to{filter:blur(0);opacity:1} }
  @keyframes me-glitch      { 0%{transform:translateX(0);opacity:0} 8%{transform:translateX(-8px);opacity:0.9} 16%{transform:translateX(8px)} 24%{transform:translateX(-4px)} 32%{transform:translateX(4px)} 40%{transform:translateX(-2px)} 50%{transform:translateX(0)} 100%{transform:translateX(0);opacity:1} }
  @keyframes me-pulsein     { 0%{transform:scale(0.93);opacity:0} 50%{transform:scale(1.04);opacity:1} 100%{transform:scale(1);opacity:1} }
  @keyframes me-flash       { 0%{filter:brightness(4);opacity:0.15} 25%{filter:brightness(1.7);opacity:1} 45%{filter:brightness(2.3)} 65%{filter:brightness(1.1)} 100%{filter:brightness(1);opacity:1} }
  @keyframes no-pulse       { 0%,100%{opacity:1} 50%{opacity:0.2} }
`;

// ── TickerScroll ───────────────────────────────────────────────────────────────

function TickerScroll({ text, speed = 30, color = "#fff", fontSize = 13, fontWeight = 600, separator = "   ◆   " }: {
  text: string; speed?: number; color?: string; fontSize?: number; fontWeight?: number; separator?: string;
}) {
  const unit = `${text}${separator}`;
  const spanRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<{ dur: number; spanW: number; containerW: number } | null>(null);

  useEffect(() => {
    let rafId: number;
    let roCleanup: (() => void) | undefined;
    function measure() {
      if (!spanRef.current || !containerRef.current) return;
      const spanW = spanRef.current.getBoundingClientRect().width;
      const containerW = containerRef.current.getBoundingClientRect().width;
      if (spanW < 1 || containerW < 1) return;
      const pxPerSec = containerW / (speed * 0.4 + 4);
      const scrollDist = containerW + spanW;
      const dur = Math.max(2, scrollDist / pxPerSec);
      setMetrics({ dur, spanW, containerW });
    }
    rafId = requestAnimationFrame(() => {
      measure();
      if (containerRef.current && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(measure);
        ro.observe(containerRef.current);
        roCleanup = () => ro.disconnect();
      }
    });
    return () => { cancelAnimationFrame(rafId); roCleanup?.(); };
  }, [text, speed, fontSize, fontWeight, separator]);

  if (metrics === null) {
    return (
      <div ref={containerRef} style={{ overflow: "hidden", flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
        <div style={{ flexShrink: 0, visibility: "hidden" }}>
          <span ref={spanRef} style={{ whiteSpace: "nowrap", fontSize, fontWeight, color }}>{unit}</span>
        </div>
      </div>
    );
  }

  const { dur, spanW, containerW } = metrics;
  const PAUSE_SECS = 20;
  const totalDur = dur + PAUSE_SECS;
  const scrollPct = ((dur / totalDur) * 100).toFixed(3);
  const animName = `ticker-sp-${scrollPct.replace(".", "_")}`;
  const cw = containerW.toFixed(1);
  const sw = spanW.toFixed(1);

  return (
    <>
      <style>{`
        @keyframes ${animName} {
          0%            { transform: translateX(${cw}px);  animation-timing-function: linear; }
          ${scrollPct}% { transform: translateX(-${sw}px); animation-timing-function: steps(1, end); }
          100%          { transform: translateX(${cw}px); }
        }
      `}</style>
      <div ref={containerRef} style={{ overflow: "hidden", flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
        <div
          key={`${text}|${speed}|${dur.toFixed(2)}|${sw}`}
          style={{ flexShrink: 0, animation: `${animName} ${totalDur.toFixed(2)}s linear infinite`, willChange: "transform" }}
        >
          <span ref={spanRef} style={{ whiteSpace: "nowrap", fontSize, fontWeight, color }}>{unit}</span>
        </div>
      </div>
    </>
  );
}

// ── Variant helpers ────────────────────────────────────────────────────────────

interface VariantStyle {
  wrapperStyle: React.CSSProperties;
  textColor: string;
  accentColor: string;
  badgeBg: string;
  useBlur: boolean;
}

function resolveVariant(
  variant: OverlayVariant,
  colorMode: ColorMode,
  accent: string,
  gradientEnabled: boolean,
  gradientColors: [string, string],
): VariantStyle {
  const isLight = colorMode === "light";

  if (variant === "glass") {
    return {
      wrapperStyle: {
        backdropFilter: "blur(24px) saturate(200%)",
        WebkitBackdropFilter: "blur(24px) saturate(200%)",
        background: isLight ? "rgba(255,255,255,0.6)" : "rgba(10,10,28,0.45)",
        border: `1px solid ${isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.16)"}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)",
      },
      textColor: isLight ? "#1a1a2e" : "rgba(255,255,255,0.95)",
      accentColor: accent,
      badgeBg: `${accent}28`,
      useBlur: true,
    };
  }

  if (variant === "flat") {
    return {
      wrapperStyle: {
        background: gradientEnabled
          ? `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})`
          : isLight ? "#f2f4f8" : "#0a0a14",
        borderRadius: 0,
        overflow: "hidden",
      },
      textColor: isLight ? "#0a0a14" : "#ffffff",
      accentColor: accent,
      badgeBg: accent,
      useBlur: false,
    };
  }

  // broadcast
  return {
    wrapperStyle: {
      borderRadius: 0,
      overflow: "hidden",
    },
    textColor: isLight ? "#0a0a14" : "#ffffff",
    accentColor: accent,
    badgeBg: accent,
    useBlur: false,
  };
}

// ── LivePreview ────────────────────────────────────────────────────────────────

function LivePreview({ state }: { state: NewsOverlayState }) {
  const accent = state.customColors.primary;
  const tickerText = state.tickerMessages.map(m => m.text).join("   ◆   ") || state.headline.text || "Preview headline…";
  const speed = state.ticker.speed;
  const variant = state.overlayVariant ?? "broadcast";
  const colorMode = state.colorMode ?? "dark";
  const gradientEnabled = state.gradientEnabled ?? false;
  const gradientColors = state.gradientColors ?? [accent, state.customColors.secondary];
  const animPreset = state.headline.animation ?? "Fade";

  const vStyle = resolveVariant(variant, colorMode, accent, gradientEnabled, gradientColors);
  const bg = gradientEnabled
    ? `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})`
    : state.customColors.background;

  // Each theme renders its base visual — variant wrapperStyle is overlaid
  const themes: Record<ThemeName, React.ReactNode> = {

    "CNN": (
      <div style={{ display: "flex", alignItems: "stretch", height: 52, background: variant !== "glass" ? bg : undefined, borderTop: `4px solid ${accent}`, boxShadow: `0 -4px 20px ${accent}55`, fontFamily: '"Arial Black", Impact, system-ui, sans-serif' }}>
        <div style={{ background: accent, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, minWidth: 60, gap: 6 }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 24, maxWidth: 56, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 900, fontSize: 15, letterSpacing: "0.04em", textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>CNN</span>}
        </div>
        <div style={{ width: 3, background: `linear-gradient(180deg, ${accent}ff, ${accent}44)`, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "0 10px", minWidth: 0 }}>
          <span style={{ color: accent, fontWeight: 900, fontSize: 9, letterSpacing: "0.14em", flexShrink: 0, textTransform: "uppercase" }}>⚡ BREAKING</span>
          <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={700} fontSize={13} />
        </div>
      </div>
    ),

    "BBC": (
      <div style={{ display: "flex", alignItems: "stretch", height: 52, background: variant !== "glass" ? bg : undefined, fontFamily: "Georgia, serif" }}>
        <div style={{ background: `linear-gradient(135deg, ${accent}, ${state.customColors.secondary})`, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px", flexShrink: 0, minWidth: 70, boxShadow: `4px 0 16px ${accent}44` }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 26, maxWidth: 60, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 900, fontSize: 15, letterSpacing: "0.04em" }}>BBC</span>}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 14px", gap: 2, overflow: "hidden" }}>
          <div style={{ fontSize: 8, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: "system-ui" }}>Live Coverage</div>
          <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={700} fontSize={13} separator="  ·  " />
        </div>
      </div>
    ),

    "Bloomberg": (
      <div style={{ display: "flex", alignItems: "stretch", height: 46, background: variant !== "glass" ? bg : undefined, borderTop: `2px solid ${accent}`, fontFamily: '"IBM Plex Mono", "Courier New", monospace' }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px", flexShrink: 0, borderRight: `1px solid ${accent}44` }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 22, maxWidth: 56, objectFit: "contain" }} />
            : <>
              <div style={{ width: 7, height: 7, background: accent, borderRadius: 1 }} />
              <span style={{ color: accent, fontWeight: 700, fontSize: 11, letterSpacing: "0.06em" }}>{state.liveBadge.label || "MARKETS"}</span>
            </>}
        </div>
        <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={500} fontSize={12} separator="  |  " />
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0, borderLeft: `1px solid ${accent}33`, gap: 6 }}>
          <span style={{ color: "#4ade80", fontSize: 9, fontWeight: 700 }}>▲ +0.42%</span>
        </div>
      </div>
    ),

    "Fox": (
      <div style={{ display: "flex", alignItems: "stretch", height: 50, background: variant !== "glass" ? bg : undefined, borderTop: `4px solid ${accent}`, fontFamily: '"Arial Black", Impact, system-ui, sans-serif' }}>
        <div style={{ background: accent, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, boxShadow: `4px 0 20px ${accent}55` }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 24, maxWidth: 56, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 900, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>FOX NEWS ALERT</span>}
        </div>
        <div style={{ width: 4, background: `linear-gradient(180deg, #ffffff44, transparent)`, flexShrink: 0 }} />
        <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={800} fontSize={13} />
      </div>
    ),

    "Sky News": (
      <div style={{ display: "flex", alignItems: "stretch", height: 50, background: variant !== "glass" ? bg : undefined }}>
        <div style={{ background: `linear-gradient(145deg, ${accent}, ${state.customColors.secondary})`, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px", flexShrink: 0, minWidth: 88, boxShadow: `6px 0 24px ${accent}44` }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 24, maxWidth: 60, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", textAlign: "center" }}>SKY{"\n"}NEWS</span>}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", borderTop: `3px solid ${accent}`, padding: "0 6px" }}>
          <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={600} fontSize={13} />
        </div>
      </div>
    ),

    "Al Jazeera": (
      <div style={{ display: "flex", alignItems: "stretch", height: 50, background: variant !== "glass" ? bg : undefined, borderTop: `3px solid ${accent}`, boxShadow: `0 -3px 16px ${accent}44` }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", gap: 8, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.10)", minWidth: 72, justifyContent: "center" }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 26, maxWidth: 54, objectFit: "contain" }} />
            : <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", letterSpacing: "0.06em" }}>aljaz.</span>}
        </div>
        <div style={{ background: accent, display: "flex", alignItems: "center", padding: "0 10px", gap: 6, flexShrink: 0, boxShadow: `3px 0 14px ${accent}55` }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(255,255,255,0.8)" }} />
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 9, letterSpacing: "0.1em" }}>LIVE</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={600} fontSize={13} />
      </div>
    ),

    "CNBC": (
      <div style={{ display: "flex", alignItems: "stretch", height: 48, background: variant !== "glass" ? bg : undefined, borderTop: `3px solid ${accent}`, fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
        <div style={{ background: accent, display: "flex", alignItems: "center", padding: "0 16px", flexShrink: 0, boxShadow: `4px 0 18px ${accent}55` }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 22, maxWidth: 56, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 900, fontSize: 13, letterSpacing: "0.04em" }}>CNBC</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", padding: "0 10px", flexShrink: 0, borderRight: `1px solid ${accent}44` }}>
          <span style={{ color: "#4ade80", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>▲ MARKETS</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={600} fontSize={13} />
      </div>
    ),

    "Dark": (
      <div style={{
        display: "flex", alignItems: "stretch", height: 48,
        background: variant !== "glass" ? (gradientEnabled ? `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})` : bg) : undefined,
        border: `1px solid ${accent}55`, borderRadius: variant === "glass" ? 0 : 6,
        overflow: "hidden", boxShadow: `0 0 24px ${accent}25, inset 0 1px 0 rgba(255,255,255,0.06)`,
      }}>
        <div style={{ background: `${accent}20`, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, borderRight: `1px solid ${accent}33`, gap: 8 }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 22, maxWidth: 52, objectFit: "contain" }} />
            : <>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${accent}` }} />
              <span style={{ color: accent, fontWeight: 700, fontSize: 10, letterSpacing: "0.1em" }}>{state.liveBadge.label || "LIVE"}</span>
            </>}
        </div>
        <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={600} fontSize={13} />
      </div>
    ),

    "Glass": (
      <div style={{
        display: "flex", alignItems: "stretch", height: 48,
        background: "rgba(255,255,255,0.07)",
        backdropFilter: "blur(28px) saturate(200%)",
        WebkitBackdropFilter: "blur(28px) saturate(200%)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 10, overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.14)",
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.10)", gap: 8 }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 22, maxWidth: 52, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 800, fontSize: 11, letterSpacing: "0.06em" }}>{state.liveBadge.label || "LIVE"}</span>}
        </div>
        <div style={{ width: 3, background: `linear-gradient(180deg, ${accent}, ${accent}55)`, flexShrink: 0 }} />
        <TickerScroll text={tickerText} speed={speed} color="rgba(255,255,255,0.95)" fontWeight={600} fontSize={13} />
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, boxShadow: `0 0 10px ${accent}` }} />
        </div>
      </div>
    ),

    "Modern": (
      <div style={{
        display: "flex", alignItems: "stretch", height: 48,
        background: variant !== "glass" ? bg : undefined,
        borderTop: `2px solid ${accent}`,
        boxShadow: `0 -4px 20px ${accent}40`,
        fontFamily: '"IBM Plex Mono", "Courier New", monospace',
      }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0, borderRight: `1px solid ${accent}30`, gap: 6 }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 22, maxWidth: 52, objectFit: "contain" }} />
            : <>
              <span style={{ color: accent, fontWeight: 900, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", textShadow: `0 0 10px ${accent}` }}>●{state.liveBadge.label || "WIRE"}</span>
            </>}
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
          <TickerScroll text={tickerText} speed={speed} color={accent} fontWeight={600} fontSize={12} separator="  ░  " />
        </div>
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0, borderLeft: `1px solid ${accent}30` }}>
          <span style={{ color: `${accent}88`, fontSize: 9, fontFamily: "monospace" }}>4K●REC</span>
        </div>
      </div>
    ),

    "Minimal": (
      <div style={{
        display: "flex", alignItems: "center", height: 42,
        background: variant !== "glass" ? bg : undefined,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        gap: 0, fontFamily: "system-ui, -apple-system, sans-serif",
      }}>
        {state.liveBadge.visible && (
          <div style={{ display: "flex", alignItems: "center", padding: "0 16px", flexShrink: 0, gap: 6, borderRight: "1px solid rgba(255,255,255,0.08)", height: "100%" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: accent, opacity: 0.8 }} />
            <span style={{ color: "rgba(255,255,255,0.38)", fontSize: 9, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase" }}>{state.liveBadge.label || "LIVE"}</span>
          </div>
        )}
        <TickerScroll text={tickerText} speed={speed} color="rgba(255,255,255,0.88)" fontWeight={400} fontSize={13} separator="   ·   " />
      </div>
    ),

    "Election": (
      <div style={{
        display: "flex", alignItems: "stretch", height: 54,
        background: variant !== "glass" ? (gradientEnabled ? `linear-gradient(90deg, ${gradientColors[0]}, ${gradientColors[1]})` : bg) : undefined,
        borderTop: `4px solid ${accent}`,
        boxShadow: `0 -6px 28px ${accent}55`,
        fontFamily: '"Arial Black", Impact, system-ui, sans-serif',
      }}>
        <div style={{ background: accent, display: "flex", alignItems: "center", padding: "0 16px", flexShrink: 0, gap: 8, boxShadow: `4px 0 20px ${accent}66` }}>
          {state.logo
            ? <img src={state.logo} alt="" style={{ height: 26, maxWidth: 56, objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 900, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: 1.2, textAlign: "center" }}>ELECTION{"\n"}NIGHT</span>}
        </div>
        <div style={{ width: 4, background: `linear-gradient(180deg, ${state.customColors.secondary}cc, ${state.customColors.secondary}44)`, flexShrink: 0 }} />
        <TickerScroll text={tickerText} speed={speed} color={vStyle.textColor} fontWeight={800} fontSize={13} separator="  ★  " />
      </div>
    ),
  };

  // Apply variant wrapper — glass and flat override the outer shell
  const themeNode = themes[state.theme] ?? themes["Al Jazeera"];

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#0a0a14" }}>
      <style>{MOTION_ENGINE_KEYFRAMES}</style>

      {/* Preview label */}
      <div style={{ padding: "5px 10px", fontSize: 9, color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: "0.1em", background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: 8, alignItems: "center" }}>
        <span>Preview — {state.theme}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ color: "rgba(102,126,234,0.7)" }}>{variant}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span style={{ color: "rgba(255,255,255,0.2)" }}>{colorMode}</span>
        {state.active && <span style={{ color: "#4ade80", marginLeft: "auto" }}>● ACTIVE</span>}
      </div>

      {/* Theme render with shared Motion Engine applied */}
      <div
        key={`${state.theme}|${variant}|${colorMode}|${animPreset}|${state.headline.currentIndex}`}
        style={{ ...vStyle.wrapperStyle, animation: MOTION_ENGINE[animPreset] ?? "" }}
      >
        {themeNode}
      </div>
    </div>
  );
}

// ── Breaking badge ─────────────────────────────────────────────────────────────

function BreakingBadge({ active, text }: { active: boolean; text: string }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!active) { setFlash(false); return; }
    const t = setInterval(() => setFlash(v => !v), 800);
    return () => clearInterval(t);
  }, [active]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: active ? (flash ? "rgba(220,38,38,0.18)" : "rgba(220,38,38,0.09)") : "rgba(255,255,255,0.04)", border: `1px solid ${active ? (flash ? "rgba(220,38,38,0.6)" : "rgba(220,38,38,0.28)") : "rgba(255,255,255,0.07)"}`, transition: "all 0.35s ease" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#ef4444" : "rgba(255,255,255,0.18)", flexShrink: 0, boxShadow: active ? "0 0 8px #ef4444" : "none", transition: "all 0.35s" }} />
      <span style={{ color: active ? "#fca5a5" : "rgba(255,255,255,0.28)", fontSize: 11, fontWeight: 700, flex: 1 }}>
        {active ? text || "BREAKING NEWS" : "Breaking news inactive"}
      </span>
    </div>
  );
}

// ── UI primitives ─────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.30)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}>{label}</div>
      {children}
    </div>
  );
}

function PillSelect<T extends string>({ value, options, onChange, accent = "#667eea" }: {
  value: T; options: T[] | readonly T[]; onChange: (v: T) => void; accent?: string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
          border: `1px solid ${value === opt ? accent : "rgba(255,255,255,0.10)"}`,
          background: value === opt ? `${accent}22` : "transparent",
          color: value === opt ? accent : "rgba(255,255,255,0.42)",
        }}>{opt}</button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, accent = "#4ade80" }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string; accent?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <div onClick={() => onChange(!checked)} style={{ width: 34, height: 18, borderRadius: 9, background: checked ? accent : "rgba(255,255,255,0.12)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 2, left: checked ? 16 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
      </div>
      {label && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{label}</span>}
    </label>
  );
}

function Slider({ value, min, max, onChange, label, accent = "#667eea" }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label?: string; accent?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)" }}>{label}</span>
          <span style={{ fontSize: 10, color: accent, fontWeight: 600 }}>{value}</span>
        </div>
      )}
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: accent, cursor: "pointer" }} />
    </div>
  );
}

// ── Motion style option ────────────────────────────────────────────────────────

const TICKER_MOTIONS: { value: TickerMotion; icon: string; desc: string }[] = [
  { value: "Scroll",      icon: "⟶", desc: "Classic broadcast right-to-left scroll" },
  { value: "Stationary",  icon: "◼", desc: "Fixed — messages cross-fade every 6s" },
  { value: "Flap",        icon: "⟳", desc: "Split-flap departure board effect" },
  { value: "Typewriter",  icon: "▌", desc: "Characters typed in one by one" },
  { value: "Wave",        icon: "〜", desc: "Characters bob on a sinusoidal wave" },
  { value: "Carousel",    icon: "↑", desc: "Messages slide up one at a time" },
];

// ── Main NewsPanel ─────────────────────────────────────────────────────────────

export function NewsPanel({ activeStreamCount }: { activeStreamCount: number }) {
  const [state, setState] = useState<NewsOverlayState | null>(null);
  const [presets, setPresets] = useState<NewsOverlayPreset[]>([]);
  const [capabilities, setCapabilities] = useState<{
    themes: ThemeName[]; animations: AnimationPreset[];
    widgetTypes: string[]; tickerStyles: TickerStyle[];
  } | null>(null);
  const [newMsg, setNewMsg] = useState("");
  const [newMsgPriority, setNewMsgPriority] = useState(0);
  const [headlineDraft, setHeadlineDraft] = useState<string | null>(null);
  const [breakingDraft, setBreakingDraft] = useState<string | null>(null);
  const [badgeLabelDraft, setBadgeLabelDraft] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [tab, setTab] = useState<"ticker" | "headline" | "breaking" | "style" | "presets">("ticker");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    apiFetch("").then(setState).catch(e => setError(e.message));
    apiFetch("/capabilities").then(setCapabilities).catch(() => {});
    apiFetch("/presets").then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "news-overlay" && msg.data) {
          setState(prev => {
            if (!prev || pendingKeysRef.current.size === 0) return msg.data;
            const merged: NewsOverlayState = { ...msg.data };
            for (const k of pendingKeysRef.current) {
              if (k in prev) (merged as unknown as Record<string, unknown>)[k] = (prev as unknown as Record<string, unknown>)[k];
            }
            return merged;
          });
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const patch = useCallback((body: Record<string, unknown>, debounceMs = 0) => {
    if (!state) return;
    const keys = Object.keys(body);
    for (const k of keys) pendingKeysRef.current.add(k);
    setState({ ...state, ...body } as NewsOverlayState);
    if (patchTimeout.current) clearTimeout(patchTimeout.current);
    patchTimeout.current = setTimeout(() => {
      setSaving(true);
      apiPatch("", body)
        .then(s => { setState(s); setSaving(false); })
        .catch(e => { setError(e.message); setSaving(false); })
        .finally(() => { for (const k of keys) pendingKeysRef.current.delete(k); });
    }, debounceMs);
  }, [state]);

  const immediatePost = useCallback(async (path: string, body?: unknown) => {
    setSaving(true);
    try {
      const s = await apiPost(path, body);
      if (s && "active" in s) setState(s);
      else apiFetch("").then(setState);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  }, []);

  if (!state) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "rgba(255,255,255,0.28)", fontSize: 13 }}>
      {error ? `⚠ ${error}` : "Loading news overlay…"}
    </div>
  );

  const THEMES: ThemeName[] = capabilities?.themes ?? [
    "Al Jazeera", "CNN", "BBC", "Bloomberg", "Fox", "Sky News", "CNBC",
    "Dark", "Glass", "Modern", "Minimal", "Election",
  ];
  const ANIMATIONS: AnimationPreset[] = capabilities?.animations ?? [
    "None", "Fade", "Slide Up", "Slide Down", "Slide Left", "Slide Right",
    "Zoom", "Elastic", "Bounce", "Flip", "Typewriter", "Blur", "Glitch", "Pulse", "Flash",
  ];

  const TABS = [
    { id: "ticker" as const,   label: "Ticker" },
    { id: "headline" as const, label: "Headline" },
    { id: "breaking" as const, label: "Breaking" },
    { id: "style" as const,    label: "Style" },
    { id: "presets" as const,  label: "Presets" },
  ];

  const variant = state.overlayVariant ?? "broadcast";
  const colorMode = state.colorMode ?? "dark";
  const accent = state.customColors.primary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{MOTION_ENGINE_KEYFRAMES}</style>

      {/* ── Status bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => immediatePost(state.active ? "/deactivate" : "/activate")}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s",
              border: `1px solid ${state.active ? "#ef4444" : "#4ade80"}`,
              background: state.active ? "rgba(239,68,68,0.14)" : "rgba(74,222,128,0.10)",
              color: state.active ? "#f87171" : "#4ade80",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: state.active ? "#ef4444" : "#4ade80", display: "block", animation: state.active ? "no-pulse 1.2s infinite" : "none" }} />
            {state.active ? "Stop Overlay" : "Go Live"}
          </button>
          {saving && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", alignSelf: "center" }}>Saving…</span>}
        </div>
        {state.active && (
          <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>
            ● LIVE on {activeStreamCount} stream{activeStreamCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Live preview ── */}
      <LivePreview state={state} />

      {/* ── Tab nav ── */}
      <div style={{ display: "flex", gap: 3, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 4 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "4px 10px", borderRadius: "6px 6px 0 0", fontSize: 10, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${tab === t.id ? "rgba(102,126,234,0.4)" : "transparent"}`,
            borderBottom: tab === t.id ? "1px solid rgba(10,10,20,1)" : "1px solid transparent",
            background: tab === t.id ? "rgba(102,126,234,0.12)" : "transparent",
            color: tab === t.id ? "#a5b4fc" : "rgba(255,255,255,0.32)",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* TICKER TAB                                                              */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {tab === "ticker" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          <Section label="Speed & Direction">
            <Slider value={state.ticker.speed} min={5} max={80} onChange={v => patch({ ticker: { ...state.ticker, speed: v } }, 200)} label="Speed (lower = faster)" />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <PillSelect value={state.ticker.direction} options={["left", "right"] as const} onChange={v => patch({ ticker: { ...state.ticker, direction: v } })} />
              <Toggle checked={state.ticker.paused} onChange={v => patch({ ticker: { ...state.ticker, paused: v } })} label="Pause ticker" />
            </div>
          </Section>

          <Section label="Ticker Messages">
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 160, overflowY: "auto" }}>
              {state.tickerMessages.length === 0 && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", padding: "4px 0" }}>
                  No messages — add one below. Leave empty to use the headline.
                </div>
              )}
              {state.tickerMessages.map(msg => (
                <div key={msg.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {msg.priority >= 100 && <span style={{ fontSize: 9, background: "#ef4444", color: "#fff", padding: "1px 5px", borderRadius: 4, flexShrink: 0, fontWeight: 700 }}>BREAKING</span>}
                  {msg.priority > 0 && msg.priority < 100 && <span style={{ fontSize: 9, background: "#f59e0b", color: "#000", padding: "1px 5px", borderRadius: 4, flexShrink: 0, fontWeight: 700 }}>P{msg.priority}</span>}
                  <span style={{ flex: 1, fontSize: 11, color: "rgba(255,255,255,0.72)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.text}</span>
                  <button onClick={async () => { await apiDelete(`/ticker/messages/${msg.id}`); apiFetch("").then(setState); }}
                    style={{ fontSize: 10, color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                placeholder="Add ticker message…"
                onKeyDown={e => { if (e.key === "Enter" && newMsg.trim()) { apiPost("/ticker/messages", { text: newMsg, priority: newMsgPriority }).then(() => { setNewMsg(""); apiFetch("").then(setState); }); } }}
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 7, padding: "6px 10px", color: "#fff", fontSize: 11, outline: "none" }}
              />
              <select value={newMsgPriority} onChange={e => setNewMsgPriority(Number(e.target.value))}
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 7, color: "#fff", fontSize: 10, padding: "0 6px", cursor: "pointer" }}>
                <option value={0}>Normal</option>
                <option value={50}>High</option>
                <option value={100}>Breaking</option>
              </select>
              <button onClick={() => { if (!newMsg.trim()) return; apiPost("/ticker/messages", { text: newMsg, priority: newMsgPriority }).then(() => { setNewMsg(""); apiFetch("").then(setState); }); }}
                style={{ padding: "6px 12px", borderRadius: 7, background: "rgba(102,126,234,0.18)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Add
              </button>
            </div>
            {state.tickerMessages.length > 0 && (
              <button onClick={() => { apiDelete("/ticker/messages").then(() => apiFetch("").then(setState)); }}
                style={{ fontSize: 10, color: "#f87171", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", alignSelf: "flex-start" }}>
                Clear all
              </button>
            )}
          </Section>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* HEADLINE TAB                                                            */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {tab === "headline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Section label="Headline Text">
            <textarea
              value={headlineDraft ?? state.headline.text}
              onChange={e => setHeadlineDraft(e.target.value)}
              onBlur={() => {
                if (headlineDraft === null || headlineDraft === state.headline.text) { setHeadlineDraft(null); return; }
                patch({ headline: { ...state.headline, text: headlineDraft } });
                setHeadlineDraft(null);
              }}
              placeholder="Main headline shown in the overlay… (applies on blur or Enter)"
              rows={3}
              style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
            />
            {headlineDraft !== null && headlineDraft !== state.headline.text && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => { patch({ headline: { ...state.headline, text: headlineDraft } }); setHeadlineDraft(null); }}
                  style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(102,126,234,0.18)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Apply
                </button>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>Unsaved — press Enter or Apply to send</span>
              </div>
            )}
          </Section>

          <Section label="Headline Animation — Motion Engine">
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>How this headline enters. Shared engine — works identically on all themes.</div>
            <PillSelect value={state.headline.animation} options={ANIMATIONS} onChange={v => patch({ headline: { ...state.headline, animation: v } })} />
          </Section>

          <Section label="Auto-Rotate">
            <Toggle checked={state.headline.autoRotate} onChange={v => patch({ headline: { ...state.headline, autoRotate: v } })} label="Auto-rotate through headline queue" />
            {state.headline.autoRotate && (
              <Slider value={Math.round(state.headline.durationMs / 1000)} min={2} max={30}
                onChange={v => patch({ headline: { ...state.headline, durationMs: v * 1000 } }, 200)}
                label="Duration per headline (seconds)" accent="#667eea" />
            )}
          </Section>

          <Section label="Headline Queue">
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {state.headline.headlines.map((h, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", background: i === state.headline.currentIndex ? "#4ade80" : "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 8, color: i === state.headline.currentIndex ? "#000" : "rgba(255,255,255,0.4)", fontWeight: 800 }}>{i + 1}</div>
                  <input value={h}
                    onChange={e => { const u = [...state.headline.headlines]; u[i] = e.target.value; patch({ headline: { ...state.headline, headlines: u } }, 300); }}
                    style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: `1px solid ${i === state.headline.currentIndex ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: 7, padding: "5px 9px", color: "#fff", fontSize: 11, outline: "none" }}
                  />
                  {state.headline.headlines.length > 1 && (
                    <button onClick={() => { const u = state.headline.headlines.filter((_, j) => j !== i); patch({ headline: { ...state.headline, headlines: u, currentIndex: Math.min(state.headline.currentIndex, u.length - 1) } }); }}
                      style={{ fontSize: 10, color: "#f87171", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                  )}
                </div>
              ))}
              <button onClick={() => patch({ headline: { ...state.headline, headlines: [...state.headline.headlines, "New headline…"] } })}
                style={{ fontSize: 10, color: "#a5b4fc", background: "rgba(102,126,234,0.06)", border: "1px dashed rgba(102,126,234,0.28)", borderRadius: 7, padding: "5px", cursor: "pointer" }}>
                + Add headline
              </button>
            </div>
          </Section>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* BREAKING TAB                                                            */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {tab === "breaking" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <BreakingBadge active={state.breakingNews.active} text={state.breakingNews.text} />

          <Section label="Breaking News Text">
            <input
              value={breakingDraft ?? state.breakingNews.text}
              onChange={e => setBreakingDraft(e.target.value)}
              onBlur={() => {
                if (breakingDraft === null || breakingDraft === state.breakingNews.text) { setBreakingDraft(null); return; }
                patch({ breakingNews: { ...state.breakingNews, text: breakingDraft } });
                setBreakingDraft(null);
              }}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="Breaking news headline… (applies on blur or Enter)"
              style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box" }}
            />
            {breakingDraft !== null && breakingDraft !== state.breakingNews.text && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => { patch({ breakingNews: { ...state.breakingNews, text: breakingDraft } }); setBreakingDraft(null); }}
                  style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.4)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Apply
                </button>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>Unsaved — press Enter or Apply to send</span>
              </div>
            )}
          </Section>

          <Section label="Controls">
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => immediatePost("/breaking", { text: breakingDraft ?? state.breakingNews.text })}
                style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.14)", color: "#f87171", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                ⚡ Activate Breaking
              </button>
              {state.breakingNews.active && (
                <button onClick={async () => { await apiDelete("/breaking"); apiFetch("").then(setState); }}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.48)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  Clear Breaking
                </button>
              )}
            </div>
            <Slider value={state.breakingNews.flashInterval} min={300} max={2000}
              onChange={v => patch({ breakingNews: { ...state.breakingNews, flashInterval: v } }, 200)}
              label="Flash interval (ms)" accent="#ef4444" />
            <Toggle checked={state.breakingNews.overridesTicker} onChange={v => patch({ breakingNews: { ...state.breakingNews, overridesTicker: v } })} label="Override ticker when breaking" accent="#ef4444" />
          </Section>

          <Section label="Live Badge">
            <Toggle checked={state.liveBadge.visible} onChange={v => patch({ liveBadge: { ...state.liveBadge, visible: v } })} label="Show LIVE badge" />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                value={badgeLabelDraft ?? state.liveBadge.label}
                onChange={e => setBadgeLabelDraft(e.target.value)}
                onBlur={() => {
                  if (badgeLabelDraft === null || badgeLabelDraft === state.liveBadge.label) { setBadgeLabelDraft(null); return; }
                  patch({ liveBadge: { ...state.liveBadge, label: badgeLabelDraft } });
                  setBadgeLabelDraft(null);
                }}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                placeholder="Badge label — applies on blur or Enter"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 7, padding: "5px 10px", color: "#fff", fontSize: 11, outline: "none", flex: 1, minWidth: 80 }} />
              <input type="color" value={state.liveBadge.color} onChange={e => patch({ liveBadge: { ...state.liveBadge, color: e.target.value } })}
                style={{ width: 30, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }} />
              <Toggle checked={state.liveBadge.pulse} onChange={v => patch({ liveBadge: { ...state.liveBadge, pulse: v } })} label="Pulse" />
            </div>
          </Section>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STYLE TAB                                                               */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {tab === "style" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Theme */}
          <Section label="Theme">
            <PillSelect value={state.theme} options={THEMES}
              onChange={async v => {
                setSaving(true);
                const s = await apiPost(`/themes/${encodeURIComponent(v)}/apply`);
                if (s && "active" in s) setState(s);
                setSaving(false);
              }} accent="#667eea" />
          </Section>

          {/* Variant */}
          <Section label="Surface Variant">
            <div style={{ display: "flex", gap: 6 }}>
              {(["broadcast", "glass", "flat"] as OverlayVariant[]).map(v => (
                <button key={v} onClick={() => patch({ overlayVariant: v })} style={{
                  flex: 1, padding: "8px 6px", borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                  border: `1px solid ${variant === v ? accent : "rgba(255,255,255,0.10)"}`,
                  background: variant === v ? `${accent}1a` : "rgba(255,255,255,0.03)",
                  color: variant === v ? accent : "rgba(255,255,255,0.40)",
                  fontSize: 10, fontWeight: 700, textTransform: "capitalize",
                }}>
                  <div style={{ fontSize: 14, marginBottom: 2 }}>
                    {v === "broadcast" ? "📺" : v === "glass" ? "🪟" : "◻"}
                  </div>
                  {v}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
              {variant === "glass" && "Frosted glass — backdrop blur, semi-transparent, rounded corners"}
              {variant === "flat" && "Flat — solid fill, sharp edges, no blur"}
              {variant === "broadcast" && "Broadcast — theme's native TV-broadcast look"}
            </div>
          </Section>

          {/* Color mode */}
          <Section label="Color Mode">
            <div style={{ display: "flex", gap: 6 }}>
              {(["dark", "light"] as ColorMode[]).map(m => (
                <button key={m} onClick={() => patch({ colorMode: m })} style={{
                  flex: 1, padding: "7px 6px", borderRadius: 8, cursor: "pointer", transition: "all 0.15s",
                  border: `1px solid ${colorMode === m ? accent : "rgba(255,255,255,0.10)"}`,
                  background: colorMode === m ? `${accent}1a` : "rgba(255,255,255,0.03)",
                  color: colorMode === m ? accent : "rgba(255,255,255,0.40)",
                  fontSize: 10, fontWeight: 700,
                }}>
                  {m === "dark" ? "🌙 Dark" : "☀️ Light"}
                </button>
              ))}
            </div>
          </Section>

          {/* Accent color */}
          <Section label="Accent Color">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input type="color" value={accent}
                onChange={e => patch({ customColors: { ...state.customColors, primary: e.target.value } }, 100)}
                style={{ width: 38, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer", background: "none" }} />
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.38)" }}>{accent}</span>
              {["#e8000a", "#1a73e8", "#f5a623", "#00b4ff", "#00ff88", "#7c3aed", "#dc2626", "#f97316"].map(c => (
                <button key={c} onClick={() => patch({ customColors: { ...state.customColors, primary: c, badge: c } })}
                  style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: accent === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer", flexShrink: 0 }} />
              ))}
            </div>
          </Section>

          {/* Gradient */}
          <Section label="Gradient">
            <Toggle checked={state.gradientEnabled ?? false} onChange={v => patch({ gradientEnabled: v })} label="Enable background gradient" accent={accent} />
            {state.gradientEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)" }}>From</span>
                  <input type="color" value={(state.gradientColors ?? ["#667eea", "#764ba2"])[0]}
                    onChange={e => patch({ gradientColors: [e.target.value, (state.gradientColors ?? ["#667eea", "#764ba2"])[1]] as [string, string] }, 100)}
                    style={{ width: 32, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }} />
                </div>
                <div style={{ height: 2, flex: 1, background: `linear-gradient(90deg, ${(state.gradientColors ?? ["#667eea", "#764ba2"])[0]}, ${(state.gradientColors ?? ["#667eea", "#764ba2"])[1]})`, borderRadius: 2, minWidth: 30 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)" }}>To</span>
                  <input type="color" value={(state.gradientColors ?? ["#667eea", "#764ba2"])[1]}
                    onChange={e => patch({ gradientColors: [(state.gradientColors ?? ["#667eea", "#764ba2"])[0], e.target.value] as [string, string] }, 100)}
                    style={{ width: 32, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }} />
                </div>
              </div>
            )}
          </Section>

          {/* Motion Engine */}
          <Section label="Motion Engine — Shared by All Themes">
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginBottom: 4, lineHeight: 1.5 }}>
              One animation engine drives every overlay. Pick enter/exit and how the ticker text moves.
            </div>

            {/* Ticker motion style */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginBottom: 4, fontWeight: 600 }}>Ticker Motion</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {TICKER_MOTIONS.map(({ value: v, icon, desc }) => (
                <button key={v}
                  onClick={() => patch({ tickerMotion: v })}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                    border: `1px solid ${(state.tickerMotion ?? "Scroll") === v ? `${accent}80` : "rgba(255,255,255,0.07)"}`,
                    background: (state.tickerMotion ?? "Scroll") === v ? `${accent}18` : "rgba(255,255,255,0.02)",
                    color: (state.tickerMotion ?? "Scroll") === v ? accent : "rgba(255,255,255,0.58)",
                    textAlign: "left", transition: "all 0.14s",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, minWidth: 80 }}>{icon} {v}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.32)" }}>{desc}</span>
                </button>
              ))}
            </div>

            {/* Enter animation */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 8, marginBottom: 3, fontWeight: 600 }}>Enter Animation</div>
            <PillSelect value={state.enterAnimation} options={ANIMATIONS} onChange={v => patch({ enterAnimation: v })} accent={accent} />

            {/* Exit animation */}
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 6, marginBottom: 3, fontWeight: 600 }}>Exit Animation</div>
            <PillSelect value={state.exitAnimation} options={ANIMATIONS} onChange={v => patch({ exitAnimation: v })} accent={accent} />
          </Section>

          {/* Border */}
          <Section label="Border">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="color" value={state.customBorder.color === "transparent" ? "#ffffff" : state.customBorder.color}
                onChange={e => patch({ customBorder: { ...state.customBorder, color: e.target.value } }, 100)}
                style={{ width: 32, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "monospace" }}>{state.customBorder.color}</span>
            </div>
            <Slider value={state.customBorder.width} min={0} max={8} onChange={v => patch({ customBorder: { ...state.customBorder, width: v } }, 100)} label="Border width (px)" accent={accent} />
            <Slider value={state.customBorder.radius} min={0} max={24} onChange={v => patch({ customBorder: { ...state.customBorder, radius: v } }, 100)} label="Corner radius (px)" accent={accent} />
          </Section>

          {/* Shadow */}
          <Section label="Shadow">
            <Toggle checked={state.customShadow.enabled} onChange={v => patch({ customShadow: { ...state.customShadow, enabled: v } })} label="Enable shadow" accent={accent} />
            {state.customShadow.enabled && <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={state.customShadow.color.startsWith("rgba") ? "#000000" : state.customShadow.color}
                  onChange={e => patch({ customShadow: { ...state.customShadow, color: e.target.value } }, 100)}
                  style={{ width: 32, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Shadow color</span>
              </div>
              <Slider value={state.customShadow.blur} min={0} max={60} onChange={v => patch({ customShadow: { ...state.customShadow, blur: v } }, 100)} label="Blur radius (px)" accent={accent} />
              <Slider value={state.customShadow.x} min={-20} max={20} onChange={v => patch({ customShadow: { ...state.customShadow, x: v } }, 100)} label="Horizontal offset" accent={accent} />
              <Slider value={state.customShadow.y} min={-20} max={20} onChange={v => patch({ customShadow: { ...state.customShadow, y: v } }, 100)} label="Vertical offset" accent={accent} />
            </>}
          </Section>

          {/* Opacity */}
          <Section label="Overlay Opacity">
            <Slider value={Math.round(state.opacity * 100)} min={20} max={100}
              onChange={v => patch({ opacity: v / 100 }, 100)} label="Opacity %" />
          </Section>

          {/* Logo */}
          <Section label="Channel Logo">
            <input id="no-logo-upload" type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => { apiPost("/logo", { logo: ev.target?.result as string }).then(() => apiFetch("").then(setState)); };
                reader.readAsDataURL(file);
                e.target.value = "";
              }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {state.logo && <div style={{ background: "#000", borderRadius: 8, padding: "4px 8px", border: "1px solid rgba(255,255,255,0.1)" }}><img src={state.logo} alt="logo" style={{ height: 28, maxWidth: 64, objectFit: "contain" }} /></div>}
              <button onClick={() => document.getElementById("no-logo-upload")?.click()}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px dashed rgba(102,126,234,0.38)", background: "rgba(102,126,234,0.06)", color: "#a5b4fc", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                {state.logo ? "Change logo" : "Upload logo"}
              </button>
              {state.logo && (
                <button onClick={() => apiPost("/logo", { logo: "" }).then(() => apiFetch("").then(setState))}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.28)", background: "transparent", color: "#f87171", fontSize: 10, cursor: "pointer" }}>
                  Remove
                </button>
              )}
            </div>
          </Section>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* PRESETS TAB                                                             */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {tab === "presets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Section label="Saved Presets">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
              {presets.length === 0 && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.22)" }}>No presets saved yet.</div>}
              {presets.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description}</div>}
                  </div>
                  <button onClick={() => apiPost(`/presets/${p.id}/apply`).then(r => { if (r.state) setState(r.state); })}
                    style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(102,126,234,0.4)", background: "rgba(102,126,234,0.12)", color: "#a5b4fc", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                    Apply
                  </button>
                  <button onClick={() => apiDelete(`/presets/${p.id}`).then(() => apiFetch("/presets").then(setPresets))}
                    style={{ fontSize: 10, color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: "4px" }}>✕</button>
                </div>
              ))}
            </div>
          </Section>

          <Section label="Save Current as Preset">
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)}
                placeholder="Preset name…"
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 7, padding: "6px 10px", color: "#fff", fontSize: 11, outline: "none" }}
              />
              <button onClick={() => {
                if (!newPresetName.trim()) return;
                apiPost("/presets", { name: newPresetName }).then(() => { setNewPresetName(""); apiFetch("/presets").then(setPresets); });
              }} style={{ padding: "6px 12px", borderRadius: 7, background: "rgba(102,126,234,0.18)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Save
              </button>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
