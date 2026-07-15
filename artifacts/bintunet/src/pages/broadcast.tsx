import { useState, useEffect, useRef, useCallback } from "react";

interface OverlayPosition { x: number; y: number; }

interface BroadcastState {
  newsActive: boolean;
  newsText: string;
  newsTitle?: string;
  newsBgColor?: string;
  newsLogo?: string;
  newsScrollSpeed?: number;
  newsStyle: string;
  newsPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  adActive: boolean;
  adText: string;
  adSub: string;
  adStyle: string;
  adPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;
  breakActive: boolean;
  breakText: string;
  breakStyle: string;
  breakVideoUrl: string;
  breakVideoMuted: boolean;
  breakVideoMode: string;
  breakVideoPanX: number;
  breakVideoPanY: number;
  liveAudioMuted: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientActive: boolean;
  bgGradientOpacity: number;
  chatStyle: string;
  chatBurnActive: boolean;
  chatBurnPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  statsActive: boolean;
  statsPosition: OverlayPosition;
  mobileStatsPosition: OverlayPosition;
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  subsGoal: number;
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: OverlayPosition;
  qrScanCount: number;
  qrThankYouActive: boolean;
  qrThankYouName: string;
  qrThankYouTs: number;
  qrGlowIntensity: number;
  qrBorderStyle: string;
  qrAnimation: string;
  subAlertActive: boolean;
  subAlertMessage: string;
  newsScale?: number;
}

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
  /** Client-side timestamp (Date.now()) when the message was received — used for 10 s TTL */
  receivedAt: number;
}

interface StreamStats {
  subs: string | null;
  viewers: string | null;
}

/* ─── Mobile viewport detection ─── */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

/* ─── News overlay state (API-driven) ─── */
interface NewsOverlayLive {
  active: boolean;
  theme: string;
  customColors: { primary: string; secondary: string; background: string; text: string; badge: string; badgeText: string };
  customFont: { family: string; size: number; weight: number; letterSpacing: number };
  opacity: number;
  layout: { position: { x: number; y: number }; width: number; height: number; zIndex: number };
  logo: string;
  liveBadge: { visible: boolean; label: string; pulse: boolean; color: string };
  headline: { text: string; animation: string; durationMs: number; autoRotate: boolean; headlines: string[]; currentIndex: number };
  breakingNews: { active: boolean; text: string; flashInterval: number; overridesTicker: boolean };
  ticker: { style: string; direction: string; speed: number; paused: boolean; separator: string };
  tickerMessages: Array<{ id: string; text: string; priority: number }>;
  enterAnimation: string;
  exitAnimation: string;
  animationDurationMs: number;
}

/* ─── WebSocket hook for the stage (no auth required) ─── */
function useBroadcastWS() {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<BroadcastState | null>(null);
  const [newsOverlay, setNewsOverlay] = useState<NewsOverlayLive | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [stats, setStats] = useState<StreamStats>({ subs: null, viewers: null });
  const [scanFlash, setScanFlash] = useState<number | null>(null);
  const [giftPopup, setGiftPopup] = useState<{ name: string; ts: number } | null>(null);
  const [subAlertKey, setSubAlertKey] = useState(0);
  const prevSubAlertActiveRef = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "broadcast" && msg.data) {
          setState(msg.data as BroadcastState);
        }
        if (msg.type === "news-overlay" && msg.data) {
          setNewsOverlay(msg.data as NewsOverlayLive);
        }
        if (msg.type === "chat" && Array.isArray(msg.data)) {
          const receivedAt = Date.now();
          const msgs = (msg.data as ChatMessage[])
            .filter((m) => !seenIds.current.has(m.id))
            .map((m) => ({ ...m, receivedAt }));
          msgs.forEach((m) => seenIds.current.add(m.id));
          if (msgs.length) {
            setChat((prev) => [...prev, ...msgs].slice(-10));
          }
        }
        if (msg.type === "chat_clear") {
          setChat([]);
          seenIds.current = new Set();
        }
        if (msg.type === "stats" && msg.data) {
          setStats({ subs: msg.data.subs ?? null, viewers: msg.data.viewers ?? null });
        }
        if (msg.type === "status" && (msg.data === "idle" || msg.data === "error")) {
          setChat([]);
          seenIds.current = new Set();
          setStats({ subs: null, viewers: null });
        }
        if (msg.type === "paystack_scan" || msg.type === "qr_scan") {
          const ts = Date.now();
          if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
          setScanFlash(ts);
          scanTimerRef.current = setTimeout(() => setScanFlash(null), 4000);
        }
        if (msg.type === "paystack_paid" || msg.type === "gift_received" || msg.type === "qr_thank_you") {
          const payerName =
            (msg.data?.payerName as string) ||
            (msg.data?.name as string) ||
            "Anonymous";
          const ts = Date.now();
          if (giftTimerRef.current) clearTimeout(giftTimerRef.current);
          setGiftPopup({ name: payerName, ts });
          giftTimerRef.current = setTimeout(() => setGiftPopup(null), 6000);
        }
      } catch {}
    };

    ws.onclose = () => setTimeout(connect, 2000);
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    // Fetch initial broadcast state
    fetch("/api/broadcast").then((r) => r.json()).then((d) => setState(d)).catch(() => {});
    // Fetch initial news overlay state
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
    fetch("/api/news-overlay", {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.ok ? r.json() : null).then(d => { if (d) setNewsOverlay(d); }).catch(() => {});
    connect();
    return () => {
      wsRef.current?.close();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      if (giftTimerRef.current) clearTimeout(giftTimerRef.current);
    };
  }, [connect]);

  // Prune chat messages older than 10 seconds so the browser overlay never
  // shows stale messages between streams or after a stream ends.
  useEffect(() => {
    const timer = setInterval(() => {
      setChat((prev) => {
        const cutoff = Date.now() - 10_000;
        const next = prev.filter((m) => m.receivedAt > cutoff);
        return next.length === prev.length ? prev : next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  return { state, newsOverlay, chat, stats, scanFlash, giftPopup };
}

/* ─── Helper components ─── */

function Avatar({ msg, size = 34 }: { msg: ChatMessage; size?: number }) {
  const color = msg.isOwner ? "#f59e0b" : msg.isModerator ? "#6366f1" : msg.isMember ? "#10b981" : "#4b5563";
  const initials = msg.authorName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  return msg.authorPhoto ? (
    <img
      src={msg.authorPhoto} alt=""
      style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }}
      onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
    />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: color, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 800, color: "#fff",
    }}>{initials}</div>
  );
}

/* ─── Chat styles ─── */

/* ── Shared message queue hook ── */
function useMessageQueue<T extends { id: string }>(messages: T[], max: number, expireMs: number) {
  type Q = T & { _key: number; phase: "enter" | "visible" | "leave" };
  const [queue, setQueue] = useState<Q[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Track which IDs we've already enqueued so batch arrivals all get shown
  const processedIds = useRef<Set<string>>(new Set());

  const enqueue = useRef((msg: T) => {
    const key = counter.current++;
    processedIds.current.add(msg.id);
    // Trim processed set to avoid unbounded growth
    if (processedIds.current.size > 500) {
      const oldest = Array.from(processedIds.current).slice(0, 200);
      oldest.forEach((id) => processedIds.current.delete(id));
    }
    setQueue((prev) => {
      if (prev.find((m) => m.id === msg.id)) return prev;
      return [...prev.slice(-(max - 1)), { ...msg, _key: key, phase: "enter" }];
    });
    const t1 = setTimeout(() =>
      setQueue((p) => p.map((m) => m._key === key ? { ...m, phase: "visible" as const } : m)), 40);
    const t2 = setTimeout(() => {
      setQueue((p) => p.map((m) => m._key === key ? { ...m, phase: "leave" as const } : m));
      const t3 = setTimeout(() => setQueue((p) => p.filter((m) => m._key !== key)), 480);
      timers.current.set(key + 1e6, t3);
    }, expireMs);
    timers.current.set(key, t1);
    timers.current.set(key + 5e5, t2);
  });

  useEffect(() => {
    if (!messages.length) return;
    // Process every new message in the batch, staggered so each one is visible
    const newMsgs = messages.filter((m) => !processedIds.current.has(m.id));
    newMsgs.forEach((msg, i) => {
      const t = setTimeout(() => enqueue.current(msg), i * 600);
      timers.current.set(counter.current + i * 1e8, t);
    });
  }, [messages]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  return queue;
}

function roleAccent(msg: ChatMessage) {
  return msg.isOwner ? "#f59e0b" : msg.isModerator ? "#818cf8" : msg.isMember ? "#34d399" : "#06b6d4";
}
function roleBadge(msg: ChatMessage) {
  if (msg.isOwner)     return { label: "HOST",   color: "#f59e0b", bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.35)" };
  if (msg.isModerator) return { label: "MOD",    color: "#818cf8", bg: "rgba(129,140,248,0.18)", border: "rgba(129,140,248,0.35)" };
  if (msg.isMember)    return { label: "MEMBER", color: "#34d399", bg: "rgba(52,211,153,0.18)",  border: "rgba(52,211,153,0.35)" };
  return null;
}

/* ── TV — Premium lower-third broadcast style ── */
function TVChat({ messages, isMobile, pos }: { messages: ChatMessage[]; isMobile?: boolean; pos?: OverlayPosition }) {
  const queue = useMessageQueue(messages, 6, 9000);

  const posStyle: React.CSSProperties = pos
    ? { left: `${pos.x}%`, top: `${pos.y}%` }
    : { left: isMobile ? 8 : 24, bottom: isMobile ? 70 : 96 };

  return (
    <div style={{
      position: "fixed", ...posStyle,
      width: isMobile ? "calc(100vw - 16px)" : 420,
      maxWidth: "calc(100vw - 16px)",
      display: "flex", flexDirection: "column", gap: isMobile ? 5 : 7,
      zIndex: 20, pointerEvents: "none",
    }}>
      {queue.map((msg) => {
        const entering = msg.phase === "enter";
        const leaving  = msg.phase === "leave";
        const ac = roleAccent(msg);
        const b  = roleBadge(msg);
        return (
          <div key={msg._key} style={{
            display: "flex", alignItems: "stretch",
            opacity: entering || leaving ? 0 : 1,
            transform: entering ? "translateY(20px) scale(0.95)"
              : leaving ? "translateX(-120%) scale(0.97)" : "none",
            transition: entering
              ? "opacity 0.3s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"
              : leaving
              ? "opacity 0.4s ease-in, transform 0.44s cubic-bezier(0.4,0,1,1)"
              : "none",
            willChange: "transform, opacity",
          }}>
            <div style={{
              width: 4, borderRadius: "4px 0 0 4px", flexShrink: 0,
              background: `linear-gradient(180deg, ${ac}, ${ac}99)`,
              boxShadow: `3px 0 18px ${ac}55`,
            }} />
            <div style={{
              flex: 1, background: "rgba(4,6,18,0.94)",
              backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)",
              border: "1px solid rgba(255,255,255,0.07)", borderLeft: "none",
              borderRadius: "0 12px 12px 0",
              padding: isMobile ? "9px 12px" : "11px 16px",
              minWidth: 0, overflow: "hidden",
              boxShadow: "0 10px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <Avatar msg={msg} size={isMobile ? 20 : 26} />
                <span style={{
                  fontSize: isMobile ? 10 : 11, fontWeight: 800, color: ac,
                  letterSpacing: "0.03em", flex: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textShadow: `0 0 20px ${ac}55`,
                }}>{msg.authorName}</span>
                {b && (
                  <span style={{
                    fontSize: 8, fontWeight: 900, letterSpacing: "0.07em",
                    background: b.bg, color: b.color, border: `1px solid ${b.border}`,
                    padding: "2px 6px", borderRadius: 5, flexShrink: 0,
                  }}>{b.label}</span>
                )}
              </div>
              <div style={{
                fontSize: isMobile ? 11 : 13, color: "rgba(238,242,255,0.94)",
                lineHeight: 1.5, wordBreak: "break-word",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
                overflow: "hidden",
              }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Bubble — Modern messenger speech bubbles ── */
function BubbleChat({ messages, isMobile }: { messages: ChatMessage[]; isMobile?: boolean }) {
  const queue = useMessageQueue(messages, 7, 8500);

  const roleGradient = (msg: ChatMessage) =>
    msg.isOwner      ? "linear-gradient(135deg,#f59e0b,#d97706)"
    : msg.isModerator ? "linear-gradient(135deg,#818cf8,#6366f1)"
    : msg.isMember    ? "linear-gradient(135deg,#34d399,#10b981)"
    : "linear-gradient(135deg,#3b4a6b,#2d3a55)";

  return (
    <div style={{
      position: "fixed", bottom: isMobile ? 66 : 96, right: isMobile ? 8 : 24,
      display: "flex", flexDirection: "column", gap: isMobile ? 6 : 8, alignItems: "flex-end",
      zIndex: 20, maxWidth: isMobile ? "calc(100vw - 16px)" : 340, pointerEvents: "none",
    }}>
      {queue.map((msg) => {
        const entering = msg.phase === "enter";
        const leaving  = msg.phase === "leave";
        const ac = roleAccent(msg);
        return (
          <div key={msg._key} style={{
            display: "flex", gap: isMobile ? 6 : 8, alignItems: "flex-end", maxWidth: "100%",
            opacity: entering || leaving ? 0 : 1,
            transform: entering ? "scale(0.75) translateY(12px)" : leaving ? "scale(0.88) translateX(28px)" : "none",
            transition: entering
              ? "opacity 0.32s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"
              : leaving
              ? "opacity 0.36s ease-in, transform 0.36s ease-in"
              : "none",
            willChange: "transform, opacity",
          }}>
            <Avatar msg={msg} size={isMobile ? 24 : 30} />
            <div style={{ maxWidth: isMobile ? "calc(100vw - 62px)" : 278, minWidth: 0 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, marginBottom: 3, textAlign: "right",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: ac, textShadow: `0 0 10px ${ac}44`,
              }}>{msg.authorName}</div>
              <div style={{
                background: roleGradient(msg),
                borderRadius: isMobile ? "14px 14px 3px 14px" : "16px 16px 3px 16px",
                padding: isMobile ? "8px 12px" : "10px 15px",
                color: "#fff", fontSize: isMobile ? 11 : 13, lineHeight: 1.5,
                wordBreak: "break-word",
                boxShadow: "0 6px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.18)",
              }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Neon — Cyberpunk futuristic with animated rotating border ── */
function NeonChat({ messages, isMobile }: { messages: ChatMessage[]; isMobile?: boolean }) {
  const queue = useMessageQueue(messages, 10, 9500);
  const [deg, setDeg] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const COLS = ["#00fff0","#ff00ff","#ffe500","#ff6b6b","#b8ff3c","#00b4ff","#ff9500","#c084fc"];

  useEffect(() => {
    const tick = () => { setDeg((d) => (d + 1.4) % 360); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  if (!queue.length) return null;

  return (
    <div style={{
      position: "fixed", bottom: isMobile ? 66 : 96, right: isMobile ? 8 : 24,
      zIndex: 20, pointerEvents: "none",
      width: isMobile ? "calc(100vw - 16px)" : 360,
      maxWidth: "calc(100vw - 16px)",
    }}>
      <div style={{
        background: `linear-gradient(${deg}deg,#00fff0,#ff00ff,#ffe500,#00fff0)`,
        padding: 1.5, borderRadius: 15,
        boxShadow: "0 0 30px rgba(0,255,240,0.18), 0 0 60px rgba(255,0,255,0.1)",
      }}>
        <div style={{
          background: "rgba(3,4,16,0.97)", backdropFilter: "blur(20px)",
          borderRadius: 13.5, padding: isMobile ? "10px 13px" : "12px 16px",
          display: "flex", flexDirection: "column", gap: isMobile ? 4 : 5,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            paddingBottom: isMobile ? 6 : 8, marginBottom: 1,
            borderBottom: "1px solid rgba(0,255,240,0.14)",
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00fff0", flexShrink: 0,
              boxShadow: "0 0 8px #00fff0, 0 0 20px #00fff0" }} />
            <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(0,255,240,0.75)",
              letterSpacing: "0.14em", textTransform: "uppercase" }}>Live Chat</span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "rgba(255,255,255,0.22)",
              fontVariantNumeric: "tabular-nums" }}>{queue.length}</span>
          </div>
          {queue.map((msg, i) => {
            const entering = msg.phase === "enter";
            const leaving  = msg.phase === "leave";
            const c = msg.isOwner ? "#f59e0b" : msg.isModerator ? "#818cf8" : msg.isMember ? "#34d399"
              : COLS[i % COLS.length];
            return (
              <div key={msg._key} style={{
                display: "flex", gap: 7, alignItems: "baseline", overflow: "hidden",
                opacity: entering || leaving ? 0 : 1,
                transform: entering ? "translateX(-12px)" : leaving ? "translateX(8px)" : "none",
                transition: entering
                  ? "opacity 0.22s ease, transform 0.28s cubic-bezier(0.34,1.56,0.64,1)"
                  : leaving
                  ? "opacity 0.28s ease-in, transform 0.28s ease-in"
                  : "none",
              }}>
                <span style={{
                  fontSize: isMobile ? 10 : 11, fontWeight: 800, color: c, flexShrink: 0,
                  textShadow: `0 0 10px ${c}, 0 0 22px ${c}55`,
                  maxWidth: isMobile ? "38%" : "42%",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{msg.authorName}:</span>
                <span style={{
                  fontSize: isMobile ? 10 : 12, color: "rgba(228,234,255,0.9)",
                  wordBreak: "break-word", minWidth: 0, lineHeight: 1.4,
                }}>{msg.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Glass — True glassmorphism with depth and blur reveal ── */
function GlassChat({ messages, isMobile }: { messages: ChatMessage[]; isMobile?: boolean }) {
  const queue = useMessageQueue(messages, 5, 9000);

  return (
    <div style={{
      position: "fixed", bottom: isMobile ? 66 : 96, right: isMobile ? 8 : 24,
      display: "flex", flexDirection: "column", gap: isMobile ? 7 : 10, alignItems: "flex-end",
      zIndex: 20, maxWidth: isMobile ? "calc(100vw - 16px)" : 360, pointerEvents: "none",
    }}>
      {queue.map((msg) => {
        const entering = msg.phase === "enter";
        const leaving  = msg.phase === "leave";
        const ac = roleAccent(msg);
        const b  = roleBadge(msg);
        return (
          <div key={msg._key} style={{
            background: "rgba(255,255,255,0.07)",
            backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderTop: "1px solid rgba(255,255,255,0.28)",
            borderRadius: 17,
            padding: isMobile ? "10px 13px" : "13px 17px",
            display: "flex", gap: isMobile ? 9 : 11,
            boxShadow: "0 14px 44px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.14)",
            maxWidth: "100%", boxSizing: "border-box",
            opacity: entering || leaving ? 0 : 1,
            transform: entering ? "scale(0.9) translateY(18px)" : leaving ? "scale(0.87) translateY(-12px)" : "none",
            filter: entering ? "blur(5px)" : leaving ? "blur(3px)" : "none",
            transition: entering
              ? "opacity 0.38s ease, transform 0.44s cubic-bezier(0.34,1.56,0.64,1), filter 0.38s ease"
              : leaving
              ? "opacity 0.44s ease-in, transform 0.44s ease-in, filter 0.3s ease-in"
              : "none",
            willChange: "transform, opacity, filter",
          }}>
            <Avatar msg={msg} size={isMobile ? 26 : 32} />
            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontSize: isMobile ? 10 : 11, fontWeight: 700, color: ac,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                }}>{msg.authorName}</span>
                {b && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, background: b.bg, color: b.color,
                    border: `1px solid ${b.border}`, padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                  }}>{b.label}</span>
                )}
              </div>
              <div style={{
                fontSize: isMobile ? 11 : 13, color: "rgba(255,255,255,0.94)",
                wordBreak: "break-word", lineHeight: 1.5,
              }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Compact — High-density IRC-style scrolling feed ── */
function CompactChat({ messages, isMobile }: { messages: ChatMessage[]; isMobile?: boolean }) {
  const queue = useMessageQueue(messages, 14, 12000);

  if (!queue.length) return null;

  return (
    <div style={{
      position: "fixed", bottom: isMobile ? 66 : 96, right: isMobile ? 8 : 24,
      zIndex: 20, width: isMobile ? "calc(100vw - 16px)" : 340,
      background: "rgba(3,4,14,0.9)",
      backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
      borderRadius: 14, overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.07)",
      boxShadow: "0 16px 52px rgba(0,0,0,0.75)",
      boxSizing: "border-box", pointerEvents: "none",
    }}>
      <div style={{
        padding: "6px 13px 5px 11px",
        borderBottom: "1px solid rgba(255,255,255,0.055)",
        display: "flex", alignItems: "center", gap: 7,
      }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444", flexShrink: 0,
          boxShadow: "0 0 8px #ef4444", animation: "cq-blink 1.4s infinite" }} />
        <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.32)",
          textTransform: "uppercase", letterSpacing: "0.13em", flex: 1 }}>Live Chat</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.18)", fontVariantNumeric: "tabular-nums" }}>{queue.length}</span>
      </div>
      {queue.map((msg) => {
        const ac = roleAccent(msg);
        return (
          <div key={msg._key} style={{
            display: "flex", gap: 7, alignItems: "flex-start",
            padding: isMobile ? "5px 11px" : "6px 13px",
            borderBottom: "1px solid rgba(255,255,255,0.033)",
            opacity: msg.phase === "visible" ? 1 : 0,
            transform: msg.phase === "enter" ? "translateY(-10px)"
              : msg.phase === "leave" ? "translateX(18px) scale(0.97)" : "none",
            transition: msg.phase === "enter"
              ? "opacity 0.26s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)"
              : msg.phase === "leave"
              ? "opacity 0.36s ease-in, transform 0.36s ease-in"
              : "none",
          }}>
            <span style={{
              fontSize: isMobile ? 10 : 11, fontWeight: 700, color: ac, flexShrink: 0,
              maxWidth: isMobile ? "36%" : "42%",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{msg.authorName}:</span>
            <span style={{
              fontSize: isMobile ? 10 : 11, color: "rgba(218,226,255,0.86)",
              wordBreak: "break-word", minWidth: 0, lineHeight: 1.4, flex: 1,
            }}>{msg.text}</span>
          </div>
        );
      })}
      <style>{`@keyframes cq-blink { 0%,100%{opacity:1;} 50%{opacity:0.18;} }`}</style>
    </div>
  );
}

/* ── Toast — Premium floating notification with progress bar ── */
function ToastChat({ messages, isMobile }: { messages: ChatMessage[]; isMobile?: boolean }) {
  const EXPIRE_MS = 8000;
  const queue = useMessageQueue(messages, 4, EXPIRE_MS);

  if (!queue.length) return null;

  return (
    <div style={{
      position: "fixed", bottom: isMobile ? 66 : 96, right: isMobile ? 8 : 24,
      display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end",
      zIndex: 20, maxWidth: isMobile ? "calc(100vw - 16px)" : 380, pointerEvents: "none",
    }}>
      {queue.map((msg, i) => {
        const isNewest = i === queue.length - 1;
        const ac = roleAccent(msg);
        const b  = roleBadge(msg);
        const entering = msg.phase === "enter";
        const leaving  = msg.phase === "leave";
        return (
          <div key={msg._key} style={{
            width: isMobile ? "calc(100vw - 16px)" : 380,
            background: "rgba(5,6,20,0.93)",
            backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)",
            border: `1px solid ${isNewest ? `${ac}33` : "rgba(255,255,255,0.065)"}`,
            borderRadius: 15, overflow: "hidden",
            boxShadow: isNewest
              ? `0 14px 44px rgba(0,0,0,0.75), 0 0 0 1px ${ac}12`
              : "0 5px 24px rgba(0,0,0,0.55)",
            opacity: entering || leaving ? 0 : 1,
            transform: entering ? "translateX(55px) scale(0.88)" : leaving ? "translateX(60px) scale(0.86)" : "none",
            transition: entering
              ? "opacity 0.4s cubic-bezier(0.34,1.56,0.64,1), transform 0.42s cubic-bezier(0.34,1.56,0.64,1)"
              : leaving
              ? "opacity 0.5s ease-in, transform 0.5s ease-in"
              : "none",
            willChange: "transform, opacity",
          }}>
            <div style={{ display: "flex", gap: isMobile ? 11 : 13, alignItems: "center",
              padding: isMobile ? "10px 13px" : "12px 16px" }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <Avatar msg={msg} size={isMobile ? 28 : 34} />
                {isNewest && (
                  <div style={{
                    position: "absolute", bottom: -2, right: -2,
                    width: 10, height: 10, borderRadius: "50%",
                    background: ac, border: "2px solid rgba(5,6,20,0.93)",
                    boxShadow: `0 0 8px ${ac}`,
                  }} />
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{
                    fontSize: isMobile ? 10 : 11, fontWeight: 800, color: ac,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                  }}>{msg.authorName}</span>
                  {b && (
                    <span style={{
                      fontSize: 8, fontWeight: 900, background: b.bg, color: b.color,
                      border: `1px solid ${b.border}`, padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                    }}>{b.label}</span>
                  )}
                </div>
                <div style={{
                  fontSize: isMobile ? 11 : 13, color: "rgba(228,234,255,0.93)",
                  lineHeight: 1.45, wordBreak: "break-word",
                }}>{msg.text}</div>
              </div>
            </div>
            {isNewest && (
              <div style={{ height: 2, background: "rgba(255,255,255,0.04)" }}>
                <div style={{
                  height: "100%", borderRadius: 1,
                  background: `linear-gradient(90deg,${ac},${ac}77)`,
                  animation: `toast-shrink ${EXPIRE_MS}ms linear forwards`,
                }} />
              </div>
            )}
          </div>
        );
      })}
      <style>{`@keyframes toast-shrink { from{width:100%;} to{width:0%;} }`}</style>
    </div>
  );
}
/* ─── News overlays ─── */

type NewsProps = { text: string; title?: string; logo?: string; color?: string; isMobile?: boolean; yPct?: number; speed?: number; };

function TickerScroll({ text, speed = 30, color = "#fff", fontSize = 14, fontWeight = 600, separator = "   ◆   " }: {
  text: string; speed?: number; color?: string; fontSize?: number; fontWeight?: number; separator?: string;
}) {
  const unit = `${text}${separator}`;
  const spanRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dur, setDur] = useState(20);

  useEffect(() => {
    if (!spanRef.current || !containerRef.current) return;
    const spanW = spanRef.current.offsetWidth || 1;
    const containerW = containerRef.current.offsetWidth || 600;
    // Match backend formula: W / (speed * 0.4 + 4) px/s
    const pxPerSec = containerW / (speed * 0.4 + 4);
    setDur(Math.max(3, spanW / pxPerSec));
  }, [text, speed, fontSize, fontWeight]);

  return (
    <>
      <style>{`
        @keyframes nt-ticker { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes nt-pulse  { 0%,100%{opacity:1} 50%{opacity:0.2} }
      `}</style>
      <div ref={containerRef} style={{ overflow: "hidden", flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
        <div key={`${text}|${speed}`} style={{ display: "flex", flexShrink: 0, animation: `nt-ticker ${dur}s linear infinite`, willChange: "transform" }}>
          <span ref={spanRef} style={{ whiteSpace: "nowrap", fontSize, fontWeight, color }}>{unit}</span>
          <span style={{ whiteSpace: "nowrap", fontSize, fontWeight, color }}>{unit}</span>
        </div>
      </div>
    </>
  );
}

function NewsAlJazeera({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#cc0001";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 44 : 52;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, display: "flex", alignItems: "stretch", height: h, background: "#000", borderTop: `3px solid ${c}` }}>
      <div style={{ display: "flex", alignItems: "center", padding: `0 ${isMobile ? 10 : 16}px`, gap: 8, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)", minWidth: isMobile ? 60 : 90, justifyContent: "center" }}>
        {logo
          ? <img src={logo} alt="" style={{ height: isMobile ? 26 : 34, maxWidth: isMobile ? 52 : 74, objectFit: "contain" }} />
          : <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, color: "#fff", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{title || "LIVE"}</span>}
      </div>
      <div style={{ background: c, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, gap: 5, flexShrink: 0 }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", animation: "nt-pulse 1s infinite" }} />
        <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 9 : 11, letterSpacing: "0.08em" }}>LIVE</span>
      </div>
      <TickerScroll text={text} speed={speed} color="#fff" fontSize={isMobile ? 12 : 14} />
    </div>
  );
}

function NewsCNN({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#cc0001";
  const [flash, setFlash] = useState(false);
  useEffect(() => { const t = setInterval(() => setFlash(v => !v), 800); return () => clearInterval(t); }, []);
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 44 : 52;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "stretch", background: "#0d0d0d" }}>
      <div style={{ background: "#000", borderLeft: `4px solid ${c}`, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 14}px`, flexShrink: 0, gap: 6, justifyContent: "center", minWidth: isMobile ? 56 : 80 }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 22 : 28, objectFit: "contain" }} />
          : <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 13 : 17, letterSpacing: "0.01em" }}>{title || "NEWS"}</span>}
      </div>
      <div style={{ background: flash ? c : "#8b0000", transition: "background 0.5s", display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, gap: 4, flexShrink: 0 }}>
        <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 8 : 10, textTransform: "uppercase", letterSpacing: "0.1em" }}>⚡ BREAKING</span>
      </div>
      <TickerScroll text={text} speed={speed} color="#f0f0f0" fontSize={isMobile ? 11 : 13} />
    </div>
  );
}

function NewsBBC({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#0057ff";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 50 : 58;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "stretch", background: "#1a1a2e" }}>
      <div style={{ background: c, display: "flex", alignItems: "center", justifyContent: "center", padding: `0 ${isMobile ? 10 : 18}px`, flexShrink: 0 }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 24 : 30, objectFit: "contain" }} />
          : <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 13 : 18, fontFamily: "Georgia, serif" }}>{title || "NEWS"}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: `0 ${isMobile ? 10 : 16}px`, flex: 1, overflow: "hidden", gap: 3 }}>
        <div style={{ fontSize: isMobile ? 9 : 10, color: c, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Coverage</div>
        <TickerScroll text={text} speed={speed} color="#fff" fontSize={isMobile ? 12 : 14} fontWeight={700} separator="  ·  " />
      </div>
    </div>
  );
}

function NewsBloomberg({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#f59e0b";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 40 : 48;
  const [time, setTime] = useState(() => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  useEffect(() => { const t = setInterval(() => setTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 10000); return () => clearInterval(t); }, []);
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "stretch", background: "#0c0c0c", borderTop: `2px solid ${c}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: `0 ${isMobile ? 8 : 14}px`, flexShrink: 0, borderRight: `1px solid ${c}30` }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 20 : 26, objectFit: "contain" }} />
          : <span style={{ color: c, fontWeight: 700, fontSize: isMobile ? 11 : 13, fontFamily: "monospace", letterSpacing: "0.06em" }}>{title || "FINANCE"}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: isMobile ? 10 : 11, fontFamily: "monospace" }}>{time}</span>
      </div>
      <TickerScroll text={text} speed={speed} color="rgba(255,255,255,0.88)" fontSize={isMobile ? 11 : 13} fontWeight={500} separator="  |  " />
    </div>
  );
}

function NewsSkyNews({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#0ea5e9";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 44 : 52;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "stretch" }}>
      <div style={{ background: `linear-gradient(135deg, ${c} 0%, #0369a1 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: `0 ${isMobile ? 10 : 16}px`, flexShrink: 0, minWidth: isMobile ? 64 : 90 }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 24 : 30, objectFit: "contain" }} />
          : <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 11 : 14, letterSpacing: "0.04em" }}>{title || "SKY NEWS"}</span>}
      </div>
      <div style={{ flex: 1, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", borderTop: `2px solid ${c}` }}>
        <TickerScroll text={text} speed={speed} color="#fff" fontSize={isMobile ? 12 : 14} />
      </div>
    </div>
  );
}

function NewsNeonWire({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#00ff88";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 42 : 50;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "stretch", background: "rgba(0,4,16,0.97)", borderTop: `2px solid ${c}`, boxShadow: `0 -6px 24px ${c}35` }}>
      <div style={{ display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 14}px`, gap: 6, flexShrink: 0, borderRight: `1px solid ${c}30`, justifyContent: "center" }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 22 : 28, objectFit: "contain", filter: `drop-shadow(0 0 4px ${c})` }} />
          : <span style={{ color: c, fontWeight: 900, fontSize: isMobile ? 10 : 12, letterSpacing: "0.1em", textShadow: `0 0 10px ${c}`, fontFamily: "monospace" }}>{title || "WIRE"}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", paddingLeft: 10, flexShrink: 0, gap: 3 }}>
        {[8, 14, 10, 16, 9].map((h2, i) => (
          <div key={i} style={{ width: 2.5, height: h2, borderRadius: 2, background: c, opacity: 0.8, animation: `nt-pulse ${0.4 + i * 0.1}s ease-in-out infinite alternate` }} />
        ))}
      </div>
      <TickerScroll text={text} speed={speed} color={c} fontSize={isMobile ? 11 : 13} fontWeight={600} />
    </div>
  );
}

function NewsFloatGlass({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#667eea";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 10;
  const h = isMobile ? 46 : 54;
  return (
    <div style={{ position: "fixed", bottom, left: isMobile ? 8 : 24, right: isMobile ? 8 : 24, zIndex: 30, height: h, display: "flex", alignItems: "stretch", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.08)", backdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.14)", boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${c}20` }}>
      <div style={{ display: "flex", alignItems: "center", padding: `0 ${isMobile ? 10 : 16}px`, gap: 6, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)", justifyContent: "center" }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 24 : 30, objectFit: "contain" }} />
          : <span style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? 11 : 13 }}>{title || "NEWS"}</span>}
      </div>
      <div style={{ width: 3, background: `linear-gradient(180deg, ${c}, ${c}80)`, flexShrink: 0 }} />
      <TickerScroll text={text} speed={speed} color="rgba(255,255,255,0.92)" fontSize={isMobile ? 12 : 14} fontWeight={600} />
    </div>
  );
}

function NewsSportsFlash({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#f59e0b";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const badgeW = isMobile ? 100 : 130;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: isMobile ? 44 : 52, display: "flex", alignItems: "stretch", background: "#000", overflow: "hidden" }}>
      <div style={{ background: c, position: "absolute", left: 0, top: 0, bottom: 0, width: badgeW, clipPath: "polygon(0 0,90% 0,100% 100%,0 100%)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 22 : 28, objectFit: "contain", marginRight: 20 }} />
          : <span style={{ color: "#000", fontWeight: 900, fontSize: isMobile ? 10 : 13, letterSpacing: "0.04em", marginRight: 20 }}>{title || "SPORT"}</span>}
      </div>
      <div style={{ marginLeft: badgeW + 10, flex: 1, display: "flex", alignItems: "center", overflow: "hidden" }}>
        <TickerScroll text={text} speed={speed} color="#fff" fontSize={isMobile ? 12 : 14} separator="  ◆  " />
      </div>
    </div>
  );
}

function NewsCinematic({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#e2c97e";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 42 : 50;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "center", background: "#000", padding: `0 ${isMobile ? 14 : 28}px`, gap: 16 }}>
      {(logo || title) && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, paddingRight: 16, borderRight: `1px solid ${c}30` }}>
          {logo ? <img src={logo} alt="" style={{ height: isMobile ? 22 : 28, objectFit: "contain", opacity: 0.88 }} />
            : <span style={{ color: c, fontSize: isMobile ? 11 : 14, fontFamily: "Georgia, serif", letterSpacing: "0.12em", fontWeight: 400 }}>{title}</span>}
        </div>
      )}
      <TickerScroll text={text} speed={speed} color={c} fontSize={isMobile ? 12 : 14} fontWeight={400} separator="   —   " />
    </div>
  );
}

function NewsGoldLuxury({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#d4a842";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 48 : 58;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "stretch", background: "linear-gradient(180deg, #0e0c07 0%, #1c1708 100%)", borderTop: `1px solid ${c}55` }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: `0 ${isMobile ? 10 : 20}px`, flexShrink: 0, borderRight: `1px solid ${c}22`, gap: 3 }}>
        {logo ? <img src={logo} alt="" style={{ height: isMobile ? 26 : 34, objectFit: "contain" }} />
          : <>
              <span style={{ color: c, fontWeight: 700, fontSize: isMobile ? 8 : 9, letterSpacing: "0.18em", textTransform: "uppercase" }}>{title || "EXCLUSIVE"}</span>
              <div style={{ height: 1, background: `linear-gradient(90deg, ${c}, transparent)`, width: "100%" }} />
            </>}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", overflow: "hidden" }}>
        <TickerScroll text={text} speed={speed} color={c} fontSize={isMobile ? 12 : 14} fontWeight={500} separator="  ✦  " />
      </div>
    </div>
  );
}

function NewsMinimal({ text, title, logo, color, isMobile, yPct, speed }: NewsProps) {
  const c = color || "#ffffff";
  const bottom = yPct !== undefined ? `${100 - yPct}%` : 0;
  const h = isMobile ? 36 : 42;
  return (
    <div style={{ position: "fixed", bottom, left: 0, right: 0, zIndex: 30, height: h, display: "flex", alignItems: "center", background: "rgba(0,0,0,0.88)", borderTop: "1px solid rgba(255,255,255,0.10)", gap: 12, padding: `0 ${isMobile ? 10 : 18}px` }}>
      {(logo || title) && (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, paddingRight: 12, borderRight: "1px solid rgba(255,255,255,0.1)" }}>
          {logo ? <img src={logo} alt="" style={{ height: isMobile ? 18 : 22, objectFit: "contain", opacity: 0.85 }} />
            : <span style={{ color: "rgba(255,255,255,0.5)", fontSize: isMobile ? 9 : 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>{title}</span>}
        </div>
      )}
      <TickerScroll text={text} speed={speed} color={c} fontSize={isMobile ? 11 : 13} fontWeight={400} separator="   ·   " />
    </div>
  );
}


/* ─── API-driven news overlay renderer ─── */

function NewsOverlayRenderer({ overlay, isMobile, newsScale }: { overlay: NewsOverlayLive; isMobile: boolean; newsScale?: number }) {
  const yPct = overlay.layout?.position?.y ?? 95;
  const bottom = `${100 - yPct}%`;
  const c = overlay.customColors?.primary || "#cc0001";
  const bg = overlay.customColors?.background || "rgba(4,4,12,0.96)";
  const textColor = overlay.customColors?.text || "#ffffff";
  const font = overlay.customFont;
  const scale = (newsScale ?? 100) / 100;
  const h = Math.round((isMobile ? 38 : 46) * scale);
  const tickerText = overlay.tickerMessages?.length
    ? overlay.tickerMessages.map((m) => m.text).join(`  ${overlay.ticker?.separator || "◆"}  `)
    : overlay.headline?.text || "";
  const speed = overlay.ticker?.speed ?? 30;
  const logo = overlay.logo;
  const label = overlay.liveBadge?.label || "LIVE";
  const badge = overlay.liveBadge?.visible !== false;
  const fontSize = (font?.size || 14) * (isMobile ? 0.82 : 1);

  const theme = overlay.theme || "Al Jazeera";

  const breakingActive = overlay.breakingNews?.active;
  const displayText = breakingActive && overlay.breakingNews?.overridesTicker
    ? overlay.breakingNews.text
    : tickerText;

  const logoEl = logo
    ? <img src={logo} alt="" style={{ height: isMobile ? 22 : 28, maxWidth: isMobile ? 54 : 72, objectFit: "contain" }} />
    : null;

  const themeStyles: Record<string, React.ReactNode> = {
    "Al Jazeera": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h }}>
        <div style={{ background: "#000", display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 14}px`, gap: 8, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)", borderTop: `3px solid ${c}`, minWidth: isMobile ? 60 : 76, justifyContent: "center" }}>
          {logoEl ?? <span style={{ fontSize: isMobile ? 8 : 10, fontWeight: 900, color: "#fff", letterSpacing: "0.05em" }}>{overlay.liveBadge?.label || "LIVE"}</span>}
        </div>
        {badge && <div style={{ background: c, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 6 : 10}px`, gap: 5, flexShrink: 0, borderTop: `3px solid ${c}` }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", animation: overlay.liveBadge?.pulse ? "nov-badge-pulse 1.2s infinite" : "none" }} />
          <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 7 : 9, letterSpacing: "0.08em" }}>{label}</span>
        </div>}
        <TickerScroll text={displayText} speed={speed} color={textColor} fontSize={fontSize} fontWeight={font?.weight || 600} />
      </div>
    ),
    "CNN": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "#0d0d0d" }}>
        <div style={{ background: "#000", borderLeft: `4px solid ${c}`, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0, gap: 6, minWidth: isMobile ? 50 : 60 }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 10 : 14 }}>CNN</span>}
        </div>
        {breakingActive && <div style={{ background: c, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 6 : 10}px`, flexShrink: 0 }}>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 7 : 9, letterSpacing: "0.1em" }}>⚡ BREAKING</span>
        </div>}
        <TickerScroll text={displayText} speed={speed} color="#f0f0f0" fontSize={fontSize} fontWeight={font?.weight || 700} />
      </div>
    ),
    "BBC": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "#1a1a2e" }}>
        <div style={{ background: c, display: "flex", alignItems: "center", justifyContent: "center", padding: `0 ${isMobile ? 10 : 14}px`, flexShrink: 0 }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 10 : 14, fontFamily: "Georgia, serif" }}>BBC</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: `0 ${isMobile ? 8 : 12}px`, flex: 1, overflow: "hidden", gap: 2 }}>
          {badge && <div style={{ fontSize: isMobile ? 7 : 9, color: c, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Coverage</div>}
          <TickerScroll text={displayText} speed={speed} color={textColor} fontSize={fontSize} fontWeight={font?.weight || 700} separator="  ·  " />
        </div>
      </div>
    ),
    "Bloomberg": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "#0c0c0c", borderTop: `2px solid ${c}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0, borderRight: `1px solid ${c}30` }}>
          {logoEl ?? <span style={{ color: c, fontWeight: 700, fontSize: isMobile ? 9 : 11, fontFamily: "monospace" }}>{label}</span>}
        </div>
        <TickerScroll text={displayText} speed={speed} color="rgba(255,255,255,0.88)" fontSize={fontSize} fontWeight={font?.weight || 500} separator="  |  " />
      </div>
    ),
    "Fox": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "#000033", borderTop: `3px solid ${c}` }}>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0 }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 7 : 9, letterSpacing: "0.1em" }}>FOX NEWS ALERT</span>}
        </div>
        <TickerScroll text={displayText} speed={speed} color="#fff" fontSize={fontSize} fontWeight={font?.weight || 800} />
      </div>
    ),
    "Sky News": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h }}>
        <div style={{ background: `linear-gradient(135deg, ${c} 0%, #0369a1 100%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: `0 ${isMobile ? 10 : 14}px`, flexShrink: 0, minWidth: isMobile ? 64 : 80 }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 8 : 11 }}>SKY NEWS</span>}
        </div>
        <div style={{ flex: 1, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", borderTop: `2px solid ${c}` }}>
          <TickerScroll text={displayText} speed={speed} color={textColor} fontSize={fontSize} fontWeight={font?.weight || 600} />
        </div>
      </div>
    ),
    "CNBC": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "#000022", borderTop: `2px solid ${c}` }}>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 10 : 14}px`, flexShrink: 0 }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 10 : 12 }}>CNBC</span>}
        </div>
        <TickerScroll text={displayText} speed={speed} color={textColor} fontSize={fontSize} fontWeight={font?.weight || 700} />
      </div>
    ),
    "Dark": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "rgba(10,10,20,0.97)", border: "1px solid rgba(99,102,241,0.4)" }}>
        <div style={{ background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0 }}>
          {logoEl ?? <span style={{ color: "#a5b4fc", fontWeight: 700, fontSize: isMobile ? 8 : 10, letterSpacing: "0.08em" }}>{label}</span>}
        </div>
        <TickerScroll text={displayText} speed={speed} color="rgba(255,255,255,0.9)" fontSize={fontSize} fontWeight={font?.weight || 600} />
      </div>
    ),
    "Glass": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "rgba(255,255,255,0.08)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: isMobile ? 6 : 8, overflow: "hidden" }}>
        {badge && <div style={{ display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)" }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? 9 : 11 }}>{label}</span>}
        </div>}
        <div style={{ width: 3, background: `linear-gradient(180deg, ${c}, ${c}80)`, flexShrink: 0 }} />
        <TickerScroll text={displayText} speed={speed} color="rgba(255,255,255,0.92)" fontSize={fontSize} fontWeight={font?.weight || 600} />
      </div>
    ),
    "Modern": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "rgba(0,4,16,0.97)", borderTop: `2px solid ${c}`, boxShadow: `0 -4px 16px ${c}30` }}>
        <div style={{ display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 12}px`, flexShrink: 0, borderRight: `1px solid ${c}30` }}>
          {logoEl ?? <span style={{ color: c, fontWeight: 900, fontSize: isMobile ? 8 : 10, letterSpacing: "0.1em", fontFamily: "monospace" }}>WIRE</span>}
        </div>
        <TickerScroll text={displayText} speed={speed} color={c} fontSize={fontSize} fontWeight={font?.weight || 700} />
      </div>
    ),
    "Minimal": (
      <div style={{ display: "flex", alignItems: "center", width: "100%", height: h, background: "rgba(0,0,0,0.88)", borderTop: "1px solid rgba(255,255,255,0.1)", gap: 12, padding: `0 ${isMobile ? 10 : 14}px` }}>
        {badge && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.1)", paddingRight: isMobile ? 8 : 10 }}>
            {logoEl ?? <span style={{ color: "rgba(255,255,255,0.4)", fontSize: isMobile ? 7 : 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>}
          </div>
        )}
        <TickerScroll text={displayText} speed={speed} color={textColor} fontSize={fontSize} fontWeight={font?.weight || 400} separator="   ·   " />
      </div>
    ),
    "Election": (
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", height: h, background: "#0f172a", borderTop: `3px solid ${c}`, boxShadow: "0 -4px 20px rgba(239,68,68,0.3)" }}>
        <div style={{ background: c, display: "flex", alignItems: "center", padding: `0 ${isMobile ? 8 : 14}px`, flexShrink: 0 }}>
          {logoEl ?? <span style={{ color: "#fff", fontWeight: 900, fontSize: isMobile ? 7 : 9, letterSpacing: "0.12em" }}>ELECTION NIGHT</span>}
        </div>
        <TickerScroll text={displayText} speed={speed} color="#f8fafc" fontSize={fontSize} fontWeight={font?.weight || 800} separator="  ★  " />
      </div>
    ),
  };

  const overlayEl = themeStyles[theme] ?? themeStyles["Al Jazeera"];

  const animPreset = overlay.headline?.animation || "Fade";
  const ANIM_CSS: Record<string, string> = {
    "None":        "",
    "Fade":        "nov-fade 0.5s ease both",
    "Slide Up":    "nov-slideup 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Slide Down":  "nov-slidedown 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Slide Left":  "nov-slideleft 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Slide Right": "nov-slideright 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Zoom":        "nov-zoom 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Elastic":     "nov-elastic 0.7s cubic-bezier(0.22,1,0.36,1) both",
    "Bounce":      "nov-bounce 0.7s ease both",
    "Flip":        "nov-flip 0.45s cubic-bezier(0.22,1,0.36,1) both",
    "Typewriter":  "nov-typewriter 0.8s steps(25,end) both",
    "Blur":        "nov-blur 0.5s ease both",
    "Glitch":      "nov-glitch 0.6s ease both",
    "Pulse":       "nov-pulse-in 0.5s ease both",
    "Flash":       "nov-flash 0.55s ease both",
  };

  return (
    <>
      <style>{`
        @keyframes nov-badge-pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes nov-fade        { from{opacity:0} to{opacity:1} }
        @keyframes nov-slideup     { from{transform:translateY(100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes nov-slidedown   { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes nov-slideleft   { from{transform:translateX(60px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes nov-slideright  { from{transform:translateX(-60px);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes nov-zoom        { from{transform:scale(0.85);opacity:0} to{transform:scale(1);opacity:1} }
        @keyframes nov-elastic     { 0%{transform:translateY(60px);opacity:0} 55%{transform:translateY(-8px);opacity:1} 75%{transform:translateY(4px)} 90%{transform:translateY(-2px)} 100%{transform:translateY(0)} }
        @keyframes nov-bounce      { 0%{transform:translateY(50px);opacity:0} 45%{transform:translateY(-10px);opacity:1} 65%{transform:translateY(5px)} 82%{transform:translateY(-3px)} 100%{transform:translateY(0)} }
        @keyframes nov-flip        { from{transform:scaleY(0);opacity:0;transform-origin:bottom} to{transform:scaleY(1);opacity:1;transform-origin:bottom} }
        @keyframes nov-typewriter  { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0% 0 0)} }
        @keyframes nov-blur        { from{filter:blur(14px);opacity:0} to{filter:blur(0);opacity:1} }
        @keyframes nov-glitch      { 0%{transform:translateX(0);opacity:0} 8%{transform:translateX(-10px);opacity:1} 16%{transform:translateX(10px)} 24%{transform:translateX(-5px)} 32%{transform:translateX(5px)} 40%{transform:translateX(-2px)} 50%{transform:translateX(0)} 100%{transform:translateX(0);opacity:1} }
        @keyframes nov-pulse-in    { 0%{transform:scale(0.94);opacity:0} 50%{transform:scale(1.03);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes nov-flash       { 0%{filter:brightness(4);opacity:0.2} 25%{filter:brightness(1.6);opacity:1} 45%{filter:brightness(2.2)} 65%{filter:brightness(1.1)} 100%{filter:brightness(1);opacity:1} }
      `}</style>
      <div
        key={overlay.headline?.currentIndex ?? 0}
        style={{
          position: "fixed", bottom, left: 0, right: 0, zIndex: 30,
          opacity: overlay.opacity ?? 1,
          background: bg,
          animation: ANIM_CSS[animPreset] ?? "",
          willChange: animPreset !== "None" ? "transform, opacity" : undefined,
        }}
      >
        {overlayEl}
      </div>
    </>
  );
}

/* ─── Ad overlays ─── */

function BannerAd({ text, sub, isMobile }: { text: string; sub: string; isMobile?: boolean }) {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 40,
      animation: "slide-down 0.5s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <div style={{
        background: "linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
        padding: isMobile ? "10px 12px" : "14px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14, minWidth: 0, flex: 1, overflow: "hidden" }}>
          {!isMobile && <span style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 9, fontWeight: 900, padding: "3px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0 }}>📣 AD</span>}
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div style={{ color: "#fff", fontSize: isMobile ? 13 : 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: isMobile ? 10 : 12, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
          </div>
        </div>
        <button style={{ background: "#fff", color: "#764ba2", border: "none", borderRadius: 8, padding: isMobile ? "5px 10px" : "8px 20px", fontWeight: 800, fontSize: isMobile ? 11 : 13, cursor: "pointer", flexShrink: 0 }}>
          {isMobile ? "Tap →" : "Learn More →"}
        </button>
      </div>
      <style>{`@keyframes slide-down { from{opacity:0;transform:translateY(-100%);} to{opacity:1;transform:translateY(0);} }`}</style>
    </div>
  );
}

function CornerAd({ text, isMobile }: { text: string; isMobile?: boolean }) {
  return (
    <div style={{
      position: "fixed", top: isMobile ? 50 : 70, right: isMobile ? 8 : 24, zIndex: 40,
      animation: "corner-pop 0.5s cubic-bezier(0.34,1.56,0.64,1)",
      maxWidth: isMobile ? "calc(100vw - 16px)" : 260,
    }}>
      <div style={{
        background: "linear-gradient(135deg, #f6d365, #fda085)",
        borderRadius: 14, padding: isMobile ? "8px 12px" : "12px 16px",
        display: "flex", alignItems: "center", gap: 8,
        boxShadow: "0 8px 32px rgba(246,211,101,0.45)",
        animation: "corner-float 3s ease-in-out infinite",
        overflow: "hidden",
      }}>
        <span style={{ fontSize: isMobile ? 18 : 22, flexShrink: 0 }}>🎉</span>
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <div style={{ color: "#fff", fontSize: isMobile ? 12 : 13, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: isMobile ? 9 : 10 }}>Limited time only</div>
        </div>
      </div>
      <style>{`
        @keyframes corner-pop { from{opacity:0;transform:scale(0.7) rotate(-8deg);} to{opacity:1;transform:scale(1) rotate(0);} }
        @keyframes corner-float { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-4px);} }
      `}</style>
    </div>
  );
}

function FullscreenAd({ text, sub }: { text: string; sub: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 40,
      background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fade-in 0.6s ease",
    }}>
      <div style={{
        position: "absolute", top: "20%", left: "15%",
        width: 300, height: 300, borderRadius: "50%",
        background: "rgba(102,126,234,0.12)",
        animation: "orb-float 6s ease-in-out infinite",
      }} />
      <div style={{ textAlign: "center", position: "relative", padding: "0 40px" }}>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 16 }}>— Advertisement —</div>
        <div style={{ color: "#fff", fontSize: 36, fontWeight: 900, marginBottom: 10, lineHeight: 1.1 }}>{text}</div>
        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 15, marginBottom: 28 }}>{sub}</div>
        <button style={{
          background: "linear-gradient(90deg, #667eea, #f093fb)",
          color: "#fff", border: "none", borderRadius: 12,
          padding: "14px 36px", fontWeight: 800, fontSize: 15, cursor: "pointer",
          boxShadow: "0 8px 32px rgba(102,126,234,0.45)",
        }}>Get Started</button>
      </div>
      <style>{`
        @keyframes fade-in { from{opacity:0;} to{opacity:1;} }
        @keyframes orb-float { 0%,100%{transform:translate(0,0);} 50%{transform:translate(20px,15px);} }
      `}</style>
    </div>
  );
}

function StripAd({ text, isMobile }: { text: string; isMobile?: boolean }) {
  return (
    <div style={{
      position: "fixed", bottom: isMobile ? 44 : 50, left: 0, right: 0, zIndex: 40,
      animation: "slide-up 0.5s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <div style={{
        background: "linear-gradient(90deg, #11998e, #38ef7d)",
        padding: isMobile ? "8px 12px" : "12px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        boxShadow: "0 -4px 24px rgba(56,239,125,0.3)",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", flex: 1 }}>
          <span style={{ fontSize: isMobile ? 16 : 20, flexShrink: 0 }}>🛍️</span>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? 12 : 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
        </div>
        <button style={{ background: "rgba(255,255,255,0.25)", color: "#fff", border: "1px solid rgba(255,255,255,0.4)", borderRadius: 8, padding: isMobile ? "4px 10px" : "6px 16px", fontWeight: 800, fontSize: isMobile ? 11 : 12, cursor: "pointer", flexShrink: 0 }}>Tap Here</button>
      </div>
      <style>{`@keyframes slide-up { from{opacity:0;transform:translateY(100%);} to{opacity:1;transform:translateY(0);} }`}</style>
    </div>
  );
}

/* ─── Break overlays ─── */

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split(/[?&]/)[0];
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/embed/")[1].split(/[?&]/)[0];
      if (u.pathname.startsWith("/live/")) return u.pathname.split("/live/")[1].split(/[?&]/)[0];
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1].split(/[?&]/)[0];
      return u.searchParams.get("v");
    }
  } catch {}
  return null;
}

function getYouTubeEmbedUrl(url: string): string | null {
  const id = getYouTubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function CountdownBreak({ text, style: bStyle, videoUrl, videoMuted, videoMode, bgGradient1, bgGradient2, panX = 50, panY = 50 }: { text: string; style: string; videoUrl?: string; videoMuted?: boolean; videoMode?: string; bgGradient1?: string; bgGradient2?: string; panX?: number; panY?: number }) {
  const [secs, setSecs] = useState(300);
  useEffect(() => {
    const t = setInterval(() => setSecs((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(secs / 60);
  const s = secs % 60;

  if (bStyle === "Video" || bStyle === "Video Play") {
    const mode = videoMode ?? "fullscreen";
    const g1 = bgGradient1 ?? "#667eea";
    const g2 = bgGradient2 ?? "#764ba2";
    const containerBg =
      mode === "live-bg" ? "transparent" :
      mode === "gradient-bg" ? `linear-gradient(135deg, ${g1}, ${g2})` :
      "#000";

    if (!videoUrl) {
      return (
        <div style={{
          position: "fixed", inset: 0, zIndex: 50, background: containerBg,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          animation: "fade-in 0.5s ease",
        }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>▶</div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, letterSpacing: "0.05em" }}>No break video uploaded yet</div>
          <style>{`@keyframes fade-in { from{opacity:0;} to{opacity:1;} }`}</style>
        </div>
      );
    }

    const youtubeEmbedUrl = getYouTubeEmbedUrl(videoUrl);

    if (youtubeEmbedUrl) {
      const embedSrc = `${youtubeEmbedUrl}?autoplay=1&loop=1&playlist=${getYouTubeVideoId(videoUrl)}&mute=${videoMuted ? 1 : 0}&controls=0&modestbranding=1&rel=0`;
      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: containerBg, overflow: "hidden", animation: "fade-in 0.5s ease" }}>
          {/*
            Cover-fill trick: the YouTube player maintains 16:9 inside the iframe.
            To make it reach all four edges on any screen shape we size the iframe
            so its 16:9 content is always >= 100vw AND >= 100vh simultaneously:
              width  = max(100vw, 100vh * 16/9)
              height = max(100vh, 100vw *  9/16)
            then centre it and shift by panX/Y so the user can choose which part
            of the video is visible (only meaningful when one axis overflows).
          */}
          <iframe
            key={videoUrl}
            src={embedSrc}
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{
              position: "absolute",
              width: "max(100vw, calc(100vh * 16 / 9))",
              height: "max(100vh, calc(100vw * 9 / 16))",
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + ${(panX - 50) * -0.3}%), calc(-50% + ${(panY - 50) * -0.3}%))`,
              border: "none",
              display: "block",
            }}
          />
          <style>{`@keyframes fade-in { from{opacity:0;} to{opacity:1;} }`}</style>
        </div>
      );
    }

    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 50, background: containerBg, animation: "fade-in 0.5s ease" }}>
        <video
          key={videoUrl}
          src={videoUrl}
          autoPlay
          loop
          muted={!!videoMuted}
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${panX}% ${panY}%`, background: "transparent", display: "block" }}
        />
        <style>{`@keyframes fade-in { from{opacity:0;} to{opacity:1;} }`}</style>
      </div>
    );
  }

  if (bStyle === "Neon") {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 50, background: "#040408",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        animation: "fade-in 0.5s ease",
      }}>
        <div style={{
          fontSize: 80, fontWeight: 900, fontVariantNumeric: "tabular-nums",
          color: "#00fff0",
          textShadow: "0 0 20px #00fff0, 0 0 60px #00fff0, 0 0 120px rgba(0,255,240,0.5)",
          animation: "neon-flicker 4s linear infinite",
          letterSpacing: "-0.02em",
        }}>
          {m}:{s.toString().padStart(2, "0")}
        </div>
        <div style={{ color: "#00fff0", fontSize: 16, fontWeight: 700, marginTop: 12, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.2em" }}>
          {text}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {[0,1,2,3,4].map((i) => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#00fff0", boxShadow: "0 0 8px #00fff0", animation: `dot-bounce 1.2s ease-in-out ${i * 0.12}s infinite` }} />
          ))}
        </div>
        <style>{`
          @keyframes neon-flicker { 0%,19%,21%,23%,25%,54%,56%,100%{opacity:1;} 20%,24%,55%{opacity:0.6;} }
          @keyframes dot-bounce { 0%,80%,100%{transform:scale(0.8);opacity:0.4;} 40%{transform:scale(1.2);opacity:1;} }
          @keyframes fade-in { from{opacity:0;} to{opacity:1;} }
        `}</style>
      </div>
    );
  }

  if (bStyle === "Glass") {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "linear-gradient(135deg, #4158d0 0%, #c850c0 46%, #ffcc70 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fade-in 0.5s ease",
      }}>
        <div style={{
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(32px)",
          border: "1px solid rgba(255,255,255,0.2)", borderRadius: 24,
          padding: "48px 64px", textAlign: "center",
        }}>
          <div style={{ fontSize: 20, marginBottom: 16 }}>☕</div>
          <div style={{ fontSize: 72, fontWeight: 900, color: "#fff", marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
            {m}:{s.toString().padStart(2, "0")}
          </div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 16 }}>{text}</div>
        </div>
        <style>{`@keyframes fade-in { from{opacity:0;} to{opacity:1;} }`}</style>
      </div>
    );
  }

  if (bStyle === "Wave") {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "linear-gradient(180deg, #0f2027, #203a43, #2c5364)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        overflow: "hidden", animation: "fade-in 0.5s ease",
      }}>
        {[0,1,2].map((i) => (
          <div key={i} style={{
            position: "absolute", bottom: -30, left: "-10%", right: "-10%",
            height: 80, borderRadius: "50%",
            background: `rgba(44,83,100,${0.7 - i * 0.2})`,
            animation: `wave ${2.5 + i * 0.6}s ease-in-out ${i * 0.3}s infinite`,
          }} />
        ))}
        <div style={{ position: "relative", textAlign: "center" }}>
          <div style={{ fontSize: 80, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {m}:{s.toString().padStart(2, "0")}
          </div>
          <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 16, marginTop: 8 }}>{text}</div>
        </div>
        <style>{`
          @keyframes wave { 0%,100%{transform:translateY(0) scaleX(1);} 50%{transform:translateY(-18px) scaleX(1.05);} }
          @keyframes fade-in { from{opacity:0;} to{opacity:1;} }
        `}</style>
      </div>
    );
  }

  if (bStyle === "Minimal") {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "#0a0a12",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
        animation: "fade-in 0.5s ease",
      }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, animation: "slow-spin 8s linear infinite" }}>
          ☕
        </div>
        <div style={{ fontSize: 72, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {m}:{s.toString().padStart(2, "0")}
        </div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 15 }}>{text}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.4)", animation: `dot-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
        <style>{`
          @keyframes slow-spin { from{transform:rotate(0);} to{transform:rotate(360deg);} }
          @keyframes dot-bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4;} 40%{transform:translateY(-6px);opacity:1;} }
          @keyframes fade-in { from{opacity:0;} to{opacity:1;} }
        `}</style>
      </div>
    );
  }

  // Default (Countdown)
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      background: "linear-gradient(135deg, #0f0c29, #302b63)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      animation: "fade-in 0.5s ease",
    }}>
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 16 }}>Taking a short break</div>
      <div style={{ fontSize: 90, fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums", textShadow: "0 0 60px rgba(102,126,234,0.5)", letterSpacing: "-0.02em" }}>
        {m}:{s.toString().padStart(2, "0")}
      </div>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, marginTop: 14 }}>{text}</div>
      <div style={{ marginTop: 24, width: 200, background: "rgba(255,255,255,0.1)", borderRadius: 100, height: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 100, background: "linear-gradient(90deg,#667eea,#a78bfa)", width: `${(secs / 300) * 100}%`, transition: "width 1s linear" }} />
      </div>
      <style>{`@keyframes fade-in { from{opacity:0;} to{opacity:1;} }`}</style>
    </div>
  );
}

/* ─── Stats bar ─── */

function StatsBar({ subs, viewers, pos, isMobile }: {
  subs: string | null; viewers: string | null;
  pos?: OverlayPosition; isMobile?: boolean;
}) {
  if (!subs && !viewers) return null;
  const posStyle: React.CSSProperties = pos
    ? { left: `${pos.x}%`, top: `${pos.y}%` }
    : { top: 16, left: 16 };
  return (
    <div style={{
      position: "fixed", ...posStyle, zIndex: 20,
      display: "flex", gap: 5, flexWrap: "wrap", maxWidth: isMobile ? "calc(100vw - 32px)" : undefined,
    }}>
      <div style={{
        background: "rgba(0,0,0,0.85)", backdropFilter: "blur(14px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 9, padding: isMobile ? "4px 10px" : "6px 14px",
        display: "flex", alignItems: "center", gap: 7,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#e53e3e", boxShadow: "0 0 7px #e53e3e", animation: "sb-pulse 1.2s infinite", flexShrink: 0 }} />
        <span style={{ color: "#fff", fontSize: isMobile ? 10 : 11, fontWeight: 800, letterSpacing: "0.05em" }}>LIVE</span>
        <style>{`@keyframes sb-pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }`}</style>
      </div>
      {subs && (
        <div style={{
          background: "rgba(0,0,0,0.85)", backdropFilter: "blur(14px)",
          border: "1px solid rgba(167,139,250,0.3)", borderRadius: 9,
          padding: isMobile ? "4px 10px" : "6px 14px",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ color: "#a78bfa", fontSize: isMobile ? 12 : 14, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{subs}</span>
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: isMobile ? 9 : 10 }}>subs</span>
        </div>
      )}
      {viewers && (
        <div style={{
          background: "rgba(0,0,0,0.85)", backdropFilter: "blur(14px)",
          border: "1px solid rgba(52,211,153,0.3)", borderRadius: 9,
          padding: isMobile ? "4px 10px" : "6px 14px",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ color: "#34d399", fontSize: isMobile ? 12 : 14, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{viewers}</span>
          <span style={{ color: "rgba(255,255,255,0.45)", fontSize: isMobile ? 9 : 10 }}>viewers</span>
        </div>
      )}
    </div>
  );
}

/* ─── Subscriber count overlay (stage page) ─── */

const SUBS_KEYFRAMES = `
  @keyframes subs-pop    { from{opacity:0;transform:translateY(6px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
  @keyframes subs-slide  { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
  @keyframes subs-scale  { from{opacity:0;transform:scale(0.88)} to{opacity:1;transform:scale(1)} }
  @keyframes subs-pulse  { 0%,100%{opacity:1} 50%{opacity:0.45} }
  @keyframes subs-border { 0%,100%{box-shadow:0 0 18px rgba(204,0,1,0.12),0 4px 20px rgba(0,0,0,0.6)} 50%{box-shadow:0 0 28px rgba(204,0,1,0.28),0 4px 20px rgba(0,0,0,0.6)} }
`;

function SubsDisplay({ subs, subsStyle, pos, isMobile }: {
  subs: string | null; subsStyle: string;
  pos?: OverlayPosition; isMobile?: boolean;
}) {
  if (!subs) return null;
  const sm = !!isMobile;
  const posStyle: React.CSSProperties = pos
    ? { position: "fixed", left: `${pos.x}%`, top: `${pos.y}%`, zIndex: 20 }
    : { position: "fixed", top: sm ? 12 : 20, right: sm ? 8 : 80, zIndex: 20 };

  /* ── Minimal: floating text, no card ── */
  if (subsStyle === "Minimal") {
    return (
      <div style={{ ...posStyle, animation: "subs-pop 0.35s ease-out" }}>
        <div style={{
          color: "#fff", fontWeight: 900, fontSize: sm ? 18 : 26,
          fontVariantNumeric: "tabular-nums", letterSpacing: "-0.025em", lineHeight: 1,
          textShadow: "0 2px 14px rgba(0,0,0,0.95), 1px 1px 0 rgba(0,0,0,0.9)",
        }}>{subs}</div>
        <div style={{
          color: "rgba(255,255,255,0.5)", fontSize: sm ? 8 : 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.12em", marginTop: sm ? 2 : 3,
          textShadow: "0 1px 6px rgba(0,0,0,0.9)",
        }}>subscribers</div>
        <style>{SUBS_KEYFRAMES}</style>
      </div>
    );
  }

  /* ── HUD: compact strip with red left bar ── */
  if (subsStyle === "HUD") {
    return (
      <div style={{ ...posStyle, display: "flex", alignItems: "stretch", animation: "subs-slide 0.3s ease-out" }}>
        <div style={{ width: sm ? 3 : 4, background: "#cc0001", borderRadius: "2px 0 0 2px", flexShrink: 0 }} />
        <div style={{
          background: "rgba(8,8,10,0.93)", backdropFilter: "blur(10px)",
          padding: sm ? "5px 10px" : "7px 14px",
          display: "flex", alignItems: "center", gap: sm ? 6 : 8,
          borderRadius: "0 4px 4px 0",
        }}>
          <div style={{
            color: "#fff", fontWeight: 900, fontSize: sm ? 13 : 17,
            fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
          }}>{subs}</div>
          <div style={{
            color: "rgba(255,255,255,0.38)", fontSize: sm ? 8 : 9, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.1em",
          }}>SUBS</div>
        </div>
        <style>{SUBS_KEYFRAMES}</style>
      </div>
    );
  }

  /* ── Goal: progress bar toward milestone ── */
  if (subsStyle === "Goal") {
    return (
      <div style={{
        ...posStyle, animation: "subs-pop 0.35s ease-out",
        background: "rgba(8,8,10,0.95)", backdropFilter: "blur(14px)",
        borderRadius: sm ? 8 : 10, overflow: "hidden",
        minWidth: sm ? 148 : 190, border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
      }}>
        <div style={{ height: 3, background: "#cc0001", width: "100%" }} />
        <div style={{ padding: sm ? "8px 12px 10px" : "10px 16px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: sm ? 5 : 7 }}>
            <div style={{
              color: "#fff", fontWeight: 900, fontSize: sm ? 20 : 26,
              fontVariantNumeric: "tabular-nums", letterSpacing: "-0.025em", lineHeight: 1,
            }}>{subs}</div>
            <div style={{ color: "#cc0001", fontWeight: 800, fontSize: sm ? 9 : 10, letterSpacing: "0.08em" }}>LIVE</div>
          </div>
          <div style={{
            height: sm ? 4 : 5, background: "rgba(255,255,255,0.1)",
            borderRadius: 3, overflow: "hidden", marginBottom: sm ? 5 : 6,
          }}>
            <div style={{
              height: "100%", width: "73%",
              background: "linear-gradient(90deg,#cc0001 0%,#ff3333 100%)",
              borderRadius: 3,
            }} />
          </div>
          <div style={{
            color: "rgba(255,255,255,0.32)", fontSize: sm ? 8 : 9,
            textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700,
          }}>subscribers</div>
        </div>
        <style>{SUBS_KEYFRAMES}</style>
      </div>
    );
  }

  /* ── Card: YouTube-style channel badge ── */
  if (subsStyle === "Card") {
    const iconSize = sm ? 38 : 50;
    const triW = Math.round(iconSize * 0.36);
    const triH = Math.round(iconSize * 0.42);
    return (
      <div style={{
        ...posStyle, animation: "subs-scale 0.4s cubic-bezier(0.34,1.56,0.64,1)",
        background: "rgba(8,8,10,0.95)", backdropFilter: "blur(20px)",
        borderRadius: sm ? 10 : 14, overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.65), 0 0 0 1px rgba(204,0,1,0.12)",
      }}>
        <div style={{ height: 2, background: "#cc0001" }} />
        <div style={{ display: "flex", alignItems: "center", gap: sm ? 10 : 14, padding: sm ? "10px 14px" : "13px 18px" }}>
          <div style={{
            width: iconSize, height: iconSize, borderRadius: "50%", background: "#cc0001",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: "0 2px 10px rgba(204,0,1,0.45)",
          }}>
            <div style={{
              width: 0, height: 0,
              borderTop: `${triH / 2}px solid transparent`,
              borderBottom: `${triH / 2}px solid transparent`,
              borderLeft: `${triW}px solid #fff`,
              marginLeft: Math.round(iconSize * 0.07),
            }} />
          </div>
          <div>
            <div style={{
              color: "rgba(255,255,255,0.4)", fontSize: sm ? 9 : 10, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: sm ? 2 : 3,
            }}>subscribers</div>
            <div style={{
              color: "#fff", fontWeight: 900, fontSize: sm ? 22 : 30,
              fontVariantNumeric: "tabular-nums", letterSpacing: "-0.025em", lineHeight: 1,
            }}>{subs}</div>
          </div>
        </div>
        <style>{SUBS_KEYFRAMES}</style>
      </div>
    );
  }

  /* ── Animated: pulsing YouTube Live badge (default) ── */
  return (
    <div style={{
      ...posStyle, animation: "subs-scale 0.4s cubic-bezier(0.34,1.56,0.64,1), subs-border 2.8s ease-in-out 0.5s infinite",
      background: "rgba(8,8,10,0.95)", backdropFilter: "blur(20px)",
      borderRadius: sm ? 10 : 14, overflow: "hidden",
      border: "1px solid rgba(204,0,1,0.28)",
      minWidth: sm ? 104 : 136, textAlign: "center",
    }}>
      <div style={{ height: 3, background: "#cc0001", width: "100%" }} />
      <div style={{ padding: sm ? "10px 16px 12px" : "14px 22px 16px" }}>
        <div style={{
          color: "#fff", fontWeight: 900, fontSize: sm ? 26 : 36,
          fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", lineHeight: 1,
        }}>{subs}</div>
        <div style={{
          color: "rgba(255,255,255,0.38)", fontSize: sm ? 9 : 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.1em", marginTop: sm ? 5 : 7,
        }}>subscribers</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: sm ? 6 : 8 }}>
          <div style={{
            width: sm ? 6 : 7, height: sm ? 6 : 7, borderRadius: "50%",
            background: "#cc0001", animation: "subs-pulse 1.3s ease-in-out infinite",
          }} />
          <div style={{ color: "#cc0001", fontSize: sm ? 8 : 9, fontWeight: 800, letterSpacing: "0.12em" }}>LIVE</div>
        </div>
      </div>
      <style>{SUBS_KEYFRAMES}</style>
    </div>
  );
}

/* ─── SuperChat QR overlay ─── */

function QRPaystackOverlay({ url, title, size = 200, position, glowIntensity = 0, borderStyle = "solid", animation = "pulse" }: {
  url: string; title: string; size?: number; position?: OverlayPosition;
  glowIntensity?: number; borderStyle?: string; animation?: string;
}) {
  const px = position?.x ?? 85;
  const py = position?.y ?? 20;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=${size * 2}x${size * 2}&data=${encodeURIComponent(url)}&margin=1&color=1a1a1a&bgcolor=ffffff&ecc=M`;

  const glowAmount = glowIntensity / 100;
  const outerGlow = glowAmount > 0 ? `0 0 ${Math.round(glowAmount * 80)}px ${Math.round(glowAmount * 30)}px rgba(255,214,0,${glowAmount * 0.8})` : "";

  const borderMap: Record<string, string> = {
    solid: "4px solid #ffd600",
    glow: `4px solid #ffd600`,
    dashed: "3px dashed #ffd600",
    none: "none",
  };
  const qrImgBorder = borderMap[borderStyle] ?? borderMap.solid;

  const outerBoxShadow = [
    "0 0 0 4px #ffd600",
    "0 20px 80px rgba(0,0,0,0.9)",
    outerGlow,
  ].filter(Boolean).join(", ");

  const animStyle: React.CSSProperties =
    animation === "pulse"
      ? { animation: "qr-drop 0.6s cubic-bezier(0.34,1.56,0.64,1), qr-outer-pulse 2.5s ease-in-out 0.6s infinite" }
      : animation === "float"
      ? { animation: "qr-drop 0.6s cubic-bezier(0.34,1.56,0.64,1), qr-float 3s ease-in-out 0.6s infinite" }
      : { animation: "qr-drop 0.6s cubic-bezier(0.34,1.56,0.64,1)" };

  return (
    <div style={{
      position: "fixed",
      left: `${px}%`, top: `${py}%`,
      transform: "translate(-50%, -50%)",
      zIndex: 45,
      pointerEvents: "none",
      filter: `drop-shadow(0 12px 40px rgba(0,0,0,0.9))`,
      ...animStyle,
    }}>
      <div style={{
        borderRadius: 18,
        overflow: "hidden",
        minWidth: size + 40,
        boxShadow: outerBoxShadow,
      }}>
        {/* Super Chat gold header */}
        <div style={{
          background: "linear-gradient(135deg, #ffd600 0%, #ffaa00 100%)",
          padding: "11px 18px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 22 }}>💛</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#000", letterSpacing: "0.06em", lineHeight: 1.1 }}>SUPER CHAT</div>
            <div style={{ fontSize: 10, color: "rgba(0,0,0,0.55)", fontWeight: 700, letterSpacing: "0.04em" }}>Scan to support the stream</div>
          </div>
        </div>

        {/* QR code body */}
        <div style={{
          background: "#fff",
          padding: "16px 20px 12px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <img
            src={qrSrc}
            width={size}
            height={size}
            alt="Scan to pay"
            style={{ display: "block", borderRadius: 8, border: qrImgBorder }}
            draggable={false}
          />
          {title && (
            <div style={{
              color: "#111", fontSize: 12, fontWeight: 800, textAlign: "center",
              maxWidth: size + 16, lineHeight: 1.35, letterSpacing: "0.01em",
            }}>
              {title}
            </div>
          )}
        </div>

        {/* Gold footer */}
        <div style={{
          background: "linear-gradient(135deg, #ffd600 0%, #ffaa00 100%)",
          padding: "9px 18px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
        }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#000", animation: "qr-pulse 1.4s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, fontWeight: 900, color: "#000", letterSpacing: "0.09em" }}>SCAN TO SEND A SUPER CHAT</span>
        </div>
      </div>
      <style>{`
        @keyframes qr-drop { from{opacity:0;transform:translate(-50%,-65%) scale(0.82);} to{opacity:1;transform:translate(-50%,-50%) scale(1);} }
        @keyframes qr-pulse { 0%,100%{opacity:1;} 50%{opacity:0.25;} }
        @keyframes qr-outer-pulse { 0%,100%{filter:drop-shadow(0 12px 40px rgba(0,0,0,0.9));} 50%{filter:drop-shadow(0 12px 40px rgba(0,0,0,0.9)) drop-shadow(0 0 40px rgba(255,214,0,0.5));} }
        @keyframes qr-float { 0%,100%{transform:translate(-50%,-50%);} 50%{transform:translate(-50%,-55%);} }
      `}</style>
    </div>
  );
}

/* ─── Scan-detected flash overlay (4 s) ─── */

function ScanFlashOverlay() {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 300);
    const t2 = setTimeout(() => setPhase("out"), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90,
      background: "rgba(255,214,0,0.08)",
      backdropFilter: "blur(2px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      opacity: phase === "out" ? 0 : 1,
      transition: phase === "out" ? "opacity 0.5s ease" : "opacity 0.25s ease",
      pointerEvents: "none",
    }}>
      <div style={{
        textAlign: "center",
        opacity: phase === "in" ? 0 : 1,
        transform: phase === "in" ? "scale(0.8) translateY(20px)" : "scale(1) translateY(0)",
        transition: "opacity 0.3s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {/* Super Chat gold badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          background: "linear-gradient(135deg, #ffd600, #ffaa00)",
          borderRadius: 16, padding: "10px 24px",
          boxShadow: "0 0 40px rgba(255,214,0,0.6), 0 8px 32px rgba(0,0,0,0.7)",
          marginBottom: 20,
        }}>
          <span style={{ fontSize: 28 }}>💛</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: "#000", letterSpacing: "0.06em" }}>SUPER CHAT</span>
        </div>
        <div style={{ fontSize: 72, lineHeight: 1, animation: "sf-bob 0.7s ease-in-out infinite alternate" }}>📲</div>
        <div style={{
          marginTop: 18, fontSize: 28, fontWeight: 900, color: "#fff",
          textShadow: "0 0 24px rgba(255,214,0,0.8), 0 2px 8px rgba(0,0,0,0.8)",
          letterSpacing: "-0.01em",
        }}>
          Someone is scanning…
        </div>
        <div style={{
          marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.65)",
          fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        }}>
          Super Chat payment in progress
        </div>
        <div style={{ marginTop: 20, width: 220, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)", overflow: "hidden", margin: "20px auto 0" }}>
          <div style={{ height: "100%", background: "linear-gradient(90deg, #ffd600, #ffaa00)", borderRadius: 2, animation: "sf-scan 1.2s ease-in-out infinite" }} />
        </div>
      </div>
      <style>{`
        @keyframes sf-bob { from{transform:translateY(-5px);} to{transform:translateY(5px);} }
        @keyframes sf-scan { 0%{width:0;margin-left:0;} 50%{width:100%;margin-left:0;} 100%{width:0;margin-left:100%;} }
      `}</style>
    </div>
  );
}

/* ─── Payment received gift popup (6 s) ─── */

function GiftPopupOverlay({ name }: { name: string }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 400);
    const t2 = setTimeout(() => setPhase("out"), 6400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 95,
      display: "flex", alignItems: "flex-end", justifyContent: "flex-start",
      padding: "0 32px 48px",
      pointerEvents: "none",
      opacity: phase === "out" ? 0 : 1,
      transition: phase === "out" ? "opacity 0.6s ease" : "opacity 0.2s ease",
    }}>
      {/* Gold confetti dots */}
      {[...Array(14)].map((_, i) => (
        <div key={i} style={{
          position: "absolute",
          width: i % 3 === 0 ? 14 : 9, height: i % 3 === 0 ? 14 : 9,
          borderRadius: i % 4 === 0 ? 2 : "50%",
          background: ["#ffd600","#ffaa00","#fff","#ffd600","#ffcc00","#ff9500","#ffe066"][i % 7],
          top: `${15 + (i * 41) % 55}%`,
          left: `${5 + (i * 59) % 88}%`,
          opacity: phase === "in" ? 0 : 0.9,
          transform: phase === "in" ? "scale(0) rotate(0deg)" : `scale(1) rotate(${i * 25}deg)`,
          transition: `opacity 0.3s ease ${i * 0.04}s, transform 0.55s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.04}s`,
        }} />
      ))}

      {/* Super Chat card — slides up from bottom-left */}
      <div style={{
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 0 0 4px #ffd600, 0 24px 80px rgba(0,0,0,0.9)",
        minWidth: 320, maxWidth: 400,
        opacity: phase === "in" ? 0 : 1,
        transform: phase === "in" ? "translateY(60px) scale(0.88)" : "translateY(0) scale(1)",
        transition: "opacity 0.4s ease, transform 0.55s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {/* Gold Super Chat header */}
        <div style={{
          background: "linear-gradient(135deg, #ffd600 0%, #ffaa00 100%)",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 36, lineHeight: 1 }}>💛</span>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(0,0,0,0.65)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Super Chat Received!</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#000", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{name}</div>
          </div>
        </div>
        {/* White body */}
        <div style={{
          background: "#fff",
          padding: "14px 20px",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>🎉</span>
          <div style={{ fontSize: 13, color: "#333", fontWeight: 600, lineHeight: 1.45 }}>
            just sent you a <strong style={{ color: "#e69000" }}>Super Chat</strong> via Paystack!<br />
            <span style={{ fontSize: 11, color: "#999", fontWeight: 500 }}>Thank you for your support 🙏</span>
          </div>
        </div>
        {/* Gold footer strip */}
        <div style={{
          background: "linear-gradient(135deg, #ffd600 0%, #ffaa00 100%)",
          padding: "6px 20px",
          fontSize: 9, fontWeight: 800, color: "rgba(0,0,0,0.6)", letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          Powered by Paystack · Live
        </div>
      </div>
      <style>{`
        @keyframes gift-bounce { from{transform:translateY(-5px) rotate(-4deg);} to{transform:translateY(5px) rotate(4deg);} }
      `}</style>
    </div>
  );
}

/* ─── Stage idle screen ─── */

function StageIdle({ connected }: { connected: boolean }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "#0a0a12",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16,
    }}>
      {/* Animated concentric rings */}
      {[160, 120, 80].map((size, i) => (
        <div key={i} style={{
          position: "absolute",
          width: size, height: size, borderRadius: "50%",
          border: `1px solid rgba(229,62,62,${0.08 + i * 0.05})`,
          animation: `idle-ring ${3 + i * 0.8}s ease-in-out ${i * 0.3}s infinite`,
        }} />
      ))}
      <div style={{
        width: 64, height: 64, borderRadius: 20,
        background: "rgba(229,62,62,0.12)", border: "1px solid rgba(229,62,62,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "idle-pulse 2.4s ease-in-out infinite",
        position: "relative", zIndex: 1,
      }}>
        <div style={{ fontSize: 26 }}>📡</div>
      </div>
      <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
          BintuNet Stage
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center" }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: connected ? "#34d399" : "#f59e0b",
            boxShadow: connected ? "0 0 8px #34d399" : "0 0 8px #f59e0b",
            animation: "idle-pulse 1.4s infinite",
          }} />
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
            {connected ? "Connected — waiting for overlays" : "Connecting to Control Room…"}
          </span>
        </div>
      </div>
      <div style={{
        position: "relative", zIndex: 1,
        marginTop: 8, padding: "8px 18px", borderRadius: 10,
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
        color: "rgba(255,255,255,0.3)", fontSize: 11, lineHeight: 1.6, textAlign: "center", maxWidth: 360,
      }}>
        Overlays burn directly into the stream via FFmpeg — viewers see them automatically.<br />
        Controls in the dashboard will push overlays here in real-time.
      </div>
      <style>{`
        @keyframes idle-ring { 0%,100%{transform:scale(1);opacity:0.6;} 50%{transform:scale(1.08);opacity:1;} }
        @keyframes idle-pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
      `}</style>
    </div>
  );
}

/* ─── Main broadcast page ─── */

export default function BroadcastPage() {
  const { state, newsOverlay, chat, stats, scanFlash, giftPopup } = useBroadcastWS();
  const isMobile = useIsMobile();
  const [connected, setConnected] = useState(false);

  // Track connection status
  useEffect(() => {
    if (state !== null) setConnected(true);
  }, [state]);

  const hasOverlay = state?.newsActive || state?.adActive || state?.breakActive || state?.bgGradientActive || state?.qrActive;

  // Transparent bg so it can be used as OBS browser source over a video
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "transparent",
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      overflow: "hidden",
    }}>
      {/* BG gradient — multi-blob atmosphere overlay, visible on any video */}
      {state?.bgGradientActive && !state.breakActive && (
        <>
          {/* Primary blob — top-left */}
          <div style={{
            position: "fixed",
            top: "-20%", left: "-15%",
            width: "70%", height: "70%",
            borderRadius: "50%",
            background: state.bgGradient1,
            opacity: (state.bgGradientOpacity ?? 0.45) * 0.72,
            filter: "blur(80px)",
            transition: "opacity 0.4s ease",
            zIndex: 0,
            pointerEvents: "none",
          }} />
          {/* Secondary blob — bottom-right */}
          <div style={{
            position: "fixed",
            bottom: "-20%", right: "-15%",
            width: "72%", height: "72%",
            borderRadius: "50%",
            background: state.bgGradient2,
            opacity: (state.bgGradientOpacity ?? 0.45) * 0.6,
            filter: "blur(80px)",
            transition: "opacity 0.4s ease",
            zIndex: 0,
            pointerEvents: "none",
          }} />
          {/* Accent blob — centre */}
          <div style={{
            position: "fixed",
            top: "20%", left: "25%",
            width: "50%", height: "56%",
            borderRadius: "50%",
            background: `color-mix(in srgb, ${state.bgGradient1} 50%, ${state.bgGradient2})`,
            opacity: (state.bgGradientOpacity ?? 0.45) * 0.32,
            filter: "blur(80px)",
            transition: "opacity 0.4s ease",
            zIndex: 0,
            pointerEvents: "none",
          }} />
        </>
      )}

      {/* Show idle screen only when no overlays are active and no chat yet */}
      {!hasOverlay && chat.length === 0 && <StageIdle connected={connected} />}
      {/* Stats bar — position from broadcast state when active */}
      {state?.statsActive
        ? <StatsBar
            subs={stats.subs} viewers={stats.viewers}
            pos={isMobile ? state.mobileStatsPosition : state.statsPosition}
            isMobile={isMobile}
          />
        : <StatsBar subs={stats.subs} viewers={stats.viewers} isMobile={isMobile} />
      }

      {/* Subscriber count overlay */}
      {state?.subsOverlayActive && (
        <SubsDisplay
          subs={stats.subs}
          subsStyle={state.subsStyle ?? "Card"}
          pos={isMobile ? state.mobileSubsPosition : state.subsPosition}
          isMobile={isMobile}
        />
      )}

      {/* Chat messages — only rendered when chat burn-in is enabled */}
      {state && state.chatBurnActive && !state.breakActive && !state.adActive && (() => {
        const chatPos = isMobile ? state.mobileChatBurnPosition : state.chatBurnPosition;
        switch (state.chatStyle) {
          case "TV":      return <TVChat messages={chat} isMobile={isMobile} pos={chatPos} />;
          case "Bubble":  return <BubbleChat messages={chat} isMobile={isMobile} />;
          case "Neon":    return <NeonChat messages={chat} isMobile={isMobile} />;
          case "Glass":   return <GlassChat messages={chat} isMobile={isMobile} />;
          case "Compact": return <CompactChat messages={chat} isMobile={isMobile} />;
          case "Toast":   return <ToastChat messages={chat} isMobile={isMobile} />;
          default:        return <TVChat messages={chat} isMobile={isMobile} pos={chatPos} />;
        }
      })()}

      {/* News overlay — API-driven (new system) */}
      {newsOverlay?.active && !state?.breakActive && (
        <NewsOverlayRenderer overlay={newsOverlay} isMobile={isMobile} newsScale={state?.newsScale} />
      )}

      {/* News overlay — legacy broadcast-state system (fallback when API overlay is off) */}
      {!newsOverlay?.active && state?.newsActive && !state.breakActive && !state.adActive && (() => {
        const newsPos = isMobile ? state.mobileNewsPosition : state.newsPosition;
        const np: NewsProps = {
          text: state.newsText,
          title: state.newsTitle,
          logo: state.newsLogo,
          color: state.newsBgColor,
          isMobile,
          yPct: newsPos?.y,
          speed: state.newsScrollSpeed || 30,
        };
        switch (state.newsStyle) {
          case "Al Jazeera":  return <NewsAlJazeera  {...np} />;
          case "CNN":         return <NewsCNN         {...np} />;
          case "BBC":         return <NewsBBC         {...np} />;
          case "Bloomberg":   return <NewsBloomberg   {...np} />;
          case "Sky News":    return <NewsSkyNews     {...np} />;
          case "Neon Wire":   return <NewsNeonWire    {...np} />;
          case "Float Glass": return <NewsFloatGlass  {...np} />;
          case "Sports":      return <NewsSportsFlash {...np} />;
          case "Cinematic":   return <NewsCinematic   {...np} />;
          case "Gold Luxury": return <NewsGoldLuxury  {...np} />;
          case "Minimal":     return <NewsMinimal     {...np} />;
          default:            return <NewsAlJazeera   {...np} />;
        }
      })()}

      {/* Ad overlay */}
      {state?.adActive && !state.breakActive && (() => {
        switch (state.adStyle) {
          case "Banner":     return <BannerAd text={state.adText} sub={state.adSub} isMobile={isMobile} />;
          case "Corner Pop": return <CornerAd text={state.adText} isMobile={isMobile} />;
          case "Fullscreen": return <FullscreenAd text={state.adText} sub={state.adSub} />;
          case "Strip":      return <StripAd text={state.adText} isMobile={isMobile} />;
          case "Card":       return <FullscreenAd text={state.adText} sub={state.adSub} />;
          default:           return <BannerAd text={state.adText} sub={state.adSub} isMobile={isMobile} />;
        }
      })()}

      {/* Break overlay — highest priority */}
      {state?.breakActive && (() => {
        // YouTube video breaks are handled by the persistent preload iframe below — skip here
        const isYtVideo = (state.breakStyle === "Video" || state.breakStyle === "Video Play")
          && !!getYouTubeVideoId(state.breakVideoUrl ?? "");
        if (isYtVideo) return null;
        return (
          <CountdownBreak text={state.breakText} style={state.breakStyle} videoUrl={state.breakVideoUrl} videoMuted={state.breakVideoMuted} videoMode={state.breakVideoMode} bgGradient1={state.bgGradient1} bgGradient2={state.bgGradient2} panX={state.breakVideoPanX ?? 50} panY={state.breakVideoPanY ?? 50} />
        );
      })()}

      {/* ── Persistent YouTube break iframe ─────────────────────────────────
          Pre-loads in the background the moment a breakVideoUrl is saved.
          Toggled visible/hidden via opacity + pointer-events so the iframe
          element is NEVER unmounted — no cold-load delay when break fires.  */}
      {(() => {
        const url = state?.breakVideoUrl;
        if (!url) return null;
        const ytId = getYouTubeVideoId(url);
        if (!ytId) return null;

        const isActive = !!(state?.breakActive
          && (state.breakStyle === "Video" || state.breakStyle === "Video Play"));

        const mode    = state.breakVideoMode ?? "fullscreen";
        const g1      = state.bgGradient1 ?? "#667eea";
        const g2      = state.bgGradient2 ?? "#764ba2";
        const panX    = state.breakVideoPanX ?? 50;
        const panY    = state.breakVideoPanY ?? 50;
        const muted   = state.breakVideoMuted ? 1 : 0;

        const containerBg =
          mode === "live-bg"      ? "transparent" :
          mode === "gradient-bg"  ? `linear-gradient(135deg, ${g1}, ${g2})` :
          "#000";

        // Stable src — only changes if video ID or mute preference changes.
        // iv_load_policy=3 disables video annotations (faster load).
        const embedSrc = `https://www.youtube.com/embed/${ytId}`
          + `?autoplay=1&loop=1&playlist=${ytId}`
          + `&mute=${muted}&controls=0&modestbranding=1&rel=0&iv_load_policy=3&enablejsapi=0`;

        return (
          <div
            style={{
              position: "fixed", inset: 0,
              zIndex: 50,
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? "auto" : "none",
              transition: "opacity 0.4s ease",
              background: containerBg,
              overflow: "hidden",
            }}
          >
            <iframe
              key={ytId}
              src={embedSrc}
              allow="autoplay; encrypted-media"
              allowFullScreen
              style={{
                position: "absolute",
                width: "max(100vw, calc(100vh * 16 / 9))",
                height: "max(100vh, calc(100vw * 9 / 16))",
                left: "50%",
                top: "50%",
                transform: `translate(calc(-50% + ${(panX - 50) * -0.3}%), calc(-50% + ${(panY - 50) * -0.3}%))`,
                border: "none",
                display: "block",
              }}
            />
          </div>
        );
      })()}

      {/* SuperChat QR code overlay */}
      {state?.qrActive && state.qrUrl && !state.breakActive && !scanFlash && !giftPopup && (
        <QRPaystackOverlay
          url={state.qrUrl}
          title={state.qrTitle ?? ""}
          size={state.qrSize ?? 200}
          position={state.qrPosition}
          glowIntensity={state.qrGlowIntensity ?? 0}
          borderStyle={state.qrBorderStyle ?? "solid"}
          animation={state.qrAnimation ?? "pulse"}
        />
      )}

      {/* Scan-detected flash (4 s) */}
      {scanFlash !== null && <ScanFlashOverlay key={scanFlash} />}

      {/* Payment-received gift popup (6 s) */}
      {giftPopup && <GiftPopupOverlay key={giftPopup.ts} name={giftPopup.name} />}

      {/* Watermark */}
      <div style={{
        position: "fixed", bottom: state?.newsActive ? 56 : 8, right: 8,
        color: "rgba(255,255,255,0.25)", fontSize: 9, fontWeight: 600,
        letterSpacing: "0.08em", pointerEvents: "none",
      }}>
        BintuNet Stage
      </div>
    </div>
  );
}
