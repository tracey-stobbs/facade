import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerCompositeJobRoute } from '../src/routes/compositeJob.js';
import { jobManager } from '../src/jobs/jobManager.js';

describe('Composite Sun propagation', () => {
  it('enqueues job with request.sun when metadata.Sun provided', async () => {
    const app = Fastify({ logger: false });
    await registerCompositeJobRoute(app as any);
    const payload = { report: 'ddica', rows: 2, metadata: { Sun: { sunNumber: '999888', sunName: 'TEST-SUN', sortCode: '111111', accountNumber: '22222222', accountName: 'ACCT' } } };
    const res = await app.inject({ method: 'POST', url: '/jobs/composite', payload });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    const jobId = body.jobId;
    // The jobManager holds jobs in memory for test; find the job and assert request.sun
    const job = jobManager.get(jobId);
    expect(job).toBeDefined();
    expect(job!.request.sun).toBeDefined();
    expect(job!.request.sun!.sunNumber).toBe('999888');
    expect(job!.request.sun!.sortCode).toBe('111111');
  });
});
