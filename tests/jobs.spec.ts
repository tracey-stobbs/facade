import { describe, it, expect } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formBody from '@fastify/formbody';
import { registerGenerateRoute } from '../src/routes/generate.js';
import { jobManager } from '../src/jobs/jobManager.js';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formBody);
  process.env.SYNC_ROW_LIMIT = '10';
  return app;
}

describe('async jobs', () => {
  it('enqueues job when rows exceed sync limit', async () => {
    const app = buildApp();
    await registerGenerateRoute(app);
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 25 } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    const job = jobManager.get(body.jobId);
  expect(job?.state === 'pending' || job?.state === 'running').toBe(true);
  });

  it('streams events via SSE', async () => {
    const app = buildApp();
    await registerGenerateRoute(app);
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 25 } });
    const jobId = res.json().jobId as string;
    // Poll job until completion
    for (let i = 0; i < 50; i++) {
      const statusRes = await app.inject({ method: 'GET', url: `/jobs/${jobId}` });
      const status = statusRes.json();
      if (status.state === 'completed') {
        expect(status.progress).toBe(100);
        return;
      }
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Job did not complete in expected timeframe');
  });
});
