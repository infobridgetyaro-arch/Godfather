import { useState, useEffect, useRef } from "react";
import { Play, Square, Coffee } from "lucide-react";

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

const STYLE_NAMES = ["Video", "Countdown", "Wave", "Glass", "Neon", "Minimal", "Gradient"] as const;
type BreakStyle = typeof STYLE_NAMES[number];

function useCountdown(active: boolean, initialSeconds: number) {
  const [secs, setSecs] = useState(initialSeconds);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      setSecs(initialSeconds);
      ref.current = setInterval(() => setSecs((v) => (v > 0 ? v - 1 : 0)), 1000);
    } else {
      if (ref.current) clearInterval(ref.current);
      setSecs(initialSeconds);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [active, initialSeconds]);

  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return { secs, display: `${m}:${s.toString().padStart(2, "0")}`, done: secs === 0 };
}

function CountdownBreak({ text, active, duration }: { text: string; active: boolean; duration: number }) {
  const { display, done } = useCountdown(active, duration);

  return (
    <div style={{
      borderRadius: 16, padding: "28px 20px", textAlign: "center",
      background: "linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)",
      border: `2px solid ${active ? "rgba(102,126,234,0.5)" : "rgba(255,255,255,0.08)"}`,
      position: "relative", overflow: "hidden",
      transition: "border-color 0.3s ease",
    }}>
      {active && (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 100%, rgba(102,126,234,0.2) 0%, transparent 70%)",
        }} />
      )}
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
          ☕ Taking a Break
        </div>
        <div style={{
          fontSize: 52, fontWeight: 900, fontVariantNumeric: "tabular-nums",
          color: done ? "#fc8181" : "#fff",
          animation: active && !done ? "countdown-tick 1s ease-in-out infinite alternate" : "none",
          marginBottom: 8,
          textShadow: active ? "0 0 40px rgba(102,126,234,0.6)" : "none",
        }}>
          {active ? display : "5:00"}
        </div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600 }}>
          {done ? "We're back! 🎉" : (active ? text : "Back soon…")}
        </div>
        {active && !done && (
          <div style={{ marginTop: 12, background: "rgba(255,255,255,0.08)", borderRadius: 100, height: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 100,
              background: "linear-gradient(90deg, #667eea, #a78bfa)",
              width: `${((duration - (active ? 0 : duration)) / duration) * 100}%`,
              transition: "width 1s linear",
            }} />
          </div>
        )}
      </div>
      <style>{`@keyframes countdown-tick { from{transform:scale(1);} to{transform:scale(1.03);} }`}</style>
    </div>
  );
}

function WaveBreak({ text, active }: { text: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 16, overflow: "hidden",
      background: "linear-gradient(180deg, #0f2027, #203a43, #2c5364)",
      border: "1px solid rgba(255,255,255,0.08)",
      position: "relative", minHeight: 120,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      {active && (
        <>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              position: "absolute", bottom: -20, left: "-10%", right: "-10%",
              height: 60, borderRadius: "50%",
              background: `rgba(44,83,100,${0.6 - i * 0.15})`,
              animation: `wave ${2 + i * 0.5}s ease-in-out infinite`,
              animationDelay: `${i * 0.3}s`,
            }} />
          ))}
        </>
      )}
      <div style={{ position: "relative", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 6 }}>🌊</div>
        <div style={{ color: "#fff", fontSize: 16, fontWeight: 800, opacity: active ? 1 : 0.3, transition: "opacity 0.4s" }}>
          {active ? text : "Be right back…"}
        </div>
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 4 }}>
          {active ? "Streaming resumes shortly" : "Preview"}
        </div>
      </div>
      <style>{`
        @keyframes wave {
          0%,100% { transform: translateY(0) scaleX(1); }
          50% { transform: translateY(-12px) scaleX(1.05); }
        }
      `}</style>
    </div>
  );
}

function GlassBreak({ text, active }: { text: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 16,
      background: "linear-gradient(135deg, #4158d0 0%, #c850c0 46%, #ffcc70 100%)",
      padding: 3,
      opacity: active ? 1 : 0.35,
      transition: "opacity 0.4s ease",
    }}>
      <div style={{
        borderRadius: 14,
        background: "rgba(10,10,20,0.7)",
        backdropFilter: "blur(24px)",
        padding: "24px 28px",
        textAlign: "center",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -30, right: -30,
          width: 120, height: 120, borderRadius: "50%",
          background: "rgba(192,80,192,0.2)",
          animation: active ? "glass-orb 4s ease-in-out infinite" : "none",
        }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>☕</div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
            {active ? text : "Taking a short break"}
          </div>
          <div style={{
            display: "inline-block", padding: "3px 12px", borderRadius: 100,
            background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)",
            color: "rgba(255,255,255,0.7)", fontSize: 11,
          }}>
            Back in a moment
          </div>
        </div>
      </div>
      <style>{`@keyframes glass-orb { 0%,100%{transform:translate(0,0);} 50%{transform:translate(-10px,10px);} }`}</style>
    </div>
  );
}

function NeonBreak({ text, active }: { text: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 16,
      background: "#050510",
      border: `2px solid ${active ? "#00fff0" : "rgba(255,255,255,0.06)"}`,
      padding: "24px 20px", textAlign: "center",
      boxShadow: active ? "0 0 30px rgba(0,255,240,0.2), inset 0 0 30px rgba(0,255,240,0.05)" : "none",
      transition: "all 0.5s ease",
      position: "relative", overflow: "hidden",
    }}>
      {active && (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% 50%, rgba(0,255,240,0.07) 0%, transparent 70%)",
          animation: "neon-pulse 2s ease-in-out infinite",
        }} />
      )}
      <div style={{ position: "relative" }}>
        <div style={{
          fontSize: 20, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase",
          color: active ? "#00fff0" : "rgba(0,255,240,0.3)",
          textShadow: active ? "0 0 10px #00fff0, 0 0 30px #00fff0, 0 0 60px rgba(0,255,240,0.5)" : "none",
          animation: active ? "neon-flicker 3s linear infinite" : "none",
          marginBottom: 8,
          transition: "all 0.5s ease",
        }}>
          {active ? text : "BRB — BACK SOON"}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
          {[0,1,2,3,4].map((i) => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#00fff0",
              boxShadow: active ? "0 0 8px #00fff0" : "none",
              opacity: active ? 1 : 0.2,
              animation: active ? `dot-bounce 1.2s ease-in-out ${i * 0.12}s infinite` : "none",
            }} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes neon-flicker { 0%,19%,21%,23%,25%,54%,56%,100% { opacity:1; } 20%,24%,55% { opacity:0.6; } }
        @keyframes neon-pulse { 0%,100%{opacity:0.5;} 50%{opacity:1;} }
        @keyframes dot-bounce { 0%,80%,100%{transform:scale(0.8);opacity:0.4;} 40%{transform:scale(1.2);opacity:1;} }
      `}</style>
    </div>
  );
}

function GradientBreak({ text, active, color1, color2 }: { text: string; active: boolean; color1: string; color2: string }) {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startRef.current = null;
      return;
    }
    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      setTick((ts - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active]);

  const cycle = active ? (Math.sin(tick * 0.6) + 1) / 2 : 0;
  const c1 = color1 || "#667eea";
  const c2 = color2 || "#f093fb";

  return (
    <div style={{
      borderRadius: 16, overflow: "hidden", position: "relative",
      background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
      padding: "28px 24px", textAlign: "center", minHeight: 120,
      opacity: active ? 1 : 0.4, transition: "opacity 0.4s ease",
    }}>
      {active && (
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: `radial-gradient(ellipse at ${30 + cycle * 40}% ${40 + cycle * 20}%, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 65%)`,
        }} />
      )}
      <div style={{ position: "relative" }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>☕</div>
        <div style={{
          color: "#fff", fontSize: 17, fontWeight: 900, marginBottom: 10,
          textShadow: "0 2px 14px rgba(0,0,0,0.35)",
        }}>
          {active ? text : "Be right back!"}
        </div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 16px", borderRadius: 100,
          background: "rgba(255,255,255,0.22)", backdropFilter: "blur(8px)",
        }}>
          {active && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "gradient-dot 1s infinite" }} />}
          <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>
            {active ? "Streaming resumes shortly" : "Preview"}
          </span>
        </div>
      </div>
      <style>{`@keyframes gradient-dot { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.4;transform:scale(0.7);} }`}</style>
    </div>
  );
}

function MinimalBreak({ text, active }: { text: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 12,
      background: "linear-gradient(135deg, #1a1a2e, #16213e)",
      border: "1px solid rgba(255,255,255,0.07)",
      padding: "20px 24px",
      display: "flex", alignItems: "center", gap: 16,
      opacity: active ? 1 : 0.35,
      transform: active ? "scale(1)" : "scale(0.98)",
      transition: "all 0.4s ease",
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: "rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: active ? "minimal-spin 6s linear infinite" : "none",
        border: "1px solid rgba(255,255,255,0.1)",
      }}>
        <Coffee size={20} style={{ color: "rgba(255,255,255,0.7)" }} />
      </div>
      <div>
        <div style={{ color: "#fff", fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
          {active ? text : "Taking a short break"}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: "50%",
              background: "rgba(255,255,255,0.4)",
              animation: active ? `dot-bounce 1.2s ease-in-out ${i * 0.2}s infinite` : "none",
            }} />
          ))}
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginLeft: 4 }}>
            {active ? "Back soon" : "Preview"}
          </span>
        </div>
      </div>
      <style>{`
        @keyframes minimal-spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        @keyframes dot-bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4;} 40%{transform:translateY(-4px);opacity:1;} }
      `}</style>
    </div>
  );
}

interface BsBrk {
  breakActive: boolean;
  breakText: string;
  breakStyle: string;
  breakVideoUrl: string;
  breakVideoMuted: boolean;
  liveAudioMuted: boolean;
  breakVideoPanX?: number;
  breakVideoPanY?: number;
  bgGradient1: string;
  bgGradient2: string;
}

interface BreakPanelProps {
  bs: BsBrk;
  localUpdate: (patch: Partial<BsBrk>) => void;
  update: (patch: Partial<BsBrk>) => void;
  goLive: (key: string, patch: Partial<BsBrk>) => void;
  cancelGoLive: (key: string) => void;
  stopOverlay: (patch: Partial<BsBrk>) => void;
  countdowns: Record<string, number>;
}

export function BreakPanel({ bs, localUpdate, update, goLive, cancelGoLive, stopOverlay, countdowns }: BreakPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const countdown = countdowns["break"];
  const isActive = bs.breakActive;
  const currentStyle = bs.breakStyle || "Countdown";

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("video", file);
      const res = await fetch("/api/upload/break-video", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();
      localUpdate({ breakVideoUrl: data.url });
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const renderPreview = () => {
    switch (currentStyle) {
      case "Video": {
        const ytEmbed = bs.breakVideoUrl ? getYouTubeEmbedUrl(bs.breakVideoUrl) : null;
        const ytId = bs.breakVideoUrl ? getYouTubeVideoId(bs.breakVideoUrl) : null;
        if (ytEmbed && ytId) {
          return (
            <div style={{ borderRadius: 10, overflow: "hidden", width: "100%", aspectRatio: "16/9", border: "1px solid rgba(255,255,255,0.08)", background: "#000" }}>
              <iframe
                src={`${ytEmbed}?autoplay=0&controls=1&modestbranding=1&rel=0`}
                allow="encrypted-media"
                allowFullScreen
                style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              />
            </div>
          );
        }
        return (
          <div style={{
            borderRadius: 10, overflow: "hidden", background: "#000",
            width: "100%", aspectRatio: "16/9", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 8,
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <div style={{ fontSize: 32 }}>▶</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              {bs.breakVideoUrl ? "Break video will fill screen" : "Upload a video or paste a YouTube link above"}
            </div>
          </div>
        );
      }
      case "Wave":    return <WaveBreak    text={bs.breakText} active={isActive} />;
      case "Glass":   return <GlassBreak   text={bs.breakText} active={isActive} />;
      case "Neon":    return <NeonBreak    text={bs.breakText} active={isActive} />;
      case "Minimal": return <MinimalBreak text={bs.breakText} active={isActive} />;
      case "Gradient": return <GradientBreak text={bs.breakText} active={isActive} color1={bs.bgGradient1} color2={bs.bgGradient2} />;
      default:        return <CountdownBreak text={bs.breakText} active={isActive} duration={300} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Break Style</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STYLE_NAMES.map((name) => (
            <button
              key={name}
              onClick={() => localUpdate({ breakStyle: name })}
              style={{
                padding: "4px 12px", borderRadius: 20,
                border: `1px solid ${currentStyle === name ? "#f59e0b" : "rgba(255,255,255,0.12)"}`,
                background: currentStyle === name ? "rgba(245,158,11,0.15)" : "transparent",
                color: currentStyle === name ? "#fcd34d" : "rgba(255,255,255,0.5)",
                fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease",
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {currentStyle === "Gradient" && (
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>Color 1</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="color" value={bs.bgGradient1} onChange={(e) => (bs.breakActive ? update : localUpdate)({ bgGradient1: e.target.value })}
                style={{ width: 36, height: 30, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", padding: 2 }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{bs.bgGradient1}</span>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>Color 2</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="color" value={bs.bgGradient2} onChange={(e) => (bs.breakActive ? update : localUpdate)({ bgGradient2: e.target.value })}
                style={{ width: 36, height: 30, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", padding: 2 }} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{bs.bgGradient2}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <div style={{ width: 48, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${bs.bgGradient1}, ${bs.bgGradient2})` }} />
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>Break Message</div>
        <input
          value={bs.breakText}
          onChange={(e) => localUpdate({ breakText: e.target.value })}
          placeholder="Be right back — taking a short break!"
          style={{
            width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>Break Video (optional — loops during break)</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={bs.breakVideoUrl}
            onChange={(e) => localUpdate({ breakVideoUrl: e.target.value })}
            placeholder="Paste a public HTTP/HTTPS URL, or upload a file…"
            style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none",
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              padding: "7px 13px", borderRadius: 8, fontSize: 11, fontWeight: 700,
              cursor: uploading ? "wait" : "pointer",
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap",
            }}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
          />
        </div>
        {uploadError && <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>{uploadError}</div>}
        {bs.breakVideoUrl && !uploadError && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>✓ Video set — will loop during break</div>
        )}
      </div>

      <div>{renderPreview()}</div>

      {/* XY pan controls — only for Video style */}
      {currentStyle === "Video" && (
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Video Position (Pan)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Horizontal</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{bs.breakVideoPanX ?? 50}%</span>
              </div>
              <input type="range" min="0" max="100" value={bs.breakVideoPanX ?? 50}
                onChange={(e) => update({ breakVideoPanX: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#f59e0b" }}
              />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Vertical</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{bs.breakVideoPanY ?? 50}%</span>
              </div>
              <input type="range" min="0" max="100" value={bs.breakVideoPanY ?? 50}
                onChange={(e) => update({ breakVideoPanY: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#f59e0b" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Audio mute controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => update({ breakVideoMuted: !bs.breakVideoMuted })}
          title="Mute / unmute break video audio in the browser display"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${bs.breakVideoMuted ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.15)"}`,
            background: bs.breakVideoMuted ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
            color: bs.breakVideoMuted ? "#fca5a5" : "rgba(255,255,255,0.6)",
            transition: "all 0.2s ease",
          }}
        >
          {bs.breakVideoMuted ? "🔇" : "🔊"} {bs.breakVideoMuted ? "Video Audio: Muted" : "Video Audio: On"}
        </button>
        <button
          onClick={() => update({ liveAudioMuted: !bs.liveAudioMuted })}
          title="Mute / unmute live stream audio in the RTMP output (triggers fast restart)"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${bs.liveAudioMuted ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.15)"}`,
            background: bs.liveAudioMuted ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
            color: bs.liveAudioMuted ? "#fca5a5" : "rgba(255,255,255,0.6)",
            transition: "all 0.2s ease",
          }}
        >
          {bs.liveAudioMuted ? "🔇" : "🔊"} {bs.liveAudioMuted ? "Live Audio: Muted" : "Live Audio: On"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {!isActive && countdown === undefined && (
          <button
            onClick={() => goLive("break", {
              breakActive: true,
              breakText: bs.breakText,
              breakStyle: currentStyle,
              breakVideoUrl: bs.breakVideoUrl,
            })}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: "linear-gradient(135deg,#f59e0b,#d97706)",
              border: "none", color: "#fff", boxShadow: "0 4px 14px rgba(245,158,11,0.35)",
            }}
          >
            <Play size={13} /> Go Live — Start Break
          </button>
        )}

        {countdown !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", color: "#fcd34d",
            }}>
              Starting in {countdown}s…
            </div>
            <button
              onClick={() => cancelGoLive("break")}
              style={{
                padding: "8px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {isActive && (
          <>
            <button
              onClick={() => stopOverlay({ breakActive: false })}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: "rgba(229,62,62,0.15)", border: "1px solid rgba(229,62,62,0.35)", color: "#fc8181",
              }}
            >
              <Square size={13} /> End Break
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(229,62,62,0.12)", border: "1px solid rgba(229,62,62,0.25)" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#e53e3e", animation: "cr-pulse 1s infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fc8181" }}>BREAK LIVE</span>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.12)", fontSize: 11, color: "rgba(255,255,255,0.38)", lineHeight: 1.6 }}>
        Style, text, and video are staged — applied with a 3-second countdown when you tap <strong style={{ color: "#fcd34d" }}>Go Live</strong>. The break video replaces the live source and loops until you end the break.
      </div>
      <style>{`@keyframes cr-pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>
    </div>
  );
}
