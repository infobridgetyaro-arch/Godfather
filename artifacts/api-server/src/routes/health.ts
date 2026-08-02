import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isShuttingDown } from "../state/heartbeat";
import { storage } from "../storage";
import { wsBus } from "../state/ws-bus";

const router: IRouter = Router();

const startTime = Date.now();

/**
 * GET /api/healthz — Minimal liveness probe (legacy, kept for compatibility)
 */
router.get("/healthz", (_req: Request, res: Response) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * GET /api/health — Detailed health status
 * Returns node metadata, uptime, stream counts, and dependency status.
 * Used by smoke tests in deploy.yml and Cloudflare health checks.
 */
router.get("/health", (_req: Request, res: Response) => {
  const streams = storage.getStreams();
  const activeStreams = streams.filter((s) => s.status === "streaming").length;

  res.json({
    status: "ok",
    role: process.env.VPS_ROLE || "primary",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    nodeVersion: process.version,
    streams: {
      total: streams.length,
      active: activeStreams,
    },
    ws: {
      localClients: wsBus.localClientCount,
      redisEnabled: !!process.env.REDIS_URL,
    },
    hls: {
      enabled: process.env.HLS_ENABLED === "true",
      cdnConfigured: !!(process.env.R2_ENDPOINT && process.env.CDN_BASE_URL),
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/ready — Kubernetes readiness probe
 * Returns 503 during graceful shutdown so k8s/PM2 stops sending traffic
 * before the process terminates. Allows in-flight requests to drain.
 */
router.get("/ready", (_req: Request, res: Response) => {
  if (isShuttingDown) {
    return res.status(503).json({
      status: "draining",
      message: "Server is shutting down — not accepting new requests",
    });
  }
  return res.json({ status: "ready" });
});

export default router;
