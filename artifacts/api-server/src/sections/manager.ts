/**
 * Sections manager — in-memory store backed by a JSON file.
 * Mirrors the pattern used by news-overlay (preset-manager, state-manager).
 *
 * All text is stored as-is (UTF-8 JSON) so emojis, Arabic, CJK and every
 * other Unicode codepoint round-trip without corruption.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import type { Section, CreateSectionInput, UpdateSectionInput } from "./types.js";

const DATA_DIR  = path.resolve(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "sections.json");

// ── Persistence ───────────────────────────────────────────────────────────────

function loadFromDisk(): Section[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    // Explicit utf8 encoding ensures multi-byte characters (emoji etc.) are
    // read back correctly regardless of the OS locale setting.
    const raw = fs.readFileSync(DATA_FILE, { encoding: "utf8" });
    return JSON.parse(raw) as Section[];
  } catch (e) {
    logger.warn({ err: e }, "[sections] Failed to load sections.json — starting empty");
    return [];
  }
}

function saveToDisk(sections: Section[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Indent for readability; JSON.stringify preserves all Unicode codepoints.
    fs.writeFileSync(DATA_FILE, JSON.stringify(sections, null, 2), { encoding: "utf8" });
  } catch (e) {
    logger.warn({ err: e }, "[sections] Failed to persist sections.json");
  }
}

// ── In-memory store ───────────────────────────────────────────────────────────

let sections: Section[] = loadFromDisk();

// ── Public API ────────────────────────────────────────────────────────────────

/** Return all sections, sorted by order then createdAt. */
export function listSections(): Section[] {
  return [...sections].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** Return a single section by id, or undefined if not found. */
export function getSection(id: string): Section | undefined {
  return sections.find((s) => s.id === id);
}

/** Create a new section. Supports any Unicode in name/content/subtitle. */
export function createSection(input: CreateSectionInput): Section {
  const now = Date.now();
  const section: Section = {
    id:              randomUUID(),
    name:            input.name,
    content:         input.content         ?? "",
    subtitle:        input.subtitle        ?? "",
    type:            input.type            ?? "text",
    visible:         input.visible         ?? false,
    order:           input.order           ?? sections.length,
    color:           input.color           ?? "#cc0001",
    backgroundColor: input.backgroundColor ?? "",
    durationMs:      input.durationMs      ?? 0,
    meta:            input.meta            ?? {},
    createdAt:       now,
    updatedAt:       now,
  };
  sections.push(section);
  saveToDisk(sections);
  logger.info({ id: section.id, name: section.name }, "[sections] Created");
  return section;
}

/** Update an existing section. Returns the updated section or null if not found. */
export function updateSection(id: string, input: UpdateSectionInput): Section | null {
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  sections[idx] = {
    ...sections[idx],
    ...input,
    id,                      // never allow id change
    updatedAt: Date.now(),
  };
  saveToDisk(sections);
  logger.info({ id }, "[sections] Updated");
  return sections[idx];
}

/** Delete a section. Returns true if it was found and deleted. */
export function deleteSection(id: string): boolean {
  const before = sections.length;
  sections = sections.filter((s) => s.id !== id);
  if (sections.length === before) return false;
  saveToDisk(sections);
  logger.info({ id }, "[sections] Deleted");
  return true;
}

/** Show or hide a section (toggle visibility). */
export function setVisible(id: string, visible: boolean): Section | null {
  return updateSection(id, { visible });
}

/** Reorder sections by providing an array of ids in the desired order. */
export function reorderSections(ids: string[]): Section[] {
  ids.forEach((id, idx) => {
    const s = sections.find((x) => x.id === id);
    if (s) s.order = idx;
  });
  sections = sections.map((s) => ({ ...s, updatedAt: Date.now() }));
  saveToDisk(sections);
  return listSections();
}
