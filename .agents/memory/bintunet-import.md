---
name: BintuNet import
description: Notes from importing the Godfather GitHub repo into this workspace — architecture decisions and gotchas
---

## What was imported

Full-stack live streaming control room from https://github.com/infobridgetyaro-arch/Godfather.

- `artifacts/bintunet/` — React + Vite frontend (password-gated, default password: `bintunet`)
- `artifacts/api-server/src/` — massively extended Express server (streaming, HLS, overlays, AI, donations)

## Key decisions

**api-server dev script changed:** Godfather uses `tsx watch src/index.ts` (hot-reload) instead of the scaffold's build+run pattern. This is already applied in `artifacts/api-server/package.json`.

**WebSocket paths in artifact.toml:** `/ws`, `/ws-mic`, `/ws-cam`, `/ws-screen` must be listed in the `paths` array in `artifacts/api-server/.replit-artifact/artifact.toml`. Without this the proxy silently drops WS connections. Already applied.

**SESSION_SECRET is required:** The api-server throws and refuses to start if `SESSION_SECRET` is not set. It is already set as a Replit secret in this workspace.

**yt-dlp auto-downloaded at startup:** Binary downloaded on first run to `.local/bin/yt-dlp`. Takes a few seconds; subsequent starts reuse it.

**@napi-rs/canvas:** Server-side canvas for overlay rendering. ~14MB binary, installed from npm.

**Redis is optional:** Falls back to in-memory single-node mode if `REDIS_URL` is absent.

## Why

- `tsx watch` avoids the build step during development, making iteration faster.
- WS paths must be explicit in artifact.toml because the shared proxy only forwards listed paths.
