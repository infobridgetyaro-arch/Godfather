import { useState, useEffect, useRef, useCallback } from "react";
import {
  ShieldCheck, ShieldAlert, ShieldOff, ShieldX,
  Clock, Zap, Activity, RefreshCw, AlertTriangle, Loader2,
} from "lucide-react";
import { getAuthToken } from "@/lib/queryClient";

// ── Types (mirrors RecoverySnapshot from stream-manager.ts) ──────────────────

interface CircuitBreakerData {
  state: "closed" | "open" | "probing";
  failuresInWindow: number;
  failureThreshold: number;
  windowMs: number;
  openedAt: number | null;
  cooldownMs: number;
  cooldownRemainingMs: number | null;
  probeInFlight: boolean;
}

interface BackoffData {
  attemptCount: number;
  nextDelayMs: number;
  schedule: number[];
  maxDelayMs: number;
}

interface HealthComponents {
  ffmpegAlive: number;
  bitrateStable: number;
  fpsStable: number;
  reconnectRate: number;
  rtmpErrors: number;
  droppedFrames: number;
}

interface HealthMetrics {
  currentBitrateKbps: number;
  targetBitrateKbps: number;
  currentFps: number;
  reconnectCount: number;
  reconnectsInWindow: number;
  lastRtmpErrorAt: number | null;
  lastUpdatedAt: number;
}

interface HealthSnapshot {
  score: number;
  status: "excellent" | "good" | "warning" | "unstable" | "failed";
  components: HealthComponents;
  metrics: HealthMetrics;
}

interface RecoveryStatusResponse {
  streamId: string;
  timestamp: number;
  circuitBreaker: CircuitBreakerData;
  backoff: BackoffData;
  restartPending: boolean;
  manuallyStopped: boolean;
  isActive: boolean;
  health: HealthSnapshot | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.ceil((ms % 60_000) / 1000);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#84cc16";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function statusLabel(status: HealthSnapshot["status"]): string {
  return { excellent: "Excellent", good: "Good", warning: "Warning", unstable: "Unstable", failed: "Failed" }[status] ?? status;
}

function statusColor(status: HealthSnapshot["status"]): string {
  return { excellent: "#22c55e", good: "#84cc16", warning: "#f59e0b", unstable: "#f97316", failed: "#ef4444" }[status] ?? "#71717a";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(161,161,170,0.7)", marginBottom: 6 }}>
      {children}
    </div>
  );
}

function MetricRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3.5px 0" }}>
      <span style={{ fontSize: 11, color: "rgba(161,161,170,0.85)" }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: accent ?? "#e4e4e7", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function ComponentBar({ label, pts, max, color }: { label: string; pts: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "rgba(161,161,170,0.85)" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{pts}/{max}</span>
      </div>
      <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function CircuitBreakerCard({ cb }: { cb: CircuitBreakerData }) {
  const [remaining, setRemaining] = useState(cb.cooldownRemainingMs ?? 0);

  useEffect(() => {
    setRemaining(cb.cooldownRemainingMs ?? 0);
    if (cb.state !== "open" || !cb.cooldownRemainingMs) return;
    const interval = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [cb.state, cb.cooldownRemainingMs]);

  const isClosed = cb.state === "closed";
  const isProbing = cb.state === "probing";
  const isOpen = cb.state === "open";

  const [bgColor, borderColor, labelColor, ShieldIcon, stateText] = isClosed
    ? ["rgba(34,197,94,0.06)", "rgba(34,197,94,0.25)", "#22c55e", ShieldCheck, "Closed — OK"] as const
    : isProbing
    ? ["rgba(245,158,11,0.06)", "rgba(245,158,11,0.25)", "#f59e0b", ShieldOff, "Probing…"] as const
    : ["rgba(239,68,68,0.08)", "rgba(239,68,68,0.35)", "#ef4444", ShieldX, "Open — Suspended"] as const;

  const pct = cb.cooldownRemainingMs != null && cb.cooldownMs > 0
    ? Math.round(((cb.cooldownMs - (cb.cooldownRemainingMs ?? 0)) / cb.cooldownMs) * 100)
    : 0;

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${borderColor}`, background: bgColor, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isOpen || isProbing ? 8 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <ShieldIcon size={14} style={{ color: labelColor, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: labelColor }}>{stateText}</span>
        </div>
        <span style={{ fontSize: 10, color: "rgba(161,161,170,0.7)" }}>
          {cb.failuresInWindow}/{cb.failureThreshold} failures · {Math.round(cb.windowMs / 60_000)}min window
        </span>
      </div>

      {(isOpen || isProbing) && (
        <>
          <div style={{ fontSize: 11, color: "rgba(161,161,170,0.8)", marginBottom: 6 }}>
            {isOpen
              ? `URL resolution suspended. Cooldown: ${fmtMs(remaining)} remaining`
              : "One probe attempt allowed — waiting for result"}
          </div>
          {isOpen && (
            <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${pct}%`,
                background: "linear-gradient(90deg, #ef4444, #f59e0b)",
                borderRadius: 99, transition: "width 1s linear",
              }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BackoffCard({ backoff, restartPending }: { backoff: BackoffData; restartPending: boolean }) {
  const { attemptCount, nextDelayMs, schedule, maxDelayMs } = backoff;
  const atMax = nextDelayMs >= maxDelayMs;

  return (
    <div style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Zap size={13} style={{ color: attemptCount === 0 ? "#22c55e" : atMax ? "#ef4444" : "#f59e0b", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e4e4e7" }}>
            {attemptCount === 0 ? "No failures" : `Attempt ${attemptCount}`}
          </span>
        </div>
        {restartPending && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#f59e0b", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 99, padding: "2px 7px" }}>
            <RefreshCw size={9} style={{ animation: "spin 1s linear infinite" }} />
            RESTART PENDING
          </span>
        )}
      </div>

      {/* Backoff schedule pill strip */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {schedule.map((delay, i) => {
          const isActive = i === Math.min(attemptCount, schedule.length - 1) && attemptCount > 0;
          const isPast = i < Math.min(attemptCount, schedule.length - 1);
          const isFuture = !isActive && !isPast;
          return (
            <div key={delay} style={{
              fontSize: 10, fontWeight: isActive ? 700 : 500,
              padding: "2px 7px", borderRadius: 99,
              background: isActive ? "rgba(245,158,11,0.15)" : isPast ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.04)",
              border: isActive ? "1px solid rgba(245,158,11,0.5)" : isPast ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.06)",
              color: isActive ? "#fbbf24" : isPast ? "#f87171" : "rgba(161,161,170,0.5)",
              transition: "all 0.2s",
            }}>
              {fmtMs(delay)}{i === schedule.length - 1 ? " (cap)" : ""}
            </div>
          );
        })}
      </div>

      {attemptCount > 0 && (
        <div style={{ marginTop: 7, fontSize: 11, color: "rgba(161,161,170,0.7)" }}>
          Next retry in <span style={{ fontWeight: 700, color: atMax ? "#ef4444" : "#fbbf24" }}>{fmtMs(nextDelayMs)}</span>
          {atMax && <span style={{ color: "#f87171" }}> (max)</span>}
        </div>
      )}
    </div>
  );
}

function HealthCard({ health }: { health: HealthSnapshot }) {
  const { score, status, components, metrics } = health;
  const color = scoreColor(score);
  const sColor = statusColor(status);

  const bars = [
    { label: "FFmpeg alive", pts: components.ffmpegAlive, max: 30 },
    { label: "Bitrate stable", pts: components.bitrateStable, max: 25 },
    { label: "FPS stable", pts: components.fpsStable, max: 15 },
    { label: "Reconnect rate", pts: components.reconnectRate, max: 15 },
    { label: "RTMP errors", pts: components.rtmpErrors, max: 8 },
    { label: "Dropped frames", pts: components.droppedFrames ?? 0, max: 7 },
  ];

  const bitrateOk = metrics.targetBitrateKbps > 0
    ? Math.abs(metrics.currentBitrateKbps - metrics.targetBitrateKbps) / metrics.targetBitrateKbps <= 0.30
    : true;

  return (
    <div style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "10px 12px" }}>
      {/* Score + status row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: 12, color: "rgba(161,161,170,0.5)", fontWeight: 400 }}>/100</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: sColor, background: `${sColor}18`, border: `1px solid ${sColor}40`, borderRadius: 99, padding: "3px 9px" }}>
          {statusLabel(status)}
        </span>
      </div>

      {/* Component bars */}
      <div style={{ marginBottom: 10 }}>
        {bars.map((b) => (
          <ComponentBar
            key={b.label}
            label={b.label}
            pts={b.pts}
            max={b.max}
            color={b.pts === b.max ? "#22c55e" : b.pts === 0 ? "#ef4444" : "#f59e0b"}
          />
        ))}
      </div>

      {/* Live metrics */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
        <MetricRow label="Bitrate" value={`${metrics.currentBitrateKbps} / ${metrics.targetBitrateKbps} kbps`} accent={bitrateOk ? "#22c55e" : "#f59e0b"} />
        <MetricRow label="FPS" value={`${metrics.currentFps.toFixed(1)}`} />
        <MetricRow label="Reconnects (10m)" value={`${metrics.reconnectsInWindow} / 5 max`} accent={metrics.reconnectsInWindow >= 5 ? "#ef4444" : metrics.reconnectsInWindow >= 3 ? "#f59e0b" : "#22c55e"} />
        {metrics.lastRtmpErrorAt && (
          <MetricRow label="Last RTMP error" value={`${Math.round((Date.now() - metrics.lastRtmpErrorAt) / 1000)}s ago`} accent="#f97316" />
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface StreamRecoveryPanelProps {
  streamId: string;
  streamStatus: string;
}

export function StreamRecoveryPanel({ streamId, streamStatus }: StreamRecoveryPanelProps) {
  const [data, setData] = useState<RecoveryStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetch_ = useCallback(async (manual = false) => {
    if (manual) setManualRefreshing(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/streams/${streamId}/recovery-status`, {
        credentials: "include",
        headers,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      const json: RecoveryStatusResponse = await res.json();
      setData(json);
      setLastRefreshed(Date.now());
    } catch (e: any) {
      if (e.name !== "AbortError") console.error("[RecoveryPanel]", e.message);
    } finally {
      setLoading(false);
      if (manual) setManualRefreshing(false);
    }
  }, [streamId]);

  // Initial load + poll every 3s while active, every 10s while idle/error
  useEffect(() => {
    setLoading(true);
    fetch_();
    const isActive = streamStatus === "streaming" || streamStatus === "reconnecting";
    const intervalMs = isActive ? 3_000 : 10_000;
    const id = setInterval(() => fetch_(), intervalMs);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [streamId, streamStatus, fetch_]);

  // Determine whether there's anything interesting to show even in idle state
  const hasState = data && (
    data.backoff.attemptCount > 0 ||
    data.circuitBreaker.state !== "closed" ||
    data.restartPending ||
    data.manuallyStopped ||
    data.isActive
  );

  if (loading && !data) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", color: "rgba(161,161,170,0.5)", fontSize: 11 }}>
        <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
        Loading recovery status…
      </div>
    );
  }

  if (!data || (!hasState && streamStatus === "idle")) return null;

  const cbState = data.circuitBreaker.state;
  const overallAlert = cbState === "open" || data.manuallyStopped;
  const overallWarn = cbState === "probing" || data.backoff.attemptCount > 0 || data.restartPending;

  return (
    <div style={{ padding: "12px 14px 14px", fontSize: 12 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {overallAlert
            ? <ShieldAlert size={14} style={{ color: "#ef4444" }} />
            : overallWarn
            ? <AlertTriangle size={14} style={{ color: "#f59e0b" }} />
            : <ShieldCheck size={14} style={{ color: "#22c55e" }} />
          }
          <span style={{ fontSize: 12, fontWeight: 700, color: overallAlert ? "#ef4444" : overallWarn ? "#fbbf24" : "#22c55e" }}>
            {overallAlert ? "Recovery Alert" : overallWarn ? "Recovery Warning" : "Recovery OK"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data.manuallyStopped && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 99, padding: "2px 7px" }}>
              STOPPED
            </span>
          )}
          {data.isActive && !data.manuallyStopped && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#4ade80", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 99, padding: "2px 7px" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", animation: "pulse 2s ease-in-out infinite", display: "inline-block" }} />
              ACTIVE
            </span>
          )}
          <button
            onClick={() => fetch_(true)}
            disabled={manualRefreshing}
            title={`Last updated ${lastRefreshed ? Math.round((Date.now() - lastRefreshed) / 1000) + "s ago" : "…"}`}
            style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: manualRefreshing ? "default" : "pointer", color: "rgba(161,161,170,0.5)", padding: 2, borderRadius: 4, opacity: manualRefreshing ? 0.5 : 1 }}
          >
            <RefreshCw size={11} style={manualRefreshing ? { animation: "spin 0.7s linear infinite" } : undefined} />
            <span style={{ fontSize: 10 }}>
              {lastRefreshed ? `${Math.round((Date.now() - lastRefreshed) / 1000)}s ago` : "…"}
            </span>
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

        {/* ── Circuit Breaker ── */}
        <div>
          <SectionLabel>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <ShieldCheck size={9} style={{ display: "inline" }} />
              Circuit Breaker
            </span>
          </SectionLabel>
          <CircuitBreakerCard cb={data.circuitBreaker} />
        </div>

        {/* ── Backoff ── */}
        <div>
          <SectionLabel>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Zap size={9} style={{ display: "inline" }} />
              Exponential Backoff
            </span>
          </SectionLabel>
          <BackoffCard backoff={data.backoff} restartPending={data.restartPending} />
        </div>

        {/* ── Health Score ── */}
        {data.health && (
          <div>
            <SectionLabel>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <Activity size={9} style={{ display: "inline" }} />
                Health Score
              </span>
            </SectionLabel>
            <HealthCard health={data.health} />
          </div>
        )}

        {/* ── When scorer has no data (stream not active) ── */}
        {!data.health && data.isActive && (
          <div style={{ fontSize: 11, color: "rgba(161,161,170,0.4)", textAlign: "center", padding: "6px 0" }}>
            Health scorer initialising…
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  );
}
