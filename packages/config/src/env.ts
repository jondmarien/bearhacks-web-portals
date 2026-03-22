import { z, type ZodError } from "zod";

/**
 * Browser-safe public env (Next inlines `process.env.NEXT_PUBLIC_*` at build).
 * Never put service role or server-only secrets here.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const raw = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
};

/** Validates and returns public env; throws ZodError if missing/invalid. */
export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse(raw);
}

/** Safe parse for optional checks (e.g. build-time diagnostics). */
export function tryPublicEnv():
  | { ok: true; data: PublicEnv }
  | { ok: false; error: ZodError } {
  const result = publicEnvSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, error: result.error };
}
