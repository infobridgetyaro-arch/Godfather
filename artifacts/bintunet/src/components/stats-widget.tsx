import { useState, useRef, useEffect, useCallback } from "react";
import { Users, Eye, GripHorizontal, ChevronDown, ChevronUp, MessageSquare, Palette } from "lucide-react";

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

interface StatsWidgetProps {
  streamId: string;
  subs: string | null;
  viewers: string | null;
  hasChat: boolean;
  chatMessages: ChatMessage[];
  channelId: string;
}

// ── 10 chat themes ────────────────────────────────────────────────────────────
export type ChatTheme =
  | "youtube"   // 1 YouTube Dark
  | "glass"     // 2 Glass
  | "neon"      // 3 Neon
  | "light"     // 4 Minimal Light
  | "terminal"  // 5 Terminal
  | "gradient"  // 6 Gradient Card
  | "bubble"    // 7 Bubble
  | "cinematic" // 8 Cinematic
  | "pastel"    // 9 Pastel
  | "strip";    // 10 Compact Strip

const THEMES: { id: ChatTheme; label: string; dot: string }[] = [
  { id: "youtube",  label: "YT",      dot: "#ff0000" },
  { id: "glass",    label: "Glass",   dot: "rgba(150,200,255,0.7)" },
  { id: "neon",     label: "Neon",    dot: "#0ff" },
  { id: "light",    label: "Light",   dot: "#222" },
  { id: "terminal", label: "CMD",     dot: "#0f0" },
  { id: "gradient", label: "Grad",    dot: "linear-gradient(90deg,#a78bfa,#34d399)" },
  { id: "bubble",   label: "Chat",    dot: "#6366f1" },
  { id: "cinematic",label: "Film",    dot: "#d4a843" },
  { id: "pastel",   label: "Pastel",  dot: "#f9a8d4" },
  { id: "strip",    label: "Strip",   dot: "#94a3b8" },
];

function getWidgetBg(theme: ChatTheme) {
  switch (theme) {
    case "youtube":  return "#0f0f0f";
    case "glass":    return "rgba(15,20,40,0.55)";
    case "neon":     return "#050510";
    case "light":    return "#f8fafc";
    case "terminal": return "#0a0a0a";
    case "gradient": return "linear-gradient(135deg,#1e1333 0%,#0d2626 100%)";
    case "bubble":   return "#1a1a2e";
    case "cinematic":return "#0d0d0d";
    case "pastel":   return "#fdf4ff";
    case "strip":    return "#111827";
  }
}

function getHeaderBg(theme: ChatTheme) {
  switch (theme) {
    case "youtube":  return "#212121";
    case "glass":    return "rgba(255,255,255,0.08)";
    case "neon":     return "rgba(0,255,255,0.05)";
    case "light":    return "#fff";
    case "terminal": return "#111";
    case "gradient": return "rgba(167,139,250,0.1)";
    case "bubble":   return "#16213e";
    case "cinematic":return "#1a1400";
    case "pastel":   return "#fce7f3";
    case "strip":    return "#0f172a";
  }
}

function getHeaderText(theme: ChatTheme) {
  switch (theme) {
    case "light":   return "#1e293b";
    case "pastel":  return "#7c3aed";
    case "terminal":return "#0f0";
    case "neon":    return "#0ff";
    case "cinematic":return "#d4a843";
    default: return "rgba(255,255,255,0.9)";
  }
}

function getBorderColor(theme: ChatTheme) {
  switch (theme) {
    case "neon":     return "rgba(0,255,255,0.3)";
    case "light":    return "#e2e8f0";
    case "pastel":   return "#f0abfc";
    case "terminal": return "rgba(0,255,0,0.2)";
    case "glass":    return "rgba(255,255,255,0.15)";
    default: return "rgba(255,255,255,0.08)";
  }
}

export function StatsWidget({
  subs,
  viewers,
  hasChat,
  chatMessages,
  channelId,
}: StatsWidgetProps) {
  const [pos, setPos] = useState({ x: 16, y: 80 });
  const [dragging, setDragging] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [theme, setTheme] = useState<ChatTheme>("youtube");
  const [showPalette, setShowPalette] = useState(false);
  const dragStart = useRef({ mx: 0, my: 0, wx: 0, wy: 0 });
  const chatEndRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatOpen]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { mx: e.clientX, my: e.clientY, wx: pos.x, wy: pos.y };
  }, [pos]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      const newX = Math.max(0, Math.min(window.innerWidth - 310, dragStart.current.wx + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 120, dragStart.current.wy + dy));
      setPos({ x: newX, y: newY });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging]);

  if (!channelId) return null;

  const hasStats = subs !== null || viewers !== null;
  const isLight = theme === "light" || theme === "pastel";

  return (
    <div
      ref={widgetRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9999,
        width: 304,
        userSelect: "none",
        filter: theme === "neon"
          ? "drop-shadow(0 0 18px rgba(0,255,255,0.25)) drop-shadow(0 8px 32px rgba(0,0,0,0.6))"
          : "drop-shadow(0 12px 40px rgba(0,0,0,0.55))",
        fontFamily: theme === "terminal"
          ? "'Courier New',Courier,monospace"
          : "system-ui,-apple-system,sans-serif",
      }}
    >
      <div style={{
        background: getWidgetBg(theme),
        border: `1px solid ${getBorderColor(theme)}`,
        borderRadius: theme === "cinematic" ? 0 : theme === "strip" ? 6 : 12,
        overflow: "hidden",
        backdropFilter: theme === "glass" ? "blur(24px)" : undefined,
      }}>

        {/* ── Header / drag handle ── */}
        <div
          onMouseDown={onMouseDown}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 10px 8px 12px",
            cursor: dragging ? "grabbing" : "grab",
            background: getHeaderBg(theme),
            borderBottom: minimized ? "none" : `1px solid ${getBorderColor(theme)}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <GripHorizontal size={12} style={{ color: "rgba(128,128,128,0.4)", flexShrink: 0 }} />
            {/* Theme logo */}
            {theme === "youtube" && (
              <div style={{ width: 18, height: 18, borderRadius: 4, background: "#ff0000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="10" height="7" viewBox="0 0 10 7" fill="white"><polygon points="4,0 10,3.5 4,7" /></svg>
              </div>
            )}
            {theme === "terminal" && <span style={{ color: "#0f0", fontSize: 14, lineHeight: 1 }}>$</span>}
            {theme === "neon" && <span style={{ color: "#0ff", fontSize: 11, letterSpacing: 1 }}>◈</span>}
            {theme === "cinematic" && <span style={{ color: "#d4a843", fontSize: 11 }}>▶</span>}
            <span style={{ fontSize: 12, fontWeight: theme === "terminal" ? 400 : 500, color: getHeaderText(theme), letterSpacing: theme === "terminal" ? "0.1em" : "0.01em" }}>
              {theme === "youtube" ? "YouTube Live"
                : theme === "terminal" ? "chat --live"
                : theme === "neon" ? "LIVE CHAT"
                : theme === "cinematic" ? "LIVE FEED"
                : "Live Chat"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowPalette(v => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", color: isLight ? "#64748b" : "rgba(255,255,255,0.4)", display: "flex", padding: 3, borderRadius: 4 }}
              title="Change theme"
            >
              <Palette size={12} />
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setMinimized((v) => !v)}
              style={{ background: "none", border: "none", cursor: "pointer", color: isLight ? "#64748b" : "rgba(255,255,255,0.4)", display: "flex", padding: 3, borderRadius: 4 }}
            >
              {minimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
        </div>

        {/* ── Theme palette ── */}
        {showPalette && !minimized && (
          <div style={{
            padding: "8px 10px",
            background: isLight ? "#f1f5f9" : "rgba(0,0,0,0.3)",
            borderBottom: `1px solid ${getBorderColor(theme)}`,
            display: "flex", flexWrap: "wrap", gap: 5,
          }}>
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); setShowPalette(false); }}
                title={t.label}
                style={{
                  padding: "3px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${theme === t.id ? "#6366f1" : isLight ? "#cbd5e1" : "rgba(255,255,255,0.15)"}`,
                  background: theme === t.id ? "#6366f1" : isLight ? "#fff" : "rgba(255,255,255,0.06)",
                  color: theme === t.id ? "#fff" : isLight ? "#475569" : "rgba(255,255,255,0.7)",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.dot, flexShrink: 0, display: "inline-block" }} />
                {t.label}
              </button>
            ))}
          </div>
        )}

        {!minimized && (
          <>
            {/* ── Stats row ── */}
            <div style={{ display: "flex", borderBottom: `1px solid ${getBorderColor(theme)}` }}>
              <StatBlock theme={theme} icon={<Users size={12} />} label="Subscribers" value={subs} loading={!hasStats} />
              <div style={{ width: 1, background: getBorderColor(theme), flexShrink: 0 }} />
              <StatBlock theme={theme} icon={<Eye size={12} />} label="Watching now" value={viewers} loading={!hasStats} />
            </div>

            {/* ── Chat section ── */}
            {hasChat && (
              <button
                onClick={() => setChatOpen((v) => !v)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "7px 12px",
                  background: getHeaderBg(theme),
                  border: "none",
                  borderBottom: chatOpen ? `1px solid ${getBorderColor(theme)}` : "none",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquare size={11} style={{ color: isLight ? "#64748b" : "rgba(255,255,255,0.4)" }} />
                  <span style={{ fontSize: 11, fontWeight: 500, color: isLight ? "#475569" : "rgba(255,255,255,0.7)" }}>Live chat</span>
                  {chatMessages.length > 0 && (
                    <span style={{ background: theme === "neon" ? "#0ff" : theme === "terminal" ? "#0f0" : "#ff0000", color: theme === "neon" || theme === "terminal" ? "#000" : "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 999 }}>
                      {chatMessages.length}
                    </span>
                  )}
                </div>
                {chatOpen ? <ChevronUp size={12} style={{ color: isLight ? "#64748b" : "rgba(255,255,255,0.35)" }} /> : <ChevronDown size={12} style={{ color: isLight ? "#64748b" : "rgba(255,255,255,0.35)" }} />}
              </button>
            )}

            {hasChat && chatOpen && (
              <div style={{
                maxHeight: 340,
                overflowY: "auto",
                background: theme === "light" ? "#f8fafc" : theme === "pastel" ? "#fdf4ff" : "transparent",
                padding: theme === "strip" ? "2px 0" : "4px 0 8px",
              }}>
                {chatMessages.length === 0 ? (
                  <div style={{ padding: "16px 14px", fontSize: 12, color: isLight ? "#94a3b8" : "rgba(255,255,255,0.3)", textAlign: "center" }}>
                    {theme === "terminal" ? "> awaiting_messages..." : "No messages yet…"}
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <ThemedChatRow key={msg.id} msg={msg} theme={theme} />
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {!hasChat && (
              <div style={{ padding: "12px 14px", fontSize: 11, color: isLight ? "#94a3b8" : "rgba(255,255,255,0.25)", textAlign: "center" }}>
                Chat not connected
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Stat block ─────────────────────────────────────────────────────────────────
function StatBlock({ theme, icon, label, value, loading }: {
  theme: ChatTheme; icon: React.ReactNode; label: string; value: string | null; loading: boolean;
}) {
  const isLight = theme === "light" || theme === "pastel";
  const accentColor =
    theme === "youtube" ? "#ff0000"
    : theme === "neon" ? "#0ff"
    : theme === "terminal" ? "#0f0"
    : theme === "cinematic" ? "#d4a843"
    : theme === "pastel" ? "#d946ef"
    : theme === "gradient" ? "#a78bfa"
    : isLight ? "#6366f1"
    : "#ff0000";

  return (
    <div style={{ flex: 1, padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
        <span style={{ color: accentColor, display: "flex" }}>{icon}</span>
        <span style={{ fontSize: 10, color: isLight ? "#64748b" : "rgba(170,170,170,0.8)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500 }}>{label}</span>
      </div>
      {loading ? (
        <div style={{ height: 20, display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: accentColor, animation: "ytpulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, color: isLight ? "#94a3b8" : "rgba(255,255,255,0.25)" }}>Loading…</span>
        </div>
      ) : (
        <div style={{ fontSize: 20, fontWeight: 700, color: value ? (isLight ? "#1e293b" : "#fff") : (isLight ? "#94a3b8" : "rgba(255,255,255,0.2)"), fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {value ?? "—"}
        </div>
      )}
      <style>{`@keyframes ytpulse { 0%,100%{opacity:1} 50%{opacity:0.25} }`}</style>
    </div>
  );
}

// ── Theme-aware chat row ──────────────────────────────────────────────────────
function ThemedChatRow({ msg, theme }: { msg: ChatMessage; theme: ChatTheme }) {
  switch (theme) {
    case "youtube":  return <YoutubeChatRow msg={msg} />;
    case "glass":    return <GlassChatRow msg={msg} />;
    case "neon":     return <NeonChatRow msg={msg} />;
    case "light":    return <LightChatRow msg={msg} />;
    case "terminal": return <TerminalChatRow msg={msg} />;
    case "gradient": return <GradientChatRow msg={msg} />;
    case "bubble":   return <BubbleChatRow msg={msg} />;
    case "cinematic":return <CinematicChatRow msg={msg} />;
    case "pastel":   return <PastelChatRow msg={msg} />;
    case "strip":    return <StripChatRow msg={msg} />;
  }
}

// Helper for avatar initials
function avatarInitials(name: string) {
  return name.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
}
function avatarHue(name: string) { return (name.charCodeAt(0) || 65) * 37 % 360; }

function Avatar({ msg, size = 24 }: { msg: ChatMessage; size?: number }) {
  const [err, setErr] = useState(false);
  const hue = avatarHue(msg.authorName);
  if (!err && msg.authorPhoto) {
    return <img src={msg.authorPhoto} alt="" onError={() => setErr(true)} style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "block" }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: `hsl(${hue},50%,32%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.35, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
      {avatarInitials(msg.authorName)}
    </div>
  );
}

// 1 — YouTube Dark (inline name+message, role-colored names)
function YoutubeChatRow({ msg }: { msg: ChatMessage }) {
  const nameColor = msg.isOwner ? "#ffd600" : msg.isModerator ? "#5e84f1" : msg.isMember ? "#2ba640" : "#e0e0e0";
  return (
    <div style={{ display: "flex", gap: 8, padding: "5px 12px", alignItems: "flex-start" }}>
      <div style={{ flexShrink: 0, marginTop: 1 }}><Avatar msg={msg} size={22} /></div>
      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.45 }}>
        {msg.isOwner && <span style={{ fontSize: 9, background: "#ffd600", color: "#000", padding: "1px 5px", borderRadius: 3, fontWeight: 800, marginRight: 4 }}>OWNER</span>}
        {!msg.isOwner && msg.isModerator && <svg width="11" height="11" viewBox="0 0 24 24" fill="#5e84f1" style={{ verticalAlign: "middle", marginRight: 4 }}><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>}
        {!msg.isOwner && !msg.isModerator && msg.isMember && <span style={{ fontSize: 9, color: "#2ba640", border: "1px solid #2ba640", padding: "1px 4px", borderRadius: 3, fontWeight: 700, marginRight: 4 }}>MEMBER</span>}
        <span style={{ fontSize: 12, fontWeight: 500, color: nameColor, marginRight: 4 }}>{msg.authorName}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.87)", wordBreak: "break-word" }}>{msg.text}</span>
      </div>
    </div>
  );
}

// 2 — Glass (frosted look, subtle dividers)
function GlassChatRow({ msg }: { msg: ChatMessage }) {
  const nameColor = msg.isOwner ? "#fbbf24" : msg.isModerator ? "#93c5fd" : msg.isMember ? "#6ee7b7" : "#e2e8f0";
  return (
    <div style={{ display: "flex", gap: 8, padding: "6px 12px", alignItems: "flex-start", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <Avatar msg={msg} size={22} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: nameColor, marginBottom: 2 }}>{msg.authorName}</div>
        <div style={{ fontSize: 12, color: "rgba(200,220,255,0.85)", lineHeight: 1.4, wordBreak: "break-word" }}>{msg.text}</div>
      </div>
    </div>
  );
}

// 3 — Neon (cyan/magenta glow borders)
function NeonChatRow({ msg }: { msg: ChatMessage }) {
  const accent = msg.isOwner ? "#f0f" : msg.isModerator ? "#0ff" : msg.isMember ? "#0f0" : "rgba(0,255,255,0.5)";
  return (
    <div style={{ margin: "4px 10px", padding: "5px 10px", borderRadius: 6, border: `1px solid ${accent}`, background: "rgba(0,255,255,0.03)", boxShadow: `0 0 8px ${accent}22` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{msg.authorName}</div>
      <div style={{ fontSize: 12, color: "rgba(200,255,255,0.9)", wordBreak: "break-word" }}>{msg.text}</div>
    </div>
  );
}

// 4 — Minimal Light (white bg, clean typography)
function LightChatRow({ msg }: { msg: ChatMessage }) {
  const nameColor = msg.isOwner ? "#b45309" : msg.isModerator ? "#4f46e5" : msg.isMember ? "#059669" : "#1e293b";
  return (
    <div style={{ display: "flex", gap: 8, padding: "6px 12px", alignItems: "flex-start", borderBottom: "1px solid #f1f5f9" }}>
      <Avatar msg={msg} size={24} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: nameColor, marginRight: 5 }}>{msg.authorName}</span>
        {msg.isOwner && <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", padding: "1px 5px", borderRadius: 3, fontWeight: 700, marginRight: 4 }}>OWNER</span>}
        {msg.isModerator && !msg.isOwner && <span style={{ fontSize: 9, background: "#ede9fe", color: "#6d28d9", padding: "1px 5px", borderRadius: 3, fontWeight: 700, marginRight: 4 }}>MOD</span>}
        <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.45, marginTop: 1, wordBreak: "break-word" }}>{msg.text}</div>
      </div>
    </div>
  );
}

// 5 — Terminal (green-on-black monospace)
function TerminalChatRow({ msg }: { msg: ChatMessage }) {
  const prefix = msg.isOwner ? "[OWNER]" : msg.isModerator ? "[MOD]" : msg.isMember ? "[MBR]" : "[usr]";
  return (
    <div style={{ padding: "3px 12px", fontSize: 11, lineHeight: 1.5, fontFamily: "'Courier New',monospace", color: "#0f0", wordBreak: "break-word" }}>
      <span style={{ color: "rgba(0,255,0,0.5)" }}>{prefix} </span>
      <span style={{ color: "#5fffff" }}>{msg.authorName}</span>
      <span style={{ color: "rgba(0,255,0,0.4)" }}>: </span>
      {msg.text}
    </div>
  );
}

// 6 — Gradient Card (left border by role)
function GradientChatRow({ msg }: { msg: ChatMessage }) {
  const border = msg.isOwner ? "#f59e0b" : msg.isModerator ? "#818cf8" : msg.isMember ? "#34d399" : "#6366f1";
  return (
    <div style={{ margin: "3px 10px", padding: "6px 10px", borderRadius: 6, borderLeft: `3px solid ${border}`, background: "rgba(255,255,255,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Avatar msg={msg} size={18} />
        <span style={{ fontSize: 11, fontWeight: 700, color: border }}>{msg.authorName}</span>
      </div>
      <div style={{ fontSize: 12, color: "rgba(210,220,255,0.88)", lineHeight: 1.4, wordBreak: "break-word" }}>{msg.text}</div>
    </div>
  );
}

// 7 — Bubble (rounded chat bubbles)
function BubbleChatRow({ msg }: { msg: ChatMessage }) {
  const bubbleBg = msg.isOwner ? "rgba(245,158,11,0.18)" : msg.isModerator ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.07)";
  const nameColor = msg.isOwner ? "#fbbf24" : msg.isModerator ? "#a5b4fc" : "rgba(255,255,255,0.75)";
  return (
    <div style={{ padding: "4px 10px", display: "flex", gap: 7, alignItems: "flex-end" }}>
      <Avatar msg={msg} size={24} />
      <div style={{ background: bubbleBg, borderRadius: "14px 14px 14px 2px", padding: "6px 10px", maxWidth: "85%" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: nameColor, marginBottom: 2 }}>{msg.authorName}</div>
        <div style={{ fontSize: 12, color: "rgba(240,240,255,0.92)", lineHeight: 1.4, wordBreak: "break-word" }}>{msg.text}</div>
      </div>
    </div>
  );
}

// 8 — Cinematic (wide dark, gold accent, film look)
function CinematicChatRow({ msg }: { msg: ChatMessage }) {
  const nameColor = msg.isOwner ? "#f59e0b" : msg.isModerator ? "#60a5fa" : "#d1d5db";
  return (
    <div style={{ padding: "5px 14px", display: "flex", gap: 10, alignItems: "center", borderBottom: "1px solid rgba(212,168,67,0.08)" }}>
      <div style={{ width: 2, height: 28, background: msg.isOwner ? "#f59e0b" : msg.isModerator ? "#60a5fa" : "rgba(212,168,67,0.3)", borderRadius: 99, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: nameColor, textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 6 }}>{msg.authorName}</span>
        <span style={{ fontSize: 12, color: "rgba(220,210,190,0.9)", wordBreak: "break-word" }}>{msg.text}</span>
      </div>
    </div>
  );
}

// 9 — Pastel (soft coloured backgrounds per role)
function PastelChatRow({ msg }: { msg: ChatMessage }) {
  const bg = msg.isOwner ? "#fef9c3" : msg.isModerator ? "#ede9fe" : msg.isMember ? "#dcfce7" : "#f8fafc";
  const nameColor = msg.isOwner ? "#92400e" : msg.isModerator ? "#6d28d9" : msg.isMember ? "#166534" : "#334155";
  return (
    <div style={{ margin: "3px 8px", padding: "6px 10px", borderRadius: 10, background: bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Avatar msg={msg} size={20} />
        <span style={{ fontSize: 11, fontWeight: 700, color: nameColor }}>{msg.authorName}</span>
        {msg.isOwner && <span style={{ fontSize: 9, background: "#fef3c7", color: "#92400e", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>OWNER</span>}
        {msg.isModerator && !msg.isOwner && <span style={{ fontSize: 9, background: "#ede9fe", color: "#6d28d9", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>MOD</span>}
      </div>
      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.4, wordBreak: "break-word" }}>{msg.text}</div>
    </div>
  );
}

// 10 — Compact Strip (ultra-dense, no avatars)
function StripChatRow({ msg }: { msg: ChatMessage }) {
  const nameColor = msg.isOwner ? "#fbbf24" : msg.isModerator ? "#818cf8" : msg.isMember ? "#34d399" : "#94a3b8";
  return (
    <div style={{ padding: "2px 12px", fontSize: 11, lineHeight: 1.6, borderBottom: "1px solid rgba(255,255,255,0.03)", display: "flex", gap: 4, alignItems: "baseline", flexWrap: "wrap" }}>
      <span style={{ fontWeight: 700, color: nameColor, flexShrink: 0 }}>{msg.authorName}</span>
      <span style={{ color: "rgba(148,163,184,0.4)", flexShrink: 0 }}>›</span>
      <span style={{ color: "rgba(200,210,230,0.85)", wordBreak: "break-word" }}>{msg.text}</span>
    </div>
  );
}
