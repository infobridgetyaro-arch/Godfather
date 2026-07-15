/**
 * redis-storage.ts — Hybrid in-memory + Redis storage
 *
 * Wraps MemStorage with async Redis writes so stream configs survive restarts
 * and are visible to all nodes in a multi-VPS setup.
 *
 * Interface compatibility: implements the same synchronous IStorage interface
 * so no route code needs to change. Reads always come from the local in-memory
 * cache (fast, no network hop). Writes go to memory immediately and to Redis
 * asynchronously (fire-and-forget with error logging).
 *
 * On startup (init()), the in-memory store is seeded from Redis so a process
 * restart doesn't lose all stream configs.
 *
 * Failover use case: the backup VPS calls init() on startup, loads all
 * stream configs from Redis, and can immediately restart any stream that
 * was marked as "streaming" by the primary before it died.
 */

import { createClient, type RedisClientType } from "redis";
import { MemStorage } from "../storage";
import type { IStorage } from "../storage";
import type { StreamConfig, InsertStream } from "../schema";
import { logger } from "../lib/logger";

const STREAM_PREFIX = "stream:";
const ACTIVE_KEY = "primary:active_streams";
const HEARTBEAT_KEY = "primary:heartbeat";
const HEARTBEAT_TTL_S = 30;

let _client: RedisClientType | null = null;

async function getClient(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  if (_client) return _client;

  try {
    const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
    client.on("error", (err: Error) =>
      logger.warn({ err: err.message }, "[redis] Client error"),
    );
    await client.connect();
    _client = client;
    logger.info("[redis] Connected");
    return client;
  } catch (err: any) {
    logger.warn({ err: err.message }, "[redis] Connection failed — using local memory only");
    return null;
  }
}

export class HybridStorage implements IStorage {
  private mem: MemStorage;

  constructor() {
    this.mem = new MemStorage();
  }

  /**
   * Load all stream configs from Redis into local memory.
   * Call once on server startup.
   */
  async init(): Promise<void> {
    const client = await getClient();
    if (!client) return;

    try {
      const keys = await client.keys(`${STREAM_PREFIX}*`);
      if (!keys.length) {
        logger.info("[redis] No existing streams found");
        return;
      }

      const values = await client.mGet(keys);
      let loaded = 0;
      values.forEach((raw) => {
        if (!raw) return;
        try {
          const stream: StreamConfig = JSON.parse(raw);
          // Reset status — process may have died mid-stream; avoid stuck "streaming" state
          this.mem.createStreamWithId({ ...stream, status: "idle" });
          loaded++;
        } catch {}
      });
      logger.info({ count: loaded }, "[redis] Stream configs loaded from Redis");
    } catch (err: any) {
      logger.warn({ err: err.message }, "[redis] Failed to load streams");
    }
  }

  // ── Synchronous reads from local cache ─────────────────────────────────

  getStreams(): StreamConfig[] {
    return this.mem.getStreams();
  }

  getStream(id: string): StreamConfig | undefined {
    return this.mem.getStream(id);
  }

  // ── Writes: update memory immediately, persist to Redis async ──────────

  createStream(data: InsertStream): StreamConfig {
    const stream = this.mem.createStream(data);
    this._persist(stream).catch(() => {});
    return stream;
  }

  updateStream(id: string, data: Partial<StreamConfig>): StreamConfig | undefined {
    const stream = this.mem.updateStream(id, data);
    if (stream) this._persist(stream).catch(() => {});
    return stream;
  }

  deleteStream(id: string): boolean {
    const deleted = this.mem.deleteStream(id);
    if (deleted) this._delete(id).catch(() => {});
    return deleted;
  }

  // ── Heartbeat (primary VPS) ──────────────────────────────────────────────

  async writeHeartbeat(): Promise<void> {
    const client = await getClient();
    if (!client) return;
    try {
      const streamingIds = this.mem
        .getStreams()
        .filter((s) => s.status === "streaming")
        .map((s) => s.id);

      await Promise.all([
        client.set(HEARTBEAT_KEY, String(Date.now()), { EX: HEARTBEAT_TTL_S }),
        client.set(ACTIVE_KEY, JSON.stringify(streamingIds), { EX: HEARTBEAT_TTL_S }),
      ]);
    } catch {}
  }

  // ── Failover (backup VPS) ────────────────────────────────────────────────

  async getLastHeartbeat(): Promise<number> {
    const client = await getClient();
    if (!client) return 0;
    const raw = await client.get(HEARTBEAT_KEY);
    return raw ? Number(raw) : 0;
  }

  async getActiveStreamIds(): Promise<string[]> {
    const client = await getClient();
    if (!client) return [];
    const raw = await client.get(ACTIVE_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; }
    catch { return []; }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _persist(stream: StreamConfig): Promise<void> {
    const client = await getClient();
    if (!client) return;
    await client.set(`${STREAM_PREFIX}${stream.id}`, JSON.stringify(stream));
  }

  private async _delete(id: string): Promise<void> {
    const client = await getClient();
    if (!client) return;
    await client.del(`${STREAM_PREFIX}${id}`);
  }
}

export const hybridStorage = new HybridStorage();
