import { useState, useEffect } from "react";
import { Play, Square, Image, Megaphone } from "lucide-react";

const STYLE_NAMES = ["Banner", "Card", "Corner Pop", "Fullscreen", "Strip"] as const;
type AdStyle = typeof STYLE_NAMES[number];

function BannerAd({ text, sub, active }: { text: string; sub: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 10, overflow: "hidden",
      transform: active ? "translateY(0)" : "translateY(-8px)",
      opacity: active ? 1 : 0.35,
      transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <div style={{
        background: "linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%)",
        padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div>
          <div style={{ color: "#fff", fontSize: 11, fontWeight: 700, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
            📣 Sponsored
          </div>
          <div style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>{active ? text : "Your Ad Headline Here"}</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 }}>{active ? sub : "Ad sub-text goes here"}</div>
        </div>
        <button style={{
          background: "#fff", color: "#764ba2",
          border: "none", borderRadius: 8,
          padding: "7px 16px", fontWeight: 800, fontSize: 12,
          cursor: "pointer", flexShrink: 0,
          boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        }}>
          Learn More →
        </button>
      </div>
    </div>
  );
}

function CardAd({ text, sub, active }: { text: string; sub: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 16,
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      border: "1px solid rgba(255,255,255,0.1)",
      padding: 20,
      textAlign: "center",
      transform: active ? "scale(1)" : "scale(0.95)",
      opacity: active ? 1 : 0.35,
      transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
      position: "relative", overflow: "hidden",
    }}>
      {active && (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse at 50% -20%, rgba(102,126,234,0.3) 0%, transparent 60%)",
        }} />
      )}
      <div style={{ position: "relative" }}>
        <div style={{
          width: 52, height: 52, borderRadius: 16,
          background: "linear-gradient(135deg, #667eea, #764ba2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 12px",
          boxShadow: active ? "0 0 24px rgba(102,126,234,0.5)" : "none",
          transition: "box-shadow 0.4s ease",
          animation: active ? "card-float 3s ease-in-out infinite" : "none",
        }}>
          <Megaphone size={24} color="#fff" />
        </div>
        <div style={{ color: "#fff", fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{active ? text : "Ad Card Title"}</div>
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, marginBottom: 14 }}>{active ? sub : "Supporting text"}</div>
        <button style={{
          background: "linear-gradient(90deg, #667eea, #764ba2)",
          color: "#fff", border: "none", borderRadius: 8,
          padding: "8px 24px", fontWeight: 700, fontSize: 12, cursor: "pointer",
        }}>
          Shop Now
        </button>
      </div>
      <style>{`@keyframes card-float { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-4px);} }`}</style>
    </div>
  );
}

function CornerAd({ text, active }: { text: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 10,
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      padding: 16, minHeight: 80,
      position: "relative",
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>Corner Pop Preview</div>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        background: "linear-gradient(135deg, #f6d365, #fda085)",
        borderRadius: 12, padding: "10px 14px",
        transform: active ? "scale(1) rotate(0deg)" : "scale(0.7) rotate(-8deg)",
        opacity: active ? 1 : 0.3,
        transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        animation: active ? "corner-bounce 2s ease-in-out infinite" : "none",
        boxShadow: active ? "0 8px 32px rgba(246,211,101,0.35)" : "none",
      }}>
        <span style={{ fontSize: 18 }}>🎉</span>
        <div>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 800 }}>{active ? text : "Special Offer!"}</div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 10 }}>Limited time only</div>
        </div>
      </div>
      <style>{`@keyframes corner-bounce { 0%,100%{transform:scale(1) rotate(0deg);} 50%{transform:scale(1.03) rotate(1deg);} }`}</style>
    </div>
  );
}

function FullscreenAd({ text, sub, active }: { text: string; sub: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 14,
      background: active
        ? "linear-gradient(135deg, #0f0c29, #302b63, #24243e)"
        : "linear-gradient(135deg, #1a1a2e, #16213e)",
      border: `1px solid ${active ? "rgba(102,126,234,0.4)" : "rgba(255,255,255,0.08)"}`,
      padding: "28px 20px",
      textAlign: "center",
      position: "relative", overflow: "hidden",
      transition: "all 0.6s ease",
    }}>
      {active && (
        <>
          <div style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(102,126,234,0.15)", animation: "orb1 4s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(240,147,251,0.12)", animation: "orb2 5s ease-in-out infinite" }} />
        </>
      )}
      <div style={{ position: "relative" }}>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>— Advertisement —</div>
        <div style={{
          color: active ? "#fff" : "rgba(255,255,255,0.3)",
          fontSize: 20, fontWeight: 900, marginBottom: 6,
          opacity: active ? 1 : 0.3,
          transition: "all 0.5s ease",
          animation: active ? "fade-in-up 0.6s ease forwards" : "none",
        }}>
          {active ? text : "Fullscreen Ad Title"}
        </div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginBottom: 16, opacity: active ? 1 : 0 }}>
          {active ? sub : ""}
        </div>
        <div style={{ opacity: active ? 1 : 0, transition: "opacity 0.5s ease 0.2s" }}>
          <button style={{
            background: "linear-gradient(90deg, #667eea, #f093fb)",
            color: "#fff", border: "none", borderRadius: 10,
            padding: "10px 28px", fontWeight: 800, fontSize: 13, cursor: "pointer",
            boxShadow: "0 8px 32px rgba(102,126,234,0.4)",
          }}>
            Get Started
          </button>
        </div>
      </div>
      <style>{`
        @keyframes orb1 { 0%,100%{transform:translate(0,0);} 50%{transform:translate(20px,15px);} }
        @keyframes orb2 { 0%,100%{transform:translate(0,0);} 50%{transform:translate(-15px,-10px);} }
        @keyframes fade-in-up { from{opacity:0;transform:translateY(10px);} to{opacity:1;transform:translateY(0);} }
      `}</style>
    </div>
  );
}

function StripAd({ text, active }: { text: string; active: boolean }) {
  return (
    <div style={{
      borderRadius: 10,
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      padding: 16,
    }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>Bottom Strip Preview</div>
      <div style={{
        background: "linear-gradient(90deg, #11998e, #38ef7d)",
        borderRadius: 8, padding: "10px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        transform: active ? "translateY(0)" : "translateY(20px)",
        opacity: active ? 1 : 0.25,
        transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        boxShadow: active ? "0 4px 20px rgba(56,239,125,0.3)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>🛍️</span>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{active ? text : "Strip Ad Text"}</span>
        </div>
        <button style={{
          background: "rgba(255,255,255,0.25)", color: "#fff",
          border: "1px solid rgba(255,255,255,0.4)", borderRadius: 6,
          padding: "4px 12px", fontWeight: 700, fontSize: 11, cursor: "pointer",
        }}>
          Tap Here
        </button>
      </div>
    </div>
  );
}

export function AdsPanel({ activeStreamCount }: { activeStreamCount: number }) {
  const [styleIdx, setStyleIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [adText, setAdText] = useState("Big Sale — 50% Off Today Only!");
  const [adSub, setAdSub] = useState("Use code LIVE at checkout. Limited stock.");

  const currentStyle = STYLE_NAMES[styleIdx];

  const renderPreview = () => {
    switch (currentStyle) {
      case "Banner": return <BannerAd text={adText} sub={adSub} active={playing} />;
      case "Card": return <CardAd text={adText} sub={adSub} active={playing} />;
      case "Corner Pop": return <CornerAd text={adText} active={playing} />;
      case "Fullscreen": return <FullscreenAd text={adText} sub={adSub} active={playing} />;
      case "Strip": return <StripAd text={adText} active={playing} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STYLE_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => { setStyleIdx(i); setPlaying(false); }}
              style={{
                padding: "4px 12px", borderRadius: 20,
                border: `1px solid ${styleIdx === i ? "#f093fb" : "rgba(255,255,255,0.12)"}`,
                background: styleIdx === i ? "rgba(240,147,251,0.15)" : "transparent",
                color: styleIdx === i ? "#f9a8d4" : "rgba(255,255,255,0.5)",
                fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease",
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPlaying((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px", borderRadius: 8,
            border: `1px solid ${playing ? "#e53e3e" : "#48bb78"}`,
            background: playing ? "rgba(229,62,62,0.15)" : "rgba(72,187,120,0.15)",
            color: playing ? "#fc8181" : "#68d391",
            fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease",
          }}
        >
          {playing ? <><Square size={11} /> Stop</> : <><Play size={11} /> Show Ad</>}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={adText}
          onChange={(e) => setAdText(e.target.value)}
          placeholder="Ad headline..."
          style={{
            flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none",
          }}
        />
        <input
          value={adSub}
          onChange={(e) => setAdSub(e.target.value)}
          placeholder="Sub-text..."
          style={{
            flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none",
          }}
        />
      </div>

      <div>{renderPreview()}</div>

      {playing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, background: "rgba(240,147,251,0.1)", border: "1px solid rgba(240,147,251,0.25)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#f9a8d4", animation: "pulse 1.2s infinite" }} />
          <span style={{ color: "#f9a8d4", fontSize: 11, fontWeight: 600 }}>
            {currentStyle} ad is LIVE on {activeStreamCount} stream{activeStreamCount !== 1 ? "s" : ""}
          </span>
          <style>{`@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>
        </div>
      )}
    </div>
  );
}
