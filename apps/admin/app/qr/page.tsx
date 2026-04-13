"use client";

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import {
  createStructuredLogger,
  readStructuredLogs,
  type StructuredLogEntry,
} from "@/lib/structured-logging";
import { useApiClient } from "@/lib/use-api-client";
import { isStaffUser } from "@/lib/supabase-role";

type QrRow = {
  id?: string;
  claimed?: boolean;
  claimed_by?: string | null;
  generated_by?: string | null;
  [key: string]: unknown;
};

type GeneratedQr = {
  qr_id: string;
  url: string;
  printed: boolean;
  generated_by?: string | null;
  printer_error?: string;
  printer_skipped?: boolean;
};

type PrinterStatusResponse = {
  online: boolean;
  state:
    | "online"
    | "offline"
    | "down"
    | "printing"
    | "idle"
    | "error"
    | "stale"
    | "stuck"
    | string;
  checked_at: string;
  activity_at?: string;
  activity_age_seconds?: number;
  error?: string;
  endpoint?: string;
};

const log = createStructuredLogger("admin/qr-dashboard");

export default function AdminQrPage() {
  const supabase = useSupabase();
  const client = useApiClient();
  const [user, setUser] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "claimed" | "unclaimed">("all");
  const [claimedBySearch, setClaimedBySearch] = useState("");
  const [generateCount, setGenerateCount] = useState("5");
  const [printCount, setPrintCount] = useState("5");
  const [printIdsInput, setPrintIdsInput] = useState("");
  const [generated, setGenerated] = useState<GeneratedQr[]>([]);
  const [generateMode, setGenerateMode] = useState<"print" | "generate">("print");
  const [selectedQr, setSelectedQr] = useState<QrRow | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [structuredLogs, setStructuredLogs] = useState<StructuredLogEntry[]>([]);
  const [customClientId, setCustomClientId] = useState("");
  const [customClientSecret, setCustomClientSecret] = useState("");
  const [statusOverride, setStatusOverride] = useState<PrinterStatusResponse | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const isStaff = isStaffUser(user);
  const actor = user?.id ?? "anonymous";

  const listPath = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (claimedBySearch.trim()) params.set("claimed_by", claimedBySearch.trim());
    return `/admin/qr/search${params.size ? `?${params.toString()}` : ""}`;
  }, [statusFilter, claimedBySearch]);

  const qrQuery = useQuery({
    queryKey: ["admin-qr-search", statusFilter, claimedBySearch],
    queryFn: () => client!.fetchJson<QrRow[]>(listPath),
    enabled: Boolean(client && isStaff),
  });

  const printerStatusQuery = useQuery({
    queryKey: ["admin-printer-status"],
    queryFn: async () => {
      const checkedAt = new Date().toISOString();
      try {
        return await client!.fetchJson<PrinterStatusResponse>("/qr/printer/status");
      } catch (error) {
        log("warn", {
          event: "admin_printer_status",
          actor,
          resourceId: "/qr/printer/status",
          result: "error",
          checkedAt,
          error,
        });
        if (error instanceof ApiError) {
          return {
            online: false,
            state: "down",
            checked_at: checkedAt,
            error:
              error.status === 404
                ? "Printer status endpoint is unavailable (HTTP 404)"
                : `Printer status check failed (HTTP ${error.status})`,
          };
        }
        return {
          online: false,
          state: "down",
          checked_at: checkedAt,
          error: "Printer status check failed",
        };
      }
    },
    enabled: Boolean(client && isStaff),
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.hidden) return 60000;
      if (query.state.error) return 30000;
      const state = (query.state.data as PrinterStatusResponse | undefined)?.state;
      if (state === "printing") return 10000;
      return 20000;
    },
    refetchIntervalInBackground: false,
  });

  const retryPrinterMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("API client unavailable");
      }
      const id = customClientId.trim();
      const secret = customClientSecret.trim();
      if ((id && !secret) || (!id && secret)) {
        throw new Error("Provide both custom client ID and secret");
      }
      const headers: Record<string, string> = {};
      if (id && secret) {
        headers["x-cf-access-client-id"] = id;
        headers["x-cf-access-client-secret"] = secret;
      }
      return client.fetchJson<PrinterStatusResponse>("/qr/printer/status?force_refresh=true", {
        headers,
      });
    },
    onSuccess: (data) => {
      setStatusOverride(data);
      log("info", {
        event: "admin_printer_status_retry",
        actor,
        resourceId: "/qr/printer/status",
        result: "success",
        usedCustomAuth: Boolean(customClientId.trim() && customClientSecret.trim()),
        online: data.online,
        state: data.state,
      });
      toast.success("Retried printer connection check.");
    },
    onError: (error) => {
      log("error", {
        event: "admin_printer_status_retry",
        actor,
        resourceId: "/qr/printer/status",
        result: "error",
        usedCustomAuth: Boolean(customClientId.trim() && customClientSecret.trim()),
        error,
      });
      toast.error(error instanceof Error ? error.message : "Retry failed");
    },
  });

  const printerStatus = statusOverride ?? printerStatusQuery.data;

  useEffect(() => {
    if (!isLogsOpen) return;
    setStructuredLogs(readStructuredLogs(500));
  }, [isLogsOpen]);

  const backfillGeneratedByMutation = useMutation({
    mutationFn: () =>
      client!.fetchJson<{ updated_count: number; generated_by: string }>(
        "/qr/generated-by/backfill",
        { method: "POST" },
      ),
    onSuccess: (result) => {
      log("info", {
        event: "admin_generated_by_backfill",
        actor,
        resourceId: "/qr/generated-by/backfill",
        result: "success",
        updatedCount: result.updated_count,
      });
      toast.success(`Backfilled ${result.updated_count} rows as ${result.generated_by}`);
      void qrQuery.refetch();
    },
    onError: (error) => {
      log("error", {
        event: "admin_generated_by_backfill",
        actor,
        resourceId: "/qr/generated-by/backfill",
        result: "error",
        error,
      });
      toast.error(error instanceof ApiError ? error.message : "Failed to backfill generated by");
    },
  });

  const generateMutation = useMutation({
    mutationFn: async ({ count, print }: { count: number; print: boolean }) =>
      client!.fetchJson<GeneratedQr[]>("/qr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, print }),
      }),
    onSuccess: (rows, variables) => {
      log("info", {
        event: "admin_qr_generate",
        actor,
        resourceId: "/qr/generate",
        result: "success",
        count: rows.length,
        print: variables.print,
        failedCount: rows.filter((row) => !row.printed && !row.printer_skipped).length,
      });
      setGenerated(rows);
      void qrQuery.refetch();
      if (!variables.print) {
        toast.success(`Generated ${rows.length} QR codes without printing.`);
        return;
      }
      const failed = rows.filter((row) => !row.printed && !row.printer_skipped).length;
      if (failed > 0) {
        toast.warning(`Generated ${rows.length} QRs. ${failed} failed to print.`);
      } else {
        toast.success(`Generated and printed ${rows.length} QR codes.`);
      }
    },
    onError: (error) => {
      log("error", {
        event: "admin_qr_generate",
        actor,
        resourceId: "/qr/generate",
        result: "error",
        error,
      });
      if (error instanceof ApiError) {
        toast.error(error.status === 403 ? "Admin role required" : error.message);
      } else {
        toast.error("Failed to generate QR batch");
      }
    },
  });

  const reprintMutation = useMutation({
    mutationFn: async (qrId: string) =>
      client!.fetchJson<{ printed: boolean; printer_error?: string }>(`/qr/reprint/${qrId}`, {
        method: "POST",
      }),
    onSuccess: (result, qrId) => {
      log("info", {
        event: "admin_qr_reprint",
        actor,
        resourceId: qrId,
        result: result.printed ? "success" : "failed",
        printed: result.printed,
      });
      if (result.printed) {
        toast.success(`Reprinted ${qrId}`);
      } else {
        toast.warning(result.printer_error ?? "Reprint failed");
      }
    },
    onError: (error) => {
      log("error", {
        event: "admin_qr_reprint",
        actor,
        resourceId: "qr_unknown",
        result: "error",
        error,
      });
      if (error instanceof ApiError) {
        toast.error(error.status === 403 ? "Admin role required" : error.message);
      } else {
        toast.error("Failed to reprint QR");
      }
    },
  });

  const printMutation = useMutation({
    mutationFn: async ({ count, qrIds }: { count?: number; qrIds?: string[] }) =>
      client!.fetchJson<GeneratedQr[]>("/qr/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, qr_ids: qrIds }),
      }),
    onSuccess: (rows) => {
      log("info", {
        event: "admin_qr_print_existing",
        actor,
        resourceId: "/qr/print",
        result: "success",
        count: rows.length,
        failedCount: rows.filter((row) => !row.printed).length,
      });
      if (rows.length === 0) {
        toast.info("No QR codes matched to print.");
        return;
      }
      const failed = rows.filter((row) => !row.printed).length;
      if (failed > 0) {
        toast.warning(`Printed ${rows.length - failed}/${rows.length}. ${failed} failed.`);
      } else {
        toast.success(`Printed ${rows.length} QR code(s).`);
      }
      setGenerated(rows);
    },
    onError: (error) => {
      log("error", {
        event: "admin_qr_print_existing",
        actor,
        resourceId: "/qr/print",
        result: "error",
        error,
      });
      if (error instanceof ApiError) {
        toast.error(error.status === 403 ? "Admin role required" : error.message);
      } else {
        toast.error("Failed to print QR codes");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (qrId: string) =>
      client!.fetchJson<{ deleted: boolean; qr_id: string }>(`/qr/${qrId}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, qrId) => {
      log("info", {
        event: "admin_qr_delete",
        actor,
        resourceId: qrId,
        result: "success",
      });
      toast.success(`Deleted ${qrId}`);
      void qrQuery.refetch();
    },
    onError: (error) => {
      log("error", {
        event: "admin_qr_delete",
        actor,
        resourceId: "qr_unknown",
        result: "error",
        error,
      });
      if (error instanceof ApiError) {
        toast.error(error.status === 403 ? "Admin role required" : error.message);
      } else {
        toast.error("Failed to delete QR");
      }
    },
  });

  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-(--bearhacks-fg)">QR Management</h1>
          <p className="text-sm text-(--bearhacks-muted)">
            Generate unclaimed QR batches, search claim status, and reprint labels for jam recovery.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex min-h-(--bearhacks-touch-min) items-center justify-center rounded-(--bearhacks-radius-sm) px-3 text-sm underline"
        >
          Admin home
        </Link>
      </header>

      {!isStaff && (
        <section className="rounded-(--bearhacks-radius-md) border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Sign in with an admin account. The API enforces <code className="rounded bg-white/60 px-1">require_admin</code>{" "}
          on all QR actions.
        </section>
      )}

      {isStaff && (
        <>
          <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium text-(--bearhacks-fg)">Printer server status</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStatusOverride(null);
                    void printerStatusQuery.refetch();
                    log("info", {
                      event: "admin_printer_status_refresh",
                      actor,
                      resourceId: "/qr/printer/status",
                      result: "submitted",
                    });
                  }}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void retryPrinterMutation.mutateAsync();
                  }}
                  disabled={retryPrinterMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {retryPrinterMutation.isPending ? "Retrying..." : "Retry"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    log("info", {
                      event: "admin_logs_modal",
                      actor,
                      resourceId: "admin_logs",
                      result: "opened",
                    });
                    setStructuredLogs(readStructuredLogs(500));
                    setIsLogsOpen(true);
                  }}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium"
                >
                  Logs
                </button>
              </div>
            </div>
            {printerStatusQuery.isLoading ? (
              <p className="mt-2 text-sm text-(--bearhacks-muted)">Checking printer server…</p>
            ) : printerStatusQuery.isError ? (
              <p className="mt-2 text-sm text-red-700">
                {printerStatusQuery.error instanceof ApiError
                  ? printerStatusQuery.error.message
                  : "Failed to load printer status"}
              </p>
            ) : printerStatus ? (
              <div className="mt-2 flex flex-col gap-1 text-sm">
                <p className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      !printerStatus.online || printerStatus.state === "down"
                        ? "bg-red-500"
                        : printerStatus.state === "printing"
                          ? "bg-amber-500"
                          : printerStatus.state === "stale"
                            ? "bg-orange-500"
                            : printerStatus.state === "stuck"
                              ? "bg-rose-500"
                          : printerStatus.state === "idle"
                            ? "bg-emerald-500"
                            : "bg-sky-500"
                    }`}
                  />
                  <span className="font-medium">
                    {printerStatus.online && printerStatus.state !== "down"
                      ? "Online"
                      : "DOWN"}{" "}
                    - {printerStatus.state}
                  </span>
                </p>
                {!printerStatus.online || printerStatus.state === "down" ? (
                  <p className="text-(--bearhacks-muted)">
                    {printerStatus.error ?? "Printer is unreachable right now."}
                  </p>
                ) : null}
                <p className="text-(--bearhacks-muted)">
                  Last checked: {new Date(printerStatus.checked_at).toLocaleTimeString()}
                </p>
                {typeof printerStatus.activity_age_seconds === "number" ? (
                  <p className="text-(--bearhacks-muted)">
                    Last activity: {printerStatus.activity_age_seconds}s ago
                  </p>
                ) : null}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="custom-client-id" className="text-xs font-medium text-(--bearhacks-fg)">
                      Custom client ID (optional)
                    </label>
                    <input
                      id="custom-client-id"
                      value={customClientId}
                      onChange={(event) => setCustomClientId(event.target.value)}
                      className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs"
                      placeholder="CF Access client id"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="custom-client-secret" className="text-xs font-medium text-(--bearhacks-fg)">
                      Custom client secret (optional)
                    </label>
                    <input
                      id="custom-client-secret"
                      type="password"
                      value={customClientSecret}
                      onChange={(event) => setCustomClientSecret(event.target.value)}
                      className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs"
                      placeholder="CF Access client secret"
                    />
                  </div>
                </div>
                <p className="text-xs text-(--bearhacks-muted)">
                  If provided, both custom values are used only for the retry check.
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
            <h2 className="text-base font-medium text-(--bearhacks-fg)">Generate batch</h2>
            <form
              className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = Number.parseInt(generateCount, 10);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  log("warn", {
                    event: "admin_qr_generate_submit",
                    actor,
                    resourceId: "/qr/generate",
                    result: "invalid_count",
                    input: generateCount,
                  });
                  toast.error("Enter a positive count");
                  return;
                }
                const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                const mode = submitter?.dataset.mode === "generate" ? "generate" : "print";
                log("info", {
                  event: "admin_qr_generate_submit",
                  actor,
                  resourceId: "/qr/generate",
                  result: "submitted",
                  mode,
                  count: parsed,
                });
                setGenerateMode(mode);
                generateMutation.mutate({ count: parsed, print: mode === "print" });
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="generate-count" className="text-sm font-medium text-(--bearhacks-fg)">
                  QR count
                </label>
                <input
                  id="generate-count"
                  name="count"
                  type="number"
                  min={1}
                  max={200}
                  value={generateCount}
                  onChange={(event) => setGenerateCount(event.target.value)}
                  className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                />
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="submit"
                  data-mode="generate"
                  disabled={generateMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) min-w-32 cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generateMutation.isPending && generateMode === "generate" ? "Generating…" : "Generate"}
                </button>
                <button
                  type="submit"
                  data-mode="print"
                  disabled={generateMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) min-w-40 cursor-pointer rounded-(--bearhacks-radius-sm) bg-(--bearhacks-fg) px-4 text-sm font-medium text-(--bearhacks-bg) disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {generateMutation.isPending && generateMode === "print" ? "Generating…" : "Generate + print"}
                </button>
              </div>
            </form>
            {generated.length > 0 && (
              <p className="mt-3 text-sm text-(--bearhacks-muted)">
                Latest batch: {generated.length} created, {generated.filter((row) => row.printed).length} printed.
              </p>
            )}
          </section>

          <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
            <h2 className="text-base font-medium text-(--bearhacks-fg)">Print existing QR codes</h2>
            <p className="mt-1 text-sm text-(--bearhacks-muted)">
              Print one QR id, a comma-separated batch, or the first N unclaimed codes.
            </p>
            <form
              className="mt-3 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const ids = printIdsInput
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean);
                if (ids.length > 0) {
                  log("info", {
                    event: "admin_qr_print_submit",
                    actor,
                    resourceId: "/qr/print",
                    result: "submitted_by_ids",
                    idCount: ids.length,
                  });
                  printMutation.mutate({ qrIds: ids });
                  return;
                }
                const parsed = Number.parseInt(printCount, 10);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  log("warn", {
                    event: "admin_qr_print_submit",
                    actor,
                    resourceId: "/qr/print",
                    result: "invalid_input",
                    input: printCount,
                  });
                  toast.error("Provide QR IDs or a positive print count");
                  return;
                }
                log("info", {
                  event: "admin_qr_print_submit",
                  actor,
                  resourceId: "/qr/print",
                  result: "submitted_by_count",
                  count: parsed,
                });
                printMutation.mutate({ count: parsed });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="print-ids" className="text-sm font-medium text-(--bearhacks-fg)">
                    QR ids (comma separated)
                  </label>
                  <input
                    id="print-ids"
                    value={printIdsInput}
                    onChange={(event) => setPrintIdsInput(event.target.value)}
                    className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                    placeholder="uuid-1, uuid-2"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="print-count" className="text-sm font-medium text-(--bearhacks-fg)">
                    Or print first N unclaimed
                  </label>
                  <input
                    id="print-count"
                    type="number"
                    min={1}
                    max={200}
                    value={printCount}
                    onChange={(event) => setPrintCount(event.target.value)}
                    className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                  />
                </div>
              </div>
              <div>
                <button
                  type="submit"
                  disabled={printMutation.isPending}
                  className="min-h-(--bearhacks-touch-min) min-w-40 cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {printMutation.isPending ? "Printing…" : "Print"}
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) p-4">
            <h2 className="text-base font-medium text-(--bearhacks-fg)">Search by claim status</h2>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  log("info", {
                    event: "admin_generated_by_backfill",
                    actor,
                    resourceId: "/qr/generated-by/backfill",
                    result: "submitted",
                  });
                  backfillGeneratedByMutation.mutate();
                }}
                disabled={backfillGeneratedByMutation.isPending}
                className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
              >
                {backfillGeneratedByMutation.isPending ? "Backfilling…" : "Backfill legacy generated_by"}
              </button>
            </div>
            <form
              className="mt-3 grid gap-3 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                  log("info", {
                    event: "admin_qr_search",
                    actor,
                    resourceId: listPath,
                    result: "submitted",
                    statusFilter,
                    claimedByProvided: Boolean(claimedBySearch.trim()),
                  });
                void qrQuery.refetch();
              }}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="status-filter" className="text-sm font-medium text-(--bearhacks-fg)">
                  Status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as "all" | "claimed" | "unclaimed")
                  }
                  className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                >
                  <option value="all">All</option>
                  <option value="claimed">Claimed</option>
                  <option value="unclaimed">Unclaimed</option>
                </select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="claimed-by" className="text-sm font-medium text-(--bearhacks-fg)">
                  Claimed by (profile id, optional)
                </label>
                <input
                  id="claimed-by"
                  value={claimedBySearch}
                  onChange={(event) => setClaimedBySearch(event.target.value)}
                  className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-base"
                  placeholder="Filter specific claimer id"
                />
              </div>
            </form>

            {qrQuery.isLoading && <p className="mt-3 text-sm text-(--bearhacks-muted)">Loading QR list…</p>}
            {qrQuery.isError && (
              <p className="mt-3 text-sm text-red-700">
                {qrQuery.error instanceof ApiError ? qrQuery.error.message : "Failed to load QR list"}
              </p>
            )}
            {qrQuery.data && (
              <div className="mt-3 overflow-x-auto rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border)">
                <table className="w-full min-w-xl border-collapse text-left text-sm">
                  <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-border)/20">
                    <tr>
                      <th scope="col" className="px-3 py-3 font-medium">
                        QR id
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Generated by
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Claimed by
                      </th>
                      <th scope="col" className="px-3 py-3 text-center font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {qrQuery.data.map((row) => {
                      const qrId = row.id ?? "unknown";
                      const canMutate = Boolean(row.id);
                      const claimed = Boolean(row.claimed);
                      const generatedBy = row.generated_by?.trim()
                        ? row.generated_by
                        : "legacy/unknown";
                      const deletingThisRow =
                        deleteMutation.isPending && deleteMutation.variables === qrId;
                      return (
                        <tr key={qrId} className="border-b border-(--bearhacks-border) last:border-0">
                          <td className="px-3 py-3 font-mono text-xs text-(--bearhacks-muted)">{qrId}</td>
                          <td className="px-3 py-3 font-mono text-xs text-(--bearhacks-muted)">{generatedBy}</td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs ${
                                claimed
                                  ? "bg-(--bearhacks-fg) text-(--bearhacks-bg)"
                                  : "bg-(--bearhacks-border)/40 text-(--bearhacks-muted)"
                              }`}
                            >
                              {claimed ? "Claimed" : "Unclaimed"}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-(--bearhacks-muted)">{row.claimed_by ?? "—"}</td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  log("info", {
                                    event: "admin_qr_view",
                                    actor,
                                    resourceId: qrId,
                                    result: "opened",
                                  });
                                  setSelectedQr(row);
                                }}
                                disabled={!canMutate}
                                className="min-h-(--bearhacks-touch-min) min-w-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) px-2 text-sm underline disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  log("info", {
                                    event: "admin_qr_reprint",
                                    actor,
                                    resourceId: qrId,
                                    result: "submitted",
                                  });
                                  reprintMutation.mutate(qrId);
                                }}
                                disabled={!canMutate || reprintMutation.isPending || deleteMutation.isPending}
                                className="min-h-(--bearhacks-touch-min) min-w-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) px-2 text-sm underline disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Reprint
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!canMutate) return;
                                  const confirmed = window.confirm(
                                    `Delete QR ${qrId}? This permanently removes it from the database.`,
                                  );
                                  if (!confirmed) {
                                    log("info", {
                                      event: "admin_qr_delete",
                                      actor,
                                      resourceId: qrId,
                                      result: "cancelled",
                                    });
                                    return;
                                  }
                                  log("info", {
                                    event: "admin_qr_delete",
                                    actor,
                                    resourceId: qrId,
                                    result: "submitted",
                                  });
                                  deleteMutation.mutate(qrId);
                                }}
                                disabled={!canMutate || reprintMutation.isPending || deleteMutation.isPending}
                                className="min-h-(--bearhacks-touch-min) min-w-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) px-2 text-sm text-red-700 underline disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {deletingThisRow ? "Deleting…" : "Delete"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      </main>

      {selectedQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) shadow-xl">
            <div className="flex items-center justify-between border-b border-(--bearhacks-border) px-4 py-3">
              <h2 className="text-base font-semibold text-(--bearhacks-fg)">QR details</h2>
              <button
                type="button"
                onClick={() => {
                  log("info", {
                    event: "admin_qr_view",
                    actor,
                    resourceId: String(selectedQr.id ?? "unknown"),
                    result: "closed",
                  });
                  setSelectedQr(null);
                }}
                className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) px-2 text-sm underline"
              >
                Close
              </button>
            </div>
            <div className="max-h-[calc(80vh-60px)] overflow-auto p-4">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-border)/20">
                  <tr>
                    <th scope="col" className="w-1/3 px-3 py-2 font-medium">
                      Field
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(selectedQr).map(([key, value]) => (
                    <tr key={key} className="border-b border-(--bearhacks-border) last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-(--bearhacks-muted)">{key}</td>
                      <td className="px-3 py-2 font-mono text-xs text-(--bearhacks-fg)">
                        {value === null || value === undefined
                          ? "—"
                          : typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-6xl overflow-hidden rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-bg) shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-(--bearhacks-border) px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-(--bearhacks-fg)">Admin logs</h2>
                <p className="text-xs text-(--bearhacks-muted)">
                  Structured view of in-app admin dashboard events
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    log("debug", {
                      event: "admin_logs_modal",
                      actor,
                      resourceId: "admin_logs",
                      result: "refreshed",
                    });
                    setStructuredLogs(readStructuredLogs(500));
                  }}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => {
                    log("info", {
                      event: "admin_logs_modal",
                      actor,
                      resourceId: "admin_logs",
                      result: "closed",
                    });
                    setIsLogsOpen(false);
                  }}
                  className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) px-2 text-sm underline"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[calc(85vh-64px)] overflow-auto p-4">
              {structuredLogs.length === 0 ? (
                <p className="text-sm text-(--bearhacks-muted)">No logs returned.</p>
              ) : (
                <div className="overflow-x-auto rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border)">
                  <table className="w-full min-w-[980px] border-collapse text-left text-xs">
                    <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-border)/20">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Scope
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Event
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Actor
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Resource
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Result
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Level
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Timestamp
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Metadata
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {structuredLogs.map((entry, index) => (
                        <tr key={`${entry.event}-${index}`} className="border-b border-(--bearhacks-border) last:border-0">
                          <td className="px-3 py-2 font-mono">{entry.scope}</td>
                          <td className="px-3 py-2 font-mono">{entry.event}</td>
                          <td className="px-3 py-2 font-mono">{entry.actor}</td>
                          <td className="px-3 py-2 font-mono">{entry.resourceId}</td>
                          <td className="px-3 py-2 font-mono">{entry.result}</td>
                          <td className="px-3 py-2 font-mono">{entry.level}</td>
                          <td className="px-3 py-2 font-mono">{entry.timestamp}</td>
                          <td className="max-w-[480px] px-3 py-2 font-mono text-[11px] text-(--bearhacks-muted)">
                            <span className="line-clamp-2 break-all">
                              {JSON.stringify(entry.metadata)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}