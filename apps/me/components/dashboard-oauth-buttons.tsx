"use client";

import { createLogger } from "@bearhacks/logger";
import { toast } from "sonner";
import { type DashboardOAuthProvider, useMeAuth } from "@/app/providers";
import { Button } from "@/components/ui/button";

const log = createLogger("me/dashboard-oauth-buttons");

const PROVIDERS: { id: DashboardOAuthProvider; label: string }[] = [
  { id: "google", label: "Continue with Google" },
  { id: "linkedin_oidc", label: "Continue with LinkedIn" },
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
    <div className={className ?? "flex flex-col items-center gap-3 sm:flex-row sm:justify-center"}>
      {PROVIDERS.map(({ id, label }) => (
        <Button
          key={id}
          variant="pill"
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
          className="w-full sm:w-auto"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
