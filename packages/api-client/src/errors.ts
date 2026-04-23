/** FastAPI `HTTPException` / validation error `detail` shapes */
export type FastApiDetail =
  | string
  | { loc?: unknown[]; msg?: string; type?: string }[]
  | Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: FastApiDetail,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Extract a user-facing message from an arbitrary thrown value.
 *
 * FastAPI routes typically raise `HTTPException(detail=...)` where `detail` is
 * either a string or a `{code, message, ...}` object. {@link ApiError} preserves
 * the raw `detail` but sets `.message` to the generic `HTTP <status>`, so UIs
 * should not render `error.message` directly. Use this helper to surface the
 * real backend copy with a consistent fallback.
 */
export function describeApiError(error: unknown, fallback?: string): string {
  const fb = fallback ?? "Something went wrong.";
  if (error instanceof ApiError) {
    const d = error.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const message = (d as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    if (typeof d === "string" && d.trim()) return d;
    if (error.message && error.message.trim()) return error.message;
    return fb;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fb;
}

/**
 * Return the `detail.code` string from a FastAPI structured error, or null.
 *
 * Useful for branching on known error codes (e.g. `email_not_accepted`)
 * without re-implementing the type guard at every call site.
 */
export function getApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const d = error.detail;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const code = (d as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : null;
}
