# BearHacks — Admin (`apps/admin`)

Next.js **staff** portal (port **3001**). Uses Supabase Auth for session + JWT; all privileged operations are **re-enforced** by FastAPI (`require_admin` / `require_super_admin`).

## Prerequisites

- [Bun](https://bun.sh/) at repo root
- `.env.local` (see [../../.env.example](../../.env.example)): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`

## Scripts

```bash
# from monorepo root
bun run dev:admin
```

```bash
# from this app
bun run dev    # next dev -p 3001
bun run build
bun run lint
```

## Routes (MVP)

| Path | Purpose |
|------|---------|
| `/` | Index links to tools |
| `/qr` | QR ops stub — blocked on **DEV-17** (see page TODO) |
| `/profiles` | Super-admin attendee directory — **DEV-22**, API `GET /admin/profiles` |
| `/profiles/[id]` | Super-admin profile editor — **DEV-22**, API `PATCH /profiles/{id}` |

### JWT vs server allowlist

- UI gating for super-admin pages uses `user.app_metadata.role === "super_admin"`.
- The API also accepts emails listed in backend `SUPER_ADMINS`. If you are allowlisted but your JWT role is only `admin`, the API may allow writes while this UI hides super-admin screens — align role in Supabase for a consistent experience (see **`bearhacks-backend` README**).

### Coordination

- **DEV-21** (admin auth shell / nav): [`app/profiles/page.tsx`](./app/profiles/page.tsx) includes a TODO to integrate when that work lands.

## Design system (DEV-23)

Same tokens and global accessibility baselines as `apps/me`: [`packages/config/src/tokens.css`](../../packages/config/src/tokens.css), [`app/globals.css`](./app/globals.css), [`app/layout.tsx`](./app/layout.tsx).

## Reference

- **[`docs/PORTAL_HANDOFF.md`](../../docs/PORTAL_HANDOFF.md)** — API base URL, Linear mapping, `createApiClient` example.
