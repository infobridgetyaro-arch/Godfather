import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthToken } from "@/lib/queryClient";
import { StreamCard } from "@/components/stream-card";
import { ControlRoom } from "@/components/control-room/control-room";
import { Plus, Radio, LogOut, Wifi, WifiOff, Link, Copy, RefreshCw, X, RotateCcw, Save, Settings, Monitor, MonitorOff } from "lucide-react";
import type { StreamConfig } from "@/types/schema";
import { YoutubePanel } from "@/components/youtube-panel";
import { useStreamDrafts } from "@/hooks/use-stream-drafts";
import { SettingsModal } from "@/components/settings-modal";

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

interface StreamStats {
  subs: string | null;
  viewers: string | null;
  hasChat: boolean;
  error?: "quota" | "not_found" | "api_error" | null;
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [inviteUrl, setInviteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch("/api/invite", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInviteUrl(data.url);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  const copy = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast({ title: "Invite link copied!" });
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await apiRequest("POST", "/api/invite/regenerate");
      const data = await res.json();
      setInviteUrl(data.url);
      toast({ title: "Invite link regenerated", description: "Previous link is now invalid." });
    } catch {}
    setRegenerating(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Link className="w-5 h-5 text-primary" />
              Invite to Dashboard
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Share this link to give others access. Anyone with the link can log in.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-invite">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {loading ? (
          <div className="h-10 rounded-md bg-muted animate-pulse" />
        ) : (
          <div className="flex gap-2">
            <Input
              readOnly
              value={inviteUrl}
              className="text-xs font-mono flex-1 bg-muted/50"
              data-testid="input-invite-url"
            />
            <Button size="icon" variant="outline" onClick={copy} data-testid="button-copy-invite">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={regenerating}
            className="gap-2"
            data-testid="button-regenerate-invite"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
          <p className="text-xs text-muted-foreground flex-1">
            Regenerating revokes the current link for everyone.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
          <p className="text-xs font-semibold">How it works</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
            <li>Send the link to anyone you want to invite</li>
            <li>They click the link — no password needed</li>
            <li>They get full dashboard access</li>
            <li>Regenerate to revoke all existing invite links</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const { isConnected, subscribe } = useWebSocket();
  const [streams, setStreams] = useState<StreamConfig[]>([]);
  const [streamLogs, setStreamLogs] = useState<Record<string, string[]>>({});
  const [streamStats, setStreamStats] = useState<Record<string, StreamStats>>({});
  const [streamChat, setStreamChat] = useState<Record<string, ChatMessage[]>>({});
  const [reconnectCountdowns, setReconnectCountdowns] = useState<Record<string, number>>({});
  const [streamProcStats, setStreamProcStats] = useState<Record<string, {
    cpu: number; mem: number; frames?: number; uptime?: number;
    bitrate?: number; fps?: number; speed?: number; droppedFrames?: number;
    lagSec?: number; healthScore?: number; healthStatus?: string; reconnectCount?: number;
    aqmStage?: number; aqmPhase?: string; aqmBottleneck?: string | null;
  }>>({}); 
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [startingStreams, setStartingStreams] = useState<Set<string>>(new Set());
  const [ytMonitor, setYtMonitor] = useState<{ url: string; label: string; streamId: string } | null>(null);
  const [featuredMsgId, setFeaturedMsgId] = useState<string | null>(null);
  const seenChatIds = useState<Record<string, Set<string>>>(() => ({}))[0];
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const initialFetchDone = useRef(false);

  // ── Screen Wake Lock ────────────────────────────────────────────────────────
  // Prevents the device from sleeping / dimming while the dashboard is open.
  // Uses the Web Screen Wake Lock API (supported in Chrome/Edge/Safari 16.4+).
  //
  // Two separate pieces of state:
  //   wakeLockActive    — reflects current live sentinel (UI indicator)
  //   wakeLockIntended  — tracks user's intent so re-acquire works correctly
  //
  // Browsers auto-release the sentinel when the tab is hidden.  The `release`
  // event sets wakeLockActive=false but wakeLockIntended stays true.  On the
  // visibility-change handler we check wakeLockIntended (not wakeLockActive)
  // so the lock is properly re-acquired when the user returns to the tab.
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const wakeLockIntended = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const acquireWakeLock = async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLockActive(true);
      wakeLockRef.current.addEventListener("release", () => {
        // Browser released the lock (tab hidden, low battery, etc.).
        // Clear the sentinel but preserve intent so visibility-change can retry.
        setWakeLockActive(false);
        wakeLockRef.current = null;
      });
    } catch (err: any) {
      toast({ title: "Could not enable wake lock", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  const toggleWakeLock = async () => {
    if (wakeLockIntended.current) {
      // User is turning it off — release and clear intent.
      wakeLockIntended.current = false;
      try { await wakeLockRef.current?.release(); } catch {}
      wakeLockRef.current = null;
      setWakeLockActive(false);
      toast({ title: "Display sleep re-enabled" });
    } else {
      if (!("wakeLock" in navigator)) {
        toast({ title: "Not supported", description: "Screen Wake Lock is not available in this browser.", variant: "destructive" });
        return;
      }
      wakeLockIntended.current = true;
      toast({ title: "Display always on", description: "Screen will stay awake while this tab is open." });
      await acquireWakeLock();
    }
  };

  // Re-acquire the wake lock if the tab becomes visible again after being hidden.
  // Checks wakeLockIntended (user's intent) not wakeLockActive (transient state).
  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState === "visible" && wakeLockIntended.current && !wakeLockRef.current) {
        await acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const { saveDrafts, loadDrafts, savedAt, clearDrafts } = useStreamDrafts();

  const authFetchHeaders = (): Record<string, string> => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchStreams = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { credentials: "include", headers: authFetchHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStreams(data);
        // After the very first fetch: if the server has no streams but we have
        // saved drafts, prompt the user to restore them.
        if (!initialFetchDone.current) {
          initialFetchDone.current = true;
          if (data.length === 0 && loadDrafts() !== null) {
            setShowRestoreBanner(true);
          }
        }
      }
    } catch {}
  }, [loadDrafts]);

  useEffect(() => { fetchStreams(); }, [fetchStreams]);

  useEffect(() => {
    const unsubLog = subscribe("log", (msg) => {
      if (msg.streamId && msg.data) {
        setStreamLogs((prev) => ({
          ...prev,
          [msg.streamId!]: [...(prev[msg.streamId!] || []), msg.data].slice(-200),
        }));
      }
    });
    const unsubStatus = subscribe("status", (msg) => {
      if (msg.streamId && msg.data) {
        setStreams((prev) =>
          prev.map((s) => (s.id === msg.streamId ? { ...s, status: msg.data } : s))
        );
      }
    });
    const unsubStats = subscribe("stats", (msg) => {
      if (msg.streamId && msg.data) {
        setStreamStats((prev) => ({
          ...prev,
          [msg.streamId!]: {
            subs: msg.data.subs ?? null,
            viewers: msg.data.viewers ?? null,
            hasChat: msg.data.hasChat ?? false,
            error: msg.data.error ?? null,
          },
        }));
      }
    });
    const unsubChat = subscribe("chat", (msg) => {
      if (msg.streamId && Array.isArray(msg.data)) {
        const id = msg.streamId!;
        if (!seenChatIds[id]) seenChatIds[id] = new Set();
        const newMsgs = (msg.data as ChatMessage[]).filter((m) => !seenChatIds[id].has(m.id));
        if (newMsgs.length) {
          newMsgs.forEach((m) => seenChatIds[id].add(m.id));
          // Rolling 30-message window — oldest messages naturally fall off
          setStreamChat((prev) => ({
            ...prev,
            [id]: [...(prev[id] || []), ...newMsgs].slice(-30),
          }));
        }
      }
    });
    const unsubProcStats = subscribe("proc_stats", (msg) => {
      if (msg.streamId && msg.data) {
        setStreamProcStats((prev) => ({
          ...prev,
          [msg.streamId!]: {
            cpu: msg.data.cpu,
            mem: msg.data.mem,
            frames: msg.data.frames ?? prev[msg.streamId!]?.frames ?? 0,
            uptime: msg.data.uptime ?? prev[msg.streamId!]?.uptime ?? 0,
            bitrate: msg.data.bitrate ?? prev[msg.streamId!]?.bitrate ?? 0,
            fps: msg.data.fps ?? prev[msg.streamId!]?.fps ?? 0,
            speed: msg.data.speed ?? prev[msg.streamId!]?.speed ?? 0,
            droppedFrames: msg.data.droppedFrames ?? prev[msg.streamId!]?.droppedFrames ?? 0,
            lagSec: msg.data.lagSec ?? prev[msg.streamId!]?.lagSec ?? 0,
            healthScore: msg.data.healthScore ?? prev[msg.streamId!]?.healthScore ?? 100,
            healthStatus: msg.data.healthStatus ?? prev[msg.streamId!]?.healthStatus ?? "excellent",
            reconnectCount: msg.data.reconnectCount ?? prev[msg.streamId!]?.reconnectCount ?? 0,
            aqmStage: msg.data.aqmStage ?? prev[msg.streamId!]?.aqmStage ?? 0,
            aqmPhase: msg.data.aqmPhase ?? prev[msg.streamId!]?.aqmPhase ?? "nominal",
            aqmBottleneck: msg.data.aqmBottleneck ?? prev[msg.streamId!]?.aqmBottleneck ?? null,
          },
        }));
      }
    });
    // Stream ended naturally (FFmpeg exited, no auto-restart) → remove card
    const unsubDeleted = subscribe("deleted", (msg) => {
      if (msg.streamId) {
        const id = msg.streamId!;
        setStreams((prev) => prev.filter((s) => s.id !== id));
        setStreamLogs((prev) => { const n = { ...prev }; delete n[id]; return n; });
        setStreamStats((prev) => { const n = { ...prev }; delete n[id]; return n; });
        setStreamChat((prev) => { const n = { ...prev }; delete n[id]; return n; });
        setStreamProcStats((prev) => { const n = { ...prev }; delete n[id]; return n; });
        delete seenChatIds[id];
      }
    });
    // Camera stream went live — show a toast with the phone link
    const unsubCameraLink = subscribe("camera_link", (msg) => {
      if (msg.streamId && msg.data?.url) {
        toast({
          title: "Camera stream is live!",
          description: (
            <span>
              Open on your phone:{" "}
              <a href={msg.data.url} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                {msg.data.url}
              </a>
            </span>
          ) as any,
        });
      }
    });
    const unsubCountdown = subscribe("reconnect_countdown", (msg) => {
      if (msg.streamId && msg.data) {
        const remaining = msg.data.remainingSec as number;
        setReconnectCountdowns((prev) => ({ ...prev, [msg.streamId!]: remaining }));
        // Clear the countdown entry once it reaches zero
        if (remaining <= 0) {
          setReconnectCountdowns((prev) => { const n = { ...prev }; delete n[msg.streamId!]; return n; });
        }
      }
    });
    // When a stream starts or goes idle/error, clear its countdown
    const unsubStatusClear = subscribe("status", (msg) => {
      if (msg.streamId && msg.data !== "reconnecting") {
        setReconnectCountdowns((prev) => { const n = { ...prev }; delete n[msg.streamId!]; return n; });
      }
    });
    return () => { unsubLog(); unsubStatus(); unsubStats(); unsubChat(); unsubProcStats(); unsubDeleted(); unsubCameraLink(); unsubCountdown(); unsubStatusClear(); };
  }, [subscribe, seenChatIds]);

  // ── REST polling fallback for YouTube live chat ────────────────────────────
  // Supplements WebSocket push. Runs every 10 s and NEVER silently stops:
  // each per-stream fetch is wrapped in its own try/catch so one failure
  // cannot cancel the entire polling cycle. The interval is never re-created
  // when `streams` changes — instead the latest `streams` is read via a ref,
  // which keeps the effect stable and the interval alive indefinitely.
  const streamsRef = useRef(streams);
  const seenChatIdsRef = useRef(seenChatIds);
  useEffect(() => { streamsRef.current = streams; }, [streams]);
  useEffect(() => { seenChatIdsRef.current = seenChatIds; }, [seenChatIds]);

  // Ref allowing external code (e.g. Force Refresh Chat button) to trigger an
  // immediate poll without resetting the ongoing useEffect.
  const forcePollRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let active = true;
    let pollTimer: number | null = null;

    const authHeaders = (): Record<string, string> => {
      const token = getAuthToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const poll = async () => {
      if (!active) return;
      const targets = streamsRef.current.filter((s) => s.youtubeChannelId);
      for (const s of targets) {
        if (!active) break;
        try {
          const res = await fetch(`/api/streams/${s.id}/chat`, {
            credentials: "include",
            headers: authHeaders(),
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) continue;
          const msgs: ChatMessage[] = await res.json();
          if (!msgs.length) continue;
          const seen = seenChatIdsRef.current;
          if (!seen[s.id]) seen[s.id] = new Set();
          const newMsgs = msgs.filter((m) => !seen[s.id].has(m.id));
          if (newMsgs.length) {
            newMsgs.forEach((m) => seen[s.id].add(m.id));
            // Prune Set to avoid unbounded memory growth (keep last 2000 IDs)
            if (seen[s.id].size > 2000) {
              const arr = Array.from(seen[s.id]);
              seen[s.id] = new Set(arr.slice(arr.length - 1000));
            }
            setStreamChat((prev) => ({
              ...prev,
              [s.id]: [...(prev[s.id] || []), ...newMsgs].slice(-30),
            }));
          }
        } catch (err) {
          // Log but never let one stream's error break the loop
          if (active) console.debug("[chat-poll] fetch error for", s.id, err);
        }
      }
      if (active) pollTimer = window.setTimeout(poll, 10_000);
    };

    // Expose a force-trigger: cancel the pending timer and run immediately.
    // Guards against duplicate concurrent polls since poll() itself is async.
    forcePollRef.current = () => {
      if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
      void poll();
    };

    pollTimer = window.setTimeout(poll, 0); // immediate first run
    return () => {
      active = false;
      forcePollRef.current = null;
      if (pollTimer !== null) clearTimeout(pollTimer);
    };
  // Intentionally no deps — streams/seenChatIds accessed via refs to keep interval stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save all stream configs to localStorage whenever the list changes.
  // Skip the initial empty render to avoid wiping saved drafts on mount.
  useEffect(() => {
    if (streams.length > 0) {
      saveDrafts(streams);
    }
  }, [streams, saveDrafts]);

  const addStream = async () => {
    // Pre-fill from the last saved draft at the index matching the new stream.
    const drafts = loadDrafts();
    const template = drafts ? (drafts[streams.length] ?? drafts[drafts.length - 1]) : null;

    const payload = template ?? {
      sourceType: "tiktok",
      tiktokUsername: "",
      youtubeSourceUrl: "",
      linkSourceUrl: "",
      cameraDevice: "/dev/video0",
      xspaceUrl: "",
      xspaceImageUrl: "",
      xspaceVideoPath: "",
      uploadedVideoLoop: false,
      youtubeStreamKey: "",
      facebookRtmpUrl: "",
      tiktokStreamKey: "",
      youtubeChannelId: "",
      ratio: "mobile",
      quality: "best",
      fps: "30",
      muted: false,
      autoRestart: false,
      micDevice: "",
      micEnabled: false,
      autoReconnect: true,
      maxReconnectMinutes: null,
    };

    try {
      const res = await apiRequest("POST", "/api/streams", payload);
      const newStream = await res.json();
      setStreams((prev) => [...prev, newStream]);
      toast({
        title: "Stream added",
        description: template
          ? "Pre-filled with your last saved settings."
          : "Configure and start your new stream.",
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const restoreStreams = async () => {
    const drafts = loadDrafts();
    if (!drafts || drafts.length === 0) return;
    setIsRestoring(true);
    const created: StreamConfig[] = [];
    for (const draft of drafts) {
      try {
        const res = await apiRequest("POST", "/api/streams", draft);
        const newStream = await res.json();
        created.push(newStream);
      } catch {}
    }
    setStreams((prev) => [...prev, ...created]);
    setShowRestoreBanner(false);
    setIsRestoring(false);
    toast({
      title: `${created.length} stream${created.length !== 1 ? "s" : ""} restored`,
      description: "Your saved stream configs have been re-created.",
    });
  };

  const updateStream = async (id: string, data: Partial<StreamConfig>) => {
    setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
    try { await apiRequest("PATCH", `/api/streams/${id}`, data); } catch {}
  };

  const startStream = async (id: string) => {
    setStartingStreams((prev) => new Set(prev).add(id));
    try {
      await apiRequest("POST", `/api/streams/${id}/start`);
      setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, status: "streaming" } : s)));
      toast({ title: "Stream started" });
    } catch (e: any) {
      toast({ title: "Error starting stream", description: e.message, variant: "destructive" });
    } finally {
      setStartingStreams((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const stopStream = async (id: string) => {
    try {
      await apiRequest("POST", `/api/streams/${id}/stop`);
      // Keep the stream card — just mark it idle and clear runtime data.
      // The WebSocket "status" → "idle" event will also arrive shortly (idempotent).
      setStreams((prev) => prev.map((s) => s.id === id ? { ...s, status: "idle" } : s));
      setStreamLogs((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setStreamStats((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setStreamChat((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setStreamProcStats((prev) => { const n = { ...prev }; delete n[id]; return n; });
      delete seenChatIds[id];
      toast({ title: "Stream stopped", description: "Stream card kept — your config is preserved." });
    } catch (e: any) {
      toast({ title: "Error stopping stream", description: e.message, variant: "destructive" });
    }
  };

  const restartStream = async (id: string) => {
    try {
      await apiRequest("POST", `/api/streams/${id}/restart`);
      setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, status: "reconnecting" } : s)));
      toast({ title: "Stream restarting" });
    } catch (e: any) {
      toast({ title: "Error restarting stream", description: e.message, variant: "destructive" });
    }
  };

  const deleteStream = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/streams/${id}`);
      setStreams((prev) => prev.filter((s) => s.id !== id));
      setStreamLogs((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setStreamStats((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setStreamChat((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setStreamProcStats((prev) => { const n = { ...prev }; delete n[id]; return n; });
      delete seenChatIds[id];
      toast({ title: "Stream removed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const toggleMute = async (id: string) => {
    const stream = streams.find((s) => s.id === id);
    if (!stream) return;
    const newMuted = !stream.muted;
    setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, muted: newMuted } : s)));
    try { await apiRequest("POST", `/api/streams/${id}/mute`, { muted: newMuted }); } catch {}
  };

  const activeCount = streams.filter((s) => s.status === "streaming").length;

  return (
    <div className="min-h-screen bg-background">
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {ytMonitor && (
        <YoutubePanel
          url={ytMonitor.url}
          label={ytMonitor.label}
          chatMessages={streamChat[ytMonitor.streamId] || []}
          featuredId={featuredMsgId}
          onClose={() => { setYtMonitor(null); setFeaturedMsgId(null); }}
          onFeatureMessage={async (msg) => {
            setFeaturedMsgId(msg.id);
            try {
              await fetch("/api/broadcast", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", ...authFetchHeaders() },
                body: JSON.stringify({
                  featuredComment: { name: msg.authorName, text: msg.text, color: "#ff2244", ts: Date.now() },
                }),
              });
            } catch {}
          }}
          onClearFeatured={async () => {
            setFeaturedMsgId(null);
            try {
              await fetch("/api/broadcast", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", ...authFetchHeaders() },
                body: JSON.stringify({ featuredComment: null }),
              });
            } catch {}
          }}
        />
      )}

      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            {/* BintuNet broadcast logo */}
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <rect width="34" height="34" rx="9" fill="url(#logo-bg)" />
              {/* Signal arcs */}
              <path d="M8.5 17 C8.5 12.3 12.3 8.5 17 8.5" stroke="url(#arc1)" strokeWidth="2" strokeLinecap="round" />
              <path d="M8.5 17 C8.5 21.7 12.3 25.5 17 25.5" stroke="url(#arc1)" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 17 C6 10.9 10.9 6 17 6" stroke="url(#arc2)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              <path d="M6 17 C6 23.1 10.9 28 17 28" stroke="url(#arc2)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
              {/* Bold B letter */}
              <text x="15" y="22" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="12" fill="white" letterSpacing="-0.5">B</text>
              {/* Live dot */}
              <circle cx="26" cy="10" r="3" fill="#ef4444">
                <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <defs>
                <linearGradient id="logo-bg" x1="0" y1="0" x2="34" y2="34">
                  <stop offset="0%" stopColor="#4f46e5" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
                <linearGradient id="arc1" x1="8" y1="17" x2="17" y2="8">
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#e0e7ff" />
                </linearGradient>
                <linearGradient id="arc2" x1="6" y1="17" x2="17" y2="6">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#c7d2fe" stopOpacity="0.4" />
                </linearGradient>
              </defs>
            </svg>
            <div className="leading-none">
              <h1 className="text-base font-black tracking-tight text-foreground" style={{ letterSpacing: "-0.03em" }}>
                Bintu<span style={{ color: "hsl(var(--primary))" }}>Net</span>
              </h1>
              <p className="text-[9px] text-muted-foreground font-semibold tracking-widest uppercase" style={{ letterSpacing: "0.12em", marginTop: 1 }}>Broadcast Studio</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {activeCount > 0 && (
              <Badge
                variant="default"
                className="text-xs gap-1 font-bold"
                data-testid="badge-active-count"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {activeCount} Live
              </Badge>
            )}
            <Badge
              variant="secondary"
              className="text-xs gap-1"
              data-testid="badge-ws-status"
            >
              {isConnected ? (
                <><Wifi className="w-3 h-3 text-emerald-500" /><span className="hidden sm:inline">Online</span></>
              ) : (
                <><WifiOff className="w-3 h-3 text-muted-foreground" /><span className="hidden sm:inline">Offline</span></>
              )}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInvite(true)}
              className="gap-1.5 hidden sm:flex text-xs h-7 px-2.5"
              data-testid="button-invite"
            >
              <Link className="w-3 h-3" />
              Invite
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowInvite(true)}
              className="sm:hidden w-7 h-7"
              data-testid="button-invite-mobile"
            >
              <Link className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="w-7 h-7"
              data-testid="button-settings"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={wakeLockActive ? "default" : "ghost"}
              size="icon"
              onClick={toggleWakeLock}
              className={`w-7 h-7 ${wakeLockActive ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
              data-testid="button-wake-lock"
              title={wakeLockActive ? "Display always on — click to allow sleep" : "Keep display on (prevent sleep)"}
            >
              {wakeLockActive ? (
                <Monitor className="w-3.5 h-3.5" />
              ) : (
                <MonitorOff className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              className="w-7 h-7"
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <ControlRoom
          streams={streams}
          streamStats={streamStats}
          streamChat={streamChat}
          streamProcStats={streamProcStats}
          onForceRefreshChat={() => forcePollRef.current?.()}
        />

        {showRestoreBanner && (() => {
          const drafts = loadDrafts();
          const ts = savedAt();
          const timeStr = ts
            ? ts.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
            : "previously";
          return (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Save className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-semibold text-sm text-foreground">
                    {drafts?.length ?? 0} saved stream config{(drafts?.length ?? 0) !== 1 ? "s" : ""} found
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your stream settings were auto-saved {timeStr}. The server has no active streams — would you like to restore them?
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowRestoreBanner(false); clearDrafts(); }}
                  className="text-xs h-8 gap-1.5"
                  disabled={isRestoring}
                >
                  <X className="w-3 h-3" />
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  onClick={restoreStreams}
                  className="text-xs h-8 gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                  disabled={isRestoring}
                >
                  <RotateCcw className={`w-3 h-3 ${isRestoring ? "animate-spin" : ""}`} />
                  {isRestoring ? "Restoring…" : "Restore Streams"}
                </Button>
              </div>
            </div>
          );
        })()}

        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Streams</h2>
            <p className="text-sm text-muted-foreground">
              {streams.length === 0
                ? "No streams configured yet"
                : `${streams.length} stream${streams.length !== 1 ? "s" : ""} configured`}
            </p>
          </div>
          <Button onClick={addStream} data-testid="button-add-stream">
            <Plus className="w-4 h-4 mr-2" />
            Add Stream
          </Button>
        </div>

        {streams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Radio className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No streams yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Add a stream to start broadcasting. Capture from TikTok, YouTube live, or any camera — and restream to YouTube and Facebook simultaneously.
            </p>
            <Button onClick={addStream} data-testid="button-add-first-stream">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Stream
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {streams.map((stream, i) => (
              <StreamCard
                key={stream.id}
                stream={stream}
                logs={streamLogs[stream.id] || []}
                stats={streamStats[stream.id] ?? null}
                procStats={streamProcStats[stream.id]}
                chatMessages={streamChat[stream.id] || []}
                onStart={startStream}
                onStop={stopStream}
                onRestart={restartStream}
                onDelete={deleteStream}
                onUpdate={updateStream}
                onToggleMute={toggleMute}
                onOpenMonitor={(url, label) => setYtMonitor({ url, label, streamId: stream.id })}
                isStarting={startingStreams.has(stream.id)}
                reconnectCountdown={reconnectCountdowns[stream.id] ?? null}
                index={i}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
