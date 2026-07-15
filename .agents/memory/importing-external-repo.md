---
name: Importing an external GitHub repo into the pnpm workspace
description: How to bring in a full app built outside/before this artifact-routing model without breaking it.
---

When a user pastes a GitHub URL of a full app (not asking for review), clone it to `/tmp` first to inspect before touching the live workspace — never clone directly over the repl's git repo.

If the source repo is itself an older/exported pnpm-workspace-monorepo project (same `artifacts/`, `lib/` layout), don't copy its deployment scaffolding (Dockerfile, docker-compose, k8s/, ecosystem.config.cjs, start.sh, `.replit`, `replit.nix`) — none of it applies under Replit's managed artifact/workflow/proxy model. Only port `src/`, `package.json` dependencies, and config that isn't proxy/port-related.

**Why:** the source repo may predate or bypass the shared-proxy-per-path routing model (e.g. its Vite dev server proxied `/api` straight to a hardcoded `localhost:8080`). The current workspace instead expects each artifact's `artifact.toml` to own a path prefix, with services handling their own full base path (e.g. Express app mounted at `app.use("/api", router)`). Drop any vite dev-server proxy blocks from the imported config — the shared proxy already handles this.

**How to apply:** after copying `src/` trees, merge (don't blind-overwrite) `package.json` dependencies into the scaffolded package.json, keep the scaffold's existing tsconfig `references` (to workspace libs), run `pnpm install` then `pnpm run typecheck` before restarting workflows. If the app spawns real system binaries (ffmpeg, yt-dlp, imagemagick, etc.) via `child_process`, install them with `installSystemDependencies`/equivalent — they won't come from `pnpm install`.
