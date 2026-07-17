import { useState, useEffect } from "react";

interface EnvStatus {
  role: string;
  failover: { pollMs: number; timeoutMs: number; primaryUrl: string | null };
  keys: {
    SESSION_SECRET: boolean;
    BINTUNET_PASSWORD: boolean;
    REDIS_URL: boolean;
    DATABASE_URL: boolean;
    OPENAI_API_KEY: boolean;
    GROQ_API_KEY: boolean;
    PAYSTACK_SECRET_KEY: boolean;
    NGROK_TOKEN: boolean;
    R2_ENDPOINT: boolean;
    R2_ACCESS_KEY_ID: boolean;
    R2_SECRET_ACCESS_KEY: boolean;
    R2_BUCKET: boolean;
    CDN_BASE_URL: boolean;
    HLS_ENABLED: boolean;
  };
}

function KeyRow({ label, set, description, optional = false }: {
  label: string; set: boolean; description?: string; optional?: boolean;
}) {
  const color = set ? "#4ade80" : optional ? "#f59e0b" : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
        background: set ? "rgba(74,222,128,0.12)" : optional ? "rgba(245,158,11,0.12)" : "rgba(248,113,113,0.12)",
        border: `1px solid ${color}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color, fontWeight: 800,
      }}>
        {set ? "✓" : optional ? "○" : "✗"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: set ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
          {label}
        </div>
        {description && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>{description}</div>}
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, flexShrink: 0 }}>
        {set ? "Set" : optional ? "Optional" : "Missing"}
      </span>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function SystemPanel() {
  const [status, setStatus] = useState<EnvStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/env-status", { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => { setStatus(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
      Loading system status…
    </div>
  );

  if (error || !status) return (
    <div style={{ padding: 16, color: "#f87171", fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <span>⚠ Could not load: {error}</span>
      <button onClick={load} style={{ alignSelf: "flex-start", padding: "4px 12px", borderRadius: 6, border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.08)", color: "#f87171", fontSize: 11, cursor: "pointer" }}>Retry</button>
    </div>
  );

  const k = status.keys;
  const isPrimary = status.role === "primary";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Role badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 12px", borderRadius: 20,
          border: `1px solid ${isPrimary ? "rgba(56,189,248,0.4)" : "rgba(168,85,247,0.4)"}`,
          background: isPrimary ? "rgba(56,189,248,0.1)" : "rgba(168,85,247,0.1)",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: isPrimary ? "#38bdf8" : "#a855f7", display: "block" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: isPrimary ? "#38bdf8" : "#c084fc", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {status.role} VPS
          </span>
        </div>
        <button onClick={load} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 10, cursor: "pointer" }}>
          ↻ Refresh
        </button>
      </div>

      {/* Failover info — only shown on backup */}
      {!isPrimary && (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}>
          <div style={{ fontSize: 9, color: "#c084fc", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>Failover Watcher</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Poll: <strong style={{ color: "#c084fc" }}>{status.failover.pollMs / 1000}s</strong></span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Timeout: <strong style={{ color: "#c084fc" }}>{status.failover.timeoutMs / 1000}s</strong></span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Primary: <strong style={{ color: status.failover.primaryUrl ? "#4ade80" : "#f87171", fontFamily: "monospace", fontSize: 10 }}>{status.failover.primaryUrl ?? "not set"}</strong></span>
          </div>
        </div>
      )}

      <Section label="Auth">
        <KeyRow label="SESSION_SECRET"    set={k.SESSION_SECRET}    description="Express session signing key" />
        <KeyRow label="BINTUNET_PASSWORD" set={k.BINTUNET_PASSWORD} description="Dashboard login password" />
      </Section>

      <Section label="Storage">
        <KeyRow label="REDIS_URL"    set={k.REDIS_URL}    description="Shared Redis — required for standby failover" optional />
        <KeyRow label="DATABASE_URL" set={k.DATABASE_URL} description="PostgreSQL — persistent storage" optional />
      </Section>

      <Section label="AI">
        <KeyRow label="OPENAI_API_KEY" set={k.OPENAI_API_KEY} description="GPT-4o — AI assistant & script generation" optional />
        <KeyRow label="GROQ_API_KEY"   set={k.GROQ_API_KEY}   description="Llama 3 — faster/cheaper AI fallback" optional />
      </Section>

      <Section label="Payments">
        <KeyRow label="PAYSTACK_SECRET_KEY" set={k.PAYSTACK_SECRET_KEY} description="Paystack — donation processing" optional />
      </Section>

      <Section label="Tunnel (GitHub Actions VPS)">
        <KeyRow label="NGROK_TOKEN" set={k.NGROK_TOKEN} description="ngrok authtoken — exposes server publicly" />
      </Section>

      <Section label="HLS / Cloudflare R2 CDN">
        <KeyRow label="HLS_ENABLED"          set={k.HLS_ENABLED}          description="Adaptive bitrate HLS alongside RTMP" optional />
        <KeyRow label="R2_ENDPOINT"          set={k.R2_ENDPOINT}          description="Cloudflare R2 endpoint URL" optional />
        <KeyRow label="R2_ACCESS_KEY_ID"     set={k.R2_ACCESS_KEY_ID}     description="R2 API token access key" optional />
        <KeyRow label="R2_SECRET_ACCESS_KEY" set={k.R2_SECRET_ACCESS_KEY} description="R2 API token secret key" optional />
        <KeyRow label="R2_BUCKET"            set={k.R2_BUCKET}            description="R2 bucket name" optional />
        <KeyRow label="CDN_BASE_URL"         set={k.CDN_BASE_URL}         description="Public CDN URL (e.g. https://live.yourdomain.com)" optional />
      </Section>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, padding: "2px 4px", flexWrap: "wrap" }}>
        {[{ color: "#4ade80", label: "Configured" }, { color: "#f59e0b", label: "Optional — not set" }, { color: "#f87171", label: "Required — missing" }].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
