# AGENTS.md — Monster Game

## What this is

Deterministic monster collection/battle game. React SPA + Cloudflare Worker (D1/KV/Durable Objects). All game logic lives in `packages/core/engine.js` — it runs identically in browser and server, making PvP netcode-free.

**Language:** Pure JavaScript (ES modules, JSX). No TypeScript, no linting, no formatter.

## Commands

```bash
npm install            # install all workspace deps
npm test               # run core engine tests (node packages/core/test.js)
npm run dev:web        # Vite dev server on :5173 (proxies /api to Worker)
npm run dev:api        # wrangler dev on :8787
npm run build:web      # vite build → web/dist/
```

Worker-only:
```bash
npm run db:init        # create local D1 tables from schema.sql
npm run db:init:remote # create production D1 tables
```

**No lint/typecheck/format commands exist.** Run `npm test` to verify core logic.

## Monorepo layout

| Workspace | Package | Purpose |
|-----------|---------|---------|
| `packages/core/` | `@monster-game/core` | Shared engine (generation, stats, battle, training) + `render.js` (browser-only sprites) |
| `worker/` | `@monster-game/worker` | Cloudflare Worker — thin router, OAuth, DB. Delegates all computation to engine.js |
| `web/` | `@monster-game/web` | React SPA (Vite) — imports engine.js for display, calls API for mutations |

## Critical design rule: determinism

**`Math.random()` is forbidden inside engine calculations.** The only valid use is generating a new nonce (in `newNonce()`). All generation, stats, training, and battle resolution use seeded PRNG (`rngFromSeed`). Floating-point order matters — do not reorder existing calculations.

## Individual code format

`playerId|word|nonce` — this string IS the seed. All monster appearance, stats, and abilities derive from it. Do not store computed stats/images in DB; recompute from code on demand.

## Server authority

Training (`POST /monsters/:id/train`) and battles run server-side via `engine.js`. Client sends only user actions (which monster, which menu button). Client-side engine calls are for display preview only and must never be trusted for persistence.

## API endpoints (key ones)

- `GET /me` — current user
- `POST /monsters/summon` — create monster (body: `{word?}`)
- `POST /monsters/:id/train` — server-side training (body: `{menuId}`)
- `POST /battle/queue` — enter matchmaking (body: `{monsterId}`)
- `GET /battle/:id` — get battle events (replay log)

## Setup prerequisites

1. `npm install`
2. `npm test` — confirm core tests pass
3. Cloudflare resources: `wrangler d1 create`, `kv namespace create` → fill IDs in `worker/wrangler.toml`
4. `npm run db:init` — initialize local D1
5. Google OAuth client → copy `.dev.vars.example` to `.dev.vars`, fill credentials
6. `npm run dev:api` + `npm run dev:web`

## Pitfalls

- **Node.js compat:** Worker uses `Buffer` (for serialization). `nodejs_compat` flag is required (already set in `wrangler.toml`).
- **Cross-origin cookies:** dev uses Vite proxy to unify origin. Production needs proper `SameSite`/CORS config.
- **id_token not verified:** Google JWT signature is not validated yet. Must fix before production.
- **No CI yet:** `ARCHITECTURE.md` section 9 describes the test strategy, but no CI pipeline exists.
- **Battle balance knobs** are documented in `ARCHITECTURE.md` section 7 (`genParadox`, `condMult`, `useless`, `budget`).
