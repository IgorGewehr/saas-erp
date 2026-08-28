export type StructuredLogLevel = 'info' | 'warn' | 'error';

export interface StructuredOperationLog {
  event: string;
  businessId: string;
  correlationId: string;
  idempotencyKey?: string;
  operationId?: string;
  status?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export function writeStructuredOperationLog(
  level: StructuredLogLevel,
  entry: StructuredOperationLog,
): void {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    ...entry,
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.info(payload);
}
