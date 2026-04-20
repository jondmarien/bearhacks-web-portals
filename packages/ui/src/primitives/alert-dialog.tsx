"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";

export type AlertTone = "default" | "danger" | "warning";

export type AlertOptions = {
  title: string;
  description?: ReactNode;
  /** Defaults to "Got it". */
  actionLabel?: string;
  tone?: AlertTone;
};

type Resolver = () => void;

type AlertState = AlertOptions & { resolver: Resolver };

const AlertContext = createContext<((opts: AlertOptions) => Promise<void>) | null>(
  null,
);

const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export function useAlert(): (opts: AlertOptions) => Promise<void> {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    throw new Error("useAlert must be used inside <AlertDialogProvider>");
  }
  return ctx;
}

export function AlertDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<AlertState | null>(null);
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);

  const alert = useCallback(
    (opts: AlertOptions) =>
      new Promise<void>((resolve) => {
        setDialog({ ...opts, resolver: resolve });
      }),
    [],
  );

  const close = useCallback(() => {
    setDialog((current) => {
      current?.resolver();
      return null;
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    actionButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  const contextValue = useMemo(() => alert, [alert]);

  return (
    <AlertContext.Provider value={contextValue}>
      {children}
      {mounted && dialog
        ? createPortal(
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="alert-dialog-title"
              aria-describedby={
                dialog.description ? "alert-dialog-description" : undefined
              }
              className="fixed inset-0 z-100 flex items-center justify-center bg-(--bearhacks-overlay) p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div className="w-full max-w-md rounded-(--bearhacks-radius-lg) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface-raised) p-5 shadow-xl">
                <h2
                  id="alert-dialog-title"
                  className={`text-lg font-semibold ${
                    dialog.tone === "danger"
                      ? "text-(--bearhacks-danger)"
                      : dialog.tone === "warning"
                        ? "text-(--bearhacks-warning-fg)"
                        : "text-(--bearhacks-title)"
                  }`}
                >
                  {dialog.title}
                </h2>
                {dialog.description ? (
                  <div
                    id="alert-dialog-description"
                    className="mt-2 text-sm text-(--bearhacks-fg)"
                  >
                    {dialog.description}
                  </div>
                ) : null}
                <div className="mt-5 flex justify-end">
                  <Button
                    ref={actionButtonRef}
                    variant="primary"
                    onClick={() => close()}
                  >
                    {dialog.actionLabel ?? "Got it"}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </AlertContext.Provider>
  );
}
