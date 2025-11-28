import { FastifyInstance } from 'fastify';
import { jobManager } from '../jobs/jobManager.js';

interface CompositeBody {
  rows?: number;
  seed?: number;
  processingDate?: string;
  metadata?: any; // optional metadata bag (e.g. { Sun: { sunNumber,.. } })
}

function validate(body: CompositeBody): { ok: true; rows: number; seed?: number; processingDate?: string } | { ok: false; error: string } {
  const rowsRaw = body.rows;
  if (rowsRaw == null || typeof rowsRaw !== 'number' || rowsRaw <= 0) return { ok: false, error: 'INVALID_ROWS' };
  if (!Number.isInteger(rowsRaw)) return { ok: false, error: 'INVALID_ROWS' };
  const seed = body.seed != null && Number.isInteger(body.seed) ? body.seed : undefined;
  const pd = body.processingDate ? String(body.processingDate) : undefined;
  if (pd && !/^\d{4}-\d{2}-\d{2}$/.test(pd)) return { ok: false, error: 'INVALID_PROCESSING_DATE' };
  return { ok: true, rows: rowsRaw, seed, processingDate: pd };
}

export async function registerCompositeJobRoute(app: FastifyInstance): Promise<void> {
  app.post('/jobs/composite', async (req, reply): Promise<void> => {
    const body = (req.body || {}) as CompositeBody;
    const model = validate(body);
    if (!model.ok) { await reply.status(400).send({ error: model.error }); return; }
    // Enqueue job with fileTypes ["EaziPay"]; pipeline will produce EaziPay CSV + DDICA XML.
    // Forward optional metadata.Sun as the job request sun so generators can use originating details.
    const bodyAny = req.body as any;
    // Accept multiple metadata shapes: metadata.Sun, metadata.sun, metadata.originating
    const metaSun = bodyAny?.metadata?.Sun ?? bodyAny?.metadata?.sun ?? bodyAny?.metadata?.originating;
    const sun = metaSun ? {
      sunNumber: metaSun.sunNumber ?? metaSun.sun ?? metaSun.sunNumber ?? '',
      sunName: metaSun.sunName ?? metaSun.sunName ?? metaSun.name ?? '',
      sortCode: metaSun.sortCode ?? metaSun.originatingSort ?? '',
      accountNumber: metaSun.accountNumber ?? metaSun.originatingAccount ?? '',
      accountName: metaSun.accountName ?? metaSun.originatingName ?? '',
    } : undefined;
    const job = jobManager.enqueue({ fileTypes: ['EaziPay'], rows: model.rows, seed: model.seed, processingDate: model.processingDate, sun });
    await reply.status(202).send({ jobId: job.id, state: job.state, progress: job.progress });
  });
}
