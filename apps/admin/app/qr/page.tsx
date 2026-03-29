"use client";

import { ApiError } from "@bearhacks/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useSupabase } from "@/app/providers";
import { useApiClient } from "@/lib/use-api-client";
import { isStaffUser } from "@/lib/supabase-role";

type QrRow = {
  id?: string;
  claimed?: boolean;
  claimed_by?: string | null;
};

type GeneratedQr = {
  qr_id: string;
  url: string;
  printed: boolean;
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

type PrinterLogsResponse = {
  available: boolean;
  checked_at: string;
  endpoint?: string;
  line_count: number;
  lines: string[];
  error?: string;
};

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
  const [showPrinterLogs, setShowPrinterLogs] = useState(false);

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
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  const printerLogsQuery = useQuery({
    queryKey: ["admin-printer-logs"],
    queryFn: () => client!.fetchJson<PrinterLogsResponse>("/qr/printer/logs?limit=200"),
    enabled: Boolean(client && isStaff && showPrinterLogs),
    refetchInterval: showPrinterLogs ? 10000 : false,
    refetchIntervalInBackground: true,
  });

  const generateMutation = useMutation({
    mutationFn: async ({ count, print }: { count: number; print: boolean }) =>
      client!.fetchJson<GeneratedQr[]>("/qr/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, print }),
      }),
    onSuccess: (rows, variables) => {
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
      if (result.printed) {
        toast.success(`Reprinted ${qrId}`);
      } else {
        toast.warning(result.printer_error ?? "Reprint failed");
      }
    },
    onError: (error) => {
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
      if (error instanceof ApiError) {
        toast.error(error.status === 403 ? "Admin role required" : error.message);
      } else {
        toast.error("Failed to print QR codes");
      }
    },
  });

  return (
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
            <h2 className="text-base font-medium text-(--bearhacks-fg)">Printer server status</h2>
            {printerStatusQuery.isLoading ? (
              <p className="mt-2 text-sm text-(--bearhacks-muted)">Checking printer server…</p>
            ) : printerStatusQuery.isError ? (
              <p className="mt-2 text-sm text-red-700">
                {printerStatusQuery.error instanceof ApiError
                  ? printerStatusQuery.error.message
                  : "Failed to load printer status"}
              </p>
            ) : printerStatusQuery.data ? (
              <div className="mt-2 flex flex-col gap-1 text-sm">
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
                    - {printerStatusQuery.data.state}
                  </span>
                </p>
                {printerStatusQuery.data.error ? (
                  <p className="text-(--bearhacks-muted)">{printerStatusQuery.data.error}</p>
                ) : null}
                <p className="text-(--bearhacks-muted)">
                  Last checked: {new Date(printerStatusQuery.data.checked_at).toLocaleTimeString()}
                  {printerStatusQuery.data.endpoint ? ` (${printerStatusQuery.data.endpoint})` : ""}
                </p>
                {typeof printerStatusQuery.data.activity_age_seconds === "number" ? (
                  <p className="text-(--bearhacks-muted)">
                    Last activity: {printerStatusQuery.data.activity_age_seconds}s ago
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowPrinterLogs((prev) => !prev);
                    }}
                    className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium"
                  >
                    {showPrinterLogs ? "Hide printer logs" : "View printer logs"}
                  </button>
                  {showPrinterLogs && (
                    <button
                      type="button"
                      onClick={() => {
                        void printerLogsQuery.refetch();
                      }}
                      className="min-h-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) px-3 text-xs font-medium"
                    >
                      Refresh logs
                    </button>
                  )}
                </div>
                {showPrinterLogs && (
                  <div className="mt-2 rounded-(--bearhacks-radius-sm) border border-(--bearhacks-border) bg-black/90 p-2 text-xs text-white">
                    {printerLogsQuery.isLoading ? (
                      <p>Loading printer logs…</p>
                    ) : printerLogsQuery.isError ? (
                      <p>
                        {printerLogsQuery.error instanceof ApiError
                          ? printerLogsQuery.error.message
                          : "Failed to load printer logs"}
                      </p>
                    ) : printerLogsQuery.data ? (
                      <>
                        <p className="mb-2 text-white/80">
                          {printerLogsQuery.data.available ? "Live logs" : "Logs unavailable"} -{" "}
                          {new Date(printerLogsQuery.data.checked_at).toLocaleTimeString()}
                          {printerLogsQuery.data.endpoint ? ` (${printerLogsQuery.data.endpoint})` : ""}
                        </p>
                        {printerLogsQuery.data.error ? (
                          <p className="mb-2 text-red-300">{printerLogsQuery.data.error}</p>
                        ) : null}
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word">
                          {printerLogsQuery.data.lines.length > 0
                            ? printerLogsQuery.data.lines.join("\n")
                            : "No log lines returned."}
                        </pre>
                      </>
                    ) : null}
                  </div>
                )}
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
                  toast.error("Enter a positive count");
                  return;
                }
                const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                const mode = submitter?.dataset.mode === "generate" ? "generate" : "print";
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
                  printMutation.mutate({ qrIds: ids });
                  return;
                }
                const parsed = Number.parseInt(printCount, 10);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  toast.error("Provide QR IDs or a positive print count");
                  return;
                }
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
            <form
              className="mt-3 grid gap-3 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
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
                        Status
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Claimed by
                      </th>
                      <th scope="col" className="px-3 py-3 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {qrQuery.data.map((row) => {
                      const qrId = row.id ?? "unknown";
                      const claimed = Boolean(row.claimed);
                      return (
                        <tr key={qrId} className="border-b border-(--bearhacks-border) last:border-0">
                          <td className="px-3 py-3 font-mono text-xs text-(--bearhacks-muted)">{qrId}</td>
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
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => reprintMutation.mutate(qrId)}
                              disabled={reprintMutation.isPending}
                              className="min-h-(--bearhacks-touch-min) min-w-(--bearhacks-touch-min) cursor-pointer rounded-(--bearhacks-radius-sm) px-2 text-sm underline disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Reprint
                            </button>
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
  );
}