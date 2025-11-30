import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logger.js';
import { registerGenerateRoute } from './routes/generate.js';
import { registerCompositeJobRoute } from './routes/compositeJob.js';
import { jobManager } from './jobs/jobManager.js';

const logger = createLogger();
// Provide custom logger to Fastify using loggerInstance (v5 change)
const app = Fastify({ loggerInstance: logger });

// Permissive JSON parser: try strict JSON, then attempt a tolerant transform
app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
  const raw = body as string;
  try {
    const parsed = JSON.parse(raw);
    done(null, parsed);
    return;
  } catch (err) {
    // Attempt tolerant fixes for common mistakes: unquoted keys or single-quoted strings
    try {
      let t = raw;
      // Quote unquoted keys: { key: -> { "key":
      t = t.replace(/([,{\s])([A-Za-z0-9_\-]+)\s*:/g, '$1"$2":');
      // Convert single-quoted string values to double quotes
      t = t.replace(/'([^']*)'/g, '"$1"');
      const parsed2 = JSON.parse(t);
      // Log a gentle warning for diagnostics
      app.log && app.log.warn({ raw, transformed: t }, 'Permissive JSON parse used');
      done(null, parsed2);
      return;
    } catch (err2) {
      done(err2 as Error);
      return;
    }
  }
});

app.register(formBody);

app.get('/health', { schema: { response: { 200: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] } } } }, async (): Promise<{ status: string }> => ({ status: 'ok' }));
Promise.all([
  registerGenerateRoute(app as any),
  registerCompositeJobRoute(app as any),
]).catch(err => {
  logger.error({ err }, 'Failed to register routes');
  process.exit(1);
});

export async function start(): Promise<void> {
  const config = await loadConfig();
  const port = Number(process.env.PORT || 3001);
  app.log.info({ event: 'startup', port, config }, 'Facade starting');
  try {
    await jobManager.init();
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info({ event: 'listening', port }, 'Facade listening');
  } catch (err) {
    app.log.error({ err }, 'Startup failure');
    // Avoid hard exit during tests to prevent false positives
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) process.exit(1);
  }
}
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.VITEST;
if (!isTestEnv) {
  // Auto-start only outside test runs
  void start();
}
export { app }; // export for test injection
