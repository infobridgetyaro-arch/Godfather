import { existsSync, mkdirSync } from "fs";
import { exec } from "child_process";
import https from "https";
import { logger } from "./logger";

const LOCAL_BIN = "/home/runner/workspace/.local/bin/yt-dlp";

/**
 * Absolute minimum version floor.  If GitHub is unreachable the updater falls
 * back to this version so we never regress below a known-good baseline.
 */
const MINIMUM_VERSION = "2026.06.09";

const GITHUB_LATEST_API =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

/**
 * Returns the resolved path to the yt-dlp binary, evaluated lazily at call
 * time so that a binary downloaded by ensureYtdlpVersion() at server startup
 * is always visible to callers (module-level constants are frozen before the
 * download completes).
 *
 * Priority: YTDLP_BIN env var → locally managed binary → system yt-dlp.
 */
export function getYtdlpBin(): string {
  return process.env.YTDLP_BIN ?? (existsSync(LOCAL_BIN) ? LOCAL_BIN : "yt-dlp");
}

/** @deprecated Use getYtdlpBin() so the path is resolved at call time. */
export const YTDLP_BIN: string = getYtdlpBin();

function getVersionString(bin: string): Promise<string> {
  return new Promise((resolve) => {
    exec(`"${bin}" --version`, { timeout: 10_000 }, (_err, stdout) => {
      resolve(stdout.trim());
    });
  });
}

function versionToNumber(v: string): number {
  // "2026.06.09" → 20260609
  return parseInt(v.replace(/\./g, ""), 10) || 0;
}

/**
 * Fetch the latest yt-dlp release tag from the GitHub Releases API.
 * Returns null when the network call fails (so the caller can fall back to
 * the minimum version floor instead of crashing).
 */
function getLatestRelease(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_LATEST_API,
      {
        headers: { "User-Agent": "bintunet-ytdlp-updater/1.0" },
        timeout: 12_000,
      },
      (res) => {
        let body = "";
        res.on("data", (d: Buffer) => { body += d.toString(); });
        res.on("end", () => {
          try {
            const data = JSON.parse(body) as { tag_name?: unknown };
            resolve(typeof data.tag_name === "string" ? data.tag_name : null);
          } catch {
            resolve(null);
          }
        });
        res.on("error", () => resolve(null));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/**
 * Select the correct yt-dlp asset name for the current platform.
 * The plain "yt-dlp" asset is a Python zipapp and requires Python 3 at runtime.
 * We prefer the pre-compiled native binary so no Python dependency is needed.
 */
function platformAsset(): string {
  const arch = process.arch; // "x64" | "arm64" | …
  if (process.platform === "linux") {
    return arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  }
  if (process.platform === "darwin") {
    return arch === "arm64" ? "yt-dlp_macos_legacy" : "yt-dlp_macos";
  }
  // Windows or unknown — fall back to the Python zipapp
  return "yt-dlp";
}

async function downloadBin(version: string): Promise<void> {
  mkdirSync("/home/runner/workspace/.local/bin", { recursive: true });
  const asset = platformAsset();
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}`;
  logger.info({ url, asset }, "[ytdlp] Downloading binary...");
  await new Promise<void>((resolve, reject) => {
    exec(
      `curl -fsSL "${url}" -o "${LOCAL_BIN}" && chmod +x "${LOCAL_BIN}"`,
      { timeout: 120_000 },
      (err) => { err ? reject(err) : resolve(); },
    );
  });
  const v = await getVersionString(LOCAL_BIN).catch(() => "?");
  logger.info({ version: v }, "[ytdlp] Binary updated successfully");
}

/**
 * Called once at server startup.
 *
 * 1. Queries GitHub Releases API for the latest stable yt-dlp tag.
 * 2. Falls back to MINIMUM_VERSION if GitHub is unreachable.
 * 3. Downloads/replaces the local binary only when the installed version is
 *    older than the target.
 *
 * This ensures yt-dlp is always up-to-date, which matters for YouTube relay
 * because yt-dlp regularly ships extractor patches that fix 403 / auth issues.
 */
export async function ensureYtdlpVersion(): Promise<void> {
  try {
    // Step 1: resolve target version (latest from GitHub, or minimum floor)
    const latestTag = await getLatestRelease();
    if (latestTag) {
      logger.info({ latestTag }, "[ytdlp] GitHub latest release resolved");
    } else {
      logger.warn(`[ytdlp] GitHub API unavailable — using minimum version floor ${MINIMUM_VERSION}`);
    }
    const targetVersion = latestTag ?? MINIMUM_VERSION;
    const targetNum = versionToNumber(targetVersion);

    // Step 2: check the installed binary
    if (existsSync(LOCAL_BIN)) {
      const current = await getVersionString(LOCAL_BIN);
      const currentNum = versionToNumber(current);
      if (currentNum >= targetNum) {
        logger.info(
          { version: current, target: targetVersion, path: LOCAL_BIN },
          "[ytdlp] Binary is current — no update needed",
        );
        return;
      }
      logger.warn(
        { current, target: targetVersion },
        "[ytdlp] Binary is outdated — updating to latest stable",
      );
    } else {
      logger.info(
        { target: targetVersion, path: LOCAL_BIN },
        "[ytdlp] Binary not found — downloading latest stable",
      );
    }

    await downloadBin(targetVersion);
  } catch (err: any) {
    logger.error(
      { err: err.message },
      "[ytdlp] Auto-update failed — falling back to system yt-dlp",
    );
  }
}
