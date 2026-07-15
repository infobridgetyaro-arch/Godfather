/**
 * Gift Economy System — TikTok-style donation tier engine.
 *
 * Maps KES amounts to gift categories. Drives animation style,
 * particle count, display mode, and sound selection in the overlay.
 *
 * DO NOT import from any other project file (used by overlay-renderer,
 * donation-gateway, and bintunet-routes — no circular deps allowed).
 */

export type GiftTier        = "silver" | "gold" | "university";
export type GiftDisplayMode = "minimal" | "standard" | "hype";
export type GiftAnimStyle   = "sparkle" | "shimmer" | "burst" | "explosion" | "supernova";
export type SoundKey        = "chime" | "pop" | "whoosh" | "boom";

export interface GiftDef {
  id:            string;
  name:          string;
  icon:          string;       // unicode emoji rendered on canvas
  tier:          GiftTier;
  displayMode:   GiftDisplayMode;
  animStyle:     GiftAnimStyle;
  primaryColor:  string;       // hex — card accent + border glow
  glowColor:     string;       // hex — shadow/glow color
  accentColor:   string;       // hex — secondary text / particles
  particleCount: number;
  durationMs:    number;
  soundKey:      SoundKey;
  minKes:        number;
  maxKes:        number;
}

export const GIFT_CATALOG: GiftDef[] = [
  {
    id: "spark",    name: "Spark Coin",   icon: "\u2728",
    tier: "silver",     displayMode: "minimal",   animStyle: "sparkle",
    primaryColor: "#60a5fa", glowColor: "#3b82f6", accentColor: "#bfdbfe",
    particleCount: 6,  durationMs: 5_000, soundKey: "chime",
    minKes: 1, maxKes: 99,
  },
  {
    id: "glow",     name: "Glow Coin",    icon: "\uD83D\uDCA0",
    tier: "silver",     displayMode: "minimal",   animStyle: "shimmer",
    primaryColor: "#818cf8", glowColor: "#6366f1", accentColor: "#c7d2fe",
    particleCount: 8,  durationMs: 5_500, soundKey: "chime",
    minKes: 100, maxKes: 299,
  },
  {
    id: "heart",    name: "Heart Boost",  icon: "\u2764\uFE0F",
    tier: "silver",     displayMode: "standard",  animStyle: "sparkle",
    primaryColor: "#f472b6", glowColor: "#ec4899", accentColor: "#fbcfe8",
    particleCount: 12, durationMs: 6_500, soundKey: "pop",
    minKes: 300, maxKes: 499,
  },
  {
    id: "star",     name: "Star Drop",    icon: "\u2B50",
    tier: "gold",       displayMode: "standard",  animStyle: "burst",
    primaryColor: "#fbbf24", glowColor: "#f59e0b", accentColor: "#fde68a",
    particleCount: 16, durationMs: 7_000, soundKey: "pop",
    minKes: 500, maxKes: 999,
  },
  {
    id: "rocket",   name: "Rocket Burst", icon: "\uD83D\uDE80",
    tier: "gold",       displayMode: "standard",  animStyle: "burst",
    primaryColor: "#f97316", glowColor: "#ea580c", accentColor: "#fed7aa",
    particleCount: 20, durationMs: 7_500, soundKey: "whoosh",
    minKes: 1_000, maxKes: 1_999,
  },
  {
    id: "galaxy",   name: "Galaxy Gift",  icon: "\uD83C\uDF0C",
    tier: "university", displayMode: "hype",      animStyle: "explosion",
    primaryColor: "#a855f7", glowColor: "#9333ea", accentColor: "#e9d5ff",
    particleCount: 30, durationMs: 9_000, soundKey: "whoosh",
    minKes: 2_000, maxKes: 4_999,
  },
  {
    id: "crown",    name: "Crown Elite",  icon: "\uD83D\uDC51",
    tier: "university", displayMode: "hype",      animStyle: "explosion",
    primaryColor: "#eab308", glowColor: "#ca8a04", accentColor: "#fef9c3",
    particleCount: 38, durationMs: 10_000, soundKey: "boom",
    minKes: 5_000, maxKes: 9_999,
  },
  {
    id: "universe", name: "Universe Gift", icon: "\uD83C\uDF20",
    tier: "university", displayMode: "hype",      animStyle: "supernova",
    primaryColor: "#06b6d4", glowColor: "#0891b2", accentColor: "#cffafe",
    particleCount: 50, durationMs: 11_000, soundKey: "boom",
    minKes: 10_000, maxKes: Infinity,
  },
];

export interface GiftQueueItem {
  id:          string;
  donorName:   string;
  amount:      string;   // formatted, e.g. "KES 500.00"
  amountKes:   number;
  message:     string;
  gift:        GiftDef;
  ts:          number;   // when payment arrived (ms)
  displayTs:   number;   // scheduled display start (non-overlapping queue)
  comboCount:  number;   // ≥ 1; incremented on combo
}

/** Classify an amount into a gift type (largest matching tier wins) */
export function classifyGift(amountKes: number): GiftDef {
  for (let i = GIFT_CATALOG.length - 1; i >= 0; i--) {
    if (amountKes >= GIFT_CATALOG[i]!.minKes) return GIFT_CATALOG[i]!;
  }
  return GIFT_CATALOG[0]!;
}

const COMBO_WINDOW_MS = 4_000; // same donor + same tier within 4 s → combo

/**
 * Add a gift to the queue with:
 * - Non-overlapping scheduled display (sequential, no simultaneous shows)
 * - Combo merging (same donor + tier within COMBO_WINDOW_MS)
 * Returns the updated queue.
 */
export function enqueueGift(
  queue: GiftQueueItem[],
  incoming: Omit<GiftQueueItem, "displayTs" | "comboCount">,
): GiftQueueItem[] {
  const now = Date.now();

  // Drop fully expired items
  const alive = queue.filter(
    (i) => i.displayTs + i.gift.durationMs > now,
  );

  // Combo: same donor, same tier, within combo window
  const comboIdx = alive.findIndex(
    (i) =>
      i.donorName === incoming.donorName &&
      i.gift.tier === incoming.gift.tier &&
      incoming.ts - i.ts < COMBO_WINDOW_MS,
  );
  if (comboIdx !== -1) {
    return alive.map((item, idx) =>
      idx === comboIdx ? { ...item, comboCount: item.comboCount + 1, ts: incoming.ts } : item,
    );
  }

  // Schedule after the last queued item finishes
  const lastEnd = alive.reduce(
    (max, i) => Math.max(max, i.displayTs + i.gift.durationMs),
    now,
  );
  const displayTs = Math.max(incoming.ts, lastEnd);

  return [...alive, { ...incoming, displayTs, comboCount: 1 }];
}
