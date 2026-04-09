"use client";

import { createLogger } from "@bearhacks/logger";
import { toast } from "sonner";
import { type DashboardOAuthProvider, useMeAuth } from "@/app/providers";

const log = createLogger("me/dashboard-oauth-buttons");

const PROVIDERS: { id: DashboardOAuthProvider; label: string }[] = [
  { id: "google", label: "Continue with Google" },
  { id: "apple", label: "Continue with Apple" },
  { id: "linkedin_oidc", label: "Continue with LinkedIn" },
  { id: "facebook", label: "Continue with Meta" },
];

function providerDisabledMessage(provider: DashboardOAuthProvider): string {
  const name = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  return `${name} is not enabled for this project in Supabase Auth yet.`;
}

type DashboardOAuthButtonsProps = {
  /** Extra class on the wrapper */
  className?: string;
};

export function DashboardOAuthButtons({ className }: DashboardOAuthButtonsProps) {
  const auth = useMeAuth();

  if (!auth) return null;

  return (
    <div className={className ?? "flex flex-col gap-2"}>
      {PROVIDERS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            void auth
              .signInWithDashboardProvider(id)
              .catch((error: unknown) => {
                log.error("Dashboard OAuth failed to start", { provider: id, error });
                if (error instanceof Error && error.message.toLowerCase().includes("provider is not enabled")) {
                  toast.error(providerDisabledMessage(id));
                } else {
                  toast.error("Unable to start sign-in");
                }
              });
          }}
          className="min-h-(--bearhacks-touch-min) w-full cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) bg-(--bearhacks-bg) px-4 text-sm font-medium text-(--bearhacks-fg) sm:w-auto"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
