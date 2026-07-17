import { useState, useEffect, useRef } from "react";
import { Users, Eye, MessageSquare, TrendingUp, Activity, Cpu, MemoryStick, Film, Clock } from "lucide-react";

interface StreamStats {
  subs: string | null;
  viewers: string | null;
  hasChat: boolean;
  error?: "quota" | "not_found" | "api_error" | null;
}

interface ProcStat {
  cpu: number;
  mem: number;
  frames?: number;
  uptime?: number;
}

interface StatsPanelProps {
  streams: Array<{ id: string; status: string; tiktokUsername?: string; youtubeChannelId?: string; sourceType?: string }>;
  streamStats: Record<string, StreamStats>;
  procStats?: Record<string, ProcStat>;
}

function parseNum(val: string | null): number {
  if (!val) return 0;
  const clean = val.replace(/,/g, "");
  if (clean.endsWith("K")) return parseFloat(clean) * 1000;
  if (clean.endsWith("M")) return parseFloat(clean) * 1000000;
  return parseInt(clean, 10) || 0;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatFrames(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatUptime(secs: number): string {
  if (secs <= 0) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function AnimatedNumber({ value, color }: { value: number; color: string }) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    const end = value;
    if (start === end) return;
    prevRef.current = end;
    const dur = 800;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / dur, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(start + (end - start) * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);

  return (
    <span style={{
      fontVariantNumeric: "tabular-nums",
      color,
      fontSize: 28, fontWeight: 900,
      textShadow: `0 0 20px ${color}66`,
    }}>
      {formatNum(displayed)}
    </span>
  );
}

function StatCard({ icon, label, value, color, gradient, loading, error }: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  color: string;
  gradient: string;
  loading: boolean;
  error?: "quota" | "not_found" | "api_error" | null;
}) {
  const numVal = parseNum(value);
  const [prev, setPrev] = useState(numVal);
  const [trend, setTrend] = useState<"up" | "down" | "same">("same");

  useEffect(() => {
    if (numVal > prev) setTrend("up");
    else if (numVal < prev) setTrend("down");
    else setTrend("same");
    setPrev(numVal);
  }, [numVal]);

  return (
    <div style={{
      borderRadius: 14,
      background: `linear-gradient(135deg, ${gradient})`,
      border: "1px solid rgba(255,255,255,0.08)",
      padding: "16px 18px",
      position: "relative", overflow: "hidden",
      flex: 1, minWidth: 110,
    }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: `${color}15` }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ color }}>{icon}</div>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
          </div>
          {trend !== "same" && (
            <div style={{
              fontSize: 9, fontWeight: 800,
              color: trend === "up" ? "#68d391" : "#fc8181",
              background: trend === "up" ? "rgba(104,211,145,0.15)" : "rgba(252,129,129,0.15)",
              padding: "2px 6px", borderRadius: 100,
            }}>
              {trend === "up" ? "▲" : "▼"}
            </div>
          )}
        </div>
        {value !== null ? (
          <AnimatedNumber value={numVal} color={color} />
        ) : loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, opacity: 0.5, animation: "sp-pulse 1.5s infinite" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Fetching…</span>
          </div>
        ) : error === "quota" ? (
          <div style={{ marginTop: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>⚠ Quota exceeded</span>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Resets midnight PT · check Google Cloud Console</div>
          </div>
        ) : error === "not_found" ? (
          <div style={{ marginTop: 2 }}>
            <span style={{ fontSize: 11, color: "rgba(255,100,100,0.8)" }}>Channel not found</span>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Verify the channel ID in stream settings</div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.2)" }}>—</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>No data</span>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveBar({ activeCount, totalSubs, totalViewers }: { activeCount: number; totalSubs: number; totalViewers: number }) {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      borderRadius: 12,
      background: "linear-gradient(90deg, rgba(229,62,62,0.12) 0%, rgba(102,126,234,0.08) 100%)",
      border: "1px solid rgba(229,62,62,0.25)",
      padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#e53e3e", boxShadow: "0 0 8px #e53e3e", animation: "sp-pulse 1.2s infinite" }} />
        <span style={{ color: "#fff", fontWeight: 800, fontSize: 12 }}>
          {activeCount} STREAM{activeCount !== 1 ? "S" : ""} LIVE
        </span>
      </div>
      <div style={{ flex: 1, borderLeft: "1px solid rgba(255,255,255,0.1)", paddingLeft: 12, display: "flex", gap: 16 }}>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
          <span style={{ color: "#a78bfa", fontWeight: 700 }}>{formatNum(totalSubs)}</span> subs
        </span>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
          <span style={{ color: "#34d399", fontWeight: 700 }}>{formatNum(totalViewers)}</span> viewers
        </span>
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {[0,1,2].map((i) => (
          <div key={i} style={{
            width: 3, background: i < dots ? "#34d399" : "rgba(255,255,255,0.15)",
            borderRadius: 2, height: i === 1 ? 12 : 8, transition: "background 0.2s ease",
          }} />
        ))}
      </div>
    </div>
  );
}

function SubChart({ history }: { history: number[] }) {
  if (history.length < 2) return null;
  const max = Math.max(...history);
  const min = Math.min(...history);
  const range = max - min || 1;
  const w = 200; const h = 40;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    return `${x},${y}`;
  }).join(" ");
  return (
    <div style={{ borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", padding: "10px 14px" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <TrendingUp size={10} style={{ color: "#a78bfa" }} /> Subscriber Trend
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={pts} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function CpuGauge({ value }: { value: number }) {
  const color = value > 80 ? "#ef4444" : value > 55 ? "#f59e0b" : "#10b981";
  const segments = 20;
  const filled = Math.round((value / 100) * segments);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Cpu size={11} style={{ color }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>CPU</span>
        </div>
        <span style={{
          fontSize: 13, fontWeight: 800, color, fontVariantNumeric: "tabular-nums",
          textShadow: `0 0 10px ${color}55`,
        }}>{value.toFixed(1)}%</span>
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: i < 4 ? 6 : i < 10 ? 9 : i < 16 ? 11 : 14,
            borderRadius: 2,
            background: i < filled
              ? (i >= 16 ? "#ef4444" : i >= 11 ? "#f59e0b" : "#10b981")
              : "rgba(255,255,255,0.07)",
            transition: "background 0.4s ease",
          }} />
        ))}
      </div>
    </div>
  );
}

function MemBar({ value }: { value: number }) {
  const color = value > 2000 ? "#ef4444" : value > 1000 ? "#f59e0b" : "#60a5fa";
  const maxMem = 4096;
  const pct = Math.min(100, (value / maxMem) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <MemoryStick size={11} style={{ color }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>Memory</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{value} MB</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: `linear-gradient(90deg, #60a5fa, ${color})`,
          borderRadius: 3,
          transition: "width 0.5s ease",
          boxShadow: `0 0 8px ${color}66`,
        }} />
      </div>
    </div>
  );
}

function FrameCounter({ frames }: { frames: number }) {
  const [prev, setPrev] = useState(frames);
  const [fps, setFps] = useState(0);
  const lastFrames = useRef(frames);
  const lastTime = useRef(Date.now());

  useEffect(() => {
    const now = Date.now();
    const dt = (now - lastTime.current) / 1000;
    if (dt > 0 && frames > lastFrames.current) {
      setFps(Math.round((frames - lastFrames.current) / dt));
    }
    lastFrames.current = frames;
    lastTime.current = now;
    setPrev(frames);
  }, [frames]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Film size={11} style={{ color: "#a78bfa" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>Frames</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "#a78bfa", fontVariantNumeric: "tabular-nums" }}>
            {formatFrames(frames)}
          </span>
          {fps > 0 && (
            <span style={{ fontSize: 10, color: "rgba(167,139,250,0.5)", fontVariantNumeric: "tabular-nums" }}>
              @{fps}fps
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 2 }}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 8, borderRadius: 2,
            background: frames > 0
              ? `rgba(167,139,250,${0.15 + (i / 12) * 0.65})`
              : "rgba(255,255,255,0.07)",
            animation: frames > 0 ? `sp-shimmer ${1 + i * 0.08}s ease-in-out infinite alternate` : "none",
          }} />
        ))}
      </div>
    </div>
  );
}

function UptimeBadge({ uptime }: { uptime: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.18)" }}>
      <Clock size={10} style={{ color: "#34d399" }} />
      <span style={{ fontSize: 11, color: "#34d399", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatUptime(uptime)}</span>
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>uptime</span>
    </div>
  );
}

function StreamPerformanceRow({
  label, proc, index,
}: {
  label: string;
  proc: ProcStat;
  index: number;
}) {
  return (
    <div style={{
      borderRadius: 12,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#e53e3e", boxShadow: "0 0 6px #e53e3e", animation: "sp-pulse 1.2s infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
            Stream {index + 1} — {label}
          </span>
        </div>
        {(proc.uptime ?? 0) > 0 && <UptimeBadge uptime={proc.uptime!} />}
      </div>
      <CpuGauge value={proc.cpu} />
      <MemBar value={proc.mem} />
      {(proc.frames ?? 0) > 0 && <FrameCounter frames={proc.frames!} />}
    </div>
  );
}

export function StatsPanel({ streams, streamStats, procStats = {} }: StatsPanelProps) {
  const [subHistory, setSubHistory] = useState<number[]>([]);
  const activeStreams = streams.filter((s) => s.status === "streaming");

  // True once at least one active stream has received a stats WebSocket event
  const statsReceived = activeStreams.some((s) => s.id in streamStats);

  const totalSubs = activeStreams.reduce((acc, s) => acc + parseNum(streamStats[s.id]?.subs ?? null), 0);
  const totalViewers = activeStreams.reduce((acc, s) => acc + parseNum(streamStats[s.id]?.viewers ?? null), 0);
  const totalChatStreams = activeStreams.filter((s) => streamStats[s.id]?.hasChat).length;

  // Derive the most meaningful error across all active streams (quota > not_found > api_error > null)
  const errorPriority = (e: StreamStats["error"]) => e === "quota" ? 3 : e === "not_found" ? 2 : e === "api_error" ? 1 : 0;
  const dominantError: StreamStats["error"] = activeStreams.reduce<StreamStats["error"]>((best, s) => {
    const e = streamStats[s.id]?.error ?? null;
    return errorPriority(e) > errorPriority(best) ? e : best;
  }, null);

  useEffect(() => {
    if (totalSubs > 0) setSubHistory((h) => [...h.slice(-19), totalSubs]);
  }, [totalSubs]);

  const streamsWithProcStats = activeStreams.filter((s) => procStats[s.id]);

  if (activeStreams.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <Activity size={32} style={{ color: "rgba(255,255,255,0.15)", margin: "0 auto 12px" }} />
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Stats appear when a stream is live</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <LiveBar activeCount={activeStreams.length} totalSubs={totalSubs} totalViewers={totalViewers} />

      {/* YouTube audience stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard
          icon={<Users size={14} />}
          label="Subscribers"
          value={totalSubs > 0 ? totalSubs.toString() : null}
          color="#a78bfa"
          gradient="rgba(167,139,250,0.08), rgba(167,139,250,0.03)"
          loading={!statsReceived}
          error={dominantError}
        />
        <StatCard
          icon={<Eye size={14} />}
          label="Viewers"
          value={totalViewers > 0 ? totalViewers.toString() : null}
          color="#34d399"
          gradient="rgba(52,211,153,0.08), rgba(52,211,153,0.03)"
          loading={!statsReceived}
          error={dominantError}
        />
        <StatCard
          icon={<MessageSquare size={14} />}
          label="Chat Active"
          value={totalChatStreams > 0 ? "Active" : null}
          color="#60a5fa"
          gradient="rgba(96,165,250,0.08), rgba(96,165,250,0.03)"
          loading={!statsReceived}
          error={dominantError}
        />
      </div>

      {subHistory.length >= 2 && <SubChart history={subHistory} />}

      {/* FFmpeg encoder performance — one card per live stream */}
      {streamsWithProcStats.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)",
            textTransform: "uppercase", letterSpacing: "0.09em",
          }}>
            <Cpu size={10} />
            Encoder Performance
          </div>
          {streamsWithProcStats.map((s, i) => {
            const p = procStats[s.id]!;
            const label = s.tiktokUsername
              ? `@${s.tiktokUsername}`
              : s.youtubeChannelId
              ? "YouTube"
              : s.sourceType === "camera"
              ? "Camera"
              : "Stream";
            return (
              <StreamPerformanceRow key={s.id} label={label} proc={p} index={i} />
            );
          })}
        </div>
      )}

      {/* Per-stream YouTube breakdown (multi-stream) */}
      {activeStreams.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Per Stream — Audience</div>
          {activeStreams.map((s) => {
            const st = streamStats[s.id];
            return (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "8px 12px", borderRadius: 8,
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#e53e3e", animation: "sp-pulse 1.2s infinite", flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.tiktokUsername ? `@${s.tiktokUsername}` : s.youtubeChannelId ? "YouTube" : "Camera"}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <span style={{ fontSize: 11, color: "#a78bfa", fontVariantNumeric: "tabular-nums" }}>{st?.subs ?? "—"} subs</span>
                  <span style={{ fontSize: 11, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>{st?.viewers ?? "—"} viewers</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes sp-pulse { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
        @keyframes sp-shimmer { from{opacity:0.6;} to{opacity:1;} }
      `}</style>
    </div>
  );
}
