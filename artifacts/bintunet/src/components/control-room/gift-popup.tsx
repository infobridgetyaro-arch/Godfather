/**
 * GiftPopup — TikTok-style SuperChat gift notification overlay for the control room.
 *
 * Receives `gift_received` WebSocket events. Renders a browser-side animated
 * popup with glassmorphism cards, tier-specific neon glow, TikTok burst particles,
 * and Web Audio sounds. Auto-dismisses after the gift's display duration.
 *
 * Does NOT touch the Paystack integration, webhooks, or server-side overlay.
 */

import { useEffect, useRef, useState } from "react";

export type GiftTier        = "silver" | "gold" | "university";
export type GiftDisplayMode = "minimal" | "standard" | "hype";
export type SoundKey        = "chime" | "pop" | "whoosh" | "boom";

export interface GiftDef {
  id:            string;
  name:          string;
  icon:          string;
  tier:          GiftTier;
  displayMode:   GiftDisplayMode;
  primaryColor:  string;
  glowColor:     string;
  accentColor:   string;
  durationMs:    number;
  soundKey:      SoundKey;
}

export interface GiftEvent {
  id:         string;
  donorName:  string;
  amount:     string;
  amountKes:  number;
  message:    string;
  gift:       GiftDef;
  ts:         number;
  comboCount: number;
}

const TIER_LABELS: Record<GiftTier, string> = {
  silver:     "Silver SuperChat",
  gold:       "Gold SuperChat",
  university: "University SuperChat",
};

const TIER_ICONS: Record<GiftTier, string> = {
  silver:     "🥈",
  gold:       "🥇",
  university: "🎓",
};

function playGiftSound(soundKey: SoundKey, volume = 0.35) {
  try {
    const AudioContextCls =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCls) return;
    const actx  = new AudioContextCls() as AudioContext;
    const gain  = actx.createGain();
    gain.gain.setValueAtTime(volume, actx.currentTime);
    gain.connect(actx.destination);

    switch (soundKey) {
      case "chime": {
        [880, 1100, 1320].forEach((freq, i) => {
          const osc = actx.createOscillator();
          const g   = actx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, actx.currentTime + i * 0.08);
          g.gain.setValueAtTime(0, actx.currentTime + i * 0.08);
          g.gain.linearRampToValueAtTime(volume * 0.9, actx.currentTime + i * 0.08 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + i * 0.08 + 0.6);
          osc.connect(g); g.connect(actx.destination);
          osc.start(actx.currentTime + i * 0.08);
          osc.stop(actx.currentTime + i * 0.08 + 0.65);
        });
        break;
      }
      case "pop": {
        const osc = actx.createOscillator();
        const g   = actx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(600, actx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, actx.currentTime + 0.12);
        g.gain.setValueAtTime(volume, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.35);
        osc.connect(g); g.connect(actx.destination);
        osc.start(); osc.stop(actx.currentTime + 0.38);
        const osc2 = actx.createOscillator();
        const g2   = actx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1200, actx.currentTime + 0.05);
        osc2.frequency.exponentialRampToValueAtTime(880, actx.currentTime + 0.25);
        g2.gain.setValueAtTime(volume * 0.5, actx.currentTime + 0.05);
        g2.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.4);
        osc2.connect(g2); g2.connect(actx.destination);
        osc2.start(actx.currentTime + 0.05); osc2.stop(actx.currentTime + 0.45);
        break;
      }
      case "whoosh": {
        const bufSize = actx.sampleRate * 0.5;
        const buf     = actx.createBuffer(1, bufSize, actx.sampleRate);
        const data    = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        const src  = actx.createBufferSource();
        src.buffer = buf;
        const filter = actx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(200, actx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(3000, actx.currentTime + 0.4);
        filter.Q.value = 0.5;
        const g = actx.createGain();
        g.gain.setValueAtTime(volume * 0.8, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.55);
        src.connect(filter); filter.connect(g); g.connect(actx.destination);
        src.start(); src.stop(actx.currentTime + 0.6);
        const osc = actx.createOscillator();
        const g2  = actx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(80, actx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, actx.currentTime + 0.45);
        g2.gain.setValueAtTime(volume * 0.3, actx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.5);
        osc.connect(g2); g2.connect(actx.destination);
        osc.start(); osc.stop(actx.currentTime + 0.55);
        break;
      }
      case "boom": {
        const osc = actx.createOscillator();
        const g   = actx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(90, actx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(35, actx.currentTime + 0.35);
        g.gain.setValueAtTime(volume * 1.2, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.6);
        osc.connect(g); g.connect(actx.destination);
        osc.start(); osc.stop(actx.currentTime + 0.65);
        const bufSize = actx.sampleRate * 0.3;
        const buf     = actx.createBuffer(1, bufSize, actx.sampleRate);
        const data    = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        const src  = actx.createBufferSource();
        src.buffer = buf;
        const g2   = actx.createGain();
        g2.gain.setValueAtTime(volume * 0.5, actx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.3);
        src.connect(g2); g2.connect(actx.destination);
        src.start(); src.stop(actx.currentTime + 0.35);
        [1320, 1760, 2200].forEach((freq, i) => {
          const o = actx.createOscillator();
          const gv = actx.createGain();
          o.type = "sine";
          o.frequency.value = freq;
          gv.gain.setValueAtTime(0, actx.currentTime + 0.18 + i * 0.07);
          gv.gain.linearRampToValueAtTime(volume * 0.4, actx.currentTime + 0.2 + i * 0.07);
          gv.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.7 + i * 0.07);
          o.connect(gv); gv.connect(actx.destination);
          o.start(actx.currentTime + 0.18 + i * 0.07);
          o.stop(actx.currentTime + 0.75 + i * 0.07);
        });
        break;
      }
    }
    gain.disconnect();
    setTimeout(() => { try { actx.close(); } catch {} }, 3000);
  } catch { /* AudioContext unavailable — silent fallback */ }
}

// ── TikTok-style burst particle canvas ─────────────────────────────────────

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;     // 0–1 remaining
  decay: number;
  shape: "circle" | "star" | "diamond";
  spin: number;
  spinSpeed: number;
}

function ParticleCanvas({
  gift, show, mode,
}: { gift: GiftDef; show: boolean; mode: GiftDisplayMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const startRef  = useRef<number>(0);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    if (!show || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    if (!ctx) return;

    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;

    const count  = mode === "hype" ? 60 : mode === "standard" ? 28 : 12;
    const colors = [gift.primaryColor, gift.accentColor, gift.glowColor, "#ffffff"];
    const shapes: Particle["shape"][] = ["circle", "star", "diamond"];

    particles.current = Array.from({ length: count }, (_, i) => {
      const angle   = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed   = (mode === "hype" ? 3.5 : mode === "standard" ? 2 : 1) + Math.random() * 2.5;
      const vx      = Math.cos(angle) * speed;
      const vy      = Math.sin(angle) * speed * (mode === "hype" ? 1 : 0.7);
      return {
        x: cx, y: cy,
        vx, vy,
        size: (mode === "hype" ? 5 : 3) + Math.random() * (mode === "hype" ? 7 : 4),
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 0.85 + Math.random() * 0.15,
        life: 1,
        decay: 0.008 + Math.random() * (mode === "hype" ? 0.006 : 0.012),
        shape: shapes[i % 3],
        spin: Math.random() * Math.PI * 2,
        spinSpeed: (Math.random() - 0.5) * 0.15,
      };
    });

    startRef.current = performance.now();

    function drawStar(ctx2: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number) {
      ctx2.beginPath();
      for (let i = 0; i < 5; i++) {
        const a1 = spin + (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const a2 = spin + ((i + 0.5) * 2 * Math.PI) / 5 - Math.PI / 2;
        if (i === 0) ctx2.moveTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
        else         ctx2.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
        ctx2.lineTo(x + Math.cos(a2) * (r * 0.45), y + Math.sin(a2) * (r * 0.45));
      }
      ctx2.closePath();
    }

    function drawDiamond(ctx2: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number) {
      ctx2.beginPath();
      ctx2.moveTo(x + Math.cos(spin) * r, y + Math.sin(spin) * r);
      ctx2.lineTo(x + Math.cos(spin + Math.PI / 2) * r * 0.5, y + Math.sin(spin + Math.PI / 2) * r * 0.5);
      ctx2.lineTo(x + Math.cos(spin + Math.PI) * r, y + Math.sin(spin + Math.PI) * r);
      ctx2.lineTo(x + Math.cos(spin - Math.PI / 2) * r * 0.5, y + Math.sin(spin - Math.PI / 2) * r * 0.5);
      ctx2.closePath();
    }

    function frame() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      for (const p of particles.current) {
        if (p.life <= 0) continue;
        alive = true;

        p.x    += p.vx;
        p.y    += p.vy;
        p.vy   += 0.06;   // gentle gravity
        p.vx   *= 0.98;
        p.life -= p.decay;
        p.spin += p.spinSpeed;

        ctx.globalAlpha = Math.max(0, p.life * p.alpha);
        ctx.fillStyle   = p.color;
        if (mode === "hype") {
          ctx.shadowBlur  = 8;
          ctx.shadowColor = p.color;
        }

        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life + 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "star") {
          drawStar(ctx, p.x, p.y, p.size * p.life + 1, p.spin);
          ctx.fill();
        } else {
          drawDiamond(ctx, p.x, p.y, p.size * p.life + 1, p.spin);
          ctx.fill();
        }

        ctx.shadowBlur = 0;
      }

      ctx.globalAlpha = 1;
      if (alive) rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(rafRef.current); };
  }, [show, gift, mode]);

  return (
    <canvas
      ref={canvasRef}
      width={mode === "hype" ? 700 : mode === "standard" ? 500 : 240}
      height={mode === "hype" ? 480 : mode === "standard" ? 240 : 140}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

// ── Glassmorphism card wrapper ───────────────────────────────────────────────

function GlassCard({
  children, gift, style, className,
}: {
  children: React.ReactNode;
  gift: GiftDef;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: `linear-gradient(135deg, rgba(6,6,30,0.88) 0%, rgba(10,10,50,0.82) 100%)`,
        backdropFilter: "blur(20px) saturate(1.6)",
        WebkitBackdropFilter: "blur(20px) saturate(1.6)",
        border: `1.5px solid ${gift.primaryColor}55`,
        boxShadow: `
          0 0 0 1px ${gift.primaryColor}20,
          0 0 24px ${gift.glowColor}44,
          0 0 60px ${gift.glowColor}22,
          inset 0 1px 0 rgba(255,255,255,0.08)
        `,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Animated neon glow rings (hype mode) ────────────────────────────────────

function GlowRings({ gift }: { gift: GiftDef }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[0, 1, 2, 3].map(i => (
        <div
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: `${40 + i * 18}vmin`,
            height: `${40 + i * 18}vmin`,
            border: `2px solid ${gift.primaryColor}`,
            animation: `scGiftRing 2s ${i * 0.5}s ease-out infinite`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}

// ── Tier accent strip ────────────────────────────────────────────────────────

function TierStrip({ gift }: { gift: GiftDef }) {
  return (
    <div
      className="flex items-center justify-between px-3"
      style={{
        background: `linear-gradient(90deg, ${gift.primaryColor} 0%, ${gift.glowColor}bb 100%)`,
        height: 26, flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 900, color: "rgba(0,0,0,0.55)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
        SuperChat
      </span>
      <span style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,0.92)", letterSpacing: "0.06em" }}>
        {TIER_ICONS[gift.tier]} {TIER_LABELS[gift.tier].toUpperCase()}
      </span>
    </div>
  );
}

// ── Main GiftPopup component ────────────────────────────────────────────────

interface GiftPopupProps {
  event: GiftEvent | null;
  onDismiss: () => void;
}

export function GiftPopup({ event, onDismiss }: GiftPopupProps) {
  const [visible,  setVisible]  = useState(false);
  const [animOut,  setAnimOut]  = useState(false);
  const [burst,    setBurst]    = useState(false);
  const soundPlayed = useRef<string>("");

  useEffect(() => {
    if (!event) { setVisible(false); setAnimOut(false); setBurst(false); return; }

    setAnimOut(false);
    setBurst(false);
    setVisible(true);

    // Brief delay then trigger burst
    const tBurst = setTimeout(() => setBurst(true), 80);

    if (soundPlayed.current !== event.id) {
      soundPlayed.current = event.id;
      playGiftSound(event.gift.soundKey, event.gift.tier === "university" ? 0.45 : 0.3);
    }

    const fadeAt = Math.max(event.gift.durationMs - 700, event.gift.durationMs * 0.8);
    const total  = event.gift.durationMs;

    const t1 = setTimeout(() => setAnimOut(true), fadeAt);
    const t2 = setTimeout(() => { setVisible(false); setBurst(false); onDismiss(); }, total);
    return () => { clearTimeout(tBurst); clearTimeout(t1); clearTimeout(t2); };
  }, [event]);

  if (!visible || !event) return null;

  const { gift } = event;
  const mode     = gift.displayMode;

  const cssVars = {
    "--gift-primary": gift.primaryColor,
    "--gift-glow":    gift.glowColor,
    "--gift-accent":  gift.accentColor,
  } as React.CSSProperties;

  /* ── MINIMAL MODE — pill notification (top-right corner) ─────────────── */
  if (mode === "minimal") {
    return (
      <>
        <style>{GIFT_KEYFRAMES}</style>
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: 20, right: 20, ...cssVars }}
        >
          {/* Outer glow ring */}
          <div
            className="absolute inset-0 rounded-[28px]"
            style={{
              boxShadow: `0 0 0 2px ${gift.primaryColor}55, 0 0 24px ${gift.glowColor}55`,
              animation: animOut ? "" : "scGiftSlideIn 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          />

          {/* Card */}
          <div
            className="relative flex items-center gap-3 overflow-hidden"
            style={{
              minWidth: 260,
              maxWidth: 340,
              borderRadius: 28,
              padding: "11px 18px 11px 10px",
              background: "linear-gradient(135deg, rgba(8,8,24,0.97) 0%, rgba(14,10,40,0.95) 100%)",
              backdropFilter: "blur(20px)",
              border: `1.5px solid ${gift.primaryColor}44`,
              boxShadow: `0 8px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)`,
              animation: animOut
                ? "scGiftFadeOut 0.5s ease-in forwards"
                : "scGiftSlideIn 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          >
            {/* Colored left accent pill */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[5px] rounded-l-[28px]"
              style={{
                background: `linear-gradient(180deg, ${gift.primaryColor}, ${gift.accentColor})`,
                boxShadow: `2px 0 12px ${gift.glowColor}66`,
              }}
            />

            {/* Icon */}
            <span
              className="text-[28px] pl-2 shrink-0 leading-none"
              style={{
                filter: `drop-shadow(0 0 10px ${gift.glowColor})`,
                animation: animOut ? "" : "scGiftIconBounce 0.5s 0.05s cubic-bezier(0.34,1.8,0.64,1) both",
              }}
            >
              {gift.icon}
            </span>

            {/* Text block */}
            <div className="flex flex-col min-w-0 flex-1 gap-px">
              <span
                className="text-[10px] font-black uppercase tracking-widest leading-none"
                style={{ color: gift.primaryColor }}
              >
                {TIER_ICONS[gift.tier]} {TIER_LABELS[gift.tier]}
              </span>
              <span className="text-[15px] font-bold text-white truncate leading-tight">
                {event.donorName}
              </span>
            </div>

            {/* Amount badge */}
            <div
              className="shrink-0 rounded-2xl px-3 py-1 text-sm font-black text-white"
              style={{
                background: `linear-gradient(135deg, ${gift.primaryColor}cc, ${gift.accentColor}aa)`,
                boxShadow: `0 0 12px ${gift.glowColor}55`,
              }}
            >
              {event.amount}
              {event.comboCount > 1 && (
                <span className="ml-1 text-[10px]" style={{ color: "#ff9966" }}>×{event.comboCount}</span>
              )}
            </div>

            <ParticleCanvas gift={gift} show={burst} mode="minimal" />
          </div>
        </div>
      </>
    );
  }

  /* ── STANDARD MODE — YouTube SuperChat–style card ─────────────────────── */
  if (mode === "standard") {
    const initials = event.donorName.slice(0, 2).toUpperCase();
    return (
      <>
        <style>{GIFT_KEYFRAMES}</style>
        <div
          className="fixed z-[9999] inset-x-0 bottom-24 flex justify-center pointer-events-none"
          style={cssVars}
        >
          <div
            className="relative overflow-hidden"
            style={{
              width: "min(540px, 94vw)",
              borderRadius: 22,
              background: "linear-gradient(160deg, rgba(6,6,22,0.99) 0%, rgba(12,8,40,0.97) 100%)",
              backdropFilter: "blur(32px) saturate(1.8)",
              border: `1.5px solid ${gift.primaryColor}66`,
              boxShadow: `
                0 0 0 1px ${gift.primaryColor}20,
                0 16px 64px rgba(0,0,0,0.75),
                0 0 80px ${gift.glowColor}28,
                inset 0 1px 0 rgba(255,255,255,0.09)
              `,
              animation: animOut
                ? "scGiftFadeOut 0.6s ease-in forwards"
                : "scGiftPopIn 0.52s cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          >
            {/* Gradient top accent bar with animated shimmer */}
            <div style={{ height: 6, background: `linear-gradient(90deg, ${gift.primaryColor}, ${gift.glowColor}, ${gift.accentColor}, ${gift.glowColor}, ${gift.primaryColor})`, backgroundSize: "200% 100%", animation: "scGiftShimmer 2.5s linear infinite", borderRadius: "22px 22px 0 0" }} />

            {/* Header row — icon + tier + amount */}
            <div
              className="flex items-center justify-between px-5 pt-4 pb-3"
              style={{ borderBottom: `1px solid ${gift.primaryColor}28` }}
            >
              <div className="flex items-center gap-3">
                {/* Large gift icon */}
                <div
                  className="relative shrink-0"
                  style={{
                    width: 56, height: 56,
                    borderRadius: 16,
                    background: `radial-gradient(circle at 35% 35%, ${gift.primaryColor}44, rgba(0,0,0,0.6))`,
                    border: `1.5px solid ${gift.primaryColor}55`,
                    boxShadow: `0 0 20px ${gift.glowColor}44`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 28,
                    animation: animOut ? "" : "scGiftIconBounce 0.55s 0.1s cubic-bezier(0.34,1.8,0.64,1) both",
                  }}
                >
                  {gift.icon}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.18em] leading-none"
                    style={{ color: gift.primaryColor, textShadow: `0 0 8px ${gift.glowColor}88` }}
                  >
                    {TIER_ICONS[gift.tier]} {TIER_LABELS[gift.tier]}
                  </span>
                  <span className="text-[12px] font-medium text-white/45 leading-none mt-1">{gift.name}</span>
                </div>
              </div>

              {/* Amount badge — prominent */}
              <div
                className="shrink-0 flex flex-col items-center justify-center rounded-2xl px-4 py-2"
                style={{
                  background: `linear-gradient(145deg, ${gift.primaryColor}ee, ${gift.accentColor}cc)`,
                  color: "#fff",
                  minWidth: 80,
                  boxShadow: `0 0 24px ${gift.glowColor}66, inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.2)`,
                }}
              >
                <span style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em" }}>{event.amount}</span>
                {event.comboCount > 1 && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#ffeecc", marginTop: 2 }}>×{event.comboCount} COMBO</span>
                )}
              </div>
            </div>

            {/* Donor row */}
            <div className="flex items-start gap-3 px-5 pt-4 pb-4">
              {/* Avatar circle with initials */}
              <div
                className="shrink-0 rounded-full flex items-center justify-center font-black text-sm"
                style={{
                  width: 40, height: 40,
                  background: `linear-gradient(135deg, ${gift.primaryColor}aa, ${gift.glowColor}88)`,
                  border: `1.5px solid ${gift.primaryColor}66`,
                  color: "#fff",
                  boxShadow: `0 0 12px ${gift.glowColor}44`,
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[19px] font-black text-white leading-tight truncate">{event.donorName}</span>
                {event.message && (
                  <span
                    className="text-[13px] text-white/60 italic mt-1 leading-snug"
                    style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                  >
                    "{event.message}"
                  </span>
                )}
              </div>
            </div>

            {/* Countdown progress bar */}
            <div style={{ height: 3, background: "rgba(255,255,255,0.06)", position: "relative", overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  background: `linear-gradient(90deg, ${gift.primaryColor}, ${gift.glowColor})`,
                  boxShadow: `0 0 8px ${gift.glowColor}`,
                  borderRadius: 99,
                  animation: animOut ? "none" : `scGiftCountdown ${gift.durationMs}ms linear forwards`,
                  width: "100%",
                }}
              />
            </div>

            <ParticleCanvas gift={gift} show={burst} mode="standard" />
          </div>
        </div>
      </>
    );
  }

  /* ── HYPE MODE (university tier) ──────────────────────────────────────── */
  return (
    <>
      <style>{GIFT_KEYFRAMES}</style>
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center pointer-events-none"
        style={{
          ...cssVars,
          background: `radial-gradient(ellipse 80% 70% at 50% 50%, ${gift.glowColor}22 0%, rgba(0,0,0,0) 60%), rgba(0,0,0,0.72)`,
          backdropFilter: "blur(2px)",
          animation: animOut ? "scGiftFadeOut 0.7s ease-in forwards" : "scGiftHypeIn 0.35s ease-out forwards",
        }}
      >
        {/* Animated glow rings */}
        <GlowRings gift={gift} />

        {/* Particle burst */}
        <ParticleCanvas gift={gift} show={burst} mode="hype" />

        {/* Large icon with mega-glow */}
        <div
          className="relative text-[13vmin] mb-4 z-10"
          style={{
            filter: `drop-shadow(0 0 40px ${gift.glowColor}) drop-shadow(0 0 80px ${gift.glowColor}88)`,
            animation: animOut ? "" : "scGiftHypeIcon 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          }}
        >
          {gift.icon}
        </div>

        {/* Tier label */}
        <div
          className="text-lg font-black mb-1 text-center tracking-widest z-10"
          style={{
            color: gift.primaryColor,
            textShadow: `0 0 24px ${gift.glowColor}, 0 0 48px ${gift.glowColor}66`,
            animation: "scGiftTextIn 0.4s 0.2s ease-out both",
          }}
        >
          {TIER_ICONS[gift.tier]} {TIER_LABELS[gift.tier].toUpperCase()} {TIER_ICONS[gift.tier]}
        </div>

        {/* Glassmorphic card for name + amount */}
        <div
          className="z-10 rounded-3xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(6,6,30,0.85) 0%, rgba(10,10,50,0.80) 100%)",
            backdropFilter: "blur(24px)",
            border: `1.5px solid ${gift.primaryColor}55`,
            boxShadow: `0 0 40px ${gift.glowColor}44, inset 0 1px 0 rgba(255,255,255,0.10)`,
            marginTop: 8, marginBottom: 12,
            minWidth: "min(380px, 80vw)",
            animation: "scGiftTextIn 0.4s 0.25s ease-out both",
          }}
        >
          <div style={{ height: 4, background: `linear-gradient(90deg, ${gift.primaryColor}, ${gift.glowColor}, ${gift.accentColor})` }} />
          <div className="flex flex-col items-center px-8 py-4 gap-1">
            <span className="text-3xl font-black text-white text-center leading-tight">{event.donorName}</span>
            <span
              className="text-xl font-black"
              style={{ color: gift.primaryColor, textShadow: `0 0 12px ${gift.glowColor}` }}
            >
              {event.amount}
            </span>
          </div>
        </div>

        {/* Combo */}
        {event.comboCount > 1 && (
          <div
            className="text-3xl font-black text-center z-10"
            style={{
              color: "#ff6b35",
              textShadow: "0 0 24px #ff6b35, 0 0 48px #ff6b3566",
              animation: "scGiftTextIn 0.4s 0.35s ease-out both, scGiftComboSpin 0.4s ease-out",
            }}
          >
            🔥 {event.comboCount}x COMBO!
          </div>
        )}

        {/* Message */}
        {event.message && (
          <div
            className="mt-3 px-6 py-2 rounded-xl max-w-sm text-center z-10"
            style={{
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.10)",
              animation: "scGiftTextIn 0.4s 0.45s ease-out both",
            }}
          >
            <span className="text-sm text-white/70 italic">"{event.message}"</span>
          </div>
        )}
      </div>
    </>
  );
}

// ── CSS keyframes ────────────────────────────────────────────────────────────

const GIFT_KEYFRAMES = `
@keyframes scGiftSlideIn {
  from { transform: translateX(115%) scale(0.92); opacity: 0; }
  to   { transform: translateX(0)   scale(1);    opacity: 1; }
}
@keyframes scGiftFadeOut {
  from { opacity: 1; transform: scale(1); filter: blur(0px); }
  to   { opacity: 0; transform: scale(0.90); filter: blur(4px); }
}
@keyframes scGiftPopIn {
  0%   { transform: scale(0.65) translateY(24px); opacity: 0; }
  70%  { transform: scale(1.04) translateY(-3px); opacity: 1; }
  100% { transform: scale(1)    translateY(0);    opacity: 1; }
}
@keyframes scGiftHypeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes scGiftHypeIcon {
  0%   { transform: scale(0.3) rotate(-12deg); opacity: 0; }
  60%  { transform: scale(1.12) rotate(4deg);  opacity: 1; }
  100% { transform: scale(1)   rotate(0deg);   opacity: 1; }
}
@keyframes scGiftIconBounce {
  0%   { transform: scale(0.4) rotate(-8deg); opacity: 0; }
  65%  { transform: scale(1.2) rotate(4deg);  opacity: 1; }
  100% { transform: scale(1)   rotate(0deg);  opacity: 1; }
}
@keyframes scGiftTextIn {
  from { transform: translateY(18px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes scGiftComboSpin {
  from { transform: scale(0.5) rotate(-20deg); }
  to   { transform: scale(1)   rotate(0deg); }
}
@keyframes scGiftRing {
  0%   { transform: translate(-50%, -50%) scale(0.1); opacity: 0.7; }
  100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0;   }
}
@keyframes scGiftShimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}
@keyframes scGiftCountdown {
  from { width: 100%; }
  to   { width: 0%; }
}
`;
