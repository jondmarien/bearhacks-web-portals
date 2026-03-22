# Portal handoff (me + admin)

**Canonical API:** [`bearhacks-backend`](https://github.com/jondmarien/bearhacks-backend) (FastAPI). **Public base URL:** `https://api.bearhacks.com` — routes live at the **host root** (`GET /` health, `/qr`, `/claim`, `/profiles`, …; no `/api` prefix). This repo is **thin clients**: Supabase Auth in the browser, domain calls go through `@bearhacks/api-client` with the user JWT. **Never** ship the Supabase **service role** key to these apps.

## Linear → app → API

| Linear / area | App | FastAPI prefix |
|---------------|-----|----------------|
| DEV-15, claim | `apps/me` | `/claim`, `/profiles` |
| DEV-16 | `apps/me` | `/social` |
| DEV-17, DEV-21 | `apps/admin` | `/qr`, `/admin` |
| DEV-18–20 | `apps/me` | `/profiles`, `/social`, `/claim` |
| DEV-22 | `apps/admin` + server rules | `/admin` |

## Example: health check

```tsx
"use client";
import { createApiClient } from "@bearhacks/api-client";
import { getPublicEnv } from "@bearhacks/config";

const env = getPublicEnv();
const client = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_URL,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
const json = await client.fetchJson<{ status: string }>("/");
```

Use TanStack Query for caching (`apps/me` includes a small health example on the home page).

## Repos & deploy

- **`bearhacks-web`:** this repo — deploy `apps/me` and `apps/admin` as separate targets (e.g. two Vercel projects).
- **`bearhacks-backend`:** Python only — issues for API behavior live there.
- Cross-repo changes may need **two PRs**; release order: API compatibility first when adding fields or auth.

## Local dev

1. `uv run uvicorn main:app --reload` in `bearhacks-backend`
2. `bun run dev:me` / `bun run dev:admin` here with `.env.local` set

OpenAPI: `GET /openapi.json` or `/docs` on the API host.
