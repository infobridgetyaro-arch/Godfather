/**
 * YouTube OAuth2 Manager (yt-dlp device-code flow)
 *
 * Alternative to cookies.txt — user visits a Google URL once, signs in on any
 * browser/phone, and yt-dlp saves a persistent OAuth2 token automatically.
 * All future yt-dlp calls then work without any cookies file.
 *
 * Flow:
 *   POST /api/youtube/oauth2/start
 *     → spawns yt-dlp --username oauth2
 *     → captures device URL + user code from stdout/stderr
 *     → returns { deviceUrl, userCode } to the client
 *   GET /api/youtube/oauth2/status
 *     → returns current state: idle | pending | authenticated | failed
 *   DELETE /api/youtube/oauth2
 *     → clears saved token, resets state
 */

import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { YTDLP_BIN } from "./lib/ytdlp";
import { logger } from "./lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OAuth2Status = "idle" | "pending" | "authenticated" | "failed";

export interface OAuth2State {
  status: OAuth2Status;
  deviceUrl?: string;
  userCode?: string;
  verificationUrl?: string;
  startedAt?: number;
  authenticatedAt?: number;
  error?: string;
}

// ── Token file locations ───────────────────────────────────────────────────────
// yt-dlp may store the OAuth2 token in several locations depending on version.

function tokenCandidates(): string[] {
  const home = os.homedir();
  const cwd = process.cwd();
  return [
    // Standard yt-dlp config dir (XDG)
    path.join(home, ".config", "yt-dlp", ".oauth2.token"),
    path.join(home, ".config", "yt-dlp", "oauth2.token"),
    // Older yt-dlp versions
    path.join(home, ".yt-dlp", ".oauth2_token"),
    path.join(home, ".yt-dlp", "oauth2.token"),
    // CWD fallback
    path.join(cwd, ".oauth2.token"),
    // Some versions use netrc-style storage
    path.join(home, ".netrc"),
  ];
}

function findTokenFile(): string | null {
  for (const p of tokenCandidates()) {
    if (p.endsWith(".netrc")) continue; // skip netrc — false positive risk
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function isOAuth2Authenticated(): boolean {
  return findTokenFile() !== null;
}

export function getOAuth2AuthArgs(): string[] {
  if (!isOAuth2Authenticated()) return [];
  return ["--username", "oauth2", "--password", ""];
}

// ── Module state ──────────────────────────────────────────────────────────────

let activeProc: ChildProcess | null = null;
let state: OAuth2State = { status: "idle" };

export function getOAuth2State(): OAuth2State {
  // If state says idle/failed but we actually have a token, update
  if (state.status !== "authenticated" && isOAuth2Authenticated()) {
    state = { status: "authenticated" };
  }
  return { ...state };
}

// ── Start OAuth2 device-code flow ─────────────────────────────────────────────

/**
 * Starts the yt-dlp OAuth2 device-code flow.
 * Resolves with { deviceUrl, userCode } once yt-dlp emits the device URL.
 * The background process continues running while the user authenticates.
 */
export function startOAuth2Flow(): Promise<{ deviceUrl: string; userCode: string; verificationUrl: string }> {
  return new Promise((resolve, reject) => {
    // Kill any existing flow
    if (activeProc) {
      try { activeProc.kill("SIGKILL"); } catch {}
      activeProc = null;
    }

    state = { status: "pending", startedAt: Date.now() };
    logger.info("[oauth2] Starting yt-dlp OAuth2 device-code flow");

    // Use a short public video to trigger the auth flow — yt-dlp will pause and
    // print the device URL before downloading anything.
    const args = [
      "--no-config",
      "--username", "oauth2",
      "--password", "",
      "--no-playlist",
      "--skip-download",
      "--no-check-certificate",
      "--socket-timeout", "90",
      // Explicitly point at any always-available YouTube video
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    ];

    const p = spawn(YTDLP_BIN, args);
    activeProc = p;

    let allOutput = "";
    let resolved = false;

    const onChunk = (d: Buffer) => {
      const chunk = d.toString();
      allOutput += chunk;
      logger.debug({ chunk: chunk.slice(0, 300) }, "[oauth2] yt-dlp chunk");

      if (resolved) return;

      // ── Parse device URL ───────────────────────────────────────────────────
      // Different yt-dlp versions emit this differently, so we match broadly.
      const urlPatterns = [
        /https?:\/\/www\.google\.com\/device\S*/,
        /https?:\/\/accounts\.google\.com\/o\/oauth2[^\s]*/,
        /https?:\/\/google\.com\/device\S*/,
      ];

      let deviceUrl = "";
      for (const pat of urlPatterns) {
        const m = (chunk + allOutput).match(pat);
        if (m) { deviceUrl = m[0].replace(/[,;.)\s]+$/, ""); break; }
      }
      if (!deviceUrl) return;

      // ── Parse user code ────────────────────────────────────────────────────
      // Formats seen in the wild:
      //   "and enter the code: XXXX-XXXX"
      //   "Code: ABCD-1234"
      //   "Enter code XXXX"
      const codeMatch = allOutput.match(
        /(?:enter(?:\s+the)?\s+code[:\s]+|code[:\s]+)([A-Z0-9]{4,6}[-–][A-Z0-9]{4,6})/i,
      ) ?? allOutput.match(/\b([A-Z]{4,6}-[A-Z0-9]{4,6})\b/);

      const userCode = codeMatch ? codeMatch[1].toUpperCase() : "See URL above";
      const verificationUrl = `https://www.google.com/device`;

      resolved = true;
      state = { ...state, status: "pending", deviceUrl, userCode, verificationUrl };
      logger.info({ deviceUrl, userCode }, "[oauth2] Device code captured — waiting for user");
      resolve({ deviceUrl, userCode, verificationUrl });
    };

    p.stdout?.on("data", onChunk);
    p.stderr?.on("data", onChunk);

    p.on("close", (code) => {
      activeProc = null;
      if (code === 0) {
        state = { status: "authenticated", authenticatedAt: Date.now() };
        logger.info("[oauth2] yt-dlp authentication completed successfully");
      } else if (!resolved) {
        const errMsg = allOutput.slice(-800);
        state = { status: "failed", error: errMsg };
        logger.error({ code, output: errMsg }, "[oauth2] yt-dlp OAuth2 flow failed");
        reject(new Error(
          allOutput.toLowerCase().includes("not installed")
          ? "yt-dlp is not installed. Run: pip install yt-dlp"
          : `OAuth2 failed (exit ${code}). yt-dlp may not support --username oauth2 on this version. Output: ${errMsg.slice(0, 200)}`
        ));
      }
    });

    p.on("error", (err: NodeJS.ErrnoException) => {
      activeProc = null;
      const msg = err.code === "ENOENT"
        ? "yt-dlp is not installed. Install with: pip install yt-dlp"
        : err.message;
      state = { status: "failed", error: msg };
      if (!resolved) reject(new Error(msg));
    });

    // 3-minute hard timeout
    setTimeout(() => {
      if (!resolved) {
        try { p.kill("SIGKILL"); } catch {}
        activeProc = null;
        state = { status: "failed", error: "Timed out waiting for device code from yt-dlp" };
        reject(new Error("OAuth2 timed out — yt-dlp did not emit a device code within 3 minutes"));
      }
    }, 180_000);
  });
}

// ── Cancel / clear ─────────────────────────────────────────────────────────────

export function cancelOAuth2Flow(): void {
  if (activeProc) {
    try { activeProc.kill("SIGKILL"); } catch {}
    activeProc = null;
  }
  if (state.status === "pending") {
    state = { status: "idle" };
  }
}

export function clearOAuth2Token(): void {
  cancelOAuth2Flow();
  for (const p of tokenCandidates()) {
    try {
      if (p.endsWith(".netrc")) continue;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {}
  }
  state = { status: "idle" };
  logger.info("[oauth2] OAuth2 token cleared");
}
