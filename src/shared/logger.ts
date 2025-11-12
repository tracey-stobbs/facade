import pino from 'pino';

// Structured JSON logger with explicit timestamp field 'ts' (epoch ms).
export function createLogger(): pino.Logger {
  const level = process.env.DEBUG ? 'debug' : 'info';
  return pino({ level, base: { pid: undefined }, timestamp: () => `"ts":${Date.now()}` });
}

// Domain helper to standardise job logging shape
export function logJob(logger: pino.Logger, jobId: string, msg: string, details?: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info'): void {
  const payload = { jobId, ...details };
  logger[level](payload, msg);
}
