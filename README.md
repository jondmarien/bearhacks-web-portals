# bearhacks-web

Bun workspaces: **participant** (`apps/me`) and **admin** (`apps/admin`) Next.js apps, plus shared packages (`packages/*`). The FastAPI API lives in the separate **`bearhacks-backend`** repo.

## Prerequisites

- [Bun](https://bun.sh/)
- API running locally (e.g. `uv run uvicorn main:app --reload` in `bearhacks-backend`) with CORS allowing `http://localhost:3000` and `http://localhost:3001`

## Setup

```bash
bun install
```

Copy [`.env.example`](./.env.example) values into each app’s **`.env.local`** as needed.

## Dev

```bash
bun run dev:me     # http://localhost:3000
bun run dev:admin  # http://localhost:3001
```

## Layout

| Path | Purpose |
|------|---------|
| `apps/me` | Participant portal (App Router) |
| `apps/admin` | Admin portal (App Router, port 3001) |
| `packages/config` | Shared env + design tokens (Task 2) |
| `packages/api-client` | FastAPI HTTP client + Bearer JWT (Task 3) |
