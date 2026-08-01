# BintuNet

A live streaming control room for broadcast management across Instagram, Facebook, TikTok, and YouTube.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, tsx watch)
- `pnpm --filter @workspace/bintunet run dev` — run the frontend (port 21227)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: React + Vite + Tailwind CSS (`artifacts/bintunet/`)
- **Backend**: Express.js + TypeScript with tsx watch (`artifacts/api-server/`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Services & Ports

| Service    | Workflow                          | Port |
|------------|-----------------------------------|------|
| API Server | `artifacts/api-server: API Server`| 8080 |
| Frontend   | `artifacts/bintunet: web`         | 21227|

WebSocket paths: `/ws`, `/ws-mic`, `/ws-cam`, `/ws-screen`

## Environment Variables

| Variable              | Required | Notes                                         |
|-----------------------|----------|-----------------------------------------------|
| `SESSION_SECRET`      | Yes      | Already set as Replit secret                  |
| `BINTUNET_PASSWORD`   | No       | Admin password (default: `bintunet`)          |
| `REDIS_URL`           | No       | Falls back to in-memory storage if absent     |
| `YOUTUBE_API_KEY`     | No       | For YouTube data features                     |
| `OPENAI_API_KEY`      | No       | For AI assistant features                     |
| `GROQ_API_KEY`        | No       | Alternative LLM provider                      |
| `PAYSTACK_SECRET_KEY` | No       | Payment processing                            |
| `CDN_BASE_URL`        | No       | S3/CDN for HLS uploads                        |

## Key Features

- Stream management: start/stop RTMP streams to Instagram, Facebook, TikTok, YouTube
- Break scenes with gradient background fallback
- Overlay rendering (news ticker, donations, gifts, logos)
- HLS encoding pipeline with adaptive quality management (AQM)
- WebSocket-based real-time updates
- YouTube live viewer counter
- AI assistant integration (OpenAI / Groq)
- Source failover and health scoring
- Donation gateway + gift system
- OAuth2 manager for platform authorization
- Scene manager, layout engine, section manager

## Where things live

- `artifacts/bintunet/src/` — React frontend
- `artifacts/api-server/src/` — Express API + streaming engine
- `artifacts/api-server/src/bintunet-routes.ts` — main route registration (~150KB)
- `artifacts/api-server/src/stream-manager.ts` — core streaming logic
- `artifacts/api-server/src/overlay-renderer.ts` — canvas overlay rendering
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/` — Drizzle schema
- `artifacts/api-server/.data/` — persisted data (news overlay presets, etc.)

## Architecture decisions

- API server uses `tsx watch` (hot-reload) for development instead of build+run
- WebSocket paths registered in artifact.toml so proxy forwards them
- Redis is optional — falls back to in-memory storage for single-node deployments
- `@napi-rs/canvas` for server-side canvas rendering (overlay composition)
- yt-dlp binary auto-downloaded at startup if missing

## Gotchas

- `SESSION_SECRET` must be set before the API server will start (validated at startup)
- After adding WebSocket paths, they must also be in the `paths` array in `artifact.toml`
- The overlay renderer loads Noto Sans from the Nix store at startup — warn if not found
- yt-dlp is downloaded at first start; subsequent starts reuse the cached binary

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `artifacts/api-server/.env.example` for the full list of optional env vars
