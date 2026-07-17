# BintuNet Controller

A live-streaming management platform for broadcasting to YouTube, Facebook, TikTok, and other platforms simultaneously. Includes a news overlay engine, donation/payment gateway, HLS encoding, scene management, and AI-assisted tools.

## Architecture

- **Frontend** (`artifacts/bintunet/`) — React + Vite + Tailwind + shadcn/ui, port 5000
- **API Server** (`artifacts/api-server/`) — Express + TypeScript, port 8080
- **DB** (`lib/db/`) — Drizzle ORM + PostgreSQL (schema currently empty — tables to be added)
- **API types** (`lib/api-zod/`, `lib/api-spec/`, `lib/api-client-react/`) — shared Zod schemas and React Query hooks

## Running

Two workflows must be running:
- `artifacts/bintunet: web` — frontend dev server
- `artifacts/api-server: API Server` — backend API

## Login

Default password: set via `BINTUNET_PASSWORD` environment variable (currently `bintunet`).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes (secret) | Express session signing key |
| `BINTUNET_PASSWORD` | No | Admin login password (defaults to `bintunet` — **change this in production**) |
| `DATABASE_URL` | No | PostgreSQL connection string — only needed when the DB-backed storage layer is active |
| `REDIS_URL` | No | Enables HA mode + persistent WebSocket bus (runs in-memory without it) |
| `YOUTUBE_API_KEY` | No | Live viewer/subscriber polling |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CDN_BASE_URL` | No | Cloudflare R2 for HLS segment CDN |
| `OPENAI_API_KEY` | No | AI assistant features |
| `HLS_ENABLED` | No | Set to `true` to enable HLS encoder alongside RTMP |

## First-run setup notes

- `.env.example` is for reference only — the app does **not** load `.env` files. Set env vars via Replit Secrets or the env panel.
- `SESSION_SECRET` must be set as a Replit Secret (it already is if you're reading this after setup).
- The app runs without Redis, R2, YouTube API key, or OpenAI key — those features are simply disabled.
- Vite requires `PORT` and `BASE_PATH` at startup; the workflow handles this (`PORT=5000 BASE_PATH=/`). Do not run the frontend with bare `pnpm dev`.

## User preferences

- Keep existing project structure and stack
