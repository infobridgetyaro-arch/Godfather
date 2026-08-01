/**
 * Scene Manager — OBS-style scene system
 *
 * Allows creating, switching, and updating scenes without restarting FFmpeg.
 * Scenes are composed of layers that feed into the overlay engine. Changing
 * scenes updates the OverlayState in-place — no stream interruption.
 *
 * Supported layer types:
 *   - video_source    (main video feed)
 *   - browser_overlay (chat, clock, ticker)
 *   - image           (logo, lower-third background)
 *   - pip             (picture-in-picture camera)
 *   - screen_share    (screen capture)
 *   - color_matte     (solid/gradient background)
 *   - text            (lower third, guest name)
 *   - media           (break video, playback)
 */

import { randomUUID } from "crypto";
import { logger } from "../lib/logger";
import { eventBus } from "../engine/event-bus";
import type { OverlayState } from "../overlay-renderer";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LayerType =
  | "video_source"
  | "browser_overlay"
  | "image"
  | "pip"
  | "screen_share"
  | "color_matte"
  | "text"
  | "media"
  | "chat"
  | "ticker"
  | "logo"
  | "lower_third";

export interface SceneLayer {
  id: string;
  type: LayerType;
  label: string;
  visible: boolean;
  /** x, y, width, height as 0–100 % of frame */
  position: { x: number; y: number; w: number; h: number };
  /** Layer-specific properties */
  properties: Record<string, unknown>;
  zIndex: number;
}

export interface Scene {
  id: string;
  label: string;
  layers: SceneLayer[];
  createdAt: number;
  updatedAt: number;
  /** Overlay state snapshot applied when this scene is activated */
  overlaySnapshot?: Partial<OverlayState>;
}

export interface SceneTransition {
  type: "cut" | "fade" | "slide";
  durationMs: number;
}

// ── Default scenes ────────────────────────────────────────────────────────────

function buildDefaultScene(): Scene {
  return {
    id: "default",
    label: "Main Scene",
    layers: [
      {
        id: "layer-video",
        type: "video_source",
        label: "Live Source",
        visible: true,
        position: { x: 0, y: 0, w: 100, h: 100 },
        properties: {},
        zIndex: 0,
      },
      {
        id: "layer-chat",
        type: "chat",
        label: "Chat Burn-in",
        visible: true,
        position: { x: 2, y: 62, w: 30, h: 35 },
        properties: { style: "Bubble" },
        zIndex: 10,
      },
      {
        id: "layer-ticker",
        type: "ticker",
        label: "News Ticker",
        visible: false,
        position: { x: 0, y: 95, w: 100, h: 5 },
        properties: { style: "Ticker" },
        zIndex: 20,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function buildBreakScene(): Scene {
  return {
    id: "break",
    label: "Break Screen",
    layers: [
      {
        id: "layer-break-bg",
        type: "color_matte",
        label: "Break Background",
        visible: true,
        position: { x: 0, y: 0, w: 100, h: 100 },
        properties: { gradient1: "#1a1a2e", gradient2: "#16213e" },
        zIndex: 0,
      },
      {
        id: "layer-break-text",
        type: "text",
        label: "Be Right Back",
        visible: true,
        position: { x: 10, y: 40, w: 80, h: 20 },
        properties: { text: "Be right back — taking a short break!", style: "Countdown" },
        zIndex: 10,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    overlaySnapshot: { breakActive: true },
  };
}

// ── SceneManager ──────────────────────────────────────────────────────────────

export class SceneManager {
  private scenes: Map<string, Scene> = new Map();
  private activeSceneId: string = "default";
  private transition: SceneTransition = { type: "cut", durationMs: 0 };
  private readonly streamId: string;

  constructor(streamId: string) {
    this.streamId = streamId;
    const defaultScene = buildDefaultScene();
    const breakScene = buildBreakScene();
    this.scenes.set(defaultScene.id, defaultScene);
    this.scenes.set(breakScene.id, breakScene);
  }

  // ── Scene CRUD ──────────────────────────────────────────────────────────────

  createScene(label: string, layers?: Partial<SceneLayer>[]): Scene {
    const id = randomUUID();
    const scene: Scene = {
      id,
      label,
      layers: (layers ?? []).map((l, i) => ({
        id: randomUUID(),
        type: l.type ?? "video_source",
        label: l.label ?? `Layer ${i + 1}`,
        visible: l.visible ?? true,
        position: l.position ?? { x: 0, y: 0, w: 100, h: 100 },
        properties: l.properties ?? {},
        zIndex: l.zIndex ?? i,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.scenes.set(id, scene);
    logger.info({ streamId: this.streamId, sceneId: id, label }, "[scene] Created");
    return scene;
  }

  updateScene(sceneId: string, patch: Partial<Pick<Scene, "label" | "overlaySnapshot">>): boolean {
    const scene = this.scenes.get(sceneId);
    if (!scene) return false;
    Object.assign(scene, { ...patch, updatedAt: Date.now() });
    eventBus.emit("SCENE_UPDATED", { streamId: this.streamId, sceneId });
    return true;
  }

  deleteScene(sceneId: string): boolean {
    if (sceneId === "default") return false; // can't delete default
    if (sceneId === this.activeSceneId) this.switchTo("default");
    return this.scenes.delete(sceneId);
  }

  getScene(sceneId: string): Scene | undefined {
    return this.scenes.get(sceneId);
  }

  getAllScenes(): Scene[] {
    return [...this.scenes.values()];
  }

  getActiveSceneId(): string { return this.activeSceneId; }
  getActiveScene(): Scene | undefined { return this.scenes.get(this.activeSceneId); }

  // ── Layer management ────────────────────────────────────────────────────────

  addLayer(sceneId: string, layer: Omit<SceneLayer, "id">): SceneLayer | null {
    const scene = this.scenes.get(sceneId);
    if (!scene) return null;
    const newLayer: SceneLayer = { ...layer, id: randomUUID() };
    scene.layers.push(newLayer);
    scene.updatedAt = Date.now();
    eventBus.emit("SCENE_UPDATED", { streamId: this.streamId, sceneId });
    return newLayer;
  }

  updateLayer(sceneId: string, layerId: string, patch: Partial<SceneLayer>): boolean {
    const scene = this.scenes.get(sceneId);
    if (!scene) return false;
    const idx = scene.layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return false;
    scene.layers[idx] = { ...scene.layers[idx], ...patch };
    scene.updatedAt = Date.now();
    eventBus.emit("SCENE_UPDATED", { streamId: this.streamId, sceneId });
    return true;
  }

  removeLayer(sceneId: string, layerId: string): boolean {
    const scene = this.scenes.get(sceneId);
    if (!scene) return false;
    const before = scene.layers.length;
    scene.layers = scene.layers.filter((l) => l.id !== layerId);
    if (scene.layers.length !== before) {
      scene.updatedAt = Date.now();
      eventBus.emit("SCENE_UPDATED", { streamId: this.streamId, sceneId });
      return true;
    }
    return false;
  }

  // ── Scene switching ─────────────────────────────────────────────────────────

  /**
   * Switch to a scene. Returns the overlay snapshot to apply (if any).
   * Never restarts FFmpeg — callers apply the overlay snapshot via updateStreamOverlays().
   */
  switchTo(sceneId: string): Partial<OverlayState> | null {
    const target = this.scenes.get(sceneId);
    if (!target) {
      logger.warn({ streamId: this.streamId, sceneId }, "[scene] Scene not found");
      return null;
    }
    const fromScene = this.activeSceneId;
    this.activeSceneId = sceneId;

    logger.info({ streamId: this.streamId, fromScene, toScene: sceneId, label: target.label }, "[scene] Switched");
    eventBus.emit("SCENE_CHANGED", {
      streamId: this.streamId,
      fromScene,
      toScene: sceneId,
    });

    return target.overlaySnapshot ?? null;
  }

  setTransition(transition: SceneTransition): void {
    this.transition = transition;
  }

  getTransition(): SceneTransition { return this.transition; }

  // ── Serialization ───────────────────────────────────────────────────────────

  toJSON() {
    return {
      streamId: this.streamId,
      activeSceneId: this.activeSceneId,
      scenes: this.getAllScenes(),
      transition: this.transition,
    };
  }
}

// ── Scene registry (per stream) ───────────────────────────────────────────────

const sceneManagers = new Map<string, SceneManager>();

export function getOrCreateSceneManager(streamId: string): SceneManager {
  if (!sceneManagers.has(streamId)) {
    sceneManagers.set(streamId, new SceneManager(streamId));
  }
  return sceneManagers.get(streamId)!;
}

export function removeSceneManager(streamId: string): void {
  sceneManagers.delete(streamId);
}

export function getAllSceneManagers(): Map<string, SceneManager> {
  return sceneManagers;
}
