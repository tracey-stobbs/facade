import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import { registerGenerateRoute } from '../src/routes/generate.js';
import { jobManager } from '../src/jobs/jobManager.js';
import path from 'path';
import { randomUUID } from 'crypto';

function buildApp() {
  const app = Fastify({ logger: false });
  app.register(formBody);
  return app;
}

describe('job download zip', () => {
  it('produces zip placeholder after completion', async () => {
    process.env.SYNC_ROW_LIMIT = '1'; // force async path
    // Isolate outputRoot per test run to avoid interference with prior artifacts.
    process.env.OUTPUT_ROOT = path.join(process.cwd(), 'tmp-jobstore-tests', `jobs-artifacts-${randomUUID()}`);
    const app = buildApp();
    await jobManager.init();
    await registerGenerateRoute(app);
    const enqueue = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 2 } });
    expect(enqueue.statusCode).toBe(202);
    const jobId = enqueue.json().jobId as string;
    // wait for completion
    for (let i = 0; i < 250; i++) {
      const status = await app.inject({ method: 'GET', url: `/jobs/${jobId}/status` });
      const statJson = status.json();
      if (statJson.state === 'completed') {
        const dl = await app.inject({ method: 'GET', url: `/jobs/${jobId}/download` });
        expect(dl.statusCode).toBe(200);
        expect(dl.headers['content-type']).toContain('application/zip');
        expect(dl.body.length).toBeGreaterThan(10); // placeholder content size
        return;
      }
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('Job not completed');
  }, 10_000); // allow extra time under CI/Windows
});
