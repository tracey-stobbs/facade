import pino from 'pino';

export function createLogger(): pino.Logger {
  const level = process.env.DEBUG ? 'debug' : 'info';
  return pino({ level });
}
