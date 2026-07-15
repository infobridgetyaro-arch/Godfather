import React, { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Key, AlertTriangle, CheckCircle, XCircle, Clock, Activity, Zap, BarChart2, RotateCcw, Unlock } from "lucide-react";

interface KeyStats {
  index: number;
  masked: string;
  isActive: boolean;
  isExhausted: boolean;
  totalRequests: number;
  requestsLastMinute: number;
  errorsTotal: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMsg: string | null;
  quotaResetAt: number | null;
  healthScore: number;
}

interface DetailedStatus {
  totalKeys: number;
  activeKeyIndex: number;
  allExhausted: boolean;
  quotaResetAt: number | null;
  keys: KeyStats[];
  totalRequestsAllKeys: number;
  totalErrors: number;
  uptimeSec: number;
  eventLog: Array<{ ts: number; type: "rotate" | "exhaust" | "error" | "success"; keyIndex: number; msg: string }>;
}

const REFRESH_MS = 4000;

// Returns ms until quota resets, or 0 if already past.
function msUntilReset(quotaResetAt: number | null): number {
  if (!quotaResetAt) return 0;
  return Math.max(0, quotaResetAt - Date.now());
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 6) + "••••••••" + key.slice(-4);
}

function fmtTime(ms: number | null): string {
  if (!ms) return "—";
  const d = Date.now() - ms;
  if (d < 60000) return `${Math.round(d / 1000)}s ago`;
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`;
  return `${Math.round(d / 3600000)}h ago`;
}

function fmtCountdown(ms: number | null): string {
  if (!ms) return "—";
  const d = ms - Date.now();
  if (d <= 0) return "now";
  const h = Math.floor(d / 3600000);
  const m = Math.floor((d % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function HealthBar({ score }: { score: number }) {
  const color = score > 80 ? "#34d399" : score > 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
        <div style={{
          height: "100%", width: `${score}%`, borderRadius: 2,
          background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          transition: "width 0.5s ease",
          boxShadow: `0 0 6px ${color}66`,
        }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, width: 28, textAlign: "right",
        fontVariantNumeric: "tabular-nums" }}>{score}%</span>
    </div>
  );
}

function StatBadge({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      flex: 1, padding: "8px 10px", borderRadius: 8,
      background: `${color}11`, border: `1px solid ${color}22`,
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.38)",
        textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function KeyCard({ k, onForceRotate, onClearExhaustion }: { k: KeyStats; onForceRotate: (idx: number) => void; onClearExhaustion: (idx: number) => void }) {
  const statusColor = k.isExhausted ? "#ef4444"
    : k.isActive ? "#34d399"
    : "rgba(255,255,255,0.3)";
  const statusLabel = k.isExhausted ? "EXHAUSTED"
    : k.isActive ? "ACTIVE"
    : "STANDBY";
  const statusIcon = k.isExhausted ? <XCircle size={11} />
    : k.isActive ? <CheckCircle size={11} />
    : <Clock size={11} />;

  return (
    <div style={{
      background: k.isActive
        ? "rgba(52,211,153,0.06)"
        : k.isExhausted
        ? "rgba(239,68,68,0.05)"
        : "rgba(255,255,255,0.03)",
      border: `1px solid ${k.isActive ? "rgba(52,211,153,0.2)" : k.isExhausted ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: 12, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: `${statusColor}18`, border: `1px solid ${statusColor}33`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: statusColor, fontSize: 13,
        }}>
          <Key size={13} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.55)",
            fontFamily: "monospace", letterSpacing: "0.04em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {k.masked}
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
            Key #{k.index + 1}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5,
          padding: "3px 8px", borderRadius: 20,
          background: `${statusColor}18`, border: `1px solid ${statusColor}33`,
          fontSize: 9, fontWeight: 800, color: statusColor, letterSpacing: "0.06em" }}>
          {statusIcon}
          {statusLabel}
        </div>
      </div>

      <HealthBar score={k.healthScore} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>TOTAL REQS</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.75)",
            fontVariantNumeric: "tabular-nums" }}>{k.totalRequests.toLocaleString()}</div>
        </div>
        <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>REQ/MIN</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: k.requestsLastMinute > 40 ? "#f59e0b" : "rgba(255,255,255,0.75)",
            fontVariantNumeric: "tabular-nums" }}>{k.requestsLastMinute}</div>
        </div>
        <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>ERRORS</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: k.errorsTotal > 0 ? "#f87171" : "rgba(255,255,255,0.75)",
            fontVariantNumeric: "tabular-nums" }}>{k.errorsTotal}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
        <span>Last OK: <span style={{ color: "rgba(255,255,255,0.55)" }}>{fmtTime(k.lastSuccessAt)}</span></span>
        {k.lastErrorAt && (
          <span>Last err: <span style={{ color: "#f87171" }}>{fmtTime(k.lastErrorAt)}</span></span>
        )}
        {k.isExhausted && k.quotaResetAt && (
          <span>Resets in: <span style={{ color: "#f59e0b" }}>{fmtCountdown(k.quotaResetAt)}</span></span>
        )}
      </div>

      {k.lastErrorMsg && (
        <div style={{
          fontSize: 10, color: "#fca5a5", padding: "5px 8px",
          background: "rgba(239,68,68,0.07)", borderRadius: 6,
          border: "1px solid rgba(239,68,68,0.15)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {k.lastErrorMsg}
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        {!k.isActive && !k.isExhausted && (
          <button
            onClick={() => onForceRotate(k.index)}
            style={{
              padding: "5px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer",
              border: "1px solid rgba(129,140,248,0.3)", background: "rgba(129,140,248,0.1)",
              color: "#a5b4fc", display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <RotateCcw size={10} /> Switch to this key
          </button>
        )}
        {k.isExhausted && (
          <button
            onClick={() => onClearExhaustion(k.index)}
            title="Un-mark this key as exhausted — only use if YouTube's quota dashboard shows quota still available"
            style={{
              padding: "5px 12px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer",
              border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.08)",
              color: "#fbbf24", display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <Unlock size={10} /> Clear Exhaustion
          </button>
        )}
      </div>
    </div>
  );
}

export function YouTubeApiPanel() {
  const [status, setStatus] = useState<DetailedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0); // ticks every second for live countdowns
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const statusRef = useRef<DetailedStatus | null>(null);
  const fetchingRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const r = await fetch("/api/youtube/detailed-status", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setStatus(data);
      statusRef.current = data;
      setLastRefresh(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, REFRESH_MS);
    // 1-second tick to keep countdowns live without re-fetching
    tickRef.current = setInterval(() => {
      setTick(t => t + 1);
      // Auto-refresh when any exhausted key's quota reset time passes
      const s = statusRef.current;
      if (s?.allExhausted && s.quotaResetAt && msUntilReset(s.quotaResetAt) === 0) {
        fetchStatus();
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [fetchStatus]);

  const forceRotate = async (toIndex: number) => {
    try {
      await fetch("/api/youtube/force-rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ index: toIndex }),
      });
      setTimeout(fetchStatus, 300);
    } catch {}
  };

  const clearExhaustion = async (index?: number) => {
    try {
      await fetch("/api/youtube/clear-exhaustion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(index !== undefined ? { index } : {}),
      });
      setTimeout(fetchStatus, 300);
    } catch {}
  };

  if (loading) {
    return (
      <div style={{ padding: "24px 16px", display: "flex", alignItems: "center", justifyContent: "center",
        color: "rgba(255,255,255,0.3)", fontSize: 12, gap: 8 }}>
        <RefreshCw size={14} style={{ animation: "cr-spin 1s linear infinite" }} />
        Loading API status…
      </div>
    );
  }

  if (error || !status) {
    return (
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5",
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Unable to load API status</div>
            <div style={{ opacity: 0.8 }}>{error || "No data"}</div>
            {!status && (
              <div style={{ marginTop: 6, opacity: 0.65, fontSize: 10 }}>
                Set YOUTUBE_API_KEYS=key1,key2,… in environment secrets to enable multi-key management.
              </div>
            )}
          </div>
        </div>
        <button onClick={fetchStatus} style={{
          padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700,
          cursor: "pointer", border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)",
          display: "flex", alignItems: "center", gap: 6, width: "fit-content",
        }}>
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>
            YouTube API Key Pool
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
            {status.totalKeys} key{status.totalKeys !== 1 ? "s" : ""} ·{" "}
            {status.allExhausted
              ? <span style={{ color: "#f87171" }}>All exhausted — resets {fmtCountdown(status.quotaResetAt)}</span>
              : <span style={{ color: "#34d399" }}>Key #{status.activeKeyIndex + 1} active</span>
            }
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
            {lastRefresh ? fmtTime(lastRefresh) : "—"}
          </span>
          {status.allExhausted && (
            <button
              onClick={() => clearExhaustion()}
              title="Un-mark all keys as exhausted — use when YouTube dashboard shows quota is still available"
              style={{
                padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer",
                border: "1px solid rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.1)",
                color: "#fbbf24", display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <Unlock size={10} /> Clear All
            </button>
          )}
          <button
            onClick={fetchStatus}
            style={{
              padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <StatBadge label="Total Reqs" value={status.totalRequestsAllKeys.toLocaleString()} color="#818cf8" />
        <StatBadge label="Errors" value={status.totalErrors} color={status.totalErrors > 0 ? "#f87171" : "#34d399"} />
        <StatBadge label="Keys" value={`${status.keys.filter(k => !k.isExhausted).length}/${status.totalKeys}`} color="#06b6d4" />
      </div>

      {status.allExhausted && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0 }} />
          All API keys exhausted. Quota resets{" "}
          {status.quotaResetAt ? `in ${fmtCountdown(status.quotaResetAt)} (midnight Pacific)` : "at midnight Pacific"}.
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)",
        textTransform: "uppercase", letterSpacing: "0.08em" }}>
        API Keys ({status.totalKeys})
      </div>

      {status.totalKeys === 0 ? (
        <div style={{
          padding: "14px", borderRadius: 10, background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)", fontSize: 11, color: "rgba(255,255,255,0.4)",
          lineHeight: 1.7,
        }}>
          No API keys configured. Set <code style={{ background: "rgba(255,255,255,0.06)",
            padding: "1px 5px", borderRadius: 4, fontFamily: "monospace" }}>YOUTUBE_API_KEYS</code>{" "}
          in Environment Secrets as a comma-separated list of YouTube Data API v3 keys.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {status.keys.map((k) => (
            <KeyCard key={k.index} k={k} onForceRotate={forceRotate} onClearExhaustion={clearExhaustion} />
          ))}
        </div>
      )}

      {status.eventLog.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)",
            textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>
            Event Log
          </div>
          <div style={{
            background: "rgba(0,0,0,0.25)", borderRadius: 10, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {status.eventLog.slice(-12).reverse().map((ev, i) => {
              const col = ev.type === "error" || ev.type === "exhaust" ? "#f87171"
                : ev.type === "rotate" ? "#818cf8"
                : "#34d399";
              const icon = ev.type === "error" || ev.type === "exhaust" ? "⚠"
                : ev.type === "rotate" ? "↻"
                : "✓";
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  padding: "6px 12px",
                  borderBottom: i < status.eventLog.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                }}>
                  <span style={{ fontSize: 10, color: col, flexShrink: 0, width: 14 }}>{icon}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {new Date(ev.ts).toLocaleTimeString()}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", flex: 1,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.msg}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{
        padding: "8px 12px", borderRadius: 8,
        background: "rgba(129,140,248,0.05)", border: "1px solid rgba(129,140,248,0.1)",
        fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.7,
      }}>
        YouTube Data API v3 quota resets daily at midnight Pacific (08:00 UTC).
        Default quota: 10,000 units/day per key. Add more keys to{" "}
        <code style={{ fontFamily: "monospace" }}>YOUTUBE_API_KEYS</code> for automatic rotation.
      </div>
    </div>
  );
}
