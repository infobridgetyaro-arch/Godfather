import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, Loader2, Sparkles, ChevronDown, Trash2, Zap } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  action?: { type: string; params: Record<string, unknown> } | null;
  pending?: boolean;
  error?: boolean;
}

interface AIPanelProps {
  activeStreamCount: number;
}

const QUICK_COMMANDS = [
  { label: "🔴 Go to break",     prompt: "go to break" },
  { label: "▶ Stop break",       prompt: "stop break" },
  { label: "📰 Show news",       prompt: "show news ticker" },
  { label: "📰 Hide news",       prompt: "hide news ticker" },
  { label: "📣 Show ad",         prompt: "enable ad banner" },
  { label: "📣 Hide ad",         prompt: "disable ad banner" },
  { label: "💬 Enable chat",     prompt: "enable chat overlay" },
  { label: "💬 Disable chat",    prompt: "disable chat overlay" },
  { label: "📊 Show stats",      prompt: "enable stats overlay" },
  { label: "📊 Hide stats",      prompt: "disable stats overlay" },
  { label: "🎨 Enable gradient", prompt: "enable background gradient" },
  { label: "🖼 Show logo",       prompt: "enable logo overlay" },
  { label: "🖼 Hide logo",       prompt: "disable logo overlay" },
  { label: "🔇 Mute stream",     prompt: "mute stream audio" },
  { label: "🔊 Unmute stream",   prompt: "unmute stream audio" },
  { label: "🔊 Volume 80%",      prompt: "set volume to 80%" },
  { label: "📺 News: CNN style", prompt: "switch news overlay to CNN style" },
  { label: "📺 News: BBC style", prompt: "switch news overlay to BBC style" },
  { label: "🚨 Breaking news",   prompt: "activate breaking news: Stay tuned for live updates" },
  { label: "🚨 Stop breaking",   prompt: "stop breaking news" },
  { label: "📰 Add ticker",      prompt: "add to news ticker: Welcome to the live stream!" },
  { label: "🗑 Clear ticker",    prompt: "clear all ticker messages" },
  { label: "⏱ Ticker 30s",      prompt: "set ticker loop duration to 30 seconds" },
  { label: "▶ Start stream 1",   prompt: "start stream 1" },
  { label: "⏹ Stop stream 1",    prompt: "stop stream 1" },
  { label: "🔄 Restart stream 1",prompt: "restart stream 1" },
  { label: "❓ What can you do?", prompt: "what can you do" },
];

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // Bold (**text**)
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} style={{ color: "#e2e8f0" }}>{part.slice(2, -2)}</strong>;
      }
      // Italic (*text*)
      const italicParts = part.split(/(\*[^*]+\*)/g).map((p, k) => {
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
          return <em key={k} style={{ color: "#cbd5e1", fontStyle: "italic" }}>{p.slice(1, -1)}</em>;
        }
        return p;
      });
      return <span key={j}>{italicParts}</span>;
    });
    return (
      <span key={i}>
        {parts}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

function ActionBadge({ action }: { action: { type: string; params: Record<string, unknown> } }) {
  const actionLabels: Record<string, string> = {
    go_break: "🔴 Break started",
    stop_break: "▶ Break ended",
    enable_news: "📰 News ticker ON",
    disable_news: "📰 News ticker OFF",
    enable_ad: "📣 Ad banner ON",
    disable_ad: "📣 Ad banner OFF",
    enable_chat: "💬 Chat overlay ON",
    disable_chat: "💬 Chat overlay OFF",
    enable_stats: "📊 Stats ON",
    disable_stats: "📊 Stats OFF",
    enable_subs: "👥 Subs overlay ON",
    disable_subs: "👥 Subs overlay OFF",
    enable_gradient: "🎨 Gradient ON",
    disable_gradient: "🎨 Gradient OFF",
    mute_stream_audio: "🔇 Stream muted",
    unmute_stream_audio: "🔊 Stream unmuted",
    mute_break_video: "🔇 Break video muted",
    unmute_break_video: "🔊 Break video unmuted",
    set_volume: `🔊 Volume → ${action.params.volume}%`,
    set_break_text: "✏️ Break text updated",
    set_break_style: `🎨 Break style → ${action.params.style}`,
    set_news_text: "✏️ Ticker text updated",
    set_news_style: `🎨 Ticker style → ${action.params.style}`,
    set_news_color: "🎨 Ticker color updated",
    set_chat_style: `💬 Chat style → ${action.params.style}`,
    set_gradient: "🎨 Gradient colors updated",
    set_subs_goal: `🎯 Sub goal → ${Number(action.params.goal ?? 0).toLocaleString()}`,
    start_stream: `▶ Stream ${action.params.target} started`,
    stop_stream: `⏹ Stream ${action.params.target} stopped`,
    restart_stream: `🔄 Stream ${action.params.target} restarted`,
    set_ad_text: "✏️ Ad text updated",
    set_ad_sub: "✏️ Ad subtitle updated",
    set_ticker_loop: `⏱ Ticker loop → ${action.params.secs}s`,
    news_overlay_enable: "📺 Advanced news overlay ON",
    news_overlay_disable: "📺 Advanced news overlay OFF",
    news_overlay_set_theme: `📺 News theme → ${action.params.theme}`,
    news_overlay_add_ticker: "📰 Ticker message added",
    news_overlay_clear_ticker: "🗑 Ticker cleared",
    news_overlay_set_headline: "📰 Headline updated",
    news_overlay_breaking: `🚨 Breaking: ${action.params.text}`,
    news_overlay_stop_breaking: "🚨 Breaking news stopped",
    news_overlay_ticker_speed: `📰 Ticker speed → ${action.params.speed}`,
    news_overlay_add_headlines: "📰 Headlines added",
    enable_logo: "🖼 Logo overlay ON",
    disable_logo: "🖼 Logo overlay OFF",
    set_logo_position: `🖼 Logo position → ${action.params.x}%, ${action.params.y}%`,
    set_logo_size: `🖼 Logo size → ${action.params.size}px`,
    set_logo_opacity: `🖼 Logo opacity → ${action.params.opacity}%`,
    set_news_speed: `📰 Ticker speed → ${action.params.speed}`,
    set_screen_mode: `🖥 Screen mode → ${action.params.mode}`,
  };
  const label = actionLabels[action.type] ?? `✅ ${action.type}`;
  return (
    <div style={{
      marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)",
      fontSize: 10, color: "#6ee7b7", fontWeight: 700,
    }}>
      <Zap size={9} />
      {label}
    </div>
  );
}

export function AIPanel({ activeStreamCount }: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "👋 Hi! I'm your AI stream controller. I can control breaks, overlays, chat, audio, and more — just tell me what you need in plain English.\n\nTry: **go to break**, **show news ticker**, **mute stream**, or ask **what can you do**.",
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [pendingContext, setPendingContext] = useState<string | null>(null);
  const [breakTimer, setBreakTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => { if (breakTimer) clearTimeout(breakTimer); };
  }, [breakTimer]);

  const buildHistory = useCallback((msgs: Message[]) => {
    return msgs
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => !m.pending)
      .slice(-12) // keep last 12 turns
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setShowQuick(false);

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: pendingContext ? `${trimmed} [context: ${pendingContext}]` : trimmed,
      ts: Date.now(),
    };
    const thinkingMsg: Message = {
      id: `t-${Date.now()}`,
      role: "assistant",
      content: "…",
      ts: Date.now(),
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setLoading(true);

    try {
      const history = buildHistory(messages);
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg.content,
          history,
        }),
      });

      const data = await res.json();

      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.message ?? "Done!",
        ts: Date.now(),
        action: data.action ?? null,
        error: !!data.error && !data.message,
      };

      setMessages((prev) => [...prev.filter((m) => !m.pending), assistantMsg]);
      setPendingContext(data.pendingContext ?? null);

      // Handle break timer: if AI started a break with a timer param, auto-stop after N mins
      if (data.action?.type === "go_break" && data.action?.params?.timer) {
        const mins = Number(data.action.params.timer);
        if (mins > 0 && mins <= 120) {
          if (breakTimer) clearTimeout(breakTimer);
          const t = setTimeout(async () => {
            try {
              await fetch("/api/ai/chat", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: "stop break [context: auto_timer_end]", history: [] }),
              });
              setMessages((prev) => [...prev, {
                id: `auto-${Date.now()}`,
                role: "assistant",
                content: `⏱ Timer up — break ended automatically after ${mins} minute${mins !== 1 ? "s" : ""}. Stream is live again!`,
                ts: Date.now(),
              }]);
            } catch {}
          }, mins * 60 * 1000);
          setBreakTimer(t);

          // Show countdown notice
          setMessages((prev) => [...prev, {
            id: `timer-notice-${Date.now()}`,
            role: "system",
            content: `⏱ Break timer set — auto-resume in ${mins} minute${mins !== 1 ? "s" : ""}`,
            ts: Date.now(),
          }]);
        }
      }
    } catch (e: any) {
      setMessages((prev) => [...prev.filter((m) => !m.pending), {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ Failed to reach AI: ${e.message ?? "Network error"}`,
        ts: Date.now(),
        error: true,
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loading, messages, pendingContext, buildHistory, breakTimer]);

  const clearChat = () => {
    setMessages([{
      id: "welcome-2",
      role: "assistant",
      content: "Chat cleared. How can I help?",
      ts: Date.now(),
    }]);
    setPendingContext(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 420, maxHeight: 560, gap: 0 }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "0 0 10px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: "linear-gradient(135deg, #7c3aed, #0891b2)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Bot size={14} style={{ color: "#fff" }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 5 }}>
            BintuNet AI
            <span style={{
              fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 10,
              background: "linear-gradient(90deg,#7c3aed,#0891b2)",
              color: "#fff", letterSpacing: "0.05em",
            }}>GPT-4o</span>
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
            {activeStreamCount > 0 ? `${activeStreamCount} stream${activeStreamCount !== 1 ? "s" : ""} live` : "No streams active"}
            {pendingContext && <span style={{ color: "#fbbf24", marginLeft: 6 }}>● waiting for reply</span>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={clearChat} title="Clear chat"
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", padding: 4 }}>
          <Trash2 size={12} />
        </button>
      </div>

      {/* ── Messages ── */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "10px 0", display: "flex", flexDirection: "column", gap: 10,
        scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent",
      }}>
        {messages.map((msg) => {
          if (msg.role === "system") {
            return (
              <div key={msg.id} style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.3)", padding: "2px 0" }}>
                {msg.content}
              </div>
            );
          }
          const isUser = msg.role === "user";
          return (
            <div key={msg.id} style={{
              display: "flex", flexDirection: "column",
              alignItems: isUser ? "flex-end" : "flex-start",
              gap: 4,
            }}>
              <div style={{
                maxWidth: "88%",
                padding: "8px 12px",
                borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                background: isUser
                  ? "linear-gradient(135deg, #7c3aed, #5b21b6)"
                  : msg.error ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
                border: isUser
                  ? "1px solid rgba(124,58,237,0.4)"
                  : msg.error ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(255,255,255,0.07)",
                fontSize: 12,
                color: msg.pending ? "rgba(255,255,255,0.35)" : msg.error ? "#f87171" : "rgba(255,255,255,0.88)",
                lineHeight: 1.55,
              }}>
                {msg.pending ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Loader2 size={11} style={{ animation: "cr-spin 1s linear infinite", color: "#a78bfa" }} />
                    <span>Thinking…</span>
                  </span>
                ) : (
                  isUser
                    ? msg.content.replace(/\s*\[context:[^\]]*\]/g, "")
                    : renderMarkdown(msg.content)
                )}
              </div>
              {msg.action && <ActionBadge action={msg.action} />}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ── Quick Commands ── */}
      {showQuick && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 0 6px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          maxHeight: 90, overflowY: "auto",
        }}>
          {QUICK_COMMANDS.map((cmd) => (
            <button key={cmd.label} onClick={() => sendMessage(cmd.prompt)}
              style={{
                padding: "3px 9px", borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: "pointer",
                border: "1px solid rgba(124,58,237,0.3)",
                background: "rgba(124,58,237,0.1)",
                color: "#c4b5fd",
                transition: "all 0.12s",
                whiteSpace: "nowrap",
              }}>
              {cmd.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Input ── */}
      <div style={{
        display: "flex", gap: 6, alignItems: "center",
        borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10,
      }}>
        <button
          onClick={() => setShowQuick((v) => !v)}
          title="Quick commands"
          style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: showQuick ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${showQuick ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.08)"}`,
            color: showQuick ? "#c4b5fd" : "rgba(255,255,255,0.4)",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Sparkles size={12} />
        </button>

        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder={pendingContext ? "Reply…" : "Tell AI what to do…"}
          disabled={loading}
          style={{
            flex: 1, background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10, padding: "7px 11px",
            color: "#fff", fontSize: 12, outline: "none",
            opacity: loading ? 0.6 : 1,
          }}
        />

        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: loading || !input.trim() ? "rgba(124,58,237,0.15)" : "#7c3aed",
            border: "1px solid rgba(124,58,237,0.4)",
            color: loading || !input.trim() ? "rgba(255,255,255,0.3)" : "#fff",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
          }}
        >
          {loading ? <Loader2 size={13} style={{ animation: "cr-spin 1s linear infinite" }} /> : <Send size={13} />}
        </button>
      </div>

      {/* ── Hints ── */}
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", paddingTop: 6, lineHeight: 1.5 }}>
        Tip: AI controls all overlays in real-time. Say "go to break 10 minutes" for a timed break.
      </div>
    </div>
  );
}
