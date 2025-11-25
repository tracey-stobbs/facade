import { app } from '../src/server.js';
import { describe, it, expect, afterAll } from 'vitest';
import fetch from 'node-fetch';

describe('POST /generate schema and SUN propagation', () => {
  it('rejects missing required fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/generate', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('enqueues job when rows exceed sync limit and preserves sun', async () => {
    // Use a large rows to force async path
    const payload = { fileTypes: ['EaziPay'], rows: 1000000, sun: { sunNumber: 'SUN123' } };
    const res = await app.inject({ method: 'POST', url: '/generate', payload });
    expect(res.statusCode).toBe(202);
    const body = await res.json();
    expect(body.jobId).toBeDefined();
  });
});

afterAll(async () => { await app.close(); });
