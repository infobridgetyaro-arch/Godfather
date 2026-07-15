/**
 * Metrics Service — Centralized metrics collection and exposure
 *
 * Collects per-stream and system-wide metrics:
 *   - CPU usage (process + system)
 *   - Memory (RSS, heap, free)
 *   - Per-stream: fps, bitrate, encoder speed, dropped frames, uptime
 *   - Relay: restarts, recovery time, bytes relayed
 *   - Reconnect counts, backoff levels
 *
 * Exposes via getMetrics() for the /api/metrics endpoint.
 */

import { logger } from "../lib/logger";
import { eventBus } from "./event-bus";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamMetrics {
  streamId: string;
  status: string;
  fps: number;
  bitrateKbps: number;
  encoderSpeed: number;
  droppedFrames: number;
  uptimeMs: number;
  reconnectCount: number;
  startedAt: number | null;
  // Relay
  relayState: string;
  relayRestarts: number;
  relayBytesRelayed: number;
  relayAvgRecoveryMs: number | null;
  // Health
  healthScore: number;
  healthStatus: string;
}

export interface SystemMetrics {
  timestamp: number;
  uptimeMs: number;
  processMemoryMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  cpuUser: number;
  cpuSystem: number;
  activeStreams: number;
  streams: StreamMetrics[];
}

// ── Internal state ────────────────────────────────────────────────────────────

interface StreamSnapshot {
  fps: number;
  bitrateKbps: number;
  encoderSpeed: number;
  droppedFrames: number;
  reconnectCount: number;
  startedAt: number | null;
  status: string;
  relayState: string;
  relayRestarts: number;
  relayBytesRelayed: number;
  relayTotalRecoveries: number;
  relayTotalRecoveryMs: number;
  healthScore: number;
  healthStatus: string;
}

const snapshots = new Map<string, StreamSnapshot>();
const startedAt = Date.now();
let prevCpuUsage = process.cpuUsage();
let prevCpuAt = Date.now();

// ── Public API ────────────────────────────────────────────────────────────────

export function recordStreamSample(
  streamId: string,
  data: Pick<StreamSnapshot, "fps" | "bitrateKbps" | "encoderSpeed" | "droppedFrames">,
): void {
  const existing = snapshots.get(streamId) ?? defaultSnapshot(streamId);
  snapshots.set(streamId, { ...existing, ...data });
}

export function recordStreamStatus(streamId: string, status: string): void {
  const s = snapshots.get(streamId) ?? defaultSnapshot(streamId);
  const patch: Partial<StreamSnapshot> = { status };
  if (status === "streaming" && !s.startedAt) patch.startedAt = Date.now();
  if (status === "idle") patch.startedAt = null;
  snapshots.set(streamId, { ...s, ...patch });
}

export function recordReconnect(streamId: string): void {
  const s = snapshots.get(streamId) ?? defaultSnapshot(streamId);
  snapshots.set(streamId, { ...s, reconnectCount: s.reconnectCount + 1, startedAt: null });
}

export function recordRelayMetrics(streamId: string, relay: {
  state: string;
  restarts: number;
  bytesRelayed: number;
  totalRecoveries: number;
  totalRecoveryMs: number;
}): void {
  const s = snapshots.get(streamId) ?? defaultSnapshot(streamId);
  snapshots.set(streamId, {
    ...s,
    relayState: relay.state,
    relayRestarts: relay.restarts,
    relayBytesRelayed: relay.bytesRelayed,
    relayTotalRecoveries: relay.totalRecoveries,
    relayTotalRecoveryMs: relay.totalRecoveryMs,
  });
}

export function recordHealthScore(streamId: string, score: number, status: string): void {
  const s = snapshots.get(streamId) ?? defaultSnapshot(streamId);
  snapshots.set(streamId, { ...s, healthScore: score, healthStatus: status });
}

export function removeStreamMetrics(streamId: string): void {
  snapshots.delete(streamId);
}

export function getSystemMetrics(): SystemMetrics {
  const now = Date.now();
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  const elapsedUs = (now - prevCpuAt) * 1000;
  const cpuUser = elapsedUs > 0 ? (cpuUsage.user - prevCpuUsage.user) / elapsedUs : 0;
  const cpuSystem = elapsedUs > 0 ? (cpuUsage.system - prevCpuUsage.system) / elapsedUs : 0;
  prevCpuUsage = cpuUsage;
  prevCpuAt = now;

  const streams: StreamMetrics[] = [];
  for (const [streamId, s] of snapshots) {
    const avgRecoveryMs = s.relayTotalRecoveries > 0
      ? Math.round(s.relayTotalRecoveryMs / s.relayTotalRecoveries)
      : null;
    streams.push({
      streamId,
      status: s.status,
      fps: s.fps,
      bitrateKbps: s.bitrateKbps,
      encoderSpeed: s.encoderSpeed,
      droppedFrames: s.droppedFrames,
      uptimeMs: s.startedAt ? now - s.startedAt : 0,
      reconnectCount: s.reconnectCount,
      startedAt: s.startedAt,
      relayState: s.relayState,
      relayRestarts: s.relayRestarts,
      relayBytesRelayed: s.relayBytesRelayed,
      relayAvgRecoveryMs: avgRecoveryMs,
      healthScore: s.healthScore,
      healthStatus: s.healthStatus,
    });
  }

  return {
    timestamp: now,
    uptimeMs: now - startedAt,
    processMemoryMb: Math.round(memUsage.rss / 1024 / 1024),
    heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
    cpuUser: Math.round(cpuUser * 1000) / 10,
    cpuSystem: Math.round(cpuSystem * 1000) / 10,
    activeStreams: streams.filter((s) => s.status === "streaming").length,
    streams,
  };
}

// ── Wire up event bus ─────────────────────────────────────────────────────────

function defaultSnapshot(streamId: string): StreamSnapshot {
  return {
    fps: 0,
    bitrateKbps: 0,
    encoderSpeed: 0,
    droppedFrames: 0,
    reconnectCount: 0,
    startedAt: null,
    status: "idle",
    relayState: "stopped",
    relayRestarts: 0,
    relayBytesRelayed: 0,
    relayTotalRecoveries: 0,
    relayTotalRecoveryMs: 0,
    healthScore: 0,
    healthStatus: "unknown",
  };
}

eventBus.on("METRICS_SAMPLE", ({ streamId, fps, bitrateKbps, speed, droppedFrames }) => {
  recordStreamSample(streamId, { fps, bitrateKbps, encoderSpeed: speed, droppedFrames });
});

eventBus.on("STREAM_STARTED", ({ streamId }) => {
  recordStreamStatus(streamId, "streaming");
});

eventBus.on("STREAM_STOPPED", ({ streamId }) => {
  recordStreamStatus(streamId, "idle");
  removeStreamMetrics(streamId);
});

eventBus.on("STREAM_RECONNECTING", ({ streamId }) => {
  recordReconnect(streamId);
  recordStreamStatus(streamId, "reconnecting");
});
