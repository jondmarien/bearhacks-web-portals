# bearhacks-web

Bun workspaces: **participant** (`apps/me`, port **3000**) and **admin** (`apps/admin`, port **3001**) Next.js apps, plus `packages/config` and `packages/api-client`. The FastAPI API is the sibling repo **`bearhacks-backend`**.

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
| `apps/me` | Participant portal |
| `apps/admin` | Admin portal |
| `packages/config` | `NEXT_PUBLIC_*` Zod env + design tokens |
| `packages/api-client` | `createApiClient` + Bearer JWT for FastAPI |

Handoff: [`docs/PORTAL_HANDOFF.md`](./docs/PORTAL_HANDOFF.md).
