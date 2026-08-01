import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { Tv, Loader2, WifiOff, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthToken } from "@/lib/queryClient";

interface LivePreviewProps {
  streamId: string;
  sourceType: string;
  tiktokUsername?: string;
  youtubeSourceUrl?: string;
  ratio: "mobile" | "desktop";
  autoShow?: boolean;
}

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    const liveIdx = parts.indexOf("live");
    if (liveIdx > 0) return null;
    const watchIdx = parts.indexOf("watch");
    if (watchIdx >= 0 && parts[watchIdx + 1]) return parts[watchIdx + 1];
  } catch {}
  return null;
}

function getYouTubeChannelId(url: string): string | null {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0]?.startsWith("UC") && parts[0].length > 20) return parts[0];
    if (parts[0] === "channel" && parts[1]?.startsWith("UC")) return parts[1];
  } catch {}
  return null;
}

export function LivePreview({
  streamId,
  sourceType,
  tiktokUsername,
  youtubeSourceUrl,
  ratio,
  autoShow = false,
}: LivePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showPreview, setShowPreview] = useState(autoShow);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const [useEmbed, setUseEmbed] = useState(false);

  const isYouTube = sourceType === "youtube";
  const isTikTok = sourceType === "tiktok";
  const hasSource = isTikTok ? !!tiktokUsername : isYouTube ? !!youtubeSourceUrl : false;

  const embedVideoId = isYouTube && youtubeSourceUrl ? getYouTubeVideoId(youtubeSourceUrl) : null;
  const embedChannelId = isYouTube && youtubeSourceUrl ? getYouTubeChannelId(youtubeSourceUrl) : null;
  const canEmbed = isYouTube && (embedVideoId || embedChannelId);

  const loadHlsPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUseEmbed(false);

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`/api/streams/${streamId}/preview`, {
        credentials: "include",
        headers,
      });
      const data = await res.json();

      if (!res.ok) {
        if (canEmbed) { setUseEmbed(true); setIsLive(null); setLoading(false); return; }
        setError(data.message || "Failed to load preview");
        setIsLive(false);
        setLoading(false);
        return;
      }

      setIsLive(data.isLive);

      if (!data.hlsUrl) {
        if (canEmbed) { setUseEmbed(true); setLoading(false); return; }
        setError("No HLS preview available");
        setLoading(false);
        return;
      }

      const video = videoRef.current;
      if (!video) { setLoading(false); return; }

      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false,
          lowLatencyMode: true,
          maxBufferLength: 5,
          maxMaxBufferLength: 10,
          maxBufferSize: 2 * 1024 * 1024,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 5,
        });
        hlsRef.current = hls;
        hls.loadSource(data.hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          setLoading(false);
        });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) {
            setError("Stream ended or unavailable");
            setLoading(false);
            hls.destroy();
            hlsRef.current = null;
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = data.hlsUrl;
        video.onloadedmetadata = () => { video.play().catch(() => {}); setLoading(false); };
        video.onerror = () => { setError("Stream ended or unavailable"); setLoading(false); };
      } else {
        setError("Browser does not support HLS playback");
        setLoading(false);
      }
    } catch (e: any) {
      if (canEmbed) { setUseEmbed(true); setLoading(false); return; }
      setError(e.message || "Network error");
      setLoading(false);
    }
  }, [streamId, canEmbed]);

  useEffect(() => {
    if (showPreview && hasSource) loadHlsPreview();
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [showPreview, hasSource, loadHlsPreview]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, []);

  if (!hasSource) return null;

  const embedSrc = embedVideoId
    ? `https://www.youtube.com/embed/${embedVideoId}?autoplay=1&mute=1&controls=1`
    : embedChannelId
    ? `https://www.youtube.com/embed/live_stream?channel=${embedChannelId}&autoplay=1&mute=1`
    : null;

  const containerStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
    ...(ratio === "mobile" ? { height: 280 } : { aspectRatio: "16/9" }),
  };

  const innerStyle: React.CSSProperties = ratio === "mobile"
    ? { height: "100%", aspectRatio: "9/16", position: "relative" }
    : { width: "100%", aspectRatio: "16/9", position: "relative" };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`button-toggle-preview-${streamId}`}
        >
          <Tv className="w-3.5 h-3.5" />
          Live Preview
          {isLive !== null && (
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${isLive ? "bg-emerald-500 animate-pulse" : "bg-gray-500"}`} />
          )}
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
        {showPreview && !loading && (
          <button
            onClick={loadHlsPreview}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            title="Refresh preview"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      {showPreview && (
        <div style={containerStyle} data-testid={`preview-container-${streamId}`}>
          {useEmbed && embedSrc ? (
            <iframe
              src={embedSrc}
              allow="autoplay; encrypted-media"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
            />
          ) : (
            <div style={innerStyle}>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                data-testid={`video-preview-${streamId}`}
              />

              {loading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", gap: 8, zIndex: 10 }}>
                  <Loader2 className="w-5 h-5 animate-spin text-white/60" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Fetching stream URL…</span>
                </div>
              )}

              {error && !loading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", gap: 8, zIndex: 10, padding: "0 16px", textAlign: "center" }}>
                  <WifiOff className="w-7 h-7" style={{ color: "rgba(255,255,255,0.4)" }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", maxWidth: 220 }}>{error}</span>
                  <Button variant="secondary" size="sm" onClick={loadHlsPreview} style={{ fontSize: 11, height: 26, marginTop: 4 }}>
                    Retry
                  </Button>
                </div>
              )}

              {isLive && !loading && !error && (
                <div style={{ position: "absolute", top: 8, left: 8, zIndex: 20, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />
                  LIVE
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
