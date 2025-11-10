import { describe, it, expect } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import formBody from '@fastify/formbody';
import { registerGenerateRoute } from '../src/routes/generate.js';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formBody);
  process.env.SYNC_ROW_LIMIT = '5';
  return app;
}

describe('job failure path', () => {
  it('marks a job as failed when fail flag used', async () => {
    const app = buildApp();
    await registerGenerateRoute(app);
    const res = await app.inject({ method: 'POST', url: '/jobs', payload: { fileTypes: ['EaziPay'], rows: 10, fail: true } });
    expect(res.statusCode).toBe(202);
    const jobId = res.json().jobId as string;
    // Poll until failed
  for (let i = 0; i < 100; i++) {
      const statusRes = await app.inject({ method: 'GET', url: `/jobs/${jobId}` });
      const status = statusRes.json();
      if (status.state === 'failed') {
        expect(status.error).toBeDefined();
        return;
      }
      if (status.state === 'completed') {
        throw new Error('Job unexpectedly completed');
      }
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Job did not fail in expected timeframe');
  });
});