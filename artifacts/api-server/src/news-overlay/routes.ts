import { Router, type Request, type Response } from "express";
import {
  getState, setState, resetState,
} from "./state-manager.js";
import {
  activate, deactivate, toggle, updateOverlay, applyThemeFull,
  addMessage, removeMessage, clearMessages, addBreaking, clearBreaking,
  updateTickerConfig, getCapabilities,
} from "./overlay-manager.js";
import {
  getTickerMessages, addTickerMessage, removeTickerMessage, clearTickerMessages,
} from "./ticker-manager.js";
import {
  listPresets, getPreset, createPreset, updatePreset, deletePreset,
} from "./preset-manager.js";
import {
  createWidget, validateWidget, updateWidgetRuntimeData, getAllWidgetRuntimeData,
} from "./widget-manager.js";
import { listThemes, getTheme } from "./theme-manager.js";
import { listAnimationPresets, ANIMATION_CONFIGS, buildKeyframes } from "./animation-manager.js";
import type { ThemeName, AnimationPreset, WidgetType, NewsOverlayState } from "./types.js";

const router = Router();

// ── GET /api/news-overlay ─────────────────────────────────────────────────────
router.get("/", (_req: Request, res: Response): void => {
  res.json(getState());
});

// ── PATCH /api/news-overlay ───────────────────────────────────────────────────
router.patch("/", (req: Request, res: Response): void => {
  if (!req.body || typeof req.body !== "object") {
    res.status(400).json({ error: "Body must be a JSON object" }); return;
  }
  const s = updateOverlay(req.body as Partial<NewsOverlayState>);
  res.json(s);
});

// ── POST /api/news-overlay/reset ──────────────────────────────────────────────
router.post("/reset", (_req: Request, res: Response): void => {
  const s = resetState();
  res.json(s);
});

// ── POST /api/news-overlay/activate ──────────────────────────────────────────
router.post("/activate", (_req: Request, res: Response): void => {
  res.json(activate());
});

// ── POST /api/news-overlay/deactivate ────────────────────────────────────────
router.post("/deactivate", (_req: Request, res: Response): void => {
  res.json(deactivate());
});

// ── POST /api/news-overlay/toggle ────────────────────────────────────────────
router.post("/toggle", (_req: Request, res: Response): void => {
  res.json(toggle());
});

// ── GET /api/news-overlay/capabilities ───────────────────────────────────────
router.get("/capabilities", (_req: Request, res: Response): void => {
  res.json(getCapabilities());
});

// ── GET /api/news-overlay/animations/keyframes ───────────────────────────────
router.get("/animations/keyframes", (_req: Request, res: Response): void => {
  res.type("text/css").send(buildKeyframes());
});

// ── GET /api/news-overlay/animations ─────────────────────────────────────────
router.get("/animations", (_req: Request, res: Response): void => {
  res.json({
    presets: listAnimationPresets(),
    configs: Object.fromEntries(
      listAnimationPresets().map(p => [p, ANIMATION_CONFIGS[p]])
    ),
  });
});

// ── GET  /api/news-overlay/themes ────────────────────────────────────────────
router.get("/themes", (_req: Request, res: Response): void => {
  const names = listThemes();
  res.json({
    themes: names,
    definitions: Object.fromEntries(names.map(n => [n, getTheme(n)])),
  });
});

// ── POST /api/news-overlay/themes/:name/apply ─────────────────────────────────
router.post("/themes/:name/apply", (req: Request, res: Response): void => {
  const name = decodeURIComponent(String(req.params.name)) as ThemeName;
  const available = listThemes();
  if (!available.includes(name)) {
    res.status(404).json({ error: `Theme "${name}" not found`, available }); return;
  }
  res.json(applyThemeFull(name));
});

// ── GET  /api/news-overlay/ticker ────────────────────────────────────────────
router.get("/ticker", (_req: Request, res: Response): void => {
  const { ticker } = getState();
  res.json({ config: ticker, messages: getTickerMessages() });
});

// ── PATCH /api/news-overlay/ticker ───────────────────────────────────────────
router.patch("/ticker", (req: Request, res: Response): void => {
  const cfg = updateTickerConfig(req.body);
  res.json(cfg.ticker);
});

// ── GET  /api/news-overlay/ticker/messages ────────────────────────────────────
router.get("/ticker/messages", (_req: Request, res: Response): void => {
  res.json(getTickerMessages());
});

// ── POST /api/news-overlay/ticker/messages ────────────────────────────────────
router.post("/ticker/messages", (req: Request, res: Response): void => {
  const { text, priority, expiresInMs } = req.body as { text: string; priority?: number; expiresInMs?: number };
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" }); return;
  }
  const msg = addMessage(text.trim(), priority ?? 0, expiresInMs);
  res.status(201).json(msg);
});

// ── DELETE /api/news-overlay/ticker/messages ─────────────────────────────────
router.delete("/ticker/messages", (_req: Request, res: Response): void => {
  clearMessages();
  res.json({ ok: true });
});

// ── DELETE /api/news-overlay/ticker/messages/:id ─────────────────────────────
router.delete("/ticker/messages/:id", (req: Request, res: Response): void => {
  const ok = removeMessage(String(req.params.id));
  if (!ok) { res.status(404).json({ error: "Message not found" }); return; }
  res.json({ ok: true });
});

// ── POST /api/news-overlay/breaking ──────────────────────────────────────────
router.post("/breaking", (req: Request, res: Response): void => {
  const { text } = req.body as { text: string };
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" }); return;
  }
  const msg = addBreaking(text.trim());
  res.json({ ok: true, message: msg, state: getState().breakingNews });
});

// ── DELETE /api/news-overlay/breaking ────────────────────────────────────────
router.delete("/breaking", (_req: Request, res: Response): void => {
  clearBreaking();
  res.json({ ok: true });
});

// ── GET  /api/news-overlay/widgets ───────────────────────────────────────────
router.get("/widgets", (_req: Request, res: Response): void => {
  const { widgets } = getState();
  const runtimeData = getAllWidgetRuntimeData();
  res.json({ widgets, runtimeData });
});

// ── POST /api/news-overlay/widgets ───────────────────────────────────────────
router.post("/widgets", (req: Request, res: Response): void => {
  const { type, position } = req.body as { type: WidgetType; position?: { x: number; y: number } };
  const widget = createWidget(type, position);
  const v = validateWidget(widget);
  if (!v.valid) { res.status(400).json({ error: v.error }); return; }
  const { widgets } = getState();
  updateOverlay({ widgets: [...widgets, widget] });
  res.status(201).json(widget);
});

// ── PATCH /api/news-overlay/widgets/:id ──────────────────────────────────────
router.patch("/widgets/:id", (req: Request, res: Response): void => {
  const { widgets } = getState();
  const idx = widgets.findIndex(w => w.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Widget not found" }); return; }
  const updated = { ...widgets[idx], ...req.body, id: widgets[idx].id };
  const newWidgets = [...widgets];
  newWidgets[idx] = updated;
  const s = updateOverlay({ widgets: newWidgets });
  res.json(s.widgets[idx]);
});

// ── DELETE /api/news-overlay/widgets/:id ─────────────────────────────────────
router.delete("/widgets/:id", (req: Request, res: Response): void => {
  const { widgets } = getState();
  const filtered = widgets.filter(w => w.id !== req.params.id);
  if (filtered.length === widgets.length) { res.status(404).json({ error: "Widget not found" }); return; }
  updateOverlay({ widgets: filtered });
  res.json({ ok: true });
});

// ── GET  /api/news-overlay/presets ───────────────────────────────────────────
router.get("/presets", (_req: Request, res: Response): void => {
  res.json(listPresets());
});

// ── POST /api/news-overlay/presets ───────────────────────────────────────────
router.post("/presets", (req: Request, res: Response): void => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" }); return;
  }
  const preset = createPreset(name, description ?? "", getState());
  res.status(201).json(preset);
});

// ── GET  /api/news-overlay/presets/:id ───────────────────────────────────────
router.get("/presets/:id", (req: Request, res: Response): void => {
  const p = getPreset(String(req.params.id));
  if (!p) { res.status(404).json({ error: "Preset not found" }); return; }
  res.json(p);
});

// ── PATCH /api/news-overlay/presets/:id ──────────────────────────────────────
router.patch("/presets/:id", (req: Request, res: Response): void => {
  const p = updatePreset(String(req.params.id), req.body);
  if (!p) { res.status(404).json({ error: "Preset not found" }); return; }
  res.json(p);
});

// ── DELETE /api/news-overlay/presets/:id ─────────────────────────────────────
router.delete("/presets/:id", (req: Request, res: Response): void => {
  const ok = deletePreset(String(req.params.id));
  if (!ok) { res.status(404).json({ error: "Preset not found" }); return; }
  res.json({ ok: true });
});

// ── POST /api/news-overlay/presets/:id/apply ─────────────────────────────────
router.post("/presets/:id/apply", (req: Request, res: Response): void => {
  const p = getPreset(String(req.params.id));
  if (!p) { res.status(404).json({ error: "Preset not found" }); return; }
  const s = updateOverlay(p.state as Partial<NewsOverlayState>);
  res.json({ preset: p, state: s });
});

// ── POST /api/news-overlay/headline ──────────────────────────────────────────
router.post("/headline", (req: Request, res: Response): void => {
  const { text, animation, autoRotate, headlines, durationMs } = req.body as {
    text?: string; animation?: AnimationPreset; autoRotate?: boolean;
    headlines?: string[]; durationMs?: number;
  };
  const current = getState().headline;
  const s = updateOverlay({
    headline: {
      ...current,
      ...(text !== undefined && { text }),
      ...(animation !== undefined && { animation }),
      ...(autoRotate !== undefined && { autoRotate }),
      ...(headlines !== undefined && { headlines }),
      ...(durationMs !== undefined && { durationMs }),
    },
  });
  res.json(s.headline);
});

// ── POST /api/news-overlay/live-badge ────────────────────────────────────────
router.post("/live-badge", (req: Request, res: Response): void => {
  const { visible, label, pulse, color } = req.body as {
    visible?: boolean; label?: string; pulse?: boolean; color?: string;
  };
  const current = getState().liveBadge;
  const s = updateOverlay({
    liveBadge: {
      ...current,
      ...(visible !== undefined && { visible }),
      ...(label !== undefined && { label }),
      ...(pulse !== undefined && { pulse }),
      ...(color !== undefined && { color }),
    },
  });
  res.json(s.liveBadge);
});

// ── POST /api/news-overlay/logo ───────────────────────────────────────────────
router.post("/logo", (req: Request, res: Response): void => {
  const { logo, logoUrl } = req.body as { logo?: string; logoUrl?: string };
  const s = updateOverlay({
    ...(logo !== undefined && { logo }),
    ...(logoUrl !== undefined && { logoUrl }),
  });
  res.json({ logo: s.logo, logoUrl: s.logoUrl });
});

export default router;
