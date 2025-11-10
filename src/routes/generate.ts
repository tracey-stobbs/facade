import { FastifyInstance } from 'fastify';
import { loadConfig } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { jobManager } from '../jobs/jobManager.js';

const logger = createLogger();

interface GenerateBody {
  fileTypes?: string[];
  rows?: number;
  seed?: number;
  processingDate?: string;
  originatingAccount?: {
    sortCode?: string;
    accountNumber?: string;
    accountName?: string;
    accountType?: 'C' | 'S';
  };
}

interface NormalisedSuccess {
  fileTypes: string[];
  rows: number;
  seed?: number;
  processingDate?: string;
  originatingAccount: {
    sortCode: string;
    accountNumber: string;
    accountName?: string;
    accountType?: 'C' | 'S';
  };
}

type NormalisedResult = NormalisedSuccess | { error: string; rows?: number; syncRowLimit?: number };

function normalise(body: GenerateBody, syncRowLimit: number, defaults: { originatingAccount: { sortCode: string; accountNumber: string; accountName?: string; accountType?: 'C' | 'S'; } }): NormalisedResult {
  const fileTypes = Array.isArray(body.fileTypes) ? body.fileTypes : [];
  const rows = typeof body.rows === 'number' ? body.rows : 0;
  if (fileTypes.length === 0) {
    return { error: 'NO_FILE_TYPES' };
  }
  if (rows <= 0) {
    return { error: 'INVALID_ROWS' };
  }
  if (rows > syncRowLimit) {
    return { error: 'ROWS_EXCEED_SYNC_LIMIT', rows, syncRowLimit };
  }
  const accountDefaults = defaults.originatingAccount;
  const originatingAccount = {
    sortCode: body.originatingAccount?.sortCode || accountDefaults.sortCode,
    accountNumber: body.originatingAccount?.accountNumber || accountDefaults.accountNumber,
    accountName: body.originatingAccount?.accountName || accountDefaults.accountName,
    accountType: body.originatingAccount?.accountType || accountDefaults.accountType
  };
  return { fileTypes, rows, seed: body.seed, processingDate: body.processingDate, originatingAccount };
}

export async function registerGenerateRoute(app: FastifyInstance): Promise<void> {
  app.post('/generate', async (req, reply): Promise<void> => {
    const config = await loadConfig();
    const body = req.body as GenerateBody || {};
    const model = normalise(body, config.syncRowLimit, config.defaults);
    if ('error' in model) {
      if (model.error === 'ROWS_EXCEED_SYNC_LIMIT' && typeof model.rows === 'number') {
        // Async job path: enqueue and return 202 Accepted
        const job = jobManager.enqueue({ fileTypes: body.fileTypes || [], rows: model.rows });
        return reply.status(202).send({ jobId: job.id, state: job.state, progress: job.progress });
      }
      const status = 400;
      return reply.status(status).send({ code: model.error, detail: model });
    }
    // Stub generator call (will be HTTP in Milestone 2)
    const csvContent = `header1,header2\nvalue1,value2\n`; // deterministic stub
    const filename = `${model.fileTypes[0]}-${Date.now()}.csv`;
    logger.info({ event: 'generate.success', filename }, 'Generated stub file');
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(csvContent);
    return;
  });

  // Job status endpoint
  app.get('/jobs/:id', async (req, reply) => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) return reply.status(404).send({ error: 'JOB_NOT_FOUND' });
    return reply.send({ id: job.id, state: job.state, progress: job.progress, error: job.error, output: job.output ? { filename: job.output.filename } : undefined });
  });

  // Job output endpoint (CSV content if completed)
  app.get('/jobs/:id/output', async (req, reply) => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) return reply.status(404).send({ error: 'JOB_NOT_FOUND' });
    if (job.state !== 'completed' || !job.output) return reply.status(409).send({ error: 'JOB_NOT_COMPLETE', state: job.state });
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="${job.output.filename}"`);
    return reply.send(job.output.content);
  });

  // SSE events
  app.get('/jobs/:id/events', async (req, reply) => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) return reply.status(404).send('');
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const send = (j: typeof job) => {
      reply.raw.write(`event: progress\n`);
      reply.raw.write(`data: ${JSON.stringify({ id: j.id, state: j.state, progress: j.progress })}\n\n`);
      if (j.state === 'completed' || j.state === 'failed') {
        reply.raw.write(`event: end\n`);
        reply.raw.write(`data: ${JSON.stringify({ id: j.id, state: j.state })}\n\n`);
        reply.raw.end();
      }
    };
    // initial push
    send(job);
    const handler = (updated: unknown) => {
      const rec = updated as typeof job;
      if (rec.id === id) send(rec);
    };
    jobManager.on('job-progress', handler);
    jobManager.on('job-complete', handler);
    jobManager.on('job-failed', handler);
    // Fastify doesn't auto-clean listeners on stream close; add cleanup
    reply.raw.on('close', () => {
      jobManager.off('job-progress', handler);
      jobManager.off('job-complete', handler);
      jobManager.off('job-failed', handler);
    });
  });
}
