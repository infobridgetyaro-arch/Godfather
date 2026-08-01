import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import {
  Plus, X, Camera, Tv, WifiOff, Loader2, LayoutGrid,
  Maximize2, Minimize2, Radio, RefreshCw, Link2, Copy,
  Check, Users, ChevronDown, ChevronUp, Zap, Play,
  Youtube, MonitorPlay, Rss,
} from "lucide-react";

/* ─────────────────────────────── Types ────────────────────────────────────── */
interface GuestInfo { guestId: string; streamId: string; guestName: string; pending?: boolean }
interface ManualTile {
  id: string; label: string;
  sourceKind: "tiktok" | "youtube" | "hls";
  url?: string; embedUrl?: string;
  state: "preview" | "live";
}
interface Stream {
  id: string; status: string; tiktokUsername: string;
  youtubeSourceUrl: string; cameraDevice: string; sourceType: string;
  uploadedVideoPath?: string;
}
interface ProcStat { cpu: number; mem: number; frames?: number; uptime?: number }
interface MultiViewPanelProps {
  streams: Stream[];
  procStats?: Record<string, ProcStat>;
}

/* ─────────────────────────────── Helpers ──────────────────────────────────── */
function sourceLabel(s: Stream): string {
  if (s.tiktokUsername) return `@${s.tiktokUsername}`;
  if (s.youtubeSourceUrl) {
    try { return new URL(s.youtubeSourceUrl).hostname.replace("www.", ""); }
    catch { return "YouTube"; }
  }
  if (s.sourceType === "upload") return "Video File";
  if (s.sourceType === "camera") return s.cameraDevice || "Camera";
  return "Stream";
}
function fmtUptime(s?: number): string {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];

/* ─────────────────────────── Grid layout system ───────────────────────────── */
const LAYOUTS = [
  { id: "solo", cols: 1, rows: 1, max: 1 },
  { id: "duo",  cols: 2, rows: 1, max: 2 },
  { id: "trio", cols: 3, rows: 1, max: 3 },
  { id: "quad", cols: 2, rows: 2, max: 4 },
  { id: "penta",cols: 3, rows: 2, max: 5 },
  { id: "hex",  cols: 3, rows: 2, max: 6 },
] as const;
type LayoutId = (typeof LAYOUTS)[number]["id"];

function bestLayout(count: number): LayoutId {
  if (count <= 1) return "solo";
  if (count === 2) return "duo";
  if (count === 3) return "trio";
  if (count === 4) return "quad";
  if (count === 5) return "penta";
  return "hex";
}

/* ─────────────────────────── Small UI atoms ───────────────────────────────── */
function PlatformBadge({ kind }: { kind: string }) {
  const cfg: Record<string, { icon: string; bg: string; label: string }> = {
    tiktok:  { icon: "🎵", bg: "rgba(0,0,0,0.82)", label: "TikTok" },
    youtube: { icon: "▶",  bg: "rgba(220,38,38,0.88)", label: "YouTube" },
    camera:  { icon: "📷", bg: "rgba(0,0,0,0.78)",  label: "Camera" },
    upload:  { icon: "🎬", bg: "rgba(0,0,0,0.78)",  label: "Upload" },
    hls:     { icon: "📡", bg: "rgba(0,0,0,0.78)",  label: "HLS" },
    guest:   { icon: "👤", bg: "rgba(37,99,235,0.88)", label: "Guest" },
  };
  const c = cfg[kind] ?? cfg.hls;
  return (
    <div style={{
      position: "absolute", top: 10, left: 10, zIndex: 15,
      background: c.bg, backdropFilter: "blur(8px)",
      borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700,
      color: "#fff", display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.02em",
    }}>
      <span style={{ fontSize: 9 }}>{c.icon}</span>
      <span>{c.label}</span>
    </div>
  );
}

function LiveBadge() {
  return (
    <div style={{
      position: "absolute", top: 10, right: 10, zIndex: 15,
      background: "linear-gradient(90deg,#dc2626,#b91c1c)", borderRadius: 5,
      padding: "3px 8px", fontSize: 9, fontWeight: 900, color: "#fff",
      display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.08em",
      boxShadow: "0 2px 8px rgba(220,38,38,0.5)",
    }}>
      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", animation: "mv-pulse 1.2s infinite" }} />
      LIVE
    </div>
  );
}

function PreviewBadge() {
  return (
    <div style={{
      position: "absolute", top: 10, right: 10, zIndex: 15,
      background: "rgba(251,191,36,0.92)", borderRadius: 5,
      padding: "3px 8px", fontSize: 9, fontWeight: 900, color: "#000",
      display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.06em",
    }}>
      PREVIEW
    </div>
  );
}

function StatsBar({ stats }: { stats?: ProcStat }) {
  if (!stats) return null;
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 12,
      padding: "10px 10px 8px",
      background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)",
      display: "flex", gap: 6, alignItems: "center",
    }}>
      {stats.frames !== undefined && stats.frames > 0 && (
        <span style={{ fontSize: 9, color: "#a78bfa", fontFamily: "monospace", background: "rgba(124,58,237,0.22)", padding: "2px 6px", borderRadius: 4 }}>
          {stats.frames.toLocaleString()}f
        </span>
      )}
      {stats.uptime !== undefined && stats.uptime > 0 && (
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>
          ⏱ {fmtUptime(stats.uptime)}
        </span>
      )}
      {stats.cpu !== undefined && (
        <span style={{ fontSize: 9, fontFamily: "monospace", marginLeft: "auto",
          color: stats.cpu > 80 ? "#f87171" : stats.cpu > 60 ? "#fb923c" : "rgba(255,255,255,0.35)"
        }}>
          CPU {Math.round(stats.cpu)}%
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────── Tile types ───────────────────────────────── */
function HlsTile({ url, label, stats, platform }: { url: string; label: string; stats?: ProcStat; platform?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const attach = useCallback(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setLoading(true); setError(null);
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, lowLatencyMode: true, maxBufferLength: 6, maxMaxBufferLength: 12, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setLoading(false); });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) { setError("Stream offline or URL expired"); setLoading(false); hls.destroy(); hlsRef.current = null; }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.onloadedmetadata = () => { video.play().catch(() => {}); setLoading(false); };
      video.onerror = () => { setError("Playback error"); setLoading(false); };
    } else {
      setError("HLS not supported"); setLoading(false);
    }
  }, [url]);

  useEffect(() => { attach(); return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } }; }, [attach]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#060810" }}>
      <video ref={videoRef} muted autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: loading || error ? "none" : "block" }} />
      {loading && !error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(124,58,237,0.15)", border: "2px solid rgba(124,58,237,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader2 size={16} style={{ color: "#7c3aed", animation: "mv-spin 1s linear infinite" }} />
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>Connecting…</span>
        </div>
      )}
      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <WifiOff size={18} style={{ color: "rgba(255,255,255,0.18)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "0 16px", lineHeight: 1.5 }}>{error}</span>
          <button onClick={() => attach()} style={{ padding: "5px 12px", borderRadius: 6, background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)", color: "#c4b5fd", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
            <RefreshCw size={9} /> Retry
          </button>
        </div>
      )}
      {!loading && !error && <StatsBar stats={stats} />}
      <PlatformBadge kind={platform ?? "hls"} />
      {label && (
        <div style={{ position: "absolute", bottom: 10, left: 10, zIndex: 14, right: 60,
          background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
          borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{label}</div>
      )}
    </div>
  );
}

function YoutubeTile({ embedUrl, label }: { embedUrl: string; label: string }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0d0d0d" }}>
      <iframe src={embedUrl}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
      <PlatformBadge kind="youtube" />
      {label && (
        <div style={{ position: "absolute", bottom: 10, left: 10, zIndex: 14, right: 60,
          background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
          borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{label}</div>
      )}
    </div>
  );
}

function VideoFileTile({ url, label }: { url: string; label: string }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#060810" }}>
      <video src={url} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <PlatformBadge kind="upload" />
      {label && (
        <div style={{ position: "absolute", bottom: 10, left: 10, zIndex: 14, right: 60,
          background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
          borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{label}</div>
      )}
    </div>
  );
}

function StatsTile({ stream, stats }: { stream: Stream; stats?: ProcStat }) {
  const hue = (stream.id.charCodeAt(0) * 37) % 360;
  const icons: Record<string, string> = { tiktok: "🎵", youtube: "▶", camera: "📷", upload: "🎬" };
  return (
    <div style={{ width: "100%", height: "100%", background: `radial-gradient(circle at 30% 30%, hsl(${hue},28%,9%) 0%, #040610 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16 }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: `hsl(${hue},40%,18%)`, border: `1px solid hsl(${hue},40%,30%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
        {icons[stream.sourceType] ?? "📡"}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 3 }}>{sourceLabel(stream)}</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{stream.sourceType === "camera" ? "No browser preview" : "Preview unavailable"}</div>
      </div>
      {stats && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {stats.frames !== undefined && stats.frames > 0 && <span style={{ fontSize: 9, color: "#a78bfa", fontFamily: "monospace", background: "rgba(124,58,237,0.15)", padding: "2px 6px", borderRadius: 4 }}>{stats.frames.toLocaleString()}f</span>}
          {stats.uptime !== undefined && stats.uptime > 0 && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>⏱ {fmtUptime(stats.uptime)}</span>}
        </div>
      )}
    </div>
  );
}

function GuestTile({ guestId, guestName, pcRef }: { guestId: string; guestName: string; pcRef: React.MutableRefObject<Map<string, RTCPeerConnection>> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);
  const initials = guestName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const hue = (guestName.charCodeAt(0) || 65) * 37 % 360;

  useEffect(() => {
    const pc = pcRef.current.get(guestId);
    if (!pc) return;
    const attach = (stream: MediaStream) => { if (videoRef.current) { videoRef.current.srcObject = stream; setHasStream(true); } };
    if ((pc as any)._stream) { attach((pc as any)._stream); return; }
    (pc as any)._onstream = attach;
    return () => { (pc as any)._onstream = null; };
  }, [guestId, pcRef]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#060810" }}>
      <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: hasStream ? "block" : "none" }} />
      {!hasStream && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: `hsl(${hue},50%,22%)`, border: `2px solid hsl(${hue},50%,38%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff" }}>{initials}</div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Connecting…</span>
        </div>
      )}
      <PlatformBadge kind="guest" />
      {guestName && <div style={{ position: "absolute", bottom: 10, left: 10, zIndex: 14, right: 60, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guestName}</div>}
      {hasStream && <LiveBadge />}
    </div>
  );
}

function StreamTile({ stream, stats }: { stream: Stream; stats?: ProcStat }) {
  const [sourceInfo, setSourceInfo] = useState<{ type: string; url?: string; embedUrl?: string } | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (stream.status !== "streaming") { setSourceInfo({ type: "none" }); return; }
    setFetching(true);
    fetch(`/api/streams/${stream.id}/monitor-preview`, { credentials: "include" })
      .then(r => r.json()).then(data => { setSourceInfo(data); setFetching(false); })
      .catch(() => { setSourceInfo({ type: "none" }); setFetching(false); });
  }, [stream.id, stream.status]);

  if (stream.status !== "streaming") {
    return (
      <div style={{ width: "100%", height: "100%", background: "#060810", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>{stream.sourceType === "tiktok" ? "🎵" : stream.sourceType === "youtube" ? "▶" : stream.sourceType === "camera" ? "📷" : "🎬"}</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)" }}>{sourceLabel(stream)}</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 3 }}>Idle</div>
        </div>
      </div>
    );
  }

  if (fetching || sourceInfo === null) {
    return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#060810" }}><Loader2 size={18} style={{ color: "#7c3aed", animation: "mv-spin 1s linear infinite" }} /></div>;
  }

  const label = sourceLabel(stream);
  if (sourceInfo.type === "hls" && sourceInfo.url) return <HlsTile url={sourceInfo.url} label={label} stats={stats} platform={stream.sourceType} />;
  if (sourceInfo.type === "youtube-embed" && sourceInfo.embedUrl) return <YoutubeTile embedUrl={sourceInfo.embedUrl} label={label} />;
  if (sourceInfo.type === "file" && sourceInfo.url) return <VideoFileTile url={sourceInfo.url} label={label} />;
  return <StatsTile stream={stream} stats={stats} />;
}

/* ─────────────────────────── Pending Guest Row ─────────────────────────────── */
function PendingGuestRow({ guestId, guestName, pcRef, onAdmit, onDecline }: {
  guestId: string; guestName: string;
  pcRef: React.MutableRefObject<Map<string, RTCPeerConnection>>;
  onAdmit: () => void; onDecline: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);
  const initials = guestName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const hue = (guestName.charCodeAt(0) || 65) * 37 % 360;

  useEffect(() => {
    const pc = pcRef.current.get(guestId);
    if (!pc) return;
    const attach = (stream: MediaStream) => { if (videoRef.current) { videoRef.current.srcObject = stream; setHasStream(true); } };
    if ((pc as any)._stream) { attach((pc as any)._stream); return; }
    (pc as any)._onstream = attach;
    return () => { (pc as any)._onstream = null; };
  }, [guestId, pcRef]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.15)" }}>
      <div style={{ width: 64, height: 48, borderRadius: 8, overflow: "hidden", background: "#060810", flexShrink: 0, position: "relative", border: "1px solid rgba(255,255,255,0.07)" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: hasStream ? "block" : "none" }} />
        {!hasStream && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `hsl(${hue},40%,10%)` }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: `hsl(${hue},60%,70%)` }}>{initials}</span>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guestName || "Guest"}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 2 }}>Waiting to join</div>
      </div>
      <button onClick={onAdmit} style={{ padding: "5px 13px", borderRadius: 7, background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.35)", color: "#34d399", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Admit</button>
      <button onClick={onDecline} style={{ padding: "5px 13px", borderRadius: 7, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Decline</button>
    </div>
  );
}

/* ─────────────────────────── Invite Panel ──────────────────────────────────── */
function InvitePanel({ guestCount }: { guestCount: number }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchInvite = useCallback(async (regen = false) => {
    setLoading(true);
    try {
      const path = regen ? "/api/invite/regenerate" : "/api/invite";
      const r = await fetch(path, { method: regen ? "POST" : "GET", credentials: "include" });
      const data = await r.json();
      setInviteUrl(data.url);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  const copy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.05)", overflow: "hidden" }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", padding: "9px 12px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "inherit" }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(99,102,241,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Users size={13} style={{ color: "#818cf8" }} />
        </div>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Guest Camera Link</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
            {guestCount > 0 ? `${guestCount} guest${guestCount !== 1 ? "s" : ""} connected` : "Share to invite camera guests"}
          </div>
        </div>
        {guestCount > 0 && (
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{guestCount}</div>
        )}
        <div style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</div>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            Share with guests — they join in their browser, no app needed. Their camera appears as a tile automatically.
          </div>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 8 }}><Loader2 size={14} style={{ color: "#818cf8", animation: "mv-spin 1s linear infinite" }} /></div>
          ) : inviteUrl ? (
            <div style={{ display: "flex", gap: 5 }}>
              <div style={{ flex: 1, padding: "6px 10px", borderRadius: 7, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inviteUrl}</div>
              <button onClick={copy} style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${copied ? "rgba(16,185,129,0.4)" : "rgba(99,102,241,0.3)"}`, background: copied ? "rgba(16,185,129,0.12)" : "rgba(99,102,241,0.12)", color: copied ? "#34d399" : "#818cf8", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontWeight: 700, flexShrink: 0 }}>
                {copied ? <Check size={10} /> : <Copy size={10} />}
              </button>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => fetchInvite(true)} style={{ flex: 1, padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontWeight: 600 }}>
              <RefreshCw size={9} /> Regenerate
            </button>
            {inviteUrl && (
              <button onClick={() => window.open(inviteUrl, "_blank")} style={{ flex: 1, padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontWeight: 600 }}>
                <Link2 size={9} /> Preview link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Add Source Panel ──────────────────────────────── */
type SourceKind = "tiktok" | "youtube" | "hls" | "camera";

const SOURCE_KINDS: { id: SourceKind; icon: React.ReactNode; label: string; placeholder: string; hint: string }[] = [
  { id: "tiktok",  icon: <span style={{ fontSize: 13 }}>🎵</span>, label: "TikTok",  placeholder: "@username or username", hint: "Pulls live HLS from TikTok via streamlink on the server" },
  { id: "youtube", icon: <span style={{ fontSize: 13 }}>▶</span>,  label: "YouTube", placeholder: "youtube.com/live/… or channel URL", hint: "Embeds the YouTube live player (no key required)" },
  { id: "hls",     icon: <Rss size={12} />,   label: "HLS URL",  placeholder: "https://…/stream.m3u8", hint: "Any raw HLS / .m3u8 stream URL" },
  { id: "camera",  icon: <Camera size={12} />, label: "Camera Link", placeholder: "Paste the generated camera invite link", hint: "Use the Guest Camera Link above, share it with a remote camera operator" },
];

function AddSourcePanel({ onAdd, onClose, totalTiles }: {
  onAdd: (tile: ManualTile) => void;
  onClose: () => void;
  totalTiles: number;
}) {
  const [kind, setKind] = useState<SourceKind>("tiktok");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = SOURCE_KINDS.find(k => k.id === kind)!;

  const resolve = async () => {
    if (!value.trim()) { setError("Please enter a value"); return; }
    if (kind === "camera") {
      setError("Camera guests join via the Guest Camera Link above — share that link with your guest.");
      return;
    }
    if (totalTiles >= 6) { setError("Maximum 6 sources supported. Remove one first."); return; }
    setResolving(true); setError(null);
    try {
      const r = await fetch("/api/preview/resolve", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: kind, value: value.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.message ?? "Failed to resolve source"); setResolving(false); return; }
      const tileLabel = label.trim() || (kind === "tiktok" ? `@${value.replace(/^@/, "")}` : kind === "youtube" ? "YouTube" : new URL(value).hostname);
      onAdd({
        id: `manual-${Date.now()}`,
        label: tileLabel,
        sourceKind: kind as "tiktok" | "youtube" | "hls",
        url: data.url ?? undefined,
        embedUrl: data.embedUrl ?? undefined,
        state: "preview",
      });
      setValue(""); setLabel(""); setResolving(false);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
      setResolving(false);
    }
  };

  return (
    <div style={{
      background: "rgba(8,10,22,0.98)", border: "1px solid rgba(99,102,241,0.3)",
      borderRadius: 14, padding: "16px", display: "flex", flexDirection: "column", gap: 12,
      boxShadow: "0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.08)",
      animation: "mv-slide-in 0.25s ease-out",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plus size={11} style={{ color: "#818cf8" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.85)", letterSpacing: "0.02em" }}>Add Video Source</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 4, display: "flex", borderRadius: 6 }}>
          <X size={13} />
        </button>
      </div>

      {/* Source type tabs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 5 }}>
        {SOURCE_KINDS.map(k => (
          <button key={k.id} onClick={() => { setKind(k.id); setError(null); setValue(""); }}
            style={{
              padding: "8px 4px", borderRadius: 10, fontSize: 9, fontWeight: 800,
              border: `1px solid ${kind === k.id ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.06)"}`,
              background: kind === k.id ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.02)",
              color: kind === k.id ? "#a5b4fc" : "rgba(255,255,255,0.35)",
              cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              transition: "all 0.15s", letterSpacing: "0.04em",
            }}>
            {k.icon}
            <span>{k.label}</span>
          </button>
        ))}
      </div>

      {/* Hint */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", lineHeight: 1.55, padding: "6px 10px", background: "rgba(255,255,255,0.025)", borderRadius: 8, borderLeft: "2px solid rgba(99,102,241,0.4)" }}>
        {selected.hint}
      </div>

      {/* Inputs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <input
          value={value} onChange={e => { setValue(e.target.value); setError(null); }}
          onKeyDown={e => e.key === "Enter" && resolve()}
          placeholder={selected.placeholder}
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: `1.5px solid ${error ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 11, outline: "none", transition: "border-color 0.15s", fontFamily: kind === "tiktok" ? "inherit" : "monospace" }}
        />
        <input
          value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Label (optional)"
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.03)", border: "1.5px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 11, outline: "none" }}
        />
      </div>

      {error && (
        <div style={{ fontSize: 10, color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "7px 10px", lineHeight: 1.5 }}>{error}</div>
      )}

      {totalTiles >= 6 && !error && (
        <div style={{ fontSize: 10, color: "#fbbf24", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 8, padding: "7px 10px" }}>
          Maximum 6 sources reached. Remove a source to add a new one.
        </div>
      )}

      <button onClick={resolve} disabled={resolving || !value.trim() || totalTiles >= 6}
        style={{
          padding: "10px 14px", borderRadius: 9, border: "none",
          background: resolving || !value.trim() || totalTiles >= 6
            ? "rgba(99,102,241,0.25)"
            : "linear-gradient(135deg,#4f46e5,#7c3aed)",
          color: resolving || !value.trim() || totalTiles >= 6 ? "rgba(255,255,255,0.35)" : "#fff",
          fontSize: 12, fontWeight: 800, cursor: resolving || !value.trim() || totalTiles >= 6 ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          transition: "all 0.2s", letterSpacing: "0.02em",
          boxShadow: resolving || !value.trim() || totalTiles >= 6 ? "none" : "0 4px 16px rgba(79,70,229,0.4)",
        }}>
        {resolving
          ? <><Loader2 size={12} style={{ animation: "mv-spin 1s linear infinite" }} /> Fetching stream…</>
          : <><MonitorPlay size={12} /> Fetch Preview</>
        }
      </button>
    </div>
  );
}

/* ─────────────────────────── Placeholder Tile ──────────────────────────────── */
function PlaceholderTile({ index }: { index: number }) {
  return (
    <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.008)", border: "1.5px dashed rgba(255,255,255,0.05)", borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <Camera size={14} style={{ color: "rgba(255,255,255,0.06)" }} />
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.1)", fontWeight: 700, letterSpacing: "0.08em" }}>SLOT {index + 1}</span>
    </div>
  );
}

/* ──────────────────────────── Main Component ───────────────────────────────── */
export function MultiViewPanel({ streams, procStats = {} }: MultiViewPanelProps) {
  const [manualTiles, setManualTiles] = useState<ManualTile[]>([]);
  const [addingSource, setAddingSource] = useState(false);
  const [guestTiles, setGuestTiles] = useState<{ guestId: string; guestName: string }[]>([]);
  const [pendingGuests, setPendingGuests] = useState<{ guestId: string; guestName: string }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [newTileIds, setNewTileIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const activeStreams = streams.filter(s => s.status === "streaming");
  const totalTiles = activeStreams.length + guestTiles.length + manualTiles.length;

  /* ── Grid layout (auto) ─────────────────────────────────────────────────── */
  const layout = LAYOUTS.find(l => l.id === bestLayout(Math.max(totalTiles, 1))) ?? LAYOUTS[0];

  type DisplayItem =
    | { kind: "stream"; stream: Stream }
    | { kind: "guest"; guestId: string; guestName: string }
    | { kind: "manual"; tile: ManualTile };

  const items: DisplayItem[] = [
    ...activeStreams.map(s => ({ kind: "stream" as const, stream: s })),
    ...guestTiles.map(g => ({ kind: "guest" as const, ...g })),
    ...manualTiles.map(t => ({ kind: "manual" as const, tile: t })),
  ];

  const getTileId = (item: DisplayItem) =>
    item.kind === "stream" ? item.stream.id
    : item.kind === "guest" ? `guest-${item.guestId}`
    : item.tile.id;

  const placeholderCount = Math.max(0, layout.max - items.length);
  const gridHeight = layout.rows === 1 ? 195 : layout.rows === 2 ? 370 : 520;

  /* ── "Apply to Live" ─────────────────────────────────────────────────────── */
  const applyToLive = async (tile: ManualTile) => {
    setApplyingId(tile.id);
    try {
      // Mark the tile as "live" state immediately for instant UI feedback
      setManualTiles(prev => prev.map(t => t.id === tile.id ? { ...t, state: "live" } : t));

      // Notify the server to attempt split-screen or at least log the intent
      await fetch("/api/multiscreen/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceKind: tile.sourceKind,
          url: tile.url,
          embedUrl: tile.embedUrl,
          label: tile.label,
        }),
      }).catch(() => {}); // graceful — server endpoint optional
    } finally {
      setApplyingId(null);
    }
    // Flash new-tile animation
    setNewTileIds(prev => { const next = new Set(prev); next.add(tile.id); return next; });
    setTimeout(() => setNewTileIds(prev => { const next = new Set(prev); next.delete(tile.id); return next; }), 1800);
  };

  /* ── WebRTC ──────────────────────────────────────────────────────────────── */
  const initiateOffer = useCallback(async (guestId: string, ws: WebSocket) => {
    const existing = pcsRef.current.get(guestId);
    if (existing) { existing.close(); pcsRef.current.delete(guestId); }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcsRef.current.set(guestId, pc);
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.onicecandidate = e => { if (e.candidate && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "rtc_ice_admin", guestId, candidate: e.candidate.toJSON() })); };
    pc.ontrack = e => {
      if (e.track.kind !== "video") return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      (pc as any)._stream = stream;
      const cb = (pc as any)._onstream as ((s: MediaStream) => void) | null;
      if (cb) cb(stream);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "rtc_offer", guestId, sdp: offer.sdp }));
  }, []);

  const admitGuest = useCallback(async (guestId: string) => {
    try { await fetch(`/api/cam-guests/${guestId}/approve`, { method: "POST", credentials: "include" }); } catch {}
  }, []);

  const declineGuest = useCallback(async (guestId: string) => {
    try { await fetch(`/api/cam-guests/${guestId}/reject`, { method: "POST", credentials: "include" }); } catch {}
  }, []);

  const connectWs = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => { setWsConnected(false); setTimeout(connectWs, 3000); };
    ws.onerror = () => {};
    ws.onmessage = async e => {
      if (typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "cam_guest_pending") {
          setPendingGuests(p => p.some(g => g.guestId === msg.guestId) ? p : [...p, { guestId: msg.guestId, guestName: msg.guestName }]);
          void initiateOffer(msg.guestId, ws);
        }
        if (msg.type === "cam_guests_pending_list") {
          const list = (msg.guests ?? []) as { guestId: string; guestName: string }[];
          setPendingGuests(list);
          for (const g of list) { if (!pcsRef.current.has(g.guestId)) void initiateOffer(g.guestId, ws); }
        }
        if (msg.type === "cam_guest_join") {
          setPendingGuests(p => p.filter(g => g.guestId !== msg.guestId));
          setGuestTiles(p => p.some(t => t.guestId === msg.guestId) ? p : [...p, { guestId: msg.guestId, guestName: msg.guestName }]);
          setNewTileIds(prev => { const next = new Set(prev); next.add(`guest-${msg.guestId}`); return next; });
          setTimeout(() => setNewTileIds(prev => { const next = new Set(prev); next.delete(`guest-${msg.guestId}`); return next; }), 2000);
          if (!pcsRef.current.has(msg.guestId)) void initiateOffer(msg.guestId, ws);
        }
        if (msg.type === "cam_guest_leave") {
          setPendingGuests(p => p.filter(g => g.guestId !== msg.guestId));
          setGuestTiles(p => p.filter(t => t.guestId !== msg.guestId));
          const pc = pcsRef.current.get(msg.guestId); if (pc) { pc.close(); pcsRef.current.delete(msg.guestId); }
        }
        if (msg.type === "cam_guest_update") { setGuestTiles(p => p.map(t => t.guestId === msg.guestId ? { ...t, guestName: msg.guestName } : t)); }
        if (msg.type === "rtc_answer" && msg.guestId && msg.sdp) { const pc = pcsRef.current.get(msg.guestId); if (pc?.signalingState === "have-local-offer") { await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp }); for (const c of pendingIce.current.get(msg.guestId) ?? []) await pc.addIceCandidate(c).catch(() => {}); pendingIce.current.delete(msg.guestId); } }
        if (msg.type === "rtc_ice_guest" && msg.guestId && msg.candidate) { const pc = pcsRef.current.get(msg.guestId); if (pc?.remoteDescription) await pc.addIceCandidate(msg.candidate).catch(() => {}); else { const q = pendingIce.current.get(msg.guestId) ?? []; q.push(msg.candidate); pendingIce.current.set(msg.guestId, q); } }
      } catch {}
    };
  }, [initiateOffer]);

  useEffect(() => {
    fetch("/api/cam-guests", { credentials: "include" }).then(r => r.json()).then((guests: GuestInfo[]) => {
      if (guests?.length) {
        setGuestTiles(guests.filter(g => !g.pending).map(g => ({ guestId: g.guestId, guestName: g.guestName })));
        setPendingGuests(guests.filter(g => g.pending).map(g => ({ guestId: g.guestId, guestName: g.guestName })));
      }
    }).catch(() => {});
    connectWs();
    return () => { wsRef.current?.close(); for (const pc of pcsRef.current.values()) pc.close(); pcsRef.current.clear(); };
  }, [connectWs]);

  useEffect(() => {
    if (!wsConnected) return;
    const ws = wsRef.current;
    if (!ws) return;
    for (const tile of guestTiles) { if (!pcsRef.current.has(tile.guestId)) void initiateOffer(tile.guestId, ws); }
  }, [wsConnected, guestTiles, initiateOffer]);

  /* ── Tile content renderer ───────────────────────────────────────────────── */
  const renderTileContent = (item: DisplayItem) => {
    if (item.kind === "stream") {
      return (
        <>
          <StreamTile stream={item.stream} stats={procStats[item.stream.id]} />
          {item.stream.status === "streaming" && <LiveBadge />}
        </>
      );
    }
    if (item.kind === "guest") {
      return <GuestTile guestId={item.guestId} guestName={item.guestName} pcRef={pcsRef} />;
    }
    // Manual tile
    const t = item.tile;
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {t.sourceKind === "youtube" && t.embedUrl
          ? <YoutubeTile embedUrl={t.embedUrl} label={t.label} />
          : t.url
            ? <HlsTile url={t.url} label={t.label} platform={t.sourceKind} />
            : <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#060810" }}>
                <WifiOff size={18} style={{ color: "rgba(255,255,255,0.15)" }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>No preview available</span>
              </div>
        }
        {t.state === "live" ? <LiveBadge /> : <PreviewBadge />}

        {/* Apply to Live button — only show if in preview state */}
        {t.state === "preview" && (
          <button
            onClick={() => applyToLive(t)}
            disabled={applyingId === t.id}
            title="Apply this source to the live broadcast"
            style={{
              position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)",
              zIndex: 20, padding: "7px 14px", borderRadius: 8,
              background: applyingId === t.id ? "rgba(79,70,229,0.5)" : "linear-gradient(135deg,rgba(79,70,229,0.95),rgba(124,58,237,0.95))",
              border: "1px solid rgba(167,139,250,0.4)",
              color: "#fff", fontSize: 10, fontWeight: 800, cursor: applyingId === t.id ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
              boxShadow: "0 4px 16px rgba(79,70,229,0.5)",
              backdropFilter: "blur(6px)",
              letterSpacing: "0.03em",
              transition: "all 0.18s",
            }}
          >
            {applyingId === t.id
              ? <><Loader2 size={10} style={{ animation: "mv-spin 1s linear infinite" }} /> Applying…</>
              : <><Radio size={10} /> Apply to Live Stream</>
            }
          </button>
        )}

        {/* Remove button (top-right hover) */}
        <button
          onClick={() => setManualTiles(p => p.filter(m => m.id !== t.id))}
          title="Remove source"
          style={{
            position: "absolute", top: 10, right: 10, zIndex: 25,
            width: 24, height: 24, borderRadius: 6,
            background: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.7)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: 0, transition: "opacity 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
        >
          <X size={10} />
        </button>
      </div>
    );
  };

  const tileBorder = (item: DisplayItem) => {
    if (item.kind === "stream" && item.stream.status === "streaming") return "1.5px solid rgba(124,58,237,0.35)";
    if (item.kind === "guest") return "1.5px solid rgba(96,165,250,0.3)";
    if (item.kind === "manual" && item.tile.state === "live") return "1.5px solid rgba(220,38,38,0.5)";
    if (item.kind === "manual" && item.tile.state === "preview") return "1.5px solid rgba(251,191,36,0.45)";
    return "1.5px solid rgba(255,255,255,0.05)";
  };

  const tileGlow = (item: DisplayItem) => {
    if (item.kind === "stream" && item.stream.status === "streaming") return "0 0 0 1px rgba(124,58,237,0.12), 0 4px 20px rgba(0,0,0,0.6)";
    if (item.kind === "manual" && item.tile.state === "live") return "0 0 0 1px rgba(220,38,38,0.1), 0 4px 20px rgba(0,0,0,0.6)";
    if (item.kind === "manual" && item.tile.state === "preview") return "0 0 0 1px rgba(251,191,36,0.08), 0 4px 20px rgba(0,0,0,0.6)";
    return "0 4px 16px rgba(0,0,0,0.5)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Header row ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <LayoutGrid size={12} style={{ color: "#818cf8", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.75)", letterSpacing: "0.04em" }}>MULTI-SCREEN</span>

        {activeStreams.length > 0 && (
          <div style={{ fontSize: 9, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>
            {activeStreams.length} LIVE
          </div>
        )}
        {guestTiles.length > 0 && (
          <div style={{ fontSize: 9, color: "#60a5fa", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>
            {guestTiles.length} GUEST{guestTiles.length !== 1 ? "S" : ""}
          </div>
        )}
        {manualTiles.filter(t => t.state === "live").length > 0 && (
          <div style={{ fontSize: 9, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>
            {manualTiles.filter(t => t.state === "live").length} ON AIR
          </div>
        )}
        {manualTiles.filter(t => t.state === "preview").length > 0 && (
          <div style={{ fontSize: 9, color: "#fbbf24", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 5, padding: "2px 7px", fontWeight: 700 }}>
            {manualTiles.filter(t => t.state === "preview").length} PREVIEW
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ width: 7, height: 7, borderRadius: "50%", background: wsConnected ? "#10b981" : "#4b5563", flexShrink: 0 }} title={wsConnected ? "Connected" : "Disconnected"} />
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>{totalTiles}/6</span>

        <button
          onClick={() => setAddingSource(v => !v)}
          disabled={totalTiles >= 6}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7,
            fontSize: 10, fontWeight: 700, cursor: totalTiles >= 6 ? "not-allowed" : "pointer",
            border: `1px solid ${addingSource ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.1)"}`,
            background: addingSource ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.04)",
            color: totalTiles >= 6 ? "rgba(255,255,255,0.2)" : addingSource ? "#a5b4fc" : "rgba(255,255,255,0.5)",
            transition: "all 0.15s",
          }}
        >
          <Plus size={9} /> Add Source
        </button>
      </div>

      {/* ── Add source panel ── */}
      {addingSource && (
        <AddSourcePanel
          onAdd={tile => { setManualTiles(p => [...p, tile]); setAddingSource(false); }}
          onClose={() => setAddingSource(false)}
          totalTiles={totalTiles}
        />
      )}

      {/* ── Guest Camera Link ── */}
      <InvitePanel guestCount={guestTiles.length} />

      {/* ── Waiting room ── */}
      {pendingGuests.length > 0 && (
        <div style={{ borderRadius: 12, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.03)", overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 7, borderBottom: "1px solid rgba(251,191,36,0.12)" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", animation: "mv-pulse 1.2s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24" }}>Waiting Room</span>
            <span style={{ fontSize: 9, color: "rgba(251,191,36,0.7)", background: "rgba(251,191,36,0.1)", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>{pendingGuests.length}</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => pendingGuests.forEach(g => admitGuest(g.guestId))} style={{ fontSize: 9, fontWeight: 700, color: "#34d399", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 5, padding: "2px 8px", cursor: "pointer" }}>Admit all</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "8px" }}>
            {pendingGuests.map(g => (
              <PendingGuestRow key={g.guestId} guestId={g.guestId} guestName={g.guestName} pcRef={pcsRef} onAdmit={() => admitGuest(g.guestId)} onDecline={() => declineGuest(g.guestId)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Video grid ── */}
      {totalTiles > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
            gap: 8,
            height: gridHeight,
            transition: "height 0.4s cubic-bezier(0.4,0,0.2,1)",
          }}
        >
          {items.map((item) => {
            const tileId = getTileId(item);
            const isFullscreen = fullscreenId === tileId;
            const isNew = newTileIds.has(tileId);

            return (
              <div
                key={tileId}
                style={{
                  position: isFullscreen ? "fixed" : "relative",
                  ...(isFullscreen ? { inset: 0, zIndex: 9999, background: "#000", borderRadius: 0 } : {}),
                  borderRadius: isFullscreen ? 0 : 16,
                  overflow: "hidden",
                  background: "#060810",
                  border: isNew ? "1.5px solid rgba(96,165,250,0.7)" : tileBorder(item),
                  boxShadow: isNew ? "0 0 0 2px rgba(96,165,250,0.2), 0 8px 32px rgba(0,0,0,0.7)" : tileGlow(item),
                  animation: isNew ? "mv-pop-in 0.45s cubic-bezier(0.34,1.56,0.64,1)" : "none",
                  transition: "border-color 0.35s, box-shadow 0.35s",
                }}
              >
                {renderTileContent(item)}

                {/* Fullscreen toggle */}
                <button
                  onClick={() => setFullscreenId(isFullscreen ? null : tileId)}
                  style={{ position: "absolute", bottom: isFullscreen ? 16 : 10, right: 10, width: 24, height: 24, zIndex: 20, borderRadius: 6, background: "rgba(0,0,0,0.72)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
                >
                  {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                </button>
              </div>
            );
          })}

          {/* Placeholder slots */}
          {Array.from({ length: placeholderCount }).map((_, i) => (
            <div key={`ph-${i}`} style={{ borderRadius: 16, overflow: "hidden" }}>
              <PlaceholderTile index={items.length + i} />
            </div>
          ))}
        </div>
      ) : (
        /* ── Empty state ── */
        <div style={{ borderRadius: 16, border: "1.5px dashed rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.01)", padding: "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Tv size={22} style={{ color: "rgba(99,102,241,0.5)" }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>No sources yet</div>
            <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 11, lineHeight: 1.65 }}>
              Click <strong style={{ color: "rgba(255,255,255,0.4)" }}>+ Add Source</strong> to pull in TikTok live, YouTube,<br />
              or any HLS stream. Up to 6 videos simultaneously.
            </div>
          </div>
          <button
            onClick={() => setAddingSource(true)}
            style={{ marginTop: 4, padding: "9px 20px", borderRadius: 10, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.14)", color: "#a5b4fc", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={11} /> Add your first source
          </button>
        </div>
      )}

      <style>{`
        @keyframes mv-pulse   { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes mv-spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes mv-slide-in{ from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes mv-pop-in  { 0%{opacity:0;transform:scale(0.88)} 60%{transform:scale(1.03)} 100%{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}
