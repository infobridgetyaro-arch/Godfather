import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface BackgroundFallbackConfig {
  enabled: boolean;
  gradientColor1: string;
  gradientColor2: string;
  opacity: number;
  gradientAngle: number;
}

export function BackgroundFallbackPanel({
  onUpdate,
  enabled,
  gradientColor1,
  gradientColor2,
  opacity,
  gradientAngle,
}: {
  onUpdate: (config: Partial<BackgroundFallbackConfig>) => void;
  enabled: boolean;
  gradientColor1: string;
  gradientColor2: string;
  opacity: number;
  gradientAngle: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const accent = "#fb7185";

  // Quick presets
  const presets = [
    { label: "Midnight", c1: "#0f0c29", c2: "#302b63" },
    { label: "Sunset", c1: "#f7971e", c2: "#c71d6f" },
    { label: "Ocean", c1: "#0f2027", c2: "#2c5364" },
    { label: "Forest", c1: "#134e5e", c2: "#71b280" },
    { label: "Lava", c1: "#200122", c2: "#6f0000" },
    { label: "Neon", c1: "#08004a", c2: "#0057ff" },
  ];

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: enabled
            ? "rgba(251,113,133,0.08)"
            : "rgba(255,255,255,0.02)",
          transition: "all 0.3s ease",
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: enabled ? accent : "rgba(255,255,255,0.2)",
              boxShadow: enabled ? `0 0 10px ${accent}` : "none",
              animation: enabled ? "cr-pulse 1.4s infinite" : "none",
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: enabled ? "#fda4af" : "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Background Fallback Gradient
          </span>
        </div>
        <button
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            padding: 0,
            display: "flex",
          }}
        >
          {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>

      {/* Content */}
      {!collapsed && (
        <div style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Description */}
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "#fff" }}>Gradient stays behind the video output</strong> —
            visible when video ends, fails, or during transitions. Always running in the
            background, independent of break screens.
          </div>

          {/* Enable toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${enabled ? "rgba(251,113,133,0.3)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>
              Enable Background Fallback
            </span>
            <button
              onClick={() => onUpdate({ enabled: !enabled })}
              style={{
                width: 40,
                height: 22,
                borderRadius: 11,
                border: "none",
                background: enabled ? accent : "rgba(255,255,255,0.12)",
                cursor: "pointer",
                position: "relative",
                transition: "all 0.2s ease",
                padding: 0,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: enabled ? 20 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s ease",
                }}
              />
            </button>
          </div>

          {enabled && (
            <>
              {/* Gradient preview */}
              <div
                style={{
                  borderRadius: 10,
                  overflow: "hidden",
                  height: 60,
                  background: `linear-gradient(${gradientAngle}deg, ${gradientColor1}, ${gradientColor2})`,
                  opacity: opacity,
                  border: `1px solid ${accent}33`,
                }}
              />

              {/* Color pickers */}
              <div style={{ display: "flex", gap: 10 }}>
                {(["gradientColor1", "gradientColor2"] as const).map((field, i) => (
                  <div key={field} style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 9,
                        color: "rgba(255,255,255,0.3)",
                        marginBottom: 5,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }}
                    >
                      Color {i + 1}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="color"
                        value={field === "gradientColor1" ? gradientColor1 : gradientColor2}
                        onChange={(e) => onUpdate({ [field]: e.target.value })}
                        style={{
                          width: 40,
                          height: 32,
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.2)",
                          cursor: "pointer",
                          padding: 2,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "monospace",
                          color: "rgba(255,255,255,0.4)",
                        }}
                      >
                        {field === "gradientColor1" ? gradientColor1 : gradientColor2}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Opacity */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.4)",
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                    }}
                  >
                    Opacity
                  </span>
                  <span style={{ fontSize: 11, color: "#fda4af", fontWeight: 600 }}>
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => onUpdate({ opacity: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
                />
              </div>

              {/* Gradient angle */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.4)",
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                    }}
                  >
                    Angle
                  </span>
                  <span style={{ fontSize: 11, color: "#fda4af", fontWeight: 600 }}>
                    {gradientAngle}°
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={15}
                  value={gradientAngle}
                  onChange={(e) => onUpdate({ gradientAngle: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: accent, cursor: "pointer" }}
                />
              </div>

              {/* Presets */}
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.3)",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }}
                >
                  Quick Presets
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {presets.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() =>
                        onUpdate({ gradientColor1: preset.c1, gradientColor2: preset.c2 })
                      }
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 8px",
                        borderRadius: 20,
                        fontSize: 9,
                        fontWeight: 600,
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "transparent",
                        color: "rgba(255,255,255,0.6)",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: `linear-gradient(135deg, ${preset.c1}, ${preset.c2})`,
                          border: "1px solid rgba(255,255,255,0.2)",
                        }}
                      />
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Info box */}
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(251,113,133,0.05)",
                  border: "1px solid rgba(251,113,133,0.15)",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  lineHeight: 1.5,
                }}
              >
                🎨 <strong style={{ color: "#fda4af" }}>Always Active:</strong> This gradient renders
                continuously behind the video output. When your video ends or fails, the
                gradient remains visible instead of going black.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
