import { describe, it, expect } from 'vitest';
import { app } from '../src/server.js';
import { jobManager } from '../src/jobs/jobManager.js';

describe('POST /jobs/composite', () => {
  it('enqueues composite job and reaches completion', async () => {
    await jobManager.init();
    const res = await app.inject({
      method: 'POST',
      url: '/jobs/composite',
      payload: { rows: 2, seed: 555 },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { jobId: string };
    expect(body.jobId).toBeTruthy();
    // poll
    const start = Date.now();
    let completed = false;
    while (Date.now() - start < 12000) {
      const status = await app.inject({ method: 'GET', url: `/jobs/${body.jobId}/status` });
      const state = status.json() as { state: string; progress: number };
      if (state.state === 'completed' && state.progress === 100) { completed = true; break; }
      await new Promise(r => setTimeout(r, 150));
    }
    expect(completed).toBe(true);
  }, 15000);
});