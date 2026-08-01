/**
 * Source Failover Manager
 *
 * Each stream can have a priority-ordered failover chain:
 *   Primary → Backup 1 → Backup 2 → Backup 3 (pre-recorded loop)
 *
 * When a stream enters the "failed" or "error" state repeatedly, the failover
 * manager advances the chain to the next source, patches the StreamConfig in
 * storage, and triggers a restart — all without touching the RTMP session.
 *
 * The system auto-resets to primary after a configurable number of minutes of
 * stable streaming (default: 10 minutes), or when manually reset.
 *
 * Failover chain example:
 *   [
 *     { sourceType: "youtube", youtubeSourceUrl: "https://youtube.com/@creator/live", label: "YouTube Live" },
 *     { sourceType: "tiktok",  tiktokUsername: "creator",  label: "TikTok Live" },
 *     { sourceType: "camera",  cameraDevice: "/dev/video0", label: "Camera" },
 *     { sourceType: "upload",  uploadedVideoPath: "/uploads/fallback.mp4", label: "Fallback Loop" },
 *   ]
 */

import { logger } from "./lib/logger";
import { storage } from "./storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FailoverSource {
  sourceType: "tiktok" | "youtube" | "camera" | "xspace" | "upload";
  tiktokUsername?: string;
  youtubeSourceUrl?: string;
  cameraDevice?: string;
  xspaceUrl?: string;
  uploadedVideoPath?: string;
  /** Human-readable label shown in logs and UI */
  label?: string;
}

export interface FailoverChain {
  streamId: string;
  sources: FailoverSource[];
  /** Current index into sources[] (0 = primary) */
  currentIndex: number;
  /** How long a source must stay stable before auto-resetting to primary (ms) */
  stableResetMs: number;
  /** Unix ms when current source became "stable" (frames flowing) */
  stableSince: number | null;
  /** Total failover count since chain was set */
  failoverCount: number;
  /** History of failovers for debugging */
  history: Array<{
    fromIndex: number;
    toIndex: number;
    reason: string;
    at: number;
  }>;
}

type RestartFn = (streamId: string) => void;

// ── Module state ──────────────────────────────────────────────────────────────

const chains = new Map<string, FailoverChain>();
let _triggerRestart: RestartFn = () => {};

const STABLE_RESET_DEFAULT_MS = 10 * 60_000; // 10 minutes
const MAX_HISTORY = 20;

export function initFailover(triggerRestart: RestartFn): void {
  _triggerRestart = triggerRestart;
}

// ── Chain management ──────────────────────────────────────────────────────────

/**
 * Set a failover chain for a stream.
 * Sources are tried in order; index 0 is always the primary.
 */
export function setFailoverChain(streamId: string, sources: FailoverSource[], stableResetMs?: number): void {
  if (!sources.length) {
    chains.delete(streamId);
    return;
  }
  chains.set(streamId, {
    streamId,
    sources,
    currentIndex: 0,
    stableResetMs: stableResetMs ?? STABLE_RESET_DEFAULT_MS,
    stableSince: null,
    failoverCount: 0,
    history: [],
  });
  logger.info({ streamId, sourceCount: sources.length }, "[failover] Chain configured");
}

/** Remove a chain entirely */
export function removeFailoverChain(streamId: string): void {
  chains.delete(streamId);
}

/** Get current chain state */
export function getFailoverChain(streamId: string): FailoverChain | null {
  return chains.get(streamId) ?? null;
}

/** Get all chains */
export function getAllChains(): FailoverChain[] {
  return [...chains.values()];
}

/** Which source is currently active? */
export function getCurrentSource(streamId: string): FailoverSource | null {
  const chain = chains.get(streamId);
  if (!chain) return null;
  return chain.sources[chain.currentIndex] ?? null;
}

// ── Failover logic ────────────────────────────────────────────────────────────

/**
 * Advance to the next source in the chain.
 * Updates StreamConfig in storage and triggers a pipeline restart.
 * Returns true if a new source was applied, false if already at the last source.
 */
export function triggerFailover(streamId: string, reason: string): boolean {
  const chain = chains.get(streamId);
  if (!chain) {
    logger.warn({ streamId }, "[failover] No chain configured — cannot fail over");
    return false;
  }

  const nextIndex = chain.currentIndex + 1;
  if (nextIndex >= chain.sources.length) {
    logger.warn({ streamId, currentIndex: chain.currentIndex }, "[failover] Already at last source — cycling back to primary");
    return resetToPrimary(streamId, "all sources exhausted");
  }

  const prevSource = chain.sources[chain.currentIndex];
  const nextSource = chain.sources[nextIndex];

  chain.history.push({ fromIndex: chain.currentIndex, toIndex: nextIndex, reason, at: Date.now() });
  if (chain.history.length > MAX_HISTORY) chain.history.shift();

  chain.currentIndex = nextIndex;
  chain.stableSince = null;
  chain.failoverCount++;

  logger.info(
    { streamId, from: prevSource.label ?? prevSource.sourceType, to: nextSource.label ?? nextSource.sourceType, reason },
    "[failover] Switching source",
  );

  applySourceToStorage(streamId, nextSource);
  _triggerRestart(streamId);
  return true;
}

/**
 * Reset the chain back to the primary (index 0) and restart.
 */
export function resetToPrimary(streamId: string, reason = "manual"): boolean {
  const chain = chains.get(streamId);
  if (!chain || chain.currentIndex === 0) return false;

  const primary = chain.sources[0];
  chain.history.push({ fromIndex: chain.currentIndex, toIndex: 0, reason: `reset: ${reason}`, at: Date.now() });
  if (chain.history.length > MAX_HISTORY) chain.history.shift();

  chain.currentIndex = 0;
  chain.stableSince = null;

  logger.info({ streamId, reason }, "[failover] Reset to primary source");
  applySourceToStorage(streamId, primary);
  _triggerRestart(streamId);
  return true;
}

/**
 * Signal that the current source is stable (frames flowing).
 * After stableResetMs of continuous stability, auto-resets to primary.
 */
export function markSourceStable(streamId: string): void {
  const chain = chains.get(streamId);
  if (!chain || chain.currentIndex === 0) return;

  const now = Date.now();
  if (!chain.stableSince) {
    chain.stableSince = now;
    return;
  }

  if ((now - chain.stableSince) >= chain.stableResetMs) {
    logger.info({ streamId, stableMs: now - chain.stableSince }, "[failover] Source stable — resetting to primary");
    resetToPrimary(streamId, "auto stable-reset");
  }
}

/**
 * Signal that the current source failed again.
 * Resets the stable timer so it won't auto-return to primary prematurely.
 */
export function markSourceFailed(streamId: string): void {
  const chain = chains.get(streamId);
  if (!chain) return;
  chain.stableSince = null;
}

// ── Helper: apply a source to storage ────────────────────────────────────────

function applySourceToStorage(streamId: string, source: FailoverSource): void {
  const stream = storage.getStream(streamId);
  if (!stream) return;

  storage.updateStream(streamId, {
    sourceType: source.sourceType,
    ...(source.tiktokUsername !== undefined   ? { tiktokUsername:   source.tiktokUsername   } : {}),
    ...(source.youtubeSourceUrl !== undefined  ? { youtubeSourceUrl: source.youtubeSourceUrl  } : {}),
    ...(source.cameraDevice !== undefined      ? { cameraDevice:     source.cameraDevice      } : {}),
    ...(source.xspaceUrl !== undefined         ? { xspaceUrl:        source.xspaceUrl         } : {}),
    ...(source.uploadedVideoPath !== undefined ? { uploadedVideoPath: source.uploadedVideoPath } : {}),
  });
}

/**
 * Build a simple failover chain from an existing stream's current config
 * plus an optional fallback upload video path.
 */
export function buildDefaultChain(streamId: string, fallbackVideoPath?: string): FailoverSource[] {
  const stream = storage.getStream(streamId);
  if (!stream) return [];

  const sources: FailoverSource[] = [];

  // Primary: whatever the stream is currently configured for
  sources.push({
    sourceType: stream.sourceType as any ?? "tiktok",
    tiktokUsername: stream.tiktokUsername,
    youtubeSourceUrl: stream.youtubeSourceUrl,
    cameraDevice: stream.cameraDevice,
    xspaceUrl: stream.xspaceUrl,
    uploadedVideoPath: stream.uploadedVideoPath,
    label: `Primary (${stream.sourceType ?? "tiktok"})`,
  });

  // Auto-add camera backup if there's a device configured and it's not the primary
  if (stream.sourceType !== "camera" && stream.cameraDevice && stream.cameraDevice !== "/dev/video0") {
    sources.push({ sourceType: "camera", cameraDevice: stream.cameraDevice, label: "Camera Backup" });
  }

  // Add fallback loop if provided
  if (fallbackVideoPath) {
    sources.push({
      sourceType: "upload",
      uploadedVideoPath: fallbackVideoPath,
      label: "Fallback Loop Video",
    });
  }

  return sources;
}
