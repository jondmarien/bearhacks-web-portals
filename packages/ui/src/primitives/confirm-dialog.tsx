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

export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type Resolver = (value: boolean) => void;

type DialogState = ConfirmOptions & { resolver: Resolver };

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(
  null,
);

const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmDialogProvider>");
  }
  return ctx;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedSnapshot,
    getMountedServerSnapshot,
  );
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setDialog({ ...opts, resolver: resolve });
      }),
    [],
  );

  const close = useCallback((value: boolean) => {
    setDialog((current) => {
      current?.resolver(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    if (dialog.tone === "danger") {
      cancelButtonRef.current?.focus();
    } else {
      confirmButtonRef.current?.focus();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  const contextValue = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      {mounted && dialog
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              className="fixed inset-0 z-100 flex items-center justify-center bg-(--bearhacks-overlay) p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close(false);
              }}
            >
              <div className="w-full max-w-md rounded-(--bearhacks-radius-lg) border border-(--bearhacks-border-strong) bg-(--bearhacks-surface-raised) p-5 shadow-xl">
                <h2
                  id="confirm-dialog-title"
                  className="text-lg font-semibold text-(--bearhacks-title)"
                >
                  {dialog.title}
                </h2>
                {dialog.description ? (
                  <p className="mt-2 text-sm text-(--bearhacks-fg)">{dialog.description}</p>
                ) : null}
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    ref={cancelButtonRef}
                    variant="ghost"
                    onClick={() => close(false)}
                  >
                    {dialog.cancelLabel ?? "Cancel"}
                  </Button>
                  <Button
                    ref={confirmButtonRef}
                    variant="primary"
                    onClick={() => close(true)}
                    className={
                      dialog.tone === "danger"
                        ? "bg-(--bearhacks-danger-fill) text-(--bearhacks-on-danger) hover:bg-(--bearhacks-danger-fill)/90 disabled:hover:bg-(--bearhacks-danger-fill)"
                        : ""
                    }
                  >
                    {dialog.confirmLabel ?? "Confirm"}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfirmContext.Provider>
  );
}
