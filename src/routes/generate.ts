import { FastifyInstance } from 'fastify';
import { loadConfig } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { jobManager, JobRecord } from '../jobs/jobManager.js';
import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

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
  sun?: {
    sunNumber?: string;
    sunName?: string;
    sortCode?: string;
    accountNumber?: string;
    accountName?: string;
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
  // Request schema for validation
  const generateSchema = {
    body: {
      type: 'object',
      properties: {
        fileTypes: { type: 'array', items: { type: 'string' } },
        rows: { type: 'integer' },
        seed: { type: 'integer' },
        processingDate: { type: 'string' },
        originatingAccount: { type: 'object' },
        sun: { type: 'object' }
      },
      required: ['fileTypes', 'rows']
    },
    response: {
      200: { type: 'string' },
      202: { type: 'object', properties: { jobId: { type: 'string' }, state: { type: 'string' }, progress: { type: 'number' } }, required: ['jobId','state','progress'] },
      400: { type: 'object', properties: { code: { type: 'string' }, detail: { type: 'object' } }, required: ['code'] }
    }
  } as const;

  app.post('/generate', { schema: generateSchema }, async (req, reply): Promise<void> => {
    const config = await loadConfig();
    const body = req.body as GenerateBody || {};
    const model = normalise(body, config.syncRowLimit, config.defaults);
    if ('error' in model) {
      if (model.error === 'ROWS_EXCEED_SYNC_LIMIT' && typeof model.rows === 'number') {
        // Async job path: enqueue and return 202 Accepted
        const job = jobManager.enqueue({ fileTypes: body.fileTypes || [], rows: model.rows, seed: body.seed, sun: body.sun });
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

  // Manual job creation (explicit async even below sync limit)
  interface ManualJobBody extends Partial<GenerateBody> { fail?: boolean }
  app.post('/jobs', async (req, reply): Promise<void> => {
    const body = (req.body || {}) as ManualJobBody;
    const fileTypes = Array.isArray(body.fileTypes) && body.fileTypes.length ? body.fileTypes : ['Unknown'];
    const rows = typeof body.rows === 'number' && body.rows > 0 ? body.rows : 1;
    const job = jobManager.enqueue({ fileTypes, rows, seed: body.seed, fail: !!body.fail, sun: (body as any).sun });
    reply.status(202).send({ jobId: job.id, state: job.state, progress: job.progress });
  });

  // List jobs (debug/admin)
  app.get('/jobs', async (_req, reply): Promise<void> => {
    const jobs = jobManager.list().map(j => ({ id: j.id, state: j.state, progress: j.progress, links: { status: `/jobs/${j.id}/status` } }));
    reply.send({ jobs });
  });

  // Job status endpoint (alias legacy path for compatibility)
  app.get('/jobs/:id/status', async (req, reply): Promise<void> => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) { reply.status(404).send({ error: 'JOB_NOT_FOUND' }); return; }
    const base = { id: job.id, state: job.state, progress: job.progress, error: job.error, output: job.output ? { filenames: job.output.filenames } : undefined, createdAt: job.createdAt, finishedAt: job.finishedAt };
    if (job.state === 'completed') {
      (base as any).links = { summary: `/jobs/${job.id}/summary` };
    }
    reply.send(base);
  });
  app.get('/jobs/:id', async (req, reply): Promise<void> => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) { reply.status(404).send({ error: 'JOB_NOT_FOUND' }); return; }
    reply.send({ id: job.id, state: job.state, progress: job.progress, error: job.error, output: job.output ? { filenames: job.output.filenames } : undefined, createdAt: job.createdAt, finishedAt: job.finishedAt });
  });

  // Job download endpoint (zip containing outputs + metadata)
  app.get('/jobs/:id/download', async (req, reply): Promise<void> => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) { reply.status(404).send({ error: 'JOB_NOT_FOUND' }); return; }
    if (job.state !== 'completed' || !job.output) { reply.status(409).send({ error: 'JOB_NOT_COMPLETE', state: job.state }); return; }
    try {
  // Zip path is immutable for a completed job; use const for clarity.
  const zipPath = job.output.zipPath;
      let zipStat = await fs.stat(zipPath).catch(() => null);
      if (!zipStat) {
        // Attempt to (re)create zip on demand from output folder
        try {
          const folder = path.dirname(zipPath);
          const zip = new AdmZip();
          // add each file referenced in job.output.filenames
          for (const f of job.output.filenames) {
            const p = path.join(folder, f);
            const buf = await fs.readFile(p).catch(() => null);
            if (buf) zip.addFile(f, buf);
          }
          // include metadata if present
          if (job.output.metadataPath) {
            const metaBuf = await fs.readFile(job.output.metadataPath).catch(() => null);
            if (metaBuf) zip.addFile('metadata.json', metaBuf);
          }
          zip.writeZip(zipPath);
          zipStat = await fs.stat(zipPath).catch(() => null);
        } catch (err) {
          reply.status(500).send({ error: 'ZIP_CREATE_FAILED', message: (err as Error).message });
          return;
        }
      }
      const stream = await fs.readFile(zipPath);
      reply.header('Content-Type', 'application/zip');
      const baseName = job.output.filenames[0]?.replace(/\.csv$/, '') || job.id;
      reply.header('Content-Disposition', `attachment; filename="${baseName}.zip"`);
      reply.send(stream);
    } catch (err) {
      reply.status(500).send({ error: 'JOB_DOWNLOAD_ERROR', message: (err as Error).message });
    }
  });

  // Job summary endpoint
  app.get('/jobs/:id/summary', async (req, reply): Promise<void> => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) { reply.status(404).send({ error: 'JOB_NOT_FOUND' }); return; }
    if (job.state !== 'completed' || !job.output) { reply.status(409).send({ error: 'JOB_NOT_COMPLETE', state: job.state }); return; }
    const folder = path.join((await loadConfig()).outputRoot, id);
    const artifacts = job.output.filenames.map((name) => ({ name, path: path.join(folder, name), downloadUrl: `/jobs/${id}/download?file=${encodeURIComponent(name)}` }));
    reply.send({ id: job.id, state: job.state, progress: job.progress, artifacts, downloadUrl: `/jobs/${id}/download`, fileLocation: folder, metadata: job.output ? JSON.parse(await fs.readFile(job.output.metadataPath, 'utf8')) : undefined });
  });

  // Admin: resume persisted pending jobs
  app.post('/admin/resume-jobs', async (_req, reply): Promise<void> => {
    // Simple resume: re-run schedule() to pick up persisted pending jobs (jobManager.init already loads persisted)
    // For testability, call jobManager.init if needed; otherwise trigger schedule and return count
    // Note: in this non-blocking small tool we assume jobStore has the persisted entries
    try {
      // Trigger scheduling by re-reading store (jobManager handles persistence)
      // jobManager.init is safe to call again in non-test environments
      await jobManager.init();
      reply.send({ resumed: jobManager.list().filter(j => j.state === 'pending').length });
    } catch (err) {
      reply.status(500).send({ error: 'RESUME_FAILED', message: (err as Error).message });
    }
  });

  // Cancel job
  app.delete('/jobs/:id', async (req, reply): Promise<void> => {
    const id = (req.params as Record<string,string>).id;
    const ok = await jobManager.cancel(id);
    if (!ok) { reply.status(404).send({ error: 'JOB_NOT_FOUND' }); return; }
    reply.send({ id, cancelled: true });
  });

  // SSE events
  app.get('/jobs/:id/events', async (req, reply): Promise<void> => {
    const id = (req.params as Record<string,string>).id;
    const job = jobManager.get(id);
    if (!job) { reply.status(404).send(''); return; }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const send = (j: typeof job): void => {
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
    const handler = (updated: JobRecord): void => {
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
