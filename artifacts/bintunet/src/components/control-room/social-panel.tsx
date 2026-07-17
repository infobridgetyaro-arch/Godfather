import { useState, useEffect, useCallback } from "react";
import { getAuthToken } from "@/lib/queryClient";
import { PlatformLogo, PLATFORM_BG, PLATFORM_ACCENT, PLATFORM_LIGHT } from "@/lib/platform-logos";

// ── Types ─────────────────────────────────────────────────────────────────────

type SocialPlatform =
  | "TikTok" | "Instagram" | "Facebook" | "YouTube"
  | "X" | "Twitter" | "Twitch" | "Snapchat" | "LinkedIn" | "Discord";

type SocialAnimation = "Spin" | "Slide" | "Flip" | "Pulse" | "Pop";

interface SocialHandle {
  platform: SocialPlatform | string;
  handle: string;
  enabled: boolean;
}

interface SocialOverlayState {
  active: boolean;
  handles: SocialHandle[];
  animation: SocialAnimation;
  rotateInterval: number;
  position: { x: number; y: number };
  scale: number;
}

// ── Platform config ───────────────────────────────────────────────────────────

const PLATFORMS: { name: SocialPlatform }[] = [
  { name: "TikTok"    },
  { name: "Instagram" },
  { name: "Facebook"  },
  { name: "YouTube"   },
  { name: "X"         },
  { name: "Twitch"    },
  { name: "Snapchat"  },
  { name: "LinkedIn"  },
  { name: "Discord"   },
];

const ANIMATIONS: { id: SocialAnimation; label: string; desc: string }[] = [
  { id: "Spin",  label: "⟳ Spin",  desc: "Logo spins in, pauses, spins to next" },
  { id: "Slide", label: "→ Slide", desc: "Card slides from right, exits left" },
  { id: "Flip",  label: "⟲ Flip",  desc: "Card flips over like a tile" },
  { id: "Pulse", label: "● Pulse", desc: "Gentle scale pulse on entry/exit" },
  { id: "Pop",   label: "✦ Pop",   desc: "Elastic pop-in with overshoot bounce" },
];

// ── API helpers ───────────────────────────────────────────────────────────────

function authHdr(): Record<string, string> {
  const tok = getAuthToken();
  return tok
    ? { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function apiGet() {
  const r = await fetch("/api/social-overlay", { credentials: "include", headers: authHdr() });
  if (!r.ok) throw new Error(`social-overlay GET: ${r.status}`);
  return r.json() as Promise<SocialOverlayState>;
}

async function apiPatch(body: Partial<SocialOverlayState & Record<string, unknown>>) {
  await fetch("/api/social-overlay", {
    method: "PATCH", credentials: "include", headers: authHdr(),
    body: JSON.stringify(body),
  });
}

async function apiAddHandle(platform: string, handle: string) {
  const r = await fetch("/api/social-overlay/handles", {
    method: "POST", credentials: "include", headers: authHdr(),
    body: JSON.stringify({ platform, handle }),
  });
  if (!r.ok) throw new Error("add handle failed");
  return r.json();
}

async function apiToggleHandle(idx: number, enabled: boolean) {
  await fetch(`/api/social-overlay/handles/${idx}`, {
    method: "PATCH", credentials: "include", headers: authHdr(),
    body: JSON.stringify({ enabled }),
  });
}

async function apiDeleteHandle(idx: number) {
  await fetch(`/api/social-overlay/handles/${idx}`, {
    method: "DELETE", credentials: "include", headers: authHdr(),
  });
}

// ── Mini preview card ─────────────────────────────────────────────────────────

function PlatformCard({ platform, handle, enabled }: SocialHandle) {
  const bg     = PLATFORM_BG[platform]     ?? "#333";
  const accent = PLATFORM_ACCENT[platform] ?? "#888";
  const light  = PLATFORM_LIGHT[platform]  ?? false;
  const textColor = light ? "#000" : "#fff";
  const subColor  = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      borderRadius: 18, overflow: "hidden", width: 260, height: 60,
      opacity: enabled ? 1 : 0.4,
      boxShadow: "0 4px 16px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06)",
    }}>
      {/* Logo slab */}
      <div style={{
        background: accent, width: 56, height: 60, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "so-card-spin 3s linear infinite",
      }}>
        <PlatformLogo platform={platform} size={26} color={light ? "#000" : "#fff"} />
      </div>
      {/* Info */}
      <div style={{
        background: bg, flex: 1, height: 60,
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "0 14px",
      }}>
        <div style={{ fontSize: 9, color: subColor, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
          {platform}
        </div>
        <div style={{ fontSize: 14, color: textColor, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
          {handle.startsWith("@") ? handle : `@${handle}`}
        </div>
      </div>
      <style>{`@keyframes so-card-spin { 0%{transform:rotate(0deg);} 100%{transform:rotate(360deg);} }`}</style>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SocialPanel() {
  const [state, setState] = useState<SocialOverlayState>({
    active: false, handles: [], animation: "Spin", rotateInterval: 8,
    position: { x: 2, y: 82 }, scale: 100,
  });
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [newPlatform, setNewPlatform]   = useState<SocialPlatform>("TikTok");
  const [newHandle, setNewHandle]       = useState("");
  const [addError, setAddError]         = useState("");

  const load = useCallback(() => {
    apiGet().then(setState).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (p: Partial<typeof state>) => {
    setState(prev => ({ ...prev, ...p }));
    setSaving(true);
    try { await apiPatch(p as Record<string, unknown>); } finally { setSaving(false); }
  }, []);

  const handleAdd = async () => {
    const h = newHandle.trim();
    if (!h) { setAddError("Enter a username/handle"); return; }
    setAddError("");
    setSaving(true);
    try {
      const res = await apiAddHandle(newPlatform, h);
      setState(prev => ({ ...prev, handles: res.handles }));
      setNewHandle("");
    } catch {
      setAddError("Failed to add — try again");
    } finally { setSaving(false); }
  };

  const handleToggle = async (idx: number) => {
    const updated = state.handles.map((h, i) => i === idx ? { ...h, enabled: !h.enabled } : h);
    setState(prev => ({ ...prev, handles: updated }));
    await apiToggleHandle(idx, updated[idx].enabled);
  };

  const handleDelete = async (idx: number) => {
    await apiDeleteHandle(idx);
    setState(prev => ({ ...prev, handles: prev.handles.filter((_, i) => i !== idx) }));
  };

  if (loading) {
    return <div style={{ padding: "20px 0", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Loading…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Status toggle ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => patch({ active: !state.active })}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700,
              cursor: "pointer", transition: "all 0.2s",
              border: `1px solid ${state.active ? "#ef4444" : "#4ade80"}`,
              background: state.active ? "rgba(239,68,68,0.15)" : "rgba(74,222,128,0.12)",
              color: state.active ? "#f87171" : "#4ade80",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: state.active ? "#ef4444" : "#4ade80", display: "block" }} />
            {state.active ? "Hide Overlay" : "Show Overlay"}
          </button>
          {saving && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Saving…</span>}
        </div>
        {state.active && state.handles.filter(h => h.enabled).length > 0 && (
          <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>
            ● LIVE — {state.handles.filter(h => h.enabled).length} handle{state.handles.filter(h => h.enabled).length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Handle list ── */}
      <Section label="Social Handles">
        {state.handles.length === 0 ? (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", padding: "8px 0" }}>
            No handles yet — add one below.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.handles.map((h, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 9,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
              }}>
                {/* Mini preview */}
                <PlatformCard {...h} />

                <div style={{ flex: 1 }} />

                {/* Enable/disable toggle */}
                <button
                  onClick={() => handleToggle(i)}
                  title={h.enabled ? "Disable" : "Enable"}
                  style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer", fontWeight: 600,
                    border: `1px solid ${h.enabled ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.1)"}`,
                    background: h.enabled ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.04)",
                    color: h.enabled ? "#4ade80" : "rgba(255,255,255,0.35)",
                  }}
                >{h.enabled ? "ON" : "OFF"}</button>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(i)}
                  style={{ fontSize: 12, color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Add new handle */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4, padding: "10px", borderRadius: 9, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Add Handle</div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* Platform picker */}
            <select
              value={newPlatform}
              onChange={e => setNewPlatform(e.target.value as SocialPlatform)}
              style={{ flex: "0 0 110px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, color: "#fff", fontSize: 11, padding: "6px 8px", cursor: "pointer" }}
            >
              {PLATFORMS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>

            {/* Handle input */}
            <input
              value={newHandle}
              onChange={e => setNewHandle(e.target.value)}
              placeholder="@username"
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 7, color: "#fff", fontSize: 11, padding: "6px 10px", outline: "none" }}
            />

            <button
              onClick={handleAdd}
              disabled={saving}
              style={{ padding: "6px 12px", borderRadius: 7, background: "rgba(102,126,234,0.2)", border: "1px solid rgba(102,126,234,0.4)", color: "#a5b4fc", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >Add</button>
          </div>
          {addError && <div style={{ fontSize: 10, color: "#f87171" }}>{addError}</div>}
        </div>
      </Section>

      {/* ── Animation style ── */}
      <Section label="Transition Animation">
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {ANIMATIONS.map(a => (
            <button
              key={a.id}
              onClick={() => patch({ animation: a.id })}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                border: `1px solid ${state.animation === a.id ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.07)"}`,
                background: state.animation === a.id ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.03)",
                color: state.animation === a.id ? "#c4b5fd" : "rgba(255,255,255,0.55)",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, minWidth: 72 }}>{a.label}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{a.desc}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* ── Rotate interval ── */}
      <Section label={`Rotate every ${state.rotateInterval}s`}>
        <input
          type="range" min={2} max={60} step={1}
          value={state.rotateInterval}
          onChange={e => setState(prev => ({ ...prev, rotateInterval: Number(e.target.value) }))}
          onMouseUp={e => patch({ rotateInterval: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={e => patch({ rotateInterval: Number((e.target as HTMLInputElement).value) })}
          style={{ width: "100%", accentColor: "#a78bfa", cursor: "pointer" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
          <span>2s (fast)</span><span>60s (1 min)</span>
        </div>
      </Section>

      {/* ── Scale ── */}
      <Section label={`Card Scale ${state.scale}%`}>
        <input
          type="range" min={50} max={200} step={5}
          value={state.scale}
          onChange={e => setState(prev => ({ ...prev, scale: Number(e.target.value) }))}
          onMouseUp={e => patch({ scale: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={e => patch({ scale: Number((e.target as HTMLInputElement).value) })}
          style={{ width: "100%", accentColor: "#a78bfa", cursor: "pointer" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
          <span>50%</span><span>200%</span>
        </div>
      </Section>

      {/* ── Position ── */}
      <Section label="Position (X / Y %)">
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>X: {state.position.x}%</div>
            <input type="range" min={0} max={90} step={1} value={state.position.x}
              onChange={e => setState(prev => ({ ...prev, position: { ...prev.position, x: Number(e.target.value) } }))}
              onMouseUp={e => patch({ position: { ...state.position, x: Number((e.target as HTMLInputElement).value) } })}
              onTouchEnd={e => patch({ position: { ...state.position, x: Number((e.target as HTMLInputElement).value) } })}
              style={{ width: "100%", accentColor: "#a78bfa", cursor: "pointer" }} />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Y: {state.position.y}%</div>
            <input type="range" min={0} max={96} step={1} value={state.position.y}
              onChange={e => setState(prev => ({ ...prev, position: { ...prev.position, y: Number(e.target.value) } }))}
              onMouseUp={e => patch({ position: { ...state.position, y: Number((e.target as HTMLInputElement).value) } })}
              onTouchEnd={e => patch({ position: { ...state.position, y: Number((e.target as HTMLInputElement).value) } })}
              style={{ width: "100%", accentColor: "#a78bfa", cursor: "pointer" }} />
          </div>
        </div>
      </Section>

      {/* ── Live preview ── */}
      {state.handles.filter(h => h.enabled).length > 0 && (
        <Section label="Preview">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 0" }}>
            {state.handles.filter(h => h.enabled).map((h, i) => (
              <PlatformCard key={i} {...h} />
            ))}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
            Cards rotate with <strong style={{ color: "rgba(255,255,255,0.45)" }}>{state.animation}</strong> animation every {state.rotateInterval}s.
          </div>
        </Section>
      )}

    </div>
  );
}
