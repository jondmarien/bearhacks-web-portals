import { createLogger, type LogLevel } from "@bearhacks/logger";

type StructuredLogRecord = {
  event: string;
  result: string;
  actor?: string;
  resourceId?: string;
  [key: string]: unknown;
};

export function createStructuredLogger(scope: string) {
  const logger = createLogger(scope);

  return (level: LogLevel, record: StructuredLogRecord) => {
    const {
      event,
      result,
      actor = "unknown",
      resourceId = "dashboard",
      ...metadata
    } = record;
    const message = `event=${event} actor=${actor} resource_id=${resourceId} result=${result}`;
    logger[level](message, metadata);
  };
}
