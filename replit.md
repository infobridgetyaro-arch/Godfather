# BintuNet Controller

A live-streaming management platform for broadcasting to YouTube, Facebook, TikTok, and other platforms simultaneously. Includes a news overlay engine, donation/payment gateway, HLS encoding, scene management, and AI-assisted tools. Imported from an existing GitHub repository (infobridgetyaro-arch/Godfather).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, served at `/api`)
- `pnpm --filter @workspace/bintunet run dev` — run the frontend (port 5000, served at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (not actively used by this app's custom routes)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; schema currently empty, app uses in-memory storage)
- Required env: `SESSION_SECRET` (already set)

## Login

- Default password: `bintunet` (falls back to this if `BINTUNET_PASSWORD` is unset). Set `BINTUNET_PASSWORD` as a secret to change it.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (custom `bintunet-routes.ts`, not the OpenAPI-generated router) + WebSockets
- Streaming: FFmpeg (spawned as a child process) + yt-dlp (auto-downloaded to `.local/bin`) for source extraction
- Storage: in-memory (`MemStorage`), optionally backed by Redis when `REDIS_URL` is set (multi-node HA mode)
- DB: PostgreSQL + Drizzle ORM (provisioned but schema is currently empty — not used by the app yet)
- API codegen: Orval (from OpenAPI spec) — present but unused by the streaming routes
- Build: esbuild (CJS/ESM bundle)

## Where things live

- `artifacts/bintunet/` — React + Vite + Tailwind + shadcn/ui frontend (control room dashboard, stream cards, overlay/news controls, settings)
- `artifacts/api-server/src/` — all backend logic: `bintunet-routes.ts` (main route registrar), `stream-manager.ts`, `encoder/`, `news-overlay/`, `engine/`, `aqm/` (adaptive quality manager), `source/`, `state/` (Redis-backed storage + WS bus + heartbeat), `oauth2-manager.ts`, `donation-gateway.ts` (Paystack), `youtube-source.ts`/`youtube-counter.ts`, `tiktok-extractor.ts`

## Architecture decisions

- The app does not use the generated OpenAPI/Zod/React Query stack for its core functionality — it has its own hand-rolled Express routes and a custom frontend API layer. The `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` scaffolding is present but effectively a no-op (`/healthz` only).
- FFmpeg and yt-dlp are real spawned system binaries, not npm wrappers — ffmpeg is installed via Nix, yt-dlp self-updates into `.local/bin` at server startup.
- Runs fine with no optional integrations configured (Redis, R2, YouTube API key, OpenAI key, Paystack) — those features simply no-op/disable when their env vars are absent.

## Product

Control room for running simultaneous multi-platform live streams (YouTube/Facebook/TikTok/etc.), with a news-style overlay engine (tickers, headlines, presets), scene/source management, stream health monitoring with automatic failover, a donation/gift gateway, and AI-assisted tools.

## User preferences

- Keep existing project structure and stack (carried over from the original repo).

## Gotchas

- `BINTUNET_PASSWORD`, `REDIS_URL`, `YOUTUBE_API_KEY`(s), `R2_*`, `OPENAI_API_KEY`, `PAYSTACK_SECRET_KEY`, `HLS_ENABLED` are all optional — the app degrades gracefully without them.
- `DATABASE_URL` is only needed if/when a DB-backed storage layer gets added; currently everything runs in memory.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
