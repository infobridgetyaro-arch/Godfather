/**
 * Sections REST API
 *
 * All endpoints accept and return JSON with charset=utf-8 so emoji and any
 * Unicode character in name / content / subtitle round-trip without issues.
 *
 * Base path (mounted in bintunet-routes.ts): /api/sections
 *
 * GET    /                  — list all sections
 * POST   /                  — create a section
 * GET    /:id               — get one section
 * PATCH  /:id               — update a section
 * DELETE /:id               — delete a section
 * POST   /:id/show          — make visible
 * POST   /:id/hide          — make hidden
 * POST   /:id/toggle        — toggle visibility
 * POST   /reorder           — reorder by array of ids
 */

import { Router, type Request, type Response } from "express";
import {
  listSections,
  getSection,
  createSection,
  updateSection,
  deleteSection,
  setVisible,
  reorderSections,
} from "./manager.js";
import type { CreateSectionInput, UpdateSectionInput } from "./types.js";

const router = Router();

// Ensure JSON responses always include charset so browsers and API clients
// decode emoji / multi-byte characters correctly.
router.use((_req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// GET /api/sections
router.get("/", (_req: Request, res: Response): void => {
  res.json(listSections());
});

// POST /api/sections
router.post("/", (req: Request, res: Response): void => {
  const { name, content, subtitle, type, visible, order, color, backgroundColor, durationMs, meta } =
    req.body as CreateSectionInput & Record<string, unknown>;

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required and must be a non-empty string" });
    return;
  }

  const section = createSection({
    name: name.trim(),
    content:         typeof content === "string"         ? content         : undefined,
    subtitle:        typeof subtitle === "string"        ? subtitle        : undefined,
    type:            (["text","html","ticker","lower-third"] as const).includes(type as any) ? type as any : undefined,
    visible:         typeof visible === "boolean"        ? visible         : undefined,
    order:           typeof order === "number"           ? order           : undefined,
    color:           typeof color === "string"           ? color           : undefined,
    backgroundColor: typeof backgroundColor === "string" ? backgroundColor : undefined,
    durationMs:      typeof durationMs === "number"      ? durationMs      : undefined,
    meta:            meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : undefined,
  });

  res.status(201).json(section);
});

// POST /api/sections/reorder  (must be before /:id routes)
router.post("/reorder", (req: Request, res: Response): void => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    res.status(400).json({ error: "ids must be an array of strings" });
    return;
  }
  res.json(reorderSections(ids as string[]));
});

// GET /api/sections/:id
router.get("/:id", (req: Request, res: Response): void => {
  const section = getSection(String(req.params.id));
  if (!section) { res.status(404).json({ error: "Section not found" }); return; }
  res.json(section);
});

// PATCH /api/sections/:id
router.patch("/:id", (req: Request, res: Response): void => {
  const id = String(req.params.id);
  if (!getSection(id)) { res.status(404).json({ error: "Section not found" }); return; }

  const input = req.body as UpdateSectionInput;
  // Validate type if provided
  if (input.type !== undefined && !["text","html","ticker","lower-third"].includes(input.type)) {
    res.status(400).json({ error: `Invalid type "${input.type}". Must be text | html | ticker | lower-third` });
    return;
  }

  const updated = updateSection(id, input);
  if (!updated) { res.status(404).json({ error: "Section not found" }); return; }
  res.json(updated);
});

// DELETE /api/sections/:id
router.delete("/:id", (req: Request, res: Response): void => {
  const ok = deleteSection(String(req.params.id));
  if (!ok) { res.status(404).json({ error: "Section not found" }); return; }
  res.json({ ok: true });
});

// POST /api/sections/:id/show
router.post("/:id/show", (req: Request, res: Response): void => {
  const s = setVisible(String(req.params.id), true);
  if (!s) { res.status(404).json({ error: "Section not found" }); return; }
  res.json(s);
});

// POST /api/sections/:id/hide
router.post("/:id/hide", (req: Request, res: Response): void => {
  const s = setVisible(String(req.params.id), false);
  if (!s) { res.status(404).json({ error: "Section not found" }); return; }
  res.json(s);
});

// POST /api/sections/:id/toggle
router.post("/:id/toggle", (req: Request, res: Response): void => {
  const section = getSection(String(req.params.id));
  if (!section) { res.status(404).json({ error: "Section not found" }); return; }
  const s = setVisible(section.id, !section.visible);
  if (!s) { res.status(404).json({ error: "Section not found" }); return; }
  res.json(s);
});

export default router;
