# bearhacks-web

Bun workspaces: **participant** (`apps/me`, port **3000**) and **admin** (`apps/admin`, port **3001`) Next.js apps, plus shared packages (`packages/config`, `packages/api-client`, `packages/logger`). The FastAPI API is the sibling repo **`bearhacks-backend`**.

## Prerequisites

- [Bun](https://bun.sh/)
- **`.env.local`** in each app (see [`.env.example`](./.env.example)): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (production: `https://api.bearhacks.com`; use `http://127.0.0.1:8000` only for a local API)
- API running with CORS allowing `http://localhost:3000` and `http://localhost:3001` ([`bearhacks-backend` `main.py`](https://github.com/jondmarien/bearhacks-backend/blob/main/main.py))

## Setup

```bash
bun install
```

## Dev

```bash
bun run dev:me     # http://localhost:3000
bun run dev:admin  # http://localhost:3001
```

## Quality

```bash
bun run lint
bun run typecheck
```

## Layout

| Path | Purpose |
|------|---------|
| `apps/me` | Participant portal (port **3000**) — see [`apps/me/README.md`](./apps/me/README.md) |
| `apps/admin` | Staff portal (port **3001**) — see [`apps/admin/README.md`](./apps/admin/README.md) |
| `packages/config` | `NEXT_PUBLIC_*` Zod env + shared design tokens (`tokens.css`, DEV-23) |
| `packages/api-client` | Typed `createApiClient` + Bearer JWT for FastAPI |
| `packages/logger` | Scoped `createLogger(scope)` → console; `NEXT_PUBLIC_LOG_LEVEL` |

Handoff (API ↔ Linear ↔ apps): [`docs/PORTAL_HANDOFF.md`](./docs/PORTAL_HANDOFF.md).

### Super-admin profiles (DEV-22)

- Admin UI: [`apps/admin/app/profiles`](./apps/admin/app/profiles) (JWT `app_metadata.role === "super_admin"` for UI gating).
- API: `GET /admin/profiles` and `PATCH /profiles/{id}` require FastAPI `require_super_admin` (allowlisted email **or** `super_admin` role). See **`bearhacks-backend`** README and `core/auth.py`.
