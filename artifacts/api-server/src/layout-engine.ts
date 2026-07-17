/**
 * Layout Engine — Automatic grid layout for 1–6 concurrent live streams
 *
 * Computes an optimal viewport grid based on the number of active streams:
 *   1 stream  → full screen
 *   2 streams → side-by-side 50/50
 *   3 streams → 2-column top row (each 50%), single full-width bottom cell
 *   4 streams → 2x2 equal grid
 *   5 streams → 2x2 top + 3 equal columns bottom
 *   6 streams → 3x2 uniform grid
 *
 * All positions are expressed as percentages (0–100) so they work across
 * any output resolution. The UI can translate to pixels with simple math.
 */

import { logger } from "./lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LayoutCell {
  streamId: string;
  /** Left edge, percentage of total width (0–100) */
  x: number;
  /** Top edge, percentage of total height (0–100) */
  y: number;
  /** Cell width as percentage (0–100) */
  w: number;
  /** Cell height as percentage (0–100) */
  h: number;
  /** Index within the layout (0-based) */
  index: number;
}

export type GridType =
  | "full"      // 1 stream
  | "split2"    // 2 streams side-by-side
  | "pip"       // 1 main + 1 PiP corner (alternative 2-stream layout)
  | "split3"    // 3 streams
  | "grid4"     // 2×2
  | "mosaic5"   // 2×2 top + 3 equal bottom
  | "grid6";    // 3×2

export interface StreamLayout {
  gridType: GridType;
  cells: LayoutCell[];
  streamCount: number;
  updatedAt: number;
}

// ── Module state ──────────────────────────────────────────────────────────────

let currentLayout: StreamLayout = {
  gridType: "full",
  cells: [],
  streamCount: 0,
  updatedAt: Date.now(),
};

type LayoutChangeFn = (layout: StreamLayout) => void;
const changeListeners: LayoutChangeFn[] = [];

export function onLayoutChange(fn: LayoutChangeFn): void {
  changeListeners.push(fn);
}

function notifyChange(): void {
  for (const fn of changeListeners) {
    try { fn(currentLayout); } catch {}
  }
}

// ── Layout computation ────────────────────────────────────────────────────────

/**
 * Computes the optimal grid layout for a given set of active stream IDs.
 * The order of streamIds determines which stream occupies which cell.
 */
export function computeLayout(streamIds: string[]): StreamLayout {
  const n = Math.min(streamIds.length, 6);
  const cells: LayoutCell[] = [];
  let gridType: GridType;

  if (n === 0) {
    gridType = "full";
  } else if (n === 1) {
    gridType = "full";
    cells.push({ streamId: streamIds[0], x: 0, y: 0, w: 100, h: 100, index: 0 });
  } else if (n === 2) {
    gridType = "split2";
    cells.push({ streamId: streamIds[0], x: 0, y: 0, w: 50, h: 100, index: 0 });
    cells.push({ streamId: streamIds[1], x: 50, y: 0, w: 50, h: 100, index: 1 });
  } else if (n === 3) {
    gridType = "split3";
    // Top row: 2 cells at 50% width, 50% height
    cells.push({ streamId: streamIds[0], x: 0,  y: 0,  w: 50, h: 50, index: 0 });
    cells.push({ streamId: streamIds[1], x: 50, y: 0,  w: 50, h: 50, index: 1 });
    // Bottom row: 1 full-width cell at 50% height
    cells.push({ streamId: streamIds[2], x: 0,  y: 50, w: 100, h: 50, index: 2 });
  } else if (n === 4) {
    gridType = "grid4";
    cells.push({ streamId: streamIds[0], x: 0,  y: 0,  w: 50, h: 50, index: 0 });
    cells.push({ streamId: streamIds[1], x: 50, y: 0,  w: 50, h: 50, index: 1 });
    cells.push({ streamId: streamIds[2], x: 0,  y: 50, w: 50, h: 50, index: 2 });
    cells.push({ streamId: streamIds[3], x: 50, y: 50, w: 50, h: 50, index: 3 });
  } else if (n === 5) {
    gridType = "mosaic5";
    // Top row: 2 cells, 50% wide, 50% tall
    cells.push({ streamId: streamIds[0], x: 0,  y: 0,  w: 50,     h: 50, index: 0 });
    cells.push({ streamId: streamIds[1], x: 50, y: 0,  w: 50,     h: 50, index: 1 });
    // Bottom row: 3 cells, each ~33.33% wide, 50% tall
    cells.push({ streamId: streamIds[2], x: 0,            y: 50, w: 33.33, h: 50, index: 2 });
    cells.push({ streamId: streamIds[3], x: 33.33,        y: 50, w: 33.33, h: 50, index: 3 });
    cells.push({ streamId: streamIds[4], x: 66.66,        y: 50, w: 33.34, h: 50, index: 4 });
  } else {
    // 6 streams: 3×2 grid
    gridType = "grid6";
    const w = 100 / 3;
    for (let i = 0; i < 6; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      cells.push({
        streamId: streamIds[i],
        x: col * w,
        y: row * 50,
        w: col === 2 ? 100 - w * 2 : w,  // absorb rounding error in last column
        h: 50,
        index: i,
      });
    }
  }

  const layout: StreamLayout = {
    gridType,
    cells,
    streamCount: n,
    updatedAt: Date.now(),
  };

  currentLayout = layout;
  logger.info({ gridType, streamCount: n }, "[layout-engine] Layout updated");
  notifyChange();
  return layout;
}

/**
 * Alternative 2-stream layout: one main (75%) and one picture-in-picture (25%)
 * positioned in the bottom-right corner.
 */
export function computePiPLayout(mainId: string, pipId: string): StreamLayout {
  const layout: StreamLayout = {
    gridType: "pip",
    cells: [
      { streamId: mainId, x: 0, y: 0, w: 100, h: 100, index: 0 },
      { streamId: pipId,  x: 72, y: 70, w: 26, h: 26, index: 1 },
    ],
    streamCount: 2,
    updatedAt: Date.now(),
  };

  currentLayout = layout;
  notifyChange();
  return layout;
}

/** Get the most recent computed layout */
export function getCurrentLayout(): StreamLayout {
  return currentLayout;
}

/**
 * Given a total output resolution (px), converts the percentage-based layout
 * to absolute pixel coordinates for FFmpeg filter graph generation.
 */
export function layoutToPixels(
  layout: StreamLayout,
  outputW: number,
  outputH: number,
): Array<LayoutCell & { xPx: number; yPx: number; wPx: number; hPx: number }> {
  return layout.cells.map((cell) => ({
    ...cell,
    xPx: Math.round((cell.x / 100) * outputW),
    yPx: Math.round((cell.y / 100) * outputH),
    wPx: Math.round((cell.w / 100) * outputW),
    hPx: Math.round((cell.h / 100) * outputH),
  }));
}
