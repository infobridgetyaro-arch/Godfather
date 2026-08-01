/**
 * Event Bus — Typed pub/sub system for decoupled module communication
 *
 * All inter-module communication goes through here. No module may call
 * another module's internals directly — they emit events and react to events.
 *
 * Design: thin wrapper around Node's EventEmitter with full TypeScript
 * type safety so every event name and payload is checked at compile time.
 */

import { EventEmitter } from "events";
import { logger } from "../lib/logger";

// ── Event payload types ────────────────────────────────────────────────────────

export interface StreamEventMap {
  // Source lifecycle
  SOURCE_CONNECTED:    { streamId: string; sourceType: string; url: string };
  SOURCE_DISCONNECTED: { streamId: string; sourceType: string; reason: string };
  SOURCE_RECOVERED:    { streamId: string; recoveryMs: number };
  SOURCE_FAILED:       { streamId: string; reason: string; permanent: boolean };

  // Encoder lifecycle
  ENCODER_STARTED:     { streamId: string; pid: number; args: string[] };
  ENCODER_STOPPED:     { streamId: string; code: number | null; signal: string | null };
  ENCODER_ERROR:       { streamId: string; error: string };
  ENCODER_SLOW:        { streamId: string; speed: number; sustainedMs: number };
  ENCODER_RECOVERED:   { streamId: string; speed: number };

  // Output
  OUTPUT_CONNECTED:    { streamId: string; destination: string };
  OUTPUT_FAILED:       { streamId: string; destination: string; reason: string };
  OUTPUT_RECOVERED:    { streamId: string; destination: string };

  // Scene
  SCENE_CHANGED:       { streamId: string; fromScene: string; toScene: string };
  SCENE_UPDATED:       { streamId: string; sceneId: string };

  // Overlay
  OVERLAY_UPDATED:     { streamId: string; keys: string[] };
  BREAK_STARTED:       { streamId: string; videoUrl: string };
  BREAK_ENDED:         { streamId: string };

  // Health
  HEALTH_GOOD:         { streamId: string; score: number };
  HEALTH_WARNING:      { streamId: string; score: number; reason: string };
  HEALTH_CRITICAL:     { streamId: string; score: number; reason: string };
  HEALTH_RECOVERED:    { streamId: string; score: number };

  // Adaptive quality
  LOW_CPU:             { cpu: number };
  HIGH_CPU:            { cpu: number };
  LOW_MEMORY:          { freeBytes: number };
  NETWORK_CONGESTION:  { streamId: string; bitrateKbps: number; targetKbps: number };

  // Watchdog
  FRAME_STALL:         { streamId: string; stalledMs: number };
  STARTUP_TIMEOUT:     { streamId: string; elapsedMs: number };

  // Stream lifecycle
  STREAM_STARTED:      { streamId: string };
  STREAM_STOPPED:      { streamId: string; manual: boolean };
  STREAM_RECONNECTING: { streamId: string; attempt: number; delayMs: number };
  STREAM_STREAMING:    { streamId: string };

  // Metrics
  METRICS_SAMPLE:      { streamId: string; fps: number; bitrateKbps: number; speed: number; droppedFrames: number };
}

// ── EventBus ──────────────────────────────────────────────────────────────────

class EventBus extends EventEmitter {
  private readonly debugMode: boolean;

  constructor() {
    super();
    this.setMaxListeners(100); // many modules may subscribe
    this.debugMode = process.env.EVENT_BUS_DEBUG === "true";
  }

  emit<K extends keyof StreamEventMap>(event: K, payload: StreamEventMap[K]): boolean {
    if (this.debugMode) {
      logger.debug({ event, payload }, "[event-bus]");
    }
    return super.emit(event, payload);
  }

  on<K extends keyof StreamEventMap>(
    event: K,
    listener: (payload: StreamEventMap[K]) => void,
  ): this {
    return super.on(event, listener as any);
  }

  once<K extends keyof StreamEventMap>(
    event: K,
    listener: (payload: StreamEventMap[K]) => void,
  ): this {
    return super.once(event, listener as any);
  }

  off<K extends keyof StreamEventMap>(
    event: K,
    listener: (payload: StreamEventMap[K]) => void,
  ): this {
    return super.off(event, listener as any);
  }
}

export const eventBus = new EventBus();
