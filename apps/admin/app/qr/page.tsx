"use client";

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InputField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import {
  createStructuredLogger,
  readStructuredLogs,
  type StructuredLogEntry,
} from "@/lib/structured-logging";
import { useApiClient } from "@/lib/use-api-client";
import { useDocumentTitle } from "@/lib/use-document-title";
import { resolveMeBaseUrl } from "@/lib/me-base-url";
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
  const confirm = useConfirm();
  useDocumentTitle("QR fulfillment");
  const [user, setUser] = useState<User | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "claimed" | "unclaimed">("all");
  const [claimedBySearch, setClaimedBySearch] = useState("");
  const [generateCount, setGenerateCount] = useState("5");
  const [printCount, setPrintCount] = useState("5");
  const [printIdsInput, setPrintIdsInput] = useState("");
  const [generated, setGenerated] = useState<GeneratedQr[]>([]);
  const [generateMode, setGenerateMode] = useState<"print" | "generate">("print");
  const [selectedQr, setSelectedQr] = useState<QrRow | null>(null);
  const [selectedQrImage, setSelectedQrImage] = useState<string | null>(null);
  const [showQrPreview, setShowQrPreview] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set());
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [structuredLogs, setStructuredLogs] = useState<StructuredLogEntry[]>([]);

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

  const [prevFilters, setPrevFilters] = useState({ statusFilter, claimedBySearch });
  if (
    prevFilters.statusFilter !== statusFilter ||
    prevFilters.claimedBySearch !== claimedBySearch
  ) {
    setPrevFilters({ statusFilter, claimedBySearch });
    setSelectedRowIds(new Set());
    setIsBulkMode(false);
  }

  const selectedClaimUrl = useMemo(() => {
    if (!selectedQr?.id) return null;
    return `${resolveMeBaseUrl()}/claim/${selectedQr.id}`;
  }, [selectedQr]);

  const [prevClaimUrl, setPrevClaimUrl] = useState<string | null>(selectedClaimUrl);
  if (prevClaimUrl !== selectedClaimUrl) {
    setPrevClaimUrl(selectedClaimUrl);
    setSelectedQrImage(null);
    setShowQrPreview(false);
  }

  useEffect(() => {
    if (!selectedClaimUrl) return;
    let active = true;
    QRCode.toDataURL(selectedClaimUrl, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((dataUrl: string) => {
        if (active) setSelectedQrImage(dataUrl);
      })
      .catch((error: unknown) => {
        log("warn", {
          event: "admin_qr_render",
          actor,
          resourceId: String(selectedQr?.id ?? "unknown"),
          result: "error",
          error,
        });
        if (active) setSelectedQrImage(null);
      });
    return () => {
      active = false;
    };
  }, [selectedClaimUrl, actor, selectedQr]);

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
      const state = (query.state.data as PrinterStatusResponse | undefined)?.state;
      if (query.state.error || state === "down" || state === "error" || state === "stale" || state === "stuck") {
        return 30000;
      }
      if (state === "printing") return 10000;
      return 20000;
    },
    refetchIntervalInBackground: false,
  });

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
        toast.error(error.status === 403 ? "Admin access required." : error.message);
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
        toast.error(error.status === 403 ? "Admin access required." : error.message);
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
        toast.error(error.status === 403 ? "Admin access required." : error.message);
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
        toast.error(error.status === 403 ? "Admin access required." : error.message);
      } else {
        toast.error("Failed to delete QR");
      }
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (qrIds: string[]) => {
      const results = await Promise.allSettled(
        qrIds.map((qrId) =>
          client!
            .fetchJson<{ deleted: boolean; qr_id: string }>(`/qr/${qrId}`, {
              method: "DELETE",
            })
            .then(() => qrId),
        ),
      );
      const succeeded: string[] = [];
      const failed: { qrId: string; error: unknown }[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          succeeded.push(qrIds[index]);
        } else {
          failed.push({ qrId: qrIds[index], error: result.reason });
        }
      });
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      log("info", {
        event: "admin_qr_bulk_delete",
        actor,
        resourceId: "/qr/bulk",
        result: failed.length === 0 ? "success" : "partial",
        succeededCount: succeeded.length,
        failedCount: failed.length,
      });
      if (succeeded.length > 0) {
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          succeeded.forEach((id) => next.delete(id));
          return next;
        });
      }
      if (failed.length === 0) {
        toast.success(`Deleted ${succeeded.length} QR code(s).`);
        setIsBulkMode(false);
      } else if (succeeded.length === 0) {
        toast.error(`Failed to delete ${failed.length} QR code(s).`);
      } else {
        toast.warning(
          `Deleted ${succeeded.length}/${succeeded.length + failed.length}. ${failed.length} failed.`,
        );
      }
      void qrQuery.refetch();
    },
    onError: (error) => {
      log("error", {
        event: "admin_qr_bulk_delete",
        actor,
        resourceId: "/qr/bulk",
        result: "error",
        error,
      });
      toast.error(error instanceof ApiError ? error.message : "Bulk delete failed");
    },
  });

  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <PageHeader
          title="QR fulfillment"
          tone="marketing"
          subtitle="Generate batches, search by claim status, reprint labels, and inspect details."
          backHref="/"
          showBack
        />

        {!isStaff && (
          <Card className="border-amber-200 bg-amber-50 text-amber-950">
            <CardTitle className="text-amber-900">Staff access required</CardTitle>
            <CardDescription className="mt-1 text-amber-900">
              Sign in with a staff account to use the QR tools. The API enforces
              admin checks on every action regardless of UI state.
            </CardDescription>
          </Card>
        )}

        {isStaff && (
          <>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Printer server status</CardTitle>
                  <CardDescription className="mt-1">
                    Live status of the on-site label printer.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void printerStatusQuery.refetch();
                      log("info", {
                        event: "admin_printer_status_refresh",
                        actor,
                        resourceId: "/qr/printer/status",
                        result: "submitted",
                      });
                    }}
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
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
                  >
                    Logs
                  </Button>
                </div>
              </div>
              {printerStatusQuery.isLoading ? (
                <p className="mt-3 text-sm text-(--bearhacks-muted)">Checking printer server…</p>
              ) : printerStatusQuery.isError ? (
                <p className="mt-3 text-sm text-red-700">
                  {printerStatusQuery.error instanceof ApiError
                    ? printerStatusQuery.error.message
                    : "Failed to load printer status"}
                </p>
              ) : printerStatusQuery.data ? (
                <div className="mt-3 flex flex-col gap-1 text-sm">
                  <p className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        !printerStatusQuery.data.online || printerStatusQuery.data.state === "down"
                          ? "bg-red-500"
                          : printerStatusQuery.data.state === "printing"
                            ? "bg-amber-500"
                            : printerStatusQuery.data.state === "stale"
                              ? "bg-orange-500"
                              : printerStatusQuery.data.state === "stuck"
                                ? "bg-rose-500"
                                : printerStatusQuery.data.state === "idle"
                                  ? "bg-emerald-500"
                                  : "bg-sky-500"
                      }`}
                    />
                    <span className="font-medium">
                      {printerStatusQuery.data.online && printerStatusQuery.data.state !== "down"
                        ? "Online"
                        : "DOWN"}{" "}
                      — {printerStatusQuery.data.state}
                    </span>
                  </p>
                  {!printerStatusQuery.data.online || printerStatusQuery.data.state === "down" ? (
                    <p className="text-(--bearhacks-muted)">
                      {printerStatusQuery.data.error ?? "Printer is unreachable right now."}
                    </p>
                  ) : null}
                  <p className="text-(--bearhacks-muted)">
                    Last checked: {new Date(printerStatusQuery.data.checked_at).toLocaleTimeString()}
                  </p>
                  {typeof printerStatusQuery.data.activity_age_seconds === "number" ? (
                    <p className="text-(--bearhacks-muted)">
                      Last activity: {printerStatusQuery.data.activity_age_seconds}s ago
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>

            <Card>
              <CardTitle>Generate batch</CardTitle>
              <CardDescription className="mt-1">
                Create a new run of unclaimed QR codes; optionally print them in the
                same step.
              </CardDescription>
              <form
                className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
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
                <div className="min-w-0 flex-1">
                  <InputField
                    label="QR count"
                    id="generate-count"
                    name="count"
                    type="number"
                    min={1}
                    max={200}
                    value={generateCount}
                    onChange={(event) => setGenerateCount(event.target.value)}
                  />
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button
                    type="submit"
                    variant="ghost"
                    data-mode="generate"
                    disabled={generateMutation.isPending}
                  >
                    {generateMutation.isPending && generateMode === "generate" ? "Generating…" : "Generate"}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    data-mode="print"
                    disabled={generateMutation.isPending}
                  >
                    {generateMutation.isPending && generateMode === "print" ? "Generating…" : "Generate + print"}
                  </Button>
                </div>
              </form>
              {generated.length > 0 && (
                <p className="mt-3 text-sm text-(--bearhacks-muted)">
                  Latest batch: {generated.length} created, {generated.filter((row) => row.printed).length} printed.
                </p>
              )}
            </Card>

            <Card>
              <CardTitle>Print existing QR codes</CardTitle>
              <CardDescription className="mt-1">
                Print one QR id, a comma-separated batch, or the first N unclaimed
                codes.
              </CardDescription>
              <form
                className="mt-4 flex flex-col gap-3"
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
                  <InputField
                    label="QR ids (comma separated)"
                    id="print-ids"
                    value={printIdsInput}
                    onChange={(event) => setPrintIdsInput(event.target.value)}
                    placeholder="uuid-1, uuid-2"
                  />
                  <InputField
                    label="Or print first N unclaimed"
                    id="print-count"
                    type="number"
                    min={1}
                    max={200}
                    value={printCount}
                    onChange={(event) => setPrintCount(event.target.value)}
                  />
                </div>
                <div>
                  <Button type="submit" variant="primary" disabled={printMutation.isPending}>
                    {printMutation.isPending ? "Printing…" : "Print"}
                  </Button>
                </div>
              </form>
            </Card>

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Search by claim status</CardTitle>
                  <CardDescription className="mt-1">
                    Filter the QR pool by claim state and inspect or reprint individual codes.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isBulkMode ? (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const ids = Array.from(selectedRowIds);
                          if (ids.length === 0) return;
                          void (async () => {
                            const confirmed = await confirm({
                              title: `Delete ${ids.length} QR code(s)?`,
                              description:
                                "This permanently removes the selected codes from the database.",
                              confirmLabel: `Delete ${ids.length}`,
                              cancelLabel: "Cancel",
                              tone: "danger",
                            });
                            if (!confirmed) {
                              log("info", {
                                event: "admin_qr_bulk_delete",
                                actor,
                                resourceId: "/qr/bulk",
                                result: "cancelled",
                                count: ids.length,
                              });
                              return;
                            }
                            log("info", {
                              event: "admin_qr_bulk_delete",
                              actor,
                              resourceId: "/qr/bulk",
                              result: "submitted",
                              count: ids.length,
                            });
                            bulkDeleteMutation.mutate(ids);
                          })();
                        }}
                        disabled={selectedRowIds.size === 0 || bulkDeleteMutation.isPending}
                        className="text-red-700"
                      >
                        {bulkDeleteMutation.isPending
                          ? `Deleting ${selectedRowIds.size}…`
                          : `Delete (${selectedRowIds.size})`}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setIsBulkMode(false);
                          setSelectedRowIds(new Set());
                        }}
                        disabled={bulkDeleteMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setIsBulkMode(true)}
                      className="text-red-700"
                    >
                      Bulk delete
                    </Button>
                  )}
                  <Button
                    variant="ghost"
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
                  >
                    {backfillGeneratedByMutation.isPending ? "Backfilling…" : "Backfill legacy generated_by"}
                  </Button>
                </div>
              </div>
              <form
                className="mt-4 grid gap-3 sm:grid-cols-3"
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
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="status-filter"
                    className="text-sm font-medium text-(--bearhacks-primary)"
                  >
                    Status
                  </label>
                  <select
                    id="status-filter"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as "all" | "claimed" | "unclaimed")
                    }
                    className="min-h-(--bearhacks-touch-min) rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) px-3 text-base text-(--bearhacks-fg) focus:border-(--bearhacks-primary) focus:outline-none"
                  >
                    <option value="all">All</option>
                    <option value="claimed">Claimed</option>
                    <option value="unclaimed">Unclaimed</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <InputField
                    label="Claimed by (profile id, optional)"
                    id="claimed-by"
                    value={claimedBySearch}
                    onChange={(event) => setClaimedBySearch(event.target.value)}
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
                <div className="mt-4 hidden overflow-x-auto rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) sm:block">
                  <table className="w-full min-w-xl border-collapse text-left text-sm">
                    <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
                      <tr>
                        {isBulkMode ? (
                          <th scope="col" className="w-10 px-3 py-3">
                            {(() => {
                            const selectableIds = (qrQuery.data ?? [])
                              .map((row) => row.id)
                              .filter((id): id is string => Boolean(id));
                            const allSelected =
                              selectableIds.length > 0 &&
                              selectableIds.every((id) => selectedRowIds.has(id));
                            const someSelected =
                              !allSelected && selectableIds.some((id) => selectedRowIds.has(id));
                            return (
                              <input
                                type="checkbox"
                                aria-label="Select all rows"
                                className="h-4 w-4 cursor-pointer accent-(--bearhacks-primary)"
                                checked={allSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = someSelected;
                                }}
                                onChange={(event) => {
                                  if (event.target.checked) {
                                    setSelectedRowIds(new Set(selectableIds));
                                  } else {
                                    setSelectedRowIds(new Set());
                                  }
                                }}
                                disabled={selectableIds.length === 0 || bulkDeleteMutation.isPending}
                              />
                            );
                          })()}
                          </th>
                        ) : null}
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
                        const isSelected = canMutate && selectedRowIds.has(qrId);
                        return (
                          <tr key={qrId} className="border-b border-(--bearhacks-border) last:border-0">
                            {isBulkMode ? (
                              <td className="px-3 py-3">
                                <input
                                  type="checkbox"
                                  aria-label={`Select QR ${qrId}`}
                                  className="h-4 w-4 cursor-pointer accent-(--bearhacks-primary)"
                                  checked={isSelected}
                                  onChange={(event) => {
                                    if (!canMutate) return;
                                    setSelectedRowIds((prev) => {
                                      const next = new Set(prev);
                                      if (event.target.checked) {
                                        next.add(qrId);
                                      } else {
                                        next.delete(qrId);
                                      }
                                      return next;
                                    });
                                  }}
                                  disabled={!canMutate || bulkDeleteMutation.isPending}
                                />
                              </td>
                            ) : null}
                            <td className="px-3 py-3 font-mono text-xs text-(--bearhacks-muted)">{qrId}</td>
                            <td className="px-3 py-3 font-mono text-xs text-(--bearhacks-muted)">{generatedBy}</td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-flex w-24 justify-center rounded-full px-2 py-1 text-xs font-medium ${
                                  claimed
                                    ? "bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
                                    : "bg-(--bearhacks-border)/40 text-(--bearhacks-muted)"
                                }`}
                              >
                                {claimed ? "Claimed" : "Unclaimed"}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-(--bearhacks-muted)">{row.claimed_by ?? "—"}</td>
                            <td className="px-3 py-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <Button
                                  variant="ghost"
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
                                >
                                  View
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    log("info", {
                                      event: "admin_qr_reprint",
                                      actor,
                                      resourceId: qrId,
                                      result: "submitted",
                                    });
                                    reprintMutation.mutate(qrId);
                                  }}
                                  disabled={
                                    !canMutate ||
                                    reprintMutation.isPending ||
                                    deleteMutation.isPending ||
                                    bulkDeleteMutation.isPending
                                  }
                                >
                                  Reprint
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    if (!canMutate) return;
                                    void (async () => {
                                      const confirmed = await confirm({
                                        title: "Delete QR code?",
                                        description: `QR ${qrId} will be permanently removed from the database.`,
                                        confirmLabel: "Delete",
                                        cancelLabel: "Cancel",
                                        tone: "danger",
                                      });
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
                                    })();
                                  }}
                                  disabled={
                                    !canMutate ||
                                    reprintMutation.isPending ||
                                    deleteMutation.isPending ||
                                    bulkDeleteMutation.isPending
                                  }
                                  className="text-red-700"
                                >
                                  {deletingThisRow ? "Deleting…" : "Delete"}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {qrQuery.data && qrQuery.data.length > 0 && (
                <ul className="mt-4 flex flex-col gap-3 sm:hidden">
                  {(() => {
                    const selectableIds = qrQuery.data
                      .map((row) => row.id)
                      .filter((id): id is string => Boolean(id));
                    const allSelected =
                      selectableIds.length > 0 &&
                      selectableIds.every((id) => selectedRowIds.has(id));
                    const someSelected =
                      !allSelected && selectableIds.some((id) => selectedRowIds.has(id));
                    return isBulkMode ? (
                      <li className="flex items-center gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Select all rows"
                          className="h-4 w-4 cursor-pointer accent-(--bearhacks-primary)"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedRowIds(new Set(selectableIds));
                            } else {
                              setSelectedRowIds(new Set());
                            }
                          }}
                          disabled={selectableIds.length === 0 || bulkDeleteMutation.isPending}
                        />
                        <span className="text-xs font-medium text-(--bearhacks-fg)">
                          Select all ({selectedRowIds.size}/{selectableIds.length})
                        </span>
                      </li>
                    ) : null;
                  })()}
                  {qrQuery.data.map((row) => {
                    const qrId = row.id ?? "unknown";
                    const canMutate = Boolean(row.id);
                    const claimed = Boolean(row.claimed);
                    const generatedBy = row.generated_by?.trim()
                      ? row.generated_by
                      : "legacy/unknown";
                    const deletingThisRow =
                      deleteMutation.isPending && deleteMutation.variables === qrId;
                    const isSelected = canMutate && selectedRowIds.has(qrId);
                    return (
                      <li
                        key={`mobile-${qrId}`}
                        className="flex flex-col gap-2 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface) p-3"
                      >
                        <div className="flex items-start gap-2">
                          {isBulkMode ? (
                            <input
                              type="checkbox"
                              aria-label={`Select QR ${qrId}`}
                              className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-(--bearhacks-primary)"
                              checked={isSelected}
                              onChange={(event) => {
                                if (!canMutate) return;
                                setSelectedRowIds((prev) => {
                                  const next = new Set(prev);
                                  if (event.target.checked) {
                                    next.add(qrId);
                                  } else {
                                    next.delete(qrId);
                                  }
                                  return next;
                                });
                              }}
                              disabled={!canMutate || bulkDeleteMutation.isPending}
                            />
                          ) : null}
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <p className="font-mono text-xs break-all text-(--bearhacks-fg)">
                              {qrId}
                            </p>
                            <span
                              className={`inline-flex w-24 justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                claimed
                                  ? "bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
                                  : "bg-(--bearhacks-border)/40 text-(--bearhacks-muted)"
                              }`}
                            >
                              {claimed ? "Claimed" : "Unclaimed"}
                            </span>
                          </div>
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                          <dt className="font-mono uppercase tracking-wide text-(--bearhacks-muted)">
                            Generated
                          </dt>
                          <dd className="font-mono break-all text-(--bearhacks-fg)">
                            {generatedBy}
                          </dd>
                          <dt className="font-mono uppercase tracking-wide text-(--bearhacks-muted)">
                            Claimed by
                          </dt>
                          <dd className="font-mono break-all text-(--bearhacks-fg)">
                            {row.claimed_by ?? "—"}
                          </dd>
                        </dl>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="ghost"
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
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              log("info", {
                                event: "admin_qr_reprint",
                                actor,
                                resourceId: qrId,
                                result: "submitted",
                              });
                              reprintMutation.mutate(qrId);
                            }}
                            disabled={
                              !canMutate ||
                              reprintMutation.isPending ||
                              deleteMutation.isPending ||
                              bulkDeleteMutation.isPending
                            }
                          >
                            Reprint
                          </Button>
                          <Button
                            variant="ghost"
                            className="text-red-700"
                            onClick={() => {
                              if (!canMutate) return;
                              void (async () => {
                                const confirmed = await confirm({
                                  title: "Delete QR code?",
                                  description: `QR ${qrId} will be permanently removed from the database.`,
                                  confirmLabel: "Delete",
                                  cancelLabel: "Cancel",
                                  tone: "danger",
                                });
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
                              })();
                            }}
                            disabled={
                              !canMutate ||
                              reprintMutation.isPending ||
                              deleteMutation.isPending ||
                              bulkDeleteMutation.isPending
                            }
                          >
                            {deletingThisRow ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </>
        )}
      </main>

      {selectedQr && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <Card
            as="div"
            className="max-h-[92vh] w-full max-w-2xl overflow-hidden p-0 sm:max-h-[85vh]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-(--bearhacks-border) px-3 py-3 sm:px-4">
              <CardTitle className="text-base">QR details</CardTitle>
              <Button
                variant="ghost"
                onClick={() => {
                  log("info", {
                    event: "admin_qr_view",
                    actor,
                    resourceId: String(selectedQr.id ?? "unknown"),
                    result: "closed",
                  });
                  setSelectedQr(null);
                }}
              >
                Close
              </Button>
            </div>
            <div className="max-h-[calc(92vh-56px)] overflow-auto p-3 sm:max-h-[calc(85vh-60px)] sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
                <span
                  className={`inline-flex w-24 justify-center rounded-full px-2 py-1 text-xs font-medium ${
                    selectedQr.claimed
                      ? "bg-(--bearhacks-primary) text-(--bearhacks-on-primary)"
                      : "bg-(--bearhacks-border)/40 text-(--bearhacks-muted)"
                  }`}
                >
                  {selectedQr.claimed ? "Claimed" : "Unclaimed"}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const next = !showQrPreview;
                    log("info", {
                      event: "admin_qr_view_preview_toggle",
                      actor,
                      resourceId: String(selectedQr.id ?? "unknown"),
                      result: next ? "shown" : "hidden",
                    });
                    setShowQrPreview(next);
                  }}
                >
                  {showQrPreview ? "Hide QR" : "Show QR"}
                </Button>
              </div>
              {showQrPreview ? (
                <div className="mb-3 flex flex-col items-center gap-3 rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) bg-(--bearhacks-surface-alt) p-3 sm:mb-4 sm:flex-row sm:items-start sm:p-4">
                  <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) bg-white p-2 sm:h-44 sm:w-44">
                    {selectedQrImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedQrImage}
                        alt={`QR code for ${selectedQr.id ?? "selected QR"}`}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-(--bearhacks-muted)">Rendering…</span>
                    )}
                  </div>
                  <div className="flex w-full min-w-0 flex-1 flex-col gap-2 text-sm sm:w-auto">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.1rem] text-(--bearhacks-text-marketing)/70">
                        Encoded URL
                      </p>
                      {selectedClaimUrl ? (
                        <a
                          href={selectedClaimUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block break-all font-mono text-[11px] text-(--bearhacks-primary) underline underline-offset-2 sm:text-xs"
                        >
                          {selectedClaimUrl}
                        </a>
                      ) : (
                        <span className="text-xs text-(--bearhacks-muted)">—</span>
                      )}
                    </div>
                    {selectedQrImage ? (
                      <a
                        href={selectedQrImage}
                        download={`bearhacks-qr-${selectedQr.id ?? "unknown"}.png`}
                        className="w-fit text-xs font-semibold text-(--bearhacks-primary) underline underline-offset-2"
                      >
                        Download PNG
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <dl className="flex flex-col divide-y divide-(--bearhacks-border) overflow-hidden rounded-(--bearhacks-radius-md) border border-(--bearhacks-border) sm:hidden">
                {Object.entries(selectedQr).map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-1 bg-(--bearhacks-surface) px-3 py-2">
                    <dt className="font-mono text-[11px] uppercase tracking-wide text-(--bearhacks-muted)">
                      {key}
                    </dt>
                    <dd className="font-mono text-[12px] break-all text-(--bearhacks-fg)">
                      {value === null || value === undefined ? (
                        "—"
                      ) : typeof value === "object" ? (
                        <pre className="whitespace-pre-wrap break-all rounded-(--bearhacks-radius-sm) bg-(--bearhacks-surface-alt) p-2 text-[11px]">
                          {JSON.stringify(value, null, 2)}
                        </pre>
                      ) : (
                        String(value)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="hidden sm:block">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
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
                        <td className="px-3 py-2 font-mono text-xs break-all text-(--bearhacks-fg)">
                          {value === null || value === undefined ? (
                            "—"
                          ) : typeof value === "object" ? (
                            <pre className="whitespace-pre-wrap break-all rounded-(--bearhacks-radius-sm) bg-(--bearhacks-surface-alt) p-2 font-mono text-[11px]">
                              {JSON.stringify(value, null, 2)}
                            </pre>
                          ) : (
                            String(value)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {isLogsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card as="div" className="max-h-[85vh] w-full max-w-6xl overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-(--bearhacks-border) px-4 py-3">
              <div>
                <CardTitle className="text-base text-(--bearhacks-text-marketing)">
                  Admin <span className="bg-(--bearhacks-cream) px-1 rounded-sm">logs</span>
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Structured view of in-app admin dashboard events.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    log("debug", {
                      event: "admin_logs_modal",
                      actor,
                      resourceId: "admin_logs",
                      result: "refreshed",
                    });
                    setStructuredLogs(readStructuredLogs(500));
                  }}
                >
                  Refresh
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    log("info", {
                      event: "admin_logs_modal",
                      actor,
                      resourceId: "admin_logs",
                      result: "closed",
                    });
                    setIsLogsOpen(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>

            <div className="max-h-[calc(85vh-72px)] overflow-auto p-4">
              {structuredLogs.length === 0 ? (
                <p className="text-sm text-(--bearhacks-muted)">No logs returned.</p>
              ) : (
                <div className="overflow-x-auto rounded-(--bearhacks-radius-md) border border-(--bearhacks-border)">
                  <table className="w-full min-w-[980px] border-collapse text-left text-xs">
                    <thead className="border-b border-(--bearhacks-border) bg-(--bearhacks-surface-alt)">
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
                        <tr
                          key={`${entry.event}-${index}`}
                          className="border-b border-(--bearhacks-border) last:border-0"
                        >
                          <td className="px-3 py-2 font-mono">{entry.scope}</td>
                          <td className="px-3 py-2 font-mono">{entry.event}</td>
                          <td className="px-3 py-2 font-mono">{entry.actor}</td>
                          <td className="px-3 py-2 font-mono">{entry.resourceId}</td>
                          <td className="px-3 py-2 font-mono">{entry.result}</td>
                          <td className="px-3 py-2 font-mono">{entry.level}</td>
                          <td className="px-3 py-2 font-mono">{entry.timestamp}</td>
                          <td className="max-w-[480px] px-3 py-2 align-top">
                            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-(--bearhacks-radius-sm) bg-(--bearhacks-surface-alt) p-2 font-mono text-[11px] text-(--bearhacks-muted)">
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
