/**
 * Sections — named content panels for the broadcast overlay.
 * All text fields are stored as raw UTF-8 strings and support
 * emojis and any Unicode characters out of the box.
 */

export type SectionType = "text" | "html" | "ticker" | "lower-third";

export interface Section {
  id: string;
  /** Display name of this section (e.g. "Breaking News", "Lower Third") */
  name: string;
  /**
   * Main content — supports emojis, Arabic, CJK, and any Unicode text.
   * Example: "🔴 LIVE — الأخبار العاجلة — 速报"
   */
  content: string;
  /** Optional subtitle / secondary line */
  subtitle: string;
  /** Section type controls how it is rendered on-screen */
  type: SectionType;
  /** Whether the section is visible on the overlay */
  visible: boolean;
  /** Rendering order — lower numbers are rendered first */
  order: number;
  /** Hex accent colour used by the renderer (e.g. "#cc0001") */
  color: string;
  /** Background colour (empty = transparent) */
  backgroundColor: string;
  /** Duration in ms before this section auto-hides (0 = stays until hidden manually) */
  durationMs: number;
  /** Free-form metadata bag (font overrides, position, etc.) */
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSectionInput {
  name: string;
  content?: string;
  subtitle?: string;
  type?: SectionType;
  visible?: boolean;
  order?: number;
  color?: string;
  backgroundColor?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface UpdateSectionInput extends Partial<CreateSectionInput> {}
