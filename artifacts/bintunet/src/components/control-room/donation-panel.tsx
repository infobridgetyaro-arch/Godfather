/**
 * donation-panel.tsx
 *
 * SuperChat Panel — control room panel for the self-generating QR SuperChat system.
 * Shows live SuperChat feed, total raised, tier breakdown, and overlay controls.
 *
 * NOTE: backend event names (donation_alert, gift_received) are unchanged for
 * backward compatibility. Only the UI labels are renamed to "SuperChat".
 */

import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, RefreshCw, ExternalLink, Copy, CheckCheck, Zap } from "lucide-react";

export interface DonationRecord {
  id: string;
  name: string;
  amount: string;
  amountKes: number;
  currency: string;
  message: string;
  channel: string;
  reference: string;
  color: string;
  ts: number;
}

interface GatewayInfo {
  gatewayUrl: string;
  configured: boolean;
  paystackConfigured: boolean;
}

interface HealthInfo {
  status: string;
  totalRaised: number;
  donationCount: number;
  paystackConfigured: boolean;
}

interface DonationPanelProps {
  accent?: string;
  donationTickerActive: boolean;
  donationAlertActive: boolean;
  onToggleTicker: (active: boolean) => void;
  onToggleAlert: (active: boolean) => void;
  latestDonation?: DonationRecord | null;
}

const KES_TIERS = [
  { label: "Silver",     minKes: 10,   maxKes: 499,  color: "#94a3b8", glow: "#64748b", icon: "🥈", badge: "SILVER"     },
  { label: "Gold",       minKes: 500,  maxKes: 1999, color: "#fbbf24", glow: "#f59e0b", icon: "🥇", badge: "GOLD"       },
  { label: "University", minKes: 2000, maxKes: Infinity, color: "#a78bfa", glow: "#7c3aed", icon: "🎓", badge: "UNIVERSITY" },
];

function getTier(amountKes: number) {
  return KES_TIERS.find(t => amountKes >= t.minKes && amountKes < t.maxKes) ?? KES_TIERS[0];
}

export function DonationPanel({
  accent = "#22c55e",
  donationTickerActive,
  donationAlertActive,
  onToggleTicker,
  onToggleAlert,
  latestDonation,
}: DonationPanelProps) {
  const [donations, setDonations]     = useState<DonationRecord[]>([]);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [health, setHealth]           = useState<HealthInfo | null>(null);
  const [loading, setLoading]         = useState(false);
  const [copied, setCopied]           = useState(false);
  const [qrDataUrl, setQrDataUrl]     = useState("");
  const feedRef                       = useRef<HTMLDivElement>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [urlRes, healthRes, donRes] = await Promise.all([
        fetch("/api/gateway/url", { credentials: "include" }),
        fetch("/api/gateway/health", { credentials: "include" }),
        fetch("/api/gateway/donations", { credentials: "include" }),
      ]);
      if (urlRes.ok) {
        const info = await urlRes.json() as GatewayInfo;
        if (!info.gatewayUrl && typeof window !== "undefined") {
          info.gatewayUrl = `${window.location.origin}/gateway-payment`;
          info.configured = true;
        }
        setGatewayInfo(info);
      }
      if (healthRes.ok) setHealth(await healthRes.json() as HealthInfo);
      if (donRes.ok) {
        const d = await donRes.json() as { donations: DonationRecord[] };
        setDonations(d.donations.slice().reverse());
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { void fetchAll(); }, []);

  useEffect(() => {
    if (!latestDonation) return;
    setDonations(prev => {
      if (prev.some(d => d.id === latestDonation.id)) return prev;
      return [latestDonation, ...prev].slice(0, 50);
    });
    setHealth(h => h ? { ...h, totalRaised: h.totalRaised + latestDonation.amountKes, donationCount: h.donationCount + 1 } : h);
    setTimeout(() => { feedRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, 100);
  }, [latestDonation]);

  useEffect(() => {
    if (gatewayInfo?.gatewayUrl) {
      setQrDataUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(gatewayInfo.gatewayUrl)}&color=000000&bgcolor=ffffff&margin=2`);
    }
  }, [gatewayInfo?.gatewayUrl]);

  const copyUrl = () => {
    if (gatewayInfo?.gatewayUrl) {
      navigator.clipboard.writeText(gatewayInfo.gatewayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isHealthy   = health?.status === "ok";
  const totalRaised = health?.totalRaised ?? 0;
  const totalCount  = health?.donationCount ?? 0;

  const silverCount     = donations.filter(d => getTier(d.amountKes).label === "Silver").length;
  const goldCount       = donations.filter(d => getTier(d.amountKes).label === "Gold").length;
  const universityCount = donations.filter(d => getTier(d.amountKes).label === "University").length;

  const Label = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{children}</div>
  );

  const ToggleBtn = ({ active, onToggle, label, icon }: { active: boolean; onToggle: () => void; label: string; icon: string }) => (
    <button
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${active ? accent : "rgba(255,255,255,0.12)"}`,
        background: active ? `${accent}22` : "rgba(255,255,255,0.04)",
        color: active ? "#86efac" : "rgba(255,255,255,0.45)",
        transition: "all 0.18s ease", flex: 1,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span>{active ? `${label} On` : label}</span>
      {active && <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, marginLeft: "auto", animation: "sc-pulse 1s infinite" }} />}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── SuperChat Gateway header ──────────────────────────────────────── */}
      <div style={{
        borderRadius: 14, overflow: "hidden",
        background: "linear-gradient(135deg, rgba(34,197,94,0.10) 0%, rgba(16,185,129,0.05) 100%)",
        border: "1px solid rgba(34,197,94,0.25)",
        padding: 16,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(34,197,94,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={14} color={accent} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#86efac", letterSpacing: "-0.01em" }}>SuperChat Gateway</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em" }}>POWERED BY PAYSTACK</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {health !== null && (
              <div style={{
                display: "flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99,
                background: isHealthy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${isHealthy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
              }}>
                {isHealthy ? <Wifi size={9} color={accent} /> : <WifiOff size={9} color="#f87171" />}
                <span style={{ fontSize: 9, fontWeight: 700, color: isHealthy ? accent : "#f87171" }}>
                  {isHealthy ? "LIVE" : "OFFLINE"}
                </span>
              </div>
            )}
            <button onClick={fetchAll} disabled={loading} style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.35)", padding: 2 }}>
              <RefreshCw size={12} style={{ animation: loading ? "sc-spin 1s linear infinite" : "none" }} />
            </button>
          </div>
        </div>

        {gatewayInfo?.gatewayUrl ? (
          <>
            {/* QR code */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <div style={{
                padding: 10, background: "#fff", borderRadius: 14,
                boxShadow: "0 0 0 3px rgba(34,197,94,0.4), 0 0 32px rgba(34,197,94,0.2)",
              }}>
                <img src={qrDataUrl} alt="SuperChat QR" width={140} height={140} style={{ display: "block" }} />
              </div>
            </div>

            {/* URL row */}
            <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 10, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.4 }}>
                {gatewayInfo.gatewayUrl}
              </span>
              <button onClick={copyUrl} title="Copy URL" style={{ flexShrink: 0, background: "transparent", border: "none", cursor: "pointer", color: copied ? accent : "rgba(255,255,255,0.4)", padding: 2, transition: "color 0.2s" }}>
                {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
              </button>
              <a href={gatewayInfo.gatewayUrl} target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.4)", display: "flex" }}>
                <ExternalLink size={14} />
              </a>
            </div>

            {!gatewayInfo.paystackConfigured && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", fontSize: 10, color: "#fcd34d", lineHeight: 1.5 }}>
                ⚠️ Add <code>PAYSTACK_SECRET_KEY</code> to environment secrets to enable live payments.
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "12px 0", color: "rgba(255,255,255,0.3)", fontSize: 11 }}>
            URL detected automatically when deployed. Run on Replit to see the QR code.
          </div>
        )}
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Total Raised",   value: `KES ${totalRaised.toLocaleString("en-KE", { minimumFractionDigits: 0 })}`, color: accent },
          { label: "SuperChats",     value: String(totalCount), color: "#818cf8" },
        ].map(s => (
          <div key={s.label} style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: "12px 14px",
          }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Space Grotesk', sans-serif", fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Tier breakdown ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6 }}>
        {[
          { tier: "Silver",     count: silverCount,     color: "#94a3b8", icon: "🥈" },
          { tier: "Gold",       count: goldCount,       color: "#fbbf24", icon: "🥇" },
          { tier: "University", count: universityCount, color: "#a78bfa", icon: "🎓" },
        ].map(t => (
          <div key={t.tier} style={{
            flex: 1, padding: "8px 6px", borderRadius: 10, textAlign: "center",
            background: `${t.color}0f`,
            border: `1px solid ${t.color}2a`,
          }}>
            <div style={{ fontSize: 14, marginBottom: 2 }}>{t.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{t.count}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.tier}</div>
          </div>
        ))}
      </div>

      {/* ── Overlay controls ──────────────────────────────────────────────── */}
      <div>
        <Label>Stream Overlay</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <ToggleBtn active={donationAlertActive} onToggle={() => onToggleAlert(!donationAlertActive)} label="SC Alert" icon="⚡" />
          <ToggleBtn active={donationTickerActive} onToggle={() => onToggleTicker(!donationTickerActive)} label="SC Ticker" icon="📊" />
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
          SC Alert shows each SuperChat pop-up for ~8 s. Ticker scrolls latest supporters at the bottom of the stream.
        </div>
      </div>

      {/* ── Live SuperChat feed ───────────────────────────────────────────── */}
      <div>
        <Label>Live SuperChats</Label>
        <div ref={feedRef} style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {donations.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0", color: "rgba(255,255,255,0.2)", fontSize: 11 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⚡</div>
              No SuperChats yet. Share the QR code on stream!
            </div>
          )}
          {donations.map(d => {
            const tier = getTier(d.amountKes);
            return (
              <div key={d.id} style={{
                padding: "10px 12px", borderRadius: 10,
                background: `${tier.color}08`,
                border: `1px solid ${tier.color}22`,
                borderLeft: `3px solid ${tier.color}`,
                display: "flex", alignItems: "center", gap: 10,
                animation: "sc-slide-in 0.3s ease",
                backdropFilter: "blur(8px)",
              }}>
                {/* Tier icon bubble */}
                <div style={{
                  width: 34, height: 34, borderRadius: "50%",
                  background: `${tier.color}18`,
                  border: `1px solid ${tier.color}33`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 16,
                  boxShadow: `0 0 10px ${tier.glow}40`,
                }}>
                  {tier.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                    <span style={{
                      padding: "1px 7px", borderRadius: 99, flexShrink: 0,
                      background: `${tier.color}22`, color: tier.color,
                      fontSize: 10, fontWeight: 800,
                      boxShadow: `0 0 8px ${tier.glow}40`,
                    }}>
                      {d.amount}
                    </span>
                    <span style={{
                      padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                      background: `${tier.color}15`, color: tier.color,
                      fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em",
                    }}>
                      {tier.badge}
                    </span>
                  </div>
                  {d.message && (
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      "{d.message}"
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginTop: 2 }}>
                    {new Date(d.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {d.channel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.1)", fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
        The QR code auto-updates when the container URL changes. Silver ≥ KES 10 · Gold ≥ KES 500 · University ≥ KES 2,000.
      </div>

      <style>{`
        @keyframes sc-spin { to { transform: rotate(360deg); } }
        @keyframes sc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes sc-slide-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
