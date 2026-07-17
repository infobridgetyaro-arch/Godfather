import { useState, useEffect, useRef } from "react";
import { MessageSquare, Pin, PinOff } from "lucide-react";

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
  superChatAmount?: string | null;
}

interface QueuedMessage extends ChatMessage {
  priority: number;
  addedAt: number;
  entering: boolean;
}

const MAX_VISIBLE = 12;
const BASE_DISPLAY_RATE_MS = 350;

const STYLE_NAMES = ["Live Feed", "Bubble", "Compact", "Ticker"] as const;
type ChatStyle = typeof STYLE_NAMES[number];

function getPriority(msg: ChatMessage): number {
  if (msg.superChatAmount) return 3;
  if (msg.isOwner) return 3;
  if (msg.isMember) return 2;
  if (msg.isModerator) return 1;
  return 0;
}

function getNameColor(_msg: ChatMessage): string {
  // White text for all roles — clean, professional broadcast look
  return "#ffffff";
}

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function getAvatarBg(msg: ChatMessage): string {
  if (msg.superChatAmount || msg.isOwner) return "linear-gradient(135deg,#f59e0b,#fcd34d)";
  if (msg.isModerator) return "linear-gradient(135deg,#6366f1,#a78bfa)";
  if (msg.isMember) return "linear-gradient(135deg,#059669,#34d399)";
  let h = 0;
  for (let i = 0; i < msg.authorName.length; i++) h = (h * 31 + msg.authorName.charCodeAt(i)) % 360;
  return `linear-gradient(135deg,hsl(${h},70%,38%),hsl(${(h + 40) % 360},70%,52%))`;
}

function Avatar({ msg, size = 36 }: { msg: ChatMessage; size?: number }) {
  const [errored, setErrored] = useState(false);
  if (msg.authorPhoto && !errored) {
    return (
      <img
        src={msg.authorPhoto}
        alt={msg.authorName}
        style={{
          width: size, height: size, borderRadius: "50%", flexShrink: 0,
          objectFit: "cover", border: "2px solid rgba(255,255,255,0.1)",
        }}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: getAvatarBg(msg),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 800, color: "#fff",
      border: "2px solid rgba(255,255,255,0.12)",
      letterSpacing: "-0.02em",
    }}>
      {getInitials(msg.authorName)}
    </div>
  );
}

function Badge({ label, bg, color, border }: { label: string; bg: string; color: string; border: string }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 800, padding: "1px 6px", borderRadius: 99,
      background: bg, color, border: `1px solid ${border}`,
      textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function useMessageQueue(incoming: ChatMessage[]) {
  const queueRef = useRef<QueuedMessage[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayed, setDisplayed] = useState<QueuedMessage[]>([]);
  const [queueLen, setQueueLen] = useState(0);

  useEffect(() => {
    const newMsgs = incoming.filter((m) => !seenRef.current.has(m.id));
    if (!newMsgs.length) return;
    newMsgs.forEach((m) => seenRef.current.add(m.id));
    const tagged: QueuedMessage[] = newMsgs.map((m) => ({
      ...m, priority: getPriority(m), addedAt: Date.now(), entering: false,
    }));
    const vip = tagged.filter((m) => m.priority >= 3);
    const others = tagged.filter((m) => m.priority < 3);
    queueRef.current = [...vip, ...queueRef.current, ...others];
    setQueueLen(queueRef.current.length);
  }, [incoming]);

  useEffect(() => {
    const tick = () => {
      if (!queueRef.current.length) return;
      const next = queueRef.current.shift()!;
      const remaining = queueRef.current.length;
      setQueueLen(remaining);
      setDisplayed((prev) => {
        const withNew = [...prev, { ...next, entering: true }];
        const trimmed = withNew.length > MAX_VISIBLE ? withNew.slice(withNew.length - MAX_VISIBLE) : withNew;
        setTimeout(() => {
          setDisplayed((cur) => cur.map((m) => (m.id === next.id ? { ...m, entering: false } : m)));
        }, 400);
        return trimmed;
      });
      const rate = remaining > 30 ? 80 : remaining > 15 ? 150 : remaining > 5 ? 220 : BASE_DISPLAY_RATE_MS;
      intervalRef.current = setTimeout(tick, rate);
    };
    intervalRef.current = setTimeout(tick, BASE_DISPLAY_RATE_MS);
    return () => { if (intervalRef.current) clearTimeout(intervalRef.current); };
  }, []);

  return { displayed, queueLen };
}

// ── Pinned Message Banner ─────────────────────────────────────────────────────
function PinnedBanner({ msg, onUnpin }: { msg: ChatMessage; onUnpin: () => void }) {
  const nameColor = getNameColor(msg);
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: "10px 14px",
      background: "linear-gradient(135deg, rgba(251,191,36,0.13), rgba(245,158,11,0.07))",
      borderBottom: "2px solid rgba(251,191,36,0.35)",
      position: "relative",
      animation: "lf-slide 0.35s cubic-bezier(0.22,1,0.36,1) forwards",
    }}>
      {/* Pin stripe */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
        background: "linear-gradient(to bottom,#fbbf24,#f59e0b)",
        borderRadius: "0 2px 2px 0",
      }} />
      {/* Pin icon */}
      <div style={{
        position: "absolute", top: 8, right: 10,
        display: "flex", alignItems: "center", gap: 5,
      }}>
        <span style={{ fontSize: 9, color: "#fbbf24", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Pinned
        </span>
        <button
          onClick={onUnpin}
          title="Unpin message"
          style={{
            background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.35)",
            borderRadius: 6, padding: "2px 5px", cursor: "pointer", color: "#fbbf24",
            display: "flex", alignItems: "center",
          }}
        >
          <PinOff size={10} />
        </button>
      </div>
      <Avatar msg={msg} size={34} />
      <div style={{ flex: 1, minWidth: 0, paddingRight: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: nameColor, lineHeight: 1 }}>{msg.authorName}</span>
          {msg.superChatAmount && (
            <Badge label={`★ ${msg.superChatAmount}`} bg="rgba(251,191,36,0.18)" color="#fcd34d" border="rgba(251,191,36,0.35)" />
          )}
          {msg.isOwner && !msg.superChatAmount && (
            <Badge label="Owner" bg="rgba(251,191,36,0.18)" color="#fcd34d" border="rgba(251,191,36,0.35)" />
          )}
          {msg.isModerator && (
            <Badge label="Mod" bg="rgba(99,102,241,0.18)" color="#c4b5fd" border="rgba(99,102,241,0.3)" />
          )}
          {msg.isMember && !msg.isOwner && (
            <Badge label="Member" bg="rgba(16,185,129,0.18)" color="#6ee7b7" border="rgba(16,185,129,0.3)" />
          )}
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.92)", wordBreak: "break-word", lineHeight: 1.45 }}>
          {msg.text}
        </div>
      </div>
    </div>
  );
}

// ── Live Feed (StreamYard-style, sky blue) ────────────────────────────────────
function LiveFeedChat({
  messages,
  pinnedMessage,
  onPin,
}: {
  messages: QueuedMessage[];
  pinnedMessage: ChatMessage | null;
  onPin: (msg: ChatMessage | null) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Pinned message lives above the scrollable list */}
      {pinnedMessage && (
        <PinnedBanner msg={pinnedMessage} onUnpin={() => onPin(null)} />
      )}

      <div style={{ minHeight: 200, maxHeight: pinnedMessage ? 320 : 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0, padding: "6px 0" }}>
        {messages.length === 0 && (
          <div style={{ color: "rgba(56,189,248,0.3)", fontSize: 12, textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <MessageSquare size={22} style={{ opacity: 0.3 }} />
            Waiting for messages…
          </div>
        )}
        {messages.map((msg) => {
          const nameColor = getNameColor(msg);
          const isSuperChat = !!(msg.superChatAmount || msg.isOwner);
          const isPinned = pinnedMessage?.id === msg.id;
          return (
            <div
              key={msg.id}
              onClick={() => onPin(isPinned ? null : msg)}
              title={isPinned ? "Click to unpin" : "Click to pin this message"}
              style={{
                display: "flex", gap: 11, alignItems: "flex-start",
                padding: "10px 14px",
                background: isPinned
                  ? "rgba(251,191,36,0.10)"
                  : msg.entering
                  ? isSuperChat ? "rgba(251,191,36,0.12)" : "rgba(14,165,233,0.10)"
                  : isSuperChat ? "rgba(251,191,36,0.06)" : "rgba(14,165,233,0.04)",
                borderBottom: "1px solid rgba(56,189,248,0.06)",
                transition: "background 0.4s ease",
                animation: msg.entering ? "lf-slide 0.35s cubic-bezier(0.22,1,0.36,1) forwards" : "none",
                position: "relative",
                cursor: "pointer",
              }}
            >
              {isSuperChat && (
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "linear-gradient(to bottom,#fbbf24,#f59e0b)", borderRadius: "0 2px 2px 0" }} />
              )}
              {isPinned && (
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "linear-gradient(to bottom,#fbbf24,#f59e0b80)", borderRadius: "0 2px 2px 0" }} />
              )}
              <Avatar msg={msg} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: nameColor, lineHeight: 1 }}>{msg.authorName}</span>
                  {isSuperChat && msg.superChatAmount && (
                    <Badge label={`★ ${msg.superChatAmount}`} bg="rgba(251,191,36,0.18)" color="#fcd34d" border="rgba(251,191,36,0.35)" />
                  )}
                  {msg.isOwner && !msg.superChatAmount && (
                    <Badge label="Owner" bg="rgba(251,191,36,0.18)" color="#fcd34d" border="rgba(251,191,36,0.35)" />
                  )}
                  {msg.isModerator && (
                    <Badge label="Mod" bg="rgba(99,102,241,0.18)" color="#c4b5fd" border="rgba(99,102,241,0.3)" />
                  )}
                  {msg.isMember && !msg.isOwner && (
                    <Badge label="Member" bg="rgba(16,185,129,0.18)" color="#6ee7b7" border="rgba(16,185,129,0.3)" />
                  )}
                </div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.88)", wordBreak: "break-word", lineHeight: 1.45 }}>{msg.text}</div>
              </div>
              {/* Hover pin icon */}
              <div className="pin-hover-icon" style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                opacity: 0, transition: "opacity 0.15s ease",
                color: isPinned ? "#fbbf24" : "rgba(255,255,255,0.3)",
              }}>
                <Pin size={12} />
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
        <style>{`
          @keyframes lf-slide { from{opacity:0;transform:translateY(10px);} to{opacity:1;transform:none;} }
          div[style*="cursor: pointer"]:hover .pin-hover-icon { opacity: 1 !important; }
          div[style*="cursor: pointer"]:hover { background: rgba(14,165,233,0.08) !important; }
        `}</style>
      </div>
    </div>
  );
}

// ── Bubble (rounded cards, coloured border per role) ──────────────────────────
function BubbleChat({ messages }: { messages: QueuedMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  return (
    <div style={{ minHeight: 200, maxHeight: 380, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      {messages.length === 0 && <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, textAlign: "center", padding: "60px 0" }}>No messages yet…</div>}
      {messages.map((msg) => {
        const nameColor = getNameColor(msg);
        return (
          <div key={msg.id} style={{
            display: "flex", gap: 9, alignItems: "flex-start",
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${nameColor}25`,
            borderLeft: `3px solid ${nameColor}`,
            borderRadius: 14, padding: "9px 13px",
            animation: msg.entering ? "bb-in 0.38s cubic-bezier(0.22,1,0.36,1) forwards" : "none",
          }}>
            <Avatar msg={msg} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: nameColor }}>{msg.authorName}</span>
                {msg.superChatAmount && <Badge label={`★ ${msg.superChatAmount}`} bg="rgba(251,191,36,0.15)" color="#fcd34d" border="rgba(251,191,36,0.3)" />}
                {msg.isModerator && <Badge label="Mod" bg="rgba(99,102,241,0.15)" color="#c4b5fd" border="rgba(99,102,241,0.25)" />}
                {msg.isMember && !msg.isOwner && <Badge label="Member" bg="rgba(16,185,129,0.15)" color="#6ee7b7" border="rgba(16,185,129,0.25)" />}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", wordBreak: "break-word", lineHeight: 1.45 }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
      <style>{`@keyframes bb-in { from{opacity:0;transform:translateY(10px) scale(0.97);} to{opacity:1;transform:none;} }`}</style>
    </div>
  );
}

// ── Compact (dense streaming-studio style) ────────────────────────────────────
function CompactChat({ messages }: { messages: QueuedMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  const latest = messages.slice(-MAX_VISIBLE);
  return (
    <div style={{ minHeight: 200, maxHeight: 380, overflowY: "auto" }}>
      <div style={{ padding: "5px 12px 5px 10px", borderBottom: "1px solid rgba(56,189,248,0.1)", display: "flex", alignItems: "center", gap: 6, background: "rgba(14,165,233,0.06)" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "cp-pulse 1.2s infinite" }} />
        <span style={{ fontSize: 9, color: "rgba(56,189,248,0.7)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", flex: 1 }}>Live Chat</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{latest.length}</span>
      </div>
      {latest.length === 0 && <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, textAlign: "center", padding: "40px 0" }}>No messages yet…</div>}
      {latest.map((msg) => {
        const nameColor = getNameColor(msg);
        return (
          <div key={msg.id} style={{
            display: "flex", gap: 8, alignItems: "center",
            padding: "6px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            background: msg.entering ? "rgba(14,165,233,0.08)" : "transparent",
            transition: "background 0.4s",
            animation: msg.entering ? "cp-in 0.28s cubic-bezier(0.22,1,0.36,1) forwards" : "none",
          }}>
            <Avatar msg={msg} size={26} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: nameColor, marginRight: 5 }}>{msg.authorName}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.82)", wordBreak: "break-word" }}>{msg.text}</span>
            </div>
            {msg.superChatAmount && (
              <span style={{ fontSize: 9, fontWeight: 800, color: "#fcd34d", flexShrink: 0 }}>★ {msg.superChatAmount}</span>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
      <style>{`
        @keyframes cp-in { from{opacity:0;transform:translateX(-8px);} to{opacity:1;transform:none;} }
        @keyframes cp-pulse { 0%,100%{opacity:1;} 50%{opacity:0.2;} }
      `}</style>
    </div>
  );
}

// ── Ticker (horizontal scroll for lower-third style display) ──────────────────
function TickerChat({ messages }: { messages: QueuedMessage[] }) {
  const latest = messages.slice(-6);
  if (latest.length === 0) {
    return (
      <div style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>No messages yet…</span>
      </div>
    );
  }
  return (
    <div style={{ overflow: "hidden", height: 56, display: "flex", flexDirection: "column", gap: 6, padding: "6px 12px" }}>
      {latest.slice(-2).map((msg) => {
        const nameColor = getNameColor(msg);
        return (
          <div key={msg.id} style={{
            display: "flex", alignItems: "center", gap: 8,
            animation: msg.entering ? "tk-in 0.35s ease forwards" : "none",
          }}>
            <Avatar msg={msg} size={22} />
            <span style={{ fontSize: 11, fontWeight: 800, color: nameColor, flexShrink: 0 }}>{msg.authorName}:</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.text}</span>
          </div>
        );
      })}
      <style>{`@keyframes tk-in { from{opacity:0;transform:translateY(-8px);} to{opacity:1;transform:none;} }`}</style>
    </div>
  );
}

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  activeStreamId: string | null;
  activeStreamCount: number;
}

const STYLE_ACCENT: Record<ChatStyle, string> = {
  "Live Feed": "#38bdf8",
  "Bubble":    "#a78bfa",
  "Compact":   "#34d399",
  "Ticker":    "#f59e0b",
};

export function ChatPanel({ chatMessages, activeStreamId, activeStreamCount }: ChatPanelProps) {
  const [styleIdx, setStyleIdx] = useState(0);
  const [pinnedMessage, setPinnedMessage] = useState<ChatMessage | null>(null);
  const currentStyle: ChatStyle = STYLE_NAMES[styleIdx];
  const { displayed, queueLen } = useMessageQueue(chatMessages);
  const accent = STYLE_ACCENT[currentStyle];

  const renderChat = () => {
    switch (currentStyle) {
      case "Live Feed": return (
        <LiveFeedChat
          messages={displayed}
          pinnedMessage={pinnedMessage}
          onPin={setPinnedMessage}
        />
      );
      case "Bubble":    return <BubbleChat messages={displayed} />;
      case "Compact":   return <CompactChat messages={displayed} />;
      case "Ticker":    return <TickerChat messages={displayed} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* Style tabs + counters */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {STYLE_NAMES.map((name, i) => {
            const ac = STYLE_ACCENT[name];
            const active = styleIdx === i;
            return (
              <button
                key={name}
                onClick={() => setStyleIdx(i)}
                style={{
                  padding: "4px 12px", borderRadius: 20,
                  border: `1px solid ${active ? ac : "rgba(255,255,255,0.1)"}`,
                  background: active ? `${ac}20` : "transparent",
                  color: active ? ac : "rgba(255,255,255,0.4)",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                  transition: "all 0.18s ease",
                }}
              >{name}</button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {pinnedMessage && currentStyle === "Live Feed" && (
            <div style={{
              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 99, padding: "2px 8px", color: "#fcd34d", fontSize: 10, fontWeight: 700,
              display: "flex", gap: 4, alignItems: "center",
            }}>
              <Pin size={9} />
              1 pinned
            </div>
          )}
          {queueLen > 0 && (
            <div style={{
              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 99, padding: "2px 8px", color: "#fcd34d", fontSize: 10, fontWeight: 700,
              display: "flex", gap: 4, alignItems: "center",
            }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#f59e0b", animation: "pulse 1s infinite" }} />
              {queueLen} queued
            </div>
          )}
          {chatMessages.length > 0 && (
            <div style={{
              background: "rgba(14,165,233,0.1)", border: "1px solid rgba(56,189,248,0.2)",
              borderRadius: 99, padding: "2px 8px", color: "#7dd3fc", fontSize: 10, fontWeight: 700,
            }}>
              {chatMessages.length} total
            </div>
          )}
        </div>
      </div>

      {/* Chat body */}
      {activeStreamCount === 0 ? (
        <div style={{
          height: 120, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 8,
          background: "rgba(14,165,233,0.03)", borderRadius: 14,
          border: "1px solid rgba(56,189,248,0.08)",
        }}>
          <MessageSquare size={20} style={{ color: "rgba(56,189,248,0.2)" }} />
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Chat appears when a stream is live</span>
        </div>
      ) : (
        <div style={{
          borderRadius: 14,
          border: `1px solid ${accent}18`,
          background: "rgba(8,12,24,0.6)",
          overflow: "hidden",
        }}>
          {renderChat()}
        </div>
      )}

      {currentStyle === "Live Feed" && activeStreamCount > 0 && (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
          Click any message to pin it as an announcement
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>
    </div>
  );
}
