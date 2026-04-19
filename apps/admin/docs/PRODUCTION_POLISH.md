# BearHacks 2026 — `apps/admin` Production Polish

> Change record for the staff portal upgrade from PoC to production.
> Date: 2026-04-18.
> Source plan: `admin-portal-production-polish_b151830d`.
> Sister doc: [apps/me/docs/PRODUCTION_POLISH.md](../../me/docs/PRODUCTION_POLISH.md).

---

## 1. Summary

The admin portal (`bearhacks-web/apps/admin`) was lifted from a developer-facing
PoC into a production-ready staff console. Three things changed at once, all
visual / UX — **no functional behavior was modified**:

1. **Brand identity arrived.** The portal now matches the BearHacks 2026
   palette and logo set, sharing the same `Card`, `Button`, `Field`,
   `PageHeader`, `SiteHeader`, and `SiteFooter` primitives that ship with the
   participant portal.
2. **User-facing copy was de-jargoned.** Linear ticket IDs (`DEV-21`,
   `DEV-22`), JWT field names (`app_metadata.role`), backend route names
   (`require_admin`), and references to backend READMEs were stripped from any
   string an event volunteer might read. Auth-failure messages were rewritten
   in plain English.
3. **Production-style boundaries were added.** A friendly branded `not-found`
   page and an `error.tsx` boundary now catch unknown routes and render-time
   errors instead of dropping volunteers onto a black Next.js stack trace.

The data flow, role gates, FastAPI calls, structured logging, printer status
polling, search, reprint, delete, and PATCH operations are all bit-for-bit
identical to the previous build. Only the chrome around them changed.

---

## 2. End-to-end flow

```mermaid
flowchart LR
  signedOut[Signed-out '/'] -->|Discord OAuth| signedIn[Signed-in '/']
  signedIn --> qr['/qr — QR fulfillment']
  signedIn --> profiles['/profiles — directory']
  profiles --> profileEdit['/profiles/[id] — editor']
  any[Unknown URL] --> notFound[not-found.tsx]
  thrown[Render error] --> errorBoundary[error.tsx]
  notFound --> signedOut
  errorBoundary --> signedOut
```

---

## 3. Architecture: layered stack

```mermaid
flowchart TB
  subgraph Client["apps/admin (Next.js 16, React 19)"]
    Layout["app/layout.tsx<br/>SiteHeader · AdminGateBanner · SiteFooter · metadata"]
    Providers["app/providers.tsx<br/>Supabase + React Query"]
    Pages["Pages: /, /qr, /profiles, /profiles/[id], not-found, error"]
    UI["components/ui/*<br/>Button · Card · Field · PageHeader"]
    Brand["public/brand/*.svg"]
    Pages --> UI
    Layout --> Brand
    Providers --> Pages
  end

  subgraph Tokens["packages/config/src/tokens.css"]
    SemTokens["Shared semantic tokens<br/>--bearhacks-primary / accent / surface / shadow-card"]
  end

  subgraph Backend["bearhacks-backend (FastAPI)"]
    QrRouter["routers/qr.py<br/>require_admin"]
    AdminProfiles["routers/admin_profiles.py<br/>require_super_admin"]
    Profiles["routers/profiles.py<br/>PATCH /profiles/{id} require_super_admin"]
  end

  subgraph Supabase["Supabase"]
    Auth["Auth (Discord OAuth)"]
  end

  Client -->|Tailwind classes| Tokens
  Client -->|Bearer JWT| Backend
  Client -->|OAuth| Auth
  Auth --> Client
```

---

## 4. Backend changes

**None.** The me-portal plan already shipped the `personal_url` column and
relaxed `PATCH /profiles/me` to `require_auth`. Admin endpoints continue to
require `require_admin` (QR routes) or `require_super_admin` (profile
directory + edits). This round was strictly frontend.

---

## 5. Design system

The admin portal now consumes the exact same tokens and primitives as `apps/me`,
so the two portals visually belong to the same product family.

### 5.1 Tokens (already shipped in `packages/config/src/tokens.css`)

Inherited from the `apps/me` rollout — see
[apps/me/docs/PRODUCTION_POLISH.md §5.1](../../me/docs/PRODUCTION_POLISH.md)
for the full token table. No new tokens were added in this round.

### 5.2 UI primitives (`apps/admin/components/ui/`)

Verbatim copies of the `apps/me` files. Same exports, same APIs:

| File              | Exports                                                         | Notes                                                    |
| ----------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `button.tsx`      | `Button` (`primary` / `secondary` / `ghost`)                    | Honors `--bearhacks-touch-min`.                          |
| `card.tsx`        | `Card`, `CardHeader`, `CardTitle`, `CardDescription`            | Token-driven border + shadow + radius.                   |
| `field.tsx`       | `InputField`, `TextareaField`                                   | Label + input/textarea + hint/error slot, `useId`-based. |
| `page-header.tsx` | `PageHeader`                                                    | Optional back arrow with `router.back()` fallback.       |

### 5.3 Brand assets

Copied into `apps/admin/public/brand/`:

- `icon_black.svg` — favicon, in-card brand mark, 404 hero.
- `icon_white.svg` — header logo on the dark-blue chrome.
- `logo_long.svg` — reserved for future signed-out hero (not yet rendered).

### 5.4 Layout chrome

`apps/admin/components/site-header.tsx` and `site-footer.tsx` mirror the
participant portal. The header keeps the dark-blue background with the white
icon and a right-hand `Admin` label (in place of the participant portal's
`Networking`). The footer is identical.

`AdminGateBanner` remains mounted directly under the header so role state is
visible on every page.

---

## 6. Page-by-page changes

### 6.1 `app/layout.tsx`

- `metadata.title = "BearHacks 2026 Admin"`, with description, `icons`, and
  `openGraph` mirroring the participant portal.
- Body switched to `--bearhacks-surface-alt` page background and `flex-col`
  layout so the footer pins to the bottom.
- `{children}` is now wrapped in `<SiteHeader />` + `<AdminGateBanner />` +
  `<SiteFooter />`.

### 6.2 `app/page.tsx` (home)

- Removed the `"QR management (DEV-21)"` and `"Super-admin profiles (DEV-22)"`
  ticket suffixes and the bullet-list navigation.
- Now renders a `PageHeader` (`Admin` + plain-English subtitle) with a top-right
  **Sign out** ghost button when a user is signed in.
- Body is two branded `Card` tiles:
  - **QR fulfillment** → `/qr` — "Generate, search, reprint, and inspect attendee QR codes."
  - **Profile directory** → `/profiles` — "Search and edit attendee profiles (super-admin only)."
- No "via OAuth" or JWT-internal copy anywhere.

### 6.3 `components/admin-gate-banner.tsx`

Auth logic untouched — only copy and chrome moved.

- Sign-in CTA uses `<Button variant="primary">` instead of an underlined `<button>`.
- Replaced
  `"Signed in as <email> with role <role> against the FastAPI API."`
  with `"Signed in as {email}. Role: {roleLabel}."` (where `roleLabel` is a
  human label like `"Super admin"` instead of the raw `super_admin` string).
- Replaced
  `"Not detected as admin in JWT app_metadata.role… UI is for convenience only — the API enforces admin on every protected route."`
  with
  `"This account is not on the admin list yet — ask a super-admin to add you, then sign out and back in."`
- Discord OAuth, role detection, and disabled-provider toast logic are
  unchanged.

### 6.4 `app/qr/page.tsx`

Chrome and copy only — every query, mutation, and handler stays identical.

- Wrapped in `<PageHeader title="QR fulfillment" subtitle="…" backHref="/" showBack />`.
- Sections (`Printer server status`, `Generate batch`, `Print existing QR codes`,
  `Search by claim status`) are now `Card`s with `CardTitle` / `CardDescription`.
- Raw `<button>` / `<input>` / `<select>` swapped for `Button` and `InputField`
  primitives. The status filter retains a native `<select>` styled to match the
  field tokens.
- Replaced `"require_admin"` user-visible copy with `"Staff access required."`,
  and `"Admin role required"` toast strings with `"Admin access required."`.
- The `View` / `Reprint` / `Delete` row actions all use the `Button` primitive.
- The `View QR details` and `Admin logs` modals are now hosted in the same
  `Card` shell. JSON metadata renders inside a styled `<pre>` block instead of
  a raw `JSON.stringify` line, so the logs read as intentional power-user
  output.
- The in-page log buffer in `lib/structured-logging.ts` is untouched.

### 6.5 `app/profiles/page.tsx`

- Removed the rendered subtitle that named DEV-22, `app_metadata.role`,
  `SUPER_ADMINS`, and the backend README. The TS file header docstring stays
  for engineers; no end-user copy mentions backend internals.
- New subtitle: "Search and edit attendee profiles."
- Wrapped in `<PageHeader title="Profiles" backHref="/" showBack />`. Search
  input is now an `InputField`. The `Apply` action is a `Button variant="primary"`.
- Non-super-admin staff now see a friendly `Card` ("Super-admin access
  required. Ask a super-admin to grant your account access, then sign out and
  back in.") instead of the JWT-internal explanation.
- Edit links render as `Button`-styled CTAs inside a `Card`-wrapped table.

### 6.6 `app/profiles/[id]/page.tsx`

- Wrapped in `<PageHeader title="Edit profile" subtitle="…" backHref="/profiles" showBack />`.
- Form moved into a `Card`. All inputs are `InputField` / `TextareaField`. Save
  is a `Button variant="primary"`.
- The `"Super-admin JWT role required. The API will reject saves otherwise."`
  message was replaced with a branded `Card` reading `"Super-admin access
  required. Editing profiles is limited to super-admins. Ask a super-admin to
  grant your account access, then sign out and back in."`
- Save error toast says `"Super-admin access required."` instead of the
  JWT-flavoured original.

### 6.7 `app/not-found.tsx` (new)

Verbatim copy of the participant portal's 404. The "Go home" CTA returns to the
admin home (`/`) since this is the admin app.

### 6.8 `app/error.tsx` (new)

Verbatim copy of the participant portal's branded `Card`-based error boundary,
logging through `@bearhacks/logger`.

---

## 7. Infra-style fixes

### 7.1 `next.config.ts` — dev CSP

Mirrored the dev-only `connect-src` relaxation from `apps/me`:

```ts
const isDev = process.env.NODE_ENV !== "production";
const devConnectSrc = isDev
  ? " http://127.0.0.1:8000 http://localhost:8000 ws://localhost:3001 ws://127.0.0.1:3001"
  : "";
```

The websocket origins use port `3001` because admin's dev script runs on
`3001` (vs. `me`'s `3000`). Production CSP is unchanged: only
`https://api.bearhacks.com` and `https://*.supabase.co` are whitelisted.

### 7.2 `.env.local` — local API for dev

`NEXT_PUBLIC_API_URL` is set to `http://127.0.0.1:8000` so admin testing
exercises the local FastAPI. Must be flipped back to `https://api.bearhacks.com`
before deploy. **A `bun dev:admin` restart is required after changing
`NEXT_PUBLIC_API_URL` or `next.config.ts`** because Next.js bundles those at
startup.

---

## 8. File map of the change

```
bearhacks-web/apps/admin/
├── app/
│   ├── layout.tsx                            (modified — metadata, header/footer)
│   ├── page.tsx                              (rewritten — branded home)
│   ├── not-found.tsx                         (new)
│   ├── error.tsx                             (new)
│   ├── qr/page.tsx                           (modified — chrome + copy + primitives, no logic)
│   ├── profiles/page.tsx                     (modified — chrome + copy + primitives, no logic)
│   └── profiles/[id]/page.tsx                (modified — chrome + copy + primitives, no logic)
├── components/
│   ├── site-header.tsx                       (new — mirrors apps/me, label "Admin")
│   ├── site-footer.tsx                       (new — copied from apps/me)
│   ├── admin-gate-banner.tsx                 (modified — softer copy, uses Button primitive)
│   └── ui/
│       ├── button.tsx                        (new — copied from apps/me)
│       ├── card.tsx                          (new — copied from apps/me)
│       ├── field.tsx                         (new — copied from apps/me)
│       └── page-header.tsx                   (new — copied from apps/me)
├── public/brand/
│   ├── icon_black.svg                        (new — copied)
│   ├── icon_white.svg                        (new — copied)
│   └── logo_long.svg                         (new — copied)
├── next.config.ts                            (modified — dev CSP for 127.0.0.1:8000)
└── .env.local                                (modified — point at local API for dev)
```

---

## 9. Internally driven changes → mapping

The admin portal was not driven by founder asks (the `me` portal absorbed
those). This pass was driven by internal staff-experience asks observed during
the participant-portal polish: anything that would be embarrassing to demo to
a new event volunteer.

| Internal ask                                                                   | Where it landed                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| "Don't show Linear ticket IDs to volunteers"                                   | `app/page.tsx` (no DEV-21/DEV-22), `app/profiles/page.tsx` (no DEV-22) |
| "Don't expose JWT field names like `app_metadata.role` in user-facing copy"   | `components/admin-gate-banner.tsx`, `app/profiles/page.tsx`, `app/profiles/[id]/page.tsx` |
| "Don't reference backend route guards (`require_admin`) in user-facing copy"  | `app/qr/page.tsx`, `app/profiles/[id]/page.tsx`, all toast strings   |
| "Both portals should look like the same product"                              | Shared `SiteHeader` / `SiteFooter` / UI primitives / brand assets    |
| "Friendly 404 instead of the Next.js default"                                  | `app/not-found.tsx`                                                  |
| "Don't drop volunteers onto a render-time stack trace"                         | `app/error.tsx`                                                      |
| "Logs viewer should look like a tool, not a debug dump"                        | `app/qr/page.tsx` logs modal (Card shell + styled `<pre>`)           |
| "Local dev should hit the local FastAPI without CSP errors"                   | `next.config.ts` dev `connect-src` + `.env.local` API URL            |

---

## 10. Verification

| Check                                                                              | Result      |
| ---------------------------------------------------------------------------------- | ----------- |
| `bun run lint` (`apps/me` + `apps/admin`)                                          | ✅ Clean    |
| `bun run typecheck` (`apps/me` + `apps/admin`)                                     | ✅ Clean    |
| Cursor in-IDE lints on edited files                                                | ✅ Clean    |
| Admin endpoints unchanged (`require_admin` / `require_super_admin`)               | ✅ Confirmed |

### Manual smoke checklist

1. Anonymous → `/` shows the new branded shell, `AdminGateBanner` rendered with softened copy, single Discord sign-in CTA.
2. Sign in with non-admin Discord account → banner shows the friendly "ask a super-admin" copy, no JWT field names leaked.
3. Sign in with admin → home shows two cards (QR fulfillment, Profile directory). No DEV-21 / DEV-22 strings anywhere.
4. `/qr` → branded `<PageHeader>` with back arrow, `Field` / `Button` primitives, table inside `Card`; printer/search/reprint/delete/logs all behave identically to before.
5. `/profiles` → branded list, no `app_metadata.role` mentions; non-super-admin staff see the new soft `Card`.
6. `/profiles/{id}` → branded editor; PATCH still works for super-admin.
7. `/some-bogus-url` → branded 404 with founder copy.
8. Throw a render error in dev (`throw new Error('test')` inside a page temporarily) → `error.tsx` boundary renders.
9. Browser DevTools Network: `/qr`, `/profiles` requests go to `http://127.0.0.1:8000` (no CSP block).
10. Tap targets ≥ 44px (enforced by `--bearhacks-touch-min`); contrast ≥ AA on dark-blue/orange palette.

---

## 11. Out of scope (intentional non-goals)

- Any change to `lib/supabase-role.ts`, route gating, or FastAPI call shape.
- Functional behavior of `/qr` (printer status, search, reprint, delete, logs viewer).
- Functional behavior of `/profiles` and `/profiles/[id]` editor.
- `AdminGateBanner` auth logic (Discord OAuth stays — admin still uses Discord).
- Any backend changes (this round is frontend-only; backend was already done in the `me` plan).
- A signed-out hero with `logo_long.svg` (asset is shipped but not yet rendered — reserved for a future round).

---

## 12. Visual alignment with bearhacks.com (2026)

Date: 2026-04-18 (companion to [`apps/me` §12](../../me/docs/PRODUCTION_POLISH.md#12-visual-alignment-with-bearhackscom-2026)). Source: `bearhacks-frontend/2026`.

Per-app asset copy, mirrored `pill` variant + `tone="marketing"` PageHeader, lite hero on signed-out, light pass on signed-in pages, cream footer with `bear_footer`. **No functional changes.** Out of scope: clouds on signed-in pages, wooden frame, floating pill nav.

### 12.1 Shared design tokens (already shipped in the me pass)

[`packages/config/src/tokens.css`](../../../packages/config/src/tokens.css) already exposes the marketing tokens consumed here:

- `--bearhacks-cream: #FFF4CF`
- `--bearhacks-sky-from: #CEE5FF`
- `--bearhacks-text-marketing: #512B10`
- `--bearhacks-radius-pill: 3.125rem`

Admin already consumes these — no token edits in this round.

### 12.2 Per-app asset copy

Mirrored 9 brand files from [`apps/me/public/brand/`](../../me/public/brand/) into [`apps/admin/public/brand/`](../public/brand/):

`wordmark_hero.webp`, `bear_cloud_left.webp`, `bear_cloud_right.webp`, `bear_redirect.webp`, `bear_walking.webp`, `bee.webp`, `bear_footer.webp`, `wooden_frame.svg`, `icon_color.svg`. (Copied rather than symlinked so Vercel `public/` resolution stays stable.)

### 12.3 Primitive parity

- **`pill` variant** added to [`components/ui/button.tsx`](../components/ui/button.tsx) — same shape as me: `rounded-[var(--bearhacks-radius-pill)] px-6 py-3` white pill with thin black/50 border, soft shadow, cream hover. Existing `primary | secondary | ghost` variants now own their own `rounded-` and `px-` classes (pulled out of the base) so the new pill rounding doesn't conflict.
- **`tone="marketing"`** added to [`components/ui/page-header.tsx`](../components/ui/page-header.tsx) — opt-in switch that renders the title as `font-extrabold uppercase tracking-[0.15rem] text-(--bearhacks-text-marketing)` and the subtitle in muted brown. Default `tone` unchanged.

### 12.4 Page-by-page deltas

- **Signed-out `/`** ([`app/page.tsx`](../app/page.tsx) `!user` branch) — replaces the dashboard cards with a centered cream lite hero: cream page surface, watercolor `wordmark_hero.webp` (smaller than me's hero — `max-w-xs sm:max-w-sm`), brown uppercase "Staff console · BearHacks 2026" subline, helper copy pointing at the existing `AdminGateBanner` Discord pill above. No clouds, no cloud-bears — keeps it clearly "staff console" not "marketing".
- **Signed-in `/`** (same file) — `PageHeader tone="marketing"` ("ADMIN" in brown uppercase), "Sign out" action becomes `variant="pill"`, card titles get the cream highlight on the keyword (`QR fulfillment`, `Profile directory`), and the "Open …" CTAs swap rectangular `rounded-md` for `rounded-pill px-6 py-3` so they read as marketing pills.
- **`/qr`** ([`app/qr/page.tsx`](../app/qr/page.tsx)) — `PageHeader tone="marketing"`. Logs modal heading picks up brown text + cream highlight on the "logs" keyword. Workflow buttons (Generate, Print, Reprint, Delete, View) stay `variant="primary"`/`"ghost"` for affordance density.
- **`/profiles`** ([`app/profiles/page.tsx`](../app/profiles/page.tsx)) — `PageHeader tone="marketing"`. Per-row "Edit" link becomes a pill.
- **`/profiles/[id]`** ([`app/profiles/[id]/page.tsx`](../app/profiles/[id]/page.tsx)) — `PageHeader tone="marketing"`. Display name preview rendered in brown extrabold above the form. "Save changes" stays `variant="primary"` (dense form, not a pill surface).
- **Gate banner** ([`components/admin-gate-banner.tsx`](../components/admin-gate-banner.tsx)) — Discord sign-in and Sign-out buttons swap to `variant="pill"`. Traffic-light role colors (green/amber) and the missing-env amber stripe stay — those are functional signals.
- **`/some-bogus-url`** ([`app/not-found.tsx`](../app/not-found.tsx)) — cream page background, `bear_redirect.webp` instead of the icon, brown uppercase headline, pill "Go home" CTA. Intentionally **no** `<Clouds />` — keeps a subtle distinction from the me 404.
- **Site footer** ([`components/site-footer.tsx`](../components/site-footer.tsx)) — cream background, `bear_footer.webp` inline next to the copy line, brown uppercase tracking text, brown link.

### 12.5 What stayed unchanged (intentional)

- Site header ([`components/site-header.tsx`](../components/site-header.tsx)) — dark-blue chrome with the white icon and "Admin" label is already on-brand.
- Error boundary ([`app/error.tsx`](../app/error.tsx)) — same call as me's pass.
- Workflow form inputs (`InputField`, `TextareaField`) — no decorative styling, contrast-first.
- All API surfaces, React Query keys, structured logging, role gates (`isStaffUser` / `isSuperAdminUser`), and Supabase auth.

### 12.6 Verification

| Check                                           | Result   |
| ----------------------------------------------- | -------- |
| `bun lint` (`apps/me` + `apps/admin`)           | ✅ Clean |
| `bun typecheck` (`apps/me` + `apps/admin`)      | ✅ Clean |
| Cream `#FFF4CF` on brown `#512B10` contrast     | ✅ ~12:1, well above AA |

Manual smoke (against `http://127.0.0.1:8000`):

1. Signed-out `/` → cream page with watercolor wordmark + helper copy; pill Discord button in the gate banner above. No QR/Profiles cards visible.
2. Sign in as super-admin → green gate banner stripe + brown uppercase "ADMIN" PageHeader + cream-highlight cards + pill "Open …" CTAs.
3. Sign in as non-staff Discord account → amber gate banner with the "ask a super-admin" copy; page below renders the same dashboard (visual gate, not a route gate — by design).
4. `/qr` → marketing-tone PageHeader; QR generation flow unchanged; logs modal renders with brown heading + cream highlight.
5. `/profiles` → marketing-tone PageHeader; search works; row "Edit" links are pills.
6. `/profiles/{id}` (as super-admin) → marketing-tone PageHeader; brown display name above the form; save still PATCHes and toasts.
7. `/some-bogus-url` → cream + bear_redirect + brown headline + pill CTA. No clouds.
8. Footer: cream stripe + bear_footer image + brown uppercase copy.
9. Side-by-side with `apps/me` open in another tab — both feel like the same product family.

---

## 13. Super-admin manager

Date: 2026-04-18. Lets an existing super-admin grant or revoke `super_admin` access to/from a Supabase user identified by their Discord email, directly from the admin portal. One UI action mutates **both** sides of the gate so they stay in sync:

1. Supabase Auth `app_metadata.role` (the JWT check used by `require_super_admin`).
2. `portal_super_admin_emails` Postgres allowlist (the portal email gate).

### 13.1 Backend

New router [`bearhacks-backend/routers/admin_super_admins.py`](../../../../bearhacks-backend/routers/admin_super_admins.py), mounted at `/admin/super-admins` in [`main.py`](../../../../bearhacks-backend/main.py). All routes guarded by `require_accepted_super_admin` (portal-access gate + super-admin role).

| Route | Behavior |
| ----- | -------- |
| `GET  /admin/super-admins` | Returns `list[SuperAdminRow]` from `auth.users` filtered to `app_metadata.role == "super_admin"`, cross-referenced with `portal_super_admin_emails`. Allowlist rows with no matching auth user surface as drift entries (`user_id: ""`, `on_allowlist: true`, `has_jwt_role: false`) so the UI can flag them. |
| `POST /admin/super-admins` `{ email }` | Looks up the user by email via `supabase.auth.admin.list_users`. **404** if no Supabase user exists ("they need to sign in with Discord at least once first"). Otherwise calls `update_user_by_id` with `app_metadata = { ...existing, role: "super_admin" }` (preserves other metadata) and upserts into `portal_super_admin_emails`. |
| `DELETE /admin/super-admins/{user_id}` | **403** if `user_id == caller.sub` (self-revoke guard — prevents accidental lockout). **400** if this would leave zero super-admins. Otherwise clears `app_metadata.role` (per the open question in the plan — clear, not demote) and deletes the matching email from `portal_super_admin_emails`. Returns 204. |

Service-role: reuses the existing `core.db.supabase` client, which is already created with the service-role key (it's the same client that writes to RLS-locked `portal_super_admin_emails` in the existing portal gate). No new env or helper needed.

Audit: every grant/revoke writes a structured `event=admin_super_admin_{grant,revoke}` log line through the existing `logging` module with `actor`, `resource_id`, and `result` fields.

### 13.2 Frontend

New page [`apps/admin/app/super-admins/page.tsx`](../app/super-admins/page.tsx) mirrors the conventions from [`profiles/page.tsx`](../app/profiles/page.tsx):

- Same `useSupabase` + session effect, `isStaffUser` / `isSuperAdminUser` gates.
- Non-staff and non-super-admin states render the existing amber "access required" `Card`.
- `PageHeader title="Super-admins" tone="marketing" backHref="/" showBack`.
- `useApiClient` + React Query: `useQuery(["admin-super-admins"])` + `useMutation` for grant/revoke; both invalidate `["admin-super-admins"]` and toast on success/failure with friendly messages parsed from FastAPI `detail.message`.
- `createStructuredLogger("admin/super-admins")` mirrors the `event` / `actor` / `resourceId` / `result` shape used in [`app/qr/page.tsx`](../app/qr/page.tsx).

Layout — two stacked `Card`s, no new primitives:

1. **Grant card** — `<InputField type="email">` + `<Button variant="primary">Grant super-admin</Button>`. Helper copy: "They need to have signed in with Discord at least once before you can grant access."
2. **Current super-admins card** — table with columns `Email | Granted | Status | Actions`. `Status` shows an amber **Drift** chip when `on_allowlist !== has_jwt_role`. `Actions`: pill "Revoke" — disabled with `title=` for the caller's own row and for orphaned allowlist rows (no matching auth user). Revoke prompts `window.confirm`.

### 13.3 Dashboard wire-up

[`apps/admin/app/page.tsx`](../app/page.tsx) gains a third `Card` linking to `/super-admins`. Grid bumped from `sm:grid-cols-2` to `sm:grid-cols-2 lg:grid-cols-3`. Card uses the same cream-highlight title pattern (`Super- <span class="bg-cream">admins</span>`) and pill CTA as the existing two cards. Card is rendered for any signed-in user; the page itself enforces super-admin via `isSuperAdminUser`, and the API enforces it via `require_accepted_super_admin`.

### 13.4 File map

```
bearhacks-backend/
  routers/admin_super_admins.py                 (new — GET/POST/DELETE)
  main.py                                       (modified — mount /admin/super-admins)
  tests/test_admin_super_admins_router.py       (new — list/grant/revoke smoke + guards)
  tests/conftest.py                             (new — sys.path shim so `from core...` resolves regardless of cwd)

bearhacks-web/apps/admin/
  app/super-admins/page.tsx                     (new)
  app/page.tsx                                  (modified — third Card; grid bumped to 3-up at lg)
  docs/PRODUCTION_POLISH.md                     (modified — this section)
```

### 13.5 Verification

| Check | Result |
| ----- | ------ |
| `uv run pytest tests/test_admin_super_admins_router.py` | ✅ All passed (list + drift, grant 404, grant success, self-revoke 403, last-admin 400, revoke clears metadata + allowlist) |
| `bun lint` (`apps/me` + `apps/admin`) | ✅ Clean |
| `bun typecheck` (`apps/me` + `apps/admin`) | ✅ Clean |

Manual smoke (local FastAPI + `bun dev:admin`):

1. Sign in as super-admin → dashboard now shows three cards.
2. Open `/super-admins` → see yourself listed; **Revoke** is disabled on your row with a tooltip explaining why.
3. Grant a known Discord-signed-in test email → row appears with `Granted = now`, status `In sync`.
4. Sign in as that user in another browser → JWT now has `app_metadata.role: super_admin`; they can also access `/super-admins`.
5. Revoke them from the original session → after their next session refresh they drop back to non-super.
6. Try granting `noone@example.com` → friendly 404 toast ("No account found…").
7. Sign in as a regular `admin` → page shows the amber "Super-admin access required" card; direct API call returns 403.
8. Sanity-check `portal_super_admin_emails` in Supabase SQL editor matches each grant/revoke.

### 13.6 Out of scope (intentional)

- Granting `admin` (vs `super_admin`) — only the requested role for v1.
- Email invites for users who haven't signed in yet (would require Supabase `inviteUserByEmail` + a pending state).
- Audit log viewer in the UI (audit rows write server-side; surfacing them is a follow-up).
- Bulk import / CSV.

