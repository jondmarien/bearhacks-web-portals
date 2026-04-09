"use client";

import { type SyntheticEvent, useState } from "react";

type EmailClaimModalProps = {
  open: boolean;
  oauthEmailHint?: string | null;
  onSubmit: (email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function EmailClaimModal({ open, oauthEmailHint, onSubmit, onSignOut }: EmailClaimModalProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter the email you used on your acceptance form.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(trimmed);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-claim-title"
    >
      <div className="w-full max-w-md rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-6 shadow-lg">
        <h2 id="email-claim-title" className="text-lg font-semibold text-(--bearhacks-fg)">
          Confirm your acceptance email
        </h2>
        <p className="mt-2 text-sm text-(--bearhacks-muted)">
          Your sign-in provider may use a different email than the one on your BearHacks acceptance form. Enter the
          <strong className="font-medium text-(--bearhacks-fg)"> exact email </strong>
          you used when you were accepted so we can match your account.
        </p>
        {oauthEmailHint ? (
          <p className="mt-2 text-xs text-(--bearhacks-muted)">
            Account email on file: <span className="font-mono text-(--bearhacks-fg)">{oauthEmailHint}</span>
          </p>
        ) : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 flex flex-col gap-3">
          <label className="block text-sm font-medium text-(--bearhacks-fg)">
            Email from your acceptance form
            <input
              type="email"
              name="claim-email"
              autoComplete="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={busy}
              className="mt-1 w-full rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) bg-(--bearhacks-bg) px-3 py-2 text-sm text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted) disabled:opacity-60"
              placeholder="you@school.edu"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSignOut()}
              className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-4 text-sm font-medium text-(--bearhacks-fg) disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign out
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
