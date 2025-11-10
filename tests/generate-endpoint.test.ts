import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import formBody from '@fastify/formbody';
import { registerGenerateRoute } from '../src/routes/generate.js';

import { FastifyInstance } from 'fastify';
function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formBody);
  registerGenerateRoute(app);
  return app;
}

describe('POST /generate', () => {
  it('returns 400 for missing fileTypes', async () => {
  const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { rows: 10 } });
    expect(res.statusCode).toBe(400);
  });
  it('returns 202 and jobId when rows exceed sync limit (async enqueue)', async () => {
    process.env.SYNC_ROW_LIMIT = '5';
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 6 } });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
  });
  it('streams csv for valid request', async () => {
    process.env.SYNC_ROW_LIMIT = '5000';
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: '/generate', payload: { fileTypes: ['EaziPay'], rows: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('value1');
  });
});
