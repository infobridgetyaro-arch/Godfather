/**
 * AnimatedGradientBackground
 * Full-screen animated gradient layer that sits at z-index 0, always behind the video.
 * 10 distinct animation styles, GPU-accelerated via CSS transforms.
 */
import React, { useId } from "react";

export const GRADIENT_STYLES = [
  "Flow",
  "Aurora",
  "Mesh Gradient",
  "Liquid Waves",
  "Soft Glow",
  "Radial Pulse",
  "Moving Light",
  "Aurora Ribbon",
  "Glass Gradient",
  "Dynamic Color Shift",
] as const;

export type GradientStyle = (typeof GRADIENT_STYLES)[number];

export interface AnimatedGradientBgProps {
  active: boolean;
  color1: string;
  color2: string;
  opacity?: number;        // 0–1, default 0.45
  style?: GradientStyle;
  speed?: number;          // seconds per loop, 5–120, default 30
  blur?: number;           // px, 0–120, default 80
  brightness?: number;     // %, 50–200, default 100
  saturation?: number;     // %, 50–200, default 100
  rotation?: number;       // deg, 0–360, default 0
  zoom?: number;           // %, 100–200, default 110
  animEnabled?: boolean;
}

function mixColor(c1: string, c2: string, t = 0.5): string {
  try {
    const h2r = (h: string) => parseInt(h, 16);
    const c = (s: string) => s.replace("#", "").padEnd(6, "0");
    const [r1, g1, b1] = [h2r(c(c1).slice(0, 2)), h2r(c(c1).slice(2, 4)), h2r(c(c1).slice(4, 6))];
    const [r2, g2, b2] = [h2r(c(c2).slice(0, 2)), h2r(c(c2).slice(2, 4)), h2r(c(c2).slice(4, 6))];
    return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
  } catch {
    return c1;
  }
}

/* ─── CSS keyframes for all styles ─── */
const KEYFRAMES = `
@keyframes agbg-flow1 {
  0%,100%{transform:translate3d(0,0,0)}
  33%{transform:translate3d(14%,10%,0)}
  66%{transform:translate3d(-8%,16%,0)}
}
@keyframes agbg-flow2 {
  0%,100%{transform:translate3d(0,0,0)}
  33%{transform:translate3d(-14%,-10%,0)}
  66%{transform:translate3d(10%,-16%,0)}
}
@keyframes agbg-flow3 {
  0%,100%{transform:translate3d(0,0,0)}
  50%{transform:translate3d(-10%,10%,0)}
}
@keyframes agbg-flow4 {
  0%,100%{transform:translate3d(0,0,0) scale3d(1,1,1)}
  40%{transform:translate3d(12%,-8%,0) scale3d(1.1,1.1,1)}
  80%{transform:translate3d(-6%,12%,0) scale3d(0.95,0.95,1)}
}
@keyframes agbg-flow5 {
  0%,100%{transform:translate3d(0,0,0)}
  25%{transform:translate3d(-16%,6%,0)}
  75%{transform:translate3d(8%,-12%,0)}
}
@keyframes agbg-aurora1 {
  0%,100%{transform:translate3d(-6%,0,0) scaleX(1.12)}
  50%{transform:translate3d(6%,3%,0) scaleX(0.94)}
}
@keyframes agbg-aurora2 {
  0%,100%{transform:translate3d(4%,0,0) scaleX(0.96)}
  50%{transform:translate3d(-4%,-4%,0) scaleX(1.08)}
}
@keyframes agbg-aurora3 {
  0%,100%{transform:translate3d(-2%,2%,0) scaleX(1.05)}
  50%{transform:translate3d(2%,-2%,0) scaleX(0.98)}
}
@keyframes agbg-aurora4 {
  0%,100%{opacity:0.7;transform:translate3d(0,0,0)}
  33%{opacity:1;transform:translate3d(-3%,1%,0)}
  66%{opacity:0.5;transform:translate3d(3%,-1%,0)}
}
@keyframes agbg-mesh1 {
  0%,100%{transform:translate3d(0,0,0)}
  25%{transform:translate3d(8%,6%,0)}
  50%{transform:translate3d(4%,10%,0)}
  75%{transform:translate3d(-6%,4%,0)}
}
@keyframes agbg-mesh2 {
  0%,100%{transform:translate3d(0,0,0)}
  25%{transform:translate3d(-6%,-8%,0)}
  50%{transform:translate3d(-10%,-2%,0)}
  75%{transform:translate3d(4%,-8%,0)}
}
@keyframes agbg-mesh3 {
  0%,100%{transform:translate3d(0,0,0)}
  25%{transform:translate3d(10%,-4%,0)}
  50%{transform:translate3d(6%,-10%,0)}
  75%{transform:translate3d(-4%,-6%,0)}
}
@keyframes agbg-mesh4 {
  0%,100%{transform:translate3d(0,0,0)}
  33%{transform:translate3d(-8%,8%,0)}
  66%{transform:translate3d(6%,4%,0)}
}
@keyframes agbg-liquid1 {
  0%,100%{border-radius:60% 40% 30% 70%/60% 30% 70% 40%;transform:translate3d(0,0,0) scale3d(1,1,1)}
  25%{border-radius:30% 60% 70% 40%/50% 60% 30% 60%;transform:translate3d(4%,-4%,0) scale3d(1.05,1.05,1)}
  50%{border-radius:50% 60% 30% 60%/40% 40% 60% 50%;transform:translate3d(-4%,4%,0) scale3d(0.96,0.96,1)}
  75%{border-radius:40% 60% 50% 40%/60% 70% 30% 50%;transform:translate3d(0,6%,0) scale3d(1.02,1.02,1)}
}
@keyframes agbg-liquid2 {
  0%,100%{border-radius:40% 60% 60% 40%/40% 60% 60% 40%;transform:translate3d(0,0,0) scale3d(1,1,1)}
  33%{border-radius:60% 40% 40% 60%/60% 40% 40% 60%;transform:translate3d(-6%,4%,0) scale3d(1.08,1.08,1)}
  66%{border-radius:50% 50% 60% 40%/50% 60% 40% 50%;transform:translate3d(6%,-4%,0) scale3d(0.94,0.94,1)}
}
@keyframes agbg-liquid3 {
  0%,100%{border-radius:70% 30% 50% 50%/50% 50% 70% 30%;transform:translate3d(0,0,0)}
  50%{border-radius:30% 70% 50% 50%/50% 50% 30% 70%;transform:translate3d(2%,-6%,0)}
}
@keyframes agbg-glow-pulse {
  0%,100%{transform:scale3d(1,1,1);opacity:0.85}
  50%{transform:scale3d(1.18,1.18,1);opacity:1}
}
@keyframes agbg-glow2 {
  0%,100%{transform:scale3d(1,1,1) translate3d(0,0,0);opacity:0.5}
  50%{transform:scale3d(1.1,1.1,1) translate3d(0,5%,0);opacity:0.8}
}
@keyframes agbg-ring-out {
  0%{transform:scale3d(0.4,0.4,1);opacity:0.9}
  100%{transform:scale3d(2.2,2.2,1);opacity:0}
}
@keyframes agbg-spotlight {
  0%{transform:translate3d(-30%,-30%,0)}
  25%{transform:translate3d(30%,-20%,0)}
  50%{transform:translate3d(20%,30%,0)}
  75%{transform:translate3d(-20%,20%,0)}
  100%{transform:translate3d(-30%,-30%,0)}
}
@keyframes agbg-ribbon1 {
  0%,100%{transform:translate3d(-6%,0,0) skewY(-1deg)}
  50%{transform:translate3d(6%,3%,0) skewY(1deg)}
}
@keyframes agbg-ribbon2 {
  0%,100%{transform:translate3d(4%,-2%,0) skewY(1deg)}
  50%{transform:translate3d(-4%,2%,0) skewY(-1deg)}
}
@keyframes agbg-ribbon3 {
  0%,100%{transform:translate3d(-2%,4%,0) skewY(0.5deg)}
  50%{transform:translate3d(2%,-4%,0) skewY(-0.5deg)}
}
@keyframes agbg-glass-spin {
  0%{transform:rotate(0deg) scale3d(1.8,1.8,1)}
  100%{transform:rotate(360deg) scale3d(1.8,1.8,1)}
}
@keyframes agbg-glass-shimmer {
  0%,100%{opacity:0.12;transform:translate3d(-120%,0,0)}
  50%{opacity:0.24}
  100%{opacity:0.12;transform:translate3d(120%,0,0)}
}
@keyframes agbg-hue-spin {
  0%{filter:hue-rotate(0deg)}
  100%{filter:hue-rotate(360deg)}
}
@keyframes agbg-dcs-shift {
  0%,100%{background-position:0% 50%}
  50%{background-position:100% 50%}
}
`;

/* ─── Style renderers ─── */

function FlowStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  const q1 = mixColor(c1, c2, 0.25);
  const q3 = mixColor(c1, c2, 0.75);
  const blobs = [
    { color: c1, size: "72%", top: "-18%", left: "-12%", anim: "agbg-flow1", dur: speed * 1.0, blur: 80, opacity: 0.8 },
    { color: c2, size: "70%", bottom: "-18%", right: "-12%", anim: "agbg-flow2", dur: speed * 1.1, blur: 80, opacity: 0.7 },
    { color: mid, size: "52%", top: "18%", left: "24%", anim: "agbg-flow3", dur: speed * 0.85, blur: 90, opacity: 0.4 },
    { color: q1, size: "44%", bottom: "10%", left: "10%", anim: "agbg-flow4", dur: speed * 1.3, blur: 70, opacity: 0.55 },
    { color: q3, size: "46%", top: "8%", right: "8%", anim: "agbg-flow5", dur: speed * 0.9, blur: 70, opacity: 0.5 },
  ];
  return (
    <>
      {blobs.map((b, i) => (
        <div key={i} style={{
          position: "absolute",
          ...( (b as any).top !== undefined ? { top: (b as any).top } : {}),
          ...( (b as any).bottom !== undefined ? { bottom: (b as any).bottom } : {}),
          ...( (b as any).left !== undefined ? { left: (b as any).left } : {}),
          ...( (b as any).right !== undefined ? { right: (b as any).right } : {}),
          width: b.size, height: b.size,
          borderRadius: "50%",
          background: b.color,
          filter: `blur(${b.blur}px)`,
          opacity: b.opacity,
          willChange: "transform",
          animation: `${b.anim} ${b.dur}s ease-in-out infinite`,
          animationPlayState: playState,
        }} />
      ))}
    </>
  );
}

function AuroraStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  const bands = [
    { color: c1, height: "38%", top: "-5%", opacity: 0.75, anim: "agbg-aurora1", dur: speed * 0.9 },
    { color: c2, height: "32%", top: "20%", opacity: 0.65, anim: "agbg-aurora2", dur: speed * 1.2 },
    { color: mid, height: "28%", top: "40%", opacity: 0.5, anim: "agbg-aurora3", dur: speed * 0.75 },
    { color: c1, height: "20%", top: "65%", opacity: 0.35, anim: "agbg-aurora4", dur: speed * 1.4 },
  ];
  return (
    <>
      {/* Dark base */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }} />
      {bands.map((b, i) => (
        <div key={i} style={{
          position: "absolute",
          left: "-10%", right: "-10%",
          top: b.top, height: b.height,
          background: `radial-gradient(ellipse 100% 60% at 50% 50%, ${b.color} 0%, transparent 80%)`,
          filter: "blur(40px)",
          opacity: b.opacity,
          willChange: "transform",
          animation: `${b.anim} ${b.dur}s ease-in-out infinite`,
          animationPlayState: playState,
        }} />
      ))}
    </>
  );
}

function MeshGradientStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  const q1 = mixColor(c1, c2, 0.25);
  const q3 = mixColor(c1, c2, 0.75);
  const nodes = [
    { color: c1,  left: "5%",  top: "5%",  size: "48%", anim: "agbg-mesh1", dur: speed * 0.85 },
    { color: c2,  left: "52%", top: "5%",  size: "46%", anim: "agbg-mesh2", dur: speed * 1.0 },
    { color: mid, left: "5%",  top: "50%", size: "44%", anim: "agbg-mesh3", dur: speed * 1.15 },
    { color: c2,  left: "52%", top: "50%", size: "48%", anim: "agbg-mesh4", dur: speed * 0.95 },
    { color: q1,  left: "25%", top: "25%", size: "52%", anim: "agbg-mesh1", dur: speed * 1.3 },
    { color: q3,  left: "30%", top: "30%", size: "40%", anim: "agbg-mesh2", dur: speed * 0.78 },
  ];
  return (
    <>
      {nodes.map((n, i) => (
        <div key={i} style={{
          position: "absolute",
          left: n.left, top: n.top,
          width: n.size, height: n.size,
          borderRadius: "50%",
          background: n.color,
          filter: "blur(50px)",
          opacity: 0.7,
          willChange: "transform",
          animation: `${n.anim} ${n.dur}s ease-in-out infinite`,
          animationPlayState: playState,
        }} />
      ))}
    </>
  );
}

function LiquidWavesStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  return (
    <>
      <div style={{
        position: "absolute", left: "-10%", top: "-10%", width: "70%", height: "70%",
        background: c1,
        filter: "blur(60px)", opacity: 0.82,
        willChange: "transform, border-radius",
        animation: `agbg-liquid1 ${speed}s ease-in-out infinite`,
        animationPlayState: playState,
      }} />
      <div style={{
        position: "absolute", right: "-10%", bottom: "-10%", width: "68%", height: "68%",
        background: c2,
        filter: "blur(60px)", opacity: 0.78,
        willChange: "transform, border-radius",
        animation: `agbg-liquid2 ${speed * 1.2}s ease-in-out infinite`,
        animationPlayState: playState,
      }} />
      <div style={{
        position: "absolute", left: "20%", top: "20%", width: "60%", height: "60%",
        background: mid,
        filter: "blur(80px)", opacity: 0.4,
        willChange: "transform, border-radius",
        animation: `agbg-liquid3 ${speed * 0.8}s ease-in-out infinite`,
        animationPlayState: playState,
      }} />
    </>
  );
}

function SoftGlowStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  return (
    <>
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        transform: "translate(-50%,-50%)",
        width: "90%", height: "90%",
        background: `radial-gradient(ellipse at center, ${c1} 0%, ${mid} 40%, transparent 75%)`,
        filter: "blur(50px)", opacity: 0.9,
        willChange: "transform",
        animation: `agbg-glow-pulse ${speed}s ease-in-out infinite`,
        animationPlayState: playState,
      }} />
      <div style={{
        position: "absolute", left: "50%", top: "60%",
        transform: "translate(-50%,-50%)",
        width: "70%", height: "60%",
        background: `radial-gradient(ellipse at center, ${c2} 0%, transparent 70%)`,
        filter: "blur(60px)", opacity: 0.65,
        willChange: "transform",
        animation: `agbg-glow2 ${speed * 1.3}s ease-in-out infinite`,
        animationPlayState: playState,
      }} />
    </>
  );
}

function RadialPulseStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  const rings = [
    { color: c1,  delay: 0 },
    { color: mid, delay: speed / 4 },
    { color: c2,  delay: speed / 2 },
    { color: c1,  delay: (speed * 3) / 4 },
  ];
  return (
    <>
      {/* Ambient fill */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(ellipse at center, ${mixColor(c1, c2, 0.3)} 0%, transparent 70%)`,
        filter: "blur(40px)", opacity: 0.5,
      }} />
      {rings.map((r, i) => (
        <div key={i} style={{
          position: "absolute",
          left: "50%", top: "50%",
          transform: "translate(-50%,-50%)",
          width: "60%", height: "60%",
          borderRadius: "50%",
          background: `radial-gradient(ellipse at center, ${r.color}88 0%, ${r.color}22 50%, transparent 75%)`,
          filter: "blur(20px)",
          willChange: "transform, opacity",
          animation: `agbg-ring-out ${speed}s ease-out infinite`,
          animationDelay: `${r.delay}s`,
          animationPlayState: playState,
        }} />
      ))}
    </>
  );
}

function MovingLightStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  return (
    <>
      {/* Dark ambient */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      {/* Ambient color fill */}
      <div style={{
        position: "absolute", left: "-10%", top: "-10%", width: "60%", height: "60%",
        background: c1, filter: "blur(90px)", opacity: 0.45, borderRadius: "50%",
      }} />
      <div style={{
        position: "absolute", right: "-10%", bottom: "-10%", width: "55%", height: "55%",
        background: c2, filter: "blur(90px)", opacity: 0.4, borderRadius: "50%",
      }} />
      {/* Moving spotlight */}
      <div style={{
        position: "absolute",
        left: "50%", top: "50%",
        transform: "translate(-50%,-50%)",
        width: "40%", height: "40%",
        background: `radial-gradient(circle at center, ${mid} 0%, ${c1}88 40%, transparent 75%)`,
        filter: "blur(30px)",
        opacity: 0.95,
        willChange: "transform",
        animation: `agbg-spotlight ${speed}s linear infinite`,
        animationPlayState: playState,
      }} />
      {/* Secondary spot (trailing) */}
      <div style={{
        position: "absolute",
        left: "50%", top: "50%",
        transform: "translate(-50%,-50%)",
        width: "24%", height: "24%",
        background: `radial-gradient(circle at center, #ffffff44 0%, transparent 70%)`,
        filter: "blur(20px)",
        opacity: 0.6,
        willChange: "transform",
        animation: `agbg-spotlight ${speed * 1.1}s linear infinite`,
        animationDelay: `${speed * 0.2}s`,
        animationPlayState: playState,
      }} />
    </>
  );
}

function AuroraRibbonStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  const ribbons = [
    { color: c1,  top: "10%", height: "30%", skew: "-8deg", anim: "agbg-ribbon1", dur: speed * 0.9, opacity: 0.75 },
    { color: c2,  top: "35%", height: "28%", skew: "-8deg", anim: "agbg-ribbon2", dur: speed * 1.2, opacity: 0.65 },
    { color: mid, top: "58%", height: "24%", skew: "-8deg", anim: "agbg-ribbon3", dur: speed * 0.75, opacity: 0.5 },
  ];
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      {ribbons.map((r, i) => (
        <div key={i} style={{
          position: "absolute",
          left: "-20%", right: "-20%",
          top: r.top, height: r.height,
          background: `linear-gradient(90deg, transparent 0%, ${r.color} 20%, ${r.color}cc 50%, ${r.color} 80%, transparent 100%)`,
          filter: "blur(35px)",
          transform: `skewY(${r.skew})`,
          opacity: r.opacity,
          willChange: "transform",
          animation: `${r.anim} ${r.dur}s ease-in-out infinite`,
          animationPlayState: playState,
        }} />
      ))}
    </>
  );
}

function GlassGradientStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  return (
    <>
      {/* Rotating conic base */}
      <div style={{
        position: "absolute",
        left: "50%", top: "50%",
        transform: "translate(-50%,-50%)",
        width: "100%", height: "100%",
        background: `conic-gradient(from 0deg at 50% 50%, ${c1}, ${c2}, ${c1})`,
        filter: "blur(2px)",
        willChange: "transform",
        animation: `agbg-glass-spin ${speed * 2}s linear infinite`,
        animationPlayState: playState,
      }} />
      {/* Frosted overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(135deg, ${c1}55 0%, transparent 50%, ${c2}55 100%)`,
        backdropFilter: "blur(0px)",
        opacity: 0.4,
      }} />
      {/* Shimmer sweep */}
      <div style={{
        position: "absolute", top: 0, bottom: 0, width: "35%",
        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
        willChange: "transform, opacity",
        animation: `agbg-glass-shimmer ${speed * 0.8}s ease-in-out infinite`,
        animationPlayState: playState,
      }} />
    </>
  );
}

function DynamicColorShiftStyle({ c1, c2, speed, playState }: { c1: string; c2: string; speed: number; playState: string }) {
  const mid = mixColor(c1, c2);
  return (
    <>
      {/* Full-screen animated gradient */}
      <div style={{
        position: "absolute", inset: "-10%",
        background: `linear-gradient(135deg, ${c1} 0%, ${mid} 25%, ${c2} 50%, ${mid} 75%, ${c1} 100%)`,
        backgroundSize: "400% 400%",
        willChange: "background-position, filter",
        animation: `agbg-dcs-shift ${speed}s ease infinite, agbg-hue-spin ${speed * 3}s linear infinite`,
        animationPlayState: playState,
      }} />
      {/* Overlay blobs for depth */}
      <div style={{
        position: "absolute", left: "20%", top: "20%", width: "60%", height: "60%",
        borderRadius: "50%",
        background: `radial-gradient(circle at center, rgba(255,255,255,0.18) 0%, transparent 70%)`,
        filter: "blur(40px)",
      }} />
    </>
  );
}

/* ─── Main component ─── */

export function AnimatedGradientBackground({
  active,
  color1: c1,
  color2: c2,
  opacity = 0.45,
  style = "Flow",
  speed = 30,
  blur = 80,
  brightness = 100,
  saturation = 100,
  rotation = 0,
  zoom = 110,
  animEnabled = true,
}: AnimatedGradientBgProps) {
  if (!active) return null;

  const playState = animEnabled ? "running" : "paused";
  const blurAmount = Math.max(0, Math.min(120, blur));

  const styleProps = { c1, c2, speed, playState };

  // Expanded inset to prevent blur edge bleed
  const expand = blurAmount > 0 ? Math.max(blurAmount, 20) : 0;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 0,
      pointerEvents: "none",
      overflow: "hidden",
    }}>
      <style>{KEYFRAMES}</style>
      {/* Filter layer — expanded so blurred edges stay hidden */}
      <div style={{
        position: "absolute",
        inset: `-${expand}px`,
        filter: [
          blurAmount > 0 ? `blur(${blurAmount}px)` : "",
          brightness !== 100 ? `brightness(${brightness}%)` : "",
          saturation !== 100 ? `saturate(${saturation}%)` : "",
        ].filter(Boolean).join(" ") || undefined,
        opacity,
        transform: `rotate(${rotation}deg) scale(${zoom / 100})`,
        transformOrigin: "center center",
        willChange: "transform",
      }}>
        {style === "Flow"                && <FlowStyle            {...styleProps} />}
        {style === "Aurora"              && <AuroraStyle          {...styleProps} />}
        {style === "Mesh Gradient"       && <MeshGradientStyle    {...styleProps} />}
        {style === "Liquid Waves"        && <LiquidWavesStyle     {...styleProps} />}
        {style === "Soft Glow"           && <SoftGlowStyle        {...styleProps} />}
        {style === "Radial Pulse"        && <RadialPulseStyle     {...styleProps} />}
        {style === "Moving Light"        && <MovingLightStyle     {...styleProps} />}
        {style === "Aurora Ribbon"       && <AuroraRibbonStyle    {...styleProps} />}
        {style === "Glass Gradient"      && <GlassGradientStyle   {...styleProps} />}
        {style === "Dynamic Color Shift" && <DynamicColorShiftStyle {...styleProps} />}
      </div>
    </div>
  );
}
