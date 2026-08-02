/**
 * ws-bus.ts — Redis pub/sub WebSocket broadcast bus
 *
 * When multiple API nodes run behind a load balancer, each node has its own
 * set of WebSocket clients. A broadcast from Node A must reach clients on
 * Node B too. This module publishes WS messages to a Redis channel so every
 * node fan-outs to its own local clients.
 *
 * If Redis is not configured, falls back to local-only broadcast (single-node
 * behaviour — existing functionality is preserved).
 *
 * Usage:
 *   import { wsBus } from "./state/ws-bus";
 *   await wsBus.start();                    // in index.ts
 *   wsBus.addClient(ws);                    // in WS upgrade handler
 *   await wsBus.publish({ type, data });    // replaces direct wsClients forEach
 */

import { createClient, type RedisClientType } from "redis";
import type { WebSocket } from "ws";
import { logger } from "../lib/logger";

const WS_CHANNEL = "bintunet:ws:broadcast";

class WsBus {
  private publisher: RedisClientType | null = null;
  private subscriber: RedisClientType | null = null;
  private localClients = new Set<WebSocket>();
  private redisReady = false;

  async start(): Promise<void> {
    if (!process.env.REDIS_URL) {
      logger.info("[ws-bus] No REDIS_URL — local broadcast only (single-node mode)");
      return;
    }

    try {
      this.publisher = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
      this.subscriber = createClient({ url: process.env.REDIS_URL }) as RedisClientType;

      this.publisher.on("error", (e: Error) =>
        logger.warn({ err: e.message }, "[ws-bus] Publisher error"),
      );
      this.subscriber.on("error", (e: Error) =>
        logger.warn({ err: e.message }, "[ws-bus] Subscriber error"),
      );

      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);

      await this.subscriber.subscribe(WS_CHANNEL, (message: string) => {
        this.localClients.forEach((ws) => {
          if (ws.readyState === ws.OPEN) {
            try { ws.send(message); } catch {}
          }
        });
      });

      this.redisReady = true;
      logger.info("[ws-bus] Redis pub/sub ready — multi-node broadcast enabled");
    } catch (err: any) {
      logger.warn({ err: err.message }, "[ws-bus] Redis unavailable — falling back to local");
      this.redisReady = false;
    }
  }

  addClient(ws: WebSocket): void {
    this.localClients.add(ws);
    ws.on("close", () => this.localClients.delete(ws));
  }

  async publish(msg: object): Promise<void> {
    const json = JSON.stringify(msg);

    if (this.redisReady && this.publisher) {
      try {
        await this.publisher.publish(WS_CHANNEL, json);
        return;
      } catch (err: any) {
        logger.warn({ err: err.message }, "[ws-bus] Publish failed — falling back to local");
      }
    }

    // Fallback: deliver directly to local clients only
    this.localClients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(json); } catch {}
      }
    });
  }

  /**
   * Number of locally connected WebSocket clients on this node.
   */
  get localClientCount(): number {
    return this.localClients.size;
  }
}

export const wsBus = new WsBus();
