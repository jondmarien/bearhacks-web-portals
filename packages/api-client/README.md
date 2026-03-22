# `@bearhacks/api-client`

Shared **browser-safe** HTTP client for the BearHacks FastAPI backend. Adds `Authorization: Bearer <token>` when `getAccessToken` resolves to a string.

## Usage

```ts
import { createApiClient } from "@bearhacks/api-client";

const client = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL!,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

const row = await client.fetchJson<MyType>("/profiles/me");
```

## Errors

Non-2xx responses throw `ApiError` with `status` and optional FastAPI `detail`. Import from `@bearhacks/api-client`.

## Exports

See [`src/index.ts`](./src/index.ts): `createApiClient`, `ApiError`, and related types.
