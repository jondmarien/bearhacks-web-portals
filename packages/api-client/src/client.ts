import { ApiError, type FastApiDetail } from "./errors";

/** Returns a Supabase (or other) bearer token, or null if unauthenticated. */
export type GetAccessToken = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export type CreateApiClientOptions = {
  /** Absolute API origin, e.g. `https://api.bearhacks.com` or `http://127.0.0.1:8000` (no trailing slash required). */
  baseUrl: string;
  /** When set, every request adds `Authorization: Bearer <token>` when the value is non-empty. */
  getAccessToken?: GetAccessToken;
};

const localThrottleState = new Map<string, number>();

const HIGH_RISK_LOCAL_THROTTLES: Array<{
  method: string;
  matcher: RegExp;
  minIntervalMs: number;
}> = [
  { method: "POST", matcher: /^\/portal\/claim-email\/request-otp$/, minIntervalMs: 5000 },
  { method: "POST", matcher: /^\/portal\/claim-email\/verify-otp$/, minIntervalMs: 1000 },
  { method: "POST", matcher: /^\/discord\/join-guild$/, minIntervalMs: 1500 },
  { method: "POST", matcher: /^\/qr\//, minIntervalMs: 800 },
  { method: "DELETE", matcher: /^\/qr\//, minIntervalMs: 800 },
  { method: "POST", matcher: /^\/admin\//, minIntervalMs: 800 },
];

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * Thin fetch wrapper for BearHacks FastAPI: joins `baseUrl` + path, attaches Bearer JWT, throws {@link ApiError} on non-OK JSON error bodies.
 */
export function createApiClient(options: CreateApiClientOptions) {
  const { baseUrl, getAccessToken } = options;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith("http") ? path : joinUrl(baseUrl, path);
    const normalizedPath = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return path;
      }
    })();
    const method = (init.method ?? "GET").toUpperCase();
    const now = Date.now();
    for (const rule of HIGH_RISK_LOCAL_THROTTLES) {
      if (rule.method !== method || !rule.matcher.test(normalizedPath)) continue;
      const key = `${method}:${normalizedPath}`;
      const last = localThrottleState.get(key) ?? 0;
      if (now - last < rule.minIntervalMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((rule.minIntervalMs - (now - last)) / 1000));
        throw new ApiError("Request throttled locally", 429, {
          code: "local_rate_limited",
          message: "You are sending requests too quickly. Please wait a moment.",
          retry_after_seconds: retryAfterSeconds,
        } as FastApiDetail);
      }
      localThrottleState.set(key, now);
      break;
    }
    const headers = new Headers(init.headers);
    const token = await Promise.resolve(getAccessToken?.());
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { ...init, headers });
  }

  async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await request(path, init);

    // Read the body ONCE as text. `res.json()` followed by `res.text()` on the
    // same Response is a runtime error (the stream can only be consumed once),
    // which is how callers used to get "Could not …" toasts on successful
    // 204 DELETEs — `res.json()` threw on an empty body and the fallback
    // message won.
    const bodyText = await res.text();
    const isEmpty = res.status === 204 || bodyText.length === 0;

    if (!res.ok) {
      let detail: FastApiDetail | undefined;
      if (!isEmpty) {
        try {
          const body: unknown = JSON.parse(bodyText);
          if (
            body &&
            typeof body === "object" &&
            "detail" in body &&
            body.detail !== undefined
          ) {
            detail = body.detail as FastApiDetail;
          } else {
            detail = bodyText;
          }
        } catch {
          detail = bodyText;
        }
      }
      throw new ApiError(`HTTP ${res.status}`, res.status, detail);
    }

    // Successful response with no body (typical of 204 No Content). The
    // generic caller has signalled they don't expect a value by using
    // `<void>` / `<undefined>`; anything else is on the caller.
    if (isEmpty) return undefined as T;

    return JSON.parse(bodyText) as T;
  }

  return { request, fetchJson };
}
