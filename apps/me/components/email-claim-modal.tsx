"use client";

import { type SyntheticEvent, useEffect, useState } from "react";

type Step = "email" | "otp";

type EmailClaimModalProps = {
  open: boolean;
  oauthEmailHint?: string | null;
  /** Direct claim when JWT email matches; otherwise expect ``otp_required`` and move to OTP step. */
  submitEmail: (email: string) => Promise<"verified" | "otp_required">;
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string) => Promise<void>;
  onVerified: () => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function EmailClaimModal({
  open,
  oauthEmailHint,
  submitEmail,
  requestOtp,
  verifyOtp,
  onVerified,
  onSignOut,
}: EmailClaimModalProps) {
  const [step, setStep] = useState<Step>("email");
  const [emailValue, setEmailValue] = useState("");
  const [otpValue, setOtpValue] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep("email");
    setEmailValue("");
    setOtpValue("");
    setPendingEmail("");
    setError(null);
    setResendCooldownSeconds(0);
  }, [open]);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldownSeconds]);

  if (!open) return null;

  async function handleEmailSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = emailValue.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter the email you used on your acceptance form.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const outcome = await submitEmail(trimmed);
      if (outcome === "verified") {
        await onVerified();
        return;
      }
      await requestOtp(trimmed);
      setPendingEmail(trimmed);
      setStep("otp");
      setOtpValue("");
      setResendCooldownSeconds(45);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = otpValue.trim();
    if (!code) {
      setError("Enter the code from your email.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(pendingEmail, code);
      await onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendOtp() {
    if (!pendingEmail) return;
    if (resendCooldownSeconds > 0) return;
    setError(null);
    setBusy(true);
    try {
      await requestOtp(pendingEmail);
      setResendCooldownSeconds(45);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code.");
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
        {step === "email" ? (
          <>
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
            <form onSubmit={(e) => void handleEmailSubmit(e)} className="mt-4 flex flex-col gap-3">
              <label className="block text-sm font-medium text-(--bearhacks-fg)">
                Email from your acceptance form
                <input
                  type="email"
                  name="claim-email"
                  autoComplete="email"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
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
                  {busy ? "Working…" : "Continue"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 id="email-claim-title" className="text-lg font-semibold text-(--bearhacks-fg)">
              Enter verification code
            </h2>
            <p className="mt-2 text-sm text-(--bearhacks-muted)">
              If this email is on the accepted list, we sent a {6}-digit code to{" "}
              <span className="font-mono text-(--bearhacks-fg)">{pendingEmail}</span>. Enter it below to verify that you
              own this acceptance email.
            </p>
            <p className="mt-1 text-xs text-(--bearhacks-muted)">
              If you do not receive a code, confirm this is the exact email from your acceptance form and check spam.
            </p>
            <form onSubmit={(e) => void handleOtpSubmit(e)} className="mt-4 flex flex-col gap-3">
              <label className="block text-sm font-medium text-(--bearhacks-fg)">
                Verification code
                <input
                  type="text"
                  name="claim-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpValue}
                  onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  disabled={busy}
                  className="mt-1 w-full rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) bg-(--bearhacks-bg) px-3 py-2 text-sm font-mono text-(--bearhacks-fg) placeholder:text-(--bearhacks-muted) disabled:opacity-60"
                  placeholder="123456"
                />
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setStep("email");
                    setOtpValue("");
                    setError(null);
                  }}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-4 text-sm font-medium text-(--bearhacks-fg) disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy || resendCooldownSeconds > 0}
                  onClick={() => void handleResendOtp()}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-4 text-sm font-medium text-(--bearhacks-fg) disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resendCooldownSeconds > 0 ? `Resend in ${resendCooldownSeconds}s` : "Resend code"}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Verifying…" : "Verify"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
