#!/usr/bin/env node
/**
 * failover-watcher.mjs — Backup VPS automatic stream recovery
 *
 * Run on the BACKUP VPS only (standby.yml sets VPS_ROLE=backup).
 *
 * What it does:
 *   1. Connects to the shared Redis instance (same one used by primary).
 *   2. Polls the primary heartbeat key every FAILOVER_POLL_MS (default: 3s).
 *   3. If heartbeat is stale for > FAILOVER_TIMEOUT_MS (default: 12s), the
 *      primary is assumed to have crashed.
 *   4. Loads the list of stream IDs that were active on the primary from Redis
 *      (stream configs are persisted there by redis-storage.ts on every change).
 *   5. Calls the local (backup) API to start each stream.
 *   6. Enters a cooldown for 90s to prevent flapping if primary restarts.
 *   7. Once the cooldown ends, if the primary is still down, re-checks and
 *      re-starts any streams that dropped.
 *
 * Seamless viewer experience:
 *   YouTube allows a new RTMP connection with the same stream key at any time.
 *   The backup connects with the same stream key stored in Redis — viewers may
 *   see a brief buffering spin of ~5-15 s while YouTube switches to the new
 *   ingest connection, then the stream continues normally.
 *
 * Two-account GitHub Actions setup:
 *   Account 1 (primary): runs deploy.yml           — sets VPS_ROLE=primary (default)
 *   Account 2 (backup):  runs standby.yml           — sets VPS_ROLE=backup
 *   Both must share the same REDIS_URL secret pointing to an external Redis
 *   (e.g. Redis Cloud free tier at redis.io).
 *
 * Required env vars (passed from standby.yml secrets):
 *   REDIS_URL            — shared Redis instance URL
 *   BINTUNET_PASSWORD    — password for the local API server
 *   PORT                 — local API port (default 8080)
 *   FAILOVER_POLL_MS     — polling interval in ms (default 3000)
 *   FAILOVER_TIMEOUT_MS  — primary considered dead after this many ms (default 12000)
 */

import { createClient } from "redis";

const REDIS_URL        = process.env.REDIS_URL;
const POLL_MS          = Number(process.env.FAILOVER_POLL_MS)    || 3_000;
const TIMEOUT_MS       = Number(process.env.FAILOVER_TIMEOUT_MS) || 12_000;
const COOLDOWN_MS      = 90_000;
const API_PORT         = process.env.PORT || "8080";
const API_BASE         = `http://localhost:${API_PORT}`;
const PASSWORD         = process.env.BINTUNET_PASSWORD || "bintunet";

const HEARTBEAT_KEY    = "primary:heartbeat";
const ACTIVE_KEY       = "primary:active_streams";

let sessionCookie      = null;
let inCooldown         = false;
let cooldownUntil      = 0;
let consecutiveErrors  = 0;
let redis              = null;

// ── Redis connection ──────────────────────────────────────────────────────────
async function connectRedis() {
  if (!REDIS_URL) {
    console.error("[failover] ✗ REDIS_URL not set — failover watcher cannot run.");
    console.error("[failover]   Add REDIS_URL to your GitHub Actions secrets.");
    process.exit(1);
  }

  redis = createClient({ url: REDIS_URL });
  redis.on("error", (err) => console.warn("[failover] Redis error:", err.message));
  await redis.connect();
  console.log("[failover] ✓ Connected to Redis");
}

// ── API authentication ────────────────────────────────────────────────────────
async function authenticate() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      });

      if (!res.ok) {
        console.warn(`[failover] Auth failed (${res.status}) — wrong BINTUNET_PASSWORD?`);
        await sleep(5_000);
        continue;
      }

      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        sessionCookie = setCookie.split(";")[0];
        console.log("[failover] ✓ Authenticated with local API");
        return true;
      }
    } catch (err) {
      const delay = Math.min(3_000 * attempt, 20_000);
      console.warn(`[failover] Auth attempt ${attempt} failed: ${err.message} — retry in ${delay / 1000}s`);
      await sleep(delay);
    }
  }

  console.error("[failover] ✗ Cannot authenticate — local API unreachable");
  return false;
}

// ── Heartbeat helpers ────────────────────────────────────────────────────────
async function getPrimaryAgeMs() {
  try {
    const raw = await redis.get(HEARTBEAT_KEY);
    if (!raw) return Infinity; // key expired or never set
    return Date.now() - Number(raw);
  } catch (err) {
    console.warn("[failover] Redis read error:", err.message);
    return 0; // treat as healthy if Redis is temporarily unreachable
  }
}

async function getActiveStreamIds() {
  try {
    const raw = await redis.get(ACTIVE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ── Check what the backup is currently streaming ─────────────────────────────
async function getLocalRunningStreamIds() {
  if (!sessionCookie) return [];
  try {
    const res = await fetch(`${API_BASE}/api/streams`, {
      headers: { Cookie: sessionCookie },
    });
    if (!res.ok) return [];
    const streams = await res.json();
    return streams
      .filter((s) => s.status === "streaming" || s.status === "reconnecting")
      .map((s) => s.id);
  } catch {
    return [];
  }
}

// ── Start a stream on backup via local API ────────────────────────────────────
async function startStreamOnBackup(streamId) {
  if (!sessionCookie) {
    const ok = await authenticate();
    if (!ok) return false;
  }

  try {
    const res = await fetch(`${API_BASE}/api/streams/${streamId}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
    });

    if (res.status === 401) {
      // Session expired — re-auth once and retry
      sessionCookie = null;
      const ok = await authenticate();
      if (!ok) return false;
      return startStreamOnBackup(streamId);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn(`[failover] Stream ${streamId} start failed (${res.status}): ${body.message || "unknown"}`);
      return false;
    }

    console.log(`[failover] ✅ Stream ${streamId} started on backup`);
    return true;
  } catch (err) {
    console.warn(`[failover] Stream ${streamId} start error: ${err.message}`);
    return false;
  }
}

// ── Main failover logic ───────────────────────────────────────────────────────
async function doFailover() {
  if (inCooldown && Date.now() < cooldownUntil) return;

  const streamIds    = await getActiveStreamIds();
  const alreadyRunning = await getLocalRunningStreamIds();

  // Only start streams that aren't already running on this backup
  const toStart = streamIds.filter((id) => !alreadyRunning.includes(id));

  if (!toStart.length) {
    if (streamIds.length) {
      console.log(`[failover] All ${streamIds.length} stream(s) already running on backup — no action needed`);
    } else {
      console.log("[failover] Primary down but no active streams recorded — nothing to recover");
    }
    enterCooldown();
    return;
  }

  console.log(`[failover] 🚨 PRIMARY DOWN — recovering ${toStart.length} stream(s): ${toStart.join(", ")}`);
  if (alreadyRunning.length) {
    console.log(`[failover]    (${alreadyRunning.length} already running: ${alreadyRunning.join(", ")})`);
  }

  let started = 0;
  for (const id of toStart) {
    const ok = await startStreamOnBackup(id);
    if (ok) started++;
    await sleep(2_000); // stagger starts to avoid overwhelming backup
  }

  console.log(`[failover] Recovery complete: ${started}/${toStart.length} stream(s) started.`);
  enterCooldown();
}

function enterCooldown() {
  inCooldown   = true;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  console.log(`[failover] Cooldown for ${COOLDOWN_MS / 1000}s — resuming monitoring at ${new Date(cooldownUntil).toISOString()}`);
  setTimeout(() => {
    inCooldown = false;
    console.log("[failover] Cooldown ended — resuming heartbeat monitoring");
  }, COOLDOWN_MS);
}

// ── Poll loop ────────────────────────────────────────────────────────────────
async function pollLoop() {
  console.log(`[failover] Polling every ${POLL_MS / 1000}s — primary considered dead after ${TIMEOUT_MS / 1000}s`);

  while (true) {
    try {
      const ageMs = await getPrimaryAgeMs();

      if (ageMs > TIMEOUT_MS) {
        const label = ageMs === Infinity
          ? "absent (key missing — primary may never have written one or Redis TTL expired)"
          : `stale (${(ageMs / 1000).toFixed(1)}s old — timeout is ${TIMEOUT_MS / 1000}s)`;
        console.warn(`[failover] ⚠  Primary heartbeat ${label}`);
        if (ageMs === Infinity) {
          console.warn("[failover]    Make sure deploy.yml (Account 1) is running with REDIS_URL");
          console.warn("[failover]    and VPS_ROLE is NOT set to 'backup'.");
        }
        await doFailover();
        consecutiveErrors = 0;
      } else {
        consecutiveErrors = 0;
        // Log occasionally so the GHA log doesn't look frozen
        if (Math.random() < 0.05) {
          console.log(`[failover] ✓ Primary healthy — last heartbeat ${(ageMs / 1000).toFixed(1)}s ago`);
        }
      }
    } catch (err) {
      consecutiveErrors++;
      console.warn(`[failover] Poll error (${consecutiveErrors} consecutive): ${err.message}`);
    }

    // Back off if repeatedly erroring to avoid hammering Redis
    const waitMs = consecutiveErrors > 5 ? POLL_MS * 3 : POLL_MS;
    await sleep(waitMs);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Startup ──────────────────────────────────────────────────────────────────
console.log("═".repeat(62));
console.log("[failover] BintuNet Failover Watcher");
console.log(`[failover] Redis   : ${REDIS_URL ? "configured ✓" : "NOT configured ✗"}`);
console.log(`[failover] Local API: ${API_BASE}`);
console.log(`[failover] Poll    : every ${POLL_MS / 1000}s`);
console.log(`[failover] Timeout : ${TIMEOUT_MS / 1000}s of stale heartbeat triggers failover`);
console.log("═".repeat(62));

// NOTE: YOUTUBE_COOKIES_B64 is passed to the *API server* process (standby.yml),
// not to this watcher script. The watcher only authenticates to the local API —
// it doesn't directly call YouTube. No cookie check needed here.

connectRedis()
  .then(() => authenticate())
  .then((ok) => {
    if (ok) return pollLoop();
    console.error("[failover] ✗ Cannot start — authentication failed");
    process.exit(1);
  })
  .catch((err) => {
    console.error("[failover] Fatal:", err);
    process.exit(1);
  });
