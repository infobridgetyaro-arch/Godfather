import { useState, useRef, useCallback, useEffect } from "react";
import {
  X, Minus, Maximize2, Minimize2, Youtube, Move,
  Tv, MessageSquare, Sparkles, XCircle, ChevronDown,
} from "lucide-react";

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

interface YoutubePanelProps {
  url: string;
  label?: string;
  chatMessages: ChatMessage[];
  onClose: () => void;
  onFeatureMessage: (msg: ChatMessage) => void;
  onClearFeatured: () => void;
  featuredId: string | null;
}

function extractVideoId(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const stdMatch = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (stdMatch) return stdMatch[1];
  const shortMatch = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const liveMatch = s.match(/\/live\/([a-zA-Z0-9_-]{11})/);
  if (liveMatch) return liveMatch[1];
  const embedMatch = s.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
}

function avatarColor(name: string): string {
  const colors = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e","#6366f1"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  return `${Math.round(diff / 3600)}h`;
}

const MIN_W = 340;
const MIN_H = 300;
const DEFAULT_W = 480;
const DEFAULT_H = 620;
const HEADER_H = 42;

export function YoutubePanel({
  url, label, chatMessages = [], onClose, onFeatureMessage, onClearFeatured, featuredId,
}: YoutubePanelProps) {
  const videoId = extractVideoId(url);
  const [tab, setTab] = useState<"video" | "chat">("chat");
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pos, setPos] = useState(() => ({
    x: Math.max(0, window.innerWidth - DEFAULT_W - 24),
    y: 72,
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const resizeStartRef = useRef<{ mx: number; my: number; pw: number; ph: number } | null>(null);

  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (fullscreen || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  }, [pos, fullscreen]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (fullscreen) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = { mx: e.clientX, my: e.clientY, pw: size.w, ph: size.h };
  }, [size, fullscreen]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragStartRef.current) {
        const dx = e.clientX - dragStartRef.current.mx;
        const dy = e.clientY - dragStartRef.current.my;
        const nx = Math.max(0, Math.min(window.innerWidth - size.w, dragStartRef.current.px + dx));
        const ny = Math.max(0, Math.min(window.innerHeight - 48, dragStartRef.current.py + dy));
        setPos({ x: nx, y: ny });
      }
      if (resizeStartRef.current) {
        const dx = e.clientX - resizeStartRef.current.mx;
        const dy = e.clientY - resizeStartRef.current.my;
        setSize({ w: Math.max(MIN_W, resizeStartRef.current.pw + dx), h: Math.max(MIN_H, resizeStartRef.current.ph + dy) });
      }
    };
    const onUp = () => { dragStartRef.current = null; resizeStartRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [size.w]);

  useEffect(() => {
    if (tab === "chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, tab]);

  const videoSrc = videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0` : null;

  const panelStyle: React.CSSProperties = fullscreen
    ? { position: "fixed", inset: 0, zIndex: 9100, display: "flex", flexDirection: "column", background: "#0a0a12" }
    : {
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? HEADER_H : size.h,
        zIndex: 9000,
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 12px 48px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35)",
        border: "1px solid rgba(255,255,255,0.09)",
        background: "#0a0a12",
      };

  return (
    <div style={panelStyle} data-testid="youtube-panel">

      {/* ── Title bar ─────────────────────────────────────────────────────── */}
      <div
        onMouseDown={onDragMouseDown}
        style={{
          height: HEADER_H,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          cursor: fullscreen ? "default" : "grab",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "#111122",
        }}
      >
        <Move style={{ width: 13, height: 13, opacity: fullscreen ? 0 : 0.3, flexShrink: 0 }} />
        <Youtube style={{ width: 16, height: 16, color: "#ff2244", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#e8e8f0" }}>
          {label || "YouTube Monitor"}
        </span>

        {/* Tab pills */}
        {!minimized && (
          <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 7, padding: 2, gap: 1 }}>
            {(["video","chat"] as const).map((t) => (
              <button
                key={t}
                onClick={(e) => { e.stopPropagation(); setTab(t); }}
                style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                  background: tab === t ? "rgba(255,255,255,0.14)" : "transparent",
                  color: tab === t ? "#fff" : "rgba(255,255,255,0.4)",
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                {t === "video" ? <Tv style={{ width: 11, height: 11 }} /> : <MessageSquare style={{ width: 11, height: 11 }} />}
                {t === "video" ? "Video" : `Chat${chatMessages.length ? ` (${chatMessages.length})` : ""}`}
              </button>
            ))}
          </div>
        )}

        {/* Icon buttons */}
        {[
          { icon: fullscreen ? <Minimize2 style={{ width: 12, height: 12 }} /> : <Maximize2 style={{ width: 12, height: 12 }} />, title: fullscreen ? "Exit fullscreen" : "Fullscreen", action: () => setFullscreen(v => !v) },
          { icon: minimized ? <ChevronDown style={{ width: 12, height: 12 }} /> : <Minus style={{ width: 12, height: 12 }} />, title: minimized ? "Expand" : "Minimise", action: () => { setMinimized(v => !v); if (fullscreen) setFullscreen(false); } },
          { icon: <X style={{ width: 12, height: 12 }} />, title: "Close", action: onClose, danger: true },
        ].map(({ icon, title, action, danger }) => (
          <TitleBtn key={title} title={title} onClick={(e) => { e.stopPropagation(); action(); }} danger={danger}>
            {icon}
          </TitleBtn>
        ))}
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      {!minimized && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

          {/* Video tab */}
          {tab === "video" && (
            <div style={{ flex: 1, position: "relative", background: "#000", overflow: "hidden" }}>
              {!videoId ? (
                <NoVideo />
              ) : (
                <iframe
                  key={`video-${videoId}`}
                  src={videoSrc!}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%",
                    border: "none", display: "block",
                  }}
                  title="YouTube live video"
                />
              )}
            </div>
          )}

          {/* Chat tab */}
          {tab === "chat" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

              {/* Featured notice bar */}
              {featuredId && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                  background: "linear-gradient(90deg,rgba(255,34,68,0.18) 0%,rgba(255,34,68,0.05) 100%)",
                  borderBottom: "1px solid rgba(255,34,68,0.25)",
                }}>
                  <Sparkles style={{ width: 13, height: 13, color: "#ff2244", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", flex: 1, fontWeight: 600 }}>
                    Comment showing on stream
                  </span>
                  <button
                    onClick={onClearFeatured}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#ff2244", background: "rgba(255,34,68,0.12)", border: "1px solid rgba(255,34,68,0.3)", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}
                  >
                    <XCircle style={{ width: 10, height: 10 }} /> Clear
                  </button>
                </div>
              )}

              {/* Messages list */}
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {chatMessages.length === 0 ? (
                  <EmptyChat videoId={videoId} />
                ) : (
                  chatMessages.map((msg) => (
                    <MessageRow
                      key={msg.id}
                      msg={msg}
                      isHovered={hoveredId === msg.id}
                      isFeatured={featuredId === msg.id}
                      onHover={(id) => setHoveredId(id)}
                      onFeature={() => onFeatureMessage(msg)}
                    />
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          {/* Resize handle (non-fullscreen only) */}
          {!fullscreen && (
            <div
              onMouseDown={onResizeMouseDown}
              style={{ position: "absolute", bottom: 0, right: 0, width: 20, height: 20, cursor: "nwse-resize", zIndex: 10, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 3 }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
                <path d="M9 1L1 9M9 5L5 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TitleBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void; danger?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 5, border: "none", cursor: "pointer",
        background: hov ? (danger ? "rgba(220,38,38,0.4)" : "rgba(255,255,255,0.12)") : "transparent",
        color: hov && danger ? "#fff" : "rgba(255,255,255,0.5)",
        transition: "background 0.12s, color 0.12s",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function MessageRow({ msg, isHovered, isFeatured, onHover, onFeature }: {
  msg: ChatMessage;
  isHovered: boolean;
  isFeatured: boolean;
  onHover: (id: string | null) => void;
  onFeature: () => void;
}) {
  const color = avatarColor(msg.authorName);
  const initial = msg.authorName.charAt(0).toUpperCase();
  const [hovBtn, setHovBtn] = useState(false);

  return (
    <div
      onMouseEnter={() => onHover(msg.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        padding: "7px 12px",
        background: isFeatured
          ? "linear-gradient(90deg,rgba(255,34,68,0.15) 0%,rgba(255,34,68,0.04) 100%)"
          : isHovered ? "rgba(255,255,255,0.04)" : "transparent",
        borderLeft: isFeatured ? "2.5px solid #ff2244" : "2.5px solid transparent",
        transition: "background 0.1s",
        cursor: "default",
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
        backgroundColor: color,
        backgroundImage: msg.authorPhoto ? `url(${msg.authorPhoto})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800, color: "#fff",
      }}>
        {!msg.authorPhoto && initial}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: color, lineHeight: 1 }}>{msg.authorName}</span>
          {msg.isOwner && <Badge color="#ff2244">Owner</Badge>}
          {msg.isModerator && !msg.isOwner && <Badge color="#5b9cf6">Mod</Badge>}
          {msg.isMember && !msg.isModerator && !msg.isOwner && <Badge color="#22c55e">Member</Badge>}
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginLeft: "auto" }}>{timeAgo(msg.publishedAt)}</span>
        </div>
        <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.82)", margin: 0, lineHeight: 1.45, wordBreak: "break-word" }}>{msg.text}</p>
      </div>

      {/* Feature button */}
      {(isHovered || isFeatured) && (
        <button
          onMouseEnter={() => setHovBtn(true)}
          onMouseLeave={() => setHovBtn(false)}
          onClick={onFeature}
          title={isFeatured ? "Already on stream" : "Show on stream"}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 5,
            border: isFeatured ? "1px solid rgba(255,34,68,0.5)" : "1px solid rgba(255,255,255,0.15)",
            cursor: "pointer",
            background: isFeatured
              ? "rgba(255,34,68,0.18)"
              : hovBtn ? "rgba(255,34,68,0.22)" : "rgba(255,255,255,0.06)",
            color: isFeatured ? "#ff5566" : hovBtn ? "#ff5566" : "rgba(255,255,255,0.55)",
            transition: "all 0.12s",
            whiteSpace: "nowrap",
            alignSelf: "center",
          }}
        >
          <Sparkles style={{ width: 10, height: 10 }} />
          {isFeatured ? "On Air" : "Feature"}
        </button>
      )}
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 9, fontWeight: 800, color, background: `${color}22`, border: `1px solid ${color}55`, borderRadius: 3, padding: "1px 4px", lineHeight: 1.4 }}>
      {children}
    </span>
  );
}

function NoVideo() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
      <Youtube style={{ width: 40, height: 40, opacity: 0.2 }} />
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>No valid YouTube URL.<br />Set a YouTube source on the stream card.</p>
    </div>
  );
}

function EmptyChat({ videoId }: { videoId: string | null }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
      <MessageSquare style={{ width: 36, height: 36, opacity: 0.2 }} />
      <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
        {videoId ? (
          <>No chat messages yet.<br />Messages appear when the stream is live and the YouTube channel ID is set on the stream card.</>
        ) : (
          "Set a YouTube source URL to see live chat."
        )}
      </p>
    </div>
  );
}
