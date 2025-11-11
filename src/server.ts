import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import { loadConfig } from './shared/config.js';
import { createLogger } from './shared/logger.js';
import { registerGenerateRoute } from './routes/generate.js';
import { jobManager } from './jobs/jobManager.js';

const logger = createLogger();
const app = Fastify({ logger: false });
app.register(formBody);

app.get('/health', async (): Promise<{ status: string }> => ({ status: 'ok' }));
registerGenerateRoute(app).catch(err => {
  logger.error({ err }, 'Failed to register routes');
  process.exit(1);
});

async function start(): Promise<void> {
  const config = await loadConfig();
  const port = Number(process.env.PORT || 3001);
  logger.info({ event: 'startup', port, config }, 'Facade starting');
  try {
    await jobManager.init();
    await app.listen({ port, host: '0.0.0.0' });
    logger.info({ event: 'listening', port }, 'Facade listening');
  } catch (err) {
    logger.error({ err }, 'Startup failure');
    process.exit(1);
  }
}

start();
