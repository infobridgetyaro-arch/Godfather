import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { Mic, MicOff, Video, VideoOff, WifiOff, Wifi, Users, Eye, Radio } from "lucide-react";

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
}

interface LiveStats {
  subs: string | null;
  viewers: string | null;
  status: string;
}

type StreamStatus = "idle" | "connecting" | "streaming" | "stopping" | "error";
type Phase = "lobby" | "waiting" | "studio";

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100dvh", background: "#07070f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ textAlign: "center", color: "rgba(255,255,255,0.45)", padding: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <WifiOff size={28} color="rgba(255,80,80,0.6)" />
        </div>
        <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>Unable to join</p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", maxWidth: 280 }}>{message}</p>
      </div>
    </div>
  );
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const hue = (name.charCodeAt(0) || 0) * 37 % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `hsl(${hue},60%,40%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.34, fontWeight: 800, color: "#fff",
    }}>
      {initials}
    </div>
  );
}

function ChatRow({ msg }: { msg: ChatMessage }) {
  const badgeColor = msg.isOwner ? "#f59e0b" : msg.isModerator ? "#6366f1" : msg.isMember ? "#10b981" : null;
  return (
    <div style={{ display: "flex", gap: 9, padding: "8px 14px", alignItems: "flex-start" }}>
      {msg.authorPhoto ? (
        <img src={msg.authorPhoto} alt="" style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, marginTop: 1, border: badgeColor ? `2px solid ${badgeColor}` : "1px solid rgba(255,255,255,0.1)" }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      ) : (
        <Avatar name={msg.authorName} size={28} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: badgeColor ?? "#a5b4fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.authorName}</span>
          {badgeColor && <span style={{ fontSize: 9, background: badgeColor, color: "#fff", padding: "1px 5px", borderRadius: 4, fontWeight: 800, letterSpacing: "0.04em" }}>{msg.isOwner ? "HOST" : msg.isModerator ? "MOD" : "MBR"}</span>}
        </div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.82)", lineHeight: 1.5, wordBreak: "break-word", margin: 0 }}>{msg.text}</p>
      </div>
    </div>
  );
}

function StatPill({ icon, value, label, color }: { icon: ReactNode; value: string | null; label: string; color: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7, padding: "8px 14px",
      borderRadius: 12, background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)", flex: 1,
    }}>
      <div style={{ color, display: "flex", alignItems: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
          {value ?? <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>—</span>}
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</div>
      </div>
    </div>
  );
}

export default function CameraPage() {
  const token = window.location.pathname.split("/camera/")[1]?.split("/")[0] ?? "";

  const [phase, setPhase] = useState<Phase>("lobby");
  const [guestName, setGuestName] = useState("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [authDone, setAuthDone] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasChat, setHasChat] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats>({ subs: null, viewers: null, status: "idle" });

  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const statsPollRef = useRef<NodeJS.Timeout | null>(null);
  const isStreamingRef = useRef(false);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [captureMode, setCaptureMode] = useState<"camera" | "screen">("camera");
  const captureModeRef = useRef<"camera" | "screen">("camera");

  const isStreaming = streamStatus === "streaming";
  const isConnecting = streamStatus === "connecting";

  // ── WebRTC: respond to admin's offer so admin multi-view shows our feed ──
  const handleRtcOffer = useCallback(async (sdp: string, ws: WebSocket) => {
    const stream = mediaStreamRef.current;
    if (!stream) return;

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peerConnectionRef.current = pc;

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "rtc_ice", candidate: e.candidate.toJSON() }));
      }
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "rtc_answer", sdp: answer.sdp }));
      }
    } catch {}
  }, []);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (!token) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws-cam`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: "cam_auth", token }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "cam_auth_ok") setAuthDone(true);
        if (msg.type === "cam_auth_fail") setAuthError(msg.message || "Invalid or expired camera link.");
        if (msg.type === "cam_error") { setStreamStatus("error"); setStatusMessage(`Error: ${msg.message}`); }
        if (msg.type === "cam_stopped") { setStreamStatus("idle"); isStreamingRef.current = false; setStatusMessage("Stream stopped by host."); }
        if (msg.type === "cam_pending") { setPhase("studio"); }
        if (msg.type === "cam_approved") { setPhase("studio"); }
        if (msg.type === "cam_rejected") {
          setPhase("lobby");
          setAuthError(msg.message || "The host declined your request to join.");
        }
        if (msg.type === "rtc_offer" && msg.sdp) { void handleRtcOffer(msg.sdp, ws); }
        if (msg.type === "rtc_ice" && msg.candidate) {
          peerConnectionRef.current?.addIceCandidate(msg.candidate).catch(() => {});
        }
      } catch {}
    };
    ws.onclose = () => {
      setWsConnected(false);
      if (isStreamingRef.current) { setStreamStatus("idle"); isStreamingRef.current = false; }
    };
    ws.onerror = () => {};
  }, [token, handleRtcOffer]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
    } catch (e: any) {
      setStatusMessage(`Camera denied: ${e.message}`);
    }
  }, []);

  const joinRoom = useCallback(async () => {
    if (!mediaStreamRef.current) await startCamera();
    // Go straight to studio — server auto-approves, no host approval step
    setPhase("studio");
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "cam_join", guestName: guestName.trim() || "Guest" }));
    }
  }, [startCamera, guestName]);

  // ── Streaming ──────────────────────────────────────────────────────────────
  const startStreaming = useCallback(async () => {
    const ws = wsRef.current;
    const stream = mediaStreamRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { connectWs(); return; }
    if (!stream) return;
    setStreamStatus("connecting");
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus" : "video/webm";
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
      recorder.onstart = () => { ws.send(JSON.stringify({ type: "cam_start" })); setStreamStatus("streaming"); isStreamingRef.current = true; setStatusMessage(""); };
      recorder.onerror = (e: any) => { setStreamStatus("error"); setStatusMessage(`Recorder error: ${e.error?.message || "Unknown"}`); };
      recorder.onstop = () => { if (isStreamingRef.current) { isStreamingRef.current = false; setStreamStatus("idle"); } };
      recorder.start(100);
    } catch (e: any) { setStreamStatus("error"); setStatusMessage(`Failed: ${e.message}`); }
  }, [connectWs]);

  const stopStreaming = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    const ws = wsRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cam_stop" }));
    mediaRecorderRef.current = null;
    isStreamingRef.current = false;
    setStreamStatus("idle");
  }, []);

  const toggleMic = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const next = !micEnabled;
    stream.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleVideo = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) return;
    const next = !videoEnabled;
    stream.getVideoTracks().forEach((t) => { t.enabled = next; });
    setVideoEnabled(next);
  }, [videoEnabled]);

  // ── Chat polling ───────────────────────────────────────────────────────────
  const fetchChat = useCallback(async () => {
    try {
      const res = await fetch(`/api/camera/${token}/chat`);
      if (!res.ok) return;
      const data = await res.json();
      setHasChat(data.hasChat);
      if (data.messages?.length) {
        const newMsgs = (data.messages as ChatMessage[]).filter((m) => !seenIds.current.has(m.id));
        if (newMsgs.length) {
          newMsgs.forEach((m) => seenIds.current.add(m.id));
          setMessages((prev) => [...prev, ...newMsgs].slice(-200));
        }
      }
    } catch {}
  }, [token]);

  // ── Stats polling ──────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/camera/${token}/stats`);
      if (!res.ok) return;
      const data = await res.json();
      setLiveStats(data);
    } catch {}
  }, [token]);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) { setAuthError("Invalid camera link."); return; }
    connectWs();
    return () => {
      stopStreaming();
      wsRef.current?.close();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (pollRef.current) clearInterval(pollRef.current);
      if (statsPollRef.current) clearInterval(statsPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!authDone) return;
    // Start camera preview immediately so the user can see themselves before joining
    startCamera().catch(() => {});
    fetchChat();
    fetchStats();
    pollRef.current = setInterval(fetchChat, 5000);
    statsPollRef.current = setInterval(fetchStats, 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (statsPollRef.current) clearInterval(statsPollRef.current);
    };
  }, [authDone, fetchChat, fetchStats, startCamera]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (authError) return <ErrorScreen message={authError} />;

  // ─────────────────────────────────────────────────────────────────────────
  // LOBBY PHASE
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "lobby") {
    return (
      <div style={{
        minHeight: "100dvh",
        background: "radial-gradient(ellipse at 25% 15%, rgba(99,102,241,0.2) 0%, transparent 50%), radial-gradient(ellipse at 75% 85%, rgba(139,92,246,0.14) 0%, transparent 50%), #07070f",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif", padding: 24,
      }}>
        {/* Brand */}
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 22, margin: "0 auto 16px",
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 12px 40px rgba(99,102,241,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}>
            <Video size={32} color="#fff" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.5px" }}>BintuNet Live Studio</h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", margin: 0, letterSpacing: "0.02em" }}>Guest camera input</p>
        </div>

        {/* Live camera preview */}
        {authDone && (
          <div style={{
            width: "100%", maxWidth: 420, marginBottom: 20,
            borderRadius: 20, overflow: "hidden",
            background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.08)",
            aspectRatio: "16/9",
            position: "relative",
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }}
            />
            <div style={{
              position: "absolute", top: 10, left: 10,
              padding: "3px 10px", borderRadius: 999,
              background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
              fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.6)",
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              Preview
            </div>
          </div>
        )}

        {/* Card */}
        <div style={{
          width: "100%", maxWidth: 420, borderRadius: 24,
          background: "rgba(255,255,255,0.035)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(32px)",
          boxShadow: "0 32px 96px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
          padding: 32,
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "0 0 8px", letterSpacing: "-0.2px" }}>Ready to go live?</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: "0 0 28px", lineHeight: 1.6 }}>
            Your camera and mic feed directly into the broadcast. The host controls routing and output.
          </p>

          <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", display: "block", marginBottom: 8, textTransform: "uppercase" }}>
            Your name (optional)
          </label>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && wsConnected && authDone) joinRoom(); }}
            placeholder="e.g. Jane Smith"
            maxLength={48}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "12px 16px", borderRadius: 14, fontSize: 15,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#fff", outline: "none", marginBottom: 24,
              fontFamily: "inherit", transition: "border-color 0.18s",
            }}
          />

          {/* Connection indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
              background: wsConnected ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${wsConnected ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)"}`,
            }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: wsConnected ? "#10b981" : "rgba(255,255,255,0.2)",
                animation: wsConnected ? undefined : "blink 1.4s infinite",
              }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: wsConnected ? "#6ee7b7" : "rgba(255,255,255,0.3)", letterSpacing: "0.02em" }}>
                {wsConnected ? (authDone ? "Room ready" : "Authenticating…") : "Connecting to server…"}
              </span>
            </div>
          </div>

          <button
            onClick={joinRoom}
            disabled={!wsConnected || !authDone}
            style={{
              width: "100%", padding: "15px 0", borderRadius: 16, fontSize: 16, fontWeight: 900,
              cursor: wsConnected && authDone ? "pointer" : "not-allowed",
              background: wsConnected && authDone
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : "rgba(255,255,255,0.05)",
              border: "none", color: wsConnected && authDone ? "#fff" : "rgba(255,255,255,0.2)",
              boxShadow: wsConnected && authDone ? "0 8px 28px rgba(99,102,241,0.5), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
              transition: "all 0.2s ease", letterSpacing: "0.01em",
            }}
          >
            {wsConnected && authDone ? "Join Room" : "Connecting…"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", margin: 0 }}>
              Camera preview shows above — tap Join to go live
            </p>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WAITING PHASE — camera on, waiting for host approval
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "waiting") {
    const initials = (guestName || "Guest").trim().split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
    return (
      <div style={{
        minHeight: "100dvh",
        background: "radial-gradient(ellipse at 50% 30%, rgba(99,102,241,0.18) 0%, transparent 60%), #07070f",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif", padding: 24,
      }}>
        {/* Camera preview (small, so they know it's on) */}
        <div style={{ width: 160, height: 120, borderRadius: 16, overflow: "hidden", background: "#0d0d1a", border: "2px solid rgba(99,102,241,0.3)", marginBottom: 32, position: "relative", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
          <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.65)", padding: "2px 8px", borderRadius: 5, letterSpacing: "0.05em" }}>CAMERA ON</div>
          </div>
        </div>

        {/* Waiting card */}
        <div style={{ width: "100%", maxWidth: 380, borderRadius: 24, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", padding: "32px 28px", textAlign: "center" }}>
          {/* Spinner / avatar */}
          <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 20px" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(99,102,241,0.15)" }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#6366f1", animation: "spin 1s linear infinite" }} />
            <div style={{ position: "absolute", inset: 4, borderRadius: "50%", background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#a5b4fc" }}>
              {initials || "?"}
            </div>
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 900, color: "#fff", margin: "0 0 8px", letterSpacing: "-0.3px" }}>Waiting for host</h2>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", margin: "0 0 24px", lineHeight: 1.6 }}>
            The host will admit you shortly. Your camera is on and ready.
          </p>

          {/* Animated dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 7 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>

          {/* Cancel */}
          <button
            onClick={() => { setPhase("lobby"); wsRef.current?.close(); setTimeout(connectWs, 100); }}
            style={{ marginTop: 28, fontSize: 12, color: "rgba(255,255,255,0.25)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Cancel and go back
          </button>
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes bounce { 0%,80%,100% { transform: scale(0.6); opacity: 0.35; } 40% { transform: scale(1); opacity: 1; } }
          @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
        `}</style>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STUDIO PHASE
  // ─────────────────────────────────────────────────────────────────────────
  const canStream = cameraReady && wsConnected && authDone && !isConnecting;
  const streamIsLive = liveStats.status === "streaming";

  return (
    <div style={{
      minHeight: "100dvh",
      height: "100dvh",
      background: "#07070f",
      display: "flex", flexDirection: "column",
      fontFamily: "system-ui, -apple-system, sans-serif",
      color: "#fff",
      overflow: "hidden",
    }}>
      {/* ── Top bar ── */}
      <header style={{
        padding: "0 16px",
        height: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(7,7,15,0.95)",
        backdropFilter: "blur(20px)",
        flexShrink: 0,
        gap: 12,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
            flexShrink: 0,
          }}>
            <Video size={16} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.2px" }}>BintuNet Studio</div>
            {guestName && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{guestName}</div>}
          </div>
        </div>

        {/* Status pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Broadcast status */}
          {streamIsLive && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
              borderRadius: 999, background: "rgba(220,38,38,0.15)",
              border: "1px solid rgba(220,38,38,0.3)",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "redpulse 1s infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: "#fc8181", letterSpacing: "0.06em" }}>BROADCAST LIVE</span>
            </div>
          )}
          {/* Cam on air */}
          {isStreaming && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
              borderRadius: 999, background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.3)",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "redpulse 1s infinite" }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: "#a5b4fc", letterSpacing: "0.06em" }}>CAM ON AIR</span>
            </div>
          )}
          {/* WS status */}
          <div style={{
            display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 999,
            background: wsConnected ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
            border: `1px solid ${wsConnected ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}>
            {wsConnected ? <Wifi size={10} color="#10b981" /> : <WifiOff size={10} color="#f87171" />}
            <span style={{ fontSize: 10, fontWeight: 700, color: wsConnected ? "#6ee7b7" : "#f87171" }}>
              {wsConnected ? "Connected" : "Offline"}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main content: camera + sidebar ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

        {/* ── Camera panel ── */}
        <div style={{
          flex: "1 1 0",
          position: "relative",
          background: "#0c0c18",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%", height: "100%", objectFit: "cover",
              display: cameraReady ? "block" : "none",
              transform: "scaleX(-1)",
            }}
          />

          {/* Camera not ready placeholder */}
          {!cameraReady && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(135deg, #0d0d1e, #181828)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
            }}>
              <div style={{
                width: 80, height: 80, borderRadius: 22,
                background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Video size={36} color="rgba(99,102,241,0.6)" />
              </div>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", textAlign: "center", padding: "0 32px", lineHeight: 1.6 }}>
                Allow camera access, then tap Enable Camera
              </p>
              <button
                onClick={startCamera}
                style={{
                  padding: "12px 28px", borderRadius: 14, fontSize: 14, fontWeight: 800,
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  border: "none", color: "#fff", cursor: "pointer",
                  boxShadow: "0 6px 20px rgba(99,102,241,0.45)",
                }}
              >
                Enable Camera
              </button>
            </div>
          )}

          {/* Video-off overlay */}
          {cameraReady && !videoEnabled && (
            <div style={{
              position: "absolute", inset: 0, background: "#0d0d1e",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
            }}>
              {guestName && <Avatar name={guestName} size={64} />}
              {!guestName && <VideoOff size={36} color="rgba(255,255,255,0.2)" />}
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>Camera off</p>
            </div>
          )}

          {/* LIVE badge overlay */}
          {isStreaming && (
            <div style={{
              position: "absolute", top: 14, left: 14,
              display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
              borderRadius: 999, background: "rgba(220,38,38,0.9)", backdropFilter: "blur(8px)",
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "redpulse 0.9s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em" }}>LIVE</span>
            </div>
          )}

          {/* Guest name badge */}
          {guestName && cameraReady && (
            <div style={{
              position: "absolute", bottom: 14, left: 14,
              padding: "5px 12px", borderRadius: 10,
              background: "rgba(0,0,0,0.65)", backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 12, fontWeight: 700,
            }}>
              {guestName}
            </div>
          )}

          {/* Mic-off indicator */}
          {cameraReady && !micEnabled && (
            <div style={{
              position: "absolute", bottom: 14, right: 14,
              width: 36, height: 36, borderRadius: "50%",
              background: "rgba(220,38,38,0.85)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <MicOff size={16} color="#fff" />
            </div>
          )}
        </div>

        {/* ── Right sidebar: stats + chat ── */}
        <div style={{
          width: 320,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.014)",
          overflow: "hidden",
        }}>
          {/* Stats section */}
          <div style={{ padding: "14px 14px 0", flexShrink: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)",
              letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Radio size={10} />
              YouTube Live Stats
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <StatPill icon={<Users size={14} />} value={liveStats.subs} label="Subscribers" color="#a5b4fc" />
              <StatPill icon={<Eye size={14} />} value={liveStats.viewers} label="Viewers" color="#34d399" />
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />

          {/* Chat section */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Chat header */}
            <div style={{
              padding: "10px 14px 8px",
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
              flexShrink: 0,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Live Chat
              {hasChat && (
                <span style={{ marginLeft: "auto", color: "#10b981", fontSize: 8, fontWeight: 800, letterSpacing: "0.06em" }}>● LIVE</span>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {!hasChat ? (
                <div style={{ padding: "24px 16px", textAlign: "center" }}>
                  <div style={{
                    padding: "14px 16px", borderRadius: 12, fontSize: 12, lineHeight: 1.6,
                    background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)",
                    color: "rgba(255,255,255,0.3)",
                  }}>
                    {isStreaming
                      ? "No YouTube chat found for this stream. Add a YouTube Channel ID in the stream settings."
                      : "Chat appears once the broadcast is live with a connected YouTube channel."}
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div style={{ padding: "28px 16px", textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
                  Waiting for messages…
                </div>
              ) : (
                messages.map((msg) => <ChatRow key={msg.id} msg={msg} />)
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls bar ── */}
      <div style={{
        flexShrink: 0,
        background: "rgba(7,7,15,0.97)",
        backdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        padding: "12px 16px 16px",
      }}>
        {statusMessage && (
          <div style={{
            maxWidth: 640, margin: "0 auto 10px",
            padding: "8px 14px", borderRadius: 10, fontSize: 12,
            background: streamStatus === "error" ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${streamStatus === "error" ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.08)"}`,
            color: streamStatus === "error" ? "#f87171" : "rgba(255,255,255,0.45)",
          }}>
            {statusMessage}
          </div>
        )}

        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", gap: 10, alignItems: "center" }}>
          {/* Mic toggle */}
          <button
            onClick={toggleMic}
            disabled={!cameraReady}
            title={micEnabled ? "Mute mic" : "Unmute mic"}
            style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              cursor: cameraReady ? "pointer" : "not-allowed",
              border: `1.5px solid ${micEnabled ? "rgba(99,102,241,0.4)" : "rgba(239,68,68,0.4)"}`,
              background: micEnabled ? "rgba(99,102,241,0.12)" : "rgba(239,68,68,0.12)",
              color: micEnabled ? "#a5b4fc" : "#f87171",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 3, transition: "all 0.18s",
            }}
          >
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.7 }}>{micEnabled ? "MIC" : "MUTED"}</span>
          </button>

          {/* Camera toggle */}
          <button
            onClick={toggleVideo}
            disabled={!cameraReady}
            title={videoEnabled ? "Turn off camera" : "Turn on camera"}
            style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              cursor: cameraReady ? "pointer" : "not-allowed",
              border: `1.5px solid ${videoEnabled ? "rgba(99,102,241,0.4)" : "rgba(239,68,68,0.4)"}`,
              background: videoEnabled ? "rgba(99,102,241,0.12)" : "rgba(239,68,68,0.12)",
              color: videoEnabled ? "#a5b4fc" : "#f87171",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 3, transition: "all 0.18s",
            }}
          >
            {videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", opacity: 0.7 }}>{videoEnabled ? "CAM" : "OFF"}</span>
          </button>

          {/* Divider */}
          <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

          {/* Go Live / Stop */}
          {!isStreaming ? (
            <button
              onClick={startStreaming}
              disabled={!canStream}
              style={{
                flex: 1, height: 52, borderRadius: 14, fontSize: 15, fontWeight: 900,
                cursor: canStream ? "pointer" : "not-allowed",
                background: canStream
                  ? "linear-gradient(135deg, #dc2626, #b91c1c)"
                  : "rgba(255,255,255,0.04)",
                border: canStream ? "none" : "1px solid rgba(255,255,255,0.07)",
                color: canStream ? "#fff" : "rgba(255,255,255,0.2)",
                boxShadow: canStream ? "0 6px 24px rgba(220,38,38,0.45), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
                transition: "all 0.2s ease", letterSpacing: "0.02em",
              }}
            >
              {isConnecting ? "Connecting…" : !cameraReady ? "Enable Camera First" : "▶  Go Live"}
            </button>
          ) : (
            <button
              onClick={stopStreaming}
              style={{
                flex: 1, height: 52, borderRadius: 14, fontSize: 15, fontWeight: 900,
                cursor: "pointer",
                background: "rgba(220,38,38,0.12)",
                border: "1.5px solid rgba(220,38,38,0.4)",
                color: "#f87171", transition: "all 0.2s ease", letterSpacing: "0.02em",
              }}
            >
              ■  Stop Streaming
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes redpulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
        @keyframes blink { 0%,100%{opacity:0.6} 50%{opacity:0.15} }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        input:focus { border-color: rgba(99,102,241,0.5) !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

        @media (max-width: 640px) {
          .cam-sidebar { display: none !important; }
        }
      `}</style>
    </div>
  );
}
