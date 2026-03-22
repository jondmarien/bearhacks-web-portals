export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envMinLevel(): LogLevel | "silent" {
  const raw = process.env.NEXT_PUBLIC_LOG_LEVEL?.toLowerCase().trim();
  if (raw === "silent" || raw === "none" || raw === "off") return "silent";
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function minRank(): number {
  const m = envMinLevel();
  if (m === "silent") return 999;
  return LEVEL_RANK[m];
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= minRank();
}

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

/** Browser-safe scoped logger. Threshold: `NEXT_PUBLIC_LOG_LEVEL` or dev=debug / prod=info. */
export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    debug: (...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(prefix, ...args);
    },
    info: (...args: unknown[]) => {
      if (shouldLog("info")) console.info(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(prefix, ...args);
    },
    error: (...args: unknown[]) => {
      if (shouldLog("error")) console.error(prefix, ...args);
    },
  };
}
