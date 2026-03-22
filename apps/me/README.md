# BearHacks — Me (`apps/me`)

Next.js **participant** portal (port **3000**). Authenticates with **Supabase Auth** in the browser and calls the sibling FastAPI repo **`bearhacks-backend`** using [`@bearhacks/api-client`](../../packages/api-client) with the user’s JWT.

## Prerequisites

- [Bun](https://bun.sh/) at repo root
- `.env.local` (see [../../.env.example](../../.env.example)): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`

## Scripts

```bash
# from monorepo root
bun run dev:me
```

```bash
# from this app
bun run dev    # next dev -p 3000
bun run build
bun run lint
```

## Design system (DEV-23)

- Shared tokens: [`packages/config/src/tokens.css`](../../packages/config/src/tokens.css), imported from [`app/globals.css`](./app/globals.css).
- Typography: **Hanken Grotesk** via `next/font` in [`app/layout.tsx`](./app/layout.tsx).
- Accessibility: base styles include visible **focus-visible** rings and **≥16px** body text; interactive targets should respect `--bearhacks-touch-min` (44px) where applicable.

## API & Linear

Route mapping and JWT patterns: **[`docs/PORTAL_HANDOFF.md`](../../docs/PORTAL_HANDOFF.md)**.

Typical participant flows (claim, own profile patch, social) use `/claim`, `/profiles/me`, `/social` on the API host — never the Supabase service role key in this app.
