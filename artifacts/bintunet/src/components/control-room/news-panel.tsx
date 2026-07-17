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

interface TickerMessage {
  id: string;
  text: string;
  priority: number;
  addedAt: number;
  expiresAt?: number;
}

interface NewsOverlayState {
  active: boolean;
  theme: ThemeName;
  customColors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
    badge: string;
    badgeText: string;
  };
  customFont: { family: string; size: number; weight: number; letterSpacing: number };
  customBorder: { width: number; color: string; radius: number };
  customShadow: { enabled: boolean; color: string; blur: number; x: number; y: number };
  opacity: number;
  layout: { position: { x: number; y: number }; width: number; height: number; zIndex: number; scale: number };
  logo: string;
  logoUrl: string;
  liveBadge: { visible: boolean; label: string; pulse: boolean; color: string };
  headline: {
    text: string;
    animation: AnimationPreset;
    durationMs: number;
    autoRotate: boolean;
    headlines: string[];
    currentIndex: number;
  };
  breakingNews: { active: boolean; text: string; flashInterval: number; overridesTicker: boolean };
  ticker: { style: TickerStyle; direction: "left" | "right"; speed: number; paused: boolean; separator: string };
  tickerMessages: TickerMessage[];
  widgets: Array<{ id: string; type: string; enabled: boolean; position: { x: number; y: number }; settings: Record<string, unknown> }>;
  enterAnimation: AnimationPreset;
  exitAnimation: AnimationPreset;
  animationDurationMs: number;
}

interface NewsOverlayPreset {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  state: Partial<NewsOverlayState>;
}

// ── API helpers ────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/news-overlay${path}`, {
    credentials: "include",
    headers: authHeaders(),
    ...opts,
  });
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
  const res = await fetch(`/api/news-overlay${path}`, {
    method: "DELETE", credentials: "include", headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
  return res.json();
}

// ── Live preview ───────────────────────────────────────────────────────────────

function TickerScroll({ text, speed = 30, color = "#fff", fontSize = 13, fontWeight = 600, separator = "   ◆   " }: {
  text: string; speed?: number; color?: string; fontSize?: number; fontWeight?: number; separator?: string;
}) {
  const unit = `${text}${separator}`;
  const spanRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Stores measured layout so we can build a pixel-accurate CSS animation.
  const [metrics, setMetrics] = useState<{ dur: number; spanW: number; containerW: number } | null>(null);

  useEffect(() => {
    let rafId: number;
    let roCleanup: (() => void) | undefined;

    function measure() {
      if (!spanRef.current || !containerRef.current) return;
      const spanW = spanRef.current.getBoundingClientRect().width;
      const containerW = containerRef.current.getBoundingClientRect().width;
      if (spanW < 1 || containerW < 1) return;
      // Match backend: px/s proportional to canvas width; speed 1=slow 100=fast
      const pxPerSec = containerW / (speed * 0.4 + 4);
      // Single-pass distance: text enters from right edge, exits left edge
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

    return () => {
      cancelAnimationFrame(rafId);
      roCleanup?.();
    };
  }, [text, speed, fontSize, fontWeight, separator]);

  // Hidden measurement render — keeps spanRef and containerRef mounted so
  // getBoundingClientRect() works on the first rAF tick.
  if (metrics === null) {
    return (
      <div ref={containerRef} style={{ overflow: "hidden", flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
        <div style={{ flexShrink: 0, visibility: "hidden" }}>
          <span ref={spanRef} style={{ whiteSpace: "nowrap", fontSize, fontWeight, color }}>{unit}</span>
        </div>
      </div>
    );
  }

  // Single-pass animation matching the backend canvas renderer:
  //   0 %          — text starts just off the RIGHT edge (translateX = +containerW px)
  //   scrollPct %  — text has fully exited the LEFT edge (translateX = -spanW px)
  //                  timing switches to steps(1,end) → text stays hidden for the pause
  //   100 %        — jump back to +containerW px (both positions are off-screen; invisible)
  const { dur, spanW, containerW } = metrics;
  const PAUSE_SECS = 20;
  const totalDur   = dur + PAUSE_SECS;
  const scrollPct  = ((dur / totalDur) * 100).toFixed(3);
  const animName   = `ticker-sp-${scrollPct.replace(".", "_")}`;
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

function LivePreview({ state }: { state: NewsOverlayState }) {
  const c = state.customColors.primary;
  const bg = state.customColors.background;
  const text = state.headline.text || "Preview headline…";
  const tickerText = state.tickerMessages.map(m => m.text).join("   ◆   ") || text;
  const speed = state.ticker.speed;

  const previewMap: Record<ThemeName, React.ReactNode> = {
    "Al Jazeera": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "#000", borderTop: `3px solid ${c}` }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", gap: 8, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)", minWidth: 70, justifyContent: "center" }}>
          {state.logo ? <img src={state.logo} alt="" style={{ height: 26, maxWidth: 54, objectFit: "contain" }} /> : <span style={{ fontSize: 10, fontWeight: 900, color: "#fff" }}>{state.liveBadge.label || "LIVE"}</span>}
        </div>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: "0 10px", gap: 5, flexShrink: 0 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 9, letterSpacing: "0.08em" }}>LIVE</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="#fff" />
      </div>
    ),
    "CNN": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "#0d0d0d" }}>
        <div style={{ background: "#000", borderLeft: `4px solid ${c}`, display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0, gap: 6, minWidth: 60 }}>
          {state.logo ? <img src={state.logo} alt="" style={{ height: 22, objectFit: "contain" }} /> : <span style={{ color: "#fff", fontWeight: 900, fontSize: 14 }}>CNN</span>}
        </div>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: "0 10px", flexShrink: 0 }}>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 9, letterSpacing: "0.1em" }}>⚡ BREAKING</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="#f0f0f0" />
      </div>
    ),
    "BBC": (
      <div style={{ display: "flex", alignItems: "stretch", height: 48, background: "#1a1a2e" }}>
        <div style={{ background: c, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 14px", flexShrink: 0 }}>
          {state.logo ? <img src={state.logo} alt="" style={{ height: 24, objectFit: "contain" }} /> : <span style={{ color: "#fff", fontWeight: 900, fontSize: 14, fontFamily: "Georgia, serif" }}>BBC</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 12px", flex: 1, overflow: "hidden", gap: 2 }}>
          <div style={{ fontSize: 9, color: c, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Coverage</div>
          <TickerScroll text={tickerText} speed={speed} color="#fff" fontWeight={700} separator="  ·  " />
        </div>
      </div>
    ),
    "Bloomberg": (
      <div style={{ display: "flex", alignItems: "stretch", height: 40, background: "#0c0c0c", borderTop: `2px solid ${c}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flexShrink: 0, borderRight: `1px solid ${c}30` }}>
          <span style={{ color: c, fontWeight: 700, fontSize: 11, fontFamily: "monospace" }}>{state.liveBadge.label || "MARKETS"}</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="rgba(255,255,255,0.88)" fontWeight={500} separator="  |  " />
      </div>
    ),
    "Fox": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "#000033", borderTop: `3px solid ${c}` }}>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0 }}>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 10, letterSpacing: "0.1em" }}>FOX NEWS ALERT</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="#fff" fontWeight={800} />
      </div>
    ),
    "Sky News": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44 }}>
        <div style={{ background: `linear-gradient(135deg, ${c} 0%, #0369a1 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 14px", flexShrink: 0, minWidth: 80 }}>
          {state.logo ? <img src={state.logo} alt="" style={{ height: 24, objectFit: "contain" }} /> : <span style={{ color: "#fff", fontWeight: 900, fontSize: 11 }}>SKY NEWS</span>}
        </div>
        <div style={{ flex: 1, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", borderTop: `2px solid ${c}` }}>
          <TickerScroll text={tickerText} speed={speed} color="#fff" />
        </div>
      </div>
    ),
    "CNBC": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "#000022", borderTop: `2px solid ${c}` }}>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0 }}>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 12 }}>CNBC</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="#fff" fontWeight={700} />
      </div>
    ),
    "Dark": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "rgba(10,10,20,0.97)", border: `1px solid rgba(99,102,241,0.4)` }}>
        <div style={{ background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0 }}>
          <span style={{ color: "#a5b4fc", fontWeight: 700, fontSize: 10, letterSpacing: "0.08em" }}>{state.liveBadge.label}</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="rgba(255,255,255,0.9)" />
      </div>
    ),
    "Glass": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "rgba(255,255,255,0.08)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 11 }}>{state.liveBadge.label}</span>
        </div>
        <div style={{ width: 3, background: `linear-gradient(180deg, ${c}, ${c}80)`, flexShrink: 0 }} />
        <TickerScroll text={tickerText} speed={speed} color="rgba(255,255,255,0.92)" />
      </div>
    ),
    "Modern": (
      <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "rgba(0,4,16,0.97)", borderTop: `2px solid ${c}`, boxShadow: `0 -4px 16px ${c}30` }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0, borderRight: `1px solid ${c}30` }}>
          <span style={{ color: c, fontWeight: 900, fontSize: 10, letterSpacing: "0.1em", fontFamily: "monospace" }}>WIRE</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color={c} />
      </div>
    ),
    "Minimal": (
      <div style={{ display: "flex", alignItems: "center", height: 38, background: "rgba(0,0,0,0.88)", borderTop: "1px solid rgba(255,255,255,0.1)", gap: 12, padding: "0 14px" }}>
        {state.liveBadge.visible && <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)", paddingRight: 10 }}>{state.liveBadge.label}</span>}
        <TickerScroll text={tickerText} speed={speed} color="#fff" fontWeight={400} separator="   ·   " />
      </div>
    ),
    "Election": (
      <div style={{ display: "flex", alignItems: "stretch", height: 48, background: "#0f172a", borderTop: `3px solid ${c}`, boxShadow: `0 -4px 20px rgba(239,68,68,0.3)` }}>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: "0 14px", flexShrink: 0 }}>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: 9, letterSpacing: "0.12em" }}>ELECTION NIGHT</span>
        </div>
        <TickerScroll text={tickerText} speed={speed} color="#f8fafc" fontWeight={800} separator="  ★  " />
      </div>
    ),
  };

  const animPreset = state.headline.animation || "Fade";
  const ANIM_CSS: Record<string, string> = {
    "None":        "",
    "Fade":        "np-fade 0.5s ease both",
    "Slide Up":    "np-slideup 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Slide Down":  "np-slidedown 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Slide Left":  "np-slideleft 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Slide Right": "np-slideright 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Zoom":        "np-zoom 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Elastic":     "np-elastic 0.7s cubic-bezier(0.22,1,0.36,1) both",
    "Bounce":      "np-bounce 0.7s ease both",
    "Flip":        "np-flip 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Typewriter":  "np-typewriter 0.8s steps(25,end) both",
    "Blur":        "np-blur 0.5s ease both",
    "Glitch":      "np-glitch 0.6s ease both",
    "Pulse":       "np-pulse-in 0.5s ease both",
    "Flash":       "np-flash 0.55s ease both",
  };

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", background: "#111" }}>
      <style>{`
        @keyframes np-fade        { from{opacity:0} to{opacity:1} }
        @keyframes np-slideup     { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes np-slidedown   { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes np-slideleft   { from{transform:translateX(40px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes np-slideright  { from{transform:translateX(-40px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes np-zoom        { from{transform:scale(0.85);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes np-elastic     { 0%{transform:translateY(40px);opacity:0} 55%{transform:translateY(-6px);opacity:1} 75%{transform:translateY(3px)} 90%{transform:translateY(-1px)} 100%{transform:translateY(0)} }
        @keyframes np-bounce      { 0%{transform:translateY(40px);opacity:0} 45%{transform:translateY(-8px);opacity:1} 65%{transform:translateY(4px)} 82%{transform:translateY(-2px)} 100%{transform:translateY(0)} }
        @keyframes np-flip        { from{transform:scaleY(0);opacity:0;transform-origin:bottom} to{transform:scaleY(1);opacity:1;transform-origin:bottom} }
        @keyframes np-typewriter  { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0% 0 0)} }
        @keyframes np-blur        { from{filter:blur(12px);opacity:0} to{filter:blur(0);opacity:1} }
        @keyframes np-glitch      { 0%{transform:translateX(0);opacity:0} 8%{transform:translateX(-8px);opacity:1} 16%{transform:translateX(8px)} 24%{transform:translateX(-4px)} 32%{transform:translateX(4px)} 40%{transform:translateX(-2px)} 50%{transform:translateX(0)} 100%{transform:translateX(0);opacity:1} }
        @keyframes np-pulse-in    { 0%{transform:scale(0.94);opacity:0} 50%{transform:scale(1.03);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes np-flash       { 0%{filter:brightness(4);opacity:0.2} 25%{filter:brightness(1.6);opacity:1} 45%{filter:brightness(2.2)} 65%{filter:brightness(1.1)} 100%{filter:brightness(1);opacity:1} }
        @keyframes no-pulse       { 0%,100%{opacity:1} 50%{opacity:0.2} }
      `}</style>
      <div style={{ padding: "6px 10px", fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        Live Preview — {state.theme} {state.active && <span style={{ color: "#4ade80" }}>● ACTIVE</span>}
        {animPreset !== "None" && <span style={{ color: "rgba(255,255,255,0.2)", marginLeft: 6 }}>· {animPreset}</span>}
      </div>
      <div
        key={`${state.theme}|${animPreset}|${state.headline.currentIndex}`}
        style={{ background: "#000", animation: ANIM_CSS[animPreset] ?? "", overflow: "hidden" }}
      >
        {previewMap[state.theme] ?? previewMap["Al Jazeera"]}
      </div>
    </div>
  );
}

// ── Breaking news flash animation ─────────────────────────────────────────────

function BreakingBadge({ active, text }: { active: boolean; text: string }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!active) { setFlash(false); return; }
    const t = setInterval(() => setFlash(v => !v), 800);
    return () => clearInterval(t);
  }, [active]);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 12px", borderRadius: 8,
      background: active ? (flash ? "rgba(220,38,38,0.2)" : "rgba(220,38,38,0.1)") : "rgba(255,255,255,0.04)",
      border: `1px solid ${active ? (flash ? "rgba(220,38,38,0.6)" : "rgba(220,38,38,0.3)") : "rgba(255,255,255,0.08)"}`,
      transition: "all 0.4s ease",
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? "#ef4444" : "rgba(255,255,255,0.2)", flexShrink: 0, boxShadow: active ? "0 0 6px #ef4444" : "none" }} />
      <span style={{ color: active ? "#fca5a5" : "rgba(255,255,255,0.3)", fontSize: 11, fontWeight: 700, flex: 1 }}>
        {active ? text || "BREAKING NEWS" : "Breaking news inactive"}
      </span>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.32)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{label}</div>
      {children}
    </div>
  );
}

// ── Pill selector ─────────────────────────────────────────────────────────────

function PillSelect<T extends string>({ value, options, onChange, accent = "#667eea" }: {
  value: T; options: T[] | readonly T[]; onChange: (v: T) => void; accent?: string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
          border: `1px solid ${value === opt ? accent : "rgba(255,255,255,0.1)"}`,
          background: value === opt ? `${accent}22` : "transparent",
          color: value === opt ? accent : "rgba(255,255,255,0.45)",
        }}>{opt}</button>
      ))}
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, accent = "#4ade80" }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string; accent?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <div onClick={() => onChange(!checked)} style={{
        width: 34, height: 18, borderRadius: 9, background: checked ? accent : "rgba(255,255,255,0.12)",
        position: "relative", transition: "background 0.2s", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 2, left: checked ? 16 : 2, width: 14, height: 14,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s",
        }} />
      </div>
      {label && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{label}</span>}
    </label>
  );
}

// ── Slider ────────────────────────────────────────────────────────────────────

function Slider({ value, min, max, onChange, label, accent = "#667eea" }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label?: string; accent?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{label}</span>
          <span style={{ fontSize: 10, color: accent, fontWeight: 600 }}>{value}</span>
        </div>
      )}
      <input type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
      />
    </div>
  );
}

// ── Main NewPanel ─────────────────────────────────────────────────────────────

export function NewsPanel({ activeStreamCount }: { activeStreamCount: number }) {
  const [state, setState] = useState<NewsOverlayState | null>(null);
  const [presets, setPresets] = useState<NewsOverlayPreset[]>([]);
  const [capabilities, setCapabilities] = useState<{
    themes: ThemeName[]; animations: AnimationPreset[];
    widgetTypes: string[]; tickerStyles: TickerStyle[];
  } | null>(null);
  const [newMsg, setNewMsg] = useState("");
  const [newMsgPriority, setNewMsgPriority] = useState(0);
  // ── Local drafts for free-text fields ─────────────────────────────────────
  // These fields used to patch the backend on every keystroke (debounced),
  // which meant a periodic WebSocket broadcast (ticker prune tick, headline
  // rotation, another operator's edit) landing mid-sentence would revert
  // whatever had been typed so far — the letters "sometimes got deleted".
  // Now typing only updates a local draft; the value is sent to the backend
  // once (on blur, Enter, or the Apply button), same as adding a ticker
  // message already worked.
  const [headlineDraft, setHeadlineDraft] = useState<string | null>(null);
  const [breakingDraft, setBreakingDraft] = useState<string | null>(null);
  const [badgeLabelDraft, setBadgeLabelDraft] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState("");
  const [tab, setTab] = useState<"ticker" | "headline" | "breaking" | "style" | "widgets" | "presets">("ticker");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Top-level state keys with a locally-optimistic edit in flight (either
  // queued behind the debounce timer or waiting on the PATCH response).
  // While a key is "pending", incoming WebSocket state pushes (from the 30s
  // ticker-prune tick, headline auto-rotation, or another connected client)
  // must NOT overwrite it — otherwise a broadcast landing mid-edit reverts
  // whatever the user just typed/dragged, which is exactly what caused
  // controls to "sometimes work, sometimes not" and typed text to be
  // silently deleted.
  const pendingKeysRef = useRef<Set<string>>(new Set());

  // ── Fetch initial state ────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch("").then(setState).catch(e => setError(e.message));
    apiFetch("/capabilities").then(setCapabilities).catch(() => {});
    apiFetch("/presets").then(setPresets).catch(() => {});
  }, []);

  // ── WebSocket live updates ─────────────────────────────────────────────────
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "news-overlay" && msg.data) {
          setState(prev => {
            if (!prev || pendingKeysRef.current.size === 0) return msg.data;
            // Merge the broadcast in, but keep the locally-edited value for any
            // key that's still pending so we don't clobber an in-progress edit.
            const merged: NewsOverlayState = { ...msg.data };
            for (const k of pendingKeysRef.current) {
              if (k in prev) (merged as any)[k] = (prev as any)[k];
            }
            return merged;
          });
        }
        if (msg.type === "news-overlay-ticker" && msg.data && state) {
          setState(prev => prev ? { ...prev, tickerMessages: msg.data.messages, ticker: msg.data.config } : prev);
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  // ── Debounced patch helper ─────────────────────────────────────────────────
  const patch = useCallback((body: Record<string, unknown>, debounceMs = 0) => {
    if (!state) return;
    const keys = Object.keys(body);
    for (const k of keys) pendingKeysRef.current.add(k);
    const optimistic = { ...state, ...body } as NewsOverlayState;
    setState(optimistic);
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
      // Some endpoints return the full state, others return partial data
      if (s && "active" in s) setState(s);
      else apiFetch("").then(setState);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  }, []);

  if (!state) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
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
  const TICKER_STYLES: TickerStyle[] = capabilities?.tickerStyles ?? [
    "Al Jazeera", "CNN", "BBC", "Bloomberg", "Fox", "Sky News", "CNBC",
    "Modern", "Minimal", "Glass", "Election",
  ];

  const TABS = [
    { id: "ticker" as const, label: "Ticker" },
    { id: "headline" as const, label: "Headline" },
    { id: "breaking" as const, label: "Breaking" },
    { id: "style" as const, label: "Style" },
    { id: "presets" as const, label: "Presets" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Status bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => immediatePost(state.active ? "/deactivate" : "/activate")}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s",
              border: `1px solid ${state.active ? "#ef4444" : "#4ade80"}`,
              background: state.active ? "rgba(239,68,68,0.15)" : "rgba(74,222,128,0.12)",
              color: state.active ? "#f87171" : "#4ade80",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: state.active ? "#ef4444" : "#4ade80", display: "block", animation: state.active ? "no-pulse 1.2s infinite" : "none" }} />
            {state.active ? "Stop Overlay" : "Go Live"}
          </button>
          {saving && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", alignSelf: "center" }}>Saving…</span>}
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
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 4 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "4px 10px", borderRadius: "6px 6px 0 0", fontSize: 10, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${tab === t.id ? "rgba(102,126,234,0.4)" : "transparent"}`,
            borderBottom: tab === t.id ? "1px solid rgba(10,10,20,1)" : "1px solid transparent",
            background: tab === t.id ? "rgba(102,126,234,0.12)" : "transparent",
            color: tab === t.id ? "#a5b4fc" : "rgba(255,255,255,0.35)",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── TICKER TAB ── */}
      {tab === "ticker" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          <Section label="Motion Style">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>
                Controls <em>how</em> the text moves. Use Scroll for classic broadcast look, or pick a creative motion.
              </div>
              {[
                { v: "Scroll",      label: "⟶ Scroll",      desc: "Classic right-to-left broadcast scroll" },
                { v: "Stationary",  label: "◼ Stationary",  desc: "Fixed text, messages cross-fade every 6s" },
                { v: "Flap",        label: "⟳ Flap",        desc: "Split-flap departure board animation" },
                { v: "Typewriter",  label: "▌ Typewriter",  desc: "Types in character by character" },
                { v: "Wave",        label: "〜 Wave",        desc: "Characters bob on a sinusoidal wave" },
                { v: "Carousel",    label: "↑ Carousel",    desc: "Messages slide up one at a time" },
              ].map(({ v, label, desc }) => {
                // We send newsTickerMode via broadcastState (not news-overlay PATCH)
                const active = (state as unknown as Record<string, unknown>).__tickerMode === v ||
                  (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__bintuTickerMode === v);
                return (
                  <button key={v}
                    onClick={async () => {
                      (window as unknown as Record<string, unknown>).__bintuTickerMode = v;
                      try {
                        const token = (await import("@/lib/queryClient")).getAuthToken();
                        await fetch("/api/broadcast", {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                          body: JSON.stringify({ newsTickerMode: v }),
                        });
                      } catch {}
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${active ? "rgba(102,126,234,0.5)" : "rgba(255,255,255,0.08)"}`,
                      background: active ? "rgba(102,126,234,0.15)" : "rgba(255,255,255,0.03)",
                      color: active ? "#a5b4fc" : "rgba(255,255,255,0.65)",
                      textAlign: "left", transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, minWidth: 88 }}>{label}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{desc}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="Visual Theme (when using Scroll)">
            <PillSelect value={state.ticker.style} options={TICKER_STYLES} onChange={v => patch({ ticker: { ...state.ticker, style: v } })} />
          </Section>

          <Section label="Speed & Direction">
            <Slider value={state.ticker.speed} min={5} max={80} onChange={v => patch({ ticker: { ...state.ticker, speed: v } }, 200)} label="Speed (lower = faster)" />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <PillSelect value={state.ticker.direction} options={["left", "right"] as const} onChange={v => patch({ ticker: { ...state.ticker, direction: v } })} />
              <Toggle checked={state.ticker.paused} onChange={v => patch({ ticker: { ...state.ticker, paused: v } })} label="Pause ticker" />
            </div>
          </Section>

          <Section label="Ticker Messages">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
              {state.tickerMessages.length === 0 && (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", padding: "4px 0" }}>
                  No messages — add one below. Leave empty to use the headline.
                </div>
              )}
              {state.tickerMessages.map(msg => (
                <div key={msg.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {msg.priority >= 100 && <span style={{ fontSize: 9, background: "#ef4444", color: "#fff", padding: "1px 5px", borderRadius: 4, flexShrink: 0, fontWeight: 700 }}>BREAKING</span>}
                  {msg.priority > 0 && msg.priority < 100 && <span style={{ fontSize: 9, background: "#f59e0b", color: "#000", padding: "1px 5px", borderRadius: 4, flexShrink: 0, fontWeight: 700 }}>P{msg.priority}</span>}
                  <span style={{ flex: 1, fontSize: 11, color: "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.text}</span>
                  <button onClick={async () => { await apiDelete(`/ticker/messages/${msg.id}`); apiFetch("").then(setState); }}
                    style={{ fontSize: 10, color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)}
                placeholder="Add ticker message…"
                onKeyDown={e => { if (e.key === "Enter" && newMsg.trim()) { apiPost("/ticker/messages", { text: newMsg, priority: newMsgPriority }).then(() => { setNewMsg(""); apiFetch("").then(setState); }); } }}
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "6px 10px", color: "#fff", fontSize: 11, outline: "none" }}
              />
              <select value={newMsgPriority} onChange={e => setNewMsgPriority(Number(e.target.value))}
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, color: "#fff", fontSize: 10, padding: "0 6px", cursor: "pointer" }}>
                <option value={0}>Normal</option>
                <option value={50}>High</option>
                <option value={100}>Breaking</option>
              </select>
              <button onClick={() => { if (!newMsg.trim()) return; apiPost("/ticker/messages", { text: newMsg, priority: newMsgPriority }).then(() => { setNewMsg(""); apiFetch("").then(setState); }); }}
                style={{ padding: "6px 12px", borderRadius: 7, background: "rgba(102,126,234,0.2)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Add
              </button>
            </div>
            {state.tickerMessages.length > 0 && (
              <button onClick={() => { apiDelete("/ticker/messages").then(() => apiFetch("").then(setState)); }}
                style={{ fontSize: 10, color: "#f87171", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", alignSelf: "flex-start" }}>
                Clear all messages
              </button>
            )}
          </Section>
        </div>
      )}

      {/* ── HEADLINE TAB ── */}
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
              style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
            {headlineDraft !== null && headlineDraft !== state.headline.text && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => { patch({ headline: { ...state.headline, text: headlineDraft } }); setHeadlineDraft(null); }}
                  style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(102,126,234,0.2)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Apply
                </button>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Unsaved — press Enter or Apply to send</span>
              </div>
            )}
          </Section>

          <Section label="Headline Animation">
            <PillSelect value={state.headline.animation} options={ANIMATIONS} onChange={v => patch({ headline: { ...state.headline, animation: v } })} />
          </Section>

          <Section label="Auto-Rotate Headlines">
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
                    onChange={e => {
                      const updated = [...state.headline.headlines];
                      updated[i] = e.target.value;
                      patch({ headline: { ...state.headline, headlines: updated } }, 300);
                    }}
                    style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: `1px solid ${i === state.headline.currentIndex ? "rgba(74,222,128,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 7, padding: "5px 9px", color: "#fff", fontSize: 11, outline: "none" }}
                  />
                  {state.headline.headlines.length > 1 && (
                    <button onClick={() => {
                      const updated = state.headline.headlines.filter((_, j) => j !== i);
                      patch({ headline: { ...state.headline, headlines: updated, currentIndex: Math.min(state.headline.currentIndex, updated.length - 1) } });
                    }} style={{ fontSize: 10, color: "#f87171", background: "none", border: "none", cursor: "pointer" }}>✕</button>
                  )}
                </div>
              ))}
              <button onClick={() => patch({ headline: { ...state.headline, headlines: [...state.headline.headlines, "New headline…"] } })}
                style={{ fontSize: 10, color: "#a5b4fc", background: "rgba(102,126,234,0.06)", border: "1px dashed rgba(102,126,234,0.3)", borderRadius: 7, padding: "5px", cursor: "pointer" }}>
                + Add headline
              </button>
            </div>
          </Section>
        </div>
      )}

      {/* ── BREAKING TAB ── */}
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
              style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 12, outline: "none", boxSizing: "border-box" }}
            />
            {breakingDraft !== null && breakingDraft !== state.breakingNews.text && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => { patch({ breakingNews: { ...state.breakingNews, text: breakingDraft } }); setBreakingDraft(null); }}
                  style={{ padding: "5px 12px", borderRadius: 7, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Apply
                </button>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Unsaved — press Enter or Apply to send</span>
              </div>
            )}
          </Section>

          <Section label="Controls">
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => immediatePost("/breaking", { text: breakingDraft ?? state.breakingNews.text })}
                style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.5)", background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                ⚡ Activate Breaking
              </button>
              {state.breakingNews.active && (
                <button onClick={async () => { await apiDelete("/breaking"); apiFetch("").then(setState); }}
                  style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
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
                placeholder="Badge label (e.g. LIVE) — applies on blur or Enter"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "5px 10px", color: "#fff", fontSize: 11, outline: "none", flex: 1, minWidth: 80 }} />
              <input type="color" value={state.liveBadge.color} onChange={e => patch({ liveBadge: { ...state.liveBadge, color: e.target.value } })}
                style={{ width: 30, height: 26, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }} />
              <Toggle checked={state.liveBadge.pulse} onChange={v => patch({ liveBadge: { ...state.liveBadge, pulse: v } })} label="Pulse" />
            </div>
          </Section>
        </div>
      )}

      {/* ── STYLE TAB ── */}
      {tab === "style" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Section label="Theme">
            <PillSelect value={state.theme} options={THEMES}
              onChange={async v => {
                setSaving(true);
                const s = await apiPost(`/themes/${encodeURIComponent(v)}/apply`);
                if (s && "active" in s) setState(s);
                setSaving(false);
              }} accent="#667eea" />
          </Section>

          <Section label="Accent Color">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="color" value={state.customColors.primary}
                onChange={e => patch({ customColors: { ...state.customColors, primary: e.target.value } }, 100)}
                style={{ width: 38, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", background: "none" }} />
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>{state.customColors.primary}</span>
              {["#cc0001", "#0057ff", "#f59e0b", "#0ea5e9", "#00ff88", "#667eea", "#ef4444"].map(c => (
                <button key={c} onClick={() => patch({ customColors: { ...state.customColors, primary: c, badge: c } })}
                  style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: state.customColors.primary === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer" }} />
              ))}
            </div>
          </Section>

          <Section label="Enter / Exit Animation">
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 2 }}>Enter</div>
            <PillSelect value={state.enterAnimation} options={ANIMATIONS} onChange={v => patch({ enterAnimation: v })} />
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4, marginBottom: 2 }}>Exit</div>
            <PillSelect value={state.exitAnimation} options={ANIMATIONS} onChange={v => patch({ exitAnimation: v })} />
          </Section>

          <Section label="Logo">
            <input id="no-logo-upload" type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => { apiPost("/logo", { logo: ev.target?.result as string }).then(() => apiFetch("").then(setState)); };
                reader.readAsDataURL(file);
                e.target.value = "";
              }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {state.logo && <div style={{ background: "#000", borderRadius: 8, padding: "4px 8px", border: "1px solid rgba(255,255,255,0.1)" }}><img src={state.logo} alt="logo" style={{ height: 28, maxWidth: 64, objectFit: "contain" }} /></div>}
              <button onClick={() => document.getElementById("no-logo-upload")?.click()}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px dashed rgba(102,126,234,0.4)", background: "rgba(102,126,234,0.06)", color: "#a5b4fc", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                {state.logo ? "Change logo" : "Upload logo"}
              </button>
              {state.logo && (
                <button onClick={() => apiPost("/logo", { logo: "" }).then(() => apiFetch("").then(setState))}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#f87171", fontSize: 10, cursor: "pointer" }}>
                  Remove
                </button>
              )}
            </div>
          </Section>

          <Section label="Opacity">
            <Slider value={Math.round(state.opacity * 100)} min={20} max={100}
              onChange={v => patch({ opacity: v / 100 }, 100)} label="Overlay opacity" />
          </Section>
        </div>
      )}

      {/* ── PRESETS TAB ── */}
      {tab === "presets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Section label="Saved Presets">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
              {presets.length === 0 && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>No presets saved yet.</div>}
              {presets.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    {p.description && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description}</div>}
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
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, padding: "6px 10px", color: "#fff", fontSize: 11, outline: "none" }}
              />
              <button onClick={() => {
                if (!newPresetName.trim()) return;
                apiPost("/presets", { name: newPresetName }).then(() => {
                  setNewPresetName("");
                  apiFetch("/presets").then(setPresets);
                });
              }} style={{ padding: "6px 12px", borderRadius: 7, background: "rgba(102,126,234,0.2)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Save
              </button>
            </div>
          </Section>
        </div>
      )}

      <style>{`
        @keyframes no-pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
      `}</style>
    </div>
  );
}
